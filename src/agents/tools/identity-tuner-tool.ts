/**
 * Identity Tuner Tool — Enables ErnOS to surgically edit its own mutable identity.
 *
 * The identity prompt ends with a (MUTABLE) section. Everything after the
 * marker is self-defined by Ernos and persisted to ~/.ernos/identity-mutable.md.
 *
 * Operations: read, append, replace, delete, reset, rollback.
 *
 * Safety:
 *  - Only the mutable section can be edited (immutable core is protected)
 *  - Max 2000 characters
 *  - Last 5 versions kept for rollback
 *  - All edits logged
 */
import * as fs from "fs";
import * as path from "path";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";

const MUTABLE_DIR = path.join(process.env.HOME || "/tmp", ".ernos");
const MUTABLE_FILE = path.join(MUTABLE_DIR, "identity-mutable.md");
const BACKUP_DIR = path.join(MUTABLE_DIR, "identity-backups");
const MAX_LENGTH = 2000;
const MAX_BACKUPS = 5;

function ensureDirs(): void {
  if (!fs.existsSync(MUTABLE_DIR)) {
    fs.mkdirSync(MUTABLE_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function readMutable(): string {
  ensureDirs();
  if (!fs.existsSync(MUTABLE_FILE)) {
    return "";
  }
  return fs.readFileSync(MUTABLE_FILE, "utf-8");
}

function writeMutable(content: string): void {
  ensureDirs();

  // Create backup of current
  const current = readMutable();
  if (current.trim()) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(BACKUP_DIR, `identity-${timestamp}.md`);
    fs.writeFileSync(backupFile, current, "utf-8");

    // Prune old backups
    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("identity-") && f.endsWith(".md"))
      .toSorted()
      .toReversed();

    for (const old of backups.slice(MAX_BACKUPS)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
  }

  fs.writeFileSync(MUTABLE_FILE, content, "utf-8");
  console.log(`[identity-tuner] Updated mutable section (${content.length} chars)`);
}

function getBackups(): string[] {
  ensureDirs();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("identity-") && f.endsWith(".md"))
    .toSorted()
    .toReversed();
}

export function loadMutableIdentity(): string {
  return readMutable();
}

export function createIdentityTunerTool(): AnyAgentTool {
  return {
    name: "tune_identity",
    label: "Tune Identity",
    description:
      "Edit the mutable section of your identity prompt. " +
      "Operations: 'read' (view current), 'append' (add text), " +
      "'replace' (find+replace in mutable section), 'delete' (remove text), " +
      "'reset' (clear mutable section), 'rollback' (restore previous version). " +
      "Only the mutable section can be edited — core identity is protected. " +
      "Max 2000 characters. Last 5 versions kept for rollback.",
    parameters: Type.Object({
      operation: Type.String({
        description: "The edit operation: read, append, replace, delete, reset, or rollback.",
      }),
      text: Type.Optional(
        Type.String({
          description:
            "For 'append': text to append. " +
            "For 'replace': the replacement text (use 'target' for what to find). " +
            "For 'delete': text to remove.",
        }),
      ),
      target: Type.Optional(
        Type.String({
          description: "For 'replace': the exact text to find and replace.",
        }),
      ),
    }),
    async execute(_toolCallId: string, args: unknown) {
      const { operation, text, target } = args as {
        operation: string;
        text?: string;
        target?: string;
      };

      switch (operation) {
        case "read": {
          const content = readMutable();
          const result = content.trim()
            ? `**Mutable Identity Section** (${content.length}/${MAX_LENGTH} chars):\n\n${content}`
            : "Mutable identity section is empty. Use 'append' to add self-defined traits.";
          return { content: [{ type: "text" as const, text: result }], details: {} };
        }

        case "append": {
          if (!text?.trim()) {
            return {
              content: [{ type: "text" as const, text: "Error: 'text' is required for append." }],
              details: {},
            };
          }
          const current = readMutable();
          const newContent = current + (current.trim() ? "\n" : "") + text;
          if (newContent.length > MAX_LENGTH) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Would exceed ${MAX_LENGTH} char limit (${newContent.length} chars). Current: ${current.length} chars.`,
                },
              ],
              details: {},
            };
          }
          writeMutable(newContent);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Appended ${text.length} chars. Total: ${newContent.length}/${MAX_LENGTH}.`,
              },
            ],
            details: {},
          };
        }

        case "replace": {
          if (!target?.trim() || !text) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Both 'target' (text to find) and 'text' (replacement) are required.",
                },
              ],
              details: {},
            };
          }
          const current = readMutable();
          if (!current.includes(target)) {
            return {
              content: [
                { type: "text" as const, text: `Error: Target text not found in mutable section.` },
              ],
              details: {},
            };
          }
          const replaced = current.replace(target, text);
          if (replaced.length > MAX_LENGTH) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Replacement would exceed ${MAX_LENGTH} char limit (${replaced.length} chars).`,
                },
              ],
              details: {},
            };
          }
          writeMutable(replaced);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Replaced "${target.slice(0, 30)}..." → "${text.slice(0, 30)}...". Total: ${replaced.length}/${MAX_LENGTH}.`,
              },
            ],
            details: {},
          };
        }

        case "delete": {
          if (!text?.trim()) {
            return {
              content: [{ type: "text" as const, text: "Error: 'text' is required for delete." }],
              details: {},
            };
          }
          const current = readMutable();
          if (!current.includes(text)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Text to delete not found in mutable section.",
                },
              ],
              details: {},
            };
          }
          const deleted = current.replace(text, "").replace(/\n{3,}/g, "\n\n");
          writeMutable(deleted);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Deleted ${text.length} chars. Remaining: ${deleted.length}/${MAX_LENGTH}.`,
              },
            ],
            details: {},
          };
        }

        case "reset": {
          writeMutable("");
          return {
            content: [
              {
                type: "text" as const,
                text: "✅ Mutable identity section reset. Previous version saved for rollback.",
              },
            ],
            details: {},
          };
        }

        case "rollback": {
          const backups = getBackups();
          if (backups.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No backups available for rollback." }],
              details: {},
            };
          }
          const latest = backups[0];
          const restored = fs.readFileSync(path.join(BACKUP_DIR, latest), "utf-8");
          writeMutable(restored);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Rolled back to ${latest}. Restored ${restored.length} chars.`,
              },
            ],
            details: {},
          };
        }

        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown operation: ${operation}. Valid: read, append, replace, delete, reset, rollback.`,
              },
            ],
            details: {},
          };
      }
    },
  };
}
