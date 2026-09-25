import { pcmMonoToStereo, pcmStereoToWav, speechText } from "./audio.js";
export class CartesiaTts {
    apiKey;
    model;
    constructor(apiKey, model) {
        this.apiKey = apiKey;
        this.model = model;
    }
    async synthesize(text, voiceId) {
        const transcript = speechText(text);
        if (!transcript) {
            throw new Error("There is no speakable text in the response");
        }
        const response = await fetch("https://api.cartesia.ai/tts/bytes", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Cartesia-Version": "2026-03-01",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model_id: this.model,
                transcript,
                voice: { id: voiceId },
                output_format: {
                    container: "raw",
                    encoding: "pcm_s16le",
                    sample_rate: 48_000,
                },
            }),
            signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 500);
            throw new Error(`Cartesia TTS failed (${response.status}): ${detail}`);
        }
        const monoPcm = Buffer.from(await response.arrayBuffer());
        if (monoPcm.length === 0) {
            throw new Error("Cartesia returned empty audio");
        }
        const discordPcm = pcmMonoToStereo(monoPcm);
        return { discordPcm, wav: pcmStereoToWav(discordPcm) };
    }
}
//# sourceMappingURL=cartesia.js.map