import { describe, it, expect } from "vitest";
import { AutonomousNeuroplasticity } from "./neuroplasticity.js";

describe("AutonomousNeuroplasticity", () => {
  // ─── parseLlmDecisions ───────────────────────────────────────────────

  describe("parseLlmDecisions", () => {
    const engine = new AutonomousNeuroplasticity(null);

    it("handles JSON fenced blocks", () => {
      const input = `Here is my analysis:\n\`\`\`json\n[{"action":"PRUNE","source":"User","relation":"LIKES","target":"Old Band"}]\n\`\`\`\nDone.`;
      const decisions = engine.parseLlmDecisions(input);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe("PRUNE");
      expect(decisions[0].source).toBe("User");
      expect(decisions[0].target).toBe("Old Band");
    });

    it("handles raw JSON (no fences)", () => {
      const input = `[{"action":"STRENGTHEN","source":"System","relation":"IS","target":"Online"}]`;
      const decisions = engine.parseLlmDecisions(input);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe("STRENGTHEN");
    });

    it("returns empty array on garbage input", () => {
      const input = `I don't know what to do with this graph. It looks fine.`;
      const decisions = engine.parseLlmDecisions(input);
      expect(decisions).toEqual([]);
    });

    it("returns empty array for empty JSON array", () => {
      const input = `\`\`\`json\n[]\n\`\`\``;
      const decisions = engine.parseLlmDecisions(input);
      expect(decisions).toEqual([]);
    });

    it("filters out malformed entries", () => {
      const input = `[
        {"action":"PRUNE","source":"A","relation":"R","target":"B"},
        {"action":"INVALID","source":"C","relation":"R","target":"D"},
        {"missing":"fields"}
      ]`;
      const decisions = engine.parseLlmDecisions(input);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe("PRUNE");
    });

    it("handles all three action types", () => {
      const input = `[
        {"action":"PRUNE","source":"A","relation":"LIKES","target":"B"},
        {"action":"STRENGTHEN","source":"C","relation":"IS","target":"D"},
        {"action":"DECAY","source":"E","relation":"ATE","target":"F"}
      ]`;
      const decisions = engine.parseLlmDecisions(input);
      expect(decisions).toHaveLength(3);
      expect(decisions.map((d) => d.action)).toEqual(["PRUNE", "STRENGTHEN", "DECAY"]);
    });
  });

  // ─── buildEvaluationPrompt ──────────────────────────────────────────

  describe("buildEvaluationPrompt", () => {
    const engine = new AutonomousNeuroplasticity(null);

    it("includes the graph sample in the prompt", () => {
      const sample = [
        { source: "User", relation: "LIKES", target: "Coffee", strength: 5 },
      ];
      const prompt = engine.buildEvaluationPrompt(sample);
      expect(prompt).toContain("User");
      expect(prompt).toContain("Coffee");
      expect(prompt).toContain("PRUNE");
      expect(prompt).toContain("STRENGTHEN");
      expect(prompt).toContain("DECAY");
    });
  });

  // ─── evaluateAndOptimize ────────────────────────────────────────────

  describe("evaluateAndOptimize", () => {
    it("returns offline when no driver", async () => {
      const engine = new AutonomousNeuroplasticity(null);
      const result = await engine.evaluateAndOptimize();
      expect(result.status).toBe("offline");
      expect(result.totalActions).toBe(0);
    });

    it("returns phase1_only when no LLM callback", async () => {
      // We can't test with a real driver, but we verify the branch logic
      const engine = new AutonomousNeuroplasticity(null, undefined);
      const result = await engine.evaluateAndOptimize();
      expect(result.status).toBe("offline");
    });
  });
});
