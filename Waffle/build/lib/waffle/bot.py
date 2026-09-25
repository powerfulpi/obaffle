import asyncio
import logging
import os
import shutil
import sys
from typing import Literal

import discord
from discord import app_commands
from dotenv import load_dotenv

from .audio import PRESETS, YTDLP_VERSION, YouTube, check_ytdlp_version
from .player import Player


class Waffle(discord.Client):
    def __init__(self):
        super().__init__(
            intents=discord.Intents.default(),
            allowed_mentions=discord.AllowedMentions.none(),
            activity=discord.Activity(
                type=discord.ActivityType.listening,
                name="/play • /search • /help",
            ),
        )
        self.tree = app_commands.CommandTree(self)
        self.youtube = YouTube()
        self.players = {}
        self.locks = {}

    async def setup_hook(self):
        guild = os.getenv("DISCORD_GUILD_ID")
        if guild:
            target = discord.Object(id=int(guild))
            self.tree.copy_global_to(guild=target)
            await self.tree.sync(guild=target)
        else:
            await self.tree.sync()

    async def close(self):
        await asyncio.gather(*(p.close() for p in self.players.values() if not p.closed), return_exceptions=True)
        await super().close()

    async def on_voice_state_update(self, member, before, after):
        player = self.players.get(member.guild.id)
        if not player or player.closed:
            return
        if (member.id == self.user.id and after.channel is None) or (
            before.channel == player.voice.channel
            and not any(not m.bot for m in player.voice.channel.members)
        ):
            await player.close()

    async def enqueue(self, interaction, track):
        guild = interaction.guild
        if guild is None:
            raise ValueError("Use this command in a server.")
        async with self.locks.setdefault(guild.id, asyncio.Lock()):
            channel = listener_channel(interaction)
            player = self.players.get(guild.id)
            if player is None or player.closed:
                if isinstance(channel, discord.StageChannel):
                    raise ValueError("Please use a regular voice channel.")
                permissions = channel.permissions_for(guild.me)
                if not permissions.connect or not permissions.speak:
                    raise ValueError("I need Connect and Speak permissions in your voice channel.")
                voice = guild.voice_client
                if voice and voice.channel != channel:
                    raise ValueError("Join my voice channel before adding songs.")
                if not voice:
                    voice = await channel.connect(self_deaf=True)
                player = Player(voice, interaction.channel, self.youtube,
                                idle=int(os.getenv("IDLE_TIMEOUT", "180")),
                                max_queue=int(os.getenv("MAX_QUEUE", "100")))
                self.players[guild.id] = player
            elif player.voice.channel != channel:
                raise ValueError("Join my voice channel before adding songs.")
            player.add(track)
        await interaction.followup.send(f"🧇 Queued **{discord.utils.escape_markdown(track.title)}**")


def listener_channel(interaction):
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        raise ValueError("Use this command in a server.")
    state = interaction.user.voice
    if not state or not state.channel:
        raise ValueError("Join a voice channel first.")
    return state.channel


bot = Waffle()


def player_for(interaction):
    channel = listener_channel(interaction)
    player = bot.players.get(interaction.guild_id)
    if not player or player.closed:
        raise ValueError("Nothing is playing. Start with /play.")
    if player.voice.channel != channel:
        raise ValueError("Join my voice channel to control playback.")
    return player


class SearchResults(discord.ui.View):
    def __init__(self, tracks, owner):
        super().__init__(timeout=60)
        self.owner = owner
        self.used = False
        select = discord.ui.Select(placeholder="Choose a song to queue…", options=[
            discord.SelectOption(label=t.title[:100], value=str(i),
                                 description=f"{t.duration // 60}:{t.duration % 60:02d}")
            for i, t in enumerate(tracks)])
        async def choose(interaction):
            if interaction.user.id != self.owner:
                await interaction.response.send_message("Run /search to choose your own song.", ephemeral=True)
                return
            if self.used:
                await interaction.response.send_message("This search has already been used.", ephemeral=True)
                return
            self.used = True
            await interaction.response.defer()
            try:
                await bot.enqueue(interaction, tracks[int(select.values[0])])
            except Exception as exc:  # noqa: BLE001 — report UI callback errors centrally
                self.used = False
                await report_error(interaction, exc)
                return
            select.disabled = True
            await interaction.edit_original_response(view=self)
            self.stop()
        select.callback = choose
        self.add_item(select)


