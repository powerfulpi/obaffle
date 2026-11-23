import { normalizeSpeechOptions, WORST_SPEECH_MODEL, type SpeechOptions } from "./speech-options.js";
import { pcmMonoToStereo, pcmStereoToWav, speechText } from "./audio.js";

export interface SynthesizedSpeech {
  discordPcm: Buffer;
  wav: Buffer;
}

export class CartesiaTts {
  public constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  public async synthesize(text: string, voiceId: string, options: Partial<SpeechOptions> = {}): Promise<SynthesizedSpeech> {
    const transcript = speechText(text);
    if (!transcript) {
      throw new Error("There is no speakable text in the response");
    }

    const { speechMode, speechEmotion } = normalizeSpeechOptions(options);
    const generationConfig = {
      ...(speechMode === "worst" ? { speed: 0.6 } : {}),
      ...(speechEmotion ? { emotion: speechEmotion } : {}),
    };
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Cartesia-Version": "2026-03-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: speechMode === "worst" ? WORST_SPEECH_MODEL : this.model,
        ...(Object.keys(generationConfig).length ? { generation_config: generationConfig } : {}),
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
