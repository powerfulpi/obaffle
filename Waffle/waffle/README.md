# 🧇 Waffle

A Discord music bot with YouTube lookup, selectable search results, per-server queues, and playful FFmpeg sound effects. Uses slash commands; no message-content intent or YouTube API key needed.

While online, Waffle's member-list activity displays **Listening to /play • /search • /help**, so users can quickly discover how to request music and find commands.

## Run locally

Requires Python 3.11+, FFmpeg, and Deno 2.3+ or Node 22+. On macOS:

```sh
brew install ffmpeg deno
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp .env.example .env
```

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications), open **Bot**, and generate its token. Put it in `.env` as `DISCORD_TOKEN`. Keep it private.
2. Under **Installation**, enable Guild Install with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Embed Links, Connect, and Speak. Invite the bot using the provided install link. No Administrator permission or privileged intents are required.
3. Optionally set `DISCORD_GUILD_ID` to your server ID for fast development command registration. Leave it blank for global commands, which may take time to propagate. Avoid changing sync mode repeatedly: old development commands can remain registered.
4. Start from the project directory with `.venv/bin/python -m waffle.bot`. This uses the project's dependencies even in a new terminal where the virtual environment is not activated. Join a regular voice channel and run `/play query:Daft Punk Around the World`.

The bot runs while this process and machine stay online. It is not deployed automatically.

## Commands

| Command | What it does |
| --- | --- |
| `/play query` | Queue a song/video, or import an HTTPS YouTube playlist in order |
| `/search query` | Choose from up to five results in a private dropdown |
| `/pause` | Toggle pause/resume |
| `/skip` | Skip, including when track loop is enabled |
| `/stop` | Clear the queue and disconnect |
| `/queue page` | Show upcoming songs and who requested them |
| `/nowplaying` | Show the current song and configured audio settings |
| `/shuffle` | Shuffle upcoming tracks |
| `/remove position` | Remove a numbered upcoming song |
| `/loop mode` | Off, current track, or whole queue |
| `/volume percent` | Set volume from 0–150% |
| `/effect preset` | Normal, bassboost, nightcore, slowed/reverb, karaoke, 8d, radio, tremolo |
| `/eq bass mid treble` | Three-band EQ, −12 to +12 dB; defaults reset to zero |
| `/help` | Quick command reference |

**Sound settings apply at the start of the next track**, including a loop replay. EQ and presets combine; `/effect normal` disables the preset and `/eq` resets EQ. A limiter follows the filters to reduce clipping. Karaoke uses center cancellation and will not cleanly remove vocals from every mix. “8d” is stereo panning, best heard on headphones.

Playback selects yt-dlp's best available audio and encodes stereo Opus at 192 kbps with variable bitrate and maximum encoding quality. The limiter has automatic makeup gain disabled, preserving the requested volume. Source upload quality and the Discord voice connection still affect what listeners hear. For clean playback, use `/effect normal` and `/eq` to reset any effects left on the player.

Users must share the bot's voice channel to modify playback. There is one player per server, with a default 100-song queue cap and 180-second empty-queue timeout. The bot also leaves when all human listeners leave. Queues and settings are in memory and reset after disconnect/restart. Paused tracks remain connected while listeners are present.

Direct links support **YouTube videos and playlists** (including YouTube Music, Shorts, and youtu.be), not arbitrary audio URLs. Use `/play query:https://www.youtube.com/playlist?list=PLAYLIST_ID` to append a playlist in order. Video links containing `list=` also import the playlist from the beginning; remove `list=` to queue only that video. Imports inspect the first `MAX_QUEUE` entries (100 by default), skip entries marked unavailable or live/upcoming, and add as many playable tracks as fit in the remaining queue space. Waffle confirms the number added and reports when additional tracks did not fit. Private or empty playlists return an error. `/search` still offers up to five individual tracks to choose from. Stream URLs are resolved again at playback time to avoid stale queue entries. Failed tracks are skipped without looping forever.

## Verify

```sh
.venv/bin/python -m pytest -q
.venv/bin/python -m ruff check waffle tests
```

Tests cover dependency checks, input validation, actual FFmpeg rendering of every effect, queue bounds, idle cleanup, track looping, skipping, failed tracks, and stopping during extraction. Discord connection and audible end-to-end playback require a real bot token/server and are not covered by the offline tests.

## Troubleshooting

- **YouTube 403 / SABR warning:** update the environment that runs the bot with `.venv/bin/python -m pip install -U 'yt-dlp[default]'`, stop the running bot with Ctrl+C, then restart with `.venv/bin/python -m waffle.bot`. Updating packages does not update an already running process. Waffle logs its Python executable and yt-dlp version at startup and rejects versions older than the project minimum. A bare `python3 -m waffle.bot` may use an older system installation even if the virtual environment is current. The SABR warning alone is not a playback failure; see [yt-dlp's tracking issue](https://github.com/yt-dlp/yt-dlp/issues/12482).
- **Other YouTube extraction errors:** YouTube sometimes blocks requests from hosting providers or requires sign-in; try another public upload/network. Waffle does not manage cookies or bypass restrictions.
- **Temporary failures:** Waffle retries extraction once for 403, timeout, connection-reset, and temporary server errors, resolving a fresh stream URL. FFmpeg also reconnects on network errors and HTTP 5xx responses. Sign-in, rate-limit, and unavailable-video errors are reported separately and are not repeatedly retried. A genuine YouTube block can still require attention to the bot's hosting network; audio encoding changes cannot fix that.
- **Missing JS runtime:** install Deno 2.3+ or Node 22+ on PATH. The bot enables either runtime; the yt-dlp default extra includes its challenge solver. See [yt-dlp's runtime guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
- **Voice connection errors:** check Connect/Speak channel overrides and outgoing UDP/network access. Install `discord.py[voice]` as specified, which includes the voice dependencies; see [discord.py installation](https://discordpy.readthedocs.io/en/stable/intro.html).
- **No slash commands:** check the applications.commands installation scope, guild ID, and startup logs.
- **No text responses:** ensure View Channels, Send Messages, and Embed Links in the command's text channel.

Only play material you have permission to use and follow the services' terms.
