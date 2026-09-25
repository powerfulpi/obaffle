import { ObamaBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { startDashboard } from "./dashboard.js";
const config = loadConfig();
const logger = new Logger(config.logLevel);
const bot = new ObamaBot(config, logger, process.env.OBAMA_SUPERVISED === "1"
    ? async () => {
        if (stopping)
            return;
        const deadline = setTimeout(() => process.exit(75), 5_000);
        deadline.unref();
        await shutdown("Discord restart");
        process.exit(75);
    }
    : undefined);
let dashboard;
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? 3000);
try {
    if (!Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535) {
        throw new Error("DASHBOARD_PORT must be an integer from 1 to 65535");
    }
    dashboard = await startDashboard(bot.client, dashboardPort, process.env.BOT_CONTROL_ORIGIN);
    logger.info(`Dashboard available at http://127.0.0.1:${dashboardPort}`);
}
catch (error) {
    logger.warn("Local dashboard could not start; continuing with the bot", error);
}
let stopping = false;
async function shutdown(signal) {
    if (stopping)
        return;
    stopping = true;
    logger.info(`Received ${signal}; shutting down`);
    dashboard?.close();
    dashboard?.closeAllConnections();
    await bot.stop();
    process.exitCode = 0;
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => logger.error("Unhandled rejection", error));
process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", error);
    void shutdown("uncaughtException");
});
try {
    await bot.start();
}
catch (error) {
    logger.error("Bot startup failed", error);
    await shutdown("startup failure");
    process.exitCode = 1;
}
//# sourceMappingURL=index.js.map