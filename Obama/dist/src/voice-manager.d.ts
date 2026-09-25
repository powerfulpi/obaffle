import { type VoiceConnection } from "@discordjs/voice";
import type { Client, VoiceBasedChannel } from "discord.js";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
export interface VoiceUtterance {
    guildId: string;
    channelId: string;
    userId: string;
    pcm: Buffer;
    duringPlayback?: boolean;
    isCurrent?: () => boolean;
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
    interrupt(guildId: string): void;
    isConnected(guildId: string): boolean;
    destroyAll(): void;
}
export declare class VoiceSession {
    private readonly client;
    private readonly guildId;
    readonly channelId: string;
    private readonly connection;
    private readonly config;
    private readonly logger;
    private readonly onUtterance;
    private readonly onDestroyed;
    private readonly player;
    private readonly queue;
    private readonly activeRecordings;
    private suppressCaptureUntil;
    private destroyed;
    constructor(client: Client, guildId: string, channelId: string, connection: VoiceConnection, config: AppConfig, logger: Logger, onUtterance: UtteranceHandler, onDestroyed: () => void);
    enqueue(pcm: Buffer): void;
    interrupt(): void;
    destroy(): void;
    private playNext;
    private capture;
    private captureIsSuppressed;
}
export {};
