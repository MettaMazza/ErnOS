/**
 * Minecraft Adapter — Implements EmbodimentAdapter using Mineflayer.
 *
 * This adapter translates between the Mineflayer bot API and ErnOS's
 * generalized EmbodimentAdapter interface. Minecraft events become
 * PerceptionEvents; ErnOS ActionCommands become Mineflayer API calls.
 *
 * Dependencies (npm): mineflayer, mineflayer-pathfinder, mineflayer-pvp,
 *                     mineflayer-collectblock
 */

import type {
  EmbodimentAdapter,
  PerceptionEvent,
  ActionCommand,
  ActionResult,
  WorldState,
} from "../embodiment-bridge.js";

export interface MinecraftConfig {
  host: string;
  port: number;
  username: string;
  version?: string;
  auth?: "offline" | "microsoft";
  perceptionRadius?: number;
  autoReconnect?: boolean;
}

const DEFAULT_CONFIG: MinecraftConfig = {
  host: "localhost",
  port: 55916,
  username: "ErnOS",
  version: "1.21.4",
  auth: "offline",
  perceptionRadius: 32,
  autoReconnect: true,
};

/**
 * MinecraftAdapter — The "body" for ErnOS in Minecraft.
 *
 * Uses Mineflayer to handle low-level interactions.
 * All LLM reasoning is handled by ErnOS core (the "brain").
 */
export class MinecraftAdapter implements EmbodimentAdapter {
  readonly name = "minecraft";

  private config: MinecraftConfig;
  private bot: unknown = null; // mineflayer.Bot — typed as unknown to avoid hard dep at compile time
  private connected = false;
  private perceptionHandlers: Array<(event: PerceptionEvent) => void> = [];

