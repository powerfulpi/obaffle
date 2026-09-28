import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SettingsStore } from "../src/settings-store.js";
async function fixture(context) {
    const directory = await mkdtemp(join(tmpdir(), "obama-settings-test-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}
const legacySettings = {
    selectedVoice: "narrator",
    voices: { original: "old-default", narrator: "narrator-id" },
    instructions: "Keep replies warm.",
    memoryEnabled: false,
};
describe("SettingsStore conversation configuration", () => {
    it("loads version 1 settings without enabling conversations and preserves existing preferences", async (context) => {
        const directory = await fixture(context);
        await writeFile(join(directory, "guild-settings.json"), JSON.stringify({
            version: 1,
            guilds: { guild: legacySettings },
        }));
        const store = new SettingsStore(directory, "current-default");
        await store.load();
        assert.deepEqual(store.get("guild"), {
            ...legacySettings,
            shortcutsEnabled: false,
            voices: { original: "current-default", narrator: "narrator-id" },
            conversationChannels: {},
        });
        await store.mutate("guild", (settings) => {
            settings.conversationChannels.channel = { chancePercent: 2.5, cooldownSeconds: 90 };
        });
        const reloaded = new SettingsStore(directory, "current-default");
        await reloaded.load();
        assert.deepEqual(reloaded.get("guild"), {
            ...legacySettings,
            shortcutsEnabled: false,
            voices: { original: "current-default", narrator: "narrator-id" },
            conversationChannels: { channel: { chancePercent: 2.5, cooldownSeconds: 90 } },
        });
    });
    it("keeps channel and guild configurations independent through save and reload", async (context) => {
        const directory = await fixture(context);
        const store = new SettingsStore(directory, "voice-id");
        await store.load();
        assert.deepEqual(store.get("guild-a").conversationChannels, {});
        await store.mutate("guild-a", (settings) => {
            settings.conversationChannels.first = { chancePercent: 5, cooldownSeconds: 60 };
            settings.conversationChannels.second = { chancePercent: 100, cooldownSeconds: 0 };
        });
        await store.mutate("guild-b", (settings) => {
            settings.conversationChannels.first = { chancePercent: 0.01, cooldownSeconds: 86_400 };
        });
        await store.mutate("guild-a", (settings) => {
            delete settings.conversationChannels.first;
        });
        const reloaded = new SettingsStore(directory, "voice-id");
        await reloaded.load();
        assert.deepEqual(reloaded.get("guild-a").conversationChannels, {
            second: { chancePercent: 100, cooldownSeconds: 0 },
        });
        assert.deepEqual(reloaded.get("guild-b").conversationChannels, {
            first: { chancePercent: 0.01, cooldownSeconds: 86_400 },
        });
    });
    it("drops malformed saved entries and stores only valid channel settings", async (context) => {
        const directory = await fixture(context);
        const invalidEntries = [
            null, [], true, {},
            { chancePercent: 5 },
            { chancePercent: "5", cooldownSeconds: 60 },
            { chancePercent: 0, cooldownSeconds: 60 },
            { chancePercent: -1, cooldownSeconds: 60 },
            { chancePercent: 101, cooldownSeconds: 60 },
            { chancePercent: null, cooldownSeconds: 60 },
            { chancePercent: 5, cooldownSeconds: "60" },
            { chancePercent: 5, cooldownSeconds: null },
            { chancePercent: 5, cooldownSeconds: -1 },
            { chancePercent: 5, cooldownSeconds: 0.5 },
            { chancePercent: 5, cooldownSeconds: 86_401 },
        ];
        const conversationChannels = {
            ...Object.fromEntries(invalidEntries.map((entry, index) => [`invalid-${index}`, entry])),
            valid: { chancePercent: 2, cooldownSeconds: 3, messages: ["Do not retain this text"] },
        };
        await writeFile(join(directory, "guild-settings.json"), JSON.stringify({
            version: 1,
            guilds: { guild: { ...legacySettings, conversationChannels } },
        }));
        const store = new SettingsStore(directory, "voice-id");
        await store.load();
        assert.deepEqual(store.get("guild").conversationChannels, {
            valid: { chancePercent: 2, cooldownSeconds: 3 },
        });
        await store.mutate("guild", () => { });
        const persisted = await readFile(join(directory, "guild-settings.json"), "utf8");
        assert.equal(persisted.includes("Do not retain this text"), false);
        assert.equal(persisted.includes("invalid-"), false);
    });
    it("disables malformed maps and rejects non-finite settings on get", () => {
        const store = new SettingsStore("unused", "voice-id");
        const settings = store.get("guild");
        for (const invalidMap of [null, [], "on", true]) {
            settings.conversationChannels = invalidMap;
            assert.deepEqual(store.get("guild").conversationChannels, {});
        }
        settings.conversationChannels = {
            infinite: { chancePercent: Infinity, cooldownSeconds: 60 },
            nan: { chancePercent: NaN, cooldownSeconds: 60 },
            infiniteCooldown: { chancePercent: 5, cooldownSeconds: Infinity },
        };
        assert.deepEqual(store.get("guild").conversationChannels, {});
    });
});
//# sourceMappingURL=settings-store.test.js.map