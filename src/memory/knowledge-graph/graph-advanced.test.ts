import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock neo4j-driver
const mockRun = vi.fn().mockResolvedValue({ records: [] });
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockSession = { run: mockRun, close: mockClose };

vi.mock("neo4j-driver", () => ({
  default: {
    driver: vi.fn(() => ({
      session: () => mockSession,
      close: vi.fn(),
    })),
    auth: { basic: vi.fn() },
  },
}));

const {
  strengthenConnection,
  decayConnections,
  getConnectionMap,
  pruneOrphanNodes,
  bulkSeed,
  queryCoreKnowledge,
  checkContradiction,
} = await import("./graph-advanced.js");

describe("graph-advanced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ records: [] });
  });

  // ── Null driver safety ───────────────────────────────────────────────

  it("strengthenConnection is no-op when driver is null", async () => {
    await strengthenConnection(null, "semantic", "episodic");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("decayConnections is no-op when driver is null", async () => {
    await decayConnections(null);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("getConnectionMap returns empty when driver is null", async () => {
    const result = await getConnectionMap(null);
    expect(result).toEqual({});
  });

  it("pruneOrphanNodes returns zeros when driver is null", async () => {
    const result = await pruneOrphanNodes(null);
    expect(result).toEqual({ pruned: 0, skipped: 0 });
  });

  it("queryCoreKnowledge returns empty array when driver is null", async () => {
    const result = await queryCoreKnowledge(null, "test");
    expect(result).toEqual([]);
  });

  it("checkContradiction returns null when driver is null", async () => {
    const result = await checkContradiction(null, "sub", "pred", "obj");
    expect(result).toBeNull();
  });

  // ── bulkSeed ─────────────────────────────────────────────────────────

  it("bulkSeed returns zeros for empty facts array", async () => {
    const fakeDriver = { session: () => mockSession } as any;
    const result = await bulkSeed(fakeDriver, []);
    expect(result.seeded).toBe(0);
  });

  it("bulkSeed processes facts in batches", async () => {
    const fakeDriver = { session: () => mockSession } as any;
    const facts = Array.from({ length: 10 }, (_, i) => ({
      subject: `Subj${i}`,
      object: `Obj${i}`,
      predicate: "KNOWS",
    }));
    const result = await bulkSeed(fakeDriver, facts, 5);
    expect(result.seeded + result.skipped + result.errors).toBe(10);
  });

  // ── strengthenConnection ─────────────────────────────────────────────

  it("strengthenConnection executes merge query", async () => {
    const fakeDriver = { session: () => mockSession } as any;
    await strengthenConnection(fakeDriver, "semantic", "episodic");
    expect(mockRun).toHaveBeenCalled();
  });
});
