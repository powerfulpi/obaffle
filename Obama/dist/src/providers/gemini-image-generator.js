import { decodeImage, recreationPrompt } from "./openai-image-generator.js";
export class GeminiImageGenerator {
    apiKey;
    model;
    request;
    constructor(apiKey, model, request = fetch) {
        this.apiKey = apiKey;
        this.model = model;
        this.request = request;
    }
    async generate(prompt, reference) {
        return this.generateAttempt(prompt, AbortSignal.timeout(180_000), true, reference);
    }
    async generateAttempt(prompt, signal, retry, reference) {
        const response = await this.request(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(this.model)}:generateContent`, {
            method: "POST",
            headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [...(reference ? [{ inlineData: reference }] : []), { text: reference ? recreationPrompt(prompt) : `Generate one image depicting the following description. If details are unspecified, choose them creatively.\n\n${prompt}` }] }],
                generationConfig: { responseModalities: ["IMAGE"] },
            }),
            signal,
        });
        if (!response.ok)
            throw new Error(`Gemini image generation failed (${response.status})`);
        const body = await response.json();
        const candidates = body?.candidates ?? [];
        const parts = candidates.flatMap((candidate) => candidate.content?.parts ?? []);
        const part = parts.find((part) => !part.thought && (part.inlineData?.data || part.inline_data?.data));
        if (!part) {
            // Retry an ordinary text-only completion once, within the original deadline.
            // Explicit provider blocks and other abnormal finish reasons remain errors.
            if (retry && !body?.promptFeedback?.blockReason && candidates.length > 0
                && candidates.every((candidate) => candidate.finishReason === "STOP")
                && parts.some((part) => !part.thought && part.text)) {
                return this.generateAttempt(prompt, signal, false, reference);
            }
            const reasons = candidates.map((candidate) => candidate.finishReason).filter(Boolean).join(", ");
            const text = parts.filter((part) => !part.thought).map((part) => part.text ?? "").join(" ").slice(0, 300);
            throw new Error(`Gemini returned no image: block=${body?.promptFeedback?.blockReason ?? "none"}; finish=${reasons || "unknown"}; text=${text || "none"}`);
        }
        return decodeImage(part.inlineData?.data ?? part.inline_data?.data);
    }
}
//# sourceMappingURL=gemini-image-generator.js.map