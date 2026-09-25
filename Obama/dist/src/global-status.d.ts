import type { Client } from "discord.js";
import type { AppConfig } from "./config.js";
import type { SettingsStore } from "./settings-store.js";
export declare function canReadGlobalStatus(client: Client, userId: string): Promise<boolean>;
export declare function buildGlobalStatus(client: Client, settings: SettingsStore, config: AppConfig, voice: {
    isConnected(guildId: string): boolean;
}): {
    text: string;
    serverCount: number;
    conversationCount: number;
};
