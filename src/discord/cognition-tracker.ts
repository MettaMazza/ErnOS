/**
 * CognitionTracker — Live-updating Discord embed for cognition visibility.
 *
 * Ported from ErnOS V3 `src/engines/cognition_tracker.py`.
 *
 * Posts a single embed when processing starts, edits it as tools fire,
 * and finalizes to a "complete" state when the response is delivered.
 *
 * This gives users real-time feedback on what Ernos is doing — like
 * Claude's "Thinking..." but showing actual actions.
 */
import { Embed, serializePayload, type RequestClient } from "@buape/carbon";
import { Routes } from "discord-api-types/v10";
import { resolveToolDisplay } from "../agents/tool-display.js";

/** Minimum interval between Discord message edits (ms). */
const EDIT_DEBOUNCE_MS = 800;

/** Discord embed color: blurple (processing). */
const COLOR_PROCESSING = 0x5865f2;

/** Discord embed color: green (complete). */
const COLOR_COMPLETE = 0x57f287;

/** Discord embed color: red (error). */
const COLOR_ERROR = 0xed4245;

/** Maximum completed tools to show in the live view. */
const MAX_LIVE_TOOLS = 4;

/** Maximum completed tools to show in the final view. */
const MAX_FINAL_TOOLS = 8;

export class CognitionTracker {
  private rest: RequestClient;
  private channelId: string;
  private messageId: string | undefined;
  private statusLines: string[] = [];
  private currentAction = "";
  private toolCount = 0;
  private startTime = 0;
  private lastEditTime = 0;
  private pendingUpdate = false;
  private deferredTimer: ReturnType<typeof setTimeout> | undefined;

  private textBuffer: string[] = [];

  constructor(params: { rest: RequestClient; channelId: string }) {
    this.rest = params.rest;
    this.channelId = params.channelId;
  }

  /** Post the initial "Processing..." embed. */
  async start(): Promise<void> {
    try {
      this.startTime = Date.now();
      const embed = new Embed({
        description: "```\n⏳ Processing...\n```",
        color: COLOR_PROCESSING,
      });
      const payload = serializePayload({ embeds: [embed] });
      const result = (await this.rest.post(Routes.channelMessages(this.channelId), {
        body: payload,
      })) as { id: string };
      this.messageId = result?.id;
    } catch {
      // Non-fatal — tracker is optional UX
      this.messageId = undefined;
    }
  }

  /** Append text to the embedded status (e.g. intermediate replies) */
  async updateText(text: string): Promise<void> {
    if (!this.messageId || !text.trim()) {
      return;
    }
    this.textBuffer.push(text.trim());
    this.pendingUpdate = true;
    await this.flush();
  }

  /** Update with a tool that's about to run. Auto-completes the previous tool. */
  async updateTool(toolName?: string, args?: unknown): Promise<void> {
    if (!this.messageId) {
      return;
    }
    // Auto-complete the previous tool
    if (this.currentAction) {
      this.statusLines.push(this.currentAction);
      this.toolCount++;
    }
    const display = resolveToolDisplay({ name: toolName, args });
    this.currentAction = `${display.emoji} ${display.label}`;
    this.pendingUpdate = true;
    await this.flush();
  }

  /** Record that the model is reasoning/thinking. */
  async updateThinking(): Promise<void> {
    if (!this.messageId) {
      return;
    }
    // Auto-complete any pending tool
    if (this.currentAction && this.currentAction !== "🧠 Reasoning...") {
      this.statusLines.push(this.currentAction);
      this.toolCount++;
    }
    this.currentAction = "🧠 Reasoning...";
    this.pendingUpdate = true;
    await this.flush();
  }

