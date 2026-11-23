"""Match public Apple Music playlist metadata to YouTube and optionally import audio."""
import argparse
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import yt_dlp

ROOT = Path(__file__).resolve().parent
DEFAULT_URL = "https://music.apple.com/us/playlist/the-jar-rod/pl.u-kv9lbZJTJplpWq2"


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.collect = False
        self.data = ""

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("id") == "serialized-server-data":
            self.collect = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.collect = False

    def handle_data(self, data):
        if self.collect:
            self.data += data


def apple_tracks(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "music.apple.com" or "/playlist/" not in parsed.path:
        raise ValueError("Use an HTTPS music.apple.com playlist URL")
    response = urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20)
    parser = Scripts()
    parser.feed(response.read(4_000_000).decode("utf-8"))
    if not parser.data:
        raise ValueError("Apple did not expose playlist track data; make sure the playlist is public")
    page = json.loads(parser.data)
    lists = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("itemKind") == "trackLockup" and isinstance(node.get("items"), list):
                lists.append(node["items"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(page)
    if not lists:
        raise ValueError("No tracks found on the public playlist page")
    tracks = []
    for item in max(lists, key=len):
        if not isinstance(item, dict) or not item.get("title"):
            continue
        artists = item.get("subtitleLinks") or []
        artist = artists[0].get("title", "") if artists else ""
        tracks.append({"title": item["title"], "artist": artist,
                       "duration": round((item.get("duration") or 0) / 1000),
                       "apple_id": item.get("contentDescriptor", {}).get("identifiers", {}).get("storeAdamID")})
    return tracks


def normalized(text):
    text = unicodedata.normalize("NFKD", text.casefold())
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in text if not unicodedata.combining(c))).strip()


def core_title(title):
    return re.sub(r"\s*\((?:with |\d{4} remaster)[^)]+\)", "", title, flags=re.I).strip()


def score(track, video):
    title = normalized(video.get("title") or "")
    artist = normalized(track["artist"])
    song = normalized(core_title(track["title"]))
    if not title or not song or not artist:
        return 0
    if any(word in title.split() for word in ("cover", "karaoke", "reaction", "tutorial")):
        return 0
    if any(word in title.split() for word in ("live", "remix", "instrumental")) and not any(word in song.split() for word in ("live", "remix", "instrumental")):
        return 0
    title_match = SequenceMatcher(None, song, title).ratio()
    phrase_match = song in title
    channel = normalized(video.get("channel") or "")
    artist_core = re.sub(r"^the ", "", artist)
    artist_match = (artist in title or artist_core in title
                    or artist in channel or artist_core in channel
                    or artist.replace(" ", "") in channel.replace(" ", ""))
    duration = video.get("duration") or 0
    delta = abs(duration - track["duration"]) if duration and track["duration"] else 999
    duration_score = 25 if delta <= 5 else 15 if delta <= 12 else 0 if delta <= 30 else -35
    return round((50 if phrase_match else title_match * 40) + (25 if artist_match else -20) + duration_score)


def candidates(ydl, track):
    song = core_title(track["title"])
    query = f"ytsearch5:{track['artist']} {song} official audio"
    data = ydl.extract_info(query, download=False)
    found = []
    for item in (data or {}).get("entries") or []:
        if not item or not re.fullmatch(r"[A-Za-z0-9_-]{11}", str(item.get("id", ""))):
            continue
        found.append({"title": item.get("title"), "channel": item.get("channel"),
                      "duration": item.get("duration"), "url": f"https://www.youtube.com/watch?v={item['id']}",
                      "score": score(track, item)})
    return sorted(found, key=lambda c: c["score"], reverse=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default=DEFAULT_URL)
    parser.add_argument("--download", action="store_true", help="Download high-confidence matches")
    parser.add_argument("--min-score", type=int, default=85)
    args = parser.parse_args()
    tracks = apple_tracks(args.url)
    print(f"Found {len(tracks)} Apple Music tracks", flush=True)
    report = []
    output = ROOT / "apple-matches.json"
    try:
        previous = json.loads(output.read_text())
        cached = {row["apple"]["apple_id"]: row for row in previous["tracks"] if row.get("apple")}
    except (FileNotFoundError, ValueError, KeyError, TypeError):
        previous = {"tracks": [], "playlists": []}
        cached = {}
    options = {"quiet": True, "extract_flat": "in_playlist", "skip_download": True,
               "socket_timeout": 15, "js_runtimes": {"node": {}}}
    with yt_dlp.YoutubeDL(options) as ydl:
        for number, track in enumerate(tracks, 1):
            try:
                old = cached.get(track["apple_id"])
                choices = old["candidates"] if old and old["apple"] == track and old.get("candidates") else candidates(ydl, track)
                choices = sorted(({**choice, "score": score(track, choice)} for choice in choices),
                                 key=lambda choice: choice["score"], reverse=True)
                manual_url = old.get("manual_best_url") if old else None
                best = next((choice for choice in choices if choice["url"] == manual_url), None) if manual_url else None
                best = best or (choices[0] if choices else None)
                status = "ready" if best and (manual_url or best["score"] >= args.min_score) else "review"
                row = {"apple": track, "status": status, "best": best, "candidates": choices}
                if manual_url:
                    row["manual_best_url"] = manual_url
                report.append(row)
                print(f"{number}/{len(tracks)} {track['artist']} — {track['title']}: {status} "
                      f"({best['score'] if best else 0}) {best['title'] if best else 'no result'}", flush=True)
            except Exception as exc:
                report.append({"apple": track, "status": "error", "error": str(exc)})
                print(f"{number}/{len(tracks)} lookup failed: {exc}", flush=True)
    current_ids = {row["apple"]["apple_id"] for row in report}
    retained = [row for row in previous.get("tracks", [])
                if row.get("apple", {}).get("apple_id") not in current_ids]
    playlists = list(dict.fromkeys([*previous.get("playlists", [previous.get("playlist")]), args.url]))
    output.write_text(json.dumps({"playlist": args.url, "playlists": playlists,
                                  "tracks": retained + report}, indent=2, ensure_ascii=False) + "\n")
    print(f"Review matches in {output}", flush=True)
    if args.download:
        destination = ROOT / "music" / "apple-import"
        destination.mkdir(parents=True, exist_ok=True)
        with yt_dlp.YoutubeDL({"format": "bestaudio/best", "outtmpl": str(destination / "%(id)s.%(ext)s"),
                               "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
                               "download_archive": str(ROOT / "downloaded.txt"), "noplaylist": True,
                               "js_runtimes": {"node": {}}, "quiet": False}) as ydl:
            for row in report:
                if row["status"] == "ready":
                    try:
                        ydl.download([row["best"]["url"]])
                    except Exception as exc:
                        print(f"Download failed for {row['apple']['title']}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
