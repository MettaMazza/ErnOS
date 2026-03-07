// Defaults for agent metadata when upstream does not supply them.
// Model id defaults to local Ollama with Qwen 3.5.
export const DEFAULT_PROVIDER = "ollama";
export const DEFAULT_MODEL = "qwen3.5:35b";
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 32_768;
