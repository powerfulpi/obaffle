"""Small local-file web radio. Run with python3 radio/server.py."""
import json
import base64
import hashlib
import os
import queue
import random
import re
import subprocess
import threading
import time
import logging
import wave
import hmac
import secrets
import shutil
from http.cookies import CookieError, SimpleCookie
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

ROOT = Path(__file__).resolve().parent
MUSIC = ROOT / "music"
EDUCATION = MUSIC / "education"
ANNOUNCEMENTS = ROOT / "announcements"
HLS = ROOT / "hls"
HOST_CACHE = ROOT / "host-cache"
SETTINGS = ROOT / "settings.json"
EXTENSIONS = {".mp3", ".flac", ".wav", ".ogg", ".m4a", ".opus"}
PORT = int(os.getenv("RADIO_PORT", "3004"))
ADMIN_PASSWORD = os.getenv("RADIO_ADMIN_PASSWORD", "")
auth_lock = threading.Lock()
sessions = {}
failed_logins = {}
preview_lock = threading.Lock()
VOICE_ID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z")


def clean_title(title):
    """Drop release and recording notes from the end of a song title."""
    note = r"(?:remaster(?:ed)?|remix|mix|version|edit|deluxe|anniversary|reissue|live|mono|stereo|with\s+.+|feat\.?\s+.+|featuring\s+.+)"
    title = title.strip()
    while True:
        cleaned = re.sub(rf"\s*(?:\([^()]*\b{note}\b[^()]*\)|\[[^\[\]]*\b{note}\b[^\[\]]*\]|[-–—]\s*(?:\d{{4}}\s+)?{note}\b.*)$", "", title, flags=re.I).strip()
        if cleaned == title or not cleaned:
            return title
        title = cleaned


def load_settings():
    try:
        value = json.loads(SETTINGS.read_text())
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, OSError, ValueError, TypeError):
        pass
    return {}


