import { describe, expect, it, vi } from "vitest";

// Mock heavy dependencies
vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    sessions: { mainSessionKey: "main" },
  })),
}));

vi.mock("../config/sessions.js", () => ({
  resolveMainSessionKey: vi.fn(() => "main-session"),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("./autonomy-log-buffer.js", () => ({
  pushThought: vi.fn(),
}));

// Mock goals and intentions (required by AutonomyDaemon)
vi.mock("../memory/goals.js", () => ({
  goals: { getActiveGoals: vi.fn(() => []) },
}));

vi.mock("../memory/intentions.js", () => ({
  intentionTracker: {
    recordIntention: vi.fn(),
    getRecentIntentions: vi.fn(() => []),
  },
}));

const { bootAutonomyDaemon, markUserActive, markAgentRunning, markAgentIdle } =
  await import("./autonomy-boot.js");

describe("autonomy-boot", () => {
  it("bootAutonomyDaemon returns a daemon instance", () => {
    const daemon = bootAutonomyDaemon({
      enqueueSystemEvent: vi.fn(),
      broadcast: vi.fn(),
    });
    expect(daemon).toBeDefined();
    expect(typeof daemon.running).toBe("boolean");
  });

  it("markUserActive does not throw", () => {
    expect(() => markUserActive()).not.toThrow();
  });

  it("markAgentRunning does not throw", () => {
    expect(() => markAgentRunning()).not.toThrow();
  });

  it("markAgentIdle does not throw", () => {
    expect(() => markAgentIdle()).not.toThrow();
  });
});