async def report_error(interaction, error):
    error = getattr(error, "original", error)
    if isinstance(error, ValueError):
        message = str(error)
    else:
        logging.getLogger(__name__).error("Command failed", exc_info=(type(error), error, error.__traceback__))
        message = "That didn't work. Check my voice permissions, or try another video. Details are in the bot logs."
    if interaction.response.is_done():
        await interaction.followup.send(message, ephemeral=True)
    else:
        await interaction.response.send_message(message, ephemeral=True)


bot.tree.on_error = report_error


@bot.tree.command(description="Play a YouTube song name or direct video link")
@app_commands.guild_only()
async def play(interaction: discord.Interaction, query: str):
    listener_channel(interaction)
    await interaction.response.defer()
    tracks = await bot.youtube.search(query, interaction.user.id)
    await bot.enqueue(interaction, tracks[0])


@bot.tree.command(description="Look up five YouTube results and choose one")
@app_commands.guild_only()
async def search(interaction: discord.Interaction, query: str):
    listener_channel(interaction)
    await interaction.response.defer(ephemeral=True)
    tracks = await bot.youtube.search(query, interaction.user.id, 5)
    await interaction.followup.send("Choose a track within 60 seconds.", view=SearchResults(tracks, interaction.user.id), ephemeral=True)


@bot.tree.command(description="Pause or resume the current song")
@app_commands.guild_only()
async def pause(interaction: discord.Interaction):
    p = player_for(interaction)
    if p.voice.is_paused():
        p.voice.resume()
        message = "▶️ Resumed."
    elif p.voice.is_playing():
        p.voice.pause()
        message = "⏸️ Paused."
    else:
        raise ValueError("No audio is playing yet.")
    await interaction.response.send_message(message)


@bot.tree.command(description="Skip the current song, even when looping")
@app_commands.guild_only()
async def skip(interaction: discord.Interaction):
    p = player_for(interaction)
    if not p.current:
        raise ValueError("There is no current song.")
    p.skip()
    await interaction.response.send_message("⏭️ Skipped.")


@bot.tree.command(description="Clear the queue and disconnect")
@app_commands.guild_only()
async def stop(interaction: discord.Interaction):
    p = player_for(interaction)
    await interaction.response.defer()
    await p.close()
    await interaction.followup.send("Stopped and cleared the queue. See you next time! 🧇")


