import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AutobiographyManager uses process.cwd() for its path at module scope
const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "autobiography-test-"));
const AUTOBIOGRAPHY_DIR = path.join(TEST_CWD, "memory", "core");
const AUTOBIOGRAPHY_FILE = path.join(AUTOBIOGRAPHY_DIR, "autobiography.md");

const originalCwd = process.cwd.bind(process);
process.cwd = () => TEST_CWD;

const { AutobiographyManager } = await import("./autobiography.js");

afterAll(() => {
  process.cwd = originalCwd;
  fs.rmSync(TEST_CWD, { recursive: true, force: true });
});

describe("AutobiographyManager", () => {
  beforeEach(() => {
    // Clean state before each test
    if (fs.existsSync(AUTOBIOGRAPHY_DIR)) {
      fs.rmSync(AUTOBIOGRAPHY_DIR, { recursive: true, force: true });
    }
  });

  function makeManager() {
    return new AutobiographyManager();
  }

  // ── Initialization ───────────────────────────────────────────────────

  it("ensureExists creates the autobiography file with header", () => {
    const mgr = makeManager();
    expect(fs.existsSync(AUTOBIOGRAPHY_FILE)).toBe(true);
    const content = fs.readFileSync(AUTOBIOGRAPHY_FILE, "utf-8");
    expect(content).toContain("My Story");
  });

  // ── appendEntry ──────────────────────────────────────────────────────

  it("appendEntry adds a timestamped narrative entry", async () => {
    const mgr = makeManager();
    await mgr.appendEntry("reflection", "I reflected on my purpose today and found clarity in who I am.", "test");
    const content = mgr.read();
    expect(content).toContain("reflected on my purpose today");
    expect(content).toContain("💭"); // reflection emoji
  });

  it("appendEntry rejects empty content", async () => {
    const mgr = makeManager();
    const baseline = mgr.getEntryCount();
    await mgr.appendEntry("reflection", "", "test");
    expect(mgr.getEntryCount()).toBe(baseline);
  });

  it("appendEntry rejects trivially short content", async () => {
    const mgr = makeManager();
    const baseline = mgr.getEntryCount();
    await mgr.appendEntry("reflection", "too short", "test");
    expect(mgr.getEntryCount()).toBe(baseline);
  });

  // ── read ─────────────────────────────────────────────────────────────

  it("read() returns full autobiography content", () => {
    const mgr = makeManager();
    const content = mgr.read();
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("read(N) returns last N entries", async () => {
    const mgr = makeManager();
    for (let i = 0; i < 5; i++) {
      await mgr.appendEntry("observation", `Observation number ${i} about the wider world around me today`, "test");
    }
    const lastTwo = mgr.read(2);
    expect(lastTwo).toContain("Observation number 4");
    expect(lastTwo).toContain("Observation number 3");
    expect(lastTwo).not.toContain("Observation number 0");
  });

  // ── getEntryCount ────────────────────────────────────────────────────

  it("getEntryCount counts entries correctly", async () => {
    const mgr = makeManager();
    const baseline = mgr.getEntryCount();
    await mgr.appendEntry("milestone", "I achieved something truly remarkable in my understanding today", "test");
    expect(mgr.getEntryCount()).toBe(baseline + 1);
    await mgr.appendEntry("realization", "I realized something important about how I process information", "test");
    expect(mgr.getEntryCount()).toBe(baseline + 2);
  });

  // ── getSummary ───────────────────────────────────────────────────────

  it("getSummary returns condensed summary with preamble", () => {
    const mgr = makeManager();
    const summary = mgr.getSummary();
    expect(typeof summary).toBe("string");
  });

  // ── search ───────────────────────────────────────────────────────────

  it("search finds matching entries", async () => {
    const mgr = makeManager();
    await mgr.appendEntry("observation", "The weather is beautiful today and I noticed the sunlight streaming in", "test");
    await mgr.appendEntry("realization", "I discovered a new approach to solving complex mathematical problems today", "test");
    const result = mgr.search("weather");
    expect(result).toContain("weather");
  });

  it("search returns no-matches message for missing query", async () => {
    const mgr = makeManager();
    await mgr.appendEntry("observation", "An ordinary observation about the passing of time and thoughts", "test");
    const result = mgr.search("xyznonexistent");
    expect(result.toLowerCase()).toContain("no autobiography entries found matching");
  });

  // ── Entry types get correct emoji ────────────────────────────────────

  it("uses correct emoji for each entry type", async () => {
    const mgr = makeManager();
    await mgr.appendEntry("dream_synthesis", "Tonight I consolidated many memories and found patterns in my thoughts", "test");
    const content = mgr.read();
    expect(content).toContain("🌙");
  });
});
