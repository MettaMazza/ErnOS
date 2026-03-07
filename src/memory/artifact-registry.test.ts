import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Create a stable temp directory BEFORE mocking, so STATE_DIR resolves at import time.
const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-reg-suite-"));

vi.mock("../config/paths.js", () => ({
  STATE_DIR: TEST_STATE_DIR,
}));

// Import after mock
const { ArtifactRegistry } = await import("./artifact-registry.js");

describe("ArtifactRegistry", () => {
  let subDir: string;

  beforeEach(() => {
    // Use a fresh subdir within TEST_STATE_DIR for each test to avoid cross-contamination
    subDir = path.join(TEST_STATE_DIR, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(subDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up just the subdir's registry file to keep tests isolated
    const registryFile = path.join(TEST_STATE_DIR, "memory", "core", "artifact_registry.json");
    if (fs.existsSync(registryFile)) {
      fs.unlinkSync(registryFile);
    }
  });

  function makeRegistry() {
    return new ArtifactRegistry();
  }

  // ── computeHash ──────────────────────────────────────────────────────

  it("computeHash returns consistent SHA-256 for the same content", () => {
    const reg = makeRegistry();
    const content = "Hello, ErnOS!";
    const h1 = reg.computeHash(content);
    const h2 = reg.computeHash(content);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computeHash returns different hashes for different content", () => {
    const reg = makeRegistry();
    const h1 = reg.computeHash("content-a");
    const h2 = reg.computeHash("content-b");
    expect(h1).not.toBe(h2);
  });

  it("computeHash matches Node crypto SHA-256", () => {
    const reg = makeRegistry();
    const content = Buffer.from("test payload");
    const expected = createHash("sha256").update(content).digest("hex");
    expect(reg.computeHash(content)).toBe(expected);
  });

  // ── registerArtifact ─────────────────────────────────────────────────

  it("registerArtifact stores a record and returns the hash", () => {
    const reg = makeRegistry();
    const hash = reg.registerArtifact("image-bytes", { type: "image", prompt: "a flower" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("registerArtifact is idempotent — same content yields same hash, no duplicate", () => {
    const reg = makeRegistry();
    const h1 = reg.registerArtifact("same-content", { type: "image" });
    const h2 = reg.registerArtifact("same-content", { type: "image" });
    expect(h1).toBe(h2);
  });

  it("registerArtifact adds timestamp automatically", () => {
    const reg = makeRegistry();
    const before = Date.now();
    reg.registerArtifact("ts-test", { type: "code" });
    const after = Date.now();

    const record = reg.verifyArtifact("ts-test");
    expect(record).not.toBeNull();
    expect(record!.timestamp).toBeGreaterThanOrEqual(before);
    expect(record!.timestamp).toBeLessThanOrEqual(after);
  });

  // ── verifyArtifact ───────────────────────────────────────────────────

  it("verifyArtifact returns record for known artifact", () => {
    const reg = makeRegistry();
    reg.registerArtifact("known-content", {
      type: "image",
      prompt: "a sunset",
      path: "/tmp/sunset.png",
    });

    const record = reg.verifyArtifact("known-content");
    expect(record).not.toBeNull();
    expect(record!.type).toBe("image");
    expect(record!.prompt).toBe("a sunset");
    expect(record!.path).toBe("/tmp/sunset.png");
  });

  it("verifyArtifact returns null for unknown content", () => {
    const reg = makeRegistry();
    reg.registerArtifact("real-content", { type: "image" });
    const result = reg.verifyArtifact("completely-different-content");
    expect(result).toBeNull();
  });

  // ── Persistence ──────────────────────────────────────────────────────

  it("persists registry to JSON and reloads across instances", () => {
    const reg1 = makeRegistry();
    reg1.registerArtifact("persistent-thing", { type: "document", prompt: "test doc" });

    // New instance reads from same path
    const reg2 = makeRegistry();
    const record = reg2.verifyArtifact("persistent-thing");
    expect(record).not.toBeNull();
    expect(record!.type).toBe("document");
    expect(record!.prompt).toBe("test doc");
  });

  it("handles corrupt JSON file gracefully", () => {
    const reg = makeRegistry();
    reg.registerArtifact("precrash", { type: "image" });

    // Corrupt the registry file
    const registryPath = path.join(TEST_STATE_DIR, "memory", "core", "artifact_registry.json");
    fs.writeFileSync(registryPath, "NOT VALID JSON{{{", "utf-8");

    // New instance should not crash — starts fresh
    const reg2 = makeRegistry();
    const record = reg2.verifyArtifact("precrash");
    expect(record).toBeNull(); // Lost because of corruption
  });

  it("auto-creates parent directories when saving", () => {
    // Remove the memory dir if it exists
    const memDir = path.join(TEST_STATE_DIR, "memory");
    if (fs.existsSync(memDir)) {
      fs.rmSync(memDir, { recursive: true, force: true });
    }

    const reg = makeRegistry();
    reg.registerArtifact("dir-test", { type: "code" });

    const registryPath = path.join(TEST_STATE_DIR, "memory", "core", "artifact_registry.json");
    expect(fs.existsSync(registryPath)).toBe(true);
  });
});
