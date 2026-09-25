import type { Client } from "discord.js";
import type { Logger } from "./logger.js";
export declare const LIVE_CAPTIONS_GUILD_ID = "849825141617983550";
export declare const LIVE_CAPTIONS_CHANNEL_ID = "1041485983515942994";
export declare class LiveCaptions {
    private readonly client;
    private readonly logger;
    private readonly channelId;
    private readonly destinationGuildId;
    private readonly queues;
    constructor(client: Client, logger: Logger, channelId?: string, destinationGuildId?: string);
    post(guildId: string, voiceChannelId: string, speaker: string, text: string): void;
}
