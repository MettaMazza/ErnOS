import { randomUUID } from "node:crypto";
import type {
  AssistantMessage,
  StopReason,
  TextContent,
  ToolCall,
  Tool,
  Usage,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream, registerApiProvider } from "@mariozechner/pi-ai";
import type { ApiStreamFunction } from "@mariozechner/pi-ai/dist/api-registry.js";
import { fetch as undiciFetch, Agent } from "undici";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("ollama-stream");

export const OLLAMA_NATIVE_BASE_URL = "http://127.0.0.1:11434";

// ── Ollama /api/chat request types ──────────────────────────────────────────

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  tools?: OllamaTool[];
  options?: Record<string, unknown>;
  /**
   * How long to keep the model in memory after the last request.
   * -1 = keep loaded forever (eliminates cold-start latency).
   * 0 = unload immediately after response.
   * Default (if omitted): 5 minutes.
   */
  keep_alive?: number | string;
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

const MAX_SAFE_INTEGER_ABS_STR = String(Number.MAX_SAFE_INTEGER);

function isAsciiDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function parseJsonNumberToken(
  input: string,
  start: number,
): { token: string; end: number; isInteger: boolean } | null {
  let idx = start;
  if (input[idx] === "-") {
    idx += 1;
  }
  if (idx >= input.length) {
    return null;
  }

  if (input[idx] === "0") {
    idx += 1;
  } else if (isAsciiDigit(input[idx]) && input[idx] !== "0") {
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  } else {
    return null;
  }

  let isInteger = true;
  if (input[idx] === ".") {
    isInteger = false;
    idx += 1;
    if (!isAsciiDigit(input[idx])) {
      return null;
    }
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  }

  if (input[idx] === "e" || input[idx] === "E") {
    isInteger = false;
    idx += 1;
    if (input[idx] === "+" || input[idx] === "-") {
      idx += 1;
    }
    if (!isAsciiDigit(input[idx])) {
      return null;
    }
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  }

  return {
    token: input.slice(start, idx),
    end: idx,
    isInteger,
  };
}

function isUnsafeIntegerLiteral(token: string): boolean {
  const digits = token[0] === "-" ? token.slice(1) : token;
  if (digits.length < MAX_SAFE_INTEGER_ABS_STR.length) {
    return false;
  }
  if (digits.length > MAX_SAFE_INTEGER_ABS_STR.length) {
    return true;
  }
  return digits > MAX_SAFE_INTEGER_ABS_STR;
}

function quoteUnsafeIntegerLiterals(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let idx = 0;

  while (idx < input.length) {
    const ch = input[idx] ?? "";
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      idx += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      idx += 1;
      continue;
    }

    if (ch === "-" || isAsciiDigit(ch)) {
      const parsed = parseJsonNumberToken(input, idx);
      if (parsed) {
        if (parsed.isInteger && isUnsafeIntegerLiteral(parsed.token)) {
          out += `"${parsed.token}"`;
        } else {
          out += parsed.token;
        }
        idx = parsed.end;
        continue;
      }
    }

    out += ch;
    idx += 1;
  }

  return out;
}

function parseJsonPreservingUnsafeIntegers(input: string): unknown {
  return JSON.parse(quoteUnsafeIntegerLiterals(input)) as unknown;
}

// ── Ollama /api/chat response types ─────────────────────────────────────────

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
    reasoning?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

// ── Message conversion ──────────────────────────────────────────────────────

type InputContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType?: string }
  | { type: "image_url"; image_url: string | { url: string } }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function extractOllamaImages(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const images: string[] = [];
  for (const part of content) {
    if (part.type === "image" && typeof part.data === "string") {
      // Native ErnOS format: { type: "image", data: "base64..." }
      images.push(part.data);
    } else if (part.type === "image_url") {
      // OpenAI SDK format: { type: "image_url", image_url: { url: "data:image/...;base64,..." } }
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (typeof url === "string") {
        if (url.startsWith("data:")) {
          const base64 = url.split(",")[1];
          if (base64) {
            images.push(base64);
          }
        } else {
          // For remote URLs, pass the URL itself — Ollama can handle some URLs
          images.push(url);
        }
      }
    }
  }
  return images;
}

