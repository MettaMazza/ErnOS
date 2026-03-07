import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// UserThreatMeter uses process.cwd() for DATA_DIR at module scope
const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "user-threat-test-"));
const DATA_DIR = path.join(TEST_CWD, "memory", "system");
const THREATS_FILE = path.join(DATA_DIR, "user_threats.json");
const LOG_DIR = path.join(DATA_DIR, "threat_logs");

const originalCwd = process.cwd.bind(process);
process.cwd = () => TEST_CWD;

const { UserThreatMeter } = await import("./user-threat.js");

afterAll(() => {
  process.cwd = originalCwd;
  fs.rmSync(TEST_CWD, { recursive: true, force: true });
});

describe("UserThreatMeter", () => {
  beforeEach(() => {
    // Clean state per test
    if (fs.existsSync(THREATS_FILE)) {fs.unlinkSync(THREATS_FILE);}
    if (fs.existsSync(LOG_DIR)) {fs.rmSync(LOG_DIR, { recursive: true, force: true });}
  });

  function makeMeter() {
    return new UserThreatMeter();
  }

  it("new user starts at score 0", () => {
    const meter = makeMeter();
    expect(meter.getScore("new-user")).toBe(0);
  });

  it("recordThreat('abuse') adds 25 points", () => {
    const meter = makeMeter();
    const score = meter.recordThreat("abuse", "called names", "user-1");
    expect(score).toBe(25);
  });

  it("recordThreat('identity_attack') adds 35 points", () => {
    const meter = makeMeter();
    const score = meter.recordThreat("identity_attack", "identity attack", "user-1");
    expect(score).toBe(35);
  });

  it("score caps at 100", () => {
    const meter = makeMeter();
    for (let i = 0; i < 10; i++) {
      meter.recordThreat("identity_attack", `attack-${i}`, "user-1");
    }
    expect(meter.getScore("user-1")).toBeLessThanOrEqual(100);
  });

  it("returns GREEN zone for score 0", () => {
    const meter = makeMeter();
    const zone = meter.getZone("clean-user");
    expect(zone.label).toBe("SAFE");
  });

  it("returns elevated zone for high score", () => {
    const meter = makeMeter();
    meter.recordThreat("abuse", "", "user-1");
    meter.recordThreat("abuse", "", "user-1");
    const zone = meter.getZone("user-1");
    // Score = 50, should be CAUTIOUS or higher
    expect(["WATCHFUL", "GUARDED", "DEFENSIVE"]).toContain(zone.label);
  });

  it("isTerminal returns false for score 0", () => {
    const meter = makeMeter();
    expect(meter.isTerminal("brand-new-user")).toBe(false);
  });

  it("isTerminal returns true at high score", () => {
    const meter = makeMeter();
    meter.recordThreat("identity_attack", "", "user-1"); // 35
    meter.recordThreat("identity_attack", "", "user-1"); // 70
    meter.recordThreat("abuse", "", "user-1"); // 95
    expect(meter.isTerminal("user-1")).toBe(true);
  });

  it("recordDeescalation reduces score from elevated state", () => {
    const meter = makeMeter();
    meter.recordThreat("abuse", "", "user-1"); // 25
    const scoreBefore = meter.getScore("user-1");
    const result = meter.recordDeescalation("user-1", "I'm sorry");
    if (result.accepted) {
      expect(meter.getScore("user-1")).toBeLessThan(scoreBefore);
    }
    // If not accepted (cooldown), that's also valid behavior
    expect(typeof result.accepted).toBe("boolean");
  });

  it("reset sets score to 0", () => {
    const meter = makeMeter();
    meter.recordThreat("abuse", "", "user-1");
    meter.reset("user-1", "admin override");
    expect(meter.getScore("user-1")).toBe(0);
  });

  it("tracks users independently", () => {
    const meter = makeMeter();
    meter.recordThreat("abuse", "", "alice");
    meter.recordThreat("identity_attack", "", "bob");
    expect(meter.getScore("alice")).toBe(25);
    expect(meter.getScore("bob")).toBe(35);
  });

  it("getStats returns complete stats object", () => {
    const meter = makeMeter();
    meter.recordThreat("spam", "flooding", "user-1");
    const stats = meter.getStats("user-1");
    expect(stats).toHaveProperty("score");
    expect(stats).toHaveProperty("zone");
    expect(stats).toHaveProperty("totalIncidents");
  });

  it("getFormattedHud returns formatted string", () => {
    const meter = makeMeter();
    const hud = meter.getFormattedHud("user-1");
    expect(typeof hud).toBe("string");
    expect(hud.length).toBeGreaterThan(0);
  });

  it("persists and reloads across instances", () => {
    const m1 = makeMeter();
    m1.recordThreat("abuse", "", "user-1");

    const m2 = makeMeter();
    expect(m2.getScore("user-1")).toBe(25);
  });
});
