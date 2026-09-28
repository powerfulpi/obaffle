import type { ChatImage } from "../types.js";
export declare class GeminiImageGenerator {
    private readonly apiKey;
    private readonly model;
    private readonly request;
    constructor(apiKey: string, model: string, request?: typeof fetch);
    generate(prompt: string, reference?: ChatImage): Promise<Buffer>;
    private generateAttempt;
}
