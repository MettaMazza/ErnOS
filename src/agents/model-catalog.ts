import { type ErnOSConfig, loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveErnOSAgentDir } from "./agent-paths.js";
import { ensureErnOSModelsJson } from "./models-config.js";

const log = createSubsystemLogger("model-catalog");

export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
};

type DiscoveredModel = {
  id: string;
  name?: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
};

type PiSdkModule = typeof import("./pi-model-discovery.js");

let modelCatalogPromise: Promise<ModelCatalogEntry[]> | null = null;
let hasLoggedModelCatalogError = false;
const defaultImportPiSdk = () => import("./pi-model-discovery.js");
let importPiSdk = defaultImportPiSdk;

const CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_GPT53_MODEL_ID = "gpt-5.3-codex";
const OPENAI_CODEX_GPT53_SPARK_MODEL_ID = "gpt-5.3-codex-spark";
const NON_PI_NATIVE_MODEL_PROVIDERS = new Set(["kilocode"]);

function applyOpenAICodexSparkFallback(models: ModelCatalogEntry[]): void {
  const hasSpark = models.some(
    (entry) =>
      entry.provider === CODEX_PROVIDER &&
      entry.id.toLowerCase() === OPENAI_CODEX_GPT53_SPARK_MODEL_ID,
  );
  if (hasSpark) {
    return;
  }

  const baseModel = models.find(
    (entry) =>
      entry.provider === CODEX_PROVIDER && entry.id.toLowerCase() === OPENAI_CODEX_GPT53_MODEL_ID,
  );
  if (!baseModel) {
    return;
  }

  models.push({
    ...baseModel,
    id: OPENAI_CODEX_GPT53_SPARK_MODEL_ID,
    name: OPENAI_CODEX_GPT53_SPARK_MODEL_ID,
  });
}

function normalizeConfiguredModelInput(input: unknown): Array<"text" | "image"> | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const normalized = input.filter(
    (item): item is "text" | "image" => item === "text" || item === "image",
  );
  return normalized.length > 0 ? normalized : undefined;
}

function readConfiguredOptInProviderModels(config: ErnOSConfig): ModelCatalogEntry[] {
  const providers = config.models?.providers;
  if (!providers || typeof providers !== "object") {
    return [];
  }

  const out: ModelCatalogEntry[] = [];
  for (const [providerRaw, providerValue] of Object.entries(providers)) {
    const provider = providerRaw.toLowerCase().trim();
    if (!NON_PI_NATIVE_MODEL_PROVIDERS.has(provider)) {
      continue;
    }
    if (!providerValue || typeof providerValue !== "object") {
      continue;
    }

    const configuredModels = (providerValue as { models?: unknown }).models;
    if (!Array.isArray(configuredModels)) {
      continue;
    }

    for (const configuredModel of configuredModels) {
      if (!configuredModel || typeof configuredModel !== "object") {
        continue;
      }
      const idRaw = (configuredModel as { id?: unknown }).id;
      if (typeof idRaw !== "string") {
        continue;
      }
      const id = idRaw.trim();
      if (!id) {
        continue;
      }
      const rawName = (configuredModel as { name?: unknown }).name;
      const name = (typeof rawName === "string" ? rawName : id).trim() || id;
      const contextWindowRaw = (configuredModel as { contextWindow?: unknown }).contextWindow;
      const contextWindow =
        typeof contextWindowRaw === "number" && contextWindowRaw > 0 ? contextWindowRaw : undefined;
      const reasoningRaw = (configuredModel as { reasoning?: unknown }).reasoning;
      const reasoning = typeof reasoningRaw === "boolean" ? reasoningRaw : undefined;
      const input = normalizeConfiguredModelInput((configuredModel as { input?: unknown }).input);
      out.push({ id, name, provider, contextWindow, reasoning, input });
    }
  }

  return out;
}

function mergeConfiguredOptInProviderModels(params: {
  config: ErnOSConfig;
  models: ModelCatalogEntry[];
}): void {
  const configured = readConfiguredOptInProviderModels(params.config);
  if (configured.length === 0) {
    return;
  }

  const seen = new Set(
    params.models.map(
      (entry) => `${entry.provider.toLowerCase().trim()}::${entry.id.toLowerCase().trim()}`,
    ),
  );

  for (const entry of configured) {
    const key = `${entry.provider.toLowerCase().trim()}::${entry.id.toLowerCase().trim()}`;
    if (seen.has(key)) {
      continue;
    }
    params.models.push(entry);
    seen.add(key);
  }
}

export function resetModelCatalogCacheForTest() {
  modelCatalogPromise = null;
  hasLoggedModelCatalogError = false;
  importPiSdk = defaultImportPiSdk;
}

// Test-only escape hatch: allow mocking the dynamic import to simulate transient failures.
export function __setModelCatalogImportForTest(loader?: () => Promise<PiSdkModule>) {
  importPiSdk = loader ?? defaultImportPiSdk;
}

