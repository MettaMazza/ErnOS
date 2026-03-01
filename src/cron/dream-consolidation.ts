import { systemMemory } from "../memory/orchestrator.js";
import { getAutobiographyManager } from "../memory/autobiography.js";
import { kgConsolidator } from "./kg-consolidator.js";
import { AutonomousNeuroplasticity } from "../memory/knowledge-graph/neuroplasticity.js";

export class DreamConsolidationDaemon {
  /**
   * Nightly cron job to optimize the 5-tier memory system.
   * Mirrors the V3 architecture for long-term knowledge settling.
   *
   * Scheduled as built-in cron: 0 3 * * * UTC (see server-cron.ts)
   */
  public async executeNightlyDream(userId: string): Promise<void> {
    console.log(`[Dream Consolidation] Starting nightly optimization for user ${userId}...`);
    const startMs = Date.now();

    try {
      // 1. Reconcile Cross-Tier Inconsistencies
      //    Run LLM-powered conflict detection between Lessons (T4) > KG (T3) > Vector (T2)
      console.log(`[Dream Consolidation] Step 1: Running cross-tier reconciliation...`);
      const lessons = systemMemory.lessonManager
        .getAllLessons()
        .map((l: { fact: string }) => l.fact);
      const kgContext = await systemMemory.knowledgeGraph.queryContext(
        userId,
        null,
        null,
        "PUBLIC",
      );
      const kgStrings =
        typeof kgContext === "string" ? [kgContext] : Array.isArray(kgContext) ? kgContext : [];
      const reconciled = await systemMemory.reconciler.reconcile(lessons, kgStrings, []);
      console.log(
        `  -> Reconciled: ${reconciled.stats.lessons} lessons, ${reconciled.stats.kg} KG facts, ${reconciled.stats.conflicts} conflicts found.`,
      );

      // 2. Synaptic Decay (Phase 1 — Mathematical Homeostasis)
      console.log(`[Dream Consolidation] Step 2: Decaying unused synaptic pathways in KG...`);
      const decayedCount = await systemMemory.knowledgeGraph.decayConnections();
      console.log(`  -> Decayed ${decayedCount} pathways.`);

      // 2.5. LLM Semantic Review (Phase 2 — NeuroForm Neuroplasticity)
      //      After mathematical decay, the surviving edges are sampled and
      //      presented to the LLM for autonomous PRUNE/STRENGTHEN/DECAY decisions.
      console.log(`[Dream Consolidation] Step 2.5: Running LLM neuroplasticity review (Phase 2)...`);
      const neuroEngine = new AutonomousNeuroplasticity(
        systemMemory.knowledgeGraph.getDriver(),
        kgConsolidator.getGenerator() ?? undefined,
      );
      const neuroResult = await neuroEngine.evaluateAndOptimize();
      console.log(
        `  -> Phase 2: ${neuroResult.phase2Actions} LLM actions, ${neuroResult.decisions.length} decisions. Status: ${neuroResult.status}`,
      );

      // 3. Process Validation Quarantine
      console.log(`[Dream Consolidation] Step 3: Processing knowledge quarantine queue...`);
      const pendingFacts = systemMemory.knowledgeGraph.quarantine.getPendingFacts();
      console.log(`  -> ${pendingFacts.length} quarantined facts pending review.`);

      // 4. Archive old Working Memory
      //    Triggers the rolling buffer consolidation — evicts old turns and archives them.
      console.log(`[Dream Consolidation] Step 4: Compressing old working memory...`);
      await systemMemory.workingMemory.consolidate();
      console.log(`  -> Working memory buffer compressed.`);

      // 5. Tape Machine compaction
      //    Remove EMPTY cells and defragment Turing Tapes for all users.
      console.log(`[Dream Consolidation] Step 5: Compacting Turing Tapes...`);
      const compacted = systemMemory.compactAllTapes();
      const totalRemoved = compacted.reduce((sum, r) => sum + r.removed, 0);
      console.log(`  -> Compacted ${compacted.length} tapes, removed ${totalRemoved} empty cells.`);

      // 6. KG Orphan Pruning (V3 Parity)
      //    Delete nodes with no relationships older than 30 days.
      console.log(`[Dream Consolidation] Step 6: Pruning orphan KG nodes...`);
      const pruned = await systemMemory.knowledgeGraph.pruneOrphanNodes(30);
      console.log(`  -> Pruned ${pruned.pruned} orphan nodes.`);

      // 7. Autobiography Dream Synthesis (V3 Parity)
      //    Add a dream_synthesis entry summarising what was processed tonight.
      console.log(`[Dream Consolidation] Step 7: Writing autobiography dream synthesis...`);
      const autobio = getAutobiographyManager();
      const dreamEntry =
        `Tonight's dream consolidation processed ` +
        `${reconciled.stats.lessons} lessons, ${reconciled.stats.kg} KG facts, ` +
        `found ${reconciled.stats.conflicts} conflicts. ` +
        `Decayed ${decayedCount} synaptic pathways, pruned ${pruned.pruned} orphan nodes. ` +
        `Compacted ${compacted.length} tapes (removed ${totalRemoved} empty cells). ` +
        `${pendingFacts.length} facts remain in quarantine.`;
      await autobio.appendEntry("dream_synthesis", dreamEntry, "dream-consolidation");
      console.log(`  -> Dream synthesis recorded.`);

      // 8. KG Consolidator Flush (V3 Parity)
      //    Force-flush any pending interactions before sleep.
      console.log(`[Dream Consolidation] Step 8: Flushing KG consolidator...`);
      await kgConsolidator.forceConsolidate();
      console.log(`  -> KG consolidator flushed.`);

      const durationMs = Date.now() - startMs;
      console.log(`[Dream Consolidation] Complete in ${durationMs}ms.`);
    } catch (e) {
      console.error(`[Dream Consolidation] Failed:`, e);
    }
  }

  /**
   * Mocks a cron schedule trigger
   */
  public schedule() {
    // Actual scheduling is handled by server-cron.ts registerBuiltinJobs()
    console.log("[Cron] Dream Consolidation scheduled for 3:00 AM nightly.");
  }
}

export const dreamDaemon = new DreamConsolidationDaemon();
