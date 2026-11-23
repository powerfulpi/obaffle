import { ObamaBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { startDashboard } from "./dashboard.js";
import type { Server } from "node:http";
import { createInterface } from "node:readline";
import { createServer, type Server as NetServer } from "node:net";
import { mkdir, rm, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Set these to the Discord server and text channel that should receive console messages.
const AIDEN_GUILD_ID = "998854277751648306";
const AIDEN_CHANNEL_ID = "1041514317276794930";

const config = loadConfig();
const logger = new Logger(config.logLevel);
const bot = new ObamaBot(config, logger, process.env.OBAMA_SUPERVISED === "1"
  ? async () => {
      if (stopping) return;
      const deadline = setTimeout(() => process.exit(75), 5_000);
      deadline.unref();
      await shutdown("Discord restart");
      process.exit(75);
    }
  : undefined);

let dashboard: Server | undefined;
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? 3000);
try {
  if (!Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535) {
    throw new Error("DASHBOARD_PORT must be an integer from 1 to 65535");
  }
  dashboard = await startDashboard(bot.client, dashboardPort, process.env.BOT_CONTROL_ORIGIN);
  logger.info(`Dashboard available at http://127.0.0.1:${dashboardPort}`);
} catch (error) {
  logger.warn("Local dashboard could not start; continuing with the bot", error);
}

let stopping = false;
const socketDir = join(homedir(), ".local", "share", "obama");
const socketPath = join(socketDir, "aiden.sock");
let commandServer: NetServer | undefined;

async function sendAidenMessage(message: string): Promise<void> {
  if (!AIDEN_GUILD_ID || !AIDEN_CHANNEL_ID) throw new Error("Set AIDEN_GUILD_ID and AIDEN_CHANNEL_ID in src/index.ts first");
  if (!bot.client.isReady()) throw new Error("Obama is not connected to Discord yet");
  if (message.length > 1989) throw new Error("Message is too long for Discord");
  const guild = await bot.client.guilds.fetch(AIDEN_GUILD_ID);
  const channel = await guild.channels.fetch(AIDEN_CHANNEL_ID);
  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    throw new Error("Configured channel is not a sendable text channel in the configured server");
  }
  await channel.send({ content: `aiden says ${message}`, allowedMentions: { parse: [] } });
}

async function startCommandServer(): Promise<void> {
  await mkdir(socketDir, { recursive: true, mode: 0o700 });
  await rm(socketPath, { force: true });
  commandServer = createServer((connection) => {
    let input = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      input += chunk;
      if (input.length > 4000) { connection.end("Message is too long\n"); return; }
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      const message = input.slice(0, newline).trim();
      input = "";
      if (!message) { connection.end("Usage: aiden <message>\n"); return; }
      void sendAidenMessage(message)
        .then(() => connection.end("Sent to Discord\n"))
        .catch((error: unknown) => connection.end(`Error: ${String(error)}\n`));
    });
  });
  await new Promise<void>((resolve, reject) => {
    commandServer!.once("error", reject);
    commandServer!.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o600);
}

const consoleInput = createInterface({ input: process.stdin, terminal: false });
consoleInput.on("line", (line) => {
  const match = /^aiden(?:\s+(.*))?$/i.exec(line.trim());
  if (!match) return;
  const message = match[1]?.trim();
  if (!message) {
    logger.info("Usage: aiden <message>");
    return;
  }
  void sendAidenMessage(message)
    .then(() => logger.info("Sent Aiden's message to Discord"))
    .catch((error) => logger.error("Could not send Aiden's message", error));
});
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  consoleInput.close();
  commandServer?.close();
  await rm(socketPath, { force: true });
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
  await startCommandServer();
  await bot.start();
} catch (error) {
  logger.error("Bot startup failed", error);
  await shutdown("startup failure");
  process.exitCode = 1;
}
