// Oldest still-supported snapshot; earlier Sonic models have been sunsetted.
export const WORST_SPEECH_MODEL = "sonic-3-2026-01-12";
export const SPEECH_EMOTIONS = [
  "neutral", "happy", "excited", "enthusiastic", "elated", "euphoric", "triumphant",
  "amazed", "surprised", "flirtatious", "curious", "content", "peaceful", "serene",
  "calm", "grateful", "affectionate", "trust", "sympathetic", "anticipation", "mysterious",
  "angry", "mad", "outraged", "frustrated", "agitated", "threatened", "disgusted",
  "contempt", "envious", "sarcastic", "ironic", "sad", "dejected", "melancholic",
  "disappointed", "hurt", "guilty", "bored", "tired", "rejected", "nostalgic", "wistful",
  "apologetic", "hesitant", "insecure", "confused", "resigned", "anxious", "panicked",
  "alarmed", "scared", "proud", "confident", "distant", "skeptical", "contemplative", "determined",
] as const;
export type SpeechEmotion = typeof SPEECH_EMOTIONS[number];
export interface SpeechOptions {
  speechMode: "current" | "worst";
  speechEmotion: SpeechEmotion | null;
}
export function isSpeechEmotion(value: unknown): value is SpeechEmotion {
  return typeof value === "string" && (SPEECH_EMOTIONS as readonly string[]).includes(value);
}
export function normalizeSpeechOptions(value: Partial<SpeechOptions>): SpeechOptions {
  return {
    speechMode: value.speechMode === "worst" ? "worst" : "current",
    speechEmotion: isSpeechEmotion(value.speechEmotion) ? value.speechEmotion : null,
  };
}
