import { afterEach, describe, expect, it, vi } from "vitest";
import * as authModule from "../agents/model-auth.js";

// Mock the auth module similar to embeddings.test.ts
vi.mock("../agents/model-auth.js", async () => {
  const { createModelAuthMockModule } = await import("../test-utils/model-auth-mock.js");
  return createModelAuthMockModule();
});

// Mock node-llama since embeddings.ts may reference it
vi.mock("./node-llama.js", () => ({
  importNodeLlamaCpp: vi.fn().mockRejectedValue(new Error("not available")),
}));

function createFetchMock() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
      }),
  });
}

function ollamaOptions(overrides: Record<string, unknown> = {}) {
  return {
    provider: "ollama" as const,
    config: {},
    model: "",
    fallback: "none" as const,
    ...overrides,
  };
}

describe("Ollama embedding provider", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an Ollama provider when explicitly requested", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const result = await createEmbeddingProvider(ollamaOptions());

    expect(result.provider).not.toBeNull();
    expect(result.provider!.id).toBe("ollama");
  });

  it("uses localhost:11434/v1 as default base URL", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const result = await createEmbeddingProvider(ollamaOptions());

    await result.provider!.embedQuery("test");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("localhost:11434");
  });

  it("defaults to nomic-embed-text model", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const result = await createEmbeddingProvider(ollamaOptions());

    await result.provider!.embedQuery("test");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toContain("nomic-embed-text");
  });

  it("embedQuery returns an embedding vector", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const result = await createEmbeddingProvider(ollamaOptions());

    const vector = await result.provider!.embedQuery("hello world");
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
  });

  it("embedBatch returns multiple vectors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { embedding: [0.1, 0.2] },
            { embedding: [0.3, 0.4] },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const result = await createEmbeddingProvider(ollamaOptions());

    const vectors = await result.provider!.embedBatch(["hello", "world"]);
    expect(vectors).toHaveLength(2);
  });
});
