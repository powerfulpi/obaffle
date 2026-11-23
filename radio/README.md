# RadiObama web radio

Put audio you have permission to stream in `radio/music/`. The player is at
`http://127.0.0.1:3004`; it plays a shared, continuous 128 kb/s MP3 stream. Everyone
hears the same track. The player ranks matching songs and artists as you type; requesting a result puts it next in the queue (up to 20
requests). Files added while running appear automatically.

Organize music under `music/morning/`, `music/daytime/`, and `music/night/` to use
the default local-time schedule in `schedule.json`. The server falls back to all
music when the current folder is empty. Edit the JSON to change hours or folders.
The schedule is read before every song. Put short audio clips in `announcements/`
to play one between songs about every 30 minutes.

When no listener request is waiting, the station chooses a random song outside
the recent rotation. Requests always take priority.

## AI radio host

Before each song, `host.mjs` uses the AI provider and Cartesia voice already
configured in `Obama/.env` to make a short spoken break. It introduces the next
song and mentions the previous song when there was one. Breaks vary between
music handoffs, listener-focused lines, time checks, station IDs, and weather
roundups for Yadkinville, Winston-Salem, and Boone. Every sixth automatic style
is a longer artist-history break: it fetches a short Wikipedia extract for the
previous artist and asks the host to tell one sourced fact. If no matching page
is available, it uses a regular music handoff. The admin preview includes an
Artist history style and shows the source URL. The station addresses listeners
anywhere; it does not claim to broadcast from one of those cities. Weather uses
National Weather Service hourly forecasts and needs no additional API key. If a
city's forecast is unavailable, the host leaves that city out. If chat generation
fails, it uses a factual fallback script; if voice generation fails, the next song
still plays. Listener requests get an anonymous acknowledgment. The host script
uses the same `AI_PROVIDER`, model, and
`CARTESIA_DEFAULT_VOICE_ID` as the Obama bot, unless `RADIO_CARTESIA_VOICE_ID`
is set in `radio.service`. The radio currently uses its own voice ID. These
breaks incur provider usage.

The site identifies Obama as an AI voice. The script tells the model not to claim
to be Barack Obama. Only use a voice you have permission to use.

The next song fades in under the final six seconds (or less for a short callout)
of the host's voice. The music is ducked while Obama speaks, then reaches full
volume as the song continues. If a callout or overlap fails, the song still plays.

## Admin panel

Open `https://radio.shantry.com/admin`. The password is stored only on this
machine in `radio/admin.env` (mode `600`, ignored by Git). To read it on the
server, run `cat radio/admin.env`; enter the value after `RADIO_ADMIN_PASSWORD=`.
To change it, replace that value with a new long random password, then run
`systemctl --user restart radio.service`.

The panel shows the current playback phase, listener and request counts, recent
callout transcripts, generation time, model, weather facts, and the latest host
error. The **Turn announcements off/on** button controls both AI host callouts
and scheduled audio clips. Turning them off stops a spoken segment currently
playing; the selected song continues. The setting is saved in `settings.json`
and survives restarts. It can skip the current audio and generate an off-air preview for any song
in six callout styles. A preview calls the configured AI and Cartesia APIs and
uses provider credits. Login sessions last 12 hours and end when the radio
service restarts.

The song library lists every local audio file, its pool, its title, and its YouTube match
when available. Each file link downloads that local audio file after admin
authentication. Turn individual songs on or off, or use **All on** / **All off**.
Off songs are removed from automatic selection and the public request list;
queued requests for them are cleared. New imports start on. Song switches are
saved alongside the announcement setting and survive restarts.

Use **Active song pool** to switch between the main library and **Education**.
Place Education audio in `radio/music/education/`; all other music folders belong
to Main. Only the active pool is used for automatic picks and public requests.
The current song finishes when you switch, and queued requests from the previous
pool are cleared. The chosen pool survives restarts. If Education has no songs,
playback waits until files are added or Main is selected again. The song library
shows both pools and can be filtered by pool; its **All on/off** buttons affect
both pools.

The Cartesia voice ID can be changed in the admin panel without restarting the
station. The saved ID is used for the next generated callout and for off-air
previews; the current audio is unaffected. The service unit's voice ID provides
the initial value until a voice is saved in the panel.

Run locally:

```sh
python3 radio/server.py
```

To run it across logouts, copy `radio.service` to `~/.config/systemd/user/`, then
run `systemctl --user daemon-reload` and `systemctl --user enable --now radio.service`.

For public access, open Cloudflare **Networking → Tunnels → obama-phone → Routes →
Add route → Published application**. Set the hostname to `radio.shantry.com` and
the service URL to `http://127.0.0.1:3004`, then save. No new inbound firewall
port is needed. `phone.shantry.com` already points to the phone server. The web
player uses HLS.js on browsers such as Firefox, with native HLS on iOS. The
bundled HLS.js light player is in `radio/vendor/`; its license is alongside it.
The direct stream URL is
`https://radio.shantry.com/hls/live.m3u8`.
The local service alone does not make the station public.

The request list is shared and unauthenticated. Use the public hostname only if
you want visitors to be able to request any listed track. Audio files are played
locally; the site does not accept uploads.

## Import an Apple Music playlist

The importer reads the public Apple Music playlist page, searches YouTube for each
artist/title, and compares title, artist, and duration. It writes all candidates and
scores to `radio/apple-matches.json`. A score of 85 or above is considered ready;
other results are flagged for review. Apple Music supplies metadata only; no audio
is copied from Apple Music.

```sh
Waffle/.venv/bin/python radio/import_apple.py "https://music.apple.com/us/playlist/the-jar-rod/pl.u-kv9lbZJTJplpWq2"
```

After reviewing the JSON, run the same command with `--download` to fetch only
ready matches into `radio/music/apple-import/`. An archive prevents repeat
downloads. The station notices new files automatically. You can rerun the importer
to sync new playlist tracks; it will not remove tracks deleted from Apple Music.
The `radio-import.timer` user unit runs this sync daily at 4 AM local time. It
reads every URL in `playlists.txt`, reuses previous matches for unchanged Apple
tracks, and skips downloaded YouTube IDs. New playlists are merged into the radio
library and label list; existing playlists stay available.
Only download and publicly stream music you have the rights to use. A matching
YouTube upload does not grant those rights.

## Import the Education Spotify playlist

`import_spotify.py` reads the public Spotify playlist's track information, finds
YouTube candidates using the same title, artist, and duration scoring as the
Apple Music importer, and puts high-confidence MP3 matches in
`radio/music/education/`. Spotify audio is never downloaded. Matches and status
are saved in `spotify-matches.json` and `spotify-import-status.json`; interrupted
runs resume from the saved matches. The admin panel shows import progress and
lists imported Education files. Low-confidence matches are flagged for review.

The full Education & Oddities playlist is run by `radio-education-import.service`.
Check its progress with `systemctl --user status radio-education-import.service`
or `journalctl --user -u radio-education-import.service -f`. The matching timer
resumes the import every two hours, with a cap of 100 new downloads per run. If
YouTube challenges the server, the current run pauses immediately. The service
does not change which pool is active.
