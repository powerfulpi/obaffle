import "dotenv/config";
import { resolve } from "node:path";

import type { ProviderName } from "./types.js";

const builtInInstructions =
  "You are Obama, a concise and friendly voice assistant in a Discord server. " +
  "Keep spoken replies natural and usually under 120 words. " +
  "Do not claim to be the real Barack Obama.";

function enumValue<T extends string>(
  name: string,
  fallback: T,
  choices: readonly T[],
): T {
  const value = (process.env[name] ?? fallback).toLowerCase() as T;
  if (!choices.includes(value)) {
    throw new Error(`${name} must be one of: ${choices.join(", ")}`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function numberInRange(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} through ${maximum}`);
  }
  return value;
}

export interface AppConfig {
  discordToken: string;
  aiProvider: ProviderName;
  sttProvider: ProviderName;
  openaiApiKey: string | undefined;
  openaiModel: string;
  openaiImageModel: string;
  imageProvider: ProviderName;
  geminiImageModel: string;
  openaiTranscriptionModel: string;
  geminiApiKey: string | undefined;
  geminiModel: string;
  geminiTranscriptionModel: string;
  cartesiaApiKey: string;
  cartesiaDefaultVoiceId: string;
  cartesiaModel: string;
  defaultInstructions: string;
  wakeWord: string;
  wakeFollowupMs: number;
  speechEndSilenceMs: number;
  voiceMinUtteranceMs: number;
  voiceMinRmsDbfs: number;
  voiceFeedbackCooldownMs: number;
  voiceJoinTimeoutMs: number;
  maxUtteranceSeconds: number;
  maxMemoryMessages: number;
  maxResponseCharacters: number;
  dataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(options: { validateSecrets?: boolean } = {}): AppConfig {
  const aiProvider = enumValue<ProviderName>("AI_PROVIDER", "openai", ["openai", "gemini"]);
  const sttProvider = enumValue<ProviderName>("STT_PROVIDER", "gemini", ["openai", "gemini"]);
  const config: AppConfig = {
    discordToken: process.env.DISCORD_TOKEN ?? "",
    aiProvider,
    sttProvider,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-5-nano",
    imageProvider: enumValue<ProviderName>("IMAGE_PROVIDER", "gemini", ["openai", "gemini"]),
    geminiImageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
    openaiImageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    openaiTranscriptionModel:
      process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe",
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
    geminiTranscriptionModel:
      process.env.GEMINI_TRANSCRIPTION_MODEL ?? "gemini-2.5-flash-lite",
    cartesiaApiKey: process.env.CARTESIA_API_KEY ?? "",
    cartesiaDefaultVoiceId: process.env.CARTESIA_DEFAULT_VOICE_ID ?? "",
    cartesiaModel: process.env.CARTESIA_MODEL ?? "sonic-latest",
    defaultInstructions: process.env.DEFAULT_INSTRUCTIONS ?? builtInInstructions,
    wakeWord: process.env.WAKE_WORD?.trim() || "Obama",
    wakeFollowupMs: positiveInteger("WAKE_FOLLOWUP_SECONDS", 12) * 1_000,
    speechEndSilenceMs: positiveInteger("SPEECH_END_SILENCE_MS", 700),
    voiceMinUtteranceMs: positiveInteger("VOICE_MIN_UTTERANCE_MS", 350),
    voiceMinRmsDbfs: numberInRange("VOICE_MIN_RMS_DBFS", -42, -96, 0),
    voiceFeedbackCooldownMs: positiveInteger("VOICE_FEEDBACK_COOLDOWN_MS", 1_500),
    voiceJoinTimeoutMs: positiveInteger("VOICE_JOIN_TIMEOUT_MS", 30_000),
    maxUtteranceSeconds: positiveInteger("MAX_UTTERANCE_SECONDS", 30),
    maxMemoryMessages: positiveInteger("MAX_MEMORY_MESSAGES", 20),
    maxResponseCharacters: positiveInteger("MAX_RESPONSE_CHARACTERS", 3_500),
    dataDir: resolve(process.env.DATA_DIR ?? "./data"),
    logLevel: enumValue("LOG_LEVEL", "info", ["debug", "info", "warn", "error"]),
  };

  if (options.validateSecrets !== false) {
    validateSecrets(config);
  }
  return config;
}

export function validateSecrets(config: AppConfig): void {
  const missing: string[] = [];
  if (!config.discordToken) missing.push("DISCORD_TOKEN");
  if (!config.cartesiaApiKey) missing.push("CARTESIA_API_KEY");
  if (!config.cartesiaDefaultVoiceId) missing.push("CARTESIA_DEFAULT_VOICE_ID");
  if (config.aiProvider === "openai" && !config.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (config.sttProvider === "openai" && !config.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (config.aiProvider === "gemini" && !config.geminiApiKey) missing.push("GEMINI_API_KEY");
  if (config.sttProvider === "gemini" && !config.geminiApiKey) missing.push("GEMINI_API_KEY");

  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length > 0) {
    throw new Error(`Missing required environment variables: ${uniqueMissing.join(", ")}`);
  }
}
