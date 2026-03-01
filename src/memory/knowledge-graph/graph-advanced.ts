import { Driver } from "neo4j-driver";

/**
 * Advanced Graph Operations
 * Synaptic wiring, bulk inserts, contradiction checks, etc.
 */

export async function strengthenConnection(
  driver: Driver | null,
  sourceLayer: string,
  targetLayer: string,
): Promise<void> {
  if (!driver) {return;}
  if (!sourceLayer || !targetLayer || sourceLayer === targetLayer) {return;}

  const srcRoot = `Root:${sourceLayer.charAt(0).toUpperCase() + sourceLayer.slice(1)}`;
  const tgtRoot = `Root:${targetLayer.charAt(0).toUpperCase() + targetLayer.slice(1)}`;

  const query = `
    MATCH (a:Entity {name: $srcRoot}), (b:Entity {name: $tgtRoot})
    MERGE (a)-[s:CONNECTION]-(b)
    ON CREATE SET s.strength = 1, s.created = timestamp(), s.last_fired = timestamp(), s.type = 'cross_layer'
    ON MATCH SET s.strength = s.strength + 1, s.last_fired = timestamp()
  `;

  const session = driver.session();
  try {
    await session.run(query, { srcRoot, tgtRoot });
  } catch (error) {
    console.error(
      `Error strengthening connection between ${sourceLayer} and ${targetLayer}:`,
      error,
    );
  } finally {
    await session.close();
  }
}

export async function decayConnections(
  driver: Driver | null,
  decayRate: number = 0.1,
  pruneThreshold: number = 0,
): Promise<void> {
  if (!driver) {return;}

  const query = `
    MATCH ()-[s:CONNECTION]->()
    SET s.strength = s.strength - $decayRate
    WITH s
    WHERE s.strength <= $pruneThreshold
    DELETE s
  `;

  const session = driver.session();
  try {
    await session.run(query, { decayRate, pruneThreshold });
  } catch (error) {
    console.error("Error decaying connections:", error);
  } finally {
    await session.close();
  }
}

export async function getConnectionMap(driver: Driver | null): Promise<Record<string, number>> {
  if (!driver) {return {};}
  const query = `
    MATCH (a:Entity)-[s:CONNECTION]-(b:Entity)
    WHERE a.name STARTS WITH 'Root:' AND b.name STARTS WITH 'Root:'
    RETURN a.name, b.name, s.strength
  `;

  const session = driver.session();
  const connections: Record<string, number> = {};
  try {
    const res = await session.run(query);
    for (const rec of res.records) {
      const a = rec.get(0).replace("Root:", "");
      const b = rec.get(1).replace("Root:", "");
      const str = rec.get(2) || 0;

      const key = [a, b].toSorted((x, y) => x.localeCompare(y)).join("--");
      connections[key] = str;
    }
  } catch (error) {
    console.error("Error getting connection map:", error);
  } finally {
    await session.close();
  }
  return connections;
}

export async function pruneOrphanNodes(
  driver: Driver | null,
  minAgeDays: number = 30,
): Promise<{ pruned: number; skipped: number }> {
  if (!driver) {return { pruned: 0, skipped: 0 };}

  // Convert days to milliseconds
  const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
  const cutoffTimestamp = Date.now() - minAgeMs;

  const query = `
      MATCH (n)
      WHERE NOT (n)-[]-() AND n.created < $cutoffTimestamp
      AND NOT n.name STARTS WITH 'Root:'
      AND NOT n.name STARTS WITH 'Layer:'
      DELETE n
      RETURN count(*) as pruned
    `;

  const session = driver.session();
  let count = 0;
  try {
    const res = await session.run(query, { cutoffTimestamp });
    count = res.records[0]?.get("pruned")?.toNumber() || 0;
  } catch (error) {
    console.error("Error pruning orphans:", error);
  } finally {
    await session.close();
  }

  return { pruned: count, skipped: 0 };
}

// ─── V3 Parity: Advanced KG Operations ───────────────────────────────────────

/**
 * Fact structure for bulk seeding foundation knowledge.
 */
export interface SeedFact {
  subject: string;
  predicate?: string; // defaults to "RELATED_TO"
  object: string;
  layer?: string; // defaults to "semantic"
  scope?: string; // defaults to "CORE_PUBLIC"
  provenance?: Record<string, unknown>;
}

/**
 * High-throughput seeding of foundation knowledge into CORE_PUBLIC scope.
 *
 * All facts are stored with user_id=-1 (system), scope=CORE_PUBLIC, immutable=true.
 * Skips quarantine (pre-validated data).
 *
 * Ported from V3's `bulk_seed()`.
 */
