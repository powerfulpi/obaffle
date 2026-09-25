import { decodeImage } from "./openai-image-generator.js";
export class GeminiImageGenerator {
    apiKey;
    model;
    request;
    constructor(apiKey, model, request = fetch) {
        this.apiKey = apiKey;
        this.model = model;
        this.request = request;
    }
    async generate(prompt) {
        const response = await this.request(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(this.model)}:generateContent`, {
            method: "POST",
            headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
            }),
            signal: AbortSignal.timeout(180_000),
        });
        if (!response.ok)
            throw new Error(`Gemini image generation failed (${response.status})`);
        const body = await response.json();
        const candidates = body?.candidates ?? [];
        const parts = candidates.flatMap((candidate) => candidate.content?.parts ?? []);
        const part = parts.find((part) => !part.thought && (part.inlineData?.data || part.inline_data?.data));
        if (!part) {
            const reasons = candidates.map((candidate) => candidate.finishReason).filter(Boolean).join(", ");
            const text = parts.filter((part) => !part.thought).map((part) => part.text ?? "").join(" ").slice(0, 300);
            throw new Error(`Gemini returned no image: block=${body?.promptFeedback?.blockReason ?? "none"}; finish=${reasons || "unknown"}; text=${text || "none"}`);
        }
        return decodeImage(part.inlineData?.data ?? part.inline_data?.data);
    }
}
//# sourceMappingURL=gemini-image-generator.js.map