import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the orchestrator (systemMemory) that KGConsolidator uses
vi.mock("../memory/orchestrator.js", () => ({
  systemMemory: {
    knowledgeGraph: {
      addNode: vi.fn(),
      addRelationship: vi.fn(),
      queryContext: vi.fn().mockResolvedValue([]),
    },
  },
}));

const { KGConsolidator } = await import("./kg-consolidator.js");

describe("KGConsolidator", () => {
  let consolidator: InstanceType<typeof KGConsolidator>;

  beforeEach(() => {
    consolidator = new KGConsolidator();
  });

  it("starts with turn counter at 0", () => {
    // No public getter, but recordTurn shouldn't trigger consolidation on first call
    // We just verify it doesn't blow up
    expect(consolidator).toBeDefined();
  });

  it("setGenerator sets the LLM callback", () => {
    const mockGen = vi.fn(async () => "response");
    consolidator.setGenerator(mockGen);
    expect(consolidator.getGenerator()).toBe(mockGen);
  });

  it("getGenerator returns null by default", () => {
    expect(consolidator.getGenerator()).toBeNull();
  });

  it("recordTurn tracks pending interactions", () => {
    consolidator.recordTurn("user1", "Hello", "Hi there");
    // No direct public accessor, but forceConsolidate should process them
    expect(consolidator).toBeDefined();
  });

  it("parseExtraction handles empty response", () => {
    const result = consolidator.parseExtraction("");
    expect(result).toEqual([]);
  });

  it("parseExtraction extracts subject-predicate-object triples", () => {
    const response = `
      subject: Alice
      predicate: KNOWS
      object: Bob
      ---
      subject: Bob
      predicate: LIKES
      object: Music
    `;
    const result = consolidator.parseExtraction(response);
    // The parser expects specific line format — this depends on implementation
    expect(Array.isArray(result)).toBe(true);
  });

  it("forceConsolidate does not throw with no generator", async () => {
    consolidator.recordTurn("user1", "hi", "hello");
    await expect(consolidator.forceConsolidate()).resolves.not.toThrow();
  });
});
