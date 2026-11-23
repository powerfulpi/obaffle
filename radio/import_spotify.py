"""Import a public Spotify playlist's metadata using matching audio from YouTube.

Spotify audio is never fetched. The report and downloaded files are resumable.
"""
import argparse
import json
import os
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import yt_dlp

from import_apple import candidates, score

ROOT = Path(__file__).resolve().parent
REPORT = ROOT / "spotify-matches.json"
PROGRESS = ROOT / "spotify-import-status.json"
DESTINATION = ROOT / "music" / "education"
USER_AGENT = "Mozilla/5.0 (compatible; RadiObama playlist importer)"


class NextData(HTMLParser):
    def __init__(self):
        super().__init__()
        self.collect = False
        self.value = ""

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("id") == "__NEXT_DATA__":
            self.collect = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.collect = False

    def handle_data(self, data):
        if self.collect:
            self.value += data


def fetch(url, *, token=None):
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    for attempt in range(6):
        try:
            with urlopen(Request(url, headers=headers), timeout=25) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, ConnectionError, OSError) as error:
            if isinstance(error, HTTPError) and error.code in {400, 401, 403, 404}:
                raise
            if attempt == 5:
                raise
            time.sleep(min(30, 2 ** attempt))


def embed(url):
    parser = NextData()
    parser.feed(fetch(url).decode("utf-8"))
    if not parser.value:
        raise ValueError("Spotify embed did not include playlist metadata")
    return json.loads(parser.value)["props"]["pageProps"]


def playlist_id(url):
    parsed = urlparse(url)
    match = re.fullmatch(r"/playlist/([A-Za-z0-9]{22})/?", parsed.path)
    if parsed.scheme != "https" or parsed.hostname != "open.spotify.com" or not match:
        raise ValueError("Use an HTTPS open.spotify.com/playlist/... link")
    return match.group(1)


def playlist_tracks(url):
    identifier = playlist_id(url)
    page = embed(f"https://open.spotify.com/embed/playlist/{identifier}")
    token = page["state"]["settings"]["session"]["accessToken"]
    entity = page["state"]["data"]["entity"]
    first = {item["uri"]: item for item in entity["trackList"] if item.get("uri", "").startswith("spotify:track:")}
    base = f"https://spclient.wg.spotify.com/playlist/v2/playlist/{identifier}"
    uris = []
    total = None
    for offset in range(0, 100_000, 500):
        data = json.loads(fetch(f"{base}?from={offset}&length=500", token=token))
        if total is None:
            total = data["length"]
        items = data["contents"]["items"]
        uris.extend(item["uri"] for item in items if item.get("uri", "").startswith("spotify:track:"))
        print(f"Playlist metadata: {min(offset + len(items), total)}/{total}", flush=True)
        if offset + len(items) >= total:
            break
        if not items:
            raise ValueError("Spotify stopped returning playlist items")
    if len(uris) != total:
        print(f"Skipped {total - len(uris)} unavailable or non-track playlist items", flush=True)
    return entity["title"], uris, first


def track_metadata(uri, first):
    if uri in first:
        item = first[uri]
        return {"spotify_id": uri.rsplit(":", 1)[-1], "title": item["title"],
                "artist": item["subtitle"], "duration": round(item["duration"] / 1000)}
    identifier = uri.rsplit(":", 1)[-1]
    item = embed(f"https://open.spotify.com/embed/track/{identifier}")["state"]["data"]["entity"]
    return {"spotify_id": identifier, "title": item["title"],
            "artist": ", ".join(artist["name"] for artist in item["artists"]),
            "duration": round(item["duration"] / 1000)}


