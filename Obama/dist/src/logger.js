const weights = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
export class Logger {
    minimumLevel;
    constructor(minimumLevel) {
        this.minimumLevel = minimumLevel;
    }
    debug(message, details) {
        this.write("debug", message, details);
    }
    info(message, details) {
        this.write("info", message, details);
    }
    warn(message, details) {
        this.write("warn", message, details);
    }
    error(message, details) {
        this.write("error", message, details);
    }
    write(level, message, details) {
        if (weights[level] < weights[this.minimumLevel])
            return;
        const suffix = details === undefined ? "" : ` ${formatDetails(details)}`;
        const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}`;
        if (level === "error")
            console.error(line);
        else if (level === "warn")
            console.warn(line);
        else
            console.log(line);
    }
}
function formatDetails(details) {
    if (details instanceof Error)
        return details.stack ?? details.message;
    if (typeof details === "string")
        return details;
    try {
        return JSON.stringify(details);
    }
    catch {
        return String(details);
    }
}
//# sourceMappingURL=logger.js.map