import { systemMemory } from "../memory/orchestrator.js";
import { getAutobiographyManager } from "../memory/autobiography.js";
import { kgConsolidator } from "./kg-consolidator.js";
import { AutonomousNeuroplasticity } from "../memory/knowledge-graph/neuroplasticity.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("dream");

export class DreamConsolidationDaemon {
  /**
   * Nightly cron job to optimize the 5-tier memory system.
   * Mirrors the V3 architecture for long-term knowledge settling.
   *
   * Scheduled as built-in cron: 0 3 * * * UTC (see server-cron.ts)
   */
  public async executeNightlyDream(userId: string): Promise<void> {
    log.info(`Starting nightly optimization for user ${userId}...`);
    const startMs = Date.now();

    try {
      // 1. Reconcile Cross-Tier Inconsistencies
      //    Run LLM-powered conflict detection between Lessons (T4) > KG (T3) > Vector (T2)
      log.info(`Step 1: Running cross-tier reconciliation...`);
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
      log.info(
        `Reconciled: ${reconciled.stats.lessons} lessons, ${reconciled.stats.kg} KG facts, ${reconciled.stats.conflicts} conflicts found.`,
      );

      // 2. Synaptic Decay (Phase 1 — Mathematical Homeostasis)
      log.info(`Step 2: Decaying unused synaptic pathways in KG...`);
      const decayedCount = await systemMemory.knowledgeGraph.decayConnections();
      log.info(`Decayed ${decayedCount} pathways.`);

      // 2.5. LLM Semantic Review (Phase 2 — NeuroForm Neuroplasticity)
      //      After mathematical decay, the surviving edges are sampled and
      //      presented to the LLM for autonomous PRUNE/STRENGTHEN/DECAY decisions.
      log.info(`Step 2.5: Running LLM neuroplasticity review (Phase 2)...`);
      const neuroEngine = new AutonomousNeuroplasticity(
        systemMemory.knowledgeGraph.getDriver(),
        kgConsolidator.getGenerator() ?? undefined,
      );
      const neuroResult = await neuroEngine.evaluateAndOptimize();
      log.info(
        `Phase 2: ${neuroResult.phase2Actions} LLM actions, ${neuroResult.decisions.length} decisions. Status: ${neuroResult.status}`,
      );

      // 3. Process Validation Quarantine
      log.info(`Step 3: Processing knowledge quarantine queue...`);
      const pendingFacts = systemMemory.knowledgeGraph.quarantine.getPendingFacts();
      log.info(`${pendingFacts.length} quarantined facts pending review.`);

      // 4. Archive old Working Memory
      //    Triggers the rolling buffer consolidation — evicts old turns and archives them.
      log.info(`Step 4: Compressing old working memory...`);
      await systemMemory.workingMemory.consolidate();
      log.info(`Working memory buffer compressed.`);

      // 5. Tape Machine compaction
      //    Remove EMPTY cells and defragment Turing Tapes for all users.
      log.info(`Step 5: Compacting Turing Tapes...`);
      const compacted = systemMemory.compactAllTapes();
      const totalRemoved = compacted.reduce((sum, r) => sum + r.removed, 0);
      log.info(`Compacted ${compacted.length} tapes, removed ${totalRemoved} empty cells.`);

      // 6. KG Orphan Pruning (V3 Parity)
      //    Delete nodes with no relationships older than 30 days.
      log.info(`Step 6: Pruning orphan KG nodes...`);
      const pruned = await systemMemory.knowledgeGraph.pruneOrphanNodes(30);
      log.info(`Pruned ${pruned.pruned} orphan nodes.`);

      // 7. Autobiography Dream Synthesis (V3 Parity)
      //    Add a dream_synthesis entry summarising what was processed tonight.
      log.info(`Step 7: Writing autobiography dream synthesis...`);
      const autobio = getAutobiographyManager();
      const dreamEntry =
        `Tonight's dream consolidation processed ` +
        `${reconciled.stats.lessons} lessons, ${reconciled.stats.kg} KG facts, ` +
        `found ${reconciled.stats.conflicts} conflicts. ` +
        `Decayed ${decayedCount} synaptic pathways, pruned ${pruned.pruned} orphan nodes. ` +
        `Compacted ${compacted.length} tapes (removed ${totalRemoved} empty cells). ` +
        `${pendingFacts.length} facts remain in quarantine.`;
      await autobio.appendEntry("dream_synthesis", dreamEntry, "dream-consolidation");
      log.info(`Dream synthesis recorded.`);

      // 8. KG Consolidator Flush (V3 Parity)
      //    Force-flush any pending interactions before sleep.
      log.info(`Step 8: Flushing KG consolidator...`);
      await kgConsolidator.forceConsolidate();
      log.info(`KG consolidator flushed.`);

      const durationMs = Date.now() - startMs;
      log.info(`Dream consolidation complete in ${durationMs}ms.`);
    } catch (e) {
      log.error(`Dream consolidation failed`, { error: String(e) });
    }
  }

  /**
   * Mocks a cron schedule trigger
   */
  public schedule() {
    // Actual scheduling is handled by server-cron.ts registerBuiltinJobs()
    log.info("Dream Consolidation scheduled for 3:00 AM nightly.");
  }
}

export const dreamDaemon = new DreamConsolidationDaemon();
