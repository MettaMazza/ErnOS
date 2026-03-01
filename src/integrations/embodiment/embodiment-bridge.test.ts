import { describe, it, expect, vi } from "vitest";
import {
  EmbodimentBridge,
  type EmbodimentAdapter,
  type PerceptionEvent,
  type ActionCommand,
  type ActionResult,
  type WorldState,
} from "./embodiment-bridge.js";

// ─── Mock Adapter ───────────────────────────────────────────────────────────────

function createMockAdapter(name = "test"): EmbodimentAdapter & {
  _handlers: Array<(event: PerceptionEvent) => void>;
  _simulatePerception: (event: PerceptionEvent) => void;
} {
  const handlers: Array<(event: PerceptionEvent) => void> = [];

  return {
    name,
    _handlers: handlers,
    _simulatePerception: (event: PerceptionEvent) => {
      for (const h of handlers) {h(event);}
    },

    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),

    onPerception: (handler) => {
      handlers.push(handler);
    },

    executeAction: vi.fn().mockImplementation(async (cmd: ActionCommand): Promise<ActionResult> => ({
      success: true,
      action: cmd.action,
      result: `Executed ${cmd.action}`,
    })),

    getWorldState: vi.fn().mockResolvedValue({
      position: { x: 10, y: 64, z: -20 },
      health: 20,
      food: 18,
      inventory: [{ name: "diamond_sword", count: 1 }],
    } satisfies WorldState),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("EmbodimentBridge", () => {
  it("attaches an adapter and calls connect", async () => {
    const bridge = new EmbodimentBridge();
    const adapter = createMockAdapter();
    await bridge.attachAdapter(adapter);

    expect(adapter.connect).toHaveBeenCalledOnce();
    expect(bridge.getAdapter()).toBe(adapter);
  });

  it("detaches an adapter and calls disconnect", async () => {
    const bridge = new EmbodimentBridge();
    const adapter = createMockAdapter();
    await bridge.attachAdapter(adapter);
    await bridge.detachAdapter();

    expect(adapter.disconnect).toHaveBeenCalledOnce();
    expect(bridge.getAdapter()).toBeNull();
  });

  it("routes perception events to message handler", async () => {
    const bridge = new EmbodimentBridge();
    const adapter = createMockAdapter("minecraft");

    const receivedMessages: string[] = [];
    bridge.setMessageHandler(async (_channelId, _senderId, message) => {
      receivedMessages.push(message);
    });

    await bridge.attachAdapter(adapter);

    adapter._simulatePerception({
      type: "chat",
      source: "Steve",
      detail: "Hello ErnOS!",
      timestamp: Date.now(),
      channel: "embodiment:minecraft",
    });

    // Wait for async handler
    await new Promise((r) => setTimeout(r, 50));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toContain("Steve");
    expect(receivedMessages[0]).toContain("Hello ErnOS!");
  });

  it("executes actions via the adapter", async () => {
    const bridge = new EmbodimentBridge();
    const adapter = createMockAdapter();
    await bridge.attachAdapter(adapter);

    const result = await bridge.act({ action: "goto", params: { x: 10, y: 64, z: -20 } });
    expect(result.success).toBe(true);
    expect(result.action).toBe("goto");
  });

  it("returns error when no adapter is connected", async () => {
    const bridge = new EmbodimentBridge();
    const result = await bridge.act({ action: "goto", params: { x: 0, y: 0, z: 0 } });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No adapter");
  });

  it("returns world state from the adapter", async () => {
    const bridge = new EmbodimentBridge();
    const adapter = createMockAdapter();
    await bridge.attachAdapter(adapter);

    const state = await bridge.getWorldState();
    expect(state).not.toBeNull();
    expect(state?.health).toBe(20);
    expect(state?.inventory).toHaveLength(1);
  });

  it("returns null world state when no adapter", async () => {
    const bridge = new EmbodimentBridge();
    const state = await bridge.getWorldState();
    expect(state).toBeNull();
  });

  it("formats different perception types correctly", async () => {
    const bridge = new EmbodimentBridge();
    const adapter = createMockAdapter("minecraft");

    const messages: string[] = [];
    bridge.setMessageHandler(async (_ch, _s, msg) => { messages.push(msg); });
    await bridge.attachAdapter(adapter);

    const types: Array<{ type: PerceptionEvent["type"]; keyword: string }> = [
      { type: "damage", keyword: "Damage" },
      { type: "death", keyword: "Death" },
      { type: "item_acquired", keyword: "Item" },
      { type: "block_break", keyword: "Block" },
      { type: "proximity", keyword: "Proximity" },
    ];

    for (const t of types) {
      adapter._simulatePerception({
        type: t.type,
        source: "test",
        detail: "test detail",
        timestamp: Date.now(),
        channel: "embodiment:minecraft",
      });
    }

    await new Promise((r) => setTimeout(r, 50));

    expect(messages).toHaveLength(types.length);
    for (let i = 0; i < types.length; i++) {
      expect(messages[i]).toContain(types[i].keyword);
    }
  });
});
