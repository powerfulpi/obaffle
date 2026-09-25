/** Authorization and the opt-in member intent are checked by the command handler. */
export class DmBroadcastService {
    logger;
    jobs = new Map();
    lastResults = new Map();
    sleep;
    stopped = false;
    constructor(logger, options = {}) {
        this.logger = logger;
        this.sleep = options.sleep ?? abortableSleep;
    }
    async start(message, text) {
        if (this.stopped)
            return;
        if (!text.trim() || text.length > 1_800) {
            await this.reply(message, "Please provide a message between 1 and 1,800 characters.");
            return;
        }
        const guildId = message.guild.id;
        if (this.jobs.has(guildId)) {
            await this.reply(message, "A DM broadcast is already running in this server. Use ObamaDMAll status or ObamaDMAll cancel.");
            return;
        }
        const job = {
            controller: new AbortController(), phase: "fetching members", total: 0,
            sent: 0, failed: 0, skippedBots: 0, cancelled: false,
        };
        // Reserve the server before the first await so two commands cannot start two jobs.
        this.jobs.set(guildId, job);
        let reason;
        try {
            let members;
            try {
                // The cache may contain only online/recent members; enumerate the whole server.
                members = await message.guild.members.fetch();
            }
            catch {
                if (!this.stopped && !job.cancelled) {
                    reason = "Could not fetch the full member list; no DMs were sent. Enable Server Members Intent in the Discord Developer Portal, enable member DMs in the bot settings, then restart the bot and try again.";
                    this.logger.warn("DM broadcast could not enumerate server members.");
                }
                return;
            }
            if (this.stopped || job.cancelled)
                return;
            const recipients = [...members.values()].filter((member) => !member.user.bot);
            job.total = recipients.length;
            job.skippedBots = members.size - recipients.length;
            job.phase = "sending";
            const acknowledged = await this.reply(message, `Starting DM broadcast to ${job.total} members; skipping ${job.skippedBots} bots. Use ObamaDMAll status or ObamaDMAll cancel.`);
            if (!acknowledged) {
                reason = "DM broadcast stopped because I could not acknowledge it in this channel. No DMs were sent.";
                return;
            }
            const content = attributedMessage(message, text);
            for (const [index, recipient] of recipients.entries()) {
                if (this.stopped || job.cancelled)
                    break;
                if (index > 0)
                    await this.sleep(1_000, job.controller.signal);
                if (this.stopped || job.cancelled)
                    break;
                try {
                    // discord.js handles the API's rate-limit queues and Retry-After headers.
                    await recipient.send({ content, allowedMentions: { parse: [] } });
                    job.sent++;
                }
                catch (error) {
                    job.failed++;
                    const failure = classifyFailure(error);
                    if (failure === "rate-limit") {
                        reason = "Stopped because Discord limited DM sending. Wait before starting another broadcast.";
                        break;
                    }
                    else if (failure === "authorization") {
                        reason = "Stopped because Discord rejected the bot's access. Check the bot's token and permissions before trying again.";
                        break;
                    }
                    // A failed recipient is not retried; continue with the next member.
                }
            }
        }
        catch {
            reason = "DM broadcast stopped after an unexpected error.";
            this.logger.warn("DM broadcast encountered an unexpected error.");
        }
        finally {
            this.jobs.delete(guildId);
            if (!this.stopped) {
                const summary = `${job.cancelled ? "DM broadcast cancelled." : reason ? "DM broadcast stopped." : "DM broadcast complete."} ${counts(job)}${reason ? ` ${reason}` : ""}`;
                this.lastResults.set(guildId, summary);
                this.logger.info("DM broadcast finished.", {
                    sent: job.sent, failed: job.failed, skippedBots: job.skippedBots,
                    remaining: job.total - job.sent - job.failed, cancelled: job.cancelled,
                });
                await this.reply(message, summary);
            }
        }
    }
    async status(message) {
        if (this.stopped)
            return;
        const job = this.jobs.get(message.guild.id);
        await this.reply(message, job
            ? `DM broadcast ${job.cancelled ? "cancelling" : job.phase}. ${counts(job)}`
            : this.lastResults.get(message.guild.id) ?? "No DM broadcast is running in this server.");
    }
    async cancel(message) {
        if (this.stopped)
            return;
        const job = this.jobs.get(message.guild.id);
        if (!job) {
            await this.reply(message, "No DM broadcast is running in this server.");
            return;
        }
        job.cancelled = true;
        job.controller.abort();
        await this.reply(message, "DM broadcast cancellation requested. A DM already being sent may still arrive.");
    }
    /** An in-flight API request cannot be recalled; no subsequent sends are started. */
    stop() {
        this.stopped = true;
        for (const job of this.jobs.values())
            job.controller.abort();
    }
    async reply(message, content) {
        if (this.stopped)
            return false;
        try {
            await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
            return true;
        }
        catch {
            this.logger.warn("Could not post a DM broadcast update.");
            return false;
        }
    }
}
function counts(job) {
    return `Sent: ${job.sent}. Failed: ${job.failed}. Skipped bots: ${job.skippedBots}. Remaining: ${job.total - job.sent - job.failed}.`;
}
function attributedMessage(message, text) {
    // Keep user-controlled names on one line and leave at least 1,800 chars for the message.
    const server = cleanName(message.guild.name, 70);
    const owner = cleanName(message.author.username, 32);
    return `${text}`;
}
function cleanName(name, maxLength) {
    return name.replace(/[\r\n\t]/g, " ").slice(0, maxLength);
}
function classifyFailure(error) {
    if (!error || typeof error !== "object")
        return "other";
    const { code, status, name } = error;
    if (status === 429 || name === "RateLimitError" || [20028, 20029, 40003, 40062].includes(Number(code)))
        return "rate-limit";
    if (status === 401 || [40001, 40002, 40004, 40012, 50014, 40333].includes(Number(code)))
        return "authorization";
    if (code === 50007 || code === 50278)
        return "recipient";
    if (status === 403 || code === 50001 || code === 50013)
        return "authorization";
    return "other";
}
function abortableSleep(milliseconds, signal) {
    if (signal.aborted)
        return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, milliseconds);
        signal.addEventListener("abort", done, { once: true });
    });
}
//# sourceMappingURL=dm-broadcast.js.map