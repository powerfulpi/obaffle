export class OpenAIImageGenerator {
    apiKey;
    model;
    request;
    constructor(apiKey, model, request = fetch) {
        this.apiKey = apiKey;
        this.model = model;
        this.request = request;
    }
    async generate(prompt) {
        const response = await this.request("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: this.model, prompt, n: 1, size: "1024x1024" }),
            signal: AbortSignal.timeout(180_000),
        });
        if (!response.ok) {
            throw new Error(`OpenAI image generation failed (${response.status})`);
        }
        const body = await response.json();
        const encoded = body?.data?.[0]?.b64_json;
        return decodeImage(encoded);
    }
}
export function decodeImage(encoded) {
    if (typeof encoded !== "string" || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error("Image provider returned no valid image data");
    }
    const image = Buffer.from(encoded, "base64");
    if (image.length > 10 * 1024 * 1024) {
        throw new Error("Generated image exceeds the 10 MB attachment limit");
    }
    imageExtension(image);
    return image;
}
export function imageExtension(image) {
    if (image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return "png";
    if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff)
        return "jpg";
    if (image.length >= 12 && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP")
        return "webp";
    throw new Error("Image provider returned an unsupported or invalid image (expected PNG, JPEG, or WebP)");
}
//# sourceMappingURL=openai-image-generator.js.map