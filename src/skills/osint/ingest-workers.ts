import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { resolveErnOSPackageRootSync } from "../../infra/ernos-root.js";

// ----------------------------------------------------------------------------
// Database Initialization
// ----------------------------------------------------------------------------
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const rootPath = resolveErnOSPackageRootSync({ cwd: process.cwd() }) || process.cwd();
  if (!rootPath) {
    throw new Error("CRITICAL: Cannot resolve ErnOS package root to create OSINT SQLite cache.");
  }

  const DB_DIR = path.join(rootPath, ".data", "osint");
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const dbPath = path.join(DB_DIR, "osint-cache.sqlite");
  _db = new Database(dbPath);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS flights_cache (
      icao24 TEXT PRIMARY KEY,
      callsign TEXT,
      origin_country TEXT,
      time_position INTEGER,
      last_contact INTEGER,
      longitude REAL,
      latitude REAL,
      baro_altitude REAL,
      on_ground INTEGER,
      velocity REAL,
      true_track REAL,
      vertical_rate REAL,
      geo_altitude REAL,
      fetched_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS ships_cache (
      mmsi TEXT PRIMARY KEY,
      time_utc TEXT,
      latitude REAL,
      longitude REAL,
      cog REAL,
      sog REAL,
      heading INTEGER,
      nav_status INTEGER,
      fetched_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_flights_geo ON flights_cache(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_flights_fetched ON flights_cache(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_ships_geo ON ships_cache(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_ships_fetched ON ships_cache(fetched_at);
  `);
  return _db;
}

const CACHE_TTL_SECONDS = 60 * 5; // 5 minutes max age for 'live' tracking

// ----------------------------------------------------------------------------
// Aviation Ingestion (OpenSky Network)
// ----------------------------------------------------------------------------
const OPENSKY_URL = "https://opensky-network.org/api/states/all";
let isFetchingFlights = false;

// The OpenSky schema
// [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source, category]

export async function ingestFlights(lamin: number, lomin: number, lamax: number, lomax: number) {
  if (isFetchingFlights) {
    return; // Prevent overlapping fetch stampedes
  }

  // Check TTL first - are there already recent flights in this bounding box?
  const cutoff = Math.floor(Date.now() / 1000) - 45; // 45 second cache per bbox
  const cachedCount = getDb()
    .prepare(`
    SELECT COUNT(*) as c FROM flights_cache
    WHERE latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND fetched_at > ?
  `)
    .get(lamin, lamax, lomin, lomax, cutoff) as { c: number };

  if (cachedCount.c > 5) {
    // We already have fresh data for this zone, don't hammer the API
    return;
  }

  isFetchingFlights = true;
  try {
    const url = `${OPENSKY_URL}?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "ErnOS-OSINT-Engine/1.0",
      },
      // Keep timeout short so we don't block
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 429) {
      console.warn("⚠️ OpenSky Rate Limit Hit. Cooling down ingestion worker.");
      isFetchingFlights = false;
      return;
    }

    if (!response.ok) {
      throw new Error(`OpenSky HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    const states = data.states || [];

    const now = Math.floor(Date.now() / 1000);
    const insertStmt = getDb().prepare(`
      INSERT OR REPLACE INTO flights_cache 
      (icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate, geo_altitude, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = getDb().transaction((flightData: any[]) => {
      for (const f of flightData) {
        // Only insert if it has valid coordinates
        if (typeof f[5] === "number" && typeof f[6] === "number") {
          insertStmt.run(
            f[0], // icao24
            f[1]?.trim(), // callsign
            f[2], // origin_country
            f[3], // time_position
            f[4], // last_contact
            f[5], // longitude
            f[6], // latitude
            f[7], // baro_altitude
            f[8] ? 1 : 0, // on_ground
            f[9], // velocity
            f[10], // true_track
            f[11], // vertical_rate
            f[13], // geo_altitude
            now, // fetched_at
          );
        }
      }
    });

    insertMany(states);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("Flight Ingestion Failed:", err.message);
    }
  } finally {
    isFetchingFlights = false;
  }
}

// ----------------------------------------------------------------------------
// Query Exporters
// ----------------------------------------------------------------------------

export function getCachedFlights(lamin: number, lomin: number, lamax: number, lomax: number) {
  // Purge dead data first
  const cutoff = Math.floor(Date.now() / 1000) - CACHE_TTL_SECONDS;
  getDb().prepare("DELETE FROM flights_cache WHERE fetched_at < ?").run(cutoff);

  return getDb()
    .prepare(`
    SELECT * FROM flights_cache 
    WHERE latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
  `)
    .all(lamin, lamax, lomin, lomax);
}

// ----------------------------------------------------------------------------
// Maritime Ingestion (AISHub)
// ----------------------------------------------------------------------------
const AISHUB_USERNAME = process.env.AISHUB_USERNAME || "demo";
let isFetchingShips = false;

export async function ingestShips(lamin: number, lomin: number, lamax: number, lomax: number) {
  if (isFetchingShips) return;

  const cutoff = Math.floor(Date.now() / 1000) - 45;
  const cachedCount = getDb()
    .prepare(`
    SELECT COUNT(*) as c FROM ships_cache
    WHERE latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND fetched_at > ?
  `)
    .get(lamin, lamax, lomin, lomax, cutoff) as { c: number };

  if (cachedCount.c > 5) return;

  isFetchingShips = true;
  try {
    const url = `https://data.aishub.net/ws.php?username=${AISHUB_USERNAME}&format=1&output=json&compress=0&latmin=${lamin}&lonmin=${lomin}&latmax=${lamax}&lonmax=${lomax}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`AISHub HTTP Error: ${response.status}`);

    const data = await response.json();
    if (!data || data.error) return;

    const ships = data[0] || data;

    const now = Math.floor(Date.now() / 1000);
    const insertStmt = getDb().prepare(`
      INSERT OR REPLACE INTO ships_cache 
      (mmsi, time_utc, latitude, longitude, cog, sog, heading, nav_status, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = getDb().transaction((shipData: any[]) => {
      for (const s of shipData) {
        if (typeof s.LATITUDE === "number" && typeof s.LONGITUDE === "number") {
          insertStmt.run(
            String(s.MMSI),
            String(s.TIME),
            s.LATITUDE,
            s.LONGITUDE,
            s.COG,
            s.SOG,
            s.HEADING,
            s.NAVSTAT,
            now,
          );
        }
      }
    });

    if (Array.isArray(ships)) {
      insertMany(ships);
    }
  } catch (err: unknown) {
    if (err instanceof Error) console.error("Ship Ingestion Failed:", err.message);
  } finally {
    isFetchingShips = false;
  }
}

export function getCachedShips(lamin: number, lomin: number, lamax: number, lomax: number) {
  const cutoff = Math.floor(Date.now() / 1000) - CACHE_TTL_SECONDS;
  getDb().prepare("DELETE FROM ships_cache WHERE fetched_at < ?").run(cutoff);

  return getDb()
    .prepare(`
    SELECT * FROM ships_cache 
    WHERE latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
  `)
    .all(lamin, lamax, lomin, lomax);
}
