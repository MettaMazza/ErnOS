// Defaults for agent metadata when upstream does not supply them.
// Model id defaults to local Ollama with Qwen 3.5.
export const DEFAULT_PROVIDER = "ollama";
export const DEFAULT_MODEL = "qwen3.5:35b";
// Match qwen3.5:35b's native 128k context window.
// The previous 200k value inflated Ollama's KV cache to 262k tokens, stalling inference.
export const DEFAULT_CONTEXT_TOKENS = 128_000;
