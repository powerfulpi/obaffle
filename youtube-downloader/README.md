# TubeDrop

A local web interface for downloading YouTube videos and playlists as MP3 or MP4. It uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) and FFmpeg. Download only content you have permission to save.

## Setup

Install Python 3.10+, [FFmpeg](https://ffmpeg.org/download.html), and yt-dlp:

```bash
python3 -m pip install -U yt-dlp
```

If your system Python prevents direct installs, create a virtual environment in this directory:

```bash
python3 -m venv .venv
.venv/bin/pip install -U yt-dlp
.venv/bin/python app.py
```

Otherwise start with `python3 app.py`. Open <http://127.0.0.1:8765>.

Files go to `~/Downloads/YouTube`, organized by playlist title. Set `YTDL_OUTPUT` to change the destination and `YTDL_PORT` to change the local port. The app binds to `127.0.0.1` only. Existing files are reused when you request the same video again.

MP4 conversion can take time and may re-encode formats that are not already MP4 compatible. Some videos may require YouTube authentication or may be unavailable. Update yt-dlp when downloads stop working.

## Reach it remotely with Cloudflare Tunnel

### Stable address on the existing tunnel

TubeDrop runs as the enabled `tubedrop.service` user service on this server. It listens at `http://127.0.0.1:8765` and opens a password-only sign-in page. The password is stored in the private `service.env` file. To change it, replace the value after `YTDL_PASSWORD=` and run `systemctl --user restart tubedrop.service`.

In Cloudflare **Networking → Tunnels → obama-phone → Routes → Add route → Published application**, set the hostname to `you.shantry.com` and the service URL to `http://127.0.0.1:8765`. The existing tunnel process will then serve the downloader at `https://you.shantry.com`. The route needs to be saved in the Cloudflare dashboard; starting the local service does not create it.

When a job finishes, use **Download file** for one item or **Download ZIP** for a playlist with multiple items. **View previous downloads** opens the saved MP3 and MP4 library, including files from earlier sessions.

### Temporary address

Install [cloudflared](https://developers.cloudflare.com/tunnel/downloads/) or place its executable at `.venv/bin/cloudflared`. Then run:

```bash
.venv/bin/python tunnel.py --email you@example.com
```

The launcher starts TubeDrop if needed and prints a temporary `trycloudflare.com` address. Visitors must verify the allowed email address with a one-time PIN. Add another `--email address@example.com` to grant a second person access. Press Ctrl+C to close the tunnel. Keep the terminal open while using it.

Quick Tunnel addresses change each time. For a stable hostname, configure a [named Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/) with the local service URL `http://127.0.0.1:8765` and protect the route with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/setup/secure-private-apps/private-web-app/).
