import { z } from "zod";

// ACLED API has strict date limits, defaults to recent 1 year for unauthenticated calls
const ACLED_URL = "https://api.acleddata.com/acled/read";
const DEFAULT_LIMIT = 500;

export async function getAcledEvents(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
  year?: string, // YYYY
) {
  // Free API requires terms agreement headers and email optionally
  // But works with basic filters.

  // Construct the query
  const query = new URLSearchParams({
    limit: DEFAULT_LIMIT.toString(),
  });

  if (year) {
    query.append("year", year);
  }

  // Bounding box filter (format: lat,lon|lat,lon)
  query.append("lat", `${lamax},${lamin}`);
  query.append("lat_where", "BETWEEN");

  query.append("lon", `${lomax},${lomin}`);
  query.append("lon_where", "BETWEEN");

  const url = `${ACLED_URL}?${query.toString()}`;

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
