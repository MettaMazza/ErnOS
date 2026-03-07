import { describe, expect, it, vi } from "vitest";

// Mock the intentions module
vi.mock("../../memory/intentions.js", () => ({
  intentionTracker: {
    getRecentIntentions: vi.fn((limit: number) => {
      if (limit <= 0) {return [];}
      return [
        { timestamp: 1700000000000, thought: "I want to learn about music" },
        { timestamp: 1700000001000, thought: "I should review my knowledge graph" },
      ].slice(0, limit);
    }),
  },
}));

const { createIntentionTools } = await import("./intentions-tools-def.js");

describe("Intention Tools", () => {
  const tools = createIntentionTools();

  it("returns at least 1 tool definition", () => {
    expect(tools.length).toBeGreaterThanOrEqual(1);
  });

  it("recall_intentions has correct structure", () => {
    const tool = tools.find((t) => t.name === "recall_intentions")!;
    expect(tool.name).toBe("recall_intentions");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
  });

  it("recall_intentions returns formatted intentions", async () => {
    const tool = tools.find((t) => t.name === "recall_intentions")!;
    const result = await tool.execute({ limit: 10 });
    expect(result).toContain("music");
    expect(result).toContain("Intent:");
  });
});
