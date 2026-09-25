import assert from "node:assert/strict";
import { it } from "node:test";
import { parseCommand } from "../src/commands.js";
import { OpenAIImageGenerator } from "../src/providers/openai-image-generator.js";
it("parses image prompts without losing whitespace and rejects missing prompts", () => {
    assert.deepEqual(parseCommand("  OBAMAIMAGE a cat\n on the moon  "), {
        kind: "command", command: { name: "image", prompt: "a cat\n on the moon" },
    });
    assert.deepEqual(parseCommand("ObamaImage  "), {
        kind: "error", message: "Usage: `ObamaImage <prompt>`",
    });
});
it("sends the image request and decodes the PNG attachment", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const request = async (url, init) => {
        assert.equal(url, "https://api.openai.com/v1/images/generations");
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), {
            model: "test-model", prompt: "a cat", n: 1, size: "1024x1024",
        });
        assert.equal((init?.headers).Authorization, "Bearer test-key");
        assert.ok(init?.signal);
        return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    };
    assert.deepEqual(await new OpenAIImageGenerator("test-key", "test-model", request).generate("a cat"), png);
});
it("rejects API errors and missing or invalid image data", async () => {
    for (const response of [
        new Response("secret error details", { status: 429 }),
        Response.json({ data: [] }),
        Response.json(null),
        Response.json({ data: [{ b64_json: "bad data!" }] }),
        Response.json({ data: [{ b64_json: Buffer.from("not a PNG").toString("base64") }] }),
        new Response("not json"),
    ]) {
        const generator = new OpenAIImageGenerator("test-key", "test-model", async () => response);
        await assert.rejects(generator.generate("a cat"));
    }
});
it("generates with Gemini and skips thought images", async () => {
    const { GeminiImageGenerator } = await import("../src/providers/gemini-image-generator.js");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const request = async (url, init) => {
        assert.equal(url, "https://generativelanguage.googleapis.com/v1/models/test-model:generateContent");
        assert.equal((init?.headers)["x-goog-api-key"], "test-key");
        assert.deepEqual(JSON.parse(String(init?.body)), {
            contents: [{ parts: [{ text: "a cat" }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        });
        return Response.json({ candidates: [{ content: { parts: [
                            { thought: true, inlineData: { mimeType: "image/png", data: "invalid" } },
                            { text: "Here is your image" },
                            { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
                        ] } }] });
    };
    assert.deepEqual(await new GeminiImageGenerator("test-key", "test-model", request).generate("a cat"), png);
});
it("rejects Gemini errors, blocked responses, and text-only responses", async () => {
    const { GeminiImageGenerator } = await import("../src/providers/gemini-image-generator.js");
    for (const response of [
        new Response("error", { status: 403 }),
        Response.json({ promptFeedback: { blockReason: "SAFETY" } }),
        Response.json({ candidates: [{ content: { parts: [{ text: "No image" }] } }] }),
        Response.json(null),
    ]) {
        await assert.rejects(new GeminiImageGenerator("key", "model", async () => response).generate("cat"));
    }
});
it("accepts Gemini JPEG and WebP parts and detects their attachment extensions", async () => {
    const { GeminiImageGenerator } = await import("../src/providers/gemini-image-generator.js");
    const { imageExtension } = await import("../src/providers/openai-image-generator.js");
    for (const [bytes, extension] of [
        [Buffer.from([255, 216, 255, 224, 0, 0]), "jpg"],
        [Buffer.from("RIFF0000WEBP"), "webp"],
    ]) {
        for (const field of ["inlineData", "inline_data"]) {
            const response = Response.json({ candidates: [{ content: { parts: [{
                                    [field]: { data: bytes.toString("base64"), mimeType: `image/${extension}` },
                                }] } }] });
            const image = await new GeminiImageGenerator("key", "model", async () => response).generate("cat");
            assert.deepEqual(image, bytes);
            assert.equal(imageExtension(image), extension);
        }
    }
});
it("reports the Gemini finish reason when no image is returned", async () => {
    const { GeminiImageGenerator } = await import("../src/providers/gemini-image-generator.js");
    const response = Response.json({ candidates: [{ finishReason: "IMAGE_OTHER", content: { parts: [{ text: "Try another description" }] } }] });
    await assert.rejects(new GeminiImageGenerator("key", "model", async () => response).generate("cat"), /finish=IMAGE_OTHER; text=Try another description/);
});
//# sourceMappingURL=image.test.js.map