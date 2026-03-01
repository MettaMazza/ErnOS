export const BARE_SESSION_RESET_PROMPT =
  "A new session was started via /new or /reset. Execute your Session Startup sequence now - read the required files before responding to the user. " +
  "CRITICAL: Before greeting the user, you MUST call memory_search with a broad query (e.g. the user's name or 'recent conversations') to recall prior context about this user. " +
  "Use what you find to greet them personally — reference things you remember about them, their projects, preferences, or recent work. " +
  "If memory_search returns nothing, greet them warmly as a new acquaintance. " +
  "Then greet the user in your configured persona, if one is provided. Be yourself - use your defined voice, mannerisms, and mood. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning.";
