import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchBotMention, matchWakeWord, parseCommand } from "../src/commands.js";
describe("parseCommand", () => {
    it("parses text and speech prompts case-insensitively", () => {
        assert.deepEqual(parseCommand("obamatext how are you?"), {
            kind: "command",
            command: { name: "text", prompt: "how are you?" },
        });
        assert.deepEqual(parseCommand("ObamaSpeak Tell me a story"), {
            kind: "command",
            command: { name: "speak", prompt: "Tell me a story" },
        });
    });
    it("preserves spaces inside custom instructions", () => {
        assert.deepEqual(parseCommand("ObamaInstructions set Be brief, but warm."), {
            kind: "command",
            command: {
                name: "instructions",
                action: "set",
                instructions: "Be brief, but warm.",
            },
        });
    });
    it("parses voice aliases and ids", () => {
        assert.deepEqual(parseCommand("ObamaVoice add narrator abcdefgh-1234"), {
            kind: "command",
            command: {
                name: "voice",
                action: "add",
                alias: "narrator",
                voiceId: "abcdefgh-1234",
            },
        });
    });
    it("ignores ordinary messages", () => {
        assert.deepEqual(parseCommand("hello there"), { kind: "none" });
    });
    it("parses conversation controls and leaves omitted settings unspecified", () => {
        assert.deepEqual(parseCommand("oBaMaCoNvErSaTiOn ON"), {
            kind: "command",
            command: { name: "conversation", action: "on" },
        });
        assert.deepEqual(parseCommand("ObamaConversationMode on 2.5 120"), {
            kind: "command",
            command: { name: "conversation", action: "on", chancePercent: 2.5, cooldownSeconds: 120 },
        });
        assert.deepEqual(parseCommand("ObamaConversation on .5"), {
            kind: "command",
            command: { name: "conversation", action: "on", chancePercent: 0.5 },
        });
        for (const action of ["off", "status"]) {
            assert.deepEqual(parseCommand(`ObamaConversation ${action}`), {
                kind: "command", command: { name: "conversation", action },
            });
        }
    });
    it("accepts conversation probability and cooldown boundaries", () => {
        for (const cooldownSeconds of [0, 86_400]) {
            assert.deepEqual(parseCommand(`ObamaConversation on 100 ${cooldownSeconds}`), {
                kind: "command",
                command: { name: "conversation", action: "on", chancePercent: 100, cooldownSeconds },
            });
        }
        assert.equal(parseCommand("ObamaConversation on 0.001 1").kind, "command");
    });
    it("rejects invalid conversation probabilities and cooldowns", () => {
        for (const chance of ["0", "-1", "100.01", "NaN", "Infinity", "1e1", "0x10", "5%", "+5", "."]) {
            assert.equal(parseCommand(`ObamaConversation on ${chance}`).kind, "error", chance);
        }
        for (const cooldown of ["-1", "86401", "1.5", "1.0", "1e2", "Infinity", "NaN", "+1"]) {
            assert.equal(parseCommand(`ObamaConversation on 5 ${cooldown}`).kind, "error", cooldown);
        }
        for (const args of ["", "enable", "off 5", "status 5", "on 5 60 extra"]) {
            assert.equal(parseCommand(`ObamaConversation ${args}`).kind, "error", args);
        }
    });
    it("preserves spaces and newlines in DM announcements", () => {
        const text = "You're  appreciated.\n\nHave a lovely day!";
        assert.deepEqual(parseCommand(`oBaMaDmAlL ${text}`), {
            kind: "command", command: { name: "dm-all", action: "send", text },
        });
        assert.deepEqual(parseCommand("ObamaDMAll status update: you're wonderful"), {
            kind: "command",
            command: { name: "dm-all", action: "send", text: "status update: you're wonderful" },
        });
    });
    it("reserves only exact status/cancel arguments for DM controls", () => {
        for (const action of ["status", "cancel"]) {
            assert.deepEqual(parseCommand(`ObamaDMAll  ${action.toUpperCase()}  `), {
                kind: "command", command: { name: "dm-all", action },
            });
        }
        assert.deepEqual(parseCommand("ObamaDMAll cancel your worries"), {
            kind: "command",
            command: { name: "dm-all", action: "send", text: "cancel your worries" },
        });
    });
    it("requires a DM message and enforces its length limit", () => {
        assert.equal(parseCommand("ObamaDMAll \n\t").kind, "error");
        assert.equal(parseCommand(`ObamaDMAll ${"a".repeat(1_800)}`).kind, "command");
        assert.equal(parseCommand(`ObamaDMAll ${"a".repeat(1_801)}`).kind, "error");
    });
});
describe("matchWakeWord", () => {
    it("extracts a prompt after a leading name or greeting", () => {
        for (const transcript of [
            "Obama, what time is it?",
            "Hey Obama, what time is it?",
            "  oKaY oBaMa! what time is it?  ",
            "ok Obama — what time is it?",
        ]) {
            assert.deepEqual(matchWakeWord(transcript, "Obama"), {
                woke: true,
                prompt: "what time is it?",
            }, transcript);
        }
    });
    it("keeps wake-only utterances empty for the existing greeting and follow-up flow", () => {
        for (const transcript of ["Obama", "Obama.", " Hey Obama! ", "Okay Obama", "OK Obama?"]) {
            assert.deepEqual(matchWakeWord(transcript, "Obama"), { woke: true, prompt: "" }, transcript);
        }
    });
    it("preserves the entire prompt when the name is in the middle or at the end", () => {
        for (const transcript of [
            "I heard Obama on television",
            "What do you think, Obama?",
            "Can you help, oBaMa, with this problem?",
            "Is this right Obama",
            "Tell me about this.\nObama, what do you think?",
        ]) {
            assert.deepEqual(matchWakeWord(`  ${transcript}  `, "Obama"), {
                woke: true,
                prompt: transcript,
            }, transcript);
        }
    });
    it("requires the whole name and ignores speech without it", () => {
        for (const transcript of [
            "Obamacare",
            "What is Obamacare?",
            "preObama",
            "This is preObama history",
            "Obama2",
            "Ask Obama_bot",
            "éObama",
            "Obamaé",
            "What time is it?",
            "",
        ]) {
            assert.deepEqual(matchWakeWord(transcript, "Obama"), { woke: false, prompt: "" }, transcript);
        }
    });
    it("escapes configurable wake names and handles their punctuation literally", () => {
        assert.deepEqual(matchWakeWord("Hey O.bama+, help me", "O.bama+"), {
            woke: true, prompt: "help me",
        });
        assert.deepEqual(matchWakeWord("Can you help, O.bama+?", "O.bama+"), {
            woke: true, prompt: "Can you help, O.bama+?",
        });
        for (const transcript of ["Oxbama", "Tell me Oxbama+", "preO.bama+", "O.bama+care"]) {
            assert.deepEqual(matchWakeWord(transcript, "O.bama+"), { woke: false, prompt: "" }, transcript);
        }
    });
    it("does not wake for an empty configured name", () => {
        for (const wakeWord of ["", "  "]) {
            assert.deepEqual(matchWakeWord("anything", wakeWord), { woke: false, prompt: "" });
        }
    });
});
describe("matchBotMention", () => {
    const botId = "123456789012345678";
    it("matches either user mention form at the beginning, middle, or end", () => {
        for (const mention of [`<@${botId}>`, `<@!${botId}>`]) {
            for (const [content, prompt] of [
                [`${mention} How are you?`, "How are you?"],
                [`Can ${mention} help me?`, "Can  help me?"],
                [`What do you think? ${mention}`, "What do you think?"],
                [`Hello,${mention}!`, "Hello,!"],
            ]) {
                assert.deepEqual(matchBotMention(content, botId), { mentioned: true, prompt }, content);
            }
        }
    });
    it("removes every own mention while preserving other users, punctuation, and line breaks", () => {
        assert.deepEqual(matchBotMention(`  <@${botId}> Please help <@999>.\n\nThis part, <@!${botId}>, matters.  `, botId), {
            mentioned: true,
            prompt: "Please help <@999>.\n\nThis part, , matters.",
        });
    });
    it("matches mentions after a newline", () => {
        assert.deepEqual(matchBotMention(`Please help.\n<@${botId}>\nWhat now?`, botId), {
            mentioned: true, prompt: "Please help.\n\nWhat now?",
        });
    });
    it("returns an empty prompt for mention-only messages", () => {
        for (const content of [`<@${botId}>`, ` \n<@!${botId}>  `, `<@${botId}> <@!${botId}>`]) {
            assert.deepEqual(matchBotMention(content, botId), { mentioned: true, prompt: "" });
        }
    });
    it("ignores other users, role mentions, broadcasts, plain names, and partial ids", () => {
        for (const content of [
            "Hello there",
            "@Obama help",
            "@everyone help",
            "@here help",
            "<@999> help",
            `<@&${botId}> help`,
            `<@${botId}9> help`,
            `<@${botId.slice(0, -1)}> help`,
            `<@${botId}`,
            "",
        ]) {
            assert.deepEqual(matchBotMention(content, botId), { mentioned: false, prompt: "" }, content);
        }
    });
    it("does not match when the bot user id is unavailable", () => {
        for (const content of ["<@> hello", "<@!>", `<@${botId}> hello`]) {
            assert.deepEqual(matchBotMention(content, ""), { mentioned: false, prompt: "" });
        }
    });
});
it("parses restart case-insensitively and rejects arguments", () => {
    assert.deepEqual(parseCommand("  oBaMaReStArT  "), {
        kind: "command", command: { name: "restart" },
    });
    assert.equal(parseCommand("ObamaRestart now").kind, "error");
});
//# sourceMappingURL=commands.test.js.map