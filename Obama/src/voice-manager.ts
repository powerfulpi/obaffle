import {
  AudioPlayerStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  NetworkingStatusCode,
  StreamType,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
  type VoiceConnectionState,
} from "@discordjs/voice";
import type { Client, VoiceBasedChannel } from "discord.js";
import { Readable } from "node:stream";
import prism from "prism-media";

import { analyzePcm16 } from "./audio.js";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";

export interface VoiceUtterance {
  guildId: string;
  channelId: string;
  userId: string;
  pcm: Buffer;
}

type UtteranceHandler = (utterance: VoiceUtterance) => Promise<void>;

export class VoiceManager {
  private readonly sessions = new Map<string, VoiceSession>();

  public constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly onUtterance: UtteranceHandler,
  ) {}

  public async join(channel: VoiceBasedChannel): Promise<"joined" | "already-joined"> {
    const existing = this.sessions.get(channel.guild.id);
    if (existing?.channelId === channel.id) return "already-joined";
    existing?.destroy();

    if (!channel.joinable) {
      throw new Error(
        `Discord reports voice channel "${channel.name}" is not joinable. ` +
          "Check the bot's View Channel and Connect permissions and the channel user limit.",
      );
    }

    this.logger.info("Joining voice channel", {
      guildId: channel.guild.id,
      channelId: channel.id,
      channelName: channel.name,
      timeoutMs: this.config.voiceJoinTimeoutMs,
    });

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    this.logger.info("Voice connection created", {
      guildId: channel.guild.id,
      channelId: channel.id,
      ...describeVoiceConnectionState(connection.state),
    });
    connection.on("stateChange", (oldState, newState) => {
      this.logger.info("Voice connection state changed", {
        guildId: channel.guild.id,
        channelId: channel.id,
        from: describeVoiceConnectionState(oldState),
        to: describeVoiceConnectionState(newState),
      });
    });
    connection.on("error", (error) => {
      this.logger.error("Discord voice connection error", error);
    });

    try {
      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        this.config.voiceJoinTimeoutMs,
      );
    } catch (error) {
      const finalState = describeVoiceConnectionState(connection.state);
      this.logger.error("Voice channel join did not become ready", {
        guildId: channel.guild.id,
        channelId: channel.id,
        timeoutMs: this.config.voiceJoinTimeoutMs,
        finalState,
        error: error instanceof Error ? error.message : String(error),
      });
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
      throw new Error(
        `Voice connection did not become ready within ${this.config.voiceJoinTimeoutMs}ms. ` +
          `Last state: ${formatVoiceConnectionState(finalState)}.`,
        { cause: error },
      );
    }

    let session!: VoiceSession;
    session = new VoiceSession(
      this.client,
      channel.guild.id,
      channel.id,
      connection,
      this.config,
      this.logger,
      this.onUtterance,
      () => {
        if (this.sessions.get(channel.guild.id) === session) {
          this.sessions.delete(channel.guild.id);
        }
      },
    );
    this.sessions.set(channel.guild.id, session);
    return "joined";
  }

  public leave(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) return false;
    session.destroy();
    this.sessions.delete(guildId);
    return true;
  }

  public speak(guildId: string, discordPcm: Buffer): boolean {
    const session = this.sessions.get(guildId);
    if (!session) return false;
    session.enqueue(discordPcm);
    return true;
  }

  public isConnected(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  public destroyAll(): void {
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();
  }
}

type VoiceConnectionTelemetry = {
  status: string;
  networking?: string | number;
  disconnectReason?: string | number;
  closeCode?: number;
};

function describeVoiceConnectionState(state: VoiceConnectionState): VoiceConnectionTelemetry {
  const details: VoiceConnectionTelemetry = { status: state.status };
  if ("networking" in state) {
    const code = state.networking.state.code;
    details.networking = NetworkingStatusCode[code] ?? code;
  }
  if ("reason" in state) {
    details.disconnectReason = VoiceConnectionDisconnectReason[state.reason] ?? state.reason;
  }
  if ("closeCode" in state) details.closeCode = state.closeCode;
  return details;
}

function formatVoiceConnectionState(state: VoiceConnectionTelemetry): string {
  const parts = [state.status];
  if (state.networking !== undefined) parts.push(`networking=${state.networking}`);
  if (state.disconnectReason !== undefined) parts.push(`reason=${state.disconnectReason}`);
  if (state.closeCode !== undefined) parts.push(`closeCode=${state.closeCode}`);
  return parts.join(", ");
}

class VoiceSession {
  private readonly player: AudioPlayer;
  private readonly queue: Buffer[] = [];
  private readonly activeRecordings = new Set<string>();
  private suppressCaptureUntil = 0;
  private destroyed = false;

