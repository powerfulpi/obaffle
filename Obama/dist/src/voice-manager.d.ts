import type { Client, VoiceBasedChannel } from "discord.js";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
export interface VoiceUtterance {
    guildId: string;
    channelId: string;
    userId: string;
    pcm: Buffer;
}
type UtteranceHandler = (utterance: VoiceUtterance) => Promise<void>;
export declare class VoiceManager {
    private readonly client;
    private readonly config;
    private readonly logger;
    private readonly onUtterance;
    private readonly sessions;
    constructor(client: Client, config: AppConfig, logger: Logger, onUtterance: UtteranceHandler);
    join(channel: VoiceBasedChannel): Promise<"joined" | "already-joined">;
    leave(guildId: string): boolean;
    speak(guildId: string, discordPcm: Buffer): boolean;
    isConnected(guildId: string): boolean;
    destroyAll(): void;
}
export {};
