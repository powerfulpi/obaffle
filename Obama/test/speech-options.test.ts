import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CartesiaTts } from "../src/cartesia.js";
import { parseCommand } from "../src/commands.js";
import { SettingsStore } from "../src/settings-store.js";
import { WORST_SPEECH_MODEL } from "../src/speech-options.js";

it("parses model toggles and emotions, rejecting unsupported values", () => {
  assert.deepEqual(parseCommand("ObamaVoice model toggle"), { kind: "command", command: { name: "voice", action: "model", mode: "toggle" } });
  assert.deepEqual(parseCommand("OV emotion ANGRY", true), { kind: "command", command: { name: "voice", action: "emotion", emotion: "angry" } });
  assert.deepEqual(parseCommand("ObamaVoice emotion reset"), { kind: "command", command: { name: "voice", action: "emotion", emotion: "auto" } });
  for (const command of ["model invalid", "emotion invalid", "model worst extra", "emotion sad extra"]) {
    assert.equal(parseCommand("ObamaVoice " + command).kind, "error");
  }
});

it("sends slowest speed and emotion per request and restores the configured model", async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(new Uint8Array([0, 0, 0, 0]));
  });
  const tts = new CartesiaTts("test", "sonic-latest");
  await tts.synthesize("Hello", "voice");
  await tts.synthesize("Hello", "voice", { speechMode: "worst", speechEmotion: "sad" });
  await tts.synthesize("Hello", "voice", { speechMode: "current", speechEmotion: "happy" });
  await tts.synthesize("Hello", "voice", { speechMode: "current", speechEmotion: null });
  assert.equal(requests[0].model_id, "sonic-latest");
  assert.equal(requests[0].generation_config, undefined);
  assert.equal(requests[1].model_id, WORST_SPEECH_MODEL);
  assert.deepEqual(requests[1].generation_config, { speed: 0.6, emotion: "sad" });
  assert.deepEqual(requests[2].generation_config, { emotion: "happy" });
  assert.equal(requests[3].model_id, "sonic-latest");
  assert.equal(requests[3].generation_config, undefined);
  assert.deepEqual(requests[1].voice, { id: "voice" });
});

it("persists server choices independently and sanitizes invalid saved speech settings", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "obama-speech-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new SettingsStore(dir, "original");
  await store.load();
  await store.mutate("one", (settings) => { settings.speechMode = "worst"; settings.speechEmotion = "angry"; });
  const reloaded = new SettingsStore(dir, "original");
  await reloaded.load();
  assert.equal(reloaded.get("one").speechMode, "worst");
  assert.equal(reloaded.get("one").speechEmotion, "angry");
  assert.equal(reloaded.get("two").speechMode, "current");
  assert.equal(reloaded.get("two").speechEmotion, null);
  await writeFile(join(dir, "guild-settings.json"), JSON.stringify({ version: 1, guilds: {
    one: { ...store.get("one"), speechMode: "bad", speechEmotion: "bad" },
  } }));
  await reloaded.load();
  assert.equal(reloaded.get("one").speechMode, "current");
  assert.equal(reloaded.get("one").speechEmotion, null);
});
