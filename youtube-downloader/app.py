#!/usr/bin/env python3
"""Local YouTube download queue. Run with: python app.py"""

import json
import importlib.util
import hmac
import os
import re
import secrets
import signal
import shutil
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

ROOT = Path(__file__).resolve().parent
OUTPUT = Path(os.environ.get("YTDL_OUTPUT", str(Path.home() / "Downloads" / "YouTube"))).expanduser().resolve()
HOST = "127.0.0.1"
PORT = int(os.environ.get("YTDL_PORT", "8765"))
PASSWORD = os.environ.get("YTDL_PASSWORD", "")
JOBS = {}
LOCK = threading.Lock()
SESSIONS = {}
FAILURES = {}
ALLOWED = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}


def downloader_available():
    return importlib.util.find_spec("yt_dlp") is not None or shutil.which("yt-dlp") is not None


def valid_url(value):
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and parsed.hostname in ALLOWED and bool(parsed.path.strip("/"))
    except (TypeError, ValueError):
        return False


def command(job):
    executable = [sys.executable, "-m", "yt_dlp"] if importlib.util.find_spec("yt_dlp") else ["yt-dlp"]
    args = executable + ["--newline", "--progress", "--no-simulate", "--ignore-errors", "--no-overwrites", "--windows-filenames",
            "--restrict-filenames", "--embed-metadata", "--print", "before_dl:TUBEDROP_ID:%(id)s",
            "--print", "after_move:TUBEDROP_FILE:%(id)s:%(filepath)s",
            "--paths", str(OUTPUT), "--output", "%(playlist_title|Singles)s/%(playlist_index|00)s - %(title).180B [%(id)s].%(ext)s"]
    if not job["playlist"]:
        args.append("--no-playlist")
    if job["format"] == "mp3":
        args += ["--extract-audio", "--audio-format", "mp3", "--audio-quality", job["quality"], "--embed-thumbnail"]
    else:
        height = job["quality"]
        args += ["--format", f"bv*[height<={height}][ext=mp4]+ba[ext=m4a]/b[height<={height}][ext=mp4]/bv*[height<={height}]+ba/b",
                 "--merge-output-format", "mp4", "--recode-video", "mp4"]
    return args + [job["url"]]


def run_job(job):
    with LOCK:
        job["status"] = "running"
    try:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen(command(job), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, errors="replace", bufsize=1, start_new_session=True)
        with LOCK:
            job["process"] = proc
        for line in proc.stdout:
            line = line.strip()
            if line:
                with LOCK:
                    job["log"].append(line[-500:])
                    if line.startswith("TUBEDROP_ID:"):
                        job["ids"].add(line[len("TUBEDROP_ID:"):])
                    if line.startswith("TUBEDROP_FILE:"):
                        item_id, _, filename = line[len("TUBEDROP_FILE:"):].partition(":")
                        job["reported_ids"].add(item_id)
                        path = Path(filename).resolve()
                        if path.is_relative_to(OUTPUT) and path.is_file() and path.suffix.lower() == "." + job["format"]:
                            job["files"].append(str(path.relative_to(OUTPUT)))
                    match = re.search(r"\[download\]\s+([\d.]+)%", line)
                    if match:
                        job["progress"] = float(match.group(1))
                    if line.startswith("[download] Destination:"):
                        job["current"] = line.partition(": ")[2]
        code = proc.wait()
        with LOCK:
            for path in OUTPUT.rglob(f"*.{job['format']}"):
                if (path.is_file() and path.resolve().is_relative_to(OUTPUT)
                        and any(path.name.endswith(f"[{item_id}].{job['format']}") for item_id in job["ids"] - job["reported_ids"])):
                    job["files"].append(str(path.relative_to(OUTPUT)))
            job["files"] = list(dict.fromkeys(job["files"]))
            job["status"] = "cancelled" if job["cancelled"] else ("done" if code == 0 and job["files"] else "error")
            job["process"] = None
    except Exception as exc:
        with LOCK:
            job["status"] = "error"
            job["log"].append(str(exc))


