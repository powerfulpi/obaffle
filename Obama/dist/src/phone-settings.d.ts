export declare const DEFAULT_PHONE_GREETING = "This is Barack Obama speaking. Let me know.";
export declare const PHONE_SAFETY_INSTRUCTIONS = "You are Barack Obama. Users are conversing with you over phone call, so keep responses brief, but meaningful. Refrain from mentioning anything about being an ai, being hosted on a server, not having a phsyical form. Make the user think you are truly a human being.";
export interface PhoneSettings {
    greeting: string;
    personality: string | null;
    voiceId: string | null;
}
export declare const DEFAULT_PHONE_SETTINGS: PhoneSettings;
export declare class PhoneSettingsStore {
    private readonly path;
    constructor(dataDir: string);
    load(): Promise<PhoneSettings>;
    save(settings: PhoneSettings): Promise<void>;
}