class Station:
    def __init__(self):
        self.lock = threading.Lock()
        self.listeners = set()
        self.requests = []
        self.recent = []
        self.current = None
        self.started = 0
        self.last_announcement = 0
        self.host_text = None
        self.host_sequence = 0
        self.host_history = []
        self.host_error = None
        self.phase = "starting"
        self.process = None
        self.skip_requested = False
        self.match_cache = {}
        settings = load_settings()
        self.announcements_enabled = settings.get("announcements_enabled") is not False
        self.disabled_tracks = {track for track in settings.get("disabled_tracks", [])
                                if isinstance(track, str)} if isinstance(settings.get("disabled_tracks", []), list) else set()
        self.active_pool = settings.get("active_pool") if settings.get("active_pool") in {"main", "education"} else "main"
        configured_voice = settings.get("voice_id")
        self.voice_id = configured_voice.lower() if isinstance(configured_voice, str) and VOICE_ID.fullmatch(configured_voice) else os.getenv("RADIO_CARTESIA_VOICE_ID", "")

    def save_settings(self):
        temporary = SETTINGS.with_suffix(".tmp")
        temporary.write_text(json.dumps({"announcements_enabled": self.announcements_enabled,
                                         "disabled_tracks": sorted(self.disabled_tracks),
                                         "active_pool": self.active_pool,
                                         "voice_id": self.voice_id}) + "\n")
        os.replace(temporary, SETTINGS)

    def set_voice_id(self, voice_id):
        with self.lock:
            old = self.voice_id
            self.voice_id = voice_id.lower()
            try:
                self.save_settings()
            except OSError:
                self.voice_id = old
                raise

    def set_announcements_enabled(self, enabled):
        with self.lock:
            old = self.announcements_enabled
            self.announcements_enabled = enabled
            try:
                self.save_settings()
            except OSError:
                self.announcements_enabled = old
                raise
            process = self.process if not enabled and self.phase in {"host", "transition", "announcement"} else None
        if process and process.poll() is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass

    def tracks(self):
        return sorted(p for p in MUSIC.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS)

    def pool_for(self, path):
        return "education" if path.relative_to(MUSIC).parts[0] == "education" else "main"

    def playable_tracks(self):
        with self.lock:
            disabled = self.disabled_tracks.copy()
            pool = self.active_pool
        return [p for p in self.tracks() if self.pool_for(p) == pool
                and p.relative_to(MUSIC).as_posix() not in disabled]

    def set_active_pool(self, pool):
        with self.lock:
            old_pool = self.active_pool
            old_requests = self.requests.copy()
            self.active_pool = pool
            self.requests.clear()
            try:
                self.save_settings()
            except OSError:
                self.active_pool = old_pool
                self.requests = old_requests
                raise

    def set_track_enabled(self, track_id, enabled):
        with self.lock:
            old = self.disabled_tracks.copy()
            old_requests = self.requests.copy()
            if enabled:
                self.disabled_tracks.discard(track_id)
            else:
                self.disabled_tracks.add(track_id)
                self.requests = [p for p in self.requests if p.relative_to(MUSIC).as_posix() != track_id]
            try:
                self.save_settings()
            except OSError:
                self.disabled_tracks = old
                self.requests = old_requests
                raise

    def set_all_tracks_enabled(self, enabled):
        ids = {p.relative_to(MUSIC).as_posix() for p in self.tracks()}
        with self.lock:
            old = self.disabled_tracks.copy()
            old_requests = self.requests.copy()
            self.disabled_tracks = set() if enabled else self.disabled_tracks | ids
            if not enabled:
                self.requests.clear()
            try:
                self.save_settings()
            except OSError:
                self.disabled_tracks = old
                self.requests = old_requests
                raise

    def schedule(self):
        try:
            data = json.loads((ROOT / "schedule.json").read_text())
            return data if isinstance(data, list) else []
        except (FileNotFoundError, ValueError):
            return []

    def active_folder(self):
        hour = datetime.now().hour
        for block in self.schedule():
            try:
                start, end = int(block["start"]), int(block["end"])
                folder = str(block["folder"])
                if not (0 <= start <= 23 and 0 <= end <= 24) or Path(folder).is_absolute() or ".." in Path(folder).parts:
                    continue
                if (start <= hour < end if start < end else hour >= start or hour < end):
                    return folder
            except (KeyError, TypeError, ValueError):
                continue
        return None

    def next_track(self):
        tracks = self.playable_tracks()
        with self.lock:
            while self.requests:
                requested = self.requests.pop(0)
                if requested in tracks:
                    return requested, True
        folder = self.active_folder()
        eligible = [p for p in tracks if p.relative_to(MUSIC).parts[0] == folder] if folder else tracks
        if not eligible:
            eligible = tracks
        if not eligible:
            return None
        fresh = [p for p in eligible if p not in self.recent[-min(10, len(eligible) - 1):]]
        return random.choice(fresh or eligible), False

    def label(self, path):
        match = self.match_index().get(path.stem)
        if match:
            return match[0]
        return path.stem.replace("_", " ")

    def match_index(self):
        index = {}
        for report, origin in (("apple-matches.json", "apple"),
                               ("spotify-matches.json", "spotify")):
            file = ROOT / report
            try:
                stamp = file.stat().st_mtime_ns
                cached = self.match_cache.get(report)
                if cached and cached[0] == stamp:
                    index.update(cached[1])
                    continue
                matches = json.loads(file.read_text())["tracks"]
                found = {}
                for row in matches:
                    url = (row.get("best") or {}).get("url", "")
                    item = row.get(origin)
                    if url and item and "v=" in url:
                        found[url.split("v=")[-1]] = (
                            f"{item['artist']} — {clean_title(item['title'])}", url)
                self.match_cache[report] = stamp, found
                index.update(found)
            except (FileNotFoundError, ValueError, KeyError, TypeError, OSError):
                continue
        return index

    def make_host_segment(self, previous, next_track, requested, *, output=None, sequence=None, live=True):
        HOST_CACHE.mkdir(exist_ok=True)
        output = output or HOST_CACHE / "latest.wav"
        output.unlink(missing_ok=True)
        Path(str(output) + ".txt").unlink(missing_ok=True)
        Path(str(output) + ".json").unlink(missing_ok=True)
        payload = {"previous": self.label(previous) if previous else None,
                   "next": self.label(next_track), "requested": requested,
                   "sequence": self.host_sequence if sequence is None else sequence}
        if live:
            self.host_sequence += 1
        started = time.monotonic()
        with self.lock:
            voice_id = self.voice_id
        try:
            result = subprocess.run(
                ["node", str(ROOT / "host.mjs"), str(output)],
                input=json.dumps(payload), text=True, capture_output=True,
                timeout=90, cwd=ROOT,
                env={**os.environ, "RADIO_CARTESIA_VOICE_ID": voice_id},
            )
            if result.returncode or not output.is_file() or output.stat().st_size < 44:
                error = result.stderr[-500:] or "No audio returned"
                logging.warning("Radio host failed: %s", error)
                if live:
                    with self.lock:
                        self.host_error = error
                return None
            if live:
                text = Path(str(output) + ".txt").read_text()
                meta = json.loads(Path(str(output) + ".json").read_text())
                meta.update({"text": text, "generation_seconds": round(time.monotonic() - started, 2)})
                with self.lock:
                    self.host_text = text
                    self.host_error = None
                    self.host_history.append(meta)
                    self.host_history = self.host_history[-10:]
            return output
        except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            logging.warning("Radio host unavailable: %s", error)
            if live:
                with self.lock:
                    self.host_error = str(error)
            return None

    def broadcast(self, chunk):
        with self.lock:
            for listener in list(self.listeners):
                try:
                    listener.put_nowait(chunk)
                except queue.Full:
                    self.listeners.discard(listener)

    def stream_ffmpeg(self, command, display, phase):
        with self.lock:
            self.current = display.relative_to(ROOT).as_posix()
            self.started = time.time()
            self.phase = phase
        try:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError as error:
            logging.warning("Audio encoder unavailable: %s", error)
            return False
        with self.lock:
            self.process = process
            if self.skip_requested:
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
        try:
            while chunk := process.stdout.read(4096):
                self.broadcast(chunk)
        finally:
            process.wait()
            with self.lock:
                if self.process is process:
                    self.process = None
        return process.returncode == 0

    def play(self, path, *, start=0, until=None, phase="song"):
        command = ["ffmpeg", "-nostdin", "-v", "error"]
        if start:
            command += ["-ss", str(start)]
        command += ["-re", "-i", str(path)]
        if until is not None:
            command += ["-t", str(until)]
        command += ["-vn", "-ac", "2", "-ar", "44100", "-b:a", "128k", "-f", "mp3", "pipe:1"]
        return self.stream_ffmpeg(command, path, phase)

    def play_transition(self, host, track, host_start, overlap):
        filter_graph = (
            f"[0:a]atrim=duration={overlap},asetpts=PTS-STARTPTS[voice];"
            f"[1:a]atrim=duration={overlap},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={overlap}[music];"
            "[music][voice]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=250[ducked];"
            "[voice][ducked]amix=inputs=2:duration=first:normalize=0,"
            "alimiter=limit=0.95:level=disabled[out]"
        )
        command = ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(host_start),
                   "-re", "-i", str(host), "-re", "-i", str(track),
                   "-filter_complex", filter_graph, "-map", "[out]", "-t", str(overlap),
                   "-ac", "2", "-ar", "44100", "-b:a", "128k", "-f", "mp3", "pipe:1"]
        return self.stream_ffmpeg(command, host, "transition")

    def skip(self):
        with self.lock:
            if self.phase not in {"generating", "host", "transition", "song"}:
                return False
            self.skip_requested = True
            process = self.process
        if process and process.poll() is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
        return True

    def run(self):
        previous = None
        while True:
            selection = self.next_track()
            if selection is None:
                with self.lock:
                    self.current = None
                    self.phase = "idle"
                time.sleep(5)
                continue
            track, requested = selection
            with self.lock:
                self.skip_requested = False
                enabled = self.announcements_enabled
                self.phase = "generating" if enabled else "preparing"
                self.current = None
                if (track.relative_to(MUSIC).as_posix() in self.disabled_tracks
                        or self.pool_for(track) != self.active_pool):
                    continue
            host = self.make_host_segment(previous, track, requested) if enabled else None
            if self.skip_requested:
                if host:
                    host.unlink(missing_ok=True)
                continue
            with self.lock:
                enabled = self.announcements_enabled
                track_disabled = (track.relative_to(MUSIC).as_posix() in self.disabled_tracks
                                  or self.pool_for(track) != self.active_pool)
            if track_disabled:
                if host:
                    host.unlink(missing_ok=True)
                continue
            if host and not enabled:
                host.unlink(missing_ok=True)
                host = None
            if host:
                try:
                    with wave.open(str(host)) as audio:
                        duration = audio.getnframes() / audio.getframerate()
                except (OSError, wave.Error) as error:
                    logging.warning("Host audio could not be read: %s", error)
                    duration = 0
                overlap = min(6.0, max(2.0, duration * 0.35)) if duration > 4 else 0
                if overlap:
                    start = duration - overlap
                    prefix_ok = self.play(host, until=start, phase="host")
                    if self.skip_requested:
                        host.unlink(missing_ok=True)
                        continue
                    with self.lock:
                        enabled = self.announcements_enabled
                    mixed = self.play_transition(host, track, start, overlap) if prefix_ok and enabled else False
                else:
                    if duration:
                        self.play(host, phase="host")
                    mixed = False
                host.unlink(missing_ok=True)
                if self.skip_requested:
                    continue
            else:
                mixed = False
            clips = sorted(p for p in ANNOUNCEMENTS.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS)
            with self.lock:
                enabled = self.announcements_enabled
            if enabled and not host and clips and time.time() - self.last_announcement > 1800:
                self.last_announcement = time.time()
                self.play(random.choice(clips), phase="announcement")
            with self.lock:
                track_disabled = (track.relative_to(MUSIC).as_posix() in self.disabled_tracks
                                  or self.pool_for(track) != self.active_pool)
            if track_disabled:
                continue
            self.play(track, start=overlap if host and mixed else 0)
            previous = track
            self.recent.append(track)
            self.recent = self.recent[-20:]


