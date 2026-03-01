import type { Driver } from "neo4j-driver";
import type { NeuroplasticityDecision } from "./types.js";
import {
  fetchGraphSample,
  executeLlmGraphAction,
  type GraphEdgeSample,
} from "./graph-advanced.js";
import { decayConnections } from "./graph-advanced.js";
import { pruneOrphanNodes } from "./graph-advanced.js";

/**
 * AutonomousNeuroplasticity — Dual-Phase Hybrid Engine
 *
 * Ported from NeuroForm's `neuroplasticity.py`.
 *
 * Phase 1: Mathematical baseline decay (Homeostasis)
 *   — All CONNECTION strengths are decremented. Edges at 0 are pruned.
 *
 * Phase 2: LLM Semantic Review (Pre-frontal Cortex)
 *   — Surviving edges are sampled and presented to the LLM.
 *   — The LLM issues PRUNE / STRENGTHEN / DECAY commands.
 *   — Commands are atomically executed on the graph.
 *
 * This mirrors biological neuroplasticity:
 *   - Hebbian Learning: "Neurons that fire together, wire together" → STRENGTHEN
 *   - Synaptic Pruning: Rarely-used or contradictory edges are eliminated → PRUNE
 *   - Long-Term Depression: Fading relevance is accelerated → DECAY
 */
export class AutonomousNeuroplasticity {
  private driver: Driver | null;
  private generateResponse:
    | ((prompt: string) => Promise<string>)
    | null;

  constructor(
    driver: Driver | null,
    generateResponse?: (prompt: string) => Promise<string>,
  ) {
    this.driver = driver;
    this.generateResponse = generateResponse ?? null;
  }

  /**
   * Main entry point. Runs both phases sequentially.
   *
   * Returns a summary of all actions taken.
   */
  async evaluateAndOptimize(): Promise<{
    status: string;
    totalActions: number;
    phase1Actions: number;
    phase2Actions: number;
    decisions: NeuroplasticityDecision[];
  }> {
    if (!this.driver) {
      return { status: "offline", totalActions: 0, phase1Actions: 0, phase2Actions: 0, decisions: [] };
    }

    // ─── Phase 1: Mathematical Homeostasis ────────────────────────────
    console.log("[Neuroplasticity] Phase 1: Running baseline mathematical decay...");
    await decayConnections(this.driver, 0.1, 0);
    const orphanResult = await pruneOrphanNodes(this.driver, 30);
    const phase1Actions = orphanResult.pruned;
    console.log(`[Neuroplasticity] Phase 1 complete. Pruned ${phase1Actions} orphans.`);

    // ─── Phase 2: LLM Semantic Review ────────────────────────────────
    if (!this.generateResponse) {
      console.log("[Neuroplasticity] Phase 2 skipped: no LLM callback provided.");
      return { status: "phase1_only", totalActions: phase1Actions, phase1Actions, phase2Actions: 0, decisions: [] };
    }

    console.log("[Neuroplasticity] Phase 2: Fetching graph sample for LLM semantic review...");
    const sample = await fetchGraphSample(this.driver, 50);
    if (sample.length === 0) {
      console.log("[Neuroplasticity] Phase 2 skipped: no edges to review.");
      return { status: "no_data", totalActions: phase1Actions, phase1Actions, phase2Actions: 0, decisions: [] };
    }

    const prompt = this.buildEvaluationPrompt(sample);

    try {
      const llmResponse = await this.generateResponse(prompt);
      const decisions = this.parseLlmDecisions(llmResponse);
      console.log(`[Neuroplasticity] LLM returned ${decisions.length} decisions.`);

      const phase2Actions = await this.executeDecisions(decisions);

      // Post-execution orphan cleanup
      await pruneOrphanNodes(this.driver, 0);

      const totalActions = phase1Actions + phase2Actions;
      console.log(`[Neuroplasticity] Phase 2 complete. ${phase2Actions} actions executed. Total: ${totalActions}.`);

      return {
        status: "success",
        totalActions,
        phase1Actions,
        phase2Actions,
        decisions,
      };
    } catch (e) {
      console.error("[Neuroplasticity] Phase 2 LLM review error:", e);
      return {
        status: "error",
        totalActions: phase1Actions,
        phase1Actions,
        phase2Actions: 0,
        decisions: [],
      };
    }
  }

  /**
   * Build the evaluation prompt for the LLM.
   * The LLM acts as an autonomous memory manager reviewing a slice of the graph.
   */
  buildEvaluationPrompt(context: GraphEdgeSample[]): string {
    const graphStr = JSON.stringify(context, null, 2);
    return `You are the autonomous memory manager of a Neo4j knowledge graph.

Review the following slice of the memory graph:
${graphStr}

Evaluate these memories:
1. Are there outdated, contradictory, or useless facts? You should "PRUNE" them.
2. Are there highly critical, structural facts that should be "STRENGTHENED"?
3. Are there facts that are losing relevance and should "DECAY"?

Return your decisions as a JSON array EXACTLY matching this format:
\`\`\`json
[
  {"action": "PRUNE", "source": "User", "relation": "LIKES", "target": "Old Band"},
  {"action": "STRENGTHEN", "source": "System", "relation": "IS", "target": "Online"},
  {"action": "DECAY", "source": "User", "relation": "ATE", "target": "Pizza Yesterday"}
]
\`\`\`
If the graph looks generally optimal, return an empty array \`[]\`. Return ONLY the JSON array.`;
  }

  /**
   * Parse the LLM's response into structured decisions.
   * Handles ```json fenced blocks, raw JSON, and garbage input.
   */
  parseLlmDecisions(text: string): NeuroplasticityDecision[] {
    try {
      let jsonBlock: string;
      if (text.includes("```json")) {
        jsonBlock = text.split("```json").pop()!.split("```")[0].trim();
      } else if (text.includes("```")) {
        jsonBlock = text.split("```")[1].split("```")[0].trim();
      } else {
        jsonBlock = text.trim();
      }

      const parsed: unknown = JSON.parse(jsonBlock);
      if (!Array.isArray(parsed)) {return [];}

      // Validate each entry has the required fields
      return parsed.filter(
        (d): d is NeuroplasticityDecision =>
          typeof d === "object" &&
          d !== null &&
          typeof d.action === "string" &&
          ["PRUNE", "STRENGTHEN", "DECAY"].includes(d.action) &&
          typeof d.source === "string" &&
          typeof d.relation === "string" &&
          typeof d.target === "string",
      );
    } catch {
      console.warn("[Neuroplasticity] Failed to parse LLM memory optimization decisions.");
      return [];
    }
  }

  /**
   * Execute each LLM decision against the graph.
   * Returns the number of successfully executed actions.
   */
  private async executeDecisions(decisions: NeuroplasticityDecision[]): Promise<number> {
    let actions = 0;

    for (const d of decisions) {
      const success = await executeLlmGraphAction(
        this.driver,
        d.action,
        d.source,
        d.relation,
        d.target,
      );
      if (success) {actions++;}
    }

    return actions;
  }
}
