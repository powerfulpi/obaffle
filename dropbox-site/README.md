# Drop Zone

Private upload gallery for this server. Uploads require a passcode. Anyone with a unique file URL can download that file. Files and metadata stay in `data/`.

## Start locally

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
DROP_PASSWORD='choose-a-long-passcode' DROP_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')" .venv/bin/gunicorn -b 127.0.0.1:3005 app:app
```

Open `http://127.0.0.1:3005/app` for local development. The included service binds to localhost and is reached from elsewhere through the existing Cloudflare Tunnel at `https://drop.shantry.com/app`. Store persistent `DROP_PASSWORD` and `DROP_SECRET` in a private `.env` and install `drop-zone.service` under `~/.config/systemd/user/`. `DROP_HTTPS=1` is set for the public service. The Cloudflare tunnel's published application route points `drop.shantry.com` to `http://127.0.0.1:3005`. Share links use the public HTTPS hostname.

The browser uploads in 8 MB pieces, with progress shown on the page. Files can be up to 2 GB each. The older plain form upload remains as a fallback for small files, with a 512 MB request limit; Cloudflare may impose a lower single-request limit. Deleting a file also invalidates its link. Back up `data/` to preserve uploads and links. Incomplete uploads are removed after 24 hours when the app starts.

Files can be organized into nested folders. Uploads go into the folder currently open. Use **Rename / move** beside a file or folder to change its name or destination. File share links keep working after rename or move. A folder must be empty before it can be deleted. Existing files from before folders were added stay in **All files**.

Each file's three-dot menu has **Copy internal file location**. It copies an absolute path under `data/library/` with the original filename and extension, suitable for a CD burning program running on this server. The path points to the stored original file. Renaming a file changes this local path; moving it between site folders does not. A program on another computer cannot open this server-local path directly.

Images, audio, video, and PDFs are served directly at `https://drop.shantry.com/<filename>`; files in folders also work at `/<folder>/<filename>`. Use **Copy media link** to share a direct file URL that can embed in apps such as Discord. A filename that is unique across the library can be used at the root URL even when its file sits in a folder. Duplicate names need the folder path or the unique `/preview/<file-token>` URL. Other file types redirect to a download. **Copy download link** uses `/f/<file-token>`, which always downloads and survives renames and moves. Filename media URLs change when a file or folder is renamed or moved. Since filenames are guessable, treat these media URLs as public; use a random token URL when you need an unguessable URL.

Large GIFs get a smaller GIF for media links so they can fit in chat previews; download links always return the original. GIF conversion needs `ffmpeg`. The first view of an older large GIF may take a few seconds while its smaller copy is made.

The homepage and login response send `Cache-Control: private, no-store`. If Cloudflare previously cached the root URL before these headers were added, purge `https://drop.shantry.com/` from Cloudflare's cache once; the root path then redirects to `/app`.
