const PCM_SAMPLE_RATE = 48_000;
const PCM_CHANNELS = 2;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_BYTES_PER_SAMPLE = PCM_BITS_PER_SAMPLE / 8;
export function analyzePcm16(pcm) {
    const evenLength = pcm.length - (pcm.length % PCM_BYTES_PER_SAMPLE);
    const sampleCount = evenLength / PCM_BYTES_PER_SAMPLE;
    let squareSum = 0;
    let peak = 0;
    for (let offset = 0; offset < evenLength; offset += PCM_BYTES_PER_SAMPLE) {
        const sample = pcm.readInt16LE(offset);
        squareSum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
    }
    const rms = sampleCount === 0 ? 0 : Math.sqrt(squareSum / sampleCount);
    return {
        durationMs: (pcm.length / (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE)) * 1_000,
        rmsDbfs: amplitudeToDbfs(rms),
        peakDbfs: amplitudeToDbfs(peak),
    };
}
function amplitudeToDbfs(amplitude) {
    return amplitude === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(amplitude / 32_768);
}
export function pcmStereoToWav(pcm) {
    const header = Buffer.alloc(44);
    const byteRate = (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8;
    const blockAlign = (PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8;
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(PCM_CHANNELS, 22);
    header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}
export function pcmMonoToStereo(pcm) {
    const evenLength = pcm.length - (pcm.length % 2);
    const stereo = Buffer.allocUnsafe(evenLength * 2);
    for (let source = 0, destination = 0; source < evenLength; source += 2) {
        const sample = pcm.readInt16LE(source);
        stereo.writeInt16LE(sample, destination);
        stereo.writeInt16LE(sample, destination + 2);
        destination += 4;
    }
    return stereo;
}
export function truncateUtf16(text, maximum) {
    if (text.length <= maximum)
        return text;
    return `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}
export function speechText(text) {
    return text
        .replace(/```[\s\S]*?```/g, " code omitted ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .replace(/[*_~>#]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
//# sourceMappingURL=audio.js.map