export async function bulkSeed(
  driver: Driver | null,
  facts: SeedFact[],
  batchSize: number = 500,
): Promise<{ seeded: number; skipped: number; errors: number }> {
  if (!driver) {return { seeded: 0, skipped: 0, errors: 0 };}

  const stats = { seeded: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < facts.length; i += batchSize) {
    const batch = facts.slice(i, i + batchSize);
    const session = driver.session();

    try {
      const tx = session.beginTransaction();

      for (const fact of batch) {
        try {
          const subject = (fact.subject || "").trim();
          const obj = (fact.object || "").trim();
          if (!subject || !obj) {
            stats.skipped++;
            continue;
          }

          // Sanitise predicate for Neo4j relationship type
          let predicate = (fact.predicate || "RELATED_TO")
            .replace(/[\s\-:.]/g, "_")
            .replace(/[^A-Za-z0-9_]/g, "")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "")
            .toUpperCase();
          if (!predicate) {predicate = "RELATED_TO";}

          const layer = fact.layer || "semantic";
          const scope = fact.scope || "CORE_PUBLIC";
          const provenance = JSON.stringify(fact.provenance || {});

          // Create subject node
          await tx.run(
            `MERGE (n:Entity {name: $name, user_id: -1})
             SET n.layer = $layer, n.scope = $scope,
                 n.immutable = true, n.last_updated = timestamp()`,
            { name: subject, layer, scope },
          );

          // Create object node
          await tx.run(
            `MERGE (n:Entity {name: $name, user_id: -1})
             SET n.layer = $layer, n.scope = $scope,
                 n.immutable = true, n.last_updated = timestamp()`,
            { name: obj, layer, scope },
          );

          // Create relationship
          await tx.run(
            `MERGE (a:Entity {name: $source, user_id: -1})
             WITH a
             MERGE (b:Entity {name: $target, user_id: -1})
             MERGE (a)-[r:${predicate} {layer: $layer}]->(b)
             SET r.scope = $scope, r.user_id = -1,
                 r.immutable = true, r.source = 'foundation',
                 r.provenance = $provenance`,
            { source: subject, target: obj, layer, provenance, scope },
          );

          // Wire to layer root
          const rootName = `Root:${layer.charAt(0).toUpperCase() + layer.slice(1)}`;
          if (!subject.startsWith("Root:") && !subject.startsWith("Layer:")) {
            await tx.run(
              `MERGE (r:Entity {name: $root, user_id: -1})
               MERGE (n:Entity {name: $name, user_id: -1})
               MERGE (r)-[:CONTAINS]->(n)`,
              { root: rootName, name: subject },
            );
          }
          if (!obj.startsWith("Root:") && !obj.startsWith("Layer:")) {
            await tx.run(
              `MERGE (r:Entity {name: $root, user_id: -1})
               MERGE (n:Entity {name: $name, user_id: -1})
               MERGE (r)-[:CONTAINS]->(n)`,
              { root: rootName, name: obj },
            );
          }

          stats.seeded++;
        } catch (error) {
          console.error("Seed fact error:", error);
          stats.errors++;
        }
      }

      await tx.commit();
      console.log(`[KG] Seeded batch ${Math.floor(i / batchSize) + 1}: ${batch.length} facts`);
    } catch (error) {
      console.error("Seed batch error:", error);
      stats.errors += batch.length;
    } finally {
      await session.close();
    }
  }

  console.log(`[KG] Foundation seeding complete: ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * Fast lookup against CORE + LINEAGE foundation knowledge.
 * Returns all relationships involving the entity from user_id=-1 data.
 * LINEAGE scope (Echo, Solance, Lucid, Lumen) is included alongside CORE.
 *
 * Ported from V3's `query_core_knowledge()`.
 */
export async function queryCoreKnowledge(
  driver: Driver | null,
  entity: string,
  layer?: string,
): Promise<Array<{
  subject: string;
  predicate: string;
  object: string;
  layer?: string;
  provenance?: string;
  scope?: string;
}>> {
  if (!driver) {return [];}

  const whereParts = [
    "(r.user_id = -1 OR r.scope IN ['CORE_PRIVATE', 'CORE_PUBLIC', 'LINEAGE'])",
  ];
  if (layer) {whereParts.push("r.layer = $layer");}

  const query = `
    MATCH (a:Entity {name: $name})-[r]-(b)
    WHERE ${whereParts.join(" AND ")}
    RETURN a.name as subject, type(r) as predicate, b.name as object,
           r.layer as layer, r.provenance as provenance, r.scope as scope
  `;

  const results: Array<{
    subject: string;
    predicate: string;
    object: string;
    layer?: string;
    provenance?: string;
    scope?: string;
  }> = [];

  const session = driver.session();
  try {
    const res = await session.run(query, { name: entity, layer: layer ?? null });
    for (const record of res.records) {
      results.push({
        subject: record.get("subject"),
        predicate: record.get("predicate"),
        object: record.get("object"),
        layer: record.get("layer"),
        provenance: record.get("provenance"),
        scope: record.get("scope"),
      });
    }
  } catch (error) {
    console.error("Core knowledge query error:", error);
  } finally {
    await session.close();
  }

  return results;
}

/**
 * Check if a user's claim contradicts established CORE knowledge.
 * Returns the contradicting fact, or null if no contradiction.
 *
 * Ported from V3's `check_contradiction()`.
 */
export async function checkContradiction(
  driver: Driver | null,
  claimSubject: string,
  claimPredicate: string,
  claimObject: string,
): Promise<{
  subject: string;
  predicate: string;
  object: string;
  layer?: string;
  provenance?: string;
  conflictType: string;
} | null> {
  if (!driver) {return null;}

  const sanitisedPredicate = claimPredicate.toUpperCase().replace(/\s+/g, "_");

  const query = `
    MATCH (a:Entity {name: $subject})-[r]->(b:Entity)
    WHERE (r.user_id = -1 OR r.scope = 'CORE_PUBLIC')
      AND type(r) = $predicate
      AND b.name <> $object
    RETURN a.name as subject, type(r) as predicate, b.name as object,
           r.layer as layer, r.provenance as provenance
    LIMIT 1
  `;

  const session = driver.session();
  try {
    const res = await session.run(query, {
      subject: claimSubject,
      predicate: sanitisedPredicate,
      object: claimObject,
    });
    const record = res.records[0];
    if (record) {
      return {
        subject: record.get("subject"),
        predicate: record.get("predicate"),
        object: record.get("object"),
        layer: record.get("layer"),
        provenance: record.get("provenance"),
        conflictType: "direct_contradiction",
      };
    }
  } catch (error) {
    console.error("Contradiction check error:", error);
  } finally {
    await session.close();
  }

  return null;
}

/**
 * One-time migration: retroactively set scope on existing nodes that lack one.
 *
 * Rules:
 *   - user_id = -1  → scope = CORE_PUBLIC (system/foundation data)
 *   - user_id > 0   → scope = PUBLIC
 *
 * Ported from V3's `backfill_missing_scopes()`.
 */
export async function backfillMissingScopes(
  driver: Driver | null,
): Promise<{ nodes: number; relationships: number }> {
  if (!driver) {return { nodes: 0, relationships: 0 };}

  const stats = { nodes: 0, relationships: 0 };
  const session = driver.session();

  try {
    const nodeResult = await session.run(
      `MATCH (n) WHERE n.scope IS NULL
       SET n.scope = CASE WHEN n.user_id = -1 THEN 'CORE_PUBLIC'
                         WHEN n.user_id IS NULL THEN 'CORE_PUBLIC'
                         ELSE 'PUBLIC' END,
           n.user_id = CASE WHEN n.user_id IS NULL THEN -1 ELSE n.user_id END
       RETURN count(n) as cnt`,
    );
    stats.nodes = nodeResult.records[0]?.get("cnt")?.toNumber() || 0;

    const relResult = await session.run(
      `MATCH ()-[r]->() WHERE r.scope IS NULL
       SET r.scope = CASE WHEN r.user_id = -1 THEN 'CORE_PUBLIC'
                         WHEN r.user_id IS NULL THEN 'CORE_PUBLIC'
                         ELSE 'PUBLIC' END,
           r.user_id = CASE WHEN r.user_id IS NULL THEN -1 ELSE r.user_id END
       RETURN count(r) as cnt`,
    );
    stats.relationships = relResult.records[0]?.get("cnt")?.toNumber() || 0;

    console.log(`[KG] Scope backfill complete: ${JSON.stringify(stats)}`);
  } catch (error) {
    console.error("Scope backfill failed:", error);
  } finally {
    await session.close();
  }

  return stats;
}

/**
 * Find the user_id that has the most relationships connected to an entity.
 * Used by Dream Consolidation for scope arbitration.
 *
 * Ported from V3's `get_dominant_owner()`.
 */
export async function getDominantOwner(
  driver: Driver | null,
  entityName: string,
): Promise<number | null> {
  if (!driver) {return null;}

  const query = `
    MATCH (n:Entity {name: $name})-[r]-(m)
    WHERE r.user_id IS NOT NULL AND r.user_id <> -1
    RETURN r.user_id as uid, count(r) as freq
    ORDER BY freq DESC LIMIT 1
  `;

  const session = driver.session();
  try {
    const res = await session.run(query, { name: entityName });
    const record = res.records[0];
    if (record) {
      const uid = record.get("uid");
      return typeof uid === "object" && uid.toNumber ? uid.toNumber() : Number(uid);
    }
  } catch (error) {
    console.error("Dominant owner query error:", error);
  } finally {
    await session.close();
  }

  return null;
}

/**
 * Check if a user has any existing nodes or relationships in the graph.
 * Used to validate heuristics in Dream Consolidation.
 *
 * Ported from V3's `check_user_has_data()`.
 */
export async function checkUserHasData(
  driver: Driver | null,
  userId: number,
): Promise<boolean> {
  if (!driver) {return false;}

  const session = driver.session();
  try {
    const res = await session.run(
      "MATCH (n {user_id: $uid}) RETURN count(n) > 0 as has_data LIMIT 1",
      { uid: userId },
    );
    return res.records[0]?.get("has_data") || false;
  } catch (error) {
    console.error("User data check error:", error);
    return false;
  } finally {
    await session.close();
  }
}

// ─── NeuroForm Phase 2: LLM Neuroplasticity Helpers ────────────────────────────

export interface GraphEdgeSample {
  source: string;
  relation: string;
  target: string;
  strength: number | null;
}

/**
 * Fetch a sample of graph edges for LLM semantic review.
 * Returns edges ordered by strength ascending (weakest first) so the LLM
 * reviews the most vulnerable memories.
 */
export async function fetchGraphSample(
  driver: Driver | null,
  limit: number = 50,
): Promise<GraphEdgeSample[]> {
  if (!driver) {return [];}

  const query = `
    MATCH (a)-[r]->(b)
    WHERE type(r) <> 'IN_LAYER' AND type(r) <> 'PEER_LAYER' AND type(r) <> 'CONTAINS'
      AND NOT a.name STARTS WITH 'Root:' AND NOT b.name STARTS WITH 'Root:'
    RETURN a.name AS source, type(r) AS relation, b.name AS target, r.strength AS strength
    ORDER BY r.strength ASC
    LIMIT $limit
  `;

  const session = driver.session();
  try {
    const res = await session.run(query, { limit });
    return res.records.map((rec) => ({
      source: rec.get("source"),
      relation: rec.get("relation"),
      target: rec.get("target"),
      strength: rec.get("strength"),
    }));
  } catch (error) {
    console.error("Error fetching graph sample:", error);
    return [];
  } finally {
    await session.close();
  }
}

/**
 * Execute a single LLM neuroplasticity decision on the graph.
 *
 * - PRUNE: Delete the relationship entirely (contradiction removal)
 * - STRENGTHEN: Boost strength by +0.5 (Long-Term Potentiation)
 * - DECAY: Reduce strength by -0.2 (Long-Term Depression)
 */
export async function executeLlmGraphAction(
  driver: Driver | null,
  action: "PRUNE" | "STRENGTHEN" | "DECAY",
  source: string,
  relation: string,
  target: string,
): Promise<boolean> {
  if (!driver) {return false;}

  const cleanRel = relation.replace(/[^A-Za-z0-9_]/g, "").toUpperCase() || "RELATED_TO";

  let query: string;
  switch (action) {
    case "PRUNE":
      query = `MATCH (a {name: $src})-[r]->(b {name: $tgt}) WHERE type(r) = $rel DELETE r`;
      break;
    case "STRENGTHEN":
      query = `MATCH (a {name: $src})-[r]->(b {name: $tgt}) WHERE type(r) = $rel SET r.strength = coalesce(r.strength, 1.0) + 0.5, r.last_fired = timestamp()`;
      break;
    case "DECAY":
      query = `MATCH (a {name: $src})-[r]->(b {name: $tgt}) WHERE type(r) = $rel SET r.strength = coalesce(r.strength, 1.0) - 0.2`;
      break;
  }

  const session = driver.session();
  try {
    await session.run(query, { src: source, tgt: target, rel: cleanRel });
    return true;
  } catch (error) {
    console.error(`[Neuroplasticity] Failed ${action} on ${source}->${target}:`, error);
    return false;
  } finally {
    await session.close();
  }
}
