import type { ChatProvider, ChatRequest, SpeechRecognizer } from "../types.js";
export declare class OpenAIProvider implements ChatProvider, SpeechRecognizer {
    private readonly apiKey;
    private readonly chatModel;
    private readonly transcriptionModel;
    constructor(apiKey: string, chatModel: string, transcriptionModel: string);
    generate(request: ChatRequest): Promise<string>;
    transcribe(wavAudio: Buffer): Promise<string>;
}
