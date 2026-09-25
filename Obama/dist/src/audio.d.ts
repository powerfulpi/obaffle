export interface PcmActivity {
    durationMs: number;
    rmsDbfs: number;
    peakDbfs: number;
}
export declare function analyzePcm16(pcm: Buffer): PcmActivity;
export declare function pcmStereoToWav(pcm: Buffer): Buffer;
export declare function pcmMonoToStereo(pcm: Buffer): Buffer;
export declare function truncateUtf16(text: string, maximum: number): string;
export declare function speechText(text: string): string;
