import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Create a stable temp directory before mocking
const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "emotional-test-suite-"));

vi.mock("../config/paths.js", () => ({
  STATE_DIR: TEST_STATE_DIR,
}));

const { EmotionalTracker, _resetEmotionalTracker } = await import("./emotional.js");

describe("EmotionalTracker", () => {
  beforeEach(() => {
    _resetEmotionalTracker();
    // Clean up any persisted state files
    const stateFile = path.join(TEST_STATE_DIR, "memory", "core", "emotional_state.json");
    const historyFile = path.join(TEST_STATE_DIR, "memory", "core", "emotional_history.jsonl");
    if (fs.existsSync(stateFile)) {fs.unlinkSync(stateFile);}
    if (fs.existsSync(historyFile)) {fs.unlinkSync(historyFile);}
  });

  function makeTracker() {
    return new EmotionalTracker();
  }

  // ── Initialization ───────────────────────────────────────────────────

  it("starts with default slightly-positive PAD state", () => {
    const tracker = makeTracker();
    const state = tracker.getState();
    expect(state.pleasure).toBeCloseTo(0.3, 1);
    expect(state.arousal).toBeCloseTo(0.2, 1);
    expect(state.dominance).toBeCloseTo(0.2, 1);
    expect(state.trigger).toBe("initialization");
  });

  // ── updateFromEmotion ────────────────────────────────────────────────

  it("updateFromEmotion shifts state toward the emotion's PAD vector", () => {
    const tracker = makeTracker();
    tracker.updateFromEmotion("excited", 1.0);
    const state = tracker.getState();
    // excited = [0.8, 0.8, 0.5], should shift significantly toward these values
    expect(state.pleasure).toBeGreaterThan(0.3);
    expect(state.arousal).toBeGreaterThan(0.2);
    expect(state.trigger).toBe("excited");
  });

  it("updateFromEmotion ignores unknown emotion keywords", () => {
    const tracker = makeTracker();
    const before = tracker.getState();
    tracker.updateFromEmotion("nonexistent-emotion");
    const after = tracker.getState();
    expect(after.pleasure).toBe(before.pleasure);
    expect(after.arousal).toBe(before.arousal);
  });

  it("updateFromEmotion clamps PAD values to [-1, 1]", () => {
    const tracker = makeTracker();
    // Hit it 10 times with high-intensity excitement
    for (let i = 0; i < 10; i++) {
      tracker.updateFromEmotion("excited", 1.0);
    }
    const state = tracker.getState();
    expect(state.pleasure).toBeLessThanOrEqual(1.0);
    expect(state.arousal).toBeLessThanOrEqual(1.0);
    expect(state.dominance).toBeLessThanOrEqual(1.0);
  });

  // ── updateFromInteraction ────────────────────────────────────────────

  it("updateFromInteraction with positive sentiment increases pleasure", () => {
    const tracker = makeTracker();
    const before = tracker.getState();
    tracker.updateFromInteraction("positive", 0.8);
    const after = tracker.getState();
    expect(after.pleasure).toBeGreaterThan(before.pleasure);
  });

  it("updateFromInteraction with negative sentiment maps to thoughtful", () => {
    const tracker = makeTracker();
    tracker.updateFromInteraction("negative", 1.0);
    const state = tracker.getState();
    expect(state.trigger).toBe("thoughtful");
  });

  // ── getCurrentEmotion ────────────────────────────────────────────────

  it("getCurrentEmotion returns the closest emotion word", () => {
    const tracker = makeTracker();
    const emotion = tracker.getCurrentEmotion();
    expect(typeof emotion).toBe("string");
    expect(emotion.length).toBeGreaterThan(0);
  });

  // ── decayState ───────────────────────────────────────────────────────

  it("decayState reduces PAD values toward zero", () => {
    const tracker = makeTracker();
    tracker.updateFromEmotion("excited", 1.0);
    const before = tracker.getState();
    tracker.decayState(0.5);
    const after = tracker.getState();
    expect(Math.abs(after.pleasure)).toBeLessThan(Math.abs(before.pleasure));
    expect(Math.abs(after.arousal)).toBeLessThan(Math.abs(before.arousal));
  });

  // ── getFormattedState ────────────────────────────────────────────────

  it("getFormattedState returns a multi-line bar chart string", () => {
    const tracker = makeTracker();
    const formatted = tracker.getFormattedState();
    expect(formatted).toContain("**Mood**:");
    expect(formatted).toContain("Pleasure:");
    expect(formatted).toContain("Arousal:");
    expect(formatted).toContain("Dominance:");
  });

  // ── getState ─────────────────────────────────────────────────────────

  it("getState returns a copy, not a reference", () => {
    const tracker = makeTracker();
    const s1 = tracker.getState();
    const s2 = tracker.getState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2); // Different objects
  });

  // ── Persistence ──────────────────────────────────────────────────────

  it("persists state and history across instances", () => {
    const t1 = makeTracker();
    t1.updateFromEmotion("joyful", 0.8);
    const afterJoy = t1.getState();

    // Reset singleton and create new instance — should reload from disk
    _resetEmotionalTracker();
    const t2 = makeTracker();
    const reloaded = t2.getState();
    expect(reloaded.pleasure).toBeCloseTo(afterJoy.pleasure, 2);
    expect(reloaded.arousal).toBeCloseTo(afterJoy.arousal, 2);
  });
});
