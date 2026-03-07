import {
  createRemoteEmbeddingProvider,
  type RemoteEmbeddingClient,
} from "./embeddings-remote-provider.js";
import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";
import { buildRemoteBaseUrlPolicy } from "./remote-http.js";

export type OllamaEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

function normalizeOllamaModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_OLLAMA_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("ollama/")) {
    return trimmed.slice("ollama/".length);
  }
  return trimmed;
}

export async function createOllamaEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: OllamaEmbeddingClient }> {
  const remote = options.remote;
  const baseUrl = remote?.baseUrl?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const apiKey = remote?.apiKey?.trim() || "ollama";
  const model = normalizeOllamaModel(options.model);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...remote?.headers,
  };

  const client: RemoteEmbeddingClient = {
    baseUrl,
    headers,
    ssrfPolicy: buildRemoteBaseUrlPolicy(baseUrl),
    model,
  };

  return {
    provider: createRemoteEmbeddingProvider({
      id: "ollama",
      client,
      errorPrefix: "ollama embeddings failed",
    }),
    client: { baseUrl, headers, model },
  };
}