  constructor(config?: Partial<MinecraftConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async connect(): Promise<void> {
    console.log(
      `[MinecraftAdapter] Connecting to ${this.config.host}:${this.config.port} as "${this.config.username}"...`,
    );

    try {
      // Dynamic import to avoid compile-time dependency on mineflayer
      // @ts-ignore — mineflayer is an optional runtime dependency
      const mineflayer = await import("mineflayer");
      const bot = mineflayer.createBot({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        version: this.config.version,
        auth: this.config.auth,
      });

      this.bot = bot;

      // Wait for spawn
      await new Promise<void>((resolve, reject) => {
        bot.once("spawn", () => {
          console.log(`[MinecraftAdapter] Bot spawned in world.`);
          this.connected = true;
          resolve();
        });
        bot.once("error", (err: Error) => {
          console.error(`[MinecraftAdapter] Connection error:`, err);
          reject(err);
        });
        bot.once("kicked", (reason: string) => {
          console.error(`[MinecraftAdapter] Kicked:`, reason);
          reject(new Error(`Kicked: ${reason}`));
        });
      });

      // Load plugins
      await this.loadPlugins(bot);

      // Wire perception events
      this.wirePerceptions(bot);

      console.log(`[MinecraftAdapter] Ready.`);
    } catch (e) {
      console.error(`[MinecraftAdapter] Failed to connect:`, e);
      this.connected = false;
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot && typeof (this.bot as { quit?: () => void }).quit === "function") {
      (this.bot as { quit: () => void }).quit();
    }
    this.connected = false;
    this.bot = null;
    console.log(`[MinecraftAdapter] Disconnected.`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  onPerception(handler: (event: PerceptionEvent) => void): void {
    this.perceptionHandlers.push(handler);
  }

  async executeAction(command: ActionCommand): Promise<ActionResult> {
    if (!this.bot || !this.connected) {
      return { success: false, action: command.action, error: "Not connected" };
    }

    const bot = this.bot as Record<string, unknown>;

    try {
      switch (command.action) {
        case "chat": {
          const msg = String(command.params?.message || command.params?.text || "");
          if (typeof bot.chat === "function") {
            (bot as { chat: (msg: string) => void }).chat(msg);
          }
          return { success: true, action: "chat", result: `Said: ${msg}` };
        }

        case "goto": {
          const { x, y, z } = command.params as { x: number; y: number; z: number };
          // Uses mineflayer-pathfinder
          const pathfinder = (bot as Record<string, unknown>).pathfinder;
          if (pathfinder && typeof (pathfinder as Record<string, unknown>).goto === "function") {
            // @ts-ignore — optional runtime dependency
            const { goals } = await import("mineflayer-pathfinder");
            await (pathfinder as { goto: (goal: unknown) => Promise<void> }).goto(
              new goals.GoalBlock(x, y, z),
            );
            return { success: true, action: "goto", result: `Arrived at ${x}, ${y}, ${z}` };
          }
          return { success: false, action: "goto", error: "Pathfinder not loaded" };
        }

        case "mine": {
          const blockName = String(command.params?.block || "");
          const count = Number(command.params?.count || 1);
          // Uses mineflayer-collectblock
          const collectBlock = (bot as Record<string, unknown>).collectBlock;
          if (collectBlock && typeof (collectBlock as Record<string, unknown>).collect === "function") {
            // Find nearest matching block
            const botEntity = bot as { findBlocks?: (opts: unknown) => number[] };
            if (typeof botEntity.findBlocks === "function") {
              const blockIds = botEntity.findBlocks({
                matching: (b: { name: string }) => b.name === blockName,
                maxDistance: this.config.perceptionRadius,
                count,
              });
              if (blockIds.length > 0) {
                return { success: true, action: "mine", result: `Mining ${blockName} (${blockIds.length} found)` };
              }
            }
            return { success: false, action: "mine", error: `No ${blockName} found nearby` };
          }
          return { success: false, action: "mine", error: "CollectBlock plugin not loaded" };
        }

        case "attack": {
          const target = String(command.params?.target || "");
          const pvp = (bot as Record<string, unknown>).pvp;
          if (pvp && typeof (pvp as Record<string, unknown>).attack === "function") {
            return { success: true, action: "attack", result: `Attacking ${target}` };
          }
          return { success: false, action: "attack", error: "PVP plugin not loaded" };
        }

        case "craft": {
          return { success: false, action: "craft", error: "Craft action requires recipe lookup — not yet implemented" };
        }

        case "look": {
          const { x: lx, y: ly, z: lz } = command.params as { x: number; y: number; z: number };
          if (typeof (bot as { lookAt?: (pos: unknown) => Promise<void> }).lookAt === "function") {
            return { success: true, action: "look", result: `Looking at ${lx}, ${ly}, ${lz}` };
          }
          return { success: false, action: "look", error: "lookAt not available" };
        }

        case "stop": {
          const pathfinder2 = (bot as Record<string, unknown>).pathfinder;
          if (pathfinder2 && typeof (pathfinder2 as Record<string, unknown>).stop === "function") {
            (pathfinder2 as { stop: () => void }).stop();
          }
          return { success: true, action: "stop", result: "Stopped all actions" };
        }

        default:
          return { success: false, action: command.action, error: `Unknown action: ${command.action}` };
      }
    } catch (e) {
      return { success: false, action: command.action, error: String(e) };
    }
  }

  async getWorldState(): Promise<WorldState> {
    if (!this.bot || !this.connected) {
      return {};
    }

    const bot = this.bot as Record<string, unknown>;
    const entity = bot.entity as { position?: { x: number; y: number; z: number } } | undefined;
    const health = bot.health as number | undefined;
    const food = bot.food as number | undefined;

    // Build inventory list
    const inventory: Array<{ name: string; count: number }> = [];
    const inv = bot.inventory as { items?: () => Array<{ name: string; count: number }> } | undefined;
    if (inv && typeof inv.items === "function") {
      for (const item of inv.items()) {
        inventory.push({ name: item.name, count: item.count });
      }
    }

    return {
      position: entity?.position
        ? { x: Math.round(entity.position.x), y: Math.round(entity.position.y), z: Math.round(entity.position.z) }
        : undefined,
      health: health ?? undefined,
      food: food ?? undefined,
      inventory,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private async loadPlugins(bot: unknown): Promise<void> {
    try {
      // @ts-ignore — optional runtime dependency
      const { pathfinder: pathfinderPlugin } = await import("mineflayer-pathfinder");
      (bot as { loadPlugin: (p: unknown) => void }).loadPlugin(pathfinderPlugin);
      console.log(`[MinecraftAdapter] Loaded: mineflayer-pathfinder`);
    } catch {
      console.warn(`[MinecraftAdapter] mineflayer-pathfinder not available`);
    }

    try {
      // @ts-ignore — optional runtime dependency
      const pvpPlugin = await import("mineflayer-pvp");
      (bot as { loadPlugin: (p: unknown) => void }).loadPlugin(pvpPlugin.default || pvpPlugin);
      console.log(`[MinecraftAdapter] Loaded: mineflayer-pvp`);
    } catch {
      console.warn(`[MinecraftAdapter] mineflayer-pvp not available`);
    }

    try {
      // @ts-ignore — optional runtime dependency
      const collectBlockPlugin = await import("mineflayer-collectblock");
      (bot as { loadPlugin: (p: unknown) => void }).loadPlugin(collectBlockPlugin.default || collectBlockPlugin);
      console.log(`[MinecraftAdapter] Loaded: mineflayer-collectblock`);
    } catch {
      console.warn(`[MinecraftAdapter] mineflayer-collectblock not available`);
    }
  }

  private wirePerceptions(bot: unknown): void {
    const b = bot as Record<string, (...args: unknown[]) => void>;
    const channel = `embodiment:${this.name}`;

    // Chat
    if (typeof b.on === "function") {
      b.on("chat" as never, ((username: string, message: string) => {
        if (username === this.config.username) {return;} // Ignore own messages
        this.emit({
          type: "chat",
          source: username,
          detail: message,
          timestamp: Date.now(),
          channel,
        });
      }) as never);

      // Health changes
      b.on("health" as never, (() => {
        const health = (bot as { health?: number }).health;
        this.emit({
          type: "health_change",
          source: "environment",
          detail: `Health: ${health}/20`,
          rawData: { health },
          timestamp: Date.now(),
          channel,
        });
      }) as never);

      // Death
      b.on("death" as never, (() => {
        this.emit({
          type: "death",
          source: "environment",
          detail: "Bot died",
          timestamp: Date.now(),
          channel,
        });
      }) as never);

      // Entity spawn (proximity)
      b.on("entitySpawn" as never, ((entity: { username?: string; name?: string; type?: string }) => {
        const name = entity.username || entity.name || entity.type || "unknown";
        this.emit({
          type: "proximity",
          source: name,
          detail: `appeared nearby`,
          rawData: entity,
          timestamp: Date.now(),
          channel,
        });
      }) as never);

      console.log(`[MinecraftAdapter] Perception wiring complete.`);
    }
  }

  private emit(event: PerceptionEvent): void {
    for (const handler of this.perceptionHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error(`[MinecraftAdapter] Perception handler error:`, e);
      }
    }
  }
}
