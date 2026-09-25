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
export declare class ConversationService {
    private readonly config;
    private readonly provider;
    private readonly settings;
    private readonly memory;
    private readonly logger;
    private readonly queues;
    constructor(config: AppConfig, provider: ChatProvider, settings: SettingsStore, memory: ConversationMemory, logger: Logger);
    reply(request: ConversationRequest): Promise<string>;
    private serialized;
}
