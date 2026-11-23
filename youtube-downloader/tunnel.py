#!/usr/bin/env python3
"""Start TubeDrop and an email-protected Cloudflare Quick Tunnel."""

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("YTDL_PORT", "8765"))
LOCAL_URL = f"http://127.0.0.1:{PORT}"


def app_ready():
    try:
        with urlopen(LOCAL_URL + "/", timeout=1) as response:
            return response.status == 200 and b"TubeDrop" in response.read(4096)
    except (URLError, TimeoutError):
        return False


def main():
    parser = argparse.ArgumentParser(description="Start an email-protected Cloudflare tunnel for TubeDrop")
    parser.add_argument("--email", action="append", required=True,
                        help="Email allowed to open the tunnel; repeat for multiple people")
    args = parser.parse_args()
    for email in args.email:
        if "@" not in email or any(c.isspace() for c in email):
            parser.error("each --email must be an email address")

    cloudflared = shutil.which("cloudflared") or str(ROOT / ".venv" / "bin" / "cloudflared")
    if not Path(cloudflared).is_file() and not shutil.which("cloudflared"):
        parser.error("cloudflared is missing; see README.md")

    app = None
    if not app_ready():
        app = subprocess.Popen([sys.executable, str(ROOT / "app.py")], cwd=ROOT)
        for _ in range(40):
            if app_ready():
                break
            if app.poll() is not None:
                parser.error("TubeDrop failed to start")
            time.sleep(0.25)
        else:
            app.terminate()
            parser.error(f"TubeDrop did not become ready at {LOCAL_URL}; check the port")

    cmd = [cloudflared, "tunnel", "--url", LOCAL_URL]
    for email in args.email:
        cmd += ["--allowed-mail", email]
    print("Starting email-protected Cloudflare Tunnel. Look for the trycloudflare.com URL below.", flush=True)
    try:
        tunnel = subprocess.Popen(cmd)
        tunnel.wait()
    except KeyboardInterrupt:
        print("\nStopping tunnel...", flush=True)
    finally:
        if "tunnel" in locals() and tunnel.poll() is None:
            tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
        if app and app.poll() is None:
            app.terminate()
            try:
                app.wait(timeout=5)
            except subprocess.TimeoutExpired:
                app.kill()


if __name__ == "__main__":
    main()
