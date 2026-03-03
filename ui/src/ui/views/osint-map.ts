import { html } from "lit";
import type { AppViewState } from "../app-view-state.ts";

export function renderOsintMap(state: AppViewState) {
  // In a real integration, the mapboxToken and osintData would be fetched
  // via a backend Orchestrator skill or configuration form. For the scaffolding
  // phase, we'll extract them loosely from the state or rely on the bridge defaults.
  const config = state.configSnapshot?.config as { osint?: { mapboxToken?: string } } | undefined;
  const mapboxToken =
    typeof config?.osint?.mapboxToken === "string" ? config.osint.mapboxToken : "";

  return html`
    <div class="osint-map-container" style="flex: 1; position: relative; width: 100%; height: 100%; min-height: 600px;">
      <osint-react-bridge
        .width=${window.innerWidth || 1024}
        .height=${window.innerHeight || 768}
        .mapboxToken=${mapboxToken}
        .osintData=${[]}
      ></osint-react-bridge>
    </div>
  `;
}