  public constructor(
    private readonly client: Client,
    private readonly guildId: string,
    public readonly channelId: string,
    private readonly connection: VoiceConnection,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly onUtterance: UtteranceHandler,
    private readonly onDestroyed: () => void,
  ) {
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.destroyed) return;
      this.suppressCaptureUntil = Math.max(
        this.suppressCaptureUntil,
        Date.now() + this.config.voiceFeedbackCooldownMs,
      );
      this.logger.info("Voice playback finished", {
        guildId: this.guildId,
        channelId: this.channelId,
        feedbackCooldownMs: this.config.voiceFeedbackCooldownMs,
      });
      this.playNext();
    });
    this.player.on("error", (error) => {
      this.logger.error("Discord audio player error", error);
      this.playNext();
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.destroyed = true;
      this.onDestroyed();
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.logger.warn(`Voice connection disconnected in guild ${this.guildId}`);
    });
    this.connection.receiver.speaking.on("start", (userId) => {
      void this.capture(userId);
    });
  }

  public enqueue(pcm: Buffer): void {
    if (this.destroyed) return;
    this.queue.push(pcm);
    this.logger.info("Voice playback enqueued", {
      guildId: this.guildId,
      channelId: this.channelId,
      pcmBytes: pcm.length,
      queueDepth: this.queue.length,
    });
    if (this.player.state.status === AudioPlayerStatus.Idle) this.playNext();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.queue.length = 0;
    this.player.stop(true);
    this.connection.destroy();
  }

  private playNext(): void {
    if (this.destroyed) return;
    const pcm = this.queue.shift();
    if (!pcm) return;
    const resource = createAudioResource(Readable.from([pcm]), {
      inputType: StreamType.Raw,
    });
    const estimatedDurationMs = Math.ceil((pcm.length / (48_000 * 2 * 2)) * 1_000);
    this.suppressCaptureUntil = Math.max(
      this.suppressCaptureUntil,
      Date.now() + estimatedDurationMs + this.config.voiceFeedbackCooldownMs,
    );
    this.logger.info("Voice playback started", {
      guildId: this.guildId,
      channelId: this.channelId,
      estimatedDurationMs,
      feedbackCooldownMs: this.config.voiceFeedbackCooldownMs,
    });
    this.player.play(resource);
  }

  private async capture(userId: string): Promise<void> {
    if (this.destroyed || this.activeRecordings.has(userId)) return;
    if (this.captureIsSuppressed()) {
      this.logger.info("Voice input suppressed during playback guard", {
        guildId: this.guildId,
        channelId: this.channelId,
        userId,
        remainingMs: this.suppressCaptureUntil - Date.now(),
      });
      return;
    }
    // Reserve the user before the network lookup so duplicate speaking-start
    // events cannot subscribe to the same utterance concurrently.
    this.activeRecordings.add(userId);
    const user = await this.client.users.fetch(userId).catch(() => undefined);
    if (!user || user.bot || this.destroyed) {
      this.activeRecordings.delete(userId);
      return;
    }
    if (this.captureIsSuppressed()) {
      this.activeRecordings.delete(userId);
      this.logger.info("Voice input suppressed during playback guard", {
        guildId: this.guildId,
        channelId: this.channelId,
        userId,
        remainingMs: this.suppressCaptureUntil - Date.now(),
      });
      return;
    }

    const opusStream = this.connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: this.config.speechEndSilenceMs,
      },
    });
    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48_000,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let discarded = false;
    let finished = false;
    const maximumBytes = this.config.maxUtteranceSeconds * 48_000 * 2 * 2;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      this.activeRecordings.delete(userId);
      if (discarded || size === 0 || this.destroyed) return;
      if (this.captureIsSuppressed()) {
        this.logger.info("Voice utterance discarded during playback guard", {
          guildId: this.guildId,
          channelId: this.channelId,
          userId,
          pcmBytes: size,
          remainingMs: this.suppressCaptureUntil - Date.now(),
        });
        return;
      }
      const pcm = Buffer.concat(chunks, size);
      const activity = analyzePcm16(pcm);
      const telemetry = {
        guildId: this.guildId,
        channelId: this.channelId,
        userId,
        pcmBytes: size,
        durationMs: Math.round(activity.durationMs),
        rmsDbfs: Number.isFinite(activity.rmsDbfs)
          ? Number(activity.rmsDbfs.toFixed(1))
          : null,
        peakDbfs: Number.isFinite(activity.peakDbfs)
          ? Number(activity.peakDbfs.toFixed(1))
          : null,
      };
      if (activity.durationMs < this.config.voiceMinUtteranceMs) {
        this.logger.info("Voice utterance discarded: too short", {
          ...telemetry,
          minimumDurationMs: this.config.voiceMinUtteranceMs,
        });
        return;
      }
      if (activity.rmsDbfs < this.config.voiceMinRmsDbfs) {
        this.logger.info("Voice utterance discarded: below audio threshold", {
          ...telemetry,
          minimumRmsDbfs: this.config.voiceMinRmsDbfs,
        });
        return;
      }
      this.logger.info("Voice utterance captured", {
        ...telemetry,
        minimumDurationMs: this.config.voiceMinUtteranceMs,
        minimumRmsDbfs: this.config.voiceMinRmsDbfs,
      });
      void this.onUtterance({
        guildId: this.guildId,
        channelId: this.channelId,
        userId,
        pcm,
      }).catch((error: unknown) => {
        this.logger.error("Voice utterance processing failed", error);
      });
    };

    decoder.on("data", (chunk: Buffer) => {
      if (discarded) return;
      size += chunk.length;
      if (size > maximumBytes) {
        discarded = true;
        this.logger.warn(
          `Discarded an utterance over ${this.config.maxUtteranceSeconds}s in guild ${this.guildId}`,
        );
        opusStream.destroy();
        decoder.destroy();
        finish();
        return;
      }
      chunks.push(chunk);
    });
    opusStream.on("error", (error) => {
      this.logger.warn("Discord receive stream error", error);
      decoder.destroy();
      finish();
    });
    decoder.on("error", (error) => {
      this.logger.warn("Opus decode error", error);
      finish();
    });
    decoder.once("end", finish);
    decoder.once("close", finish);
    opusStream.pipe(decoder);
  }

  private captureIsSuppressed(): boolean {
    return Date.now() < this.suppressCaptureUntil;
  }
}
