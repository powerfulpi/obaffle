import type { GuildSettings } from "./types.js";
export declare function normalizeVoiceAlias(alias: string): string;
export declare class SettingsStore {
    private readonly originalVoiceId;
    private readonly filePath;
    private data;
    private writeChain;
    constructor(dataDir: string, originalVoiceId: string);
    load(): Promise<void>;
    get(guildId: string): GuildSettings;
    getSelectedVoiceId(guildId: string): string;
    mutate(guildId: string, mutation: (settings: GuildSettings) => void): Promise<GuildSettings>;
    private save;
}
