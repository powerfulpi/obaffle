import { truncateUtf16 } from "../audio.js";
export class OpenAIProvider {
    apiKey;
    chatModel;
    transcriptionModel;
    constructor(apiKey, chatModel, transcriptionModel) {
        this.apiKey = apiKey;
        this.chatModel = chatModel;
        this.transcriptionModel = transcriptionModel;
    }
    async generate(request) {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: this.chatModel,
                instructions: request.instructions,
                input: request.messages,
                ...(this.chatModel === "gpt-5-nano"
                    ? { reasoning: { effort: "minimal" } }
                    : {}),
            }),
            signal: AbortSignal.timeout(60_000),
        });
        const body = await parseJsonResponse(response, "OpenAI response");
        const text = extractResponseText(body).trim();
        if (!text)
            throw new Error("OpenAI returned an empty response");
        return truncateUtf16(text, request.maxOutputCharacters);
    }
    async transcribe(wavAudio) {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(wavAudio)], { type: "audio/wav" }), "discord-utterance.wav");
        form.append("model", this.transcriptionModel);
        form.append("language", "en");
        const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${this.apiKey}` },
            body: form,
            signal: AbortSignal.timeout(60_000),
        });
        const result = await parseJsonResponse(response, "OpenAI transcription");
        return result.text?.trim() ?? "";
    }
}
function extractResponseText(response) {
    if (response.output_text)
        return response.output_text;
    return (response.output ?? [])
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === "output_text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
}
async function parseJsonResponse(response, label) {
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${label} failed (${response.status}): ${text.slice(0, 500)}`);
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`${label} returned invalid JSON`);
    }
}
//# sourceMappingURL=openai-provider.js.map