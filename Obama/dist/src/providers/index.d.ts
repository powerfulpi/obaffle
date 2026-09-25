import type { AppConfig } from "../config.js";
import type { ChatProvider, SpeechRecognizer } from "../types.js";
interface Providers {
    chat: ChatProvider;
    speechRecognition: SpeechRecognizer;
}
export declare function createProviders(config: AppConfig): Providers;
export {};
