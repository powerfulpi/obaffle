import { MessageType } from "discord.js";
export class ConversationModeService {
    settings;
    conversations;
    logger;
    inFlight = new Set();
    tokens = new Map();
    nextEligibleAt = new Map();
    random;
    now;
    stopped = false;
    constructor(settings, conversations, logger, dependencies = {}) {
        this.settings = settings;
        this.conversations = conversations;
        this.logger = logger;
        this.random = dependencies.random ?? Math.random;
        this.now = dependencies.now ?? Date.now;
    }
    invalidate(channelId) {
        this.tokens.delete(channelId);
        this.nextEligibleAt.delete(channelId);
    }
    stop() {
        this.stopped = true;
        this.tokens.clear();
        this.nextEligibleAt.clear();
    }
    async handleMessage(message) {
        if (this.stopped || message.author.bot || message.webhookId || message.system ||
            (message.type !== MessageType.Default && message.type !== MessageType.Reply) ||
            (!message.content.trim() && message.attachments.size === 0))
            return;
        const guildId = message.guildId;
        const channelId = message.channelId;
        const configured = this.settings.get(guildId).conversationChannels[channelId];
        if (!configured || !Number.isFinite(configured.chancePercent) ||
            configured.chancePercent <= 0 || configured.chancePercent > 100 ||
            !Number.isFinite(configured.cooldownSeconds) || configured.cooldownSeconds < 0 ||
            this.inFlight.has(channelId) || this.now() < (this.nextEligibleAt.get(channelId) ?? 0))
            return;
        // Losing the random roll must not fetch Discord history or invoke the AI provider.
        if (this.random() >= configured.chancePercent / 100)
            return;
        const config = { ...configured };
        const token = Symbol(channelId);
        this.tokens.set(channelId, token);
        this.inFlight.add(channelId);
        // Failed requests also back off, so an unavailable provider cannot cause a request storm.
        this.nextEligibleAt.set(channelId, this.now() + config.cooldownSeconds * 1_000);
        const trigger = transcriptEntry(message);
        try {
            const history = await message.channel.messages.fetch({
                before: message.id,
                limit: 14,
                cache: false,
            });
            if (!this.isCurrent(guildId, channelId, token, config))
                return;
            const preceding = [...history.values()]
                .filter((entry) => entry.channelId === channelId && BigInt(entry.id) < BigInt(message.id))
                .sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1)
                .slice(-14)
                .map(transcriptEntry);
            const response = await this.conversations.reply({
                guildId,
                channelId,
                displayName: "Channel transcript",
                source: "conversation",
                prompt: JSON.stringify([...preceding, trigger]),
            });
            if (!this.isCurrent(guildId, channelId, token, config))
                return;
            const content = response.trim().slice(0, 2_000);
            if (!content)
                return;
            await message.channel.send({
                content,
                allowedMentions: { parse: [], repliedUser: false },
            });
            if (this.isCurrent(guildId, channelId, token, config)) {
                this.nextEligibleAt.set(channelId, this.now() + config.cooldownSeconds * 1_000);
            }
        }
        catch (error) {
            this.logger.warn("Conversation mode could not respond", {
                guildId,
                channelId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            this.inFlight.delete(channelId);
            if (this.tokens.get(channelId) === token)
                this.tokens.delete(channelId);
        }
    }
    isCurrent(guildId, channelId, token, config) {
        if (this.stopped || this.tokens.get(channelId) !== token)
            return false;
        const current = this.settings.get(guildId).conversationChannels[channelId];
        return current !== undefined && current.chancePercent === config.chancePercent &&
            current.cooldownSeconds === config.cooldownSeconds;
    }
}
function transcriptEntry(message) {
    return {
        author: (message.member?.displayName ?? message.author.globalName ?? message.author.username).slice(0, 128),
        kind: message.system ? "system" : message.webhookId ? "webhook" : message.author.bot ? "bot" : "user",
        content: message.content.slice(0, 4_000),
        attachments: [...message.attachments.values()].slice(0, 10)
            .map((attachment) => `[attachment: ${(attachment.name ?? "unnamed file").slice(0, 256)}]`),
    };
}
//# sourceMappingURL=conversation-mode.js.map