"""One serialized playback worker per guild; callbacks only signal completion."""
import asyncio
import logging
import random
from collections import deque

import discord

from .audio import filters

log = logging.getLogger(__name__)


class Player:
    def __init__(self, voice, channel, youtube, idle=180, max_queue=100):
        self.voice, self.channel, self.youtube = voice, channel, youtube
        self.idle, self.max_queue = idle, max_queue
        self.queue = deque()
        self.current = None
        self.volume = 80
        self.preset = "normal"
        self.eq = (0, 0, 0)
        self.loop = "off"
        self.wake = asyncio.Event()
        self.done = asyncio.Event()
        self.closed = False
        self.skip_requested = False
        self.task = asyncio.create_task(self.run())

    def add(self, track):
        if self.closed:
            raise ValueError("The player disconnected. Run /play again.")
        if len(self.queue) >= self.max_queue:
            raise ValueError(f"Queue is full ({self.max_queue} songs).")
        self.queue.append(track)
        self.wake.set()

    async def say(self, message):
        try:
            await self.channel.send(message, allowed_mentions=discord.AllowedMentions.none())
        except discord.HTTPException:
            pass

    def skip(self):
        self.skip_requested = True
        self.voice.stop()
        self.done.set()

    def shuffle(self):
        random.shuffle(self.queue)

    async def close(self):
        self.closed = True
        self.queue.clear()
        self.wake.set()
        self.done.set()
        self.voice.stop()
        if asyncio.current_task() is not self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        await self.voice.disconnect(force=True)

    async def run(self):
        try:
            while not self.closed:
                if not self.queue:
                    self.wake.clear()
                    try:
                        await asyncio.wait_for(self.wake.wait(), self.idle)
                    except TimeoutError:
                        await self.say("Queue finished — heading out. Use /play to bring me back! 🧇")
                        await self.close()
                        return
                    if self.closed:
                        return
                self.current = self.queue.popleft()
                self.skip_requested = False
                self.done = asyncio.Event()
                failed = False
                source = None
                try:
                    stream = await self.youtube.stream(self.current)
                    if self.closed:
                        return
                    if not self.skip_requested:
                        source = discord.FFmpegOpusAudio(
                            stream.url, before_options=stream.ffmpeg_before_options(),
                            options=f'-vn -af "{filters(self.preset, *self.eq, self.volume)}"',
                        )
                        loop = asyncio.get_running_loop()
                        errors = []
                        def after(error, finished=self.done, failures=errors, event_loop=loop):
                            if error:
                                failures.append(error)
                            event_loop.call_soon_threadsafe(finished.set)
                        self.voice.play(source, after=after)
                        await self.say(f"🎶 Now playing **{discord.utils.escape_markdown(self.current.title)}**\n<{self.current.url}>")
                        await self.done.wait()
                        if errors:
                            raise RuntimeError("Voice playback failed") from errors[0]
                except asyncio.CancelledError:
                    raise
                except Exception:
                    failed = True
                    log.exception("Playback failed")
                    await self.say("Couldn't play that track. Skipping it; try another upload or update yt-dlp.")
                finally:
                    if source is not None:
                        self.voice.stop()
                        source.cleanup()
                if not self.closed and not failed and not self.skip_requested:
                    if self.loop == "track":
                        self.queue.appendleft(self.current)
                    elif self.loop == "queue":
                        self.queue.append(self.current)
                self.current = None
        finally:
            self.current = None
