import assert from "node:assert/strict";
import { it } from "node:test";
import { ObamaBot } from "../src/bot.js";
import { parseCommand } from "../src/commands.js";
import { ConversationService } from "../src/conversation-service.js";
import { Logger } from "../src/logger.js";
import { ConversationMemory } from "../src/memory.js";
import { SettingsStore } from "../src/settings-store.js";
it("parses status case-insensitively and rejects arguments", () => {
    assert.deepEqual(parseCommand("  oBaMaStAtUs  "), {
        kind: "command", command: { name: "status" },
    });
    assert.equal(parseCommand("ObamaStatus now").kind, "error");
});
it("reports runtime facts using the current personality without reading or changing memory", async () => {
    const execute = ObamaBot.prototype.executeCommand;
    const config = {
        aiProvider: "gemini", geminiModel: "test-gemini", openaiModel: "test-openai",
        defaultInstructions: "Default personality", maxResponseCharacters: 3500,
    };
    const settings = new SettingsStore("unused", "voice-id");
    settings.get("guild").instructions = "Speak like a pirate.";
    settings.get("guild").memoryEnabled = true;
    const memory = new ConversationMemory(20);
    memory.addExchange("guild:channel", "Old status", "Old readings");
    const before = memory.get("guild:channel");
    const requests = [];
    const conversations = new ConversationService(config, {
        async generate(request) {
            requests.push(request);
            return "Arrr, here's me status.";
        },
    }, settings, memory, new Logger("error"));
    const replies = [];
    let typing = 0;
    const context = {
        config, settings, conversations,
        client: { isReady: () => true, uptime: 90_000, ws: { ping: 42.4 }, guilds: { cache: { size: 3 } } },
        voice: { isConnected: () => true },
        activeImages: new Set(["guild"]), activeVoiceResponses: new Set(),
    };
    const message = {
        guild: { id: "guild" }, member: { displayName: "Tester" },
        channel: { id: "channel", sendTyping: async () => { typing++; } },
        reply: async (text) => { replies.push(text); },
    };
    await execute.call(context, message, { name: "status" });
    assert.equal(typing, 1);
    assert.deepEqual(replies, ["Arrr, here's me status."]);
    assert.equal(requests[0].instructions, "Speak like a pirate.");
    assert.equal(requests[0].messages.length, 1);
    const facts = JSON.parse(requests[0].messages[0].content.split("\n").at(-1));
    assert.equal(facts.discordUptimeSeconds, 90);
    assert.equal(facts.gatewayLatencyMs, 42);
    assert.equal(facts.chatModel, "test-gemini");
    assert.equal(facts.voiceSessionInThisServer, true);
    assert.equal(facts.conversationMemoryEnabled, true);
    assert.equal(facts.imageGenerationInProgressInThisServer, true);
    assert.ok(facts.processUptimeSeconds >= 0);
    assert.ok(facts.processMemoryMiB > 0);
    assert.deepEqual(memory.get("guild:channel"), before);
    settings.get("guild").instructions = null;
    config.aiProvider = "openai";
    context.client.isReady = () => false;
    context.client.ws.ping = -1;
    await execute.call(context, message, { name: "status" });
    assert.equal(requests[1].instructions, "Default personality");
    const unavailable = JSON.parse(requests[1].messages[0].content.split("\n").at(-1));
    assert.equal(unavailable.discordConnection, "not ready");
    assert.equal(unavailable.discordUptimeSeconds, null);
    assert.equal(unavailable.gatewayLatencyMs, null);
    assert.equal(unavailable.chatModel, "test-openai");
});
//# sourceMappingURL=status.test.js.map