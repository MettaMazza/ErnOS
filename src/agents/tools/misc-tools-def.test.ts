import { describe, expect, it, vi } from "vitest";

// Mock heavy dependencies that misc-tools imports at module level
vi.mock("../../integrations/home-assistant.js", () => ({
  homeAssistant: {
    getSensorSummary: vi.fn(async () => ({ temperature: 22, humidity: 45 })),
    toggle: vi.fn(async (entityId: string) => ({ entityId, state: "toggled" })),
  },
}));

vi.mock("../../stt/stt.js", () => ({
  stt: {
    transcribe: vi.fn(async () => "Hello world transcription"),
  },
}));

vi.mock("../reasoning-trace.js", () => ({
  reasoningTraces: {
    reviewMyReasoning: vi.fn(async (_userId: string, contextId: string) =>
      `Reasoning for ${contextId}`),
  },
}));

vi.mock("./document-builder.js", () => ({
  documentBuilder: {
    startDocument: vi.fn((title: string) => `Started: doc_${title}`),
    addSection: vi.fn((_docId: string, title: string) => `Added: ${title}`),
    renderDocument: vi.fn((docId: string) => `# Document ${docId}\n\nContent here.`),
  },
}));

vi.mock("./pdf-generator.js", () => ({
  documentGenerator: {
    generatePdf: vi.fn(async (opts: { content: string; title: string }) =>
      `PDF generated: ${opts.title}`),
  },
}));

vi.mock("./rss-feeds.js", () => ({
  rssFeeds: {
    getLatestNews: vi.fn(async () => "Latest news: AI advances continue"),
  },
}));

const { createMiscTools } = await import("./misc-tools-def.js");

describe("Misc Tools", () => {
  const tools = createMiscTools("test-user");

  it("returns multiple tool definitions", () => {
    expect(tools.length).toBeGreaterThanOrEqual(5);
  });

  it("all tools have name, description, and parameters", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });

  it("document_start creates a document", async () => {
    const tool = tools.find((t) => t.name === "document_start")!;
    const result = await tool.execute({ title: "Test Doc" });
    expect(result).toContain("Started");
  });

  it("rss_get_news returns news", async () => {
    const tool = tools.find((t) => t.name === "rss_get_news")!;
    const result = await tool.execute({});
    expect(result).toContain("news");
  });

  it("review_my_reasoning returns introspection", async () => {
    const tool = tools.find((t) => t.name === "review_my_reasoning")!;
    const result = await tool.execute({ contextId: "ctx-1" });
    expect(result).toContain("ctx-1");
  });
});
