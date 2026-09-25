import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
const VOICE_ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
function sanitizeConversationChannels(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const channels = [];
    for (const [channelId, candidate] of Object.entries(value)) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            continue;
        }
        const { chancePercent, cooldownSeconds } = candidate;
        if (typeof chancePercent !== "number" ||
            !Number.isFinite(chancePercent) ||
            chancePercent <= 0 ||
            chancePercent > 100 ||
            typeof cooldownSeconds !== "number" ||
            !Number.isSafeInteger(cooldownSeconds) ||
            cooldownSeconds < 0 ||
            cooldownSeconds > 86_400) {
            continue;
        }
        channels.push([channelId, { chancePercent, cooldownSeconds }]);
    }
    return Object.fromEntries(channels);
}
export function normalizeVoiceAlias(alias) {
    const normalized = alias.trim().toLowerCase();
    if (!VOICE_ALIAS_PATTERN.test(normalized)) {
        throw new Error("Voice names must be 1-32 characters and use only letters, numbers, _ or -.");
    }
    return normalized;
}
export class SettingsStore {
    originalVoiceId;
    filePath;
    data = { version: 1, guilds: {} };
    writeChain = Promise.resolve();
    constructor(dataDir, originalVoiceId) {
        this.originalVoiceId = originalVoiceId;
        this.filePath = join(dataDir, "guild-settings.json");
    }
    async load() {
        await mkdir(dirname(this.filePath), { recursive: true });
        try {
            const raw = await readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed.version !== 1 || !parsed.guilds || typeof parsed.guilds !== "object") {
                throw new Error("Unsupported settings file format");
            }
            this.data = parsed;
            for (const settings of Object.values(this.data.guilds)) {
                settings.conversationChannels = sanitizeConversationChannels(settings.conversationChannels);
            }
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }
    get(guildId) {
        const existing = this.data.guilds[guildId];
        if (existing) {
            existing.conversationChannels = sanitizeConversationChannels(existing.conversationChannels);
            existing.voices.original = this.originalVoiceId;
            if (!existing.voices[existing.selectedVoice]) {
                existing.selectedVoice = "original";
            }
            return existing;
        }
        const created = {
            selectedVoice: "original",
            voices: { original: this.originalVoiceId },
            instructions: null,
            memoryEnabled: true,
            conversationChannels: {},
        };
        this.data.guilds[guildId] = created;
        return created;
    }
    snapshot() {
        return Object.fromEntries(Object.keys(this.data.guilds).map((id) => [id, structuredClone(this.get(id))]));
    }
    getSelectedVoiceId(guildId) {
        const settings = this.get(guildId);
        return settings.voices[settings.selectedVoice] ?? this.originalVoiceId;
    }
    async mutate(guildId, mutation) {
        const settings = this.get(guildId);
        mutation(settings);
        settings.conversationChannels = sanitizeConversationChannels(settings.conversationChannels);
        await this.save();
        return settings;
    }
    async save() {
        const snapshot = `${JSON.stringify(this.data, null, 2)}\n`;
        this.writeChain = this.writeChain.then(async () => {
            const temporaryPath = `${this.filePath}.tmp`;
            await writeFile(temporaryPath, snapshot, { mode: 0o600 });
            await rename(temporaryPath, this.filePath);
        });
        await this.writeChain;
    }
}
//# sourceMappingURL=settings-store.js.map