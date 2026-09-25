import { type Message } from "discord.js";
import type { ConversationService } from "./conversation-service.js";
import type { Logger } from "./logger.js";
import type { SettingsStore } from "./settings-store.js";
interface ConversationModeDependencies {
    random?: () => number;
    now?: () => number;
}
export declare class ConversationModeService {
    private readonly settings;
    private readonly conversations;
    private readonly logger;
    private readonly inFlight;
    private readonly tokens;
    private readonly nextEligibleAt;
    private readonly random;
    private readonly now;
    private stopped;
    constructor(settings: SettingsStore, conversations: ConversationService, logger: Logger, dependencies?: ConversationModeDependencies);
    invalidate(channelId: string): void;
    stop(): void;
    handleMessage(message: Message<true>): Promise<void>;
    private isCurrent;
}
export {};
