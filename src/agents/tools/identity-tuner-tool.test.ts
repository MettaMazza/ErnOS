import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock process.env.HOME to temp dir for the identity tuner
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "identity-tuner-test-"));
const originalHome = process.env.HOME;
process.env.HOME = TEST_HOME;

// Mock artifact registry
vi.mock("../../memory/artifact-registry.js", () => ({
  artifactRegistry: { verifyArtifact: vi.fn() },
}));

const { createIdentityTunerTool, loadMutableIdentity } = await import("./identity-tuner-tool.js");

afterAll(() => {
  process.env.HOME = originalHome;
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("Identity Tuner Tool", () => {
  const MUTABLE_DIR = path.join(TEST_HOME, ".ernos");
  const MUTABLE_FILE = path.join(MUTABLE_DIR, "identity-mutable.md");

  beforeEach(() => {
    if (fs.existsSync(MUTABLE_FILE)) {fs.unlinkSync(MUTABLE_FILE);}
    const backupDir = path.join(MUTABLE_DIR, "identity-backups");
    if (fs.existsSync(backupDir)) {fs.rmSync(backupDir, { recursive: true, force: true });}
  });

  it("creates a tool with correct name", () => {
    const tool = createIdentityTunerTool();
    expect(tool.name).toBe("tune_identity");
  });

  it("loadMutableIdentity returns empty string when no file", () => {
    const content = loadMutableIdentity();
    expect(content).toBe("");
  });

  it("inspect operation returns current identity", async () => {
    const tool = createIdentityTunerTool();
    const result = await tool.execute("call-1", { operation: "read" });
    expect(result.content[0].text).toBeDefined();
  });

  it("append operation writes new identity content", async () => {
    const tool = createIdentityTunerTool();
    const tuneResult = await tool.execute("call-2", {
      operation: "append",
      text: "I am Ernos. I value honesty.",
    });
    expect(tuneResult.content[0].text).toContain("Appended");

    // Verify the file was written
    const loaded = loadMutableIdentity();
    expect(loaded).toContain("honesty");
  });

  it("rejects content exceeding max length", async () => {
    const tool = createIdentityTunerTool();
    const longContent = "x".repeat(3000);
    const result = await tool.execute("call-3", {
      operation: "append",
      text: longContent,
    });
    expect(result.content[0].text.toLowerCase()).toContain("exceed");
  });
});