def save(report):
    temporary = REPORT.with_suffix(".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    os.replace(temporary, REPORT)
    rows = report["tracks"]
    counts = {status: sum(row.get("status") == status for row in rows)
              for status in {row.get("status") for row in rows} if status}
    progress = {"name": report["name"], "total": len(rows),
                "processed": sum(bool(row.get("status")) for row in rows), "counts": counts,
                "updated_at": int(time.time())}
    temporary = PROGRESS.with_suffix(".tmp")
    temporary.write_text(json.dumps(progress) + "\n")
    os.replace(temporary, PROGRESS)


def downloaded_path(video_id):
    return DESTINATION / f"{video_id}.mp3"


def download(ydl, row):
    url = row["best"]["url"]
    video_id = url.split("v=")[-1]
    target = downloaded_path(video_id)
    if target.is_file():
        return "already_downloaded"
    main_file = ROOT / "music" / "apple-import" / f"{video_id}.mp3"
    if main_file.is_file():
        os.link(main_file, target)
        return "linked_existing"
    ydl.download([url])
    if not target.is_file():
        raise RuntimeError("Download finished without an MP3 file")
    return "downloaded"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--min-score", type=int, default=85)
    parser.add_argument("--match-only", action="store_true")
    parser.add_argument("--max-downloads-per-run", type=int, default=100,
                        help="Pause after this many new downloads; a timer can resume later")
    args = parser.parse_args()
    title, uris, first = playlist_tracks(args.url)
    print(f"Found {len(uris)} tracks in {title}", flush=True)
    old = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    cached = {row.get("spotify", {}).get("spotify_id"): row for row in old.get("tracks", [])}
    rows = []
    for uri in uris:
        identifier = uri.rsplit(":", 1)[-1]
        rows.append(cached.get(identifier) or {"spotify": {"spotify_id": identifier}})
    report = {"playlist": args.url.split("?", 1)[0], "name": title,
              "total": len(uris), "tracks": rows}
    DESTINATION.mkdir(parents=True, exist_ok=True)
    save(report)
    search_options = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist",
                      "skip_download": True, "socket_timeout": 20, "js_runtimes": {"node": {}}}
    download_options = {"format": "bestaudio/best", "outtmpl": str(DESTINATION / "%(id)s.%(ext)s"),
                        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3",
                                            "preferredquality": "192"}], "noplaylist": True,
                        "js_runtimes": {"node": {}}, "quiet": True, "no_warnings": True,
                        "noprogress": True,
                        "socket_timeout": 20, "retries": 3, "fragment_retries": 3}
    pending = [i for i, row in enumerate(rows) if not row.get("status") or row.get("status") == "ready"]
    retries = [i for i, row in enumerate(rows) if row.get("status") in {"error", "blocked"}]
    new_downloads = 0
    with yt_dlp.YoutubeDL(search_options) as searcher, yt_dlp.YoutubeDL(download_options) as downloader:
        for index in pending + retries:
            number = index + 1
            uri, row = uris[index], rows[index]
            try:
                if not row["spotify"].get("title"):
                    row["spotify"] = track_metadata(uri, first)
                track = row["spotify"]
                if not row.get("candidates"):
                    row["candidates"] = candidates(searcher, track)
                choices = sorted(({**choice, "score": score(track, choice)} for choice in row["candidates"]),
                                 key=lambda choice: choice["score"], reverse=True)
                row["candidates"] = choices
                row["best"] = choices[0] if choices else None
                if not row["best"] or row["best"]["score"] < args.min_score:
                    row["status"] = "review"
                elif args.match_only:
                    row["status"] = "ready"
                else:
                    row["status"] = download(downloader, row)
                row.pop("error", None)
                print(f"{number}/{len(rows)} {track['artist']} — {track['title']}: {row['status']}", flush=True)
            except Exception as error:
                challenged = "Sign in to confirm" in str(error) and "bot" in str(error)
                row["status"] = "blocked" if challenged else "error"
                row["error"] = str(error)[:500]
                print(f"{number}/{len(rows)} error: {error}", file=sys.stderr, flush=True)
                if challenged:
                    save(report)
                    print("YouTube challenged this server; pausing until the next scheduled run.", flush=True)
                    return
            save(report)
            if row["status"] == "downloaded":
                new_downloads += 1
                time.sleep(5)
                if new_downloads >= args.max_downloads_per_run:
                    print(f"Paused after {new_downloads} downloads; the timer will resume later.", flush=True)
                    break
    save(report)
    counts = {status: sum(row.get("status") == status for row in rows)
              for status in {row.get("status") for row in rows}}
    print("Finished:", counts, flush=True)


if __name__ == "__main__":
    main()
