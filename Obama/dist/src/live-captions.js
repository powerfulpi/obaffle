// Set the destination server and text channel IDs, then rebuild/restart.
// Captions from ALL servers go here. Either ID being empty disables captions.
export const LIVE_CAPTIONS_GUILD_ID = "849825141617983550";
export const LIVE_CAPTIONS_CHANNEL_ID = "1041485983515942994";
export class LiveCaptions {
    client;
    logger;
    channelId;
    destinationGuildId;
    queues = new Map();
    constructor(client, logger, channelId = LIVE_CAPTIONS_CHANNEL_ID, destinationGuildId = LIVE_CAPTIONS_GUILD_ID) {
        this.client = client;
        this.logger = logger;
        this.channelId = channelId;
        this.destinationGuildId = destinationGuildId;
    }
    post(guildId, voiceChannelId, speaker, text) {
        if (!this.channelId || !this.destinationGuildId)
            return;
        const previous = this.queues.get(this.channelId) ?? Promise.resolve();
        const pending = previous.then(async () => {
            const channel = await this.client.channels.fetch(this.channelId);
            if (!channel || !("guildId" in channel) || channel.guildId !== this.destinationGuildId || !channel.isSendable()) {
                this.logger.warn("Caption channel must be a sendable channel in the configured destination server");
                return;
            }
            const label = speaker.replace(/[\r\n]/g, " ").slice(0, 100);
            const prefix = `[Server ${guildId} | Voice <#${voiceChannelId}>] ${label}: `;
            const chunkSize = 1_900 - prefix.length;
            for (let offset = 0; offset < text.length; offset += chunkSize) {
                await channel.send({ content: prefix + text.slice(offset, offset + chunkSize), allowedMentions: { parse: [] } });
            }
        }).catch((error) => this.logger.warn("Live caption delivery failed", error));
        this.queues.set(this.channelId, pending);
        void pending.finally(() => {
            if (this.queues.get(this.channelId) === pending)
                this.queues.delete(this.channelId);
        });
    }
}
//# sourceMappingURL=live-captions.js.map