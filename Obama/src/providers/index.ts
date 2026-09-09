import type { AppConfig } from "../config.js";
import type { ChatProvider, ProviderName, SpeechRecognizer } from "../types.js";
import { GeminiProvider } from "./gemini-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

interface Providers {
  chat: ChatProvider;
  speechRecognition: SpeechRecognizer;
}

export function createProviders(config: AppConfig): Providers {
  const cache = new Map<ProviderName, ChatProvider & SpeechRecognizer>();

  const get = (name: ProviderName): ChatProvider & SpeechRecognizer => {
    const existing = cache.get(name);
    if (existing) return existing;

    const provider =
      name === "openai"
        ? new OpenAIProvider(
            required(config.openaiApiKey, "OPENAI_API_KEY"),
            config.openaiModel,
            config.openaiTranscriptionModel,
          )
        : new GeminiProvider(
            required(config.geminiApiKey, "GEMINI_API_KEY"),
            config.geminiModel,
            config.geminiTranscriptionModel,
          );
    cache.set(name, provider);
    return provider;
  };

  return {
    chat: get(config.aiProvider),
    speechRecognition: get(config.sttProvider),
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
