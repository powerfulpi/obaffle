export type BotCommand = {
    name: "text";
    prompt: string;
} | {
    name: "speak";
    prompt: string;
} | {
    name: "image";
    prompt: string;
} | {
    name: "join";
} | {
    name: "leave";
} | {
    name: "help";
} | {
    name: "status";
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
export declare function parseCommand(content: string): ParseResult;
export interface WakeMatch {
    woke: boolean;
    prompt: string;
}
export declare function matchWakeWord(transcript: string, wakeWord: string): WakeMatch;
