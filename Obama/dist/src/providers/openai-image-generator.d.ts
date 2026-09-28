import type { ChatImage } from "../types.js";
export declare function recreationPrompt(instructions: string): string;
export declare class OpenAIImageGenerator {
    private readonly apiKey;
    private readonly model;
    private readonly request;
    constructor(apiKey: string, model: string, request?: typeof fetch);
    generate(prompt: string, reference?: ChatImage): Promise<Buffer>;
}
export declare function decodeImage(encoded: unknown): Buffer;
export declare function imageExtension(image: Buffer): "png" | "jpg" | "webp";
