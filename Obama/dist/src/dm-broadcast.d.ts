import type { Message } from "discord.js";
import type { Logger } from "./logger.js";
interface DmBroadcastOptions {
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
/** Authorization and the opt-in member intent are checked by the command handler. */
export declare class DmBroadcastService {
    private readonly logger;
    private readonly jobs;
    private readonly lastResults;
    private readonly sleep;
    private stopped;
    constructor(logger: Logger, options?: DmBroadcastOptions);
    start(message: Message<true>, text: string): Promise<void>;
    status(message: Message<true>): Promise<void>;
    cancel(message: Message<true>): Promise<void>;
    /** An in-flight API request cannot be recalled; no subsequent sends are started. */
    stop(): void;
    private reply;
}
export {};
