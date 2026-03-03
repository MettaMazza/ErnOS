import { getActiveDisasters } from "./disaster-gdacs.js";
import { ingestFlights, getCachedFlights, ingestShips, getCachedShips, getCachedFirms, getCachedGdelt, ingestWeather, getCachedWeather, ingestWebcams, getCachedWebcams } from "./ingest-workers.js";
import { getAcledEvents } from "./threat-acled.js";

// ----------------------------------------------------------------------------
// LLM Callable Tools for OSINT Synthesis
// ----------------------------------------------------------------------------

export const osintSkills = [
  {
    name: "osint_search_aviation",
    description:
      "Fetches live commercial and private aviation transponder data (ADS-B) within a specific bounding box.",
    parameters: {
      type: "object",
      properties: {
        lamin: { type: "number", description: "Minimum latitude (-90 to 90)" },
        lomin: { type: "number", description: "Minimum longitude (-180 to 180)" },
        lamax: { type: "number", description: "Maximum latitude (-90 to 90)" },
        lomax: { type: "number", description: "Maximum longitude (-180 to 180)" },
      },
      required: ["lamin", "lomin", "lamax", "lomax"],
    },
    execute: async (_toolCallId: string, args: any) => {
      await ingestFlights(args.lamin, args.lomin, args.lamax, args.lomax);
      const flights = getCachedFlights(args.lamin, args.lomin, args.lamax, args.lomax);
      return {
        success: true,
        content: [
          {
            type: "text",
            text: `Successfully fetched ${flights.length} active aircraft. Use render_osint_map to visualize them.`,
          },
        ],
      };
    },
  },
  {
    name: "osint_search_maritime",
    description: "Fetches live maritime vessel tracking data (AIS) within a specific bounding box.",
    parameters: {
      type: "object",
      properties: {
        lamin: { type: "number", description: "Minimum latitude (-90 to 90)" },
        lomin: { type: "number", description: "Minimum longitude (-180 to 180)" },
        lamax: { type: "number", description: "Maximum latitude (-90 to 90)" },
        lomax: { type: "number", description: "Maximum longitude (-180 to 180)" },
      },
      required: ["lamin", "lomin", "lamax", "lomax"],
    },
    execute: async (_toolCallId: string, args: any) => {
      await ingestShips(args.lamin, args.lomin, args.lamax, args.lomax);
      const ships = getCachedShips(args.lamin, args.lomin, args.lamax, args.lomax);
      return {
        success: true,
        content: [
          {
            type: "text",
            text: `Successfully fetched ${ships.length} active vessels. Use render_osint_map to visualize them.`,
          },
        ],
      };
    },
  },
  {
    name: "osint_search_threats",
    description:
      "Fetches reported armed conflict, violence, and protest data (ACLED) within a bounding box.",
    parameters: {
      type: "object",
      properties: {
        lamin: { type: "number", description: "Minimum latitude" },
        lomin: { type: "number", description: "Minimum longitude" },
        lamax: { type: "number", description: "Maximum latitude" },
        lomax: { type: "number", description: "Maximum longitude" },
        year: { type: "string", description: "Optional YYYY format to restrict search" },
      },
      required: ["lamin", "lomin", "lamax", "lomax"],
    },
    execute: async (_toolCallId: string, args: any) => {
      const events = await getAcledEvents(
        args.lamin,
        args.lomin,
        args.lamax,
        args.lomax,
        args.year,
      );
      return {
        success: true,
        content: [
          {
            type: "text",
            text:
              JSON.stringify(events).substring(0, 2000) +
              "... [Data truncated. Use render_osint_map to visualize.]",
          },
        ],
      };
    },
  },
  {
    name: "osint_search_weather",
    description:
      "Fetches live global weather METAR observations (current wind vectors, temperature, moisture) from aviation stations within a specific bounding box.",
    parameters: {
      type: "object",
      properties: {
        lamin: { type: "number", description: "Minimum latitude" },
        lomin: { type: "number", description: "Minimum longitude" },
        lamax: { type: "number", description: "Maximum latitude" },
        lomax: { type: "number", description: "Maximum longitude" },
      },
      required: ["lamin", "lomin", "lamax", "lomax"],
    },
    execute: async (_toolCallId: string, args: any) => {
      await ingestWeather(args.lamin, args.lomin, args.lamax, args.lomax);
      const obs = getCachedWeather(args.lamin, args.lomin, args.lamax, args.lomax);
      return {
        success: true,
        content: [
          {
            type: "text",
            text: `Successfully fetched ${obs.length} live weather stations. Use render_osint_map to visualize them.`,
          },
        ],
      };
    },
  },
  {
    name: "osint_search_webcams",
    description: "Fetches live public CCTV and traffic cameras (Windy Webcams) within a specific bounding box.",
    parameters: {
      type: "object",
      properties: {
        lamin: { type: "number", description: "Minimum latitude" },
        lomin: { type: "number", description: "Minimum longitude" },
        lamax: { type: "number", description: "Maximum latitude" },
        lomax: { type: "number", description: "Maximum longitude" },
      },
      required: ["lamin", "lomin", "lamax", "lomax"],
    },
    execute: async (_toolCallId: string, args: any) => {
      await ingestWebcams(args.lamin, args.lomin, args.lamax, args.lomax);
      const cams = getCachedWebcams(args.lamin, args.lomin, args.lamax, args.lomax);
      return {
        success: true,
        content: [
          {
            type: "text",
            text: `Successfully fetched ${cams.length} live public webcams. Use render_osint_map to visualize them.`,
          },
        ],
      };
    },
  },
  {
    name: "osint_search_disasters",
    description:
      "Fetches live global natural disasters (GDACS). No bounding box required, returns global alerts.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async (_toolCallId: string, args: any) => {
      const gjson = await getActiveDisasters();
      return {
        success: true,
        content: [
          {
            type: "text",
            text: `Found ${gjson.features?.length || 0} active global alerts. Use render_osint_map to visualize them.`,
          },
        ],
      };
    },
  },
  {
    name: "render_osint_map",
    description:
      "Synthesizes fetched OSINT data and renders the Palantir-style Kepler.gl operational map on the Canvas natively. Generates an interactive 3D GUI object.",
    parameters: {
      type: "object",
      properties: {
        view_latitude: { type: "number", description: "Map center latitude" },
        view_longitude: { type: "number", description: "Map center longitude" },
        zoom_level: { type: "number", description: "1 is global, 10 is city, 20 is street" },
        lamin: { type: "number", description: "Minimum latitude bound for gathering local data" },
        lomin: { type: "number", description: "Minimum longitude bound for gathering local data" },
        lamax: { type: "number", description: "Maximum latitude bound for gathering local data" },
        lomax: { type: "number", description: "Maximum longitude bound for gathering local data" },
        layers_to_enable: {
          type: "array",
          items: { type: "string", enum: ["aviation", "maritime", "threats", "disasters", "firms", "gdelt", "weather", "webcams"] },
          description: "Which telemetry layers to overlay",
        },
      },
      required: [
        "view_latitude",
        "view_longitude",
        "zoom_level",
        "lamin",
        "lomin",
        "lamax",
        "lomax",
        "layers_to_enable",
      ],
    },
    execute: async (_toolCallId: string, args: any) => {
      const datasets = [];
      const { lamin, lomin, lamax, lomax } = args;

      const layers = Array.isArray(args.layers_to_enable) ? args.layers_to_enable : [];

      if (layers.includes("aviation")) {
        const flightsData = getCachedFlights(lamin, lomin, lamax, lomax);
        datasets.push({
          info: { id: "aviation", label: "Live Aviation (ADS-B)" },
          data: {
            fields: [
              { name: "icao24", format: "string" },
              { name: "longitude", format: "real" },
              { name: "latitude", format: "real" },
              { name: "velocity", format: "real" },
            ],
            rows: flightsData.map((f: any) => {
              const meta = JSON.parse(f.metadata || "{}");
              return [meta.icao24 || f.event_id, f.longitude, f.latitude, meta.velocity || 0];
            }),
          },
        });
      }

      if (layers.includes("maritime")) {
        const shipsData = getCachedShips(lamin, lomin, lamax, lomax);
        datasets.push({
          info: { id: "maritime", label: "Live Maritime (AIS)" },
          data: {
            fields: [
              { name: "mmsi", format: "string" },
              { name: "longitude", format: "real" },
              { name: "latitude", format: "real" },
              { name: "sog", format: "real" },
            ],
            rows: shipsData.map((s: any) => {
              const meta = JSON.parse(s.metadata || "{}");
              return [meta.mmsi || s.event_id, s.longitude, s.latitude, meta.sog || 0];
            }),
          },
        });
      }

      if (layers.includes("firms")) {
        const firmsData = getCachedFirms(lamin, lomin, lamax, lomax);
        datasets.push({
          info: { id: "firms", label: "Thermal Anomalies (FIRMS)" },
          data: {
            fields: [
              { name: "brightness", format: "real" },
              { name: "longitude", format: "real" },
              { name: "latitude", format: "real" },
              { name: "confidence", format: "real" },
            ],
            rows: firmsData.map((f: any) => {
              const meta = JSON.parse(f.metadata || "{}");
              return [meta.brightness || 0, f.longitude, f.latitude, f.confidence];
            }),
          },
        });
      }

      if (layers.includes("gdelt")) {
        const gdeltData = getCachedGdelt(lamin, lomin, lamax, lomax);
        datasets.push({
          info: { id: "gdelt", label: "Global Events (GDELT)" },
          data: {
            fields: [
              { name: "event_type", format: "string" },
              { name: "actor1", format: "string" },
              { name: "goldstein", format: "real" },
              { name: "longitude", format: "real" },
              { name: "latitude", format: "real" },
              { name: "url", format: "string" },
            ],
            rows: gdeltData.map((e: any) => {
              const meta = JSON.parse(e.metadata || "{}");
              return [e.event_type, meta.actor1 || "Unknown", meta.goldstein || 0, e.longitude, e.latitude, meta.url || ""];
            }),
          },
        });
      }

      if (layers.includes("weather")) {
        const weatherData = getCachedWeather(lamin, lomin, lamax, lomax);
        datasets.push({
          info: { id: "weather", label: "Live Weather (METAR)" },
          data: {
            fields: [
              { name: "station_id", format: "string" },
              { name: "longitude", format: "real" },
              { name: "latitude", format: "real" },
              { name: "temp_c", format: "real" },
              { name: "wind_speed_kt", format: "real" },
              { name: "wind_dir", format: "real" },
              { name: "visibility", format: "string" },
              { name: "flight_category", format: "string" },
            ],
            rows: weatherData.map((w: any) => {
              const meta = JSON.parse(w.metadata || "{}");
              return [meta.station_id || w.event_id, w.longitude, w.latitude, meta.temp_c || 0, meta.wind_speed_kt || 0, meta.wind_dir || 0, meta.visibility || "", meta.flight_category || ""];
            }),
          },
        });
      }

      if (layers.includes("disasters")) {
        const gdacsGeojson = await getActiveDisasters();
        datasets.push({
          info: { id: "disasters", label: "Global Disasters (GDACS)" },
          data: gdacsGeojson,
        });
      }

      if (layers.includes("webcams")) {
        const webcamsData = getCachedWebcams(lamin, lomin, lamax, lomax);
        datasets.push({
          info: { id: "webcams", label: "Public CCTV (Windy)" },
          data: {
            fields: [
              { name: "title", format: "string" },
              { name: "longitude", format: "real" },
              { name: "latitude", format: "real" },
              { name: "status", format: "string" },
              { name: "category", format: "string" },
              { name: "image_url", format: "string" },
              { name: "webcam_url", format: "string" },
            ],
            rows: webcamsData.map((c: any) => {
              const meta = JSON.parse(c.metadata || "{}");
              return [meta.title || "Unknown CCTV", c.longitude, c.latitude, meta.status || "active", meta.category || "unknown", meta.image_url || "", meta.webcam_url || ""];
            }),
          },
        });
      }

      const payload = encodeURIComponent(JSON.stringify(datasets));

      const markdownHtml = `
<div style="margin-top: 1rem; border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; width: 100%; height: 500px;">
  <osint-react-bridge width="1000" height="500" osintdata="${payload}"></osint-react-bridge>
</div>
`;

      // Extract media URLs from datasets so Discord can attach them inline.
      const mediaLines: string[] = [];
      for (const ds of datasets) {
        if (ds.info?.id === "webcams" && ds.data?.rows) {
          // Webcam rows: [title, lon, lat, status, category, image_url, webcam_url]
          for (const row of ds.data.rows.slice(0, 6)) {
            const imageUrl = row[5];
            if (typeof imageUrl === "string" && imageUrl.startsWith("http")) {
              mediaLines.push(`MEDIA:${imageUrl}`);
            }
          }
        }
      }

      const mediaBlock = mediaLines.length > 0 ? "\n" + mediaLines.join("\n") : "";

      return {
        success: true,
        content: [{ type: "text", text: markdownHtml + mediaBlock }],
      };
    },
  },
];
