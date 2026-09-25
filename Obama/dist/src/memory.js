export class ConversationMemory {
    conversations = new Map();
    messageLimit;
    constructor(maxMessages) {
        this.messageLimit = Math.max(2, maxMessages - (maxMessages % 2));
    }
    get(key) {
        return [...(this.conversations.get(key) ?? [])];
    }
    addExchange(key, userContent, assistantContent) {
        const messages = this.conversations.get(key) ?? [];
        messages.push({ role: "user", content: userContent }, { role: "assistant", content: assistantContent });
        if (messages.length > this.messageLimit) {
            messages.splice(0, messages.length - this.messageLimit);
        }
        this.conversations.set(key, messages);
    }
    clearConversation(key) {
        return this.conversations.delete(key);
    }
    clearGuild(guildId) {
        let cleared = 0;
        for (const key of this.conversations.keys()) {
            if (key.startsWith(`${guildId}:`)) {
                this.conversations.delete(key);
                cleared += 1;
            }
        }
        return cleared;
    }
    clearAll() {
        this.conversations.clear();
    }
}
//# sourceMappingURL=memory.js.map