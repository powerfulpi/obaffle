import type { Client } from "discord.js";
import type { AppConfig } from "./config.js";
import { LIVE_CAPTIONS_CHANNEL_ID, LIVE_CAPTIONS_GUILD_ID } from "./live-captions.js";
import type { SettingsStore } from "./settings-store.js";

export async function canReadGlobalStatus(client: Client, userId: string): Promise<boolean> {
  const application = await client.application?.fetch();
  const owner = application?.owner;
  if (!owner) return false;
  return ("ownerId" in owner ? owner.ownerId : owner.id) === userId;
}

export function buildGlobalStatus(
  client: Client,
  settings: SettingsStore,
  config: AppConfig,
  voice: { isConnected(guildId: string): boolean },
): { text: string; serverCount: number; conversationCount: number } {
  const saved = settings.snapshot();
  const ids = [...new Set([...Object.keys(saved), ...client.guilds.cache.keys()])].sort();
  const lines = [
    "OBAMA — GLOBAL CONFIGURATION STATUS",
    `Captured: ${new Date().toISOString()}`,
    `Discord: ${client.isReady() ? "ready" : "not ready"}`,
    `Process uptime: ${Math.floor(process.uptime())} seconds`,
    `Connected servers: ${client.guilds.cache.size}; known servers (including saved settings): ${ids.length}`,
    `Chat: ${config.aiProvider} / ${config.aiProvider === "gemini" ? config.geminiModel : config.openaiModel}`,
    `Transcription provider: ${config.sttProvider}`,
    `Image generation: ${config.imageProvider} / ${config.imageProvider === "gemini" ? config.geminiImageModel : config.openaiImageModel}`,
    `Speech: Cartesia / ${config.cartesiaModel}`,
    `Captions: ${LIVE_CAPTIONS_GUILD_ID && LIVE_CAPTIONS_CHANNEL_ID
      ? `all servers -> guild ${LIVE_CAPTIONS_GUILD_ID}, channel ${LIVE_CAPTIONS_CHANNEL_ID}`
      : "disabled (destination IDs incomplete)"}`,
    "",
    "DEFAULT INSTRUCTIONS (used where no custom instructions are set)",
    config.defaultInstructions,
  ];
  let conversationCount = 0;
  for (const id of ids) {
    const guild = client.guilds.cache.get(id);
    const value = saved[id] ?? settings.get(id);
    const modes = Object.entries(value.conversationChannels).sort(([a], [b]) => a.localeCompare(b));
    conversationCount += modes.length;
    lines.push(
      "", "=".repeat(64),
      `SERVER: ${guild?.name ?? "Unknown / saved server"} (${id})`,
      `Availability: ${guild ? guild.available ? "available" : "unavailable" : "not in current server cache; saved settings only"}`,
      `Voice session connected: ${voice.isConnected(id) ? "yes" : "no"}`,
      `Conversation memory: ${value.memoryEnabled ? "on" : "off"} (RAM only)`,
      `Selected voice: ${value.selectedVoice}`,
      "", "VOICES (alias -> Cartesia voice ID)",
      ...Object.entries(value.voices).sort(([a], [b]) => a.localeCompare(b)).map(([alias, voiceId]) =>
        `  ${alias}${alias === value.selectedVoice ? " [selected]" : ""}${alias === "original" ? " [environment default]" : " [custom]"} -> ${voiceId}`),
      "", `ENABLED CONVERSATION MODES: ${modes.length}`,
      ...(modes.length ? modes.map(([channelId, mode]) => {
        const channel = guild?.channels.cache.get(channelId);
        return `  ${channel?.name ?? "Unknown / uncached channel"} (${channelId}): ${mode.chancePercent}% chance; ${mode.cooldownSeconds}s cooldown`;
      }) : ["  None"]),
      "  These are enabled settings; unavailable/deleted channels cannot receive replies.",
      "", "CUSTOM INSTRUCTIONS",
      value.instructions ?? "  None — using default instructions above.",
    );
  }
  return { text: lines.join("\n") + "\n", serverCount: ids.length, conversationCount };
}
