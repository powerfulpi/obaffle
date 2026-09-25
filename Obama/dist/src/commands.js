const exactCommands = {
    obamastatus: { name: "status" },
    obamaglobalstatus: { name: "global-status" },
    obamauniversalstatus: { name: "global-status" },
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
        case "obamaconversation":
        case "obamaconversationmode":
            return parseConversation(tail);
        case "obamadmall":
            return parseDmAll(prompt);
        case "obamadm":
            return parseDm(prompt);
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
function parseConversation(args) {
    const action = args[0]?.toLowerCase();
    if ((action === "off" || action === "status") && args.length === 1) {
        return { kind: "command", command: { name: "conversation", action } };
    }
    if (action === "on" && args.length >= 1 && args.length <= 3) {
        const command = {
            name: "conversation",
            action: "on",
        };
        const chance = args[1];
        const cooldown = args[2];
        if (chance !== undefined) {
            const value = Number(chance);
            if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(chance) || value <= 0 || value > 100) {
                return { kind: "error", message: "Conversation chance must be greater than 0 and at most 100 percent." };
            }
            command.chancePercent = value;
        }
        if (cooldown !== undefined) {
            const value = Number(cooldown);
            if (!/^\d+$/.test(cooldown) || !Number.isSafeInteger(value) || value > 86_400) {
                return { kind: "error", message: "Conversation cooldown must be a whole number from 0 through 86400 seconds." };
            }
            command.cooldownSeconds = value;
        }
        return { kind: "command", command };
    }
    return {
        kind: "error",
        message: "Usage: `ObamaConversation on [chance-percent] [cooldown-seconds]`, `ObamaConversation off`, or `ObamaConversation status`.",
    };
}
function parseDm(prompt) {
    const match = /^(?:<@!?(\d{17,20})>|(\d{17,20}))\s+([\s\S]+)$/.exec(prompt);
    const text = match?.[3]?.trim();
    if (!match || !text) {
        return { kind: "error", message: "Usage: `ObamaDM <@person or user ID> <message>`" };
    }
    if (text.length > 2_000) {
        return { kind: "error", message: "DM messages must be 2000 characters or fewer." };
    }
    return { kind: "command", command: { name: "dm", userId: (match[1] ?? match[2]), text } };
}
function parseDmAll(text) {
    const action = text.toLowerCase();
    if (action === "status" || action === "cancel") {
        return { kind: "command", command: { name: "dm-all", action } };
    }
    if (!text) {
        return {
            kind: "error",
            message: "Usage: `ObamaDMAll <message>`, `ObamaDMAll status`, or `ObamaDMAll cancel`.",
        };
    }
    if (text.length > 1_800) {
        return { kind: "error", message: "DM announcements must be 1800 characters or fewer." };
    }
    return { kind: "command", command: { name: "dm-all", action: "send", text } };
}
/** Matches the bot's own user mention anywhere, retaining all other message text. */
export function matchBotMention(content, botUserId) {
    if (!botUserId) {
        return { mentioned: false, prompt: "" };
    }
    const escapedId = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mention = new RegExp(`<@!?${escapedId}>`, "g");
    return mention.test(content)
        ? { mentioned: true, prompt: content.replace(mention, "").trim() }
        : { mentioned: false, prompt: "" };
}
export function matchWakeWord(transcript, wakeWord) {
    const name = wakeWord.trim();
    if (!name) {
        return { woke: false, prompt: "" };
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordCharacters = "\\p{L}\\p{N}\\p{M}_";
    const leading = transcript.match(new RegExp(`^\\s*(?:(?:hey|okay|ok)\\s+)?${escaped}(?![${wordCharacters}])[\\s,.:;!?—–-]*(.*)$`, "isu"));
    if (leading) {
        return { woke: true, prompt: (leading[1] ?? "").trim() };
    }
    // Keep the whole question when the name follows any meaningful speech.
    const anywhere = new RegExp(`(?:^|[^${wordCharacters}])${escaped}(?![${wordCharacters}])`, "iu");
    return anywhere.test(transcript)
        ? { woke: true, prompt: transcript.trim() }
        : { woke: false, prompt: "" };
}
/** Only an explicit, short wake-name stop request can interrupt playback. */
export function isVoiceStop(transcript, wakeWord) {
    const wake = matchWakeWord(transcript, wakeWord);
    if (!wake.woke)
        return false;
    const escaped = wakeWord.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prompt = wake.prompt.replace(new RegExp(`(?:[,\\s]+)${escaped}[.!?]*$`, "iu"), "");
    return /^(?:please\s+)?(?:stop|stop talking|stop speaking|be quiet|cancel)(?:\s+please)?[.!?,]*$/i.test(prompt.trim());
}
//# sourceMappingURL=commands.js.map