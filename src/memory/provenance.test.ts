import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock the ProvenanceManager (the underlying HMAC ledger) so we can
// test ProvenanceLedger's logic in isolation.
vi.mock("../security/provenance.js", () => {
  const records: Array<{
    timestamp: string;
    filePath: string;
    filename: string;
    type: string;
    checksum: string;
    metadata: Record<string, unknown>;
  }> = [];

  return {
    ProvenanceManager: {
      lookupByFile: vi.fn((fp: string) => {
        return records.find((r) => r.filePath === fp) ?? null;
      }),
      lookupByChecksum: vi.fn((cs: string) => {
        return records.find((r) => r.checksum === cs) ?? null;
      }),
      search: vi.fn((query: string) => {
        const q = query.toLowerCase();
        return records.filter(
          (r) =>
            r.filename.toLowerCase().includes(q) ||
            JSON.stringify(r.metadata?.prompt ?? "").toLowerCase().includes(q),
        );
      }),
      signFile: vi.fn((fp: string) => {
        const existing = records.find((r) => r.filePath === fp);
        return existing ? existing.checksum : "tampered-checksum";
      }),
      verifyFile: vi.fn((fp: string, expectedChecksum: string) => {
        const existing = records.find((r) => r.filePath === fp);
        return existing ? existing.checksum === expectedChecksum : false;
      }),
      isTracked: vi.fn((cs: string) => records.some((r) => r.checksum === cs)),
      // Test helper to add records
      _testAddRecord: (record: (typeof records)[0]) => {
        records.push(record);
      },
      _testClear: () => {
        records.length = 0;
      },
    },
  };
});

const { ProvenanceLedger } = await import("./provenance.js");
const { ProvenanceManager } = (await import("../security/provenance.js")) as any;

describe("ProvenanceLedger", () => {
  let tmpDir: string;
  let ledger: InstanceType<typeof ProvenanceLedger>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-test-"));
    ledger = new ProvenanceLedger();
    ProvenanceManager._testClear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── getCreationContext ───────────────────────────────────────────────

  it("returns creation context for a tracked file on disk", async () => {
    const filePath = path.join(tmpDir, "sunset.png");
    fs.writeFileSync(filePath, "fake-image-data");

    ProvenanceManager._testAddRecord({
      timestamp: "2025-01-01T00:00:00Z",
      filePath,
      filename: "sunset.png",
      type: "image",
      checksum: "abc123",
      metadata: { prompt: "a beautiful sunset", user_id: "maria" },
    });

    const result = JSON.parse(await ledger.getCreationContext(filePath));
    expect(result.found).toBe(true);
    expect(result.type).toBe("image");
    expect(result.sourcePrompt).toBe("a beautiful sunset");
    expect(result.userId).toBe("maria");
  });

  it("returns creation context when looking up by checksum", async () => {
    const checksum = "a".repeat(64);
    ProvenanceManager._testAddRecord({
      timestamp: "2025-01-01T00:00:00Z",
      filePath: "/tmp/doc.md",
      filename: "doc.md",
      type: "document",
      checksum,
      metadata: { prompt: "write a doc" },
    });

    const result = JSON.parse(await ledger.getCreationContext(checksum));
    expect(result.found).toBe(true);
    expect(result.type).toBe("document");
  });

  it("searches by filename when path doesn't exist and isn't a checksum", async () => {
    ProvenanceManager._testAddRecord({
      timestamp: "2025-06-15T12:00:00Z",
      filePath: "/old/path/portrait.png",
      filename: "portrait.png",
      type: "image",
      checksum: "def456",
      metadata: { prompt: "self portrait" },
    });

    const result = JSON.parse(await ledger.getCreationContext("portrait"));
    expect(result.found).toBe(true);
    expect(result.filename).toBe("portrait.png");
  });

  it("returns found: false for unknown entity", async () => {
    const result = JSON.parse(await ledger.getCreationContext("totally-unknown"));
    expect(result.found).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("handles empty entityId gracefully", async () => {
    const result = JSON.parse(await ledger.getCreationContext("  "));
    expect(result.error).toBe("Empty entityId");
  });

  // ── verifyChainOfCustody ─────────────────────────────────────────────

  it("returns true for an untampered tracked file", () => {
    const filePath = path.join(tmpDir, "verified.png");
    fs.writeFileSync(filePath, "original-data");

    ProvenanceManager._testAddRecord({
      timestamp: "2025-01-01T00:00:00Z",
      filePath,
      filename: "verified.png",
      type: "image",
      checksum: "original-checksum",
      metadata: {},
    });

    // signFile returns "original-checksum" because we matched by filePath
    // lookupByChecksum finds it in ledger
    vi.mocked(ProvenanceManager.signFile).mockReturnValueOnce("original-checksum");
    vi.mocked(ProvenanceManager.lookupByChecksum).mockReturnValueOnce({ checksum: "original-checksum" });

    expect(ledger.verifyChainOfCustody(filePath)).toBe(true);
  });

  it("returns false for an untracked file", () => {
    const filePath = path.join(tmpDir, "untracked.txt");
    fs.writeFileSync(filePath, "some random file");

    vi.mocked(ProvenanceManager.signFile).mockReturnValueOnce("unknown-cs");
    vi.mocked(ProvenanceManager.lookupByChecksum).mockReturnValueOnce(null);

    expect(ledger.verifyChainOfCustody(filePath)).toBe(false);
  });

  it("returns false for empty entityId", () => {
    expect(ledger.verifyChainOfCustody("  ")).toBe(false);
  });
});
