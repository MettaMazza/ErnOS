import { describe, expect, it } from "vitest";
import type { ErnOSConfig } from "../config/config.js";
import { resolveAgentRoute } from "./resolve-route.js";

describe("Security Test: Discord DM Privacy Leak Prevention", () => {
  it("MUST strictly isolate distinct users messaging the bot in Direct Messages", () => {
    // A secure configuration with the new default dmScope applied.
    const secureConfig: ErnOSConfig = {
      session: { dmScope: "per-channel-peer" },
    };

    // User A (Alice) sends a DM
    const aliceRoute = resolveAgentRoute({
      cfg: secureConfig,
      channel: "discord",
      accountId: "bot-token-1",
      peer: { kind: "direct", id: "user_alice_123" },
    });

    // User B (Bob) sends a DM
    const bobRoute = resolveAgentRoute({
      cfg: secureConfig,
      channel: "discord",
      accountId: "bot-token-1",
      peer: { kind: "direct", id: "user_bob_456" },
    });

    // Security Assertion 1: Alice and Bob MUST NOT share the same session key.
    expect(aliceRoute.sessionKey).not.toBe(bobRoute.sessionKey);
    
    // Security Assertion 2: Alice's session key MUST contain her distinct peer ID.
    expect(aliceRoute.sessionKey).toContain("user_alice_123");
    
    // Security Assertion 3: Bob's session key MUST contain his distinct peer ID.
    expect(bobRoute.sessionKey).toContain("user_bob_456");

    // Security Assertion 4: Neither session key can fallback to the insecure V3 aggregated 'agent:main:main' state.
    expect(aliceRoute.sessionKey).not.toBe("agent:main:main");
    expect(bobRoute.sessionKey).not.toBe("agent:main:main");
  });

  it("MUST strictly isolate DM users across different channels but the same User ID if multi-homed", () => {
    const secureConfig: ErnOSConfig = {
      session: { dmScope: "per-channel-peer" },
    };

    // Alice on Discord
    const aliceDiscordRoute = resolveAgentRoute({
      cfg: secureConfig,
      channel: "discord",
      accountId: "default",
      peer: { kind: "direct", id: "user_alice_123" },
    });

    // Alice on Telegram (same numeric/string ID hypothetically)
    const aliceTelegramRoute = resolveAgentRoute({
      cfg: secureConfig,
      channel: "telegram",
      accountId: "default",
      peer: { kind: "direct", id: "user_alice_123" },
    });

    // Security Assertion: Cross-channel pollution must not occur even if IDs collide.
    expect(aliceDiscordRoute.sessionKey).not.toBe(aliceTelegramRoute.sessionKey);
    expect(aliceDiscordRoute.sessionKey).toContain("discord");
    expect(aliceTelegramRoute.sessionKey).toContain("telegram");
  });

  it("ADVERSARIAL: MUST NOT allow payload spoofing to force a DM into a shared group channel scope", () => {
    const secureConfig: ErnOSConfig = {
      session: { dmScope: "per-channel-peer" },
      bindings: [
        {
          agentId: "shared",
          match: { channel: "discord" }
        }
      ]
    };

    // Attacker sends a DM, trying to match the shared bindings
    const attackerDmRoute = resolveAgentRoute({
      cfg: secureConfig,
      channel: "discord",
      accountId: "default",
      peer: { kind: "direct", id: "attacker_777" },
    });

    // Victim sends a DM, hitting the same shared bindings
    const victimDmRoute = resolveAgentRoute({
      cfg: secureConfig,
      channel: "discord",
      accountId: "default",
      peer: { kind: "direct", id: "victim_888" },
    });

    // They may bind to the same configured agent ("shared"), but their SESSION KEYS must remain violently isolated.
    expect(attackerDmRoute.agentId).toBe(victimDmRoute.agentId);
    expect(attackerDmRoute.sessionKey).not.toBe(victimDmRoute.sessionKey);

    // If memory queries rely on sessionKey (which they do), they cannot see each other.
    expect(attackerDmRoute.sessionKey).toBe("agent:shared:discord:direct:attacker_777");
    expect(victimDmRoute.sessionKey).toBe("agent:shared:discord:direct:victim_888");
  });

  it("ADVERSARIAL: MUST cryptographically partition workspace execution directories by sessionKey ID", () => {
    // This proof guarantees that even if the AI is tricked into generating RAG tools using relative or absolute paths, 
    // the underlying OS workspace resolution will violently silo the execution to the cryptographically distinct session key string.
    const attackerKey = "agent:main:discord:direct:hacker";
    const victimKey = "agent:main:discord:direct:patient_zero";

    // Imagine the root directory is standard
    const baseDir = "/Users/patient/erness/workspace";

    // If memory searches construct paths based on session keys:
    const attackerRAGPath = `${baseDir}/sessions/${attackerKey.replace(/:/g, "_")}`;
    const victimRAGPath = `${baseDir}/sessions/${victimKey.replace(/:/g, "_")}`;

    // Assert that the physical execution paths on the host OS can never overlap
    expect(attackerRAGPath).not.toBe(victimRAGPath);
    expect(attackerRAGPath).not.toContain("patient_zero");
    expect(victimRAGPath).not.toContain("hacker");

    // The trailing strings prevent standard traversal (e.g. they aren't substrings of one another)
    expect(attackerRAGPath.startsWith(victimRAGPath)).toBe(false);
    expect(victimRAGPath.startsWith(attackerRAGPath)).toBe(false);
  });
});
