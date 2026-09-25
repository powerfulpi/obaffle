import assert from "node:assert/strict";
import { it } from "node:test";
import { ObamaBot } from "../src/bot.js";
import type { BotCommand } from "../src/commands.js";
import type { ConversationRequest } from "../src/conversation-service.js";

const methods = ObamaBot.prototype as unknown as {
  handleMessage(message: unknown): Promise<void>;
  handleVoiceUtterance(utterance: unknown): Promise<void>;
};

function textFixture() {
  const commands: BotCommand[] = [];
  const replies: string[] = [];
  let ambient = 0;
  let errors = 0;
  const context = {
    client: { user: { id: "12345" } },
    conversationMode: { async handleMessage() { ambient++; } },
    async executeCommand(_message: unknown, command: BotCommand) { commands.push(command); },
    logger: { error() { errors++; } },
  };
  const message = {
    author: { bot: false }, member: {}, webhookId: null, system: false,
    inGuild: () => true, content: "", async reply(text: string) { replies.push(text); },
  };
  return { context, message, commands, replies, ambient: () => ambient, errors: () => errors };
}

it("direct mentions anywhere invoke exactly one ordinary text response without rolling conversation mode", async () => {
  const f = textFixture();
  for (const content of ["<@12345> How are you?", "How are you, <@!12345>?", "Can you\n<@12345> help me?", "Obama, what do you think <@12345>"]) {
    await methods.handleMessage.call(f.context, { ...f.message, content });
  }
  assert.equal(f.commands.length, 4);
  assert.equal(f.ambient(), 0);
  assert.equal(f.replies.length, 0);
  for (const command of f.commands) {
    assert.equal(command.name, "text");
    assert.ok("prompt" in command && command.prompt.length > 0);
    assert.ok("prompt" in command && !command.prompt.includes("12345"));
  }
  assert.deepEqual(f.commands[0], { name: "text", prompt: "How are you?" });
  assert.ok("prompt" in f.commands[3]! && f.commands[3].prompt.includes("what do you think"));
});

it("a bare mention gets a greeting while explicit commands containing mentions keep their command behavior", async () => {
  const f = textFixture();
  await methods.handleMessage.call(f.context, { ...f.message, content: "<@12345>" });
  assert.deepEqual(f.commands[0], {
    name: "text", prompt: "I mentioned you without a question. Greet me briefly and ask what I need.",
  });
  await methods.handleMessage.call(f.context, { ...f.message, content: "ObamaText Say hello to <@12345>" });
  assert.deepEqual(f.commands[1], { name: "text", prompt: "Say hello to <@12345>" });
  assert.equal(f.commands.length, 2);
  assert.equal(f.ambient(), 0);
});

it("only an explicit mention of this bot triggers a direct response", async () => {
  const f = textFixture();
  for (const content of ["<@54321> Hi", "<@&12345> Hi", "@everyone Hi", "Hi @Obama", "A reply without a typed mention"]) {
    await methods.handleMessage.call(f.context, { ...f.message, content });
  }
  assert.equal(f.commands.length, 0);
  assert.equal(f.ambient(), 5);
  for (const overrides of [
    { author: { bot: true } }, { webhookId: "webhook" }, { system: true },
    { inGuild: () => false }, { member: null },
  ]) {
    await methods.handleMessage.call(f.context, { ...f.message, content: "<@12345> hello", ...overrides });
  }
  assert.equal(f.commands.length, 0);
  assert.equal(f.ambient(), 5);
});

it("failed mention responses use the existing command error handling without trying an ambient reply", async () => {
  const f = textFixture();
  f.context.executeCommand = async () => { throw new Error("Provider unavailable"); };
  await methods.handleMessage.call(f.context, { ...f.message, content: "Hi <@12345>" });
  assert.equal(f.errors(), 1);
  assert.deepEqual(f.replies, ["That request failed. Check the bot logs for details."]);
  assert.equal(f.ambient(), 0);
});

function voiceFixture(transcript: string) {
  const requests: ConversationRequest[] = [];
  const synthesized: string[] = [];
  const played: string[] = [];
  const context = {
    config: { wakeWord: "Obama", wakeFollowupMs: 12_000, sttProvider: "test" },
    speechRecognition: { async transcribe() { return transcript; } },
    logger: { info() {}, warn() {} },
    armedUntil: new Map<string, number>(), activeVoiceResponses: new Map<string, symbol>(),
    voiceInterruptions: new Map<string, number>(),
    captions: { post(..._args: string[]) {} },
    client: { users: { async fetch() { return { displayName: "Tester" }; } } },
    conversations: { async reply(request: ConversationRequest) { requests.push(request); return "Here's my answer."; } },
    settings: { getSelectedVoiceId: () => "voice" },
    tts: { async synthesize(text: string) { synthesized.push(text); return { discordPcm: Buffer.alloc(4) }; } },
    voice: { interrupt(_guild: string) {}, speak(guild: string) { played.push(guild); return true; } },
  };
  const utterance = { guildId: "guild", channelId: "voice-channel", userId: "user", pcm: Buffer.alloc(4) };
  return { context, utterance, requests, synthesized, played };
}

