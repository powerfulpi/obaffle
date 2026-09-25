import type { Client } from "discord.js";
import type { Logger } from "./logger.js";

// Set the destination server and text channel IDs, then rebuild/restart.
// Captions from ALL servers go here. Either ID being empty disables captions.
export const LIVE_CAPTIONS_GUILD_ID = "849825141617983550";
export const LIVE_CAPTIONS_CHANNEL_ID = "1041485983515942994";

export class LiveCaptions {
  private readonly queues = new Map<string, Promise<void>>();

  public constructor(
    private readonly client: Client,
    private readonly logger: Logger,
    private readonly channelId: string = LIVE_CAPTIONS_CHANNEL_ID,
    private readonly destinationGuildId: string = LIVE_CAPTIONS_GUILD_ID,
  ) {}

  public post(guildId: string, voiceChannelId: string, speaker: string, text: string): void {
    if (!this.channelId || !this.destinationGuildId) return;
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
    }).catch((error: unknown) => this.logger.warn("Live caption delivery failed", error));
    this.queues.set(this.channelId, pending);
    void pending.finally(() => {
      if (this.queues.get(this.channelId) === pending) this.queues.delete(this.channelId);
    });
  }
}
