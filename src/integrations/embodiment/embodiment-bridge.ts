/**
 * ErnOS Embodiment Bridge — Channel-Agnostic Virtual Environment Interface
 *
 * This bridge normalizes any virtual environment into an ErnOS communication
 * channel, identical to how Discord/Telegram/WhatsApp messages arrive.
 *
 * Perception events (game → ErnOS) are routed through inbound-context.ts.
 * Action commands (ErnOS → game) are dispatched via agent tools.
 */

// ─── Perception Types ──────────────────────────────────────────────────────────

export type PerceptionType =
  | "chat"
  | "damage"
  | "death"
  | "block_break"
  | "item_acquired"
  | "proximity"
  | "health_change"
  | "custom";

export interface PerceptionEvent {
  type: PerceptionType;
  source: string;        // who/what caused it (player name, mob type, "environment")
  detail: string;        // human-readable description
  rawData?: unknown;     // environment-specific payload
  timestamp: number;
  channel: string;       // e.g. "embodiment:minecraft"
}

// ─── Action Types ───────────────────────────────────────────────────────────────

export interface ActionCommand {
  action: string;        // e.g. "goto", "mine", "craft", "chat", "attack"
  params: Record<string, unknown>;
  priority?: number;     // higher = more urgent (default 0)
}

export interface ActionResult {
  success: boolean;
  action: string;
  result?: string;
  error?: string;
  durationMs?: number;
}

// ─── Adapter Interface ──────────────────────────────────────────────────────────

/**
 * Any virtual environment that ErnOS can inhabit must implement this interface.
 * Minecraft is the first adapter; future: Roblox, Godot, robotics, etc.
 */
export interface EmbodimentAdapter {
  /** Unique name for this environment (e.g. "minecraft", "roblox") */
  readonly name: string;

  /** Connect to the environment */
  connect(): Promise<void>;

  /** Disconnect cleanly */
  disconnect(): Promise<void>;

  /** Whether the adapter is currently connected */
  isConnected(): boolean;

  /** Register a handler for perception events */
  onPerception(handler: (event: PerceptionEvent) => void): void;

  /** Execute an action in the environment */
  executeAction(command: ActionCommand): Promise<ActionResult>;

  /** Get a snapshot of the current world state */
  getWorldState(): Promise<WorldState>;
}

export interface WorldState {
  position?: { x: number; y: number; z: number };
  health?: number;
  food?: number;
  inventory?: Array<{ name: string; count: number }>;
  nearbyEntities?: Array<{ name: string; type: string; distance: number }>;
  nearbyBlocks?: Array<{ name: string; position: { x: number; y: number; z: number } }>;
  time?: string;       // in-game time
  biome?: string;
  custom?: Record<string, unknown>;
}

// ─── Bridge ─────────────────────────────────────────────────────────────────────

type MessageHandler = (
  channelId: string,
  senderId: string,
  message: string,
  metadata: Record<string, unknown>,
) => Promise<string | void>;

/**
 * The EmbodimentBridge connects an adapter to ErnOS's message processing pipeline.
 * It translates perception events into ErnOS-compatible messages and
 * exposes action capabilities as callable functions.
 */
export class EmbodimentBridge {
  private adapter: EmbodimentAdapter | null = null;
  private messageHandler: MessageHandler | null = null;
  private actionQueue: ActionCommand[] = [];
  private isProcessing = false;

  /** Register the ErnOS message handler (wired from inbound processing). */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /** Attach an environment adapter and start receiving perceptions. */
  async attachAdapter(adapter: EmbodimentAdapter): Promise<void> {
    this.adapter = adapter;

    // Wire perception events → ErnOS messages
    adapter.onPerception((event) => {
      this.handlePerception(event).catch((e) =>
        console.error(`[EmbodimentBridge] Perception handling error:`, e),
      );
    });

    await adapter.connect();
    console.log(`[EmbodimentBridge] Adapter "${adapter.name}" connected.`);
  }

  /** Detach the current adapter. */
  async detachAdapter(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect();
      console.log(`[EmbodimentBridge] Adapter "${this.adapter.name}" disconnected.`);
      this.adapter = null;
    }
  }

  /** Get the attached adapter (or null). */
  getAdapter(): EmbodimentAdapter | null {
    return this.adapter;
  }

  /** Execute an action via the attached adapter. */
  async act(command: ActionCommand): Promise<ActionResult> {
    if (!this.adapter || !this.adapter.isConnected()) {
      return { success: false, action: command.action, error: "No adapter connected" };
    }

    const startMs = Date.now();
    try {
      const result = await this.adapter.executeAction(command);
      result.durationMs = Date.now() - startMs;
      console.log(
        `[EmbodimentBridge] Action "${command.action}" → ${result.success ? "OK" : "FAIL"} (${result.durationMs}ms)`,
      );
      return result;
    } catch (e) {
      return {
        success: false,
        action: command.action,
        error: String(e),
        durationMs: Date.now() - startMs,
      };
    }
  }

  /** Get the current world state from the adapter. */
  async getWorldState(): Promise<WorldState | null> {
    if (!this.adapter || !this.adapter.isConnected()) {return null;}
    return this.adapter.getWorldState();
  }

  /** Convert a perception event into an ErnOS message and route it. */
  private async handlePerception(event: PerceptionEvent): Promise<void> {
    if (!this.messageHandler) {return;}

    const channelId = event.channel || `embodiment:${this.adapter?.name || "unknown"}`;
    const senderId = event.source || "environment";

    // Format the perception as a human-readable message for the kernel
    const message = this.formatPerception(event);

    const metadata: Record<string, unknown> = {
      embodiment: true,
      perceptionType: event.type,
      rawData: event.rawData,
      timestamp: event.timestamp,
    };

    await this.messageHandler(channelId, senderId, message, metadata);
  }

  /** Format a perception event into a human-readable string. */
  private formatPerception(event: PerceptionEvent): string {
    switch (event.type) {
      case "chat":
        return `[Game Chat] ${event.source}: ${event.detail}`;
      case "damage":
        return `[Damage] Took damage from ${event.source}: ${event.detail}`;
      case "death":
        return `[Death] Died: ${event.detail}`;
      case "block_break":
        return `[Block] Broke block: ${event.detail}`;
      case "item_acquired":
        return `[Item] Acquired: ${event.detail}`;
      case "proximity":
        return `[Proximity] ${event.source} ${event.detail}`;
      case "health_change":
        return `[Health] ${event.detail}`;
      default:
        return `[${event.type}] ${event.detail}`;
    }
  }
}

/** Singleton bridge instance */
export const embodimentBridge = new EmbodimentBridge();
