import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the artifact registry with controllable verify behavior
const mockVerifyArtifact = vi.fn();

vi.mock("../../memory/artifact-registry.js", () => ({
  artifactRegistry: {
    verifyArtifact: mockVerifyArtifact,
  },
}));

const { createArtifactTools } = await import("./artifact-tools-def.js");

describe("verify_artifact_authorship tool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-tools-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function getTool() {
    const tools = createArtifactTools();
    return tools.find((t) => t.name === "verify_artifact_authorship")!;
  }

  it("returns error when path parameter is missing", async () => {
    const tool = getTool();
    const result = await tool.execute({ path: "" });
    expect(result).toContain("'path' parameter is required");
  });

  it("returns error when path parameter is undefined", async () => {
    const tool = getTool();
    const result = await tool.execute({});
    expect(result).toContain("'path' parameter is required");
  });

  it("returns error for non-existent file", async () => {
    const tool = getTool();
    const result = await tool.execute({ path: "/nonexistent/file.png" });
    expect(result).toContain("File not found");
  });

  it("returns VERIFIED AUTHOR for a known artifact", async () => {
    const filePath = path.join(tmpDir, "known.png");
    fs.writeFileSync(filePath, "real-image-data");

    mockVerifyArtifact.mockReturnValueOnce({
      timestamp: Date.now(),
      type: "image",
      prompt: "a sunset photo",
      path: filePath,
    });

    const tool = getTool();
    const result = await tool.execute({ path: filePath });
    expect(result).toContain("[VERIFIED AUTHOR]");
    expect(result).toContain("image");
    expect(result).toContain("a sunset photo");
    expect(result).toContain("Cryptographic Match: ✅ Valid");
  });

  it("returns ANTI-GASLIGHTING TRIPPED for unknown artifact", async () => {
    const filePath = path.join(tmpDir, "unknown.png");
    fs.writeFileSync(filePath, "foreign-image-data");

    mockVerifyArtifact.mockReturnValueOnce(null);

    const tool = getTool();
    const result = await tool.execute({ path: filePath });
    expect(result).toContain("[ANTI-GASLIGHTING TRIPPED]");
    expect(result).toContain("did NOT create");
  });
});
