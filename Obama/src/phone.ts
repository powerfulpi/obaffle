import "dotenv/config";
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { createProviders } from "./providers/index.js";
import { CartesiaTts } from "./cartesia.js";
import { speechText } from "./audio.js";
import type { ChatMessage } from "./types.js";
import { PhoneSettingsStore, DEFAULT_PHONE_GREETING, PHONE_SAFETY_INSTRUCTIONS, type PhoneSettings } from "./phone-settings.js";

const config = loadConfig({ validateSecrets: false });
const token = process.env.PHONE_WEBHOOK_TOKEN ?? "";
const publicUrl = (process.env.PHONE_PUBLIC_URL ?? "").replace(/\/$/, "");
const port = Number(process.env.PHONE_PORT ?? 3002);
const phoneMinRmsDbfs = Number(process.env.PHONE_MIN_RMS_DBFS ?? -35);
const phoneMinActiveMs = Number(process.env.PHONE_MIN_ACTIVE_SPEECH_MS ?? 350);
if (!/^[a-zA-Z0-9_-]{32,}$/.test(token)) throw new Error("PHONE_WEBHOOK_TOKEN must be at least 32 random URL-safe characters");
if (!/^https:\/\/[^/]+$/.test(publicUrl)) throw new Error("PHONE_PUBLIC_URL must be a public HTTPS origin without a path");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PHONE_PORT must be a valid port");
if (!Number.isFinite(phoneMinRmsDbfs) || phoneMinRmsDbfs < -60 || phoneMinRmsDbfs > -10) throw new Error("PHONE_MIN_RMS_DBFS must be from -60 to -10");
if (!Number.isInteger(phoneMinActiveMs) || phoneMinActiveMs < 100 || phoneMinActiveMs > 3000) throw new Error("PHONE_MIN_ACTIVE_SPEECH_MS must be from 100 to 3000");
if (!config.cartesiaApiKey || !config.cartesiaDefaultVoiceId) throw new Error("Set CARTESIA_API_KEY and CARTESIA_DEFAULT_VOICE_ID");
const providers = createProviders(config);
const tts = new CartesiaTts(config.cartesiaApiKey, config.cartesiaModel);
const route = `/phone/${token}`;
const wsUrl = `${publicUrl.replace(/^https:/, "wss:")}${route}/stream`;
const phoneSettings = new PhoneSettingsStore(config.dataDir);

