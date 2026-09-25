import { GeminiProvider } from "./gemini-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
export function createProviders(config) {
    const cache = new Map();
    const get = (name) => {
        const existing = cache.get(name);
        if (existing)
            return existing;
        const provider = name === "openai"
            ? new OpenAIProvider(required(config.openaiApiKey, "OPENAI_API_KEY"), config.openaiModel, config.openaiTranscriptionModel)
            : new GeminiProvider(required(config.geminiApiKey, "GEMINI_API_KEY"), config.geminiModel, config.geminiTranscriptionModel);
        cache.set(name, provider);
        return provider;
    };
    return {
        chat: get(config.aiProvider),
        speechRecognition: get(config.sttProvider),
    };
}
function required(value, name) {
    if (!value)
        throw new Error(`${name} is required`);
    return value;
}
//# sourceMappingURL=index.js.map