class Handler(BaseHTTPRequestHandler):
    def authorized(self):
        if not PASSWORD:
            return True
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookie["tubedrop_session"].value
            with LOCK:
                expiry = SESSIONS.get(token, 0)
            return expiry > time.time()
        except (KeyError, ValueError):
            return False

    def require_auth(self):
        if self.authorized():
            return False
        self.send_response(401)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()
        return True

    def send_page(self, filename):
        body = (ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            return self.send_page("index.html" if self.authorized() else "login.html")
        if self.require_auth():
            return
        if self.path == "/api/session":
            self.send_json(200, {"authenticated": True})
        elif self.path == "/api/jobs":
            with LOCK:
                jobs = [{k: (list(v) if k == "log" else v) for k, v in job.items()
                         if k not in ("process", "ids", "reported_ids")} for job in reversed(list(JOBS.values()))]
            self.send_json(200, {"jobs": jobs, "output": str(OUTPUT),
                                 "ready": downloader_available() and shutil.which("ffmpeg") is not None})
        elif self.path == "/api/files":
            files = []
            if OUTPUT.exists():
                for path in OUTPUT.rglob("*"):
                    if path.is_file() and path.resolve().is_relative_to(OUTPUT) and path.suffix.lower() in (".mp3", ".mp4"):
                        stat = path.stat()
                        files.append({"name": str(path.relative_to(OUTPUT)), "size": stat.st_size,
                                      "modified": stat.st_mtime})
            files.sort(key=lambda item: item["modified"], reverse=True)
            self.send_json(200, {"files": files[:200]})
        elif self.path.startswith("/api/jobs/") and self.path.endswith("/zip"):
            job_id = self.path[len("/api/jobs/"):-len("/zip")]
            with LOCK:
                job = JOBS.get(job_id)
                names = list(job["files"]) if job and job["status"] == "done" else []
            paths = [(OUTPUT / name).resolve() for name in names]
            paths = [p for p in paths if p.is_relative_to(OUTPUT) and p.is_file() and p.suffix.lower() in (".mp3", ".mp4")]
            if not paths:
                return self.send_error(404)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="TubeDrop-{job_id[:8]}.zip"')
            self.send_header("Cache-Control", "private, no-store")
            self.end_headers()
            try:
                with zipfile.ZipFile(self.wfile, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                    for path in paths:
                        archive.write(path, arcname=str(path.relative_to(OUTPUT)))
            except (BrokenPipeError, ConnectionResetError):
                pass
        elif self.path.startswith("/files/"):
            path = (OUTPUT / unquote(self.path[len("/files/"):].split("?", 1)[0])).resolve()
            if not path.is_relative_to(OUTPUT) or not path.is_file() or path.suffix.lower() not in (".mp3", ".mp4"):
                return self.send_error(404)
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg" if path.suffix.lower() == ".mp3" else "video/mp4")
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(path.name))
            self.send_header("Content-Length", str(path.stat().st_size))
            self.send_header("Cache-Control", "private, no-store")
            self.end_headers()
            with path.open("rb") as stream:
                shutil.copyfileobj(stream, self.wfile)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/api/login":
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size < 1 or size > 1024:
                    return self.send_json(400, {"error": "Invalid request"})
                supplied = str(json.loads(self.rfile.read(size)).get("password", ""))
            except (ValueError, AttributeError):
                return self.send_json(400, {"error": "Invalid request"})
            ip = self.headers.get("CF-Connecting-IP", self.client_address[0])
            now = time.time()
            with LOCK:
                recent = [t for t in FAILURES.get(ip, []) if now - t < 300]
                FAILURES[ip] = recent
                limited = len(recent) >= 10
            if limited:
                return self.send_json(429, {"error": "Too many attempts. Try again in a few minutes."})
            if not PASSWORD or not hmac.compare_digest(supplied, PASSWORD):
                with LOCK:
                    FAILURES[ip].append(now)
                return self.send_json(401, {"error": "Incorrect password"})
            token = secrets.token_urlsafe(32)
            with LOCK:
                SESSIONS[token] = now + 7 * 86400
                FAILURES.pop(ip, None)
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
            self.send_header("Set-Cookie", f"tubedrop_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800{secure}")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.require_auth():
            return
        if self.path == "/api/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            with LOCK:
                if "tubedrop_session" in cookie:
                    SESSIONS.pop(cookie["tubedrop_session"].value, None)
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", "tubedrop_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path not in ("/api/jobs", "/api/cancel"):
            return self.send_error(404)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 4096:
                return self.send_json(400, {"error": "Invalid request size"})
            data = json.loads(self.rfile.read(size))
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "Invalid JSON"})
        if self.path == "/api/cancel":
            with LOCK:
                job = JOBS.get(data.get("id"))
                if not job or job["status"] not in ("running", "queued"):
                    return self.send_json(404, {"error": "Active job not found"})
                job["cancelled"] = True
                proc = job["process"]
                if proc:
                    os.killpg(proc.pid, signal.SIGTERM)
                else:
                    job["status"] = "cancelled"
            return self.send_json(200, {"ok": True})
        url = str(data.get("url", "")).strip()
        fmt = data.get("format")
        quality = str(data.get("quality", ""))
        if not valid_url(url) or fmt not in ("mp3", "mp4") or quality not in (("0", "2", "5", "128K", "192K", "320K") if fmt == "mp3" else ("360", "480", "720", "1080", "1440", "2160")):
            return self.send_json(400, {"error": "Check the YouTube URL, format, and quality"})
        if not downloader_available() or not shutil.which("ffmpeg"):
            return self.send_json(503, {"error": "Install yt-dlp and FFmpeg first; see README.md"})
        job = {"id": uuid.uuid4().hex, "url": url, "format": fmt, "quality": quality,
               "playlist": data.get("playlist") is True, "status": "queued", "progress": 0,
               "current": "", "log": deque(maxlen=80), "files": [], "ids": set(), "reported_ids": set(), "cancelled": False, "process": None}
        with LOCK:
            JOBS[job["id"]] = job
        threading.Thread(target=run_job, args=(job,), daemon=True).start()
        self.send_json(201, {"id": job["id"]})


if __name__ == "__main__":
    print(f"Open http://{HOST}:{PORT} — downloads: {OUTPUT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
