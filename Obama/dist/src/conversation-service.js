export class ConversationService {
    config;
    provider;
    settings;
    memory;
    logger;
    queues = new Map();
    constructor(config, provider, settings, memory, logger) {
        this.config = config;
        this.provider = provider;
        this.settings = settings;
        this.memory = memory;
        this.logger = logger;
    }
    async reply(request) {
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
    async serialized(key, task) {
        const previous = this.queues.get(key) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => current);
        this.queues.set(key, queued);
        await previous.catch(() => undefined);
        try {
            return await task();
        }
        finally {
            release();
            if (this.queues.get(key) === queued) {
                this.queues.delete(key);
            }
        }
    }
}
//# sourceMappingURL=conversation-service.js.map