export type LogLevel = "debug" | "info" | "warn" | "error";
export declare class Logger {
    private readonly minimumLevel;
    constructor(minimumLevel: LogLevel);
    debug(message: string, details?: unknown): void;
    info(message: string, details?: unknown): void;
    warn(message: string, details?: unknown): void;
    error(message: string, details?: unknown): void;
    private write;
}
