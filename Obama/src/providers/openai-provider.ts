import { truncateUtf16 } from "../audio.js";
import type { ChatProvider, ChatRequest, SpeechRecognizer } from "../types.js";

export class OpenAIProvider implements ChatProvider, SpeechRecognizer {
  public constructor(
    private readonly apiKey: string,
    private readonly chatModel: string,
    private readonly transcriptionModel: string,
  ) {}

  public async generate(request: ChatRequest): Promise<string> {
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
    const body = await parseJsonResponse<OpenAIResponse>(response, "OpenAI response");
    const text = extractResponseText(body).trim();
    if (!text) throw new Error("OpenAI returned an empty response");
    return truncateUtf16(text, request.maxOutputCharacters);
  }

  public async transcribe(wavAudio: Buffer): Promise<string> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(wavAudio)], { type: "audio/wav" }),
      "discord-utterance.wav",
    );
    form.append("model", this.transcriptionModel);
    form.append("language", "en");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const result = await parseJsonResponse<{ text?: string }>(response, "OpenAI transcription");
    return result.text?.trim() ?? "";
  }
}

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

function extractResponseText(response: OpenAIResponse): string {
  if (response.output_text) return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