function extractToolCalls(content: unknown): OllamaToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const parts = content as InputContentPart[];
  const result: OllamaToolCall[] = [];
  for (const part of parts) {
    if (part.type === "toolCall") {
      result.push({ function: { name: part.name, arguments: part.arguments } });
    } else if (part.type === "tool_use") {
      result.push({ function: { name: part.name, arguments: part.input } });
    }
  }
  return result;
}

export function convertToOllamaMessages(
  messages: Array<{ role: string; content: unknown }>,
  system?: string,
): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    const { role } = msg;

    if (role === "user") {
      const text = extractTextContent(msg.content);
      const images = extractOllamaImages(msg.content);
      result.push({
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
      });
    } else if (role === "assistant") {
      const text = extractTextContent(msg.content);
      const toolCalls = extractToolCalls(msg.content);
      result.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (role === "tool" || role === "toolResult") {
      // SDK uses "toolResult" (camelCase) for tool result messages.
      // Ollama API expects "tool" role with tool_name per the native spec.
      const text = extractTextContent(msg.content);
      const toolName =
        typeof (msg as { toolName?: unknown }).toolName === "string"
          ? (msg as { toolName?: string }).toolName
          : undefined;
      result.push({
        role: "tool",
        content: text,
        ...(toolName ? { tool_name: toolName } : {}),
      });
    }
  }

  return result;
}

// ── Tool extraction ─────────────────────────────────────────────────────────

function extractOllamaTools(tools: Tool[] | undefined): OllamaTool[] {
  if (!tools || !Array.isArray(tools)) {
    return [];
  }
  const result: OllamaTool[] = [];
  for (const tool of tools) {
    if (typeof tool.name !== "string" || !tool.name) {
      continue;
    }
    result.push({
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: (tool.parameters ?? {}) as Record<string, unknown>,
      },
    });
  }
  return result;
}

// ── Response conversion ─────────────────────────────────────────────────────