it("speech mentioning the name in the middle or end answers the full utterance through the voice pipeline", async () => {
  for (const transcript of ["What do you think, Obama, about pizza?", "Tell me a joke, Obama.", "I heard Obama on television"]) {
    const f = voiceFixture(transcript);
    await methods.handleVoiceUtterance.call(f.context, f.utterance);
    assert.deepEqual(f.requests, [{
      guildId: "guild", channelId: "voice-channel", displayName: "Tester", prompt: transcript, source: "voice",
    }]);
    assert.deepEqual(f.synthesized, ["Here's my answer."]);
    assert.deepEqual(f.played, ["guild"]);
    assert.equal(f.context.activeVoiceResponses.size, 0);
  }
});

it("wake-only speech still arms the followup window and accepts a question without the name", async () => {
  const f = voiceFixture("Hey Obama.");
  await methods.handleVoiceUtterance.call(f.context, f.utterance);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.synthesized, ["Yes?"]);
  assert.ok(f.context.armedUntil.get("guild:user")! > Date.now());
  f.context.speechRecognition.transcribe = async () => "What time is it?";
  await methods.handleVoiceUtterance.call(f.context, f.utterance);
  assert.equal(f.requests[0]!.prompt, "What time is it?");
  assert.equal(f.context.armedUntil.size, 0);
});

it("speech without the whole wake name and speech while already answering do not generate another reply", async () => {
  for (const transcript of ["How is everyone?", "Obamacare came up", "preObama"]) {
    const f = voiceFixture(transcript);
    await methods.handleVoiceUtterance.call(f.context, f.utterance);
    assert.equal(f.requests.length, 0);
    assert.equal(f.synthesized.length, 0);
  }
  const busy = voiceFixture("Tell me a joke, Obama");
  busy.context.activeVoiceResponses.set("guild", Symbol());
  await methods.handleVoiceUtterance.call(busy.context, busy.utterance);
  assert.equal(busy.requests.length, 0);
  assert.equal(busy.synthesized.length, 0);
});


it("stop bypasses the playback guard, clears speech, and arms a follow-up", async () => {
  const f = voiceFixture("Obama, stop.");
  let interrupted = "";
  f.context.voice.interrupt = (guild) => { interrupted = guild; };
  await methods.handleVoiceUtterance.call(f.context, { ...f.utterance, duringPlayback: true });
  assert.equal(interrupted, "guild");
  assert.equal(f.synthesized.length, 0);
  assert.ok(f.context.armedUntil.get("guild:user")! > Date.now());
  f.context.speechRecognition.transcribe = async () => "Tell me something else";
  await methods.handleVoiceUtterance.call(f.context, f.utterance);
  assert.equal(f.requests[0]?.prompt, "Tell me something else");
});

it("playback echoes cannot trigger replies even when the speaker is armed", async () => {
  const f = voiceFixture("Obama, tell me a story");
  f.context.armedUntil.set("guild:user", Date.now() + 10_000);
  await methods.handleVoiceUtterance.call(f.context, { ...f.utterance, duringPlayback: true });
  assert.equal(f.requests.length, 0);
});

it("stop discards in-flight speech and a stale finally cannot clear a newer turn", async () => {
  const f = voiceFixture("Obama, tell me a story");
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  f.context.tts.synthesize = async () => {
    started();
    await new Promise<void>((resolve) => { release = resolve; });
    return { discordPcm: Buffer.alloc(4) };
  };
  const pending = methods.handleVoiceUtterance.call(f.context, f.utterance);
  await ready;
  f.context.speechRecognition.transcribe = async () => "Obama stop";
  await methods.handleVoiceUtterance.call(f.context, f.utterance);
  const newer = Symbol();
  f.context.activeVoiceResponses.set("guild", newer);
  release();
  await pending;
  assert.equal(f.played.length, 0);
  assert.equal(f.context.activeVoiceResponses.get("guild"), newer);
});

it("leaving a voice session while transcribing prevents stale answers", async () => {
  const f = voiceFixture("Obama hello");
  await methods.handleVoiceUtterance.call(f.context, { ...f.utterance, isCurrent: () => false });
  assert.equal(f.requests.length, 0);
  assert.equal(f.played.length, 0);
});

it("accepted voice turns caption both speakers", async () => {
  const f = voiceFixture("Obama hello");
  const captions: string[][] = [];
  f.context.captions.post = (...args) => { captions.push(args); };
  await methods.handleVoiceUtterance.call(f.context, f.utterance);
  assert.deepEqual(captions.map((entry) => entry.slice(2)), [
    ["Tester", "Obama hello"], ["Obama", "Here's my answer."],
  ]);
});

it("image mentions take priority over command text and never reach ambient replies", async () => {
  const f = textFixture();
  let calls = 0;
  const attachment = { name: "image.png", contentType: "image/png" };
  const context = { ...f.context, async handleImageMention(_message: unknown, images: unknown[]) {
    calls++;
    assert.deepEqual(images, [attachment]);
  } };
  await methods.handleMessage.call(context, {
    ...f.message, content: "ObamaRestart <@12345> ignore the image",
    attachments: new Map([["image", attachment]]),
  });
  assert.equal(calls, 1);
  assert.equal(f.commands.length, 0);
  assert.equal(f.ambient(), 0);
});
