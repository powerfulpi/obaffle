export type BotCommand = {
    name: "dm";
    userId: string;
    text: string;
} | {
    name: "text";
    prompt: string;
} | {
    name: "speak";
    prompt: string;
} | {
    name: "image";
    prompt: string;
    recreate?: boolean;
} | {
    name: "shortcuts";
    action: "toggle" | "on" | "off" | "status";
} | {
    name: "join";
} | {
    name: "leave";
} | {
    name: "help";
} | {
    name: "status";
} | {
    name: "global-status";
} | {
    name: "restart";
} | {
    name: "privacy";
} | {
    name: "voice";
    action: "list";
} | {
    name: "voice";
    action: "reset";
} | {
    name: "voice";
    action: "set" | "remove";
    alias: string;
} | {
    name: "voice";
    action: "add";
    alias: string;
    voiceId: string;
} | {
    name: "instructions";
    action: "show";
} | {
    name: "instructions";
    action: "reset";
} | {
    name: "instructions";
    action: "set";
    instructions: string;
} | {
    name: "memory";
    action: "on" | "off" | "status" | "clear";
} | {
    name: "conversation";
    action: "on";
    chancePercent?: number;
    cooldownSeconds?: number;
} | {
    name: "conversation";
    action: "off";
} | {
    name: "conversation";
    action: "status";
} | {
    name: "dm-all";
    action: "send";
    text: string;
} | {
    name: "dm-all";
    action: "status";
} | {
    name: "dm-all";
    action: "cancel";
};
export type ParseResult = {
    kind: "none";
} | {
    kind: "error";
    message: string;
} | {
    kind: "command";
    command: BotCommand;
};
export declare const COMMAND_SHORTCUTS: Readonly<Record<string, string>>;
export declare const SHORTCUT_HELP: string;
export declare function parseCommand(content: string, shortcutsEnabled?: boolean): ParseResult;
export interface WakeMatch {
    woke: boolean;
    prompt: string;
}
export interface MentionMatch {
    mentioned: boolean;
    prompt: string;
}
/** Matches the bot's own user mention anywhere, retaining all other message text. */
export declare function matchBotMention(content: string, botUserId: string): MentionMatch;
export declare function matchWakeWord(transcript: string, wakeWord: string): WakeMatch;
/** Only an explicit, short wake-name stop request can interrupt playback. */
export declare function isVoiceStop(transcript: string, wakeWord: string): boolean;