export function buildAssistantMessage(
  response: OllamaChatResponse,
  modelInfo: { api: string; provider: string; id: string },
): AssistantMessage {
  const content: (TextContent | ToolCall)[] = [];

  // Qwen 3 (and potentially other reasoning models) may return their final
  // answer in a `reasoning` field with an empty `content`. Fall back to
  // `reasoning` so the response isn't silently dropped.
  const text = response.message.content || response.message.reasoning || "";
  if (text) {
    content.push({ type: "text", text });
  }

  const toolCalls = response.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      content.push({
        type: "toolCall",
        id: `ollama_call_${randomUUID()}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      });
    }
  }

  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const stopReason: StopReason = hasToolCalls ? "toolUse" : "stop";

  const usage: Usage = {
    input: response.prompt_eval_count ?? 0,
    output: response.eval_count ?? 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  return {
    role: "assistant",
    content,
    stopReason,
    api: modelInfo.api,
    provider: modelInfo.provider,
    model: modelInfo.id,
    usage,
    timestamp: Date.now(),
  };
}

// ── NDJSON streaming parser ─────────────────────────────────────────────────

export async function* parseNdjsonStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<OllamaChatResponse> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        yield parseJsonPreservingUnsafeIntegers(trimmed) as OllamaChatResponse;
      } catch {
        log.warn(`Skipping malformed NDJSON line: ${trimmed.slice(0, 120)}`);
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield parseJsonPreservingUnsafeIntegers(buffer.trim()) as OllamaChatResponse;
    } catch {
      log.warn(`Skipping malformed trailing data: ${buffer.trim().slice(0, 120)}`);
    }
  }
}

// ── Main StreamFn factory ───────────────────────────────────────────────────

function resolveOllamaChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const normalizedBase = trimmed.replace(/\/v1$/i, "");
  const apiBase = normalizedBase || OLLAMA_NATIVE_BASE_URL;
  return `${apiBase}/api/chat`;
}

export function createOllamaStreamFn(baseUrl: string): ApiStreamFunction {
  const chatUrl = resolveOllamaChatUrl(baseUrl);

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const ollamaMessages = convertToOllamaMessages(
          context.messages ?? [],
          context.systemPrompt,
        );

        const ollamaTools = extractOllamaTools(context.tools);

        // Ollama defaults to num_ctx=4096 which is too small for large
        // system prompts + many tool definitions.  Use the model's native
        // contextWindow so we get the full capacity the hardware can handle.
        const ollamaOptions: Record<string, unknown> = {
          num_ctx: model.contextWindow ?? 32_768,
        };
        if (typeof options?.temperature === "number") {
          ollamaOptions.temperature = options.temperature;
        }
        if (typeof options?.maxTokens === "number") {
          ollamaOptions.num_predict = options.maxTokens;
        }

        const body: OllamaChatRequest = {
          model: model.id,
          messages: ollamaMessages,
          stream: true,
          ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
          options: ollamaOptions,
          // Keep model loaded in VRAM permanently — eliminates cold-start latency.
          // Without this, Ollama unloads after 5 min of inactivity.
          keep_alive: -1,
        };

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...options?.headers,
        };
        if (options?.apiKey) {
          headers.Authorization = `Bearer ${options.apiKey}`;
        }

        const agent = new Agent({
          headersTimeout: 15 * 60 * 1000,
          connectTimeout: 60 * 1000,
          keepAliveTimeout: 15 * 60 * 1000,
        });
        const jsonBody = JSON.stringify(body);
        log.info(
          `[ollama-stream] fetch → ${chatUrl} | body=${jsonBody.length} bytes | num_ctx=${String(ollamaOptions.num_ctx)} | model=${model.id} | contextWindow=${String(model.contextWindow)}`,
        );

        const response = await undiciFetch(chatUrl, {
          method: "POST",
          headers,
          body: jsonBody,
          signal: options?.signal,
          dispatcher: agent,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "unknown error");
          throw new Error(`Ollama API error ${response.status}: ${errorText}`);
        }

        if (!response.body) {
          throw new Error("Ollama API returned empty response body");
        }

        const reader = response.body.getReader();
        let accumulatedContent = "";
        const accumulatedToolCalls: OllamaToolCall[] = [];
        let finalResponse: OllamaChatResponse | undefined;

        for await (const chunk of parseNdjsonStream(reader)) {
          if (chunk.message?.content) {
            accumulatedContent += chunk.message.content;
          } else if (chunk.message?.reasoning) {
            // Qwen 3 reasoning mode: content may be empty, output in reasoning
            accumulatedContent += chunk.message.reasoning;
          }

          // Ollama sends tool_calls in intermediate (done:false) chunks,
          // NOT in the final done:true chunk. Collect from all chunks.
          if (chunk.message?.tool_calls) {
            accumulatedToolCalls.push(...chunk.message.tool_calls);
          }

          if (chunk.done) {
            finalResponse = chunk;
            break;
          }
        }

        if (!finalResponse) {
          throw new Error("Ollama API stream ended without a final response");
        }

        finalResponse.message.content = accumulatedContent;
        if (accumulatedToolCalls.length > 0) {
          finalResponse.message.tool_calls = accumulatedToolCalls;
        }

        const assistantMessage = buildAssistantMessage(finalResponse, {
          api: model.api,
          provider: model.provider,
          id: model.id,
        });

        const reason: Extract<StopReason, "stop" | "length" | "toolUse"> =
          assistantMessage.stopReason === "toolUse" ? "toolUse" : "stop";

        stream.push({
          type: "done",
          reason,
          message: assistantMessage,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant" as const,
            content: [],
            stopReason: "error" as StopReason,
            errorMessage,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            timestamp: Date.now(),
          },
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}

let registeredOllamaBaseUrl: string | undefined;

export function registerOllamaProvider(baseUrl: string) {
  if (registeredOllamaBaseUrl === baseUrl) {
    return;
  }

  const streamFn = createOllamaStreamFn(baseUrl);

  registerApiProvider(
    {
      api: "ollama" as never,
      stream: streamFn,
      streamSimple: streamFn,
    },
    "ernos-ollama",
  );

  registeredOllamaBaseUrl = baseUrl;
}
