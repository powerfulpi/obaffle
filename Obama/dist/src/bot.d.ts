import { Client } from "discord.js";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
export declare class ObamaBot {
    private readonly config;
    private readonly logger;
    private readonly restart?;
    readonly client: Client;
    private readonly settings;
    private readonly memory;
    private readonly conversations;
    private readonly tts;
    private readonly voice;
    private readonly speechRecognition;
    private readonly armedUntil;
    private readonly activeImages;
    private readonly activeVoiceResponses;
    constructor(config: AppConfig, logger: Logger, restart?: (() => Promise<void>) | undefined);
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleMessage;
    private executeCommand;
    private handleVoiceCommand;
    private handleInstructionsCommand;
    private handleMemoryCommand;
    private handleVoiceUtterance;
}
