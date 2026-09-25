import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
const VOICE_ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
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
        };
        this.data.guilds[guildId] = created;
        return created;
    }
    getSelectedVoiceId(guildId) {
        const settings = this.get(guildId);
        return settings.voices[settings.selectedVoice] ?? this.originalVoiceId;
    }
    async mutate(guildId, mutation) {
        const settings = this.get(guildId);
        mutation(settings);
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