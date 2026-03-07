import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Create stable temp dir before mocking
const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "intentions-test-suite-"));

vi.mock("../config/paths.js", () => ({
  STATE_DIR: TEST_STATE_DIR,
}));

const { IntentionTracker } = await import("./intentions.js");

describe("IntentionTracker", () => {
  const persistPath = path.join(TEST_STATE_DIR, "memory", "core", "intentions.jsonl");

  beforeEach(() => {
    if (fs.existsSync(persistPath)) {fs.unlinkSync(persistPath);}
  });

  function makeTracker() {
    return new IntentionTracker();
  }

  it("starts with no intentions when file doesn't exist", () => {
    const tracker = makeTracker();
    expect(tracker.getRecentIntentions()).toEqual([]);
  });

  it("recordIntention appends an entry to the JSONL file", () => {
    const tracker = makeTracker();
    tracker.recordIntention("I want to learn about music");
    const recent = tracker.getRecentIntentions();
    expect(recent).toHaveLength(1);
    expect(recent[0].thought).toBe("I want to learn about music");
    expect(recent[0].timestamp).toBeGreaterThan(0);
  });

  it("recordIntention creates parent directory automatically", () => {
    const dir = path.dirname(persistPath);
    if (fs.existsSync(dir)) {fs.rmSync(dir, { recursive: true, force: true });}

    const tracker = makeTracker();
    tracker.recordIntention("test");
    expect(fs.existsSync(persistPath)).toBe(true);
  });

  it("getRecentIntentions returns last N entries", () => {
    const tracker = makeTracker();
    for (let i = 0; i < 5; i++) {
      tracker.recordIntention(`thought-${i}`);
    }
    const recent = tracker.getRecentIntentions(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].thought).toBe("thought-2");
    expect(recent[2].thought).toBe("thought-4");
  });

  it("persists and reloads across instances", () => {
    const t1 = makeTracker();
    t1.recordIntention("first thought");
    t1.recordIntention("second thought");

    const t2 = makeTracker();
    const recent = t2.getRecentIntentions();
    expect(recent).toHaveLength(2);
    expect(recent[0].thought).toBe("first thought");
    expect(recent[1].thought).toBe("second thought");
  });

  it("handles corrupt file gracefully", () => {
    fs.mkdirSync(path.dirname(persistPath), { recursive: true });
    fs.writeFileSync(persistPath, "NOT JSON\nALSO NOT JSON\n", "utf-8");

    const tracker = makeTracker();
    // Should not crash — returns empty or skips bad lines
    const recent = tracker.getRecentIntentions();
    expect(Array.isArray(recent)).toBe(true);
  });
});
