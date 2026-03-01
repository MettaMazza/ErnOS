import {
  expandToolGroups,
  normalizeToolList,
  normalizeToolName,
  resolveToolProfilePolicy,
  TOOL_GROUPS,
} from "./tool-policy-shared.js";
import type { AnyAgentTool } from "./tools/common.js";
export {
  expandToolGroups,
  normalizeToolList,
  normalizeToolName,
  resolveToolProfilePolicy,
  TOOL_GROUPS,
} from "./tool-policy-shared.js";
export type { ToolProfileId } from "./tool-policy-shared.js";

/**
 * Tools that are ALWAYS restricted to owner senders, regardless of config.
 * Non-owners get these completely removed from their tool list — the LLM never
 * sees them. This is the primary security boundary for multi-user deployments.
 *
 * Enforced by applyOwnerOnlyToolPolicy() which runs on EVERY tool resolution
 * path (guilds, DMs, inline actions, subagents).
 */
const OWNER_ONLY_TOOL_NAME_FALLBACKS = new Set<string>([
  // Shell / code execution — RCE surface
  "exec",
  "shell",
  "spawn",
  // Filesystem mutation — data destruction / exfiltration
  "fs_write",
  "fs_delete",
  "fs_move",
  "apply_patch",
  // Session orchestration — cross-session injection
  "sessions_spawn",
  "sessions_send",
  // Infrastructure control plane
  "cron",
  "gateway",
  "whatsapp_login",
  // Multi-agent orchestration — spawns worker agents
  "devteam",
]);

/**
 * Tools that non-owner users are DENIED access to.
 * These are genuinely dangerous — code execution, filesystem mutation,
 * infrastructure control, cross-session injection, agent spawning.
 *
 * Everything NOT on this list is available to all users.
 * Owners bypass this entirely and get full unrestricted access.
 */
const NON_OWNER_DENIED_TOOLS = new Set<string>([
  // Shell / code execution — RCE surface
  "exec",
  "shell",
  "spawn",
  // Filesystem mutation — data destruction / exfiltration
  "fs_write",
  "fs_delete",
  "fs_move",
  "apply_patch",
  // Session orchestration — cross-session injection
  "sessions_spawn",
  "sessions_send",
  // Infrastructure control plane
  "cron",
  "gateway",
  "whatsapp_login",
  // Multi-agent orchestration — spawns worker agents
  "devteam",
  "subagents",
  // Node / cluster management
  "nodes",
  // Skill creation — can generate executable code
  "skill_forge",
  // Outreach — sends messages to external channels/users
  "outreach",
]);

export function isOwnerOnlyToolName(name: string) {
  return OWNER_ONLY_TOOL_NAME_FALLBACKS.has(normalizeToolName(name));
}

function isOwnerOnlyTool(tool: AnyAgentTool) {
  return tool.ownerOnly === true || isOwnerOnlyToolName(tool.name);
}

function isDeniedForNonOwner(tool: AnyAgentTool) {
  return isOwnerOnlyTool(tool) || NON_OWNER_DENIED_TOOLS.has(normalizeToolName(tool.name));
}

export function applyOwnerOnlyToolPolicy(tools: AnyAgentTool[], senderIsOwner: boolean) {
  // Owners get full unrestricted access to all tools
  if (senderIsOwner) {
    return tools;
  }
  // Non-owners: strip dangerous tools, keep everything else
  return tools.filter((tool) => !isDeniedForNonOwner(tool));
}

export type ToolPolicyLike = {
  allow?: string[];
  deny?: string[];
};

export type PluginToolGroups = {
  all: string[];
  byPlugin: Map<string, string[]>;
};

export type AllowlistResolution = {
  policy: ToolPolicyLike | undefined;
  unknownAllowlist: string[];
  strippedAllowlist: boolean;
};

export function collectExplicitAllowlist(policies: Array<ToolPolicyLike | undefined>): string[] {
  const entries: string[] = [];
  for (const policy of policies) {
    if (!policy?.allow) {
      continue;
    }
    for (const value of policy.allow) {
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed) {
        entries.push(trimmed);
      }
    }
  }
  return entries;
}