  /** Edit the embed into its final "complete" state. */
  async finalize(error?: boolean): Promise<void> {
    if (!this.messageId) {
      return;
    }
    if (this.deferredTimer) {
      clearTimeout(this.deferredTimer);
      this.deferredTimer = undefined;
    }
    // Auto-complete the last tool
    if (this.currentAction && this.currentAction !== "🧠 Reasoning...") {
      this.statusLines.push(this.currentAction);
      this.toolCount++;
      this.currentAction = "";
    }

    try {
      const elapsed = this.formatElapsed();
      const lines: string[] = [];

      // Header
      if (error) {
        lines.push(`❌ Error (${elapsed})`);
      } else if (this.toolCount > 0) {
        lines.push(
          `✅ Complete — ${this.toolCount} tool${this.toolCount === 1 ? "" : "s"} (${elapsed})`,
        );
      } else {
        lines.push(`✅ Complete (${elapsed})`);
      }

      // Tool chain (up to MAX_FINAL_TOOLS)
      if (this.statusLines.length > 0) {
        const shown = this.statusLines.slice(-MAX_FINAL_TOOLS);
        if (this.statusLines.length > MAX_FINAL_TOOLS) {
          lines.push(`│ ... ${this.statusLines.length - MAX_FINAL_TOOLS} earlier tools`);
        }
        for (const line of shown) {
          lines.push(`│ ✓ ${line}`);
        }
      }

      // Persist intermediate text messages (e.g. mid-task replies)
      if (this.textBuffer.length > 0) {
        lines.push("");
        lines.push("---");
        for (const text of this.textBuffer) {
          lines.push(`💬 *${text}*`);
        }
      }

      const content = this.truncateContent(lines.join("\n"));
      const color = error ? COLOR_ERROR : COLOR_COMPLETE;
      await this.editEmbed(content, color);
    } catch {
      // Non-fatal
    } finally {
      this.messageId = undefined;
    }
  }

  /** Get the tracker's message ID (for cleanup). */
  getMessageId(): string | undefined {
    return this.messageId;
  }

  // --- Internal ---

  private async flush(): Promise<void> {
    if (!this.messageId || !this.pendingUpdate) {
      return;
    }

    const now = Date.now();
    if (now - this.lastEditTime < EDIT_DEBOUNCE_MS) {
      // Schedule a deferred flush
      if (!this.deferredTimer) {
        const remaining = EDIT_DEBOUNCE_MS - (now - this.lastEditTime);
        this.deferredTimer = setTimeout(() => {
          this.deferredTimer = undefined;
          if (this.pendingUpdate) {
            void this.doEdit();
          }
        }, remaining);
      }
      return;
    }
    await this.doEdit();
  }

  private async doEdit(): Promise<void> {
    if (!this.messageId || !this.pendingUpdate) {
      return;
    }

    this.pendingUpdate = false;
    this.lastEditTime = Date.now();

    const elapsed = this.formatElapsed();
    const lines: string[] = [];

    // Header
    if (this.toolCount > 0) {
      lines.push(`⚡ ${this.toolCount} tool${this.toolCount === 1 ? "" : "s"} (${elapsed})`);
    } else {
      lines.push(`⏳ Thinking... (${elapsed})`);
    }

    // Completed tools (last MAX_LIVE_TOOLS)
    if (this.statusLines.length > 0) {
      if (this.statusLines.length > MAX_LIVE_TOOLS) {
        lines.push(`│ ... ${this.statusLines.length - MAX_LIVE_TOOLS} earlier tools`);
      }
      const recent = this.statusLines.slice(-MAX_LIVE_TOOLS);
      for (const line of recent) {
        lines.push(`│ ✓ ${line}`);
      }
    }

    // Current action
    if (this.currentAction) {
      lines.push(`▶ ⏳ ${this.currentAction}`);
    } else {
      lines.push("└─ 🧠 Reasoning...");
    }

    // Text buffer
    if (this.textBuffer.length > 0) {
      lines.push("");
      lines.push("---");
      for (const text of this.textBuffer.slice(-3)) {
        // Show up to the last 3 chunks to prevent massive embeds
        lines.push(`💬 *${text}*`);
      }
    }

    const content = this.truncateContent(lines.join("\n"));
    try {
      await this.editEmbed(content, COLOR_PROCESSING);
    } catch {
      // Non-fatal
    }
  }

  private async editEmbed(content: string, color: number): Promise<void> {
    const embed = new Embed({ description: `\`\`\`\n${content}\n\`\`\``, color });
    const payload = serializePayload({ embeds: [embed] });
    await this.rest.patch(Routes.channelMessage(this.channelId, this.messageId!), {
      body: payload,
    });
  }

  private formatElapsed(): string {
    const ms = Date.now() - this.startTime;
    const seconds = ms / 1000;
    return seconds < 60 ? `${seconds.toFixed(0)}s` : `${(seconds / 60).toFixed(1)}m`;
  }

  private truncateContent(content: string): string {
    return content.length > 3900 ? content.slice(0, 3900) + "\n... (trimmed)" : content;
  }
}
