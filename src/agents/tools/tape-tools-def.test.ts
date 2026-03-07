import { describe, expect, it, vi } from "vitest";

// Mock the tape-tools functions
vi.mock("./tape-tools.js", () => ({
  tapeSeek: vi.fn(async (_userId: string, args: any) =>
    `Tape head moved to (${args.x}, ${args.y}, ${args.z})`),
  tapeRead: vi.fn(async () => "Symbol: THOUGHT | Content: test thought"),
  tapeWrite: vi.fn(async (_userId: string, args: any) =>
    `Written: ${args.type} = ${args.content}`),
  tapeScan: vi.fn(async () => "Scan: 5 symbols in radius"),
  tapeFork: vi.fn(async (_userId: string, args: any) =>
    `Forked to Z=${args.destinationZ}`),
}));

const { createTapeTools } = await import("./tape-tools-def.js");

describe("Tape Tools", () => {
  const tools = createTapeTools("test-user");

  it("returns 5 tape tool definitions", () => {
    expect(tools).toHaveLength(5);
  });

  it("all tools have name, description, and schema", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.schema).toBeDefined();
    }
  });

  it("tape_seek moves head to coordinates", async () => {
    const seekTool = tools.find((t) => t.name === "tape_seek")!;
    const result = await seekTool.executor({ x: 5, y: 3, z: 0 });
    expect(result).toContain("5");
    expect(result).toContain("3");
    expect(result).toContain("0");
  });

  it("tape_read returns current symbol", async () => {
    const readTool = tools.find((t) => t.name === "tape_read")!;
    const result = await readTool.executor({});
    expect(result).toContain("THOUGHT");
  });

  it("tape_write writes a symbol", async () => {
    const writeTool = tools.find((t) => t.name === "tape_write")!;
    const result = await writeTool.executor({ type: "FACT", content: "2+2=4" });
    expect(result).toContain("FACT");
    expect(result).toContain("2+2=4");
  });

  it("tape_fork creates a new thread", async () => {
    const forkTool = tools.find((t) => t.name === "tape_fork")!;
    const result = await forkTool.executor({ destinationZ: 2 });
    expect(result).toContain("Z=2");
  });
});
