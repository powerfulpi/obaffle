import assert from "node:assert/strict";
import { it } from "node:test";
import { loadAttachedImages, IMAGE_UNDERSTANDING_PROMPT } from "../src/image-understanding.js";
import { OpenAIProvider } from "../src/providers/openai-provider.js";
import { GeminiProvider } from "../src/providers/gemini-provider.js";
import { ObamaBot } from "../src/bot.js";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const attachment = { url: "https://cdn.discordapp.com/attachments/a/b/test.png", size: png.length, name: "test.png", contentType: "image/png" };
it("both chat providers receive image bytes with the appropriate API schema", async (t) => {
    const bodies = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        return url.includes("openai.com")
            ? Response.json({ output_text: "A picture" })
            : Response.json({ candidates: [{ content: { parts: [{ text: "A picture" }] } }] });
    });
    const request = { instructions: "Explain", messages: [{ role: "user", content: IMAGE_UNDERSTANDING_PROMPT, images: [{ mimeType: "image/png", data: png.toString("base64") }] }], maxOutputCharacters: 500 };
    assert.equal(await new OpenAIProvider("key", "model", "stt").generate(request), "A picture");
    assert.equal(await new GeminiProvider("key", "model", "stt").generate(request), "A picture");
    assert.deepEqual(bodies[0].input[0].content[1], { type: "input_image", detail: "auto", image_url: `data:image/png;base64,${png.toString("base64")}` });
    assert.deepEqual(bodies[1].contents[0].parts[1], { inlineData: { mimeType: "image/png", data: png.toString("base64") } });
});
it("attachment loading validates host, bytes, count, size, and HTTP errors", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(png));
    assert.deepEqual(await loadAttachedImages([attachment]), [{ mimeType: "image/png", data: png.toString("base64") }]);
    await assert.rejects(loadAttachedImages([{ ...attachment, url: "https://example.org/file" }]), /Discord/);
    await assert.rejects(loadAttachedImages([{ ...attachment, size: 6 * 1024 * 1024 }]), /5 MB/);
    await assert.rejects(loadAttachedImages(Array(4).fill(attachment)), /at most 3/);
    t.mock.method(globalThis, "fetch", async () => new Response("not an image"));
    await assert.rejects(loadAttachedImages([attachment]), /PNG, JPEG, or WebP/);
    t.mock.method(globalThis, "fetch", async () => new Response("no", { status: 403 }));
    await assert.rejects(loadAttachedImages([attachment]), /upload it again/);
    t.mock.method(globalThis, "fetch", async () => new Response(Buffer.alloc(6 * 1024 * 1024)));
    await assert.rejects(loadAttachedImages([attachment]), /5 MB/);
});
it("image mentions retain accompanying questions and links and release their busy guard", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(png));
    const requests = [];
    const replies = [];
    const context = {
        client: { user: { id: "123" } },
        activeVision: new Set(), logger: { error() { } },
        conversations: { async reply(request) { requests.push(request); return "An image."; } },
    };
    const message = {
        guildId: "guild", channelId: "channel", content: "<@123> Compare this with https://example.com/article",
        member: { displayName: "Tester" }, author: {},
        channel: { async sendTyping() { } }, async reply(content) { replies.push(content); },
    };
    const method = ObamaBot.prototype.handleImageMention;
    await method.call(context, message, [attachment]);
    assert.equal(requests[0]?.prompt, "Compare this with https://example.com/article");
    assert.equal(requests[0]?.source, "image");
    assert.equal(requests[0]?.images?.length, 1);
    assert.deepEqual(replies, ["An image."]);
    assert.equal(context.activeVision.size, 0);
});
//# sourceMappingURL=image-understanding.test.js.map