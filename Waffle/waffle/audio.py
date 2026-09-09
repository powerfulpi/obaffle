"""YouTube lookup and fixed, validated FFmpeg filter chains."""
import asyncio
import shlex
import sys
from dataclasses import dataclass
from urllib.parse import urlparse

import yt_dlp
from yt_dlp.utils import is_outdated_version
from yt_dlp.version import __version__ as YTDLP_VERSION

# Match the minimum in pyproject.toml, even when launched without installing Waffle.
MIN_YTDLP_VERSION = "2026.08.19"


def check_ytdlp_version():
    if is_outdated_version(YTDLP_VERSION, MIN_YTDLP_VERSION, assume_new=False):
        command = shlex.join([
            sys.executable, "-m", "pip", "install", "--upgrade",
            f"yt-dlp[default]>={MIN_YTDLP_VERSION}",
        ])
        raise RuntimeError(
            f"yt-dlp {YTDLP_VERSION} is outdated; Waffle requires {MIN_YTDLP_VERSION} or newer. "
            f"Update this Python environment with: {command}\n"
            "Then restart Waffle, or start it with .venv/bin/python -m waffle.bot."
        )


PRESETS = {
    "normal": "anull",
    "bassboost": "bass=g=10:f=110:w=0.6",
    "nightcore": "asetrate=48000*1.25,aresample=48000",
    "slowed": "asetrate=48000*0.85,aresample=48000,aecho=0.8:0.7:60:0.25",
    "karaoke": "pan=stereo|c0=c0-c1|c1=c1-c0",
    "8d": "apulsator=hz=0.12",
    "radio": "highpass=f=300,lowpass=f=3000",
    "tremolo": "tremolo=f=5:d=0.7",
}


@dataclass(frozen=True)
class Track:
    title: str
    url: str
    duration: int
    requester: int


@dataclass(frozen=True)
class Stream:
    url: str
    headers: dict[str, str]

    def ffmpeg_before_options(self):
        options = '-nostdin -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -rw_timeout 15000000'
        header_lines = []
        for name, value in self.headers.items():
            if any(char in name + value for char in '\r\n\0') or ':' in name:
                raise ValueError('Invalid stream HTTP header')
            header_lines.append(f'{name}: {value}\r\n')
        if header_lines:
            options += ' -headers ' + shlex.quote(''.join(header_lines))
        return options


def query_target(query: str, limit: int = 1) -> str:
    query = query.strip()
    if not query or len(query) > 500:
        raise ValueError("Enter a song name or YouTube link (up to 500 characters).")
    parsed = urlparse(query)
    if parsed.scheme or query.startswith("www."):
        if parsed.scheme != "https" or parsed.hostname not in {
            "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"
        } or parsed.username or parsed.port not in (None, 443):
            raise ValueError("Direct links must be HTTPS YouTube video links.")
        if parsed.path == "/playlist":
            raise ValueError("Use a video link; playlist imports are not supported.")
        return query
    return f"ytsearch{limit}:{query}"


class YouTube:
    def __init__(self):
        self.slots = asyncio.Semaphore(3)

    async def extract(self, target: str, flat: bool = False):
        async with self.slots:
            def run():
                with yt_dlp.YoutubeDL({
                    "format": "bestaudio/best", "quiet": True,
                    "check_formats": "selected" if not flat else None,
                    "noplaylist": True, "extract_flat": "in_playlist" if flat else False,
                    "socket_timeout": 15, "retries": 2,
                    "js_runtimes": {"deno": {}, "node": {}},
                }) as ydl:
                    return ydl.extract_info(target, download=False)
            return await asyncio.to_thread(run)

    async def search(self, query: str, requester: int, limit: int = 1):
        data = await self.extract(query_target(query, limit), flat=True)
        entries = list(data.get("entries", [data])) if data else []
        tracks = []
        for item in entries:
            if not item or item.get("is_live") or item.get("live_status") == "is_live":
                continue
            video_id = item.get("id", "")
            # Reconstruct canonical URLs, never pass arbitrary extractor URLs to FFmpeg.
            if len(video_id) != 11 or not all(c.isalnum() or c in "_-" for c in video_id):
                continue
            tracks.append(Track(item.get("title", "Untitled")[:150],
                                f"https://www.youtube.com/watch?v={video_id}",
                                int(item.get("duration") or 0), requester))
        if not tracks:
            raise ValueError("No playable videos found. Try another song or video link.")
        return tracks[:limit]

    async def stream(self, track: Track):
        data = await self.extract(track.url)
        if not data or not data.get("url") or data.get("is_live"):
            raise ValueError("This video is unavailable or live; try another upload.")
        url = data["url"]
        host = urlparse(url).hostname or ""
        if urlparse(url).scheme != "https" or not host.endswith(".googlevideo.com"):
            raise ValueError("YouTube returned an unsupported audio stream.")
        return Stream(url, dict(data.get("http_headers") or {}))


def filters(preset: str, bass: int, mid: int, treble: int, volume: int) -> str:
    if preset not in PRESETS or not all(-12 <= x <= 12 for x in (bass, mid, treble)):
        raise ValueError("Invalid equalizer settings")
    if not 0 <= volume <= 150:
        raise ValueError("Volume must be 0–150")
    return (f"aresample=48000,{PRESETS[preset]},"
            f"equalizer=f=100:t=q:w=1:g={bass},equalizer=f=1000:t=q:w=1:g={mid},"
            f"equalizer=f=8000:t=q:w=1:g={treble},volume={volume / 100},alimiter=limit=0.95")
