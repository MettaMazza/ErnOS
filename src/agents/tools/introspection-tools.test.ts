import { describe, expect, it, vi } from "vitest";

// Mock artifact registry used by introspection tools
vi.mock("../../memory/artifact-registry.js", () => ({
  artifactRegistry: { verifyArtifact: vi.fn() },
}));

const { createIntrospectionTools } = await import("./introspection-tools.js");

describe("Introspection Tools", () => {
  const tools = createIntrospectionTools();

  it("returns an array of tool definitions", () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(3);
  });

  it("all tools have name, description, and parameters", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });

  it("includes read_file tool", () => {
    const readFile = tools.find((t) => t.name === "read_file");
    expect(readFile).toBeDefined();
    expect(readFile!.description).toContain("Read");
  });

  it("includes list_files tool", () => {
    const listFiles = tools.find((t) => t.name === "list_files");
    expect(listFiles).toBeDefined();
  });

  it("includes search_codebase tool", () => {
    const searchTool = tools.find((t) => t.name === "search_codebase");
    expect(searchTool).toBeDefined();
  });

  it("tool names are unique", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
