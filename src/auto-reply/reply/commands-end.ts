import { logVerbose } from "../../globals.js";
import type { CommandHandler } from "./commands-types.js";

export const handleEndCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (!/^\/end(?:\s|$)/.test(normalized)) {
    return null;
  }

  // Admin only
  if (!params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /end from unauthorized sender: ${params.command.senderId || "<unknown>"}`);
    return { shouldContinue: false };
  }

  const summary = "🛑 Emergency shutdown initiated. Shutting down the program immediately.";

  // Schedule shutdown — delay to let the reply send first
  setTimeout(() => {
    console.log("[end] Shutting down process as requested by /end command.");
    process.exit(0);
  }, 1000);

  return {
    shouldContinue: false,
    reply: { text: summary },
  };
};
