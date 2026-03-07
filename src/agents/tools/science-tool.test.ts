import { describe, expect, it, vi } from "vitest";

// Mock the science engine
vi.mock("../../science/science-engine.js", () => ({
  compute: vi.fn(async (opts: { mode: string; expression: string }) => {
    if (opts.mode === "evaluate") {
      return { success: true, mode: "evaluate", layer: "instant", result: "42" };
    }
    return { success: false, mode: opts.mode, error: "Not implemented in test mock" };
  }),
}));

const { createScienceTool } = await import("./science-tool.js");

describe("Science Tool", () => {
  const tool = createScienceTool();

  it("has correct name and description", () => {
    expect(tool.name).toBe("science_compute");
    expect(tool.description).toContain("scientific computation");
  });

  it("has parameters with mode and expression", () => {
    expect(tool.parameters).toBeDefined();
  });

  it("evaluate mode returns result", async () => {
    const result = await tool.execute("call-1", { mode: "evaluate", expression: "6*7" });
    expect(result.content[0].text).toContain("42");
    expect(result.content[0].text).toContain("evaluate");
  });

  it("failed computation returns error message", async () => {
    const result = await tool.execute("call-2", { mode: "solve", expression: "x^2-4" });
    expect(result.content[0].text).toContain("error");
  });
});
