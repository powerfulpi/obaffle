export type ProviderName = "openai" | "gemini";

export interface ChatImage {
  mimeType: string;
  data: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: ChatImage[];
}

export interface ChatRequest {
  instructions: string;
  messages: ChatMessage[];
  maxOutputCharacters: number;
}

export interface ChatProvider {
  generate(request: ChatRequest): Promise<string>;
}

export interface SpeechRecognizer {
  transcribe(wavAudio: Buffer): Promise<string>;
}

export interface ConversationChannelSettings {
  chancePercent: number;
  cooldownSeconds: number;
}

export interface GuildSettings {
  selectedVoice: string;
  voices: Record<string, string>;
  instructions: string | null;
  memoryEnabled: boolean;
  conversationChannels: Record<string, ConversationChannelSettings>;
}

export interface PersistedSettings {
  version: 1;
  guilds: Record<string, GuildSettings>;
}
