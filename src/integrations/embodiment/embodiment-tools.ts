/**
 * ErnOS Embodiment Tools — Agent tools for interacting with virtual environments.
 *
 * These tools are registered dynamically when an EmbodimentAdapter is connected.
 * They allow the ErnOS agent to act within the virtual world using the same
 * tool-calling interface used for web search, code editing, etc.
 */

import { embodimentBridge } from "./embodiment-bridge.js";
import type { ActionResult, WorldState } from "./embodiment-bridge.js";

// ─── Tool Definitions ───────────────────────────────────────────────────────────

export const EMBODIMENT_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "embodiment_act",
      description:
        "Execute an action in the virtual environment (e.g. Minecraft). " +
        "Actions include: goto, mine, craft, chat, attack, equip, place, look, follow, stop.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The action to perform (goto, mine, craft, chat, attack, equip, place, look, follow, stop)",
          },
          params: {
            type: "object",
            description: "Action-specific parameters (e.g. {x, y, z} for goto, {block: 'oak_log'} for mine)",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "embodiment_observe",
      description:
        "Get a snapshot of the current world state: position, health, inventory, " +
        "nearby entities and blocks, time, and biome.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "embodiment_navigate",
      description: "Navigate to specific coordinates in the virtual world.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number", description: "X coordinate" },
          y: { type: "number", description: "Y coordinate" },
          z: { type: "number", description: "Z coordinate" },
        },
        required: ["x", "y", "z"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "embodiment_inventory",
      description: "List all items in the agent's inventory with counts.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

// ─── Tool Handlers ──────────────────────────────────────────────────────────────

export async function handleEmbodimentAct(
  action: string,
  params?: Record<string, unknown>,
): Promise<ActionResult> {
  return embodimentBridge.act({ action, params: params || {} });
}

export async function handleEmbodimentObserve(): Promise<WorldState | string> {
  const state = await embodimentBridge.getWorldState();
  if (!state) {return "No environment connected.";}
  return state;
}

export async function handleEmbodimentNavigate(
  x: number,
  y: number,
  z: number,
): Promise<ActionResult> {
  return embodimentBridge.act({
    action: "goto",
    params: { x, y, z },
    priority: 1,
  });
}

export async function handleEmbodimentInventory(): Promise<
  Array<{ name: string; count: number }> | string
> {
  const state = await embodimentBridge.getWorldState();
  if (!state) {return "No environment connected.";}
  return state.inventory || [];
}

/**
 * Route a tool call to the appropriate embodiment handler.
 */
export async function routeEmbodimentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case "embodiment_act":
      return handleEmbodimentAct(
        args.action as string,
        args.params as Record<string, unknown> | undefined,
      );
    case "embodiment_observe":
      return handleEmbodimentObserve();
    case "embodiment_navigate":
      return handleEmbodimentNavigate(
        args.x as number,
        args.y as number,
        args.z as number,
      );
    case "embodiment_inventory":
      return handleEmbodimentInventory();
    default:
      return { error: `Unknown embodiment tool: ${toolName}` };
  }
}

/**
 * Check whether embodiment tools should be registered (adapter is connected).
 */
export function isEmbodimentActive(): boolean {
  const adapter = embodimentBridge.getAdapter();
  return adapter !== null && adapter.isConnected();
}
