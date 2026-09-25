import "dotenv/config";
import type { ProviderName } from "./types.js";
export interface AppConfig {
    discordToken: string;
    aiProvider: ProviderName;
    sttProvider: ProviderName;
    openaiApiKey: string | undefined;
    openaiModel: string;
    openaiImageModel: string;
    imageProvider: ProviderName;
    geminiImageModel: string;
    openaiTranscriptionModel: string;
    geminiApiKey: string | undefined;
    geminiModel: string;
    geminiTranscriptionModel: string;
    cartesiaApiKey: string;
    cartesiaDefaultVoiceId: string;
    cartesiaModel: string;
    defaultInstructions: string;
    wakeWord: string;
    wakeFollowupMs: number;
    speechEndSilenceMs: number;
    voiceMinUtteranceMs: number;
    voiceMinRmsDbfs: number;
    voiceFeedbackCooldownMs: number;
    voiceJoinTimeoutMs: number;
    maxUtteranceSeconds: number;
    maxMemoryMessages: number;
    maxResponseCharacters: number;
    dataDir: string;
    logLevel: "debug" | "info" | "warn" | "error";
}
export declare function loadConfig(options?: {
    validateSecrets?: boolean;
}): AppConfig;
export declare function validateSecrets(config: AppConfig): void;
