/**
 * Autonomy Boot — Wires the AutonomyDaemon into ErnOS's gateway lifecycle.
 *
 * Connects the daemon's callbacks to the real agent pipeline:
 *   - processThought → enqueueSystemEvent (triggers agent run with full tools)
 *   - isUserActive → tracks last gateway WebSocket activity
 *   - onThought / onTransparencyReport → owner channel broadcast
 */

import { loadConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { AutonomyDaemon } from "./autonomy-daemon.js";
import { pushThought } from "./autonomy-log-buffer.js";

const log = createSubsystemLogger("autonomy");

/** Discord channel ID for autonomy trace posts */
const AUTONOMY_TRACE_CHANNEL = "channel:1407440722348740738";

/**
 * Fire-and-forget: post a message to the autonomy trace Discord channel.
 * Lazy-imports sendMessageDiscord to avoid circular dependencies at boot.
 */
function postToAutonomyChannel(text: string): void {
  void (async () => {
    try {
      const { sendMessageDiscord } = await import("../discord/send.outbound.js");
      await sendMessageDiscord(AUTONOMY_TRACE_CHANNEL, text, { silent: true });
    } catch (err) {
      log.warn(`Failed to post autonomy trace to Discord: ${err}`);
    }
  })();
}

let activeTimer: ReturnType<typeof setInterval> | null = null;
let lastUserActivityTimestamp = Date.now();
let agentRunning = false;

/**
 * Call this from gateway WebSocket handlers when a user sends a message.
 * Resets the idle timer so autonomy waits for idle again.
 */
export function markUserActive(): void {
  lastUserActivityTimestamp = Date.now();
}

/**
 * Call when an agent run starts. Prevents autonomy from firing mid-processing.
 */
export function markAgentRunning(): void {
  agentRunning = true;
}

/**
 * Call when an agent run finishes. Re-enables autonomy idle detection.
 */
export function markAgentIdle(): void {
  agentRunning = false;
  lastUserActivityTimestamp = Date.now(); // idle starts from when agent FINISHES
}

/**
 * Boot the autonomy daemon with real pipeline connections.
 *
 * @param enqueueSystemEvent The same callback used by cron to feed messages into sessions
 * @param broadcast Gateway broadcast function for transparency reports
 */
export function bootAutonomyDaemon(params: {
  enqueueSystemEvent: (message: string, opts: { sessionKey: string; contextKey?: string }) => void;
  broadcast: (event: string, data: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): AutonomyDaemon {
  const cfg = loadConfig();
  const mainSessionKey = resolveMainSessionKey(cfg);

  const daemon = new AutonomyDaemon({
    idleThresholdSeconds: 45,
    checkIntervalMs: 30_000, // Check every 30s (was 10s — too aggressive)
    transparencyIntervalMs: 30 * 60 * 1000,
    maxContextHistoryChars: 50_000,

    isUserActive: () => {
      // If an agent is currently processing, treat as active — never trigger autonomy mid-run.
      if (agentRunning) {return true;}
      const idleMs = Date.now() - lastUserActivityTimestamp;
      return idleMs < 10_000; // <10s = user still active
    },

    getLastInteractionTime: () => lastUserActivityTimestamp,

    processThought: async (
      input: string,
      context: string,
      systemContext: string,
    ): Promise<string> => {
      try {
        const { runWithObserverAudit } = await import("../agents/pi-embedded.js");
        const { resolveAgentWorkspaceDir, resolveDefaultAgentId } = await import("../agents/agent-scope.js");
        const { resolveSessionTranscriptPath } = await import("../config/sessions.js");
        const { resolveCronSkillsSnapshot } = await import("./isolated-agent/skills-snapshot.js");
        const crypto = await import("node:crypto");

        const agentId = resolveDefaultAgentId(cfg);
        const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
        const runId = crypto.randomUUID();
        // Give autonomy its own session file
        const sessionId = "autonomy-daemon";
        const sessionFile = resolveSessionTranscriptPath(sessionId, agentId);

        const skillsSnapshot = resolveCronSkillsSnapshot({
          workspaceDir,
          config: cfg,
          agentId,
          isFastTestEnv: false,
        });

        // Reset idle timer NOW so the daemon doesn't re-trigger immediately
        markUserActive();

        const result = await runWithObserverAudit({
          sessionId,
          sessionKey: mainSessionKey,
          agentId,
          sessionFile,
          workspaceDir,
          config: cfg,
          skillsSnapshot,
          senderIsOwner: true,
          senderName: "Autonomy Daemon",
          senderId: "system-autonomy",
          prompt: input,
          extraSystemPrompt: systemContext + (context ? `\n\n[CONTEXT HISTORY]\n${context}` : ""),
          runId,
          timeoutMs: 10 * 60 * 1000,
          lane: "autonomy",
          // Avoid enqueueing events back into the session loop implicitly
          requireExplicitMessageTarget: true,
          disableMessageTool: true, // we don't need it to use send_message, we just want thoughts
        });

        // Extract text from result payloads
        const responseText = result.payloads?.map((p: any) => p.text).filter(Boolean).join("\n") ?? "";

        // Reset idle again after processing completes
        markUserActive();

        return responseText || "<HALT>";
      } catch (err) {
        log.error(`[IMA] processThought failed: ${err}`);
        markUserActive();
        return "<HALT>";
      }
    },

    onThought: async (step: number, thought: string) => {
      log.info(`[IMA Step ${step}] ${thought.slice(0, 200)}`);
      pushThought(thought.slice(0, 200));
      params.broadcast(
        "autonomy.thought",
        { step, thought: thought.slice(0, 2000), timestamp: Date.now() },
        { dropIfSlow: true },
      );
      // Post to Discord autonomy trace channel
      postToAutonomyChannel(`🧠 **[IMA Step ${step}]** ${thought.slice(0, 1800)}`);
    },

    onTransparencyReport: async (report: string) => {
      log.info(`[IMA] Transparency report generated (${report.length} chars)`);
      // Send as system event so it appears in the session
      params.enqueueSystemEvent(`[AUTONOMY TRANSPARENCY REPORT]\n${report}`, {
        sessionKey: mainSessionKey,
        contextKey: "AUTONOMY_TRANSPARENCY",
      });
      // Also broadcast to UI
      params.broadcast("autonomy.report", { report, timestamp: Date.now() }, { dropIfSlow: true });
      // Post to Discord autonomy trace channel
      postToAutonomyChannel(`📊 **[IMA Transparency Report]**\n${report.slice(0, 1800)}`);
    },
  });

  log.info("[IMA] Autonomy daemon configured and starting...");
  void daemon.start();

  return daemon;
}

/**
 * Stop the autonomy daemon cleanly.
 */
export function stopAutonomyDaemon(daemon: AutonomyDaemon): void {
  daemon.stop();
  log.info("[IMA] Autonomy daemon stopped.");
}
