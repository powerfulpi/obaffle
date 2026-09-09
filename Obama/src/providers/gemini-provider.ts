import { truncateUtf16 } from "../audio.js";
import type { ChatProvider, ChatRequest, SpeechRecognizer } from "../types.js";

export class GeminiProvider implements ChatProvider, SpeechRecognizer {
  public constructor(
    private readonly apiKey: string,
    private readonly chatModel: string,
    private readonly transcriptionModel: string,
  ) {}

  public async generate(request: ChatRequest): Promise<string> {
    const response = await this.request(this.chatModel, {
      contents: request.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      systemInstruction: { parts: [{ text: request.instructions }] },
    });
    const text = extractGeminiText(response).trim();
    if (!text) throw new Error("Gemini returned an empty response");
    return truncateUtf16(text, request.maxOutputCharacters);
  }

  public async transcribe(wavAudio: Buffer): Promise<string> {
    const response = await this.request(this.transcriptionModel, {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Transcribe only clearly intelligible human speech verbatim. " +
                "Return only the transcript. If there is no clearly intelligible speech, " +
                "return an empty response. Do not infer words from music, noise, clicks, " +
                "breathing, or silence.",
            },
            {
              inlineData: {
                mimeType: "audio/wav",
                data: wavAudio.toString("base64"),
              },
            },
          ],
        },
      ],
    });
    return extractGeminiText(response).trim();
  }

  private async request(model: string, body: unknown): Promise<GeminiResponse> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text) as GeminiResponse;
    } catch {
      throw new Error("Gemini returned invalid JSON");
    }
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

function extractGeminiText(response: GeminiResponse): string {
  return (response.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n");
}
