import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { loadLinkContext } from "./link-context.js";
import { ConversationMemory } from "./memory.js";
import { SettingsStore } from "./settings-store.js";
import type { ChatImage, ChatProvider } from "./types.js";
export interface ConversationRequest {
    guildId: string;
    channelId: string;
    displayName: string;
    prompt: string;
    images?: ChatImage[];
    linkTexts?: string[];
    source: "image" | "voice" | "text" | "speak" | "status" | "conversation";
}
export declare class ConversationService {
    private readonly config;
    private readonly provider;
    private readonly settings;
    private readonly memory;
    private readonly logger;
    private readonly links;
    private readonly queues;
    constructor(config: AppConfig, provider: ChatProvider, settings: SettingsStore, memory: ConversationMemory, logger: Logger, links?: typeof loadLinkContext);
    reply(request: ConversationRequest): Promise<string>;
    private serialized;
}
