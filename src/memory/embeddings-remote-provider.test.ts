import { describe, expect, it, vi } from "vitest";
import { fetchRemoteEmbeddingVectors } from "./embeddings-remote-fetch.js";

// Mock the remote fetch function
vi.mock("./embeddings-remote-fetch.js", () => ({
  fetchRemoteEmbeddingVectors: vi.fn(async ({ body }: { body: { input: string[] } }) => {
    return body.input.map(() => [0.1, 0.2, 0.3]);
  }),
}));

// Mock SSRF policy builder
vi.mock("../infra/net/ssrf.js", () => ({
  buildSsrfPolicy: vi.fn(),
}));

// Mock remote client resolution
vi.mock("./embeddings-remote-client.js", () => ({
  resolveRemoteEmbeddingBearerClient: vi.fn(async () => ({
    baseUrl: "http://localhost:1234",
    headers: { Authorization: "Bearer test" },
    ssrfPolicy: undefined,
  })),
}));

const { createRemoteEmbeddingProvider } = await import("./embeddings-remote-provider.js");

describe("createRemoteEmbeddingProvider", () => {
  it("creates a provider with correct id", () => {
    const provider = createRemoteEmbeddingProvider({
      id: "test-provider",
      client: {
        baseUrl: "http://localhost:11434/v1",
        headers: { "Content-Type": "application/json" },
        model: "test-model",
      },
      errorPrefix: "test error",
    });
    expect(provider.id).toBe("test-provider");
    expect(provider.model).toBe("test-model");
  });

  it("embedQuery returns a vector", async () => {
    const provider = createRemoteEmbeddingProvider({
      id: "test",
      client: {
        baseUrl: "http://localhost/v1",
        headers: {},
        model: "embed-model",
      },
      errorPrefix: "test",
    });
    const vector = await provider.embedQuery("hello");
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
  });

  it("embedBatch returns multiple vectors", async () => {
    const provider = createRemoteEmbeddingProvider({
      id: "test",
      client: {
        baseUrl: "http://localhost/v1",
        headers: {},
        model: "embed-model",
      },
      errorPrefix: "test",
    });
    const vectors = await provider.embedBatch(["hello", "world"]);
    expect(vectors).toHaveLength(2);
  });

  it("embedBatch returns empty array for empty input", async () => {
    const provider = createRemoteEmbeddingProvider({
      id: "test",
      client: {
        baseUrl: "http://localhost/v1",
        headers: {},
        model: "embed-model",
      },
      errorPrefix: "test",
    });
    const vectors = await provider.embedBatch([]);
    expect(vectors).toEqual([]);
  });

  it("appends /embeddings to base URL", async () => {
    vi.mocked(fetchRemoteEmbeddingVectors).mockClear();
    const provider = createRemoteEmbeddingProvider({
      id: "test-url",
      client: {
        baseUrl: "http://localhost:1234/v1/",
        headers: {},
        model: "m",
      },
      errorPrefix: "test",
    });
    await provider.embedQuery("hello");
    const mockFetch = vi.mocked(fetchRemoteEmbeddingVectors);
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
    expect(lastCall.url).toBe("http://localhost:1234/v1/embeddings");
  });
});
