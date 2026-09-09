import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchWakeWord, parseCommand } from "../src/commands.js";

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
});

describe("matchWakeWord", () => {
  it("extracts a same-utterance prompt", () => {
    assert.deepEqual(matchWakeWord("Hey Obama, what time is it?", "Obama"), {
      woke: true,
      prompt: "what time is it?",
    });
  });

  it("supports a wake-only utterance", () => {
    assert.deepEqual(matchWakeWord("Obama.", "Obama"), { woke: true, prompt: "" });
  });

  it("does not match inside another word", () => {
    assert.deepEqual(matchWakeWord("Obamacare", "Obama"), { woke: false, prompt: "" });
  });

  it("does not wake when the name occurs in background conversation", () => {
    assert.deepEqual(matchWakeWord("I heard Obama on television", "Obama"), {
      woke: false,
      prompt: "",
    });
  });
});

it("parses restart case-insensitively and rejects arguments", () => {
  assert.deepEqual(parseCommand("  oBaMaReStArT  "), {
    kind: "command", command: { name: "restart" },
  });
  assert.equal(parseCommand("ObamaRestart now").kind, "error");
});
