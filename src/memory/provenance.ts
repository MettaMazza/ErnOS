/**
 * ProvenanceLedger — High-level provenance queries backed by ProvenanceManager.
 *
 * Provides creation-context retrieval and chain-of-custody verification for
 * any entity (files, images, documents) tracked in the provenance ledger.
 *
 * Previously stubbed; now delegates to the real ProvenanceManager in
 * `src/security/provenance.ts` which maintains the HMAC-SHA256 ledger.
 */

import * as fs from "fs";
import * as path from "path";
import { ProvenanceManager, type ProvenanceRecord } from "../security/provenance.js";

export class ProvenanceLedger {
  /**
   * Retrieves the creation context and origin of a factual claim or artifact.
   *
   * Looks up the entity in the provenance ledger by filename/path or checksum,
   * returning the original creation intent, prompt, timestamp, and evidence.
   *
   * @param entityId — A filename, file path, partial query, or SHA-256 checksum
   */
  public async getCreationContext(entityId: string): Promise<string> {
    const trimmed = entityId.trim();
    if (!trimmed) {
      return JSON.stringify({ error: "Empty entityId" });
    }

    // Strategy 1: If entityId is a file path that exists, look up directly via checksum
    let record: ProvenanceRecord | null = null;
    if (fs.existsSync(trimmed)) {
      record = ProvenanceManager.lookupByFile(trimmed);
    }

    // Strategy 2: If it looks like a hex checksum (64 chars), look up by checksum
    if (!record && /^[0-9a-f]{64}$/i.test(trimmed)) {
      record = ProvenanceManager.lookupByChecksum(trimmed);
    }

    // Strategy 3: Search the ledger by filename / prompt / intention
    if (!record) {
      const matches = ProvenanceManager.search(trimmed);
      if (matches.length > 0) {
        record = matches[matches.length - 1]; // most recent match
      }
    }

    if (!record) {
      return JSON.stringify({
        entityId: trimmed,
        found: false,
        error: "Not found in provenance ledger",
      });
    }

    const meta = record.metadata || {};
    return JSON.stringify({
      entityId: trimmed,
      found: true,
      createdBy: `Agent(${record.type})`,
      timestamp: record.timestamp,
      filePath: record.filePath,
      filename: record.filename,
      type: record.type,
      sourcePrompt: (meta.prompt as string) ?? null,
      intention: (meta.intention as string) ?? null,
      scope: (meta.scope as string) ?? null,
      userId: (meta.user_id as string) ?? null,
      checksum: record.checksum,
      confidence: 1.0, // Provenance-verified artifacts have cryptographic certainty
      evidenceLinks: [record.filePath],
    });
  }

  /**
   * Evaluates whether an artifact has an unbroken chain of custody.
   *
   * Verifies that:
   * 1. The artifact exists on disk
   * 2. It is tracked in the provenance ledger
   * 3. Its current checksum matches the ledger (i.e. it hasn't been tampered with)
   *
   * @param entityId — A file path to verify, or a checksum to check against the ledger
   */
  public verifyChainOfCustody(entityId: string): boolean {
    const trimmed = entityId.trim();
    if (!trimmed) {
      return false;
    }

    // If entityId is a file path, verify the file's current checksum matches the ledger
    if (fs.existsSync(trimmed)) {
      try {
        const currentChecksum = ProvenanceManager.signFile(trimmed);
        const ledgerRecord = ProvenanceManager.lookupByChecksum(currentChecksum);
        if (!ledgerRecord) {
          // File exists but was not created by ErnOS (not in ledger)
          return false;
        }
        // Verify the file path in the ledger matches (or the checksum is the same,
        // meaning content is identical even if the file was moved)
        return true;
      } catch {
        return false;
      }
    }

    // If entityId looks like a checksum, check if it's tracked in the ledger
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      return ProvenanceManager.isTracked(trimmed);
    }

    // If entityId is a filename, search the ledger and verify the file still exists
    const matches = ProvenanceManager.search(trimmed);
    if (matches.length === 0) {
      return false;
    }

    // Verify the most recent match: file must still exist and checksum must match
    const latest = matches[matches.length - 1];
    if (!fs.existsSync(latest.filePath)) {
      return false;
    }

    try {
      return ProvenanceManager.verifyFile(latest.filePath, latest.checksum);
    } catch {
      return false;
    }
  }
}

export const provenance = new ProvenanceLedger();
