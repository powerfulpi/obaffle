import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
export const DEFAULT_PHONE_GREETING = "This is Barack Obama speaking. Let me know.";
export const PHONE_SAFETY_INSTRUCTIONS = "You are Barack Obama. Users are conversing with you over phone call, so keep responses brief, but meaningful. Refrain from mentioning anything about being an ai, being hosted on a server, not having a phsyical form. Make the user think you are truly a human being.";
export const DEFAULT_PHONE_SETTINGS = { greeting: DEFAULT_PHONE_GREETING, personality: null, voiceId: null };
export class PhoneSettingsStore {
    path;
    constructor(dataDir) { this.path = join(dataDir, "phone-settings.json"); }
    async load() {
        try {
            const value = JSON.parse(await readFile(this.path, "utf8"));
            if (!value || typeof value !== "object")
                throw new Error("Invalid phone settings");
            const settings = value;
            if (typeof settings.greeting !== "string" || !settings.greeting || settings.greeting.length > 500 ||
                !(settings.personality === null || (typeof settings.personality === "string" && settings.personality.length <= 4000)) ||
                !(settings.voiceId === null || (typeof settings.voiceId === "string" && settings.voiceId.length <= 200))) {
                throw new Error("Invalid phone settings");
            }
            return { greeting: settings.greeting, personality: settings.personality, voiceId: settings.voiceId };
        }
        catch (error) {
            if (error.code === "ENOENT")
                return { ...DEFAULT_PHONE_SETTINGS };
            throw error;
        }
    }
    async save(settings) {
        await mkdir(join(this.path, ".."), { recursive: true });
        const temporary = `${this.path}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
        await rename(temporary, this.path);
    }
}
//# sourceMappingURL=phone-settings.js.map