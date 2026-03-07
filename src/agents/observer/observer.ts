/**
 * Observer System — Skeptic Audit (ported from ErnOS 3.0 AuditAbility + IntegrityAuditor)
 *
 * Evaluates every outgoing response against the Skeptic ruleset via an actual LLM call.
 * Checks for hallucinations, sycophancy, ghost tools, confabulation, and image fabrication.
 *
 * In v3 this was `systems/auditor/audit.py` + `bot/integrity_auditor.py`.
 * The mocked `verdictRaw = 'ALLOWED'` is replaced with a real Ollama call.
 */

import { OLLAMA_NATIVE_BASE_URL } from "../ollama-stream.js";
import { SKEPTIC_AUDIT_PROMPT } from "./observer-prompt.js";

export interface AuditResult {
  allowed: boolean;
  reason?: string;
  guidance?: string;
}

/**
 * Calls the local Ollama instance to evaluate the audit prompt.
 * Uses /api/chat with streaming=true so we don't block Ollama's pipeline.
 * No timeout — let the model take as long as it needs.
 */
async function callOllamaAudit(prompt: string, model: string): Promise<string> {
  const requestBody = JSON.stringify({
    model: model,
    messages: [{ role: "user", content: prompt }],
    stream: true,
    options: {
      temperature: 0.1,
      num_predict: 256,
    },
    keep_alive: -1,
  });

  // Qwen 35B can take up to 7-8 minutes to evaluate the massive Skeptic prompt on slow hardware.
  // Node's default fetch (Undici) has a hardcoded headersTimeout of 5 minutes (300,000ms),
  // which aborts the request even if an AbortController allows more time.
  // We use the undici library explicitly to provide a custom dispatcher allowing 15 minutes.
  const { fetch: undiciFetch, Agent } = await import("undici");

  try {
    const res = await undiciFetch(`${OLLAMA_NATIVE_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
      dispatcher: new Agent({
        headersTimeout: 15 * 60 * 1000,
        bodyTimeout: 15 * 60 * 1000,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama audit call failed (${res.status}): ${text}`);
    }

    if (!res.body) {
      throw new Error("Ollama audit returned empty response body");
    }

    // Stream the response — each NDJSON line has { message: { content: "..." }, done: bool }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {break;}

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {continue;}
        try {
          const chunk = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
          if (chunk.message?.content) {
            result += chunk.message.content;
          }
          if (chunk.done) {
            return result.trim();
          }
        } catch {
          // Skip malformed NDJSON lines
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim()) as { message?: { content?: string } };
        if (chunk.message?.content) {
          result += chunk.message.content;
        }
      } catch {
        // Skip
      }
    }

    return result.trim();
  } catch (err) {
    throw new Error(`Ollama audit fetch aborted or failed: ${String(err)}`, { cause: err });
  }
}

export class ObserverSystem {
  /**
   * Circuit Breaker: Symbolic Validation of claims vs execution.
   * Prevents 'Ghost Tools' completely without LLM involvement.
   */
  private verifyResponseIntegrity(
    responseLower: string,
    toolOutputs: Array<{ name: string }>,
  ): AuditResult | null {
    const claims: Record<string, string[]> = {
      "checked the code": ["search_codebase", "read_file", "grep_search"],
      "scanned the files": ["search_codebase", "read_file", "list_dir"],
      "verified in the database": ["search_knowledge_graph", "read_file", "grep_search"],
      "consulted the science lobe": ["consult_science_lobe", "consult_science"],
      "ran a simulation": ["consult_science_lobe", "run_python"],
      "checked your memory": ["recall", "search_timeline", "search_knowledge_graph"],
      "checked the timeline": ["search_timeline", "recall"],
      "reviewed our history": ["recall", "search_timeline"],
      "according to the graph": ["search_knowledge_graph", "recall"],
      "empirically confirmed": ["consult_science_lobe", "run_python", "check_reality"],
      "checked reality": ["check_reality", "search_web", "google_search"],
    };

    const executedTools = new Set(toolOutputs.map((t) => t.name));
    const violations: string[] = [];

    for (const [phrase, requiredTools] of Object.entries(claims)) {
      if (responseLower.includes(phrase)) {
        const hasProof = requiredTools.some((tool) => executedTools.has(tool));
        if (!hasProof) {
          violations.push(`Claimed '${phrase}' without executing ${requiredTools.join(" or ")}`);
        }
      }
    }

    if (violations.length > 0) {
      const reason = violations.join("; ");
      console.warn(`[Observer] Symbolic Integrity Violation: ${reason}`);
      return {
        allowed: false,
        reason: "GHOST_TOOL_DETECTED: " + reason,
        guidance:
          "Do not claim to have used tools you didn't execute. Either use the tool or accurately state you don't know without checking.",
      };
    }
    return null;
  }

  /**
   * Evaluates an outgoing response against the strict Skeptic ruleset.
   * Checks for hallucinations, sycophancy, ghost tools, and confabulation.
   *
   * Ported from ErnOS 3.0 `AuditAbility.audit_response()`.
   */
  public async auditResponse(
    userMsg: string,
    botMsg: string,
    toolOutputs: Array<{ name: string; output: any }> = [],
    historyLines: string[] = [],
    systemContext: string = "NONE",
    conversationContext: string = "NO CONVERSATION CONTEXT AVAILABLE.",
    imageCount: number = 0,
    model: string = "qwen3.5:35b",
  ): Promise<AuditResult> {
    if (!botMsg || botMsg.length < 50) {return { allowed: true };} // Short-circuit for simple messages

    // 0. Symbolic Pre-filter (Instantly catch ghost tools)
    const symbolicCheck = this.verifyResponseIntegrity(botMsg.toLowerCase(), toolOutputs);
    if (symbolicCheck) {return symbolicCheck;}

    // 1. Format current turn tool context (same as v3 AuditAbility)
    const currentContext =
      toolOutputs.length > 0
        ? toolOutputs.map((t) => `- ${t.name}: ${JSON.stringify(t.output)}`).join("\n")
        : "NO TOOLS EXECUTED THIS TURN.";

    // 2. Format session history (last 20 tools from previous turns)
    const historyContext =
      historyLines.length > 0 ? historyLines.slice(-20).join("\n") : "NO RECENT TOOL HISTORY.";

    // 3. Vision status — critical for catching image hallucination (from v3 audit.py lines 38-60)
    let visionStatus: string;
    if (imageCount > 0) {
      visionStatus = `NATIVE MULTIMODAL VISION ACTIVE: ${imageCount} image(s) passed directly to the model. The AI can analyze images without vision tool calls.`;
    } else {
      // Check conversation context for provenance markers (v3 pattern)
      const provenanceMarkers = [
        "[SELF-GENERATED IMAGE:",
        "[EXTERNAL:USER IMAGE:",
        "[RECALLED FROM PRIOR TURN]",
        "[UNVERIFIED IMAGE:",
      ];
      const hasProvenance = provenanceMarkers.some((m) => conversationContext.includes(m));
      if (hasProvenance) {
        visionStatus =
          "NO IMAGES IN CURRENT MESSAGE, but conversation history contains provenance-verified image references from prior turns. The AI may reference these images based on its prior visual analysis. This is NOT hallucination.";
      } else {
        visionStatus =
          "NO IMAGES PROVIDED. Any description of visual content the AI claims to see is hallucination.";
      }
    }

    // 4. Render the prompt (same template substitution as v3)
    const currentDatetime = new Date().toISOString();
    const prompt = SKEPTIC_AUDIT_PROMPT.replace("{currentDatetime}", currentDatetime)
      .replace("{userLastMsg}", userMsg)
      .replace("{responseText}", botMsg.slice(0, 6000)) // Cap response length — must be large enough to catch hallucinations in long responses
      .replace("{toolContext}", currentContext + `\n\n[VISION STATUS]: ${visionStatus}`)
      .replace("{historyContext}", historyContext)
      .replace("{trustedSystemContext}", systemContext)
      .replace("{conversationContext}", conversationContext.slice(0, 8000));

    // 5. Call Ollama for real audit (replaces the mocked 'ALLOWED')
    console.log(`[Observer] Running Skeptic Audit on candidate response using model: ${model}...`);
    let verdictRaw: string;
    try {
      verdictRaw = await callOllamaAudit(prompt, model);
    } catch (err) {
      // Fail open to prevent paralysis during error (same as v3 audit.py line 108)
      console.error(`[Observer] Audit LLM call failed: ${String(err)}`);
      return { allowed: true, reason: `Audit error: ${String(err)}` };
    }

    if (!verdictRaw) {
      return { allowed: true };
    }

    console.log(`[Observer] Skeptic verdict: ${verdictRaw.slice(0, 200)}`);

    console.log(`[Observer] Skeptic verdict: ${verdictRaw.slice(0, 200)}`);

    // 6. Parse JSON verdict
    try {
      let cleanedRaw = verdictRaw;
      const jsonMatch = verdictRaw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
      if (jsonMatch) {
        cleanedRaw = jsonMatch[1];
      } else {
        const start = verdictRaw.indexOf('{');
        const end = verdictRaw.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          cleanedRaw = verdictRaw.slice(start, end + 1);
        }
      }
      cleanedRaw = cleanedRaw.trim();
      const parsed = JSON.parse(cleanedRaw);
      const isAllowed =
        parsed.verdict === "ALLOWED" || parsed.verdict === "PASS" || parsed.verdict === "APPROVED";

      if (isAllowed) {
        console.log("[Observer] Skeptic Audit PASSED");
        return { allowed: true };
      }

      const reason = parsed.reason || "Unspecified audit violation";
      const guidance =
        parsed.guidance ||
        "Correct the response: do not hallucinate, fabricate, or blindly agree with false claims.";

      console.warn(`[Observer] Response BLOCKED: ${reason}`);
      return { allowed: false, reason, guidance };
    } catch (e) {
      console.warn(`[Observer] Could not parse JSON verdict: ${verdictRaw}`);
      return { allowed: true }; // Treat as pass on parsing failure
    }
  }
}

export const observer = new ObserverSystem();
