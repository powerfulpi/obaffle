import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { ConversationMemory } from "./memory.js";
import { SettingsStore } from "./settings-store.js";
import type { ChatProvider } from "./types.js";

export interface ConversationRequest {
  guildId: string;
  channelId: string;
  displayName: string;
  prompt: string;
  source: "voice" | "text" | "speak" | "status";
}

export class ConversationService {
  private readonly queues = new Map<string, Promise<void>>();

  public constructor(
    private readonly config: AppConfig,
    private readonly provider: ChatProvider,
    private readonly settings: SettingsStore,
    private readonly memory: ConversationMemory,
    private readonly logger: Logger,
  ) {}

  public async reply(request: ConversationRequest): Promise<string> {
    const key = `${request.guildId}:${request.channelId}`;
    return this.serialized(key, async () => {
      const guildSettings = this.settings.get(request.guildId);
      const userContent = `${request.displayName}: ${request.prompt}`;
      const useMemory = guildSettings.memoryEnabled && request.source !== "status";
      const history = useMemory ? this.memory.get(key) : [];
      const startedAt = Date.now();
      this.logger.info("AI answering", {
        source: request.source,
        provider: this.config.aiProvider,
        guildId: request.guildId,
        channelId: request.channelId,
        displayName: request.displayName,
        prompt: request.prompt,
        memoryMessages: history.length,
      });
      const response = await this.provider.generate({
        instructions: guildSettings.instructions ?? this.config.defaultInstructions,
        messages: [...history, { role: "user", content: userContent }],
        maxOutputCharacters: this.config.maxResponseCharacters,
      });
      if (useMemory) {
        this.memory.addExchange(key, userContent, response);
      }
      this.logger.info("AI replied", {
        source: request.source,
        provider: this.config.aiProvider,
        guildId: request.guildId,
        channelId: request.channelId,
        durationMs: Date.now() - startedAt,
        response,
      });
      return response;
    });
  }

  private async serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    this.queues.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.queues.get(key) === queued) {
        this.queues.delete(key);
      }
    }
  }
}