const server = createServer((request, response) => {
  if (request.method !== "POST" || !matches(request.url, route)) {
    response.writeHead(404).end();
    return;
  }
  // The unpredictable route is a shared secret. Keep it out of logs and screenshots.
  response.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${wsUrl}" /></Connect></Response>`);
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on("upgrade", (request, socket, head) => {
  if (!matches(request.url, `${route}/stream`)) { socket.destroy(); return; }
  sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit("connection", ws));
});
sockets.on("connection", (ws) => new PhoneCall(ws).start());
server.listen(port, "127.0.0.1", () => console.log(`Phone server listening on 127.0.0.1:${port}`));

function matches(actual: string | undefined, expected: string): boolean {
  const a = createHash("sha256").update(actual ?? "").digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

class PhoneCall {
  private streamSid = "";
  private chunks: Buffer[] = [];
  private samples = 0;
  private silenceMs = 0;
  private activeMs = 0;
  private busy = false;
  private closed = false;
  private history: ChatMessage[] = [];
  private timer?: NodeJS.Timeout;
  private playbackMark: { name: string; resolve: () => void; timeout: NodeJS.Timeout } | undefined;
  private markSequence = 0;
  private settings?: PhoneSettings;

  constructor(private readonly ws: WebSocket) {}

  start(): void {
    this.ws.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as { event?: string; streamSid?: string; media?: { payload?: string }; mark?: { name?: string } };
        if (event.event === "start" && event.streamSid) {
          this.streamSid = event.streamSid;
          this.busy = true;
          void phoneSettings.load().then((settings) => { this.settings = settings; return this.say(settings.greeting === DEFAULT_PHONE_GREETING ? settings.greeting : `This is an AI assistant called Obama, not Barack Obama. ${settings.greeting}`); }).catch((error) => this.fail(error)).finally(() => { this.busy = false; });
        } else if (event.event === "media" && event.media?.payload) {
          this.receive(Buffer.from(event.media.payload, "base64"));
        } else if (event.event === "mark" && event.mark?.name === this.playbackMark?.name) {
          const pending = this.playbackMark;
          if (pending) {
            this.playbackMark = undefined;
            clearTimeout(pending.timeout);
            pending.resolve();
          }
        } else if (event.event === "stop") {
          this.close();
        }
      } catch (error) { this.fail(error); }
    });
    this.ws.on("close", () => this.close());
    this.ws.on("error", (error) => this.fail(error));
    this.timer = setTimeout(() => this.ws.close(), 15 * 60_000);
  }

  private receive(ulaw: Buffer): void {
    if (this.busy || this.closed || ulaw.length > 16_000) return;
    const pcm = decodeMulaw(ulaw);
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 2) { const value = pcm.readInt16LE(i); sum += value * value; }
    const dbfs = 20 * Math.log10(Math.sqrt(sum / Math.max(1, pcm.length / 2)) / 32768);
    const frameMs = pcm.length / 16;
    const active = dbfs > phoneMinRmsDbfs;
    if (active) { this.activeMs += frameMs; this.silenceMs = 0; }
    else if (this.activeMs) this.silenceMs += frameMs;
    if (this.activeMs) { this.chunks.push(pcm); this.samples += pcm.length / 2; }
    const finished = this.activeMs > 0 && this.silenceMs >= config.speechEndSilenceMs;
    const tooLong = this.samples >= config.maxUtteranceSeconds * 8000;
    if (finished || tooLong) {
      const durationMs = this.samples / 8;
      const activeMs = this.activeMs;
      const audio = Buffer.concat(this.chunks);
      this.resetInput();
      if (durationMs >= config.voiceMinUtteranceMs && activeMs >= phoneMinActiveMs) void this.answer(audio).catch((error) => this.fail(error));
    }
  }

  private async answer(pcm: Buffer): Promise<void> {
    this.busy = true;
    this.resetInput();
    try {
      const transcript = (await providers.speechRecognition.transcribe(wav8k(pcm))).trim();
      if (!transcript || this.closed) return;
      console.log("Phone transcript", transcript);
      const messages: ChatMessage[] = [...this.history, { role: "user", content: transcript }];
      const instructions = `${config.defaultInstructions}\n${this.settings?.personality ?? ""}\n${PHONE_SAFETY_INSTRUCTIONS}`;
      const reply = await providers.chat.generate({ instructions, messages, maxOutputCharacters: Math.min(config.maxResponseCharacters, 700) });
      if (this.closed) return;
      this.history = [...messages, { role: "assistant" as const, content: reply }].slice(-config.maxMemoryMessages);
      await this.say(reply);
    } finally { this.resetInput(); this.busy = false; }
  }

  private async say(message: string): Promise<void> {
    if (!this.streamSid || this.closed) return;
    const speech = await tts.synthesize(speechText(message), this.settings?.voiceId ?? config.cartesiaDefaultVoiceId);
    if (this.closed) return;
    const audio = encodeMulaw48k(speech.discordPcm);
    for (let offset = 0; offset < audio.length; offset += 160) {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ event: "media", streamSid: this.streamSid, media: { payload: audio.subarray(offset, offset + 160).toString("base64") } }));
      if (offset + 160 < audio.length) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const name = `playback-${++this.markSequence}`;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.playbackMark = undefined;
        reject(new Error("Twilio did not confirm audio playback"));
      }, Math.max(10_000, audio.length / 8 + 10_000));
      this.playbackMark = { name, resolve, timeout };
      this.ws.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name } }));
    });
    if (!this.closed) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private resetInput(): void {
    this.chunks = []; this.samples = 0; this.silenceMs = 0; this.activeMs = 0;
  }

  private fail(error: unknown): void {
    console.error("Phone call error", error);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }

  private close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.playbackMark) {
      clearTimeout(this.playbackMark.timeout);
      this.playbackMark.resolve();
      this.playbackMark = undefined;
    }
    this.history = []; this.resetInput();
  }
}

function wav8k(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function decodeMulaw(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const value = ~(input[i] ?? 0) & 255;
    const magnitude = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, (value & 128) ? 132 - magnitude : magnitude - 132)), i * 2);
  }
  return output;
}

function encodeMulaw48k(stereo: Buffer): Buffer {
  const output = Buffer.alloc(Math.floor(stereo.length / 24));
  for (let i = 0; i < output.length; i++) {
    let sample = stereo.readInt16LE(i * 24);
    const sign = sample < 0 ? 0x80 : 0;
    sample = Math.min(32635, Math.abs(sample)) + 132;
    let exponent = 7;
    for (let mask = 0x4000; exponent > 0 && !(sample & mask); mask >>= 1) exponent--;
    output[i] = ~(sign | (exponent << 4) | ((sample >> (exponent + 3)) & 15)) & 255;
  }
  return output;
}
