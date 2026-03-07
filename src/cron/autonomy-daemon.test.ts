import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock heavy dependencies
vi.mock("../memory/goals.js", () => ({
  goals: {
    getActiveGoals: vi.fn(() => []),
  },
}));

vi.mock("../memory/intentions.js", () => ({
  intentionTracker: {
    recordIntention: vi.fn(),
    getRecentIntentions: vi.fn(() => []),
  },
}));

const { AutonomyDaemon } = await import("./autonomy-daemon.js");

describe("AutonomyDaemon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with default config", () => {
    const daemon = new AutonomyDaemon();
    expect(daemon.running).toBe(false);
    expect(daemon.log).toEqual([]); // getter, not function
  });

  it("accepts custom config overrides", () => {
    const daemon = new AutonomyDaemon({
      idleThresholdSeconds: 120,
      checkIntervalMs: 5000,
    });
    expect(daemon).toBeDefined();
    expect(daemon.running).toBe(false);
  });

  it("stop() is safe to call when not running", () => {
    const daemon = new AutonomyDaemon();
    expect(() => daemon.stop()).not.toThrow();
    expect(daemon.running).toBe(false);
  });

  it("log returns empty array when no cycles have run", () => {
    const daemon = new AutonomyDaemon();
    expect(daemon.log).toHaveLength(0); // getter
  });
});
