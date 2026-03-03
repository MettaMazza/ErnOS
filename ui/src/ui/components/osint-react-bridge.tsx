import { addDataToMap } from "@kepler.gl/actions";
import KeplerGl from "@kepler.gl/components";
import keplerGlReducer from "@kepler.gl/reducers";
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { Provider } from "react-redux";
import { createStore, combineReducers, applyMiddleware } from "redux";

// Create a Redux store specifically for the Kepler instance
const customizedKeplerGlReducer = keplerGlReducer.initialState({
  uiState: {
    readOnly: false,
    currentModal: null,
  },
});

const store = createStore(
  combineReducers({
    keplerGl: customizedKeplerGlReducer,
  }),
  {},
  applyMiddleware(), // Add any custom map middlewares here if needed
);

// The actual React Component we want to mount
const OsintMapApp = ({ width, height, mapboxApiAccessToken, mapData }: Record<string, unknown>) => {
  // Dispatch data when mapData props change
  React.useEffect(() => {
    if (mapData && mapData.length > 0) {
      store.dispatch(
        addDataToMap({
          datasets: mapData,
          option: {
            centerMap: true,
            readOnly: false,
          },
          config: {},
        }),
      );
    }
  }, [mapData]);

  return (
    <Provider store={store}>
      <KeplerGl
        id="ernos-osint-map"
        width={width}
        height={height}
        mapboxApiAccessToken={mapboxApiAccessToken}
        appName="ErnOS OSINT Engine"
        version="1.0"
      />
    </Provider>
  );
};

@customElement("osint-react-bridge")
export class OsintReactBridge extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }
    #react-root {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
    }
  `;

  @property({ type: Number }) width = 800;
  @property({ type: Number }) height = 600;
  @property({ type: String }) mapboxToken = "";
  @property({ type: Array }) osintData = [];

  private reactRoot: Root | null = null;
  private container: HTMLElement | null = null;

  override firstUpdated() {
    this.container = this.shadowRoot?.getElementById("react-root") as HTMLElement;
    if (this.container) {
      this.reactRoot = createRoot(this.container);
      this.renderReactTree();
    }
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (
      changedProperties.has("width") ||
      changedProperties.has("height") ||
      changedProperties.has("osintData")
    ) {
      this.renderReactTree();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  }

  private renderReactTree() {
    if (this.reactRoot && this.container) {
      // Because Lit uses Shadow DOM, Kepler's Styled-Components sometimes break
      // if they inject styles into <head> instead of the shadowRoot.
      // Kepler actually expects to be in the main document.
      // We'll render here, but if styles break we may need to use a Light DOM technique.
      this.reactRoot.render(
        <OsintMapApp
          width={this.width}
          height={this.height}
          mapboxApiAccessToken={this.mapboxToken}
          mapData={this.osintData}
        />,
      );
    }
  }

  override render() {
    return html`
      <div id="react-root"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "osint-react-bridge": OsintReactBridge;
  }
}
