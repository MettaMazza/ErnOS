import { describe, expect, it, vi } from "vitest";

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

// Mock quarantine
vi.mock("./quarantine.js", () => ({
  ValidationQuarantine: vi.fn().mockImplementation(() => ({})),
}));

const { addNode, addRelationship, queryContext } = await import("./graph-crud.js");

describe("graph-crud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ records: [] });
  });

  // ── addNode ──────────────────────────────────────────────────────────

  it("addNode returns immediately when driver is null", async () => {
    await addNode(null, null, "Entity", "Test");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("addNode executes MERGE query with correct name", async () => {
    const fakeDriver = { session: () => mockSession } as any;
    await addNode(fakeDriver, null, "Entity", "TestNode");
    expect(mockRun).toHaveBeenCalled();
    const query = mockRun.mock.calls[0][0];
    expect(query).toContain("TestNode");
    expect(query).toContain("MERGE");
  });

  it("addNode escapes single quotes in node names", async () => {
    const fakeDriver = { session: () => mockSession } as any;
    await addNode(fakeDriver, null, "Entity", "O'Brien");
    const query = mockRun.mock.calls[0][0];
    expect(query).toContain("O\\'Brien");
  });

  // ── addRelationship ──────────────────────────────────────────────────

  it("addRelationship returns immediately when driver is null", async () => {
    await addRelationship(null, null, "A", "KNOWS", "B");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("addRelationship creates proper relationship query", async () => {
    const fakeDriver = { session: () => mockSession } as any;
    await addRelationship(fakeDriver, null, "Alice", "KNOWS", "Bob");
    const query = mockRun.mock.calls[0][0];
    expect(query).toContain("Alice");
    expect(query).toContain("Bob");
    expect(query).toContain("KNOWS");
  });

  // ── queryContext ─────────────────────────────────────────────────────

  it("queryContext returns empty array when driver is null", async () => {
    const result = await queryContext(null, "Test");
    expect(result).toEqual([]);
  });

  it("queryContext returns formatted relationships", async () => {
    mockRun.mockResolvedValue({
      records: [
        {
          get: vi.fn((idx: number) =>
            ["Alice", "KNOWS", "Bob", "narrative", "narrative"][idx]),
        },
      ],
    });
    const fakeDriver = { session: () => mockSession } as any;
    const result = await queryContext(fakeDriver, "Alice");
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Alice");
    expect(result[0]).toContain("KNOWS");
    expect(result[0]).toContain("Bob");
  });
});

import { beforeEach } from "vitest";
