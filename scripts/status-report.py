#!/usr/bin/env python3
"""Live, bounded status summary for an interactive Obaffle login."""

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


def run(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=1.5).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def service(name, user=False):
    args = ["systemctl"] + (["--user"] if user else []) + ["is-active", name]
    return "up" if run(*args) == "active" else "down"


def fetch_json(port, path):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=1) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None


def http_up(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1):
            return True
    except urllib.error.HTTPError as error:
        return error.code < 500
    except OSError:
        return False


def duration(seconds):
    seconds = int(seconds)
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    return " ".join(f"{n}{unit}" for n, unit in ((days, "d"), (hours, "h"), (minutes, "m")) if n) or "<1m"


def track_time(seconds):
    minutes, seconds = divmod(max(0, int(seconds)), 60)
    return f"{minutes}:{seconds:02d}"


def radio_detail(state):
    current = state.get("now_playing")
    if not isinstance(current, str) or not current.startswith("music/"):
        return "No song playing"
    track_id = current.removeprefix("music/")
    label = state.get("labels", {}).get(track_id) or Path(track_id).stem.replace("_", " ")
    started = state.get("since")
    elapsed = track_time(time.time() - started) if isinstance(started, (int, float)) else "—"
    track = Path(__file__).resolve().parent.parent / "radio" / current
    total = run("ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(track)) if track.is_file() else ""
    try:
        length = f" / {track_time(float(total))}"
    except ValueError:
        length = ""
    timing = f"{elapsed}{length}"
    return f"{label[:max(1, 45 - len(timing))]} · {timing}"


def mib(value):
    return f"{value / 1048576:.1f} GiB"


COLOR = sys.stdout.isatty() and os.environ.get("TERM") not in (None, "", "dumb") and "NO_COLOR" not in os.environ
WIDTH = 78


def style(value, code):
    return f"\033[{code}m{value}\033[0m" if COLOR else value


def frame(value=""):
    visible = len(re.sub(r"\033\[[0-9;]*m", "", value))
    print(style("  │", "36") + " " + value + " " * max(0, WIDTH - visible - 1) + style("│", "36"))


def section(title):
    frame(style(f" {title.upper()} ", "1;36") + style("─" * (WIDTH - len(title) - 3), "36"))


def line(name, state, detail=""):
    badge = style("● UP  ", "1;32") if state == "up" else style("● DOWN", "1;31")
    frame(f"  {name:<18} {badge}  {style(detail, '2')}")


def bar(ratio, cells=13):
    filled = max(0, min(cells, round(ratio * cells)))
    color = "1;31" if ratio >= .9 else "1;33" if ratio >= .75 else "1;32"
    return style("█" * filled, color) + style("░" * (cells - filled), "2")


def main():
    print("\n" + style("  ╭" + "─" * WIDTH + "╮", "36"))
    frame(style("  ◈  O B A F F L E", "1;36") + "   /   SERVER STATUS")
    frame(f"  {socket.gethostname()}  •  {datetime.now().astimezone():%Y-%m-%d %H:%M %Z}")
    print(style("  ├" + "─" * WIDTH + "┤", "36"))
    try:
        host_uptime = duration(float(open("/proc/uptime", encoding="utf-8").read().split()[0]))
    except (OSError, ValueError):
        host_uptime = "unknown"
    load = os.getloadavg()
    mem = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as source:
            for row in source:
                key, _, value = row.partition(":")
                mem[key] = int(value.strip().split()[0])
    except (OSError, ValueError):
        pass
    disk = shutil.disk_usage("/")
    section("Host")
    frame(f"  Uptime  {style(host_uptime, '1')}     Load  {load[0]:.2f} / {load[1]:.2f} / {load[2]:.2f}  ({os.cpu_count()} cores)")
    if mem:
        used = mem["MemTotal"] - mem["MemAvailable"]
        frame(f"  RAM     {bar(used / mem['MemTotal'])}  {mib(used)} / {mib(mem['MemTotal'])}    Swap {mib(mem['SwapTotal'] - mem['SwapFree'])}")
    frame(f"  Disk /  {bar(disk.used / disk.total)}  {disk.used / 2**30:.1f} / {disk.total / 2**30:.1f} GiB  ({disk.used / disk.total:.0%})")
    frame()

    bots = fetch_json(3001, "/api/state") or {}
    bot_states = {bot.get("id"): bot.get("state") for bot in bots.get("bots", [])}
    discord = fetch_json(3000, "/api/stats") or {}
    section("Obaffle")
    line("Control center", "up" if bots.get("bots") else "down", "localhost:3001")
    line("Obama", "up" if bot_states.get("obama") == "running" else "down",
         f"Discord {'online' if discord.get('online') else 'unverified'} · "
         f"{discord.get('pingMs', '—')} ms  · "
         f"{''}Bot uptime {duration(discord['uptimeMs'] / 1000) if discord.get('uptimeMs') is not None else '—'}")
    line("Waffle", "up" if bot_states.get("waffle") == "running" else "down")
    frame()
    section("Other services")
    radio = fetch_json(3004, "/status")
    line("Radio", "up" if radio is not None else "down",
         radio_detail(radio) if radio is not None else "localhost:3004")
    line("Phone + tunnel", service("phone-host.service", user=True), "systemd service")
    line("Home Assistant", "up" if http_up(8123) else "down", "http://localhost:8123")
    line("SSH", service("ssh.service"))
    line("Docker engine", service("docker.service"))
    print(style("  ├" + "─" * WIDTH + "┤", "36"))
    frame("  Run obaffle-status to refresh")
    print(style("  ╰" + "─" * WIDTH + "╯", "36") + "\n")


if __name__ == "__main__":
    main()
