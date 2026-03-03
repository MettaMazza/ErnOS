import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import JSZip from "jszip";
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
    CREATE TABLE IF NOT EXISTS omnigrid_events (
      event_id TEXT PRIMARY KEY,
      source TEXT,
      event_type TEXT,
      latitude REAL,
      longitude REAL,
      timestamp INTEGER,
      metadata JSON,
      confidence REAL
    );

    CREATE INDEX IF NOT EXISTS idx_omnigrid_geo ON omnigrid_events(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_omnigrid_time ON omnigrid_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_omnigrid_source ON omnigrid_events(source);
  `);
  return _db;
}

const CACHE_TTL_SECONDS = 60 * 5; // 5 minutes max age for 'live' tracking

// ----------------------------------------------------------------------------
// NASA FIRMS (Thermal/Wildfires)
// ----------------------------------------------------------------------------
let isFetchingFirms = false;

/**
 * Ingests VIIRS thermal anomalies from NASA FIRMS.
 * Free public map keys are rate limited, so we use the public URL without a key
 * which is heavily cached but sufficient for general OSINT overlay.
 */
export async function ingestFirms(lamin: number, lomin: number, lamax: number, lomax: number) {
  if (isFetchingFirms) return;

  const cutoff = Math.floor(Date.now() / 1000) - 3600; // 1 hr cache for FIRMS
  const cachedCount = getDb()
    .prepare(`
    SELECT COUNT(*) as c FROM omnigrid_events
    WHERE source = 'FIRMS'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND timestamp > ?
  `)
    .get(lamin, lamax, lomin, lomax, cutoff) as { c: number };

  if (cachedCount.c > 0) return; // We have fresh data

  isFetchingFirms = true;
  try {
    // NASA FIRMS Global VIIRS SNPP (24h)
    // Note: To make this robust, coordinate with user to inject a MAP_KEY
    // For now, testing public endpoints or placeholder parsed static data if API is locked
    const url = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv";
    
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`FIRMS fetch failed: ${res.status}`);

    const csvText = await res.text();
    const lines = csvText.trim().split("\\n").slice(1); // Skip header

    const insert = getDb().prepare(`
      INSERT OR IGNORE INTO omnigrid_events (event_id, source, event_type, latitude, longitude, timestamp, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const ingestTime = Math.floor(Date.now() / 1000);
    let inserted = 0;

    getDb().transaction(() => {
      for (const line of lines) {
        const parts = line.split(",");
        if (parts.length < 10) continue;

        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        const bright = parseFloat(parts[2]);
        // parts[5] is acq_date (YYYY-MM-DD), parts[6] is acq_time (HHMM)
        const confidence = parts[8]; // 'l', 'n', 'h' for low, nominal, high

        // Filter to bounding box
        if (lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax) {
          const eventId = `firms_${lat}_${lon}_${ingestTime}`;
          
          let confScore = 0.5;
          if (confidence === 'h') confScore = 0.9;
          if (confidence === 'l') confScore = 0.3;

          insert.run(
            eventId,
            "FIRMS",
            "THERMAL_ANOMALY",
            lat,
            lon,
            ingestTime,
            JSON.stringify({ brightness: bright, confidence_level: confidence }),
            confScore
          );
          inserted++;
        }
      }
    })();
    // Avoid noisy logs, only log if found
    if (inserted > 0) {
       console.log(`[osint] Ingested ${inserted} FIRMS anomalies in bounding box.`);
    }
  } catch (err) {
    if (err instanceof Error && err.name !== "TimeoutError") {
      console.warn(`[osint] FIRMS Ingestion Error: ${err.message}`);
    }
  } finally {
    isFetchingFirms = false;
  }
}


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
    SELECT COUNT(*) as c FROM omnigrid_events
    WHERE source = 'OPENSKY'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND timestamp > ?
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
      INSERT OR REPLACE INTO omnigrid_events 
      (event_id, source, event_type, latitude, longitude, timestamp, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = getDb().transaction((flightData: any[]) => {
      for (const f of flightData) {
        // Only insert if it has valid coordinates
        if (typeof f[5] === "number" && typeof f[6] === "number") {
          const icao24 = f[0];
          insertStmt.run(
            `opensky_${icao24}`, // event_id
            "OPENSKY", // source
            "FLIGHT_TRACK", // event_type
            f[6], // latitude
            f[5], // longitude
            now, // timestamp
            JSON.stringify({
              icao24,
              callsign: f[1]?.trim(),
              origin_country: f[2],
              time_position: f[3],
              last_contact: f[4],
              baro_altitude: f[7],
              on_ground: f[8] ? 1 : 0,
              velocity: f[9],
              true_track: f[10],
              vertical_rate: f[11],
              geo_altitude: f[13],
            }), // metadata
            0.9, // confidence (live transponder)
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
  getDb().prepare("DELETE FROM omnigrid_events WHERE source = 'OPENSKY' AND timestamp < ?").run(cutoff);

  const rows = getDb()
    .prepare(`
    SELECT * FROM omnigrid_events
    WHERE source = 'OPENSKY'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
  `)
    .all(lamin, lamax, lomin, lomax) as any[];
  return rows;
}

export function getCachedFirms(lamin: number, lomin: number, lamax: number, lomax: number) {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  getDb().prepare("DELETE FROM omnigrid_events WHERE source = 'FIRMS' AND timestamp < ?").run(cutoff);
  return getDb()
    .prepare(`
    SELECT * FROM omnigrid_events
    WHERE source = 'FIRMS'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
  `)
    .all(lamin, lamax, lomin, lomax) as any[];
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
    SELECT COUNT(*) as c FROM omnigrid_events
    WHERE source = 'AISHUB'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND timestamp > ?
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
      INSERT OR REPLACE INTO omnigrid_events 
      (event_id, source, event_type, latitude, longitude, timestamp, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = getDb().transaction((shipData: any[]) => {
      for (const s of shipData) {
        if (typeof s.LATITUDE === "number" && typeof s.LONGITUDE === "number") {
          const mmsi = String(s.MMSI);
          insertStmt.run(
            `aishub_${mmsi}`, // event_id
            "AISHUB", // source
            "VESSEL_TRACK", // event_type
            s.LATITUDE, // latitude
            s.LONGITUDE, // longitude
            now, // timestamp
            JSON.stringify({
              mmsi,
              time_utc: String(s.TIME),
              cog: s.COG,
              sog: s.SOG,
              heading: s.HEADING,
              nav_status: s.NAVSTAT,
            }), // metadata
            0.9, // confidence (live AIS transponder)
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
  getDb().prepare("DELETE FROM omnigrid_events WHERE source = 'AISHUB' AND timestamp < ?").run(cutoff);

  const rows = getDb()
    .prepare(`
    SELECT * FROM omnigrid_events 
    WHERE source = 'AISHUB'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
  `)
    .all(lamin, lamax, lomin, lomax) as any[];
  return rows;
}

// ----------------------------------------------------------------------------
// Social & News (GDELT 2.0 Live)
// ----------------------------------------------------------------------------
let isFetchingGdelt = false;

export async function ingestGdelt(lamin: number, lomin: number, lamax: number, lomax: number) {
  if (isFetchingGdelt) return;

  const cutoff = Math.floor(Date.now() / 1000) - 900; // 15 mins
  const cachedCount = getDb()
    .prepare(`
    SELECT COUNT(*) as c FROM omnigrid_events
    WHERE source = 'GDELT'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND timestamp > ?
  `)
    .get(lamin, lamax, lomin, lomax, cutoff) as { c: number };

  if (cachedCount.c > 0) return;

  isFetchingGdelt = true;
  try {
    const metaRes = await fetch("http://data.gdeltproject.org/gdeltv2/lastupdate.txt", { signal: AbortSignal.timeout(10000) });
    if (!metaRes.ok) throw new Error("GDELT meta failed");
    const metaText = await metaRes.text();
    const exportUrl = metaText.split("\n")[0].split(" ")[2];
    if (!exportUrl) throw new Error("GDELT export URL missing");

    const zipRes = await fetch(exportUrl, { signal: AbortSignal.timeout(30000) });
    if (!zipRes.ok) throw new Error(`GDELT ZIP failed: ${zipRes.status}`);
    const zipBuffer = await zipRes.arrayBuffer();

    const zip = await JSZip.loadAsync(zipBuffer);
    const csvFile = Object.values(zip.files).find(f => f.name.endsWith(".CSV"));
    if (!csvFile) throw new Error("No CSV found in GDELT zip");
    
    const csvText = await csvFile.async("string");
    const lines = csvText.trim().split("\n"); // GDELT CSV has no header

    const ingestTime = Math.floor(Date.now() / 1000);
    const insertStmt = getDb().prepare(`
      INSERT OR IGNORE INTO omnigrid_events 
      (event_id, source, event_type, latitude, longitude, timestamp, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    getDb().transaction(() => {
      for (const line of lines) {
        const parts = line.split("\t"); 
        if (parts.length < 58) continue; 

        // ActionGeo_Lat is 53, ActionGeo_Long is 54 in GDELT V2
        let latStr = parts[53] || parts[40]; // fallback to Actor1Geo if action is vague
        let lonStr = parts[54] || parts[41];
        if (!latStr || !lonStr) continue;

        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        
        if (!isNaN(lat) && !isNaN(lon) && lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax) {
          
          let eventType = "NEWS_EVENT";
          const cameoRoot = parseInt(parts[29], 10);
          if (cameoRoot >= 14) eventType = "CONFLICT_EVENT"; 
          
          const goldstein = parseFloat(parts[31]);
          
          let confidence = 0.5;
          if (!isNaN(goldstein)) {
             confidence = 1 - (goldstein + 10) / 20;
          }

          insertStmt.run(
            `gdelt_${parts[0]}_${ingestTime}`, // id
            "GDELT",
            eventType,
            lat,
            lon,
            ingestTime,
            JSON.stringify({
              url: parts[60], 
              cameo_code: parts[27],
              goldstein: goldstein,
              actor1: parts[6],
              actor2: parts[16],
              num_mentions: parseInt(parts[32], 10) || 0
            }),
            confidence
          );
          inserted++;
        }
      }
    })();

    if (inserted > 0) {
      console.log(`[osint] Ingested ${inserted} GDELT events via CSV in bounding box.`);
    }

  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("GDELT Ingestion Failed:", err.message);
    }
  } finally {
    isFetchingGdelt = false;
  }
}

export function getCachedGdelt(lamin: number, lomin: number, lamax: number, lomax: number) {
  const cutoff = Math.floor(Date.now() / 1000) - 900;
  getDb().prepare("DELETE FROM omnigrid_events WHERE source = 'GDELT' AND timestamp < ?").run(cutoff);
  return getDb()
    .prepare(`
    SELECT * FROM omnigrid_events
    WHERE source = 'GDELT'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
  `)
    .all(lamin, lamax, lomin, lomax) as any[];
}

// ----------------------------------------------------------------------------
// Weather (AviationWeather API Live METARs)
// ----------------------------------------------------------------------------
let isFetchingWeather = false;

export async function ingestWeather(lamin: number, lomin: number, lamax: number, lomax: number) {
  if (isFetchingWeather) return;

  const cutoff = Math.floor(Date.now() / 1000) - 1800; // 30 mins
  const cachedCount = getDb()
    .prepare(`
    SELECT COUNT(*) as c FROM omnigrid_events
    WHERE source = 'AVIATION_WEATHER'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND timestamp > ?
  `)
    .get(lamin, lamax, lomin, lomax, cutoff) as { c: number };

  if (cachedCount.c > 5) return;

  isFetchingWeather = true;
  try {
    const url = `https://aviationweather.gov/api/data/metar?bbox=${lamin},${lomin},${lamax},${lomax}&format=json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Weather API Error: ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data)) return;

    const ingestTime = Math.floor(Date.now() / 1000);
    const insertStmt = getDb().prepare(`
      INSERT OR REPLACE INTO omnigrid_events 
      (event_id, source, event_type, latitude, longitude, timestamp, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const insertMany = getDb().transaction((observations: any[]) => {
      for (const obs of observations) {
        if (typeof obs.lat === "number" && typeof obs.lon === "number") {
          insertStmt.run(
            `weather_${obs.icaoId}`, // event_id
            "AVIATION_WEATHER", // source
            "WEATHER_OBSERVATION", // event_type
            obs.lat, // latitude
            obs.lon, // longitude
            ingestTime, // timestamp
            JSON.stringify({
              station_id: obs.icaoId,
              name: obs.name,
              temp_c: obs.temp,
              dewpoint_c: obs.dewp,
              wind_dir: obs.wdir,
              wind_speed_kt: obs.wspd,
              visibility: obs.visib,
              altimeter: obs.altim,
              raw_metar: obs.rawOb,
              clouds: obs.clouds || [],
              flight_category: obs.fltCat,
            }), // metadata
            0.9, // confidence (live METAR)
          );
          inserted++;
        }
      }
    });

    insertMany(data);
    
    if (inserted > 0) {
      console.log(`[osint] Ingested ${inserted} weather stations in bounding box.`);
    }
  } catch (err: unknown) {
    if (err instanceof Error) console.error("Weather Ingestion Failed:", err.message);
  } finally {
    isFetchingWeather = false;
  }
}

export function getCachedWeather(lamin: number, lomin: number, lamax: number, lomax: number) {
  const cutoff = Math.floor(Date.now() / 1000) - 3600; // Keep for 1 hour
  getDb().prepare("DELETE FROM omnigrid_events WHERE source = 'AVIATION_WEATHER' AND timestamp < ?").run(cutoff);
  return getDb()
    .prepare(`
    SELECT * FROM omnigrid_events 
    WHERE source = 'AVIATION_WEATHER'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
  `)
    .all(lamin, lamax, lomin, lomax) as any[];
}

// ----------------------------------------------------------------------------
// Live Webcams & CCTV (Windy Webcams API V3)
// ----------------------------------------------------------------------------
let isFetchingWebcams = false;
const WINDY_API_KEY = process.env.WINDY_API_KEY || "";

export async function ingestWebcams(lamin: number, lomin: number, lamax: number, lomax: number) {
  if (isFetchingWebcams) return;

  const cutoff = Math.floor(Date.now() / 1000) - 3600; // 1 hr cache
  const cachedCount = getDb()
    .prepare(`
    SELECT COUNT(*) as c FROM omnigrid_events
    WHERE source = 'WINDY_WEBCAMS'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND timestamp > ?
  `)
    .get(lamin, lamax, lomin, lomax, cutoff) as { c: number };

  if (cachedCount.c > 5) return;

  if (!WINDY_API_KEY) {
    console.warn("[osint] WINDY_API_KEY is not set. Skipping live CCTV camera ingest.");
    return;
  }

  isFetchingWebcams = true;
  try {
    const url = `https://api.windy.com/webcams/api/v3/webcams?limit=50&bbox=${lamax},${lomin},${lamin},${lomax}&include=location,images`;
    const response = await fetch(url, {
      headers: {
        "X-WINDY-API-KEY": WINDY_API_KEY,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Windy Webcams HTTP Error: ${response.status}`);

    const data = await response.json();
    if (!data || !data.webcams || !Array.isArray(data.webcams)) return;

    const ingestTime = Math.floor(Date.now() / 1000);
    const insertStmt = getDb().prepare(`
      INSERT OR REPLACE INTO omnigrid_events 
      (event_id, source, event_type, latitude, longitude, timestamp, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const insertMany = getDb().transaction((webcams: any[]) => {
      for (const cam of webcams) {
        if (cam.location && typeof cam.location.latitude === "number" && typeof cam.location.longitude === "number") {
          insertStmt.run(
            `webcam_${cam.webcamId}`, // event_id
            "WINDY_WEBCAMS", // source
            "CCTV_CAMERA", // event_type
            cam.location.latitude, // latitude
            cam.location.longitude, // longitude
            ingestTime, // timestamp
            JSON.stringify({
              title: cam.title || "Unknown CCTV",
              status: cam.status || "unknown",
              category: cam.category?.id || "public",
              image_url: cam.images?.current?.preview || cam.images?.current?.thumbnail || "",
              webcam_url: cam.urls?.detail || "",
              timezone: cam.location?.timezone || "UTC",
            }), // metadata
            0.8, // confidence
          );
          inserted++;
        }
      }
    });

    insertMany(data.webcams);

    if (inserted > 0) {
      console.log(`[osint] Ingested ${inserted} CCTV Webcams in bounding box.`);
    }
  } catch (err: unknown) {
    if (err instanceof Error) console.error("Webcam Ingestion Failed:", err.message);
  } finally {
    isFetchingWebcams = false;
  }
}

export function getCachedWebcams(lamin: number, lomin: number, lamax: number, lomax: number) {
  const cutoff = Math.floor(Date.now() / 1000) - 3600; // Keep for 1 hour
  getDb().prepare("DELETE FROM omnigrid_events WHERE source = 'WINDY_WEBCAMS' AND timestamp < ?").run(cutoff);
  return getDb()
    .prepare(`
    SELECT * FROM omnigrid_events 
    WHERE source = 'WINDY_WEBCAMS'
      AND latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
  `)
    .all(lamin, lamax, lomin, lomax) as any[];
}