export async function loadModelCatalog(params?: {
  config?: ErnOSConfig;
  useCache?: boolean;
}): Promise<ModelCatalogEntry[]> {
  if (params?.useCache === false) {
    modelCatalogPromise = null;
  }
  if (modelCatalogPromise) {
    return modelCatalogPromise;
  }

  modelCatalogPromise = (async () => {
    const models: ModelCatalogEntry[] = [];
    const sortModels = (entries: ModelCatalogEntry[]) =>
      entries.sort((a, b) => {
        const p = a.provider.localeCompare(b.provider);
        if (p !== 0) {
          return p;
        }
        return a.name.localeCompare(b.name);
      });
    try {
      const cfg = params?.config ?? loadConfig();
      await ensureErnOSModelsJson(cfg);
      // IMPORTANT: keep the dynamic import *inside* the try/catch.
      // If this fails once (e.g. during a pnpm install that temporarily swaps node_modules),
      // we must not poison the cache with a rejected promise (otherwise all channel handlers
      // will keep failing until restart).
      const piSdkModule = (await importPiSdk()) as {
        discoverAuthStorage?: (path: string) => unknown;
        discoverModels?: (authStorage: unknown, path: string) => unknown;
        ModelRegistry?: unknown;
        default?: Record<string, unknown>;
      };
      const discoverAuthStorage =
        piSdkModule.discoverAuthStorage ?? piSdkModule.default?.discoverAuthStorage;
      const discoverModelsFn = piSdkModule.discoverModels ?? piSdkModule.default?.discoverModels;
      const RegistryClass = piSdkModule.ModelRegistry ?? piSdkModule.default?.ModelRegistry;

      const agentDir = resolveErnOSAgentDir();
      const { join } = await import("node:path");

      const authStorage = (discoverAuthStorage as (dir: string) => unknown)(agentDir);

      let entries: Array<DiscoveredModel>;
      if (typeof discoverModelsFn === "function") {
        const registry = discoverModelsFn(authStorage, agentDir);
        entries =
          registry &&
          typeof (registry as { getAll?: () => Array<DiscoveredModel> }).getAll === "function"
            ? (registry as { getAll: () => Array<DiscoveredModel> }).getAll()
            : Array.isArray(registry)
              ? registry
              : [];
      } else {
        const registry = new (RegistryClass as {
          new (
            authStorage: unknown,
            modelsFile: string,
          ): Array<DiscoveredModel> | { getAll: () => Array<DiscoveredModel> };
        })(authStorage, join(agentDir, "models.json"));
        entries =
          registry &&
          typeof (registry as { getAll?: () => Array<DiscoveredModel> }).getAll === "function"
            ? (registry as { getAll: () => Array<DiscoveredModel> }).getAll()
            : Array.isArray(registry)
              ? registry
              : [];
      }

      for (const entry of entries) {
        const id = String(entry?.id ?? "").trim();
        if (!id) {
          continue;
        }
        const provider = String(entry?.provider ?? "").trim();
        if (!provider) {
          continue;
        }
        const name = String(entry?.name ?? id).trim() || id;
        const contextWindow =
          typeof entry?.contextWindow === "number" && entry.contextWindow > 0
            ? entry.contextWindow
            : undefined;
        const reasoning = typeof entry?.reasoning === "boolean" ? entry.reasoning : undefined;
        const input = Array.isArray(entry?.input) ? entry.input : undefined;
        models.push({ id, name, provider, contextWindow, reasoning, input });
      }
      mergeConfiguredOptInProviderModels({ config: cfg, models });
      applyOpenAICodexSparkFallback(models);

      if (models.length === 0) {
        // If we found nothing, don't cache this result so we can try again.
        modelCatalogPromise = null;
      }

      return sortModels(models);
    } catch (error) {
      if (!hasLoggedModelCatalogError) {
        hasLoggedModelCatalogError = true;
        log.warn(`Failed to load model catalog: ${String(error)}`);
      }
      // Don't poison the cache on transient dependency/filesystem issues.
      modelCatalogPromise = null;
      if (models.length > 0) {
        return sortModels(models);
      }
      return [];
    }
  })();

  return modelCatalogPromise;
}

/**
 * Known Ollama vision model family patterns.
 * Many Ollama vision models incorrectly report input: ["text"] through
 * the pi-ai library, even though they natively support image input.
 */
const KNOWN_VISION_MODEL_PATTERNS = [
  /^qwen.*3\.5/i,
  /^qwen2.*vl/i,
  /^llava/i,
  /^llama.*vision/i,
  /^gemma.*3/i,
  /^minicpm.*v/i,
  /^moondream/i,
  /^bakllava/i,
  /^cogvlm/i,
  /^deepseek.*vl/i,
  /^internvl/i,
  /^phi.*vision/i,
];

/**
 * Checks if a model ID matches a known vision model family.
 */
function isKnownVisionModel(modelId: string): boolean {
  const baseName = modelId.split(":")[0].toLowerCase();
  return KNOWN_VISION_MODEL_PATTERNS.some((pattern) => pattern.test(baseName));
}

/**
 * Check if a model supports image input based on its catalog entry.
 * Falls back to name-based detection for known vision model families
 * when the pi-ai library incorrectly reports text-only input.
 */
export function modelSupportsVision(entry: ModelCatalogEntry | undefined): boolean {
  if (!entry) {
    return false;
  }
  if (entry.input?.includes("image")) {
    return true;
  }
  // Many Ollama vision models (qwen3.5, llava, etc.) report input: ["text"]
  // even though they natively support image input.
  return isKnownVisionModel(entry.id);
}

/**
 * Find a model in the catalog by provider and model ID.
 */
export function findModelInCatalog(
  catalog: ModelCatalogEntry[],
  provider: string,
  modelId: string,
): ModelCatalogEntry | undefined {
  const normalizedProvider = provider.toLowerCase().trim();
  const normalizedModelId = modelId.toLowerCase().trim();
  return catalog.find(
    (entry) =>
      entry.provider.toLowerCase() === normalizedProvider &&
      entry.id.toLowerCase() === normalizedModelId,
  );
}
