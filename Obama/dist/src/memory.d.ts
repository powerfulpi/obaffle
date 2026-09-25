import type { ChatMessage } from "./types.js";
export declare class ConversationMemory {
    private readonly conversations;
    private readonly messageLimit;
    constructor(maxMessages: number);
    get(key: string): ChatMessage[];
    addExchange(key: string, userContent: string, assistantContent: string): void;
    clearConversation(key: string): boolean;
    clearGuild(guildId: string): number;
    clearAll(): void;
}
