// GDACS Returns GeoJSON natively of active disasters
const GDACS_URL = "https://www.gdacs.org/xml/rss.geojson";

export async function getActiveDisasters() {
  try {
    const response = await fetch(GDACS_URL, {
      method: "GET",
      headers: {
        "User-Agent": "ErnOS-OSINT-Engine/1.0",
        Accept: "application/geo+json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`GDACS HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    return data; // Raw FeatureCollection
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("GDACS Ingestion Failed:", err.message);
      throw err;
    }
    return { type: "FeatureCollection", features: [] };
  }
}
