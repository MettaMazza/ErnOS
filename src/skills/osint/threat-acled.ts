import { z } from "zod";

// ACLED API requires registration (free) — email + API key must be set.
// Domain changed from api.acleddata.com to acleddata.com/api/ in 2025.
const ACLED_URL = "https://acleddata.com/api/acled/read";
const ACLED_API_KEY = process.env.ACLED_API_KEY || "";
const ACLED_EMAIL = process.env.ACLED_EMAIL || "";
const DEFAULT_LIMIT = 500;

export async function getAcledEvents(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
  year?: string, // YYYY
) {
  // Construct the query
  const query = new URLSearchParams({
    limit: DEFAULT_LIMIT.toString(),
  });

  // Auth params — required since ACLED moved to authenticated access
  if (ACLED_API_KEY) {
    query.append("key", ACLED_API_KEY);
  }
  if (ACLED_EMAIL) {
    query.append("email", ACLED_EMAIL);
  }

  if (!ACLED_API_KEY || !ACLED_EMAIL) {
    console.warn("[osint] ACLED_API_KEY and ACLED_EMAIL are required. Register at https://acleddata.com/");
    return [];
  }

  if (year) {
    query.append("year", year);
  }

  // Bounding box filter (format: lat,lon|lat,lon)
  query.append("lat", `${lamax},${lamin}`);
  query.append("lat_where", "BETWEEN");

  query.append("lon", `${lomax},${lomin}`);
  query.append("lon_where", "BETWEEN");

  const url = `${ACLED_URL}?${query.toString()}`;

  // ACLED requires a valid User-Agent, and sometimes fails on IPv6/undici local setups.
  // We use standard fetch with a larger timeout.

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "ErnOS-OSINT-Engine/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 429) {
      throw new Error(
        "ACLED Rate Limit Exceeded or Account Registration Required for higher limits.",
      );
    }

    if (!response.ok) {
      throw new Error(`ACLED HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("ACLED Ingestion Failed:", err.message);
      throw err; // Re-throw to inform the agent that the search failed
    }
    return [];
  }
}
