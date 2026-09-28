import assert from "node:assert/strict";
import { it } from "node:test";
import { parseCommand } from "../src/commands.js";
import { OpenAIImageGenerator } from "../src/providers/openai-image-generator.js";
import { GeminiImageGenerator } from "../src/providers/gemini-image-generator.js";
import { ObamaBot } from "../src/bot.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const reference = { mimeType: "image/png", data: png.toString("base64") };
const attachment = { url: "https://cdn.discordapp.com/attachments/a/b/test.png", size: png.length, name: "test.png", contentType: "image/png" };

it("recreation accepts an empty prompt or preserves optional instructions", () => {
  assert.deepEqual(parseCommand("ObamaImage --recreate"), { kind: "command", command: { name: "image", recreate: true, prompt: "" } });
  assert.deepEqual(parseCommand("OI --RECREATE keep colors\nand text", true), { kind: "command", command: { name: "image", recreate: true, prompt: "keep colors\nand text" } });
  assert.deepEqual(parseCommand("ObamaImage --recreateish"), { kind: "command", command: { name: "image", prompt: "--recreateish" } });
});

it("OpenAI recreation uploads original bytes to edits using multipart", async () => {
  const generator = new OpenAIImageGenerator("key", "model", async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    assert.equal((init?.headers as any)["Content-Type"], undefined);
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("model"), "model");
    assert.match(String(init.body.get("prompt")), /faithfully/);
    assert.match(String(init.body.get("prompt")), /keep colors/);
    const file = init.body.get("image") as File;
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
    return Response.json({ data: [{ b64_json: reference.data }] });
  });
  assert.deepEqual(await generator.generate("keep colors", reference), png);
});

it("Gemini recreation retains the reference and fidelity instructions on retry", async () => {
  let calls = 0;
  const generator = new GeminiImageGenerator("key", "model", async (_url, init) => {
    const parts = JSON.parse(String(init?.body)).contents[0].parts;
    assert.deepEqual(parts[0], { inlineData: reference });
    assert.match(parts[1].text, /faithfully/);
    assert.match(parts[1].text, /keep colors/);
    calls++;
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: calls === 1 ? [{ text: "Try again" }] : [{ inlineData: reference }] } }] });
  });
  assert.deepEqual(await generator.generate("keep colors", reference), png);
  assert.equal(calls, 2);
});

it("recreation validates attachments, sends reference bytes, and releases its busy guard on failures", async (t) => {
  const method = (ObamaBot.prototype as any).executeCommand;
  const context = { activeImages: new Set<string>(), config: { imageProvider: "openai", openaiApiKey: "key", openaiImageModel: "model" } };
  const replies: any[] = [];
  const message = { guild: { id: "guild" }, member: {}, attachments: new Map(), async reply(text: unknown) { replies.push(text); } };
  const command = { name: "image", recreate: true, prompt: "" };
  let edits = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (String(url).includes("cdn.discordapp.com")) return new Response(png);
    edits++;
    assert.ok(init?.body instanceof FormData);
    return Response.json({ data: [{ b64_json: reference.data }] });
  });
  await method.call(context, message, command);
  assert.match(replies.pop(), /exactly one/);
  assert.equal(edits, 0);
  message.attachments.set("one", attachment);
  message.attachments.set("two", attachment);
  await method.call(context, message, command);
  assert.match(replies.pop(), /exactly one/);
  message.attachments.delete("two");
  await method.call(context, message, command);
  assert.equal(edits, 1, JSON.stringify(replies));
  assert.ok(replies.at(-1).files[0]);
  assert.equal(context.activeImages.size, 0);
  t.mock.method(globalThis, "fetch", async (url: string) => String(url).includes("cdn.discordapp.com") ? new Response(png) : new Response("error", { status: 500 }));
  await assert.rejects(method.call(context, message, command), /500/);
  assert.equal(context.activeImages.size, 0);
  t.mock.method(globalThis, "fetch", async () => new Response("not an image"));
  await method.call(context, message, command);
  assert.match(replies.at(-1), /PNG, JPEG, or WebP/);
  assert.equal(context.activeImages.size, 0);
});
