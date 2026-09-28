import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_SHORTCUTS, parseCommand } from "../src/commands.js";
import { SettingsStore } from "../src/settings-store.js";
import { ObamaBot } from "../src/bot.js";
it("shortcuts are opt-in, case-insensitive whole words and preserve arguments", () => {
    for (const [alias, full] of Object.entries(COMMAND_SHORTCUTS)) {
        assert.deepEqual(parseCommand(alias), { kind: "none" });
        assert.deepEqual(parseCommand(alias.toUpperCase(), true), parseCommand(full));
        assert.deepEqual(parseCommand(`${alias} set Hello  there\nworld`, true), parseCommand(`${full} set Hello  there\nworld`));
        assert.deepEqual(parseCommand(`${alias}suffix`, true), { kind: "none" });
    }
    assert.deepEqual(parseCommand("OT hello", true), { kind: "command", command: { name: "text", prompt: "hello" } });
    assert.deepEqual(parseCommand("OS hello", true), { kind: "command", command: { name: "speak", prompt: "hello" } });
    assert.deepEqual(parseCommand("OST", true), { kind: "command", command: { name: "status" } });
    for (const action of ["on", "off", "status", "toggle"]) {
        assert.deepEqual(parseCommand(`ObamaShortcuts ${action}`), { kind: "command", command: { name: "shortcuts", action } });
    }
    assert.deepEqual(parseCommand("ObamaShortcuts"), { kind: "command", command: { name: "shortcuts", action: "toggle" } });
    assert.equal(parseCommand("ObamaShortcuts on extra").kind, "error");
});
it("shortcuts migrate disabled, persist and remain isolated by server", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "obama-shortcuts-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, "guild-settings.json"), JSON.stringify({ version: 1, guilds: {
            old: { selectedVoice: "original", voices: {}, instructions: null, memoryEnabled: true },
            bad: { selectedVoice: "original", voices: {}, shortcutsEnabled: "true" },
        } }));
    const store = new SettingsStore(dir, "voice");
    await store.load();
    assert.equal(store.get("old").shortcutsEnabled, false);
    assert.equal(store.get("bad").shortcutsEnabled, false);
    await store.mutate("old", (settings) => { settings.shortcutsEnabled = true; });
    const reloaded = new SettingsStore(dir, "voice");
    await reloaded.load();
    assert.equal(reloaded.get("old").shortcutsEnabled, true);
    assert.equal(reloaded.get("new").shortcutsEnabled, false);
});
it("toggle requires Manage Server, status is public, and routing reads the setting", async () => {
    const methods = ObamaBot.prototype;
    const settings = { shortcutsEnabled: false };
    const replies = [];
    const commands = [];
    const context = {
        settings: { get: () => settings, async mutate(_id, change) { change(settings); } },
        client: {}, conversationMode: { async handleMessage() { } },
        async executeCommand(_message, command) { commands.push(command); },
    };
    const message = {
        guild: { id: "guild" }, guildId: "guild", member: { id: "member", guild: { ownerId: "owner" }, permissions: { has: () => false } },
        author: { bot: false }, inGuild: () => true, content: "OT hello",
        async reply(text) { replies.push(text); },
    };
    await assert.rejects(methods.executeCommand.call(context, message, { name: "shortcuts", action: "on" }), /MANAGE_GUILD_REQUIRED/);
    await methods.executeCommand.call(context, message, { name: "shortcuts", action: "status" });
    assert.match(replies[0], /off/);
    await methods.handleMessage.call(context, message);
    assert.equal(commands.length, 0);
    message.member.permissions.has = () => true;
    await methods.executeCommand.call(context, message, { name: "shortcuts", action: "toggle" });
    await methods.handleMessage.call(context, message);
    assert.deepEqual(commands, [{ name: "text", prompt: "hello" }]);
    await methods.executeCommand.call(context, message, { name: "shortcuts", action: "toggle" });
    assert.equal(settings.shortcutsEnabled, false);
});
//# sourceMappingURL=shortcuts.test.js.map