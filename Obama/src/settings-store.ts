import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ConversationChannelSettings, GuildSettings, PersistedSettings } from "./types.js";

const VOICE_ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function sanitizeConversationChannels(value: unknown): Record<string, ConversationChannelSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const channels: Array<[string, ConversationChannelSettings]> = [];
  for (const [channelId, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const { chancePercent, cooldownSeconds } = candidate as Partial<ConversationChannelSettings>;
    if (
      typeof chancePercent !== "number" ||
      !Number.isFinite(chancePercent) ||
      chancePercent <= 0 ||
      chancePercent > 100 ||
      typeof cooldownSeconds !== "number" ||
      !Number.isSafeInteger(cooldownSeconds) ||
      cooldownSeconds < 0 ||
      cooldownSeconds > 86_400
    ) {
      continue;
    }
    channels.push([channelId, { chancePercent, cooldownSeconds }]);
  }
  return Object.fromEntries(channels);
}

export function normalizeVoiceAlias(alias: string): string {
  const normalized = alias.trim().toLowerCase();
  if (!VOICE_ALIAS_PATTERN.test(normalized)) {
    throw new Error(
      "Voice names must be 1-32 characters and use only letters, numbers, _ or -.",
    );
  }
  return normalized;
}

export class SettingsStore {
  private readonly filePath: string;
  private data: PersistedSettings = { version: 1, guilds: {} };
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(
    dataDir: string,
    private readonly originalVoiceId: string,
  ) {
    this.filePath = join(dataDir, "guild-settings.json");
  }

  public async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      if (parsed.version !== 1 || !parsed.guilds || typeof parsed.guilds !== "object") {
        throw new Error("Unsupported settings file format");
      }
      this.data = parsed as PersistedSettings;
      for (const settings of Object.values(this.data.guilds)) {
        settings.conversationChannels = sanitizeConversationChannels(settings.conversationChannels);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  public get(guildId: string): GuildSettings {
    const existing = this.data.guilds[guildId];
    if (existing) {
      existing.conversationChannels = sanitizeConversationChannels(existing.conversationChannels);
      existing.voices.original = this.originalVoiceId;
      if (!existing.voices[existing.selectedVoice]) {
        existing.selectedVoice = "original";
      }
      return existing;
    }

    const created: GuildSettings = {
      selectedVoice: "original",
      voices: { original: this.originalVoiceId },
      instructions: null,
      memoryEnabled: true,
      conversationChannels: {},
    };
    this.data.guilds[guildId] = created;
    return created;
  }

  public snapshot(): Record<string, GuildSettings> {
    return Object.fromEntries(Object.keys(this.data.guilds).map((id) => [id, structuredClone(this.get(id))]));
  }

  public getSelectedVoiceId(guildId: string): string {
    const settings = this.get(guildId);
    return settings.voices[settings.selectedVoice] ?? this.originalVoiceId;
  }

  public async mutate(
    guildId: string,
    mutation: (settings: GuildSettings) => void,
  ): Promise<GuildSettings> {
    const settings = this.get(guildId);
    mutation(settings);
    settings.conversationChannels = sanitizeConversationChannels(settings.conversationChannels);
    await this.save();
    return settings;
  }

  private async save(): Promise<void> {
    const snapshot = `${JSON.stringify(this.data, null, 2)}\n`;
    this.writeChain = this.writeChain.then(async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, snapshot, { mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    await this.writeChain;
  }
}