export function buildPluginToolGroups<T extends { name: string }>(params: {
  tools: T[];
  toolMeta: (tool: T) => { pluginId: string } | undefined;
}): PluginToolGroups {
  const all: string[] = [];
  const byPlugin = new Map<string, string[]>();
  for (const tool of params.tools) {
    const meta = params.toolMeta(tool);
    if (!meta) {
      continue;
    }
    const name = normalizeToolName(tool.name);
    all.push(name);
    const pluginId = meta.pluginId.toLowerCase();
    const list = byPlugin.get(pluginId) ?? [];
    list.push(name);
    byPlugin.set(pluginId, list);
  }
  return { all, byPlugin };
}

export function expandPluginGroups(
  list: string[] | undefined,
  groups: PluginToolGroups,
): string[] | undefined {
  if (!list || list.length === 0) {
    return list;
  }
  const expanded: string[] = [];
  for (const entry of list) {
    const normalized = normalizeToolName(entry);
    if (normalized === "group:plugins") {
      if (groups.all.length > 0) {
        expanded.push(...groups.all);
      } else {
        expanded.push(normalized);
      }
      continue;
    }
    const tools = groups.byPlugin.get(normalized);
    if (tools && tools.length > 0) {
      expanded.push(...tools);
      continue;
    }
    expanded.push(normalized);
  }
  return Array.from(new Set(expanded));
}

export function expandPolicyWithPluginGroups(
  policy: ToolPolicyLike | undefined,
  groups: PluginToolGroups,
): ToolPolicyLike | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    allow: expandPluginGroups(policy.allow, groups),
    deny: expandPluginGroups(policy.deny, groups),
  };
}

export function stripPluginOnlyAllowlist(
  policy: ToolPolicyLike | undefined,
  groups: PluginToolGroups,
  coreTools: Set<string>,
): AllowlistResolution {
  if (!policy?.allow || policy.allow.length === 0) {
    return { policy, unknownAllowlist: [], strippedAllowlist: false };
  }
  const normalized = normalizeToolList(policy.allow);
  if (normalized.length === 0) {
    return { policy, unknownAllowlist: [], strippedAllowlist: false };
  }
  const pluginIds = new Set(groups.byPlugin.keys());
  const pluginTools = new Set(groups.all);
  const unknownAllowlist: string[] = [];
  let hasCoreEntry = false;
  for (const entry of normalized) {
    if (entry === "*") {
      hasCoreEntry = true;
      continue;
    }
    const isPluginEntry =
      entry === "group:plugins" || pluginIds.has(entry) || pluginTools.has(entry);
    const expanded = expandToolGroups([entry]);
    const isCoreEntry = expanded.some((tool) => coreTools.has(tool));
    if (isCoreEntry) {
      hasCoreEntry = true;
    }
    if (!isCoreEntry && !isPluginEntry) {
      unknownAllowlist.push(entry);
    }
  }
  const strippedAllowlist = !hasCoreEntry;
  // When an allowlist contains only plugin tools, we strip it to avoid accidentally
  // disabling core tools. Users who want additive behavior should prefer `tools.alsoAllow`.
  if (strippedAllowlist) {
    // Note: logging happens in the caller (pi-tools/tools-invoke) after this function returns.
    // We keep this note here for future maintainers.
  }
  return {
    policy: strippedAllowlist ? { ...policy, allow: undefined } : policy,
    unknownAllowlist: Array.from(new Set(unknownAllowlist)),
    strippedAllowlist,
  };
}

export function mergeAlsoAllowPolicy<TPolicy extends { allow?: string[] }>(
  policy: TPolicy | undefined,
  alsoAllow?: string[],
): TPolicy | undefined {
  if (!policy?.allow || !Array.isArray(alsoAllow) || alsoAllow.length === 0) {
    return policy;
  }
  return { ...policy, allow: Array.from(new Set([...policy.allow, ...alsoAllow])) };
}