@bot.tree.command(description="Show the song queue (10 per page)")
@app_commands.guild_only()
async def queue(interaction: discord.Interaction, page: app_commands.Range[int, 1, 100] = 1):
    p = player_for(interaction)
    tracks = list(p.queue)
    pages = max(1, (len(tracks) + 9) // 10)
    if page > pages:
        raise ValueError(f"Choose a page from 1 to {pages}.")
    lines = [f"{i + 1}. {discord.utils.escape_markdown(t.title)} · requested by <@{t.requester}>"
             for i, t in enumerate(tracks) if (page - 1) * 10 <= i < page * 10]
    embed = discord.Embed(title="🧇 Waffle queue", description="\n".join(lines) or "Queue is empty.", color=0xEDAE49)
    embed.set_footer(text=f"Page {page}/{pages} · {len(tracks)} queued · Loop: {p.loop}")
    await interaction.response.send_message(embed=embed)


@bot.tree.command(description="Show current song and settings")
@app_commands.guild_only()
async def nowplaying(interaction: discord.Interaction):
    p = player_for(interaction)
    if not p.current:
        raise ValueError("Nothing is playing yet.")
    embed = discord.Embed(title=p.current.title, url=p.current.url, color=0xEDAE49)
    embed.description = f"Requested by <@{p.current.requester}>\nConfigured effect: **{p.preset}** · Volume: **{p.volume}%**\nEQ: {p.eq} · Loop: {p.loop}\nSound changes apply on the next track."
    await interaction.response.send_message(embed=embed)


@bot.tree.command(description="Shuffle upcoming songs")
@app_commands.guild_only()
async def shuffle(interaction: discord.Interaction):
    player_for(interaction).shuffle()
    await interaction.response.send_message("🔀 Queue shuffled.")


@bot.tree.command(description="Remove a queued song by its position")
@app_commands.guild_only()
async def remove(interaction: discord.Interaction, position: app_commands.Range[int, 1, 100]):
    p = player_for(interaction)
    if position > len(p.queue):
        raise ValueError("That position is not in the queue.")
    del p.queue[position - 1]
    await interaction.response.send_message(f"Removed song {position}.")


@bot.tree.command(description="Repeat the current song, whole queue, or neither")
@app_commands.guild_only()
async def loop(interaction: discord.Interaction, mode: Literal["off", "track", "queue"]):
    player_for(interaction).loop = mode
    await interaction.response.send_message(f"🔁 Loop: {mode}.")


@bot.tree.command(description="Set volume for the next track (0–150%)")
@app_commands.guild_only()
async def volume(interaction: discord.Interaction, percent: app_commands.Range[int, 0, 150]):
    player_for(interaction).volume = percent
    await interaction.response.send_message(f"🔊 Volume set to {percent}%; applies on the next track.")


@bot.tree.command(description="Apply a fun sound preset to the next track")
@app_commands.guild_only()
@app_commands.choices(preset=[app_commands.Choice(name=k, value=k) for k in PRESETS])
async def effect(interaction: discord.Interaction, preset: str):
    if preset not in PRESETS:
        raise ValueError("Choose a listed preset.")
    player_for(interaction).preset = preset
    await interaction.response.send_message(f"✨ {preset} enabled for the next track.")


@bot.tree.command(description="Custom 3-band EQ in dB; applies on the next track")
@app_commands.guild_only()
async def eq(interaction: discord.Interaction, bass: app_commands.Range[int, -12, 12] = 0,
             mid: app_commands.Range[int, -12, 12] = 0, treble: app_commands.Range[int, -12, 12] = 0):
    player_for(interaction).eq = (bass, mid, treble)
    await interaction.response.send_message(f"🎛️ EQ: bass {bass}, mid {mid}, treble {treble} dB. Applies on the next track.")


@bot.tree.command(description="Show Waffle's commands and tips")
async def help(interaction: discord.Interaction):
    await interaction.response.send_message(
        "**🧇 Waffle music**\n/play song-or-link · /search song\n"
        "/pause toggles pause/resume · /skip · /stop\n"
        "/queue [page] · /nowplaying · /shuffle · /remove position · /loop\n"
        "/effect · /eq · /volume (sound changes apply on the next track)\n"
        "Join my voice channel to control music. I leave when everyone leaves or the queue stays empty.\n"
        "Karaoke reduces centered vocals; results depend on the mix. Queues are held in memory.", ephemeral=True)


def main():
    load_dotenv()
    logging.basicConfig(level=logging.INFO)
    try:
        check_ytdlp_version()
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from None
    logging.getLogger(__name__).info("Python: %s; yt-dlp: %s", sys.executable, YTDLP_VERSION)
    token = os.getenv("DISCORD_TOKEN", "").strip()
    if not token:
        raise SystemExit("Set DISCORD_TOKEN in .env first; see README.md.")
    if not shutil.which("ffmpeg"):
        raise SystemExit("FFmpeg is missing. Install it and add it to PATH.")
    if not (shutil.which("deno") or shutil.which("node")):
        raise SystemExit("Install Deno >=2.3 or Node >=22 for YouTube playback.")
    for key, default in (("IDLE_TIMEOUT", "180"), ("MAX_QUEUE", "100")):
        try:
            if not 1 <= int(os.getenv(key, default)) <= (100 if key == "MAX_QUEUE" else 3600):
                raise ValueError()
        except ValueError:
            raise SystemExit(f"Invalid {key}; see .env.example.") from None
    bot.run(token)


if __name__ == "__main__":
    main()
