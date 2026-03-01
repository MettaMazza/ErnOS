import { describe, it, expect } from "vitest";
import { MinecraftAdapter } from "./minecraft-adapter.js";

describe("MinecraftAdapter", () => {
  it("has the correct name", () => {
    const adapter = new MinecraftAdapter();
    expect(adapter.name).toBe("minecraft");
  });

  it("is not connected by default", () => {
    const adapter = new MinecraftAdapter();
    expect(adapter.isConnected()).toBe(false);
  });

  it("registers perception handlers", () => {
    const adapter = new MinecraftAdapter();
    const events: unknown[] = [];
    adapter.onPerception((event) => events.push(event));
    // No events fired yet — just verifying registration doesn't throw
    expect(events).toHaveLength(0);
  });

  it("returns empty world state when not connected", async () => {
    const adapter = new MinecraftAdapter();
    const state = await adapter.getWorldState();
    expect(state).toEqual({});
  });

  it("returns error for actions when not connected", async () => {
    const adapter = new MinecraftAdapter();
    const result = await adapter.executeAction({ action: "chat", params: { message: "hello" } });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Not connected");
  });

  it("returns error for unknown actions when not connected", async () => {
    const adapter = new MinecraftAdapter();
    const result = await adapter.executeAction({ action: "fly", params: {} });
    expect(result.success).toBe(false);
  });

  it("accepts custom config", () => {
    const adapter = new MinecraftAdapter({
      host: "my-server.com",
      port: 25565,
      username: "TestBot",
    });
    expect(adapter.name).toBe("minecraft");
    // Config is private, but construction shouldn't throw
  });
});