station = Station()


def hls_worker():
    HLS.mkdir(exist_ok=True)
    while True:
        for old in HLS.glob("*"):
            if old.is_file():
                old.unlink()
        process = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", f"http://127.0.0.1:{PORT}/stream.mp3",
             "-vn", "-c:a", "aac", "-b:a", "128k", "-f", "hls", "-hls_time", "6",
             "-hls_list_size", "6", "-hls_start_number_source", "epoch",
             "-hls_flags", "delete_segments+omit_endlist",
             "-hls_segment_filename", str(HLS / "seg%010d.ts"), str(HLS / "live.m3u8")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(2 if process.returncode else 1)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send(self, code, body, content_type="application/json", headers=None):
        encoded = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(encoded)

    def send_bytes(self, code, data, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def json_body(self, maximum=2048):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.close_connection = True
            raise
        if not 0 < length <= maximum:
            self.close_connection = True
            raise ValueError("Invalid body length")
        return json.loads(self.rfile.read(length))

    def same_origin(self):
        host = self.headers.get("Host", "")
        if host not in {"radio.shantry.com", f"127.0.0.1:{PORT}", f"localhost:{PORT}"}:
            return False
        return self.headers.get("Origin") in {f"https://{host}", f"http://{host}"}

    def admin_session(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        token = cookie.get("radio_admin")
        if not token:
            return None
        with auth_lock:
            session = sessions.get(token.value)
            if not session:
                return None
            if session["expires"] < time.time():
                sessions.pop(token.value, None)
                return None
            return session

    def admin_action(self):
        session = self.admin_session()
        if not session:
            self.close_connection = True
            self.send(401, json.dumps({"error": "Log in first"}))
            return None
        if not self.same_origin() or not hmac.compare_digest(
            self.headers.get("X-CSRF-Token", ""), session["csrf"]
        ):
            self.close_connection = True
            self.send(403, json.dumps({"error": "Request verification failed"}))
            return None
        return session

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/admin":
            name = "admin.html" if self.admin_session() else "admin-login.html"
            self.send(200, (ROOT / name).read_text(), "text/html; charset=utf-8")
        elif path == "/admin/api/status":
            session = self.admin_session()
            if not session:
                return self.send(401, json.dumps({"error": "Log in first"}))
            with station.lock:
                state = {"phase": station.phase, "current": station.current,
                         "started": station.started, "listeners": len(station.listeners),
                         "requests": [station.label(p) for p in station.requests],
                         "history": list(reversed(station.host_history)),
                         "announcements_enabled": station.announcements_enabled,
                         "active_pool": station.active_pool,
                         "voice_id": station.voice_id,
                         "last_host_error": station.host_error,
                         "recent": [station.label(p) for p in station.recent[-5:]],
                         "csrf": session["csrf"]}
            if state["current"] and state["current"].startswith("music/"):
                state["current_label"] = station.label(ROOT / state["current"])
            elif state["current"] and state["current"].startswith("host-cache/"):
                state["current_label"] = "Obama callout"
            else:
                state["current_label"] = state["current"]
            sources = {video_id: info[1] for video_id, info in station.match_index().items()}
            with station.lock:
                disabled = station.disabled_tracks.copy()
            try:
                state["spotify_import"] = json.loads((ROOT / "spotify-import-status.json").read_text())
            except (FileNotFoundError, ValueError, OSError):
                state["spotify_import"] = None
            state["tracks"] = [{"id": track_id, "label": station.label(p),
                                "enabled": track_id not in disabled,
                                "pool": station.pool_for(p),
                                "file": "music/" + track_id,
                                "file_url": "/admin/api/file?track=" + quote(track_id),
                                "source_url": sources.get(p.stem)}
                               for p in station.tracks()
                               for track_id in [p.relative_to(MUSIC).as_posix()]]
            self.send(200, json.dumps(state))
        elif path == "/admin/api/file":
            if not self.admin_session():
                return self.send(401, json.dumps({"error": "Log in first"}))
            track_id = parse_qs(urlparse(self.path).query).get("track", [None])[0]
            tracks = {p.relative_to(MUSIC).as_posix(): p for p in station.tracks()}
            file = tracks.get(track_id)
            if not file:
                return self.send(404, json.dumps({"error": "Track not found"}))
            try:
                source = file.open("rb")
            except OSError:
                return self.send(404, json.dumps({"error": "Audio file unavailable"}))
            with source:
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(file.stat().st_size))
                self.send_header("Cache-Control", "private, no-store")
                self.send_header("Content-Disposition", 'attachment; filename="' +
                                 re.sub(r"[^A-Za-z0-9._-]", "_", file.name) + '"')
                self.end_headers()
                try:
                    shutil.copyfileobj(source, self.wfile)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        elif path == "/admin/api/preview.wav":
            if not self.admin_session():
                return self.send(401, json.dumps({"error": "Log in first"}))
            try:
                data = (HOST_CACHE / "preview.wav").read_bytes()
            except FileNotFoundError:
                return self.send(404, json.dumps({"error": "No preview yet"}))
            self.send_bytes(200, data, "audio/wav")
        elif path == "/":
            self.send(200, (ROOT / "index.html").read_text(), "text/html; charset=utf-8")
        elif path == "/vendor/hls.light.min.js":
            self.send_bytes(200, (ROOT / "vendor" / "hls.light.min.js").read_bytes(), "text/javascript; charset=utf-8")
        elif path == "/hls/live.m3u8" or re.fullmatch(r"/hls/seg\d{10}\.ts", path):
            file = HLS / path.rsplit("/", 1)[-1]
            try:
                data = file.read_bytes()
            except FileNotFoundError:
                return self.send(404, json.dumps({"error": "Stream is starting"}))
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.apple.mpegurl" if path.endswith(".m3u8") else "video/mp2t")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        elif path == "/status":
            with station.lock:
                state = {"now_playing": station.current, "since": station.started,
                         "listeners": len(station.listeners), "requests_waiting": len(station.requests),
                         "host_text": station.host_text, "active_pool": station.active_pool}
            state["tracks"] = [p.relative_to(MUSIC).as_posix() for p in station.playable_tracks()]
            try:
                matches = json.loads((ROOT / "apple-matches.json").read_text())["tracks"]
                state["labels"] = {
                    "apple-import/" + row["best"]["url"].split("v=")[-1] + ".mp3":
                        row["apple"]["artist"] + " — " + clean_title(row["apple"]["title"])
                    for row in matches if row.get("best") and row.get("apple")
                }
            except (FileNotFoundError, ValueError, KeyError, TypeError):
                state["labels"] = {}
            self.send(200, json.dumps(state))
        elif path == "/stream.mp3":
            listener = queue.Queue(maxsize=64)
            with station.lock:
                station.listeners.add(listener)
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Cache-Control", "no-store, no-transform")
            self.end_headers()
            try:
                while True:
                    self.wfile.write(listener.get(timeout=30))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, TimeoutError, queue.Empty):
                pass
            finally:
                with station.lock:
                    station.listeners.discard(listener)
        elif path == "/live":
            key = self.headers.get("Sec-WebSocket-Key", "")
            if self.headers.get("Upgrade", "").lower() != "websocket" or not key:
                return self.send(400, json.dumps({"error": "WebSocket required"}))
            accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            self.send_response(101)
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            self.end_headers()
            listener = queue.Queue(maxsize=64)
            with station.lock:
                station.listeners.add(listener)
            try:
                while True:
                    chunk = listener.get(timeout=30)
                    length = len(chunk)
                    frame = b"\x82" + (bytes([length]) if length < 126 else b"\x7e" + length.to_bytes(2, "big")) + chunk
                    self.wfile.write(frame)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, TimeoutError, queue.Empty):
                pass
            finally:
                with station.lock:
                    station.listeners.discard(listener)
        else:
            self.send(404, json.dumps({"error": "Not found"}))

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/admin/login":
            if not ADMIN_PASSWORD:
                self.close_connection = True
                return self.send(503, json.dumps({"error": "Admin password is not configured"}))
            if not self.same_origin():
                self.close_connection = True
                return self.send(403, json.dumps({"error": "Request verification failed"}))
            address = self.headers.get("CF-Connecting-IP") or self.client_address[0]
            with auth_lock:
                if len(failed_logins) > 1000:
                    cutoff = time.time() - 600
                    for key in list(failed_logins):
                        failed_logins[key] = [stamp for stamp in failed_logins[key] if stamp > cutoff]
                        if not failed_logins[key]:
                            failed_logins.pop(key, None)
                if len(failed_logins) > 1000 and address not in failed_logins:
                    self.close_connection = True
                    return self.send(429, json.dumps({"error": "Too many login attempts"}))
                recent = [stamp for stamp in failed_logins.get(address, []) if time.time() - stamp < 600]
                failed_logins[address] = recent
                if len(recent) >= 5:
                    self.close_connection = True
                    return self.send(429, json.dumps({"error": "Too many attempts; try again later"}))
            try:
                password = self.json_body(1024).get("password")
                if not isinstance(password, str):
                    raise ValueError()
            except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
                return self.send(400, json.dumps({"error": "Enter a password"}))
            if not hmac.compare_digest(password, ADMIN_PASSWORD):
                with auth_lock:
                    failed_logins.setdefault(address, []).append(time.time())
                return self.send(401, json.dumps({"error": "Incorrect password"}))
            token = secrets.token_urlsafe(32)
            session = {"csrf": secrets.token_urlsafe(24), "expires": time.time() + 43200}
            with auth_lock:
                sessions[token] = session
                failed_logins.pop(address, None)
            self.send(200, json.dumps({"ok": True}), headers={
                "Set-Cookie": f"radio_admin={token}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=43200"
            })
            return
        if path == "/admin/api/logout":
            if not self.admin_action():
                return
            cookie = SimpleCookie()
            cookie.load(self.headers.get("Cookie", ""))
            token = cookie.get("radio_admin")
            if token:
                with auth_lock:
                    sessions.pop(token.value, None)
            return self.send(200, json.dumps({"ok": True}), headers={
                "Set-Cookie": "radio_admin=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0"
            })
        if path == "/admin/api/skip":
            if not self.admin_action():
                return
            did_skip = station.skip()
            return self.send(200 if did_skip else 409, json.dumps({"skipped": did_skip}))
        if path == "/admin/api/announcements":
            if not self.admin_action():
                return
            try:
                enabled = self.json_body(1024)["enabled"]
                if not isinstance(enabled, bool):
                    raise ValueError()
                station.set_announcements_enabled(enabled)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                return self.send(400, json.dumps({"error": "Send enabled as true or false"}))
            except OSError as error:
                logging.error("Could not save announcement setting: %s", error)
                return self.send(500, json.dumps({"error": "Could not save setting"}))
            return self.send(200, json.dumps({"announcements_enabled": enabled}))
        if path == "/admin/api/voice":
            if not self.admin_action():
                return
            try:
                voice_id = self.json_body(1024)["voice_id"]
                if not isinstance(voice_id, str) or not VOICE_ID.fullmatch(voice_id):
                    raise ValueError()
                station.set_voice_id(voice_id)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                return self.send(400, json.dumps({"error": "Enter a valid Cartesia voice ID"}))
            except OSError as error:
                logging.error("Could not save voice ID: %s", error)
                return self.send(500, json.dumps({"error": "Could not save voice ID"}))
            return self.send(200, json.dumps({"voice_id": station.voice_id}))
        if path == "/admin/api/pool":
            if not self.admin_action():
                return
            try:
                pool = self.json_body(1024)["pool"]
                if pool not in {"main", "education"}:
                    raise ValueError()
                station.set_active_pool(pool)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                return self.send(400, json.dumps({"error": "Choose Main or Education"}))
            except OSError as error:
                logging.error("Could not save active pool: %s", error)
                return self.send(500, json.dumps({"error": "Could not save pool"}))
            return self.send(200, json.dumps({"active_pool": pool}))
        if path == "/admin/api/track":
            if not self.admin_action():
                return
            try:
                body = self.json_body(1024)
                track_id, enabled = body["track"], body["enabled"]
                if not isinstance(track_id, str) or not isinstance(enabled, bool):
                    raise ValueError()
                if track_id not in {p.relative_to(MUSIC).as_posix() for p in station.tracks()}:
                    return self.send(404, json.dumps({"error": "Track not found"}))
                station.set_track_enabled(track_id, enabled)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                return self.send(400, json.dumps({"error": "Send a valid track and enabled setting"}))
            except OSError as error:
                logging.error("Could not save track setting: %s", error)
                return self.send(500, json.dumps({"error": "Could not save setting"}))
            return self.send(200, json.dumps({"track": track_id, "enabled": enabled}))
        if path == "/admin/api/tracks/all":
            if not self.admin_action():
                return
            try:
                enabled = self.json_body(1024)["enabled"]
                if not isinstance(enabled, bool):
                    raise ValueError()
                station.set_all_tracks_enabled(enabled)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                return self.send(400, json.dumps({"error": "Send enabled as true or false"}))
            except OSError as error:
                logging.error("Could not save track settings: %s", error)
                return self.send(500, json.dumps({"error": "Could not save settings"}))
            return self.send(200, json.dumps({"enabled": enabled}))
        if path == "/admin/api/preview":
            if not self.admin_action():
                return
            try:
                body = self.json_body()
                track_id = body["track"]
                style = body["style"]
                styles = {"weather": 0, "music": 1, "listener": 2, "clock": 3, "wildcard": 4, "longer": 5, "request": 1}
                tracks = {p.relative_to(MUSIC).as_posix(): p for p in station.tracks()}
                if not isinstance(track_id, str) or track_id not in tracks or style not in styles:
                    raise ValueError()
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                return self.send(400, json.dumps({"error": "Choose a track and callout style"}))
            if not preview_lock.acquire(blocking=False):
                return self.send(409, json.dumps({"error": "A preview is already generating"}))
            try:
                with station.lock:
                    previous = station.recent[-1] if station.recent else None
                output = station.make_host_segment(previous, tracks[track_id], style == "request",
                                                   output=HOST_CACHE / "preview.wav",
                                                   sequence=styles[style], live=False)
                if not output:
                    return self.send(502, json.dumps({"error": "Callout generation failed; check radio service logs"}))
                metadata = json.loads(Path(str(output) + ".json").read_text())
                metadata["text"] = Path(str(output) + ".txt").read_text()
                metadata["audio"] = "/admin/api/preview.wav?ts=" + str(int(time.time()))
                return self.send(200, json.dumps(metadata))
            finally:
                preview_lock.release()
        if path != "/request":
            self.close_connection = True
            return self.send(404, json.dumps({"error": "Not found"}))
        try:
            name = self.json_body(1024)["track"]
            if not isinstance(name, str):
                raise ValueError()
            tracks = {p.relative_to(MUSIC).as_posix(): p for p in station.tracks()}
            if name not in tracks:
                return self.send(404, json.dumps({"error": "Track not found"}))
            with station.lock:
                if name in station.disabled_tracks or station.pool_for(tracks[name]) != station.active_pool:
                    return self.send(409, json.dumps({"error": "This song is turned off"}))
                if len(station.requests) >= 20 or tracks[name] in station.requests:
                    return self.send(429, json.dumps({"error": "Request queue is full or track is already queued"}))
                station.requests.append(tracks[name])
                position = len(station.requests)
            self.send(200, json.dumps({"position": position}))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            self.send(400, json.dumps({"error": "Send JSON with a valid track name"}))


if __name__ == "__main__":
    MUSIC.mkdir(exist_ok=True)
    EDUCATION.mkdir(exist_ok=True)
    ANNOUNCEMENTS.mkdir(exist_ok=True)
    threading.Thread(target=station.run, daemon=True).start()
    threading.Thread(target=hls_worker, daemon=True).start()
    print(f"Radio listening on http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
