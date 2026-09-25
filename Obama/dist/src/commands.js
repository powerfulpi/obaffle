const exactCommands = {
    obamastatus: { name: "status" },
    obamarestart: { name: "restart" },
    obamahelp: { name: "help" },
    obamaprivacy: { name: "privacy" },
    obamajoin: { name: "join" },
    obamaleave: { name: "leave" },
};
export function parseCommand(content) {
    const trimmed = content.trim();
    if (!trimmed.toLowerCase().startsWith("obama")) {
        return { kind: "none" };
    }
    const [head = "", ...tail] = trimmed.split(/\s+/);
    const exact = exactCommands[head.toLowerCase()];
    if (exact) {
        return tail.length === 0
            ? { kind: "command", command: exact }
            : { kind: "error", message: `${head} does not take any arguments.` };
    }
    const prompt = trimmed.slice(head.length).trim();
    switch (head.toLowerCase()) {
        case "obamatext":
            return prompt
                ? { kind: "command", command: { name: "text", prompt } }
                : { kind: "error", message: "Usage: `ObamaText <message>`" };
        case "obamaimage":
            return prompt
                ? { kind: "command", command: { name: "image", prompt } }
                : { kind: "error", message: "Usage: `ObamaImage <prompt>`" };
        case "obamaspeak":
            return prompt
                ? { kind: "command", command: { name: "speak", prompt } }
                : { kind: "error", message: "Usage: `ObamaSpeak <message>`" };
        case "obamavoice":
            return parseVoice(tail);
        case "obamainstructions":
            return parseInstructions(trimmed, head, tail);
        case "obamamemory":
            return parseMemory(tail);
        default:
            return {
                kind: "error",
                message: "Unknown Obama command. Type `ObamaHelp` for the command list.",
            };
    }
}
function parseVoice(args) {
    const action = args[0]?.toLowerCase();
    if (action === "list" && args.length === 1) {
        return { kind: "command", command: { name: "voice", action: "list" } };
    }
    if (action === "reset" && args.length === 1) {
        return { kind: "command", command: { name: "voice", action: "reset" } };
    }
    if ((action === "set" || action === "remove") && args.length === 2 && args[1]) {
        return {
            kind: "command",
            command: { name: "voice", action, alias: args[1] },
        };
    }
    if (action === "add" && args.length === 3 && args[1] && args[2]) {
        return {
            kind: "command",
            command: { name: "voice", action: "add", alias: args[1], voiceId: args[2] },
        };
    }
    return {
        kind: "error",
        message: "Usage: `ObamaVoice list`, `ObamaVoice set <name>`, `ObamaVoice add <name> <Cartesia voice ID>`, `ObamaVoice remove <name>`, or `ObamaVoice reset`.",
    };
}
function parseInstructions(content, head, args) {
    const action = args[0]?.toLowerCase();
    if ((action === "show" || action === "reset") && args.length === 1) {
        return { kind: "command", command: { name: "instructions", action } };
    }
    if (action === "set" && args.length >= 2) {
        const prefixLength = head.length + content.slice(head.length).search(/\S/) + 3;
        const instructions = content.slice(prefixLength).trim();
        if (instructions) {
            return {
                kind: "command",
                command: { name: "instructions", action: "set", instructions },
            };
        }
    }
    return {
        kind: "error",
        message: "Usage: `ObamaInstructions show`, `ObamaInstructions set <instructions>`, or `ObamaInstructions reset`.",
    };
}
function parseMemory(args) {
    const action = args[0]?.toLowerCase();
    if (args.length === 1 &&
        (action === "on" || action === "off" || action === "status" || action === "clear")) {
        return { kind: "command", command: { name: "memory", action } };
    }
    return {
        kind: "error",
        message: "Usage: `ObamaMemory on`, `off`, `status`, or `clear`.",
    };
}
export function matchWakeWord(transcript, wakeWord) {
    const escaped = wakeWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = transcript.match(new RegExp(`^\\s*(?:(?:hey|okay|ok)\\s+)?${escaped}\\b[\\s,.:;!?—–-]*(.*)$`, "i"));
    return match
        ? { woke: true, prompt: (match[1] ?? "").trim() }
        : { woke: false, prompt: "" };
}
//# sourceMappingURL=commands.js.map