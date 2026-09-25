export interface SynthesizedSpeech {
    discordPcm: Buffer;
    wav: Buffer;
}
export declare class CartesiaTts {
    private readonly apiKey;
    private readonly model;
    constructor(apiKey: string, model: string);
    synthesize(text: string, voiceId: string): Promise<SynthesizedSpeech>;
}
