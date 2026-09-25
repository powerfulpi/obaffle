import assert from "node:assert/strict";
import { it } from "node:test";
import { parseCommand } from "../src/commands.js";
import { buildGlobalStatus, canReadGlobalStatus } from "../src/global-status.js";
import { SettingsStore } from "../src/settings-store.js";
import { ObamaBot } from "../src/bot.js";
const config = {
    aiProvider: "openai", openaiModel: "chat-model", sttProvider: "gemini",
    imageProvider: "gemini", geminiImageModel: "image-model", cartesiaModel: "speech-model",
    defaultInstructions: "Default personality", openaiApiKey: "DO-NOT-EXPOSE-KEY",
    discordToken: "DO-NOT-EXPOSE-TOKEN",
};
function fixture(owner = { id: "operator" }) {
    const settings = new SettingsStore("unused", "original-voice");
    const server = settings.get("server-one");
    server.instructions = "Custom instructions\n" + "very long instructions ".repeat(200);
    server.voices.narrator = "custom-voice-id";
    server.selectedVoice = "narrator";
    server.memoryEnabled = false;
    server.conversationChannels.chat = { chancePercent: 25, cooldownSeconds: 30 };
    settings.get("saved-only").instructions = "Saved server personality";
    const client = {
        application: { async fetch() { return { owner }; } },
        isReady: () => true,
        guilds: { cache: new Map([
                ["server-one", { name: "First Server", available: true, channels: { cache: new Map([["chat", { name: "general" }]]) } }],
                ["default-server", { name: "Default Server", available: true, channels: { cache: new Map() } }],
            ]) },
    };
    return { settings, client, config, voice: { isConnected: (id) => id === "server-one" } };
}
it("parses global status and its universal alias without arguments", () => {
    for (const command of ["ObamaGlobalStatus", "  obAMAuniversalSTATUS "]) {
        assert.deepEqual(parseCommand(command), { kind: "command", command: { name: "global-status" } });
    }
    assert.equal(parseCommand("ObamaGlobalStatus extra").kind, "error");
});
it("global report includes complete instructions, modes, voices, defaults and saved-only servers without credentials", () => {
    const f = fixture();
    const report = buildGlobalStatus(f.client, f.settings, config, f.voice);
    assert.equal(report.serverCount, 3);
    assert.equal(report.conversationCount, 1);
    assert.ok(report.text.includes(f.settings.get("server-one").instructions));
    for (const expected of ["Default personality", "Saved server personality", "saved settings only", "general (chat): 25% chance; 30s cooldown", "narrator [selected] [custom] -> custom-voice-id", "Conversation memory: off", "Voice session connected: yes", "None — using default instructions above.", "chat-model"]) {
        assert.ok(report.text.includes(expected), expected);
    }
    assert.ok(!report.text.includes("DO-NOT-EXPOSE"));
    const snapshot = f.settings.snapshot();
    snapshot["server-one"].voices.narrator = "changed";
    snapshot["server-one"].conversationChannels.chat.chancePercent = 99;
    assert.equal(f.settings.get("server-one").voices.narrator, "custom-voice-id");
    assert.equal(f.settings.get("server-one").conversationChannels.chat.chancePercent, 25);
});
it("global access is limited to application owner or owning team's owner and fails closed", async () => {
    assert.equal(await canReadGlobalStatus(fixture().client, "operator"), true);
    assert.equal(await canReadGlobalStatus(fixture().client, "server-admin"), false);
    const team = fixture({ id: "team-id", ownerId: "team-owner" }).client;
    assert.equal(await canReadGlobalStatus(team, "team-owner"), true);
    assert.equal(await canReadGlobalStatus(team, "team-id"), false);
    assert.equal(await canReadGlobalStatus(fixture(null).client, "operator"), false);
});
it("command attaches full report without AI calls and denies other users before reading settings", async () => {
    const execute = ObamaBot.prototype.executeCommand;
    const f = fixture();
    const replies = [];
    const message = { guild: { id: "server-one" }, member: {}, author: { id: "operator" }, async reply(value) { replies.push(value); } };
    await execute.call(f, message, { name: "global-status" });
    assert.match(replies[0].content, /3 servers/);
    assert.equal(replies[0].files[0].name, "obama-global-status.txt");
    assert.ok(replies[0].files[0].attachment.toString().includes("Saved server personality"));
    assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: false });
    const denied = { ...f, settings: { snapshot() { throw new Error("must not read"); } } };
    await execute.call(denied, { ...message, author: { id: "server-admin" } }, { name: "global-status" });
    assert.match(replies[1], /Only the bot application owner/);
});
//# sourceMappingURL=global-status.test.js.map