import { createOpencode } from "@opencode-ai/sdk";
import { type AnyAgentTool } from "./common.js";
// Ensure this matches your ErnOS Tool structures
export function createOpencodeAgentTool(options: { sessionKey?: string }): AnyAgentTool {
  return {
    name: "coder_agent",
    label: "OpenCode Agent",
    description: [
      "Use this tool when you need to make complex, multi-file code edits, refactorings, or build new features from scratch.",
      "The OpenCode agent is a persistent, stateful software engineering agent with its own LSP and environment access.",
      "Provide a highly detailed task description. The OpenCode agent will autonomously plan and execute the changes.",
      "Always use this for writing code instead of trying to edit multiple files manually using generic tools.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "The detailed coding task for the OpenCode agent to perform. Include all necessary context, target directories, and constraints.",
        },
        directory: {
          type: "string",
          description:
            "The absolute path to the target project directory. If omitted, defaults to the current workspace.",
        },
        agent: {
          type: "string",
          enum: ["build", "plan", "general"],
          description:
            "The OpenCode subagent profile to use. Default is 'build' (full edit access). Use 'plan' for read-only analysis.",
        },
      },
      required: ["task"],
    },
    execute: async (toolCallId, _params: unknown, _signal, _onUpdate) => {
      try {
        const params = _params as Record<string, unknown>;
        const targetDir = (params.directory as string) || process.cwd();
        const { extractPeerIdFromSessionKey } = await import("../../routing/session-key.js");
        let contextualizedTask = params.task as string;
        if (options.sessionKey) {
          const peerId = extractPeerIdFromSessionKey(options.sessionKey);
          if (peerId) {
            contextualizedTask =
              `[ERNOS CONTEXT]: You are executing a task for user ${peerId}.\n\n` +
              String(params.task);
          }
        }

        console.log(`[OpenCode] Spinning up SDK server in ${targetDir}...`);

        // Deep SDK Integration: Spin up the native OpenCode server
        const opencode = await createOpencode({
          // Run gracefully in the background
          port: 0, // auto-assign
          config: {
            logLevel: "INFO",
          },
        });

        console.log(`[OpenCode] SDK server ready at ${opencode.server.url}`);

        try {
          // 1. Create a Stateful Session
          const sessionRes = await opencode.client.session.create({
            body: {
              title: `ErnOS Task Hook: ${String(params.task).slice(0, 30)}...`,
            },
            query: { directory: targetDir },
          });

          const sessionId = sessionRes.data?.id;
          if (!sessionId) {
            throw new Error("Failed to create OpenCode session. No ID returned.");
          }

          console.log(`[OpenCode] Session spawned: ${sessionId}`);

          // 2. Dispatch the prompt
          console.log(
            `[OpenCode] Dispatching task to agent '${String(params.agent) || "build"}'...`,
          );
          await opencode.client.session.prompt({
            path: { id: sessionId },
            query: { directory: targetDir },
            body: {
              agent: typeof params.agent === "string" ? params.agent : "build",
              parts: [{ type: "text", text: contextualizedTask }],
            },
          });

          // The prompt endpoint in OpenCode triggers the agent. Depending on the OpenCode version,
          // it may block until complete, or we may need to poll session.status.
          // We will do a generic wait for completion by checking the status.

          let isDone = false;
          let attempts = 0;
          let finalStatus = "unknown";

          while (!isDone && attempts < 120) {
            // Poll every 5 seconds (up to 10 minutes)
            await new Promise((r) => setTimeout(r, 5000));
            const statusRes = await opencode.client.session.status({
              query: { directory: targetDir },
            });
            const status = statusRes.data?.[sessionId];

            if (!status || status.type === "idle") {
              isDone = true;
              finalStatus = status?.type || "idle";
            }
            attempts++;
          }

          // 3. Summarize the output
          let summary = `OpenCode execution finished with status: ${finalStatus}.\n\n`;
          try {
            // Fetch messages to provide a summary
            const msgsRes = await opencode.client.session.messages({
              path: { id: sessionId },
              query: { directory: targetDir },
            });
            const msgs = msgsRes.data || [];
            const agentMsgs = msgs.filter(
              (m: { info?: { role: string }; parts?: unknown[] }) =>
                m.info?.role === "assistant" && m.parts && m.parts.length > 0,
            );
            const lastMsg = agentMsgs[agentMsgs.length - 1];
            if (lastMsg) {
              const text = lastMsg.parts
                .map(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (p: any) => p.text || p.content || JSON.stringify(p),
                )
                .join("\\n");
              summary += `Final Agent Note:\n${text}\n`;
            }
          } catch {
            // Ignore message fetch errors
          }

          return {
            success: true,
            content: [{ type: "text", text: summary }],
            details: {},
          };
        } finally {
          // Always teardown the local server to prevent orphans
          console.log(`[OpenCode] Tearing down SDK server...`);
          opencode.server.close();
        }
      } catch (error: unknown) {
        const errObj = error as Error;
        const errStr = errObj.message || String(error);
        console.error(`[OpenCode Tool Error]:`, errStr);
        if (errStr.includes("ENOENT") || errStr.includes("command not found")) {
          return {
            success: false,
            content: [{ type: "text", text: "OpenCode CLI is not installed or available on the PATH. Cannot execute. Please install OpenCode." }],
            details: {},
            error: "ENOENT",
          };
        }
        return {
          success: false,
          content: [{ type: "text", text: errStr }],
          details: {},
          error: errStr,
        };
      }
    },
  };
}
