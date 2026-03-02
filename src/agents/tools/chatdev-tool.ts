import { Type } from "@sinclair/typebox";
import type { WorkflowEvent } from "../../chatdev/bridge.js";
import type { ErnOSConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam, ToolInputError } from "./common.js";

const log = createSubsystemLogger("chatdev-orchestrator-tool");

export const ChatDevOrchestratorSchema = Type.Object({
  workflow: Type.String({
    description: "YAML workflow filename (e.g. 'ChatDev_v1.yaml', 'deep_research_v1.yaml').",
  }),
  prompt: Type.String({
    description: "Detailed task prompt for the multi-agent workflow. Be comprehensive.",
  }),
  directory: Type.Optional(
    Type.String({
      description: "Optional relative directory name for output context. Default is root.",
    }),
  ),
});

// Singleton sidecar tracking matching devteam-tool
let sidecarInstance: import("../../chatdev/sidecar.js").ChatDevSidecar | null = null;
let bridgeInstance: import("../../chatdev/bridge.js").ChatDevBridge | null = null;
let registryInstance: import("../../chatdev/workflow-registry.js").WorkflowRegistry | null = null;

async function ensureSidecar(config?: ErnOSConfig) {
  if (sidecarInstance) {
    return { sidecar: sidecarInstance, bridge: bridgeInstance!, registry: registryInstance! };
  }

  const cfg = config ?? loadConfig();
  const chatdevPath =
    ((cfg as Record<string, unknown>).chatdevPath as string) ??
    `${process.env.HOME}/Desktop/ChatDev`;

  const { ChatDevSidecar } = await import("../../chatdev/sidecar.js");
  const { ChatDevBridge } = await import("../../chatdev/bridge.js");
  const { WorkflowRegistry } = await import("../../chatdev/workflow-registry.js");

  sidecarInstance = new ChatDevSidecar({
    chatdevPath,
    port: 8766,
    host: "127.0.0.1",
    pythonCommand: `${process.env.HOME}/.local/bin/uv run`,
    autoRestart: true,
  });

  await sidecarInstance.start();

  bridgeInstance = new ChatDevBridge(sidecarInstance);
  registryInstance = new WorkflowRegistry(chatdevPath);

  return { sidecar: sidecarInstance, bridge: bridgeInstance, registry: registryInstance };
}

/**
 * Creates the synchronous ChatDev deep-integration tool.
 * This mirrors OpenCode's blocking execution but uses ChatDev's multi-agent workflow architecture.
 */
export function createChatDevOrchestratorTool(options: {
  config?: ErnOSConfig;
  sessionKey?: string;
}): AnyAgentTool {
  return {
    label: "ChatDev Orchestrator",
    name: "chatdev_orchestrator",
    description: [
      "Launch a fully autonomous, multi-agent ChatDev software team to perform complete project builds or intensive research.",
      "DEEP INTEGRATION: This tool runs synchronously and blocks until the entire ChatDev workflow is complete (can take 5-15 mins).",
      "Do NOT use this for tiny file adjustments. Use coder_agent (OpenCode) for single-file or targeted refactors.",
      "Use this when you want an entire simulated virtual company to design, spec, code, and review a project from scratch.",
    ].join("\n"),
    parameters: ChatDevOrchestratorSchema,
    ownerOnly: true,
    execute: async (_toolCallId, args, _signal) => {
      const params = args as Record<string, unknown>;
      const workflow = readStringParam(params, "workflow", { required: true });
      const prompt = readStringParam(params, "prompt", { required: true });
      // const directory = readStringParam(params, "directory", { required: false });

      try {
        log.info(`[ChatDev Deep] Booting Sidecar...`);
        const { bridge } = await ensureSidecar(options.config);

        // Inject ErnOS persistent memory context into the task if available
        let contextualizedTask = prompt;
        let peerId: string | undefined;

        if (options.sessionKey) {
          const { extractPeerIdFromSessionKey } = await import("../../routing/session-key.js");
          peerId = extractPeerIdFromSessionKey(options.sessionKey) || undefined;
          if (peerId) {
            contextualizedTask =
              `[ERNOS CONTEXT]: You are a multi-agent team building this for user ${peerId}.\n\n` +
              prompt;
          }
        }

        const sessionName = `deep_cd_${Date.now()}`;
        log.info(
          `[ChatDev Deep] Found Sidecar. Launching workflow '${workflow}' as '${sessionName}'. Blocking until completion.`,
        );

        // Event listener array to capture agent chatter for the summary timeline
        const eventLog: string[] = [];

        // Attach an event handler to suck the sideband chatter into our return payload
        const onEvent = (event: WorkflowEvent) => {
          if (event.type === "agent_message" && event.content) {
            eventLog.push(`[${event.agentRole || "Agent"}]: ${event.content.substring(0, 150)}...`);
          } else if (event.type === "workflow_error") {
            eventLog.push(`[ERROR]: ${event.error}`);
          }
        };

        // Bridge executeWorkflow is promise-based and resolves when ChatDev fires 'workflow_complete' or 'workflow_error'
        const result = await bridge.executeWorkflow(
          {
            yamlFile: workflow,
            taskPrompt: contextualizedTask,
            sessionName,
            userId: peerId,
          },
          onEvent,
        );

        // Build a detailed summary return string bridging into ErnOS memory
        let summaryText = `## ChatDev Execution Finished (${result.status})\n\n`;
        summaryText += `**Session Name:** ${result.sessionName}\n`;
        summaryText += `**Output Directory:** ${result.outputDir}\n`;

        if (result.finalMessage) {
          summaryText += `\n### Final Architecture / Message:\n${result.finalMessage}\n`;
        }

        if (result.tokenUsage) {
          summaryText += `\n### Token Stats:\n\`\`\`json\n${JSON.stringify(result.tokenUsage, null, 2)}\n\`\`\`\n`;
        }

        summaryText += `\n### Agent Collaboration Log (Truncated):\n`;
        summaryText += eventLog.slice(-15).join("\n") || "No distinct chatter captured.";

        return {
          success: result.status === "completed",
          content: [
            {
              type: "text",
              text: summaryText,
            },
          ],
          details: result,
        };
      } catch (err: unknown) {
        if (err instanceof ToolInputError) {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[ChatDev Deep] Fatal execution error: ${msg}`);

        return {
          success: false,
          error: msg,
          content: [{ type: "text", text: `ChatDev Orchestration Failed: ${msg}` }],
          details: {},
        };
      }
    },
  };
}
