import assert from "node:assert/strict";
import { it } from "node:test";
import type { Client } from "discord.js";
import { isVoiceStop } from "../src/commands.js";
import { LiveCaptions } from "../src/live-captions.js";
import type { Logger } from "../src/logger.js";

it("stop matching requires a wake name and an explicit short stop phrase", () => {
  for (const text of ["Obama, stop!", "Hey Obama stop talking.", "stop, Obama.", "Obama please be quiet", "Obama cancel"]) {
    assert.equal(isVoiceStop(text, "Obama"), true, text);
  }
  for (const text of ["stop", "Obama why should I stop?", "Obama stop by the store", "Obamacare stop", "Tell Obama to stop"]) {
    assert.equal(isVoiceStop(text, "Obama"), false, text);
  }
});

it("captions from multiple servers share one destination in order, split long text, and disable pings", async () => {
  const sent: Array<{ content: string; allowedMentions: unknown }> = [];
  let fetches = 0;
  const channel = { guildId: "guild", isSendable: () => true, async send(message: typeof sent[number]) { sent.push(message); } };
  const client = { channels: { async fetch() { fetches++; return channel; } } } as unknown as Client;
  const logger = { warn() {} } as unknown as Logger;
  const disabled = new LiveCaptions(client, logger, "", "guild");
  disabled.post("guild", "voice", "User", "hidden");
  const captions = new LiveCaptions(client, logger, "text-channel", "guild");
  captions.post("guild", "voice", "User", "@everyone " + "a".repeat(4_000));
  captions.post("guild", "voice", "Obama", "reply");
  captions.post("other-guild", "other-voice", "User", "cross-server caption");
  await new Promise(setImmediate);
  assert.equal(fetches, 3);
  assert.equal(sent.length, 5);
  assert.ok(sent.every((entry) => entry.content.length <= 1_900));
  assert.match(sent[0]!.content, /Server guild.*Voice <#voice>/);
  assert.match(sent.at(-1)!.content, /Server other-guild.*Voice <#other-voice>.*cross-server caption/);
  assert.deepEqual(sent[0]?.allowedMentions, { parse: [] });
  assert.match(sent[3]!.content, /Obama: reply$/);
});

it("caption delivery recovers after a failed Discord send", async () => {
  let attempts = 0;
  let warnings = 0;
  const client = { channels: { async fetch() { return {
    guildId: "guild", isSendable: () => true,
    async send() { if (++attempts === 1) throw new Error("Missing permissions"); },
  }; } } } as unknown as Client;
  const captions = new LiveCaptions(client, { warn() { warnings++; } } as unknown as Logger, "captions", "guild");
  captions.post("guild", "voice", "User", "one");
  captions.post("guild", "voice", "Obama", "two");
  await new Promise(setImmediate);
  assert.equal(attempts, 2);
  assert.equal(warnings, 1);
});

it("interrupting the real audio player empties its queue and permits a fresh reply", async () => {
  const { EventEmitter } = await import("node:events");
  const { AudioPlayerStatus } = await import("@discordjs/voice");
  const { VoiceSession } = await import("../src/voice-manager.js");
  let player!: import("@discordjs/voice").AudioPlayer;
  const connection = Object.assign(new EventEmitter(), {
    receiver: { speaking: new EventEmitter() },
    subscribe(value: typeof player) { player = value; }, destroy() {},
  });
  const config = { voiceFeedbackCooldownMs: 1500 } as import("../src/config.js").AppConfig;
  const logger = { info() {}, error() {}, warn() {} } as unknown as Logger;
  const session = new VoiceSession({} as Client, "guild", "voice", connection as unknown as import("@discordjs/voice").VoiceConnection, config, logger, async () => {}, () => {});
  try {
    const pcm = Buffer.alloc(48_000 * 4);
    session.enqueue(pcm);
    session.enqueue(pcm);
    session.interrupt();
    assert.equal(player.state.status, AudioPlayerStatus.Idle);
    // A stale queued resource would be started by the Idle handler if not cleared.
    await new Promise(setImmediate);
    assert.equal(player.state.status, AudioPlayerStatus.Idle);
    session.enqueue(pcm);
    assert.notEqual(player.state.status, AudioPlayerStatus.Idle);
  } finally {
    session.destroy();
  }
});


it("captions require both destination IDs and reject a mismatched destination guild", async () => {
  let fetches = 0;
  let sends = 0;
  let warnings = 0;
  const client = { channels: { async fetch() {
    fetches++;
    return { guildId: "wrong-server", isSendable: () => true, async send() { sends++; } };
  } } } as unknown as Client;
  const logger = { warn() { warnings++; } } as unknown as Logger;
  new LiveCaptions(client, logger, "channel", "").post("source", "voice", "User", "disabled");
  new LiveCaptions(client, logger, "", "destination").post("source", "voice", "User", "disabled");
  new LiveCaptions(client, logger, "channel", "destination").post("source", "voice", "User", "mismatch");
  await new Promise(setImmediate);
  assert.equal(fetches, 1);
  assert.equal(sends, 0);
  assert.equal(warnings, 1);
});
