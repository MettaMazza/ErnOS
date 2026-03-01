import neo4j, { Driver } from "neo4j-driver";
import * as advanced from "./graph-advanced.js";
import * as crud from "./graph-crud.js";
import { ValidationQuarantine } from "./quarantine.js";
import { GraphLayer } from "./types.js";

export class KnowledgeGraph {
  private driver: Driver | null = null;
  public quarantine: ValidationQuarantine;

  constructor() {
    this.quarantine = new ValidationQuarantine();
    this.connect();
  }

  /** Public accessor for the Neo4j driver (used by neuroplasticity engine). */
  public getDriver(): Driver | null {
    return this.driver;
  }

  private connect() {
    const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
    const user = process.env.NEO4J_USER || "neo4j";
    const password = process.env.NEO4J_PASSWORD || "Y0mJ0HD8ZCTwbhLSD0qDoA";

    if (process.env.DISABLE_NEO4J === "true") {
      console.warn(
        "Memory: Neo4j is disabled via DISABLE_NEO4J env. Tier 3+ Memory will degrade gracefully.",
      );
      return;
    }

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
      console.log("KnowledgeGraph connected to Neo4j successfully.");
      this.initializeSchema().catch((e) => console.error("KG schema init failed:", e));
    } catch (error) {
      console.error("Failed to connect to Neo4j. KG features disabled:", error);
      this.driver = null;
    }
  }

  private async initializeSchema() {
    if (!this.driver) {return;}
    const session = this.driver.session();
    try {
      const queries = [
        "CREATE INDEX node_name_idx IF NOT EXISTS FOR (n:Entity) ON (n.name)",
        "CREATE INDEX node_layer_idx IF NOT EXISTS FOR (n:Entity) ON (n.layer)",
        "CREATE INDEX user_id_idx IF NOT EXISTS FOR (n:User) ON (n.user_id)",
      ];

      const layerNames = Object.values(GraphLayer);
      for (const name of layerNames) {
        const label = (name as string).charAt(0).toUpperCase() + (name as string).slice(1);
        queries.push(
          `CREATE INDEX ${name as string}_layer_idx IF NOT EXISTS FOR (n:${label}) ON (n.layer)`,
        );
      }

      // Root wire queries (synaptic base)
      for (let i = 0; i < layerNames.length; i++) {
        for (let j = i + 1; j < layerNames.length; j++) {
          const srcRoot = `Root:${(layerNames[i] as string).charAt(0).toUpperCase() + (layerNames[i] as string).slice(1)}`;
          const tgtRoot = `Root:${(layerNames[j] as string).charAt(0).toUpperCase() + (layerNames[j] as string).slice(1)}`;
          queries.push(`
              MERGE (a:Entity {name: '${srcRoot}', layer: '${layerNames[i]}'}) 
              ON CREATE SET a.user_id = -1
              MERGE (b:Entity {name: '${tgtRoot}', layer: '${layerNames[j]}'}) 
              ON CREATE SET b.user_id = -1
              MERGE (a)-[s:CONNECTION]-(b)
              ON CREATE SET s.strength = 1, s.created = timestamp(), s.type = 'cross_layer'
           `);
        }
      }

      for (const q of queries) {
        await session.run(q);
      }
      console.log("KnowledgeGraph Schema Initialized.");
    } finally {
      await session.close();
    }
  }

  public async close() {
    if (this.driver) {
      await this.driver.close();
    }
  }

  /**
   * Nuclear wipe — deletes ALL nodes and relationships from the graph.
   * Used by /clear for a complete system reset.
   */
  public async clearAll(): Promise<number> {
    if (!this.driver) {return 0;}
    const session = this.driver.session();
    try {
      const result = await session.run("MATCH (n) DETACH DELETE n");
      const deleted = result.summary.counters.updates().nodesDeleted;
      console.log(`[KnowledgeGraph] Cleared all data: ${deleted} nodes deleted.`);
      return deleted;
    } finally {
      await session.close();
    }
  }

  // --- CRUD API ---

  public async addNode(
    label: string,
    name: string,
    layer: GraphLayer = GraphLayer.NARRATIVE,
    properties: any = {},
    userId: number | null = null,
    personaId: string | null = null,
    scope: string | null = null,
  ) {
    await crud.addNode(
      this.driver,
      this.quarantine,
      label,
      name,
      layer,
      properties,
      userId,
      personaId,
      scope,
    );
  }

  public async addRelationship(
    sourceName: string,
    relType: string,
    targetName: string,
    layer: GraphLayer = GraphLayer.NARRATIVE,
    userId: number | null = null,
    scope: string | null = null,
    sourceStr: string = "explicit",
    personaId: string | null = null,
  ) {
    await crud.addRelationship(
      this.driver,
      this.quarantine,
      sourceName,
      relType,
      targetName,
      layer,
      userId,
      scope,
      sourceStr,
      null,
      personaId,
    );
  }

  public async queryContext(
    entityName: string,
    layer: string | null = null,
    userId: number | null = null,
    scope: string | null = null,
    personaId: string | null = null,
  ): Promise<string[]> {
    return crud.queryContext(
      this.driver,
      entityName,
      layer,
      userId,
      scope,
      personaId,
      async (s: string, t: string) => {
        await advanced.strengthenConnection(this.driver, s, t);
      },
    );
  }

  // --- Advanced Synaptic API ---

  public async strengthenConnection(sourceLayer: string, targetLayer: string) {
    await advanced.strengthenConnection(this.driver, sourceLayer, targetLayer);
  }

  public async decayConnections(decayRate = 0.1, pruneThreshold = 0): Promise<number> {
    await advanced.decayConnections(this.driver, decayRate, pruneThreshold);
    return 0; // placeholder count
  }

  public async pruneOrphanNodes(minAgeDays = 30) {
    return advanced.pruneOrphanNodes(this.driver, minAgeDays);
  }

  // --- V3 Parity: Advanced KG Operations ---

  public async getConnectionMap() {
    return advanced.getConnectionMap(this.driver);
  }

  public async bulkSeed(facts: advanced.SeedFact[], batchSize?: number) {
    return advanced.bulkSeed(this.driver, facts, batchSize);
  }

  public async queryCoreKnowledge(entity: string, layer?: string) {
    return advanced.queryCoreKnowledge(this.driver, entity, layer);
  }

  public async checkContradiction(subject: string, predicate: string, object: string) {
    return advanced.checkContradiction(this.driver, subject, predicate, object);
  }

  public async backfillMissingScopes() {
    return advanced.backfillMissingScopes(this.driver);
  }

  public async getDominantOwner(entityName: string) {
    return advanced.getDominantOwner(this.driver, entityName);
  }

  public async checkUserHasData(userId: number) {
    return advanced.checkUserHasData(this.driver, userId);
  }
}
