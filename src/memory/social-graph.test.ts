import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SocialGraphManager uses process.cwd() for DATA_DIR at module scope.
// We override process.cwd BEFORE importing so it picks up the temp dir.
const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "social-graph-test-"));
const DATA_DIR = path.join(TEST_CWD, "memory", "system");
const GRAPH_FILE = path.join(DATA_DIR, "social_graph.json");

const originalCwd = process.cwd.bind(process);
process.cwd = () => TEST_CWD;

const { SocialGraphManager } = await import("./social-graph.js");

// Restore original cwd after module loaded
afterAll(() => {
  process.cwd = originalCwd;
  fs.rmSync(TEST_CWD, { recursive: true, force: true });
});

describe("SocialGraphManager", () => {
  beforeEach(() => {
    // Ensure clean state per test
    if (fs.existsSync(GRAPH_FILE)) {fs.unlinkSync(GRAPH_FILE);}
  });

  function makeManager() {
    return new SocialGraphManager();
  }

  it("starts with empty graph", () => {
    const mgr = makeManager();
    const summary = mgr.getGraphSummary();
    expect(summary).toContain("0 users");
    expect(summary).toContain("0 connections");
  });

  it("recordMention creates nodes and an edge", () => {
    const mgr = makeManager();
    mgr.recordMention("alice", "bob", "channel-1", "hey bob");
    const summary = mgr.getGraphSummary();
    expect(summary).toContain("2 users");
    expect(summary).toContain("1 connections");
  });

  it("recordMention increments mention count", () => {
    const mgr = makeManager();
    mgr.recordMention("alice", "bob", "ch-1");
    mgr.recordMention("alice", "bob", "ch-1");
    mgr.recordMention("alice", "bob", "ch-1");
    const connections = mgr.getConnections("alice");
    expect(connections[0].mentionCount).toBe(3);
  });

  it("recordCoOccurrence creates a group", () => {
    const mgr = makeManager();
    mgr.recordCoOccurrence(["alice", "bob", "charlie"], "channel-2");
    const summary = mgr.getGraphSummary();
    expect(summary).toContain("1 groups");
  });

  it("getConnections returns sorted by mention frequency", () => {
    const mgr = makeManager();
    mgr.recordMention("alice", "bob", "ch-1");
    mgr.recordMention("alice", "charlie", "ch-1");
    mgr.recordMention("alice", "charlie", "ch-1");
    mgr.recordMention("alice", "charlie", "ch-1");
    const connections = mgr.getConnections("alice");
    expect(connections[0].userId).toBe("charlie");
    expect(connections[1].userId).toBe("bob");
  });

  it("getSharedGroups finds channels where both users are active", () => {
    const mgr = makeManager();
    mgr.recordCoOccurrence(["alice", "bob"], "shared-channel");
    mgr.recordCoOccurrence(["alice", "charlie"], "other-channel");
    const shared = mgr.getSharedGroups("alice", "bob");
    expect(shared).toContain("shared-channel");
    expect(shared).not.toContain("other-channel");
  });

  it("persists and reloads across instances", () => {
    const m1 = makeManager();
    m1.recordMention("alice", "bob", "ch-1");
    m1.recordCoOccurrence(["alice", "bob"], "ch-1");

    const m2 = makeManager();
    expect(m2.getGraphSummary()).toContain("2 users");
    expect(m2.getGraphSummary()).toContain("1 connections");
    expect(m2.getGraphSummary()).toContain("1 groups");
  });

  it("getGraphSummary returns formatted string", () => {
    const mgr = makeManager();
    mgr.recordMention("u1", "u2", "ch");
    const summary = mgr.getGraphSummary();
    expect(summary).toMatch(/Social Graph: \d+ users, \d+ connections, \d+ groups/);
  });
});
