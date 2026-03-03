import type { ErnOSConfig } from "../config/config.js";
import { resolvePluginTools } from "../plugins/tools.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import { resolveSessionAgentId } from "./agent-scope.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import type { ToolFsPolicy } from "./tool-fs-policy.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createBrowserTool } from "./tools/browser-tool.js";
import { createCalendarTools } from "./tools/calendar-tools-def.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createDevTeamTool } from "./tools/devteam-tool.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createArtifactTools } from "./tools/artifact-tools-def.js";
import { createGoalsTools } from "./tools/goals-tools-def.js";
import { createImageTool } from "./tools/image-tool.js";
import { generateImage } from "./tools/image-generation-tool.js";
import { createIntentionTools } from "./tools/intentions-tools-def.js";
import { createIntrospectionTools } from "./tools/introspection-tools.js";
import { createMessageTool } from "./tools/message-tool.js";
import { createMiscTools } from "./tools/misc-tools-def.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createOutreachTool } from "./tools/outreach-tool.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSubagentsTool } from "./tools/subagents-tool.js";
import { createSwarmTools } from "./tools/swarm-tools-def.js";
import { createTapeTools } from "./tools/tape-tools-def.js";
import { createTtsTool } from "./tools/tts-tool.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web-tools.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

export function createErnOSTools(options?: {
  sandboxBrowserBridgeUrl?: string;
  allowHostBrowserControl?: boolean;
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  /** Delivery target (e.g. telegram:group:123:topic:456) for topic/thread routing. */
  agentTo?: string;
  /** Thread/topic identifier for routing replies to the originating thread. */
  agentThreadId?: string | number;
  /** Group id for channel-level tool policy inheritance. */
  agentGroupId?: string | null;
  /** Group channel label for channel-level tool policy inheritance. */
  agentGroupChannel?: string | null;
  /** Group space label for channel-level tool policy inheritance. */
  agentGroupSpace?: string | null;
  agentDir?: string;
  sandboxRoot?: string;
  sandboxFsBridge?: SandboxFsBridge;
  fsPolicy?: ToolFsPolicy;
  workspaceDir?: string;
  sandboxed?: boolean;
  config?: ErnOSConfig;
  pluginToolAllowlist?: string[];
  /** Current channel ID for auto-threading (Slack). */
  currentChannelId?: string;
  /** Current thread timestamp for auto-threading (Slack). */
  currentThreadTs?: string;
  /** Current inbound message id for action fallbacks (e.g. Telegram react). */
  currentMessageId?: string | number;
  /** Reply-to mode for Slack auto-threading. */
  replyToMode?: "off" | "first" | "all";
  /** Mutable ref to track if a reply was sent (for "first" mode). */
  hasRepliedRef?: { value: boolean };
  /** If true, the model has native vision capability */
  modelHasVision?: boolean;
  /** Explicit agent ID override for cron/hook sessions. */
  requesterAgentIdOverride?: string;
  /** Require explicit message targets (no implicit last-route sends). */
  requireExplicitMessageTarget?: boolean;
  /** If true, omit the message tool from the tool list. */
  disableMessageTool?: boolean;
  /** Trusted sender id from inbound context (not tool args). */
  requesterSenderId?: string | null;
  /** Whether the requesting sender is an owner. */
  senderIsOwner?: boolean;
}): AnyAgentTool[] {
  const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir);
  const imageTool = options?.agentDir?.trim()
    ? createImageTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        sandbox:
          options?.sandboxRoot && options?.sandboxFsBridge
            ? { root: options.sandboxRoot, bridge: options.sandboxFsBridge }
            : undefined,
        fsPolicy: options?.fsPolicy,
        modelHasVision: options?.modelHasVision,
      })
    : null;
  const webSearchTool = createWebSearchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
  });
  const webFetchTool = createWebFetchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
  });
  const messageTool = options?.disableMessageTool
    ? null
    : createMessageTool({
        agentAccountId: options?.agentAccountId,
        agentSessionKey: options?.agentSessionKey,
        config: options?.config,
        currentChannelId: options?.currentChannelId,
        currentChannelProvider: options?.agentChannel,
        currentThreadTs: options?.currentThreadTs,
        currentMessageId: options?.currentMessageId,
        replyToMode: options?.replyToMode,
        hasRepliedRef: options?.hasRepliedRef,
        sandboxRoot: options?.sandboxRoot,
        requireExplicitTarget: options?.requireExplicitMessageTarget,
        requesterSenderId: options?.requesterSenderId ?? undefined,
        groupSpace: options?.agentGroupSpace ?? undefined,
      });
  const tools: AnyAgentTool[] = [
    createBrowserTool({
      sandboxBridgeUrl: options?.sandboxBrowserBridgeUrl,
      allowHostControl: options?.allowHostBrowserControl,
    }),
    createCanvasTool({ config: options?.config }),
    createNodesTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      config: options?.config,
    }),
    createCronTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    ...(messageTool ? [messageTool] : []),
    createTtsTool({
      agentChannel: options?.agentChannel,
      config: options?.config,
    }),
    createGatewayTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createAgentsListTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    createSessionsListTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsHistoryTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsSendTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      sandboxed: options?.sandboxed,
    }),
    createSessionsSpawnTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      agentTo: options?.agentTo,
      agentThreadId: options?.agentThreadId,
      agentGroupId: options?.agentGroupId,
      agentGroupChannel: options?.agentGroupChannel,
      agentGroupSpace: options?.agentGroupSpace,
      sandboxed: options?.sandboxed,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    createSubagentsTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createSessionStatusTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    ...(webSearchTool ? [webSearchTool] : []),
    ...(webFetchTool ? [webFetchTool] : []),
    ...(imageTool ? [imageTool] : []),
    ...(createTapeTools(options?.agentAccountId || "unknown-user") as any as AnyAgentTool[]),
    ...(createCalendarTools(options?.agentAccountId || "unknown-user") as any as AnyAgentTool[]),
    ...(createArtifactTools() as any as AnyAgentTool[]),
    ...(createGoalsTools() as any as AnyAgentTool[]),
    ...(createIntentionTools() as any as AnyAgentTool[]),
    ...(createMiscTools(options?.agentAccountId || "unknown-user") as any as AnyAgentTool[]),
    ...(createSwarmTools(options?.agentAccountId || "unknown-user") as any as AnyAgentTool[]),
    ...(createIntrospectionTools() as any as AnyAgentTool[]),
    createDevTeamTool({
      config: options?.config,
      agentAccountId: options?.agentAccountId,
    }),
    createOutreachTool() as any,
    {
      label: "Image Gen",
      name: "image_gen",
      description:
        "Generate an image from a text prompt using the local Flux model (diffusers on MPS). Runs locally — no cloud API needed.",
      parameters: {
        type: "object" as const,
        properties: {
          prompt: { type: "string" as const, description: "Detailed description of the image to generate" },
          size: { type: "string" as const, enum: ["1024x1024", "1024x1792", "1792x1024"], description: "Image dimensions (default: 1024x1024)" },
          quality: { type: "string" as const, enum: ["standard", "hd"], description: "Image quality (default: standard)" },
        },
        required: ["prompt"],
      },
      execute: async (_toolCallId: string, args: unknown) => {
        const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
        const prompt = typeof record.prompt === "string" ? record.prompt : "";
        if (!prompt.trim()) {
          return { content: [{ type: "text", text: "Error: prompt is required." }] };
        }
        const result = await generateImage({
          prompt,
          size: (record.size as "1024x1024" | "1024x1792" | "1792x1024") || "1024x1024",
          quality: (record.quality as "standard" | "hd") || "standard",
        });
        if (!result.success) {
          return { content: [{ type: "text", text: `Image generation failed: ${result.error}` }] };
        }
        return {
          content: [{ type: "text", text: `Image generated successfully.\nMEDIA:${result.path}` }],
          details: { path: result.path, provider: result.provider },
        };
      },
    } as AnyAgentTool,
  ];

  const pluginTools = resolvePluginTools({
    context: {
      config: options?.config,
      workspaceDir,
      agentDir: options?.agentDir,
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
      sessionKey: options?.agentSessionKey,
      messageChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      sandboxed: options?.sandboxed,
    },
    existingToolNames: new Set(tools.map((tool) => tool.name)),
    toolAllowlist: options?.pluginToolAllowlist,
  });

  return [...tools, ...pluginTools];
}
