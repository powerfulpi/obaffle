#!/usr/bin/env python3
"""Keyboard-driven optical disc burner for Linux terminals."""

from __future__ import annotations

import curses
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from backup import BackupCancelled, backup_disc, destination_from_input
from media import MediaReport, inspect_media, parse_scan, scan_command


APP_NAME = "DISC MASTER 2000"
COMMON_LIBRARY = Path("/home/aidensmith/obaffle/dropbox-site/data/library")
SPINNER = "|/-\\"


@dataclass(frozen=True)
class Item:
    source: Path
    name: str


@dataclass(frozen=True)
class BrowserEntry:
    path: Path
    label: str
    shortcut: bool = False


def browser_entries(directory: Path, show_hidden: bool) -> list[BrowserEntry]:
    entries = [BrowserEntry(path, path.name) for path in directory.iterdir() if show_hidden or not path.name.startswith(".")]
    entries.sort(key=lambda entry: (not entry.path.is_dir(), entry.label.casefold()))
    if COMMON_LIBRARY.is_dir() and directory != COMMON_LIBRARY:
        entries.insert(0, BrowserEntry(COMMON_LIBRARY, "LIBRARY  /  dropbox-site/data/library", True))
    return entries


def optical_drives() -> list[tuple[str, str]]:
    drives = []
    for entry in sorted(Path("/sys/class/block").glob("sr*")):
        try:
            if (entry / "device/type").read_text().strip() != "5":
                continue
            device = f"/dev/{entry.name}"
            if not Path(device).exists():
                continue
            vendor = (entry / "device/vendor").read_text().strip()
            model = (entry / "device/model").read_text().strip()
            drives.append((device, f"{vendor} {model}".strip()))
        except OSError:
            continue
    return drives


def xorriso_path() -> str | None:
    installed = shutil.which("xorriso")
    if installed:
        return installed
    local = Path.home() / ".local/opt/disc-burner/usr/bin/xorriso"
    return str(local) if local.is_file() else None


def xorriso_env(xorriso: str) -> dict[str, str]:
    env = os.environ.copy()
    local = Path.home() / ".local/opt/disc-burner/usr/bin/xorriso"
    if Path(xorriso) == local:
        library_dir = local.parent.parent / "lib/x86_64-linux-gnu"
        env["LD_LIBRARY_PATH"] = str(library_dir) + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
    return env


def validate_item(path: Path, items: list[Item]) -> Item:
    source = path.expanduser().resolve(strict=True)
    if not (source.is_file() or source.is_dir()):
        raise ValueError("Choose a regular file or folder.")
    if not os.access(source, os.R_OK):
        raise ValueError("You cannot read that path.")
    name = source.name
    if not name or name in {".", ".."}:
        raise ValueError("That path has no usable disc name.")
    if any(item.source == source for item in items):
        raise ValueError("That item is already in the burn list.")
    if any(item.name.casefold() == name.casefold() for item in items):
        raise ValueError(f"Disc name '{name}' is already used. Rename one source first.")
    return Item(source, name)


def estimate_size(items: list[Item]) -> int:
    total = 0
    for item in items:
        if item.source.is_file():
            total += item.source.stat().st_size
        else:
            for root, dirs, files in os.walk(item.source, followlinks=False):
                dirs[:] = [d for d in dirs if not (Path(root) / d).is_symlink()]
                for name in files:
                    path = Path(root) / name
                    if not path.is_symlink():
                        try:
                            total += path.stat().st_size
                        except OSError:
                            pass
    return total


def human_size(size: int) -> str:
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024 or unit == "TiB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return "?"


def iso_command(xorriso: str, iso: Path, items: list[Item], label: str) -> list[str]:
    command = [xorriso, "--no_rc", "-outdev", f"stdio:{iso}", "-volid", label, "-joliet", "on", "-compliance", "iso_9660_level=3", "-file_size_limit", "400g", "--"]
    for item in items:
        command += ["-map", str(item.source), f"/{item.name}"]
    return command + ["-commit", "-end"]


def burn_command(xorriso: str, device: str, iso: Path, erase: bool = False) -> list[str]:
    command = [xorriso, "-as", "cdrecord", "--no_rc", "-v", f"dev={device}"]
    if erase:
        command.append("blank=fast")
    return command + [str(iso)]


def clip(text: str, width: int) -> str:
    return text[: max(0, width)]


class App:
    def __init__(self, screen: curses.window):
        self.screen = screen
        self.cwd = Path.home()
        self.items: list[Item] = []
        self.entries: list[BrowserEntry] = []
        self.browser_index = 0
        self.queue_index = 0
        self.browser_scroll = 0
        self.queue_scroll = 0
        self.focus = 0
        self.show_hidden = False
        self.frame = 0
        self.estimated_size = 0
        self.last_log: list[str] = []
        self.scan_results: dict[tuple[str, str, str, str, str], tuple[bool, str]] = {}
        self.message = "Ready. Space: add  Enter: open folder  P: paste path"
        self.refresh()
        curses.curs_set(0)
        screen.keypad(True)
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_WHITE, curses.COLOR_BLUE)
        curses.init_pair(2, curses.COLOR_CYAN, -1)
        curses.init_pair(3, curses.COLOR_YELLOW, -1)
        curses.init_pair(4, curses.COLOR_BLACK, curses.COLOR_CYAN)
        curses.init_pair(5, curses.COLOR_RED, -1)
        screen.timeout(140)

    def refresh(self) -> None:
        try:
            self.entries = browser_entries(self.cwd, self.show_hidden)
            self.browser_index = min(self.browser_index, max(0, len(self.entries) - 1))
        except OSError as exc:
            self.entries = []
            self.message = f"Cannot open folder: {exc.strerror}"

    def put(self, y: int, x: int, text: str, width: int, style: int = 0) -> None:
        h, w = self.screen.getmaxyx()
        if y < 0 or y >= h or x < 0 or x >= w:
            return
        available = w - x - (1 if y == h - 1 else 0)
        count = min(width, available)
        if count > 0:
            self.screen.addnstr(y, x, clip(text, count), count, style)

    def pulse(self) -> str:
        self.frame = (self.frame + 1) % 64
        return SPINNER[(self.frame // 2) % len(SPINNER)]

    def title(self, section: str, width: int) -> str:
        live = f"[ LIVE {self.pulse()} ]"
        name = f" {APP_NAME} :: {section} "
        return name[: max(0, width - len(live))].ljust(max(0, width - len(live))) + live

    def draw(self) -> None:
        s = self.screen
        s.erase()
        h, w = s.getmaxyx()
        if h < 14 or w < 62:
            self.put(0, 0, "Enlarge terminal to at least 62 x 14.", w, curses.color_pair(5))
            s.refresh()
            return
        s.bkgd(" ", curses.color_pair(1))
        s.erase()
        self.put(0, 0, self.title("DATA DECK / 01", w), w, curses.color_pair(4) | curses.A_BOLD)
        self.put(1, 1, f"PATH > {self.cwd}", w - 2, curses.color_pair(3))
        split = max(30, w * 3 // 5)
        s.vline(3, split, curses.ACS_VLINE, h - 7)
        self.put(2, 2, "01 / FILE NAVIGATOR", split - 3, curses.color_pair(2) | (curses.A_BOLD if self.focus == 0 else 0))
        self.put(2, split + 2, f"02 / WRITE SET  [{len(self.items)}]", w - split - 3, curses.color_pair(2) | (curses.A_BOLD if self.focus == 1 else 0))
        body = h - 7
        self.browser_scroll = max(0, min(self.browser_scroll, self.browser_index))
        if self.browser_index >= self.browser_scroll + body:
            self.browser_scroll = self.browser_index - body + 1
        self.queue_scroll = max(0, min(self.queue_scroll, self.queue_index))
        if self.queue_index >= self.queue_scroll + body:
            self.queue_scroll = self.queue_index - body + 1
        for row in range(body):
            index = self.browser_scroll + row
            if index < len(self.entries):
                entry = self.entries[index]
                symbol = "[LINK]" if entry.shortcut else "[DIR] " if entry.path.is_dir() else "      "
                selected = self.focus == 0 and index == self.browser_index
                style = curses.A_REVERSE if selected else curses.color_pair(3) if entry.shortcut else 0
                self.put(3 + row, 2, (symbol + " " + entry.label).ljust(split - 4), split - 4, style)
            index = self.queue_scroll + row
            if index < len(self.items):
                item = self.items[index]
                symbol = "[DIR] " if item.source.is_dir() else "      "
                selected = self.focus == 1 and index == self.queue_index
                self.put(3 + row, split + 2, (symbol + item.name).ljust(w - split - 4), w - split - 4, curses.A_REVERSE if selected else 0)
        self.put(h - 4, 1, f"WRITE BUFFER / {human_size(self.estimated_size)}   ::   ISO overhead extra", w - 2, curses.color_pair(3))
        self.put(h - 3, 1, "ARROWS Move   ENTER Open   SPACE Add   BACKSPACE Up   P Path   D Remove", w - 2)
        self.put(h - 2, 1, "I Inspect   K Backup   B Burn   E Eject   T Close tray   H Hidden   R Refresh   TAB Pane   Q Quit", w - 2)
        self.put(h - 1, 0, (" " + self.message).ljust(max(0, w - 12)), w - 11, curses.color_pair(4))
        self.put(h - 1, max(1, w - 11), f"[SYS {self.pulse()}]", 10, curses.color_pair(4) | curses.A_BOLD)
        s.refresh()

    def prompt(self, title: str) -> str | None:
        h, w = self.screen.getmaxyx()
        if h < 14 or w < 62:
            return None
        box = curses.newwin(5, w - 8, h // 2 - 2, 4)
        box.bkgd(" ", curses.color_pair(1))
        box.box()
        box.addnstr(3, 2, "Enter: OK   Esc: cancel", w - 13)
        box.timeout(140)
        value = ""
        curses.curs_set(1)
        try:
            while True:
                dots = "." * ((self.frame // 4) % 4)
                self.pulse()
                box.addnstr(1, 2, (title + dots).ljust(w - 13), w - 13, curses.color_pair(3))
                box.addnstr(2, 2, " " * (w - 12), w - 12)
                box.addnstr(2, 2, value[-(w - 13):], w - 13)
                box.move(2, min(w - 11, 2 + len(value)))
                box.refresh()
                try:
                    key = box.get_wch()
                except curses.error:
                    continue
                if key in ("\n", "\r", curses.KEY_ENTER):
                    return value.strip()
                if key == "\x1b":
                    return None
                if key in ("\b", "\x7f", curses.KEY_BACKSPACE):
                    value = value[:-1]
                elif isinstance(key, str) and key.isprintable() and len(value) < 4096:
                    value += key
        finally:
            curses.curs_set(0)

    def select_drive(self, title: str = "CHOOSE DISC WRITER") -> str | None:
        drives = optical_drives()
        if not drives:
            self.message = "No optical disc drive found."
            return None
        index = 0
        while True:
            self.draw()
            h, w = self.screen.getmaxyx()
            box = curses.newwin(min(h - 2, len(drives) + 5), min(w - 4, 72), 2, 2)
            box.bkgd(" ", curses.color_pair(1))
            box.box()
            box.addnstr(1, 2, f"{title}  (Enter select, Esc cancel)", box.getmaxyx()[1] - 4, curses.color_pair(3))
            for i, (device, model) in enumerate(drives[: box.getmaxyx()[0] - 4]):
                box.addnstr(3 + i, 2, f"{device}  {model}", box.getmaxyx()[1] - 4, curses.A_REVERSE if i == index else 0)
            box.refresh()
            box.timeout(140)
            key = box.getch()
            if key in (curses.KEY_UP, ord("k")):
                index = max(0, index - 1)
            elif key in (curses.KEY_DOWN, ord("j")):
                index = min(len(drives) - 1, index + 1)
            elif key in (10, 13, curses.KEY_ENTER):
                return drives[index][0]
            elif key in (27, ord("q")):
                return None

    def run_process(self, command: list[str], title: str, allow_cancel: bool = False) -> bool:
        lines: queue.Queue[str | None] = queue.Queue()
        result = {"code": None}
        active: list[subprocess.Popen] = []
        cancelled = False

        def worker() -> None:
            try:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1, env=xorriso_env(command[0]))
                active.append(process)
                assert process.stdout is not None
                for line in process.stdout:
                    lines.put(line.rstrip())
                result["code"] = process.wait()
            except OSError as exc:
                lines.put(str(exc))
                result["code"] = 1
            finally:
                lines.put(None)

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        log: list[str] = []
        complete = False
        self.screen.timeout(150)
        try:
            while not complete:
                try:
                    while True:
                        line = lines.get_nowait()
                        if line is None:
                            complete = True
                            break
                        if line:
                            log.append(line)
                            if len(log) > 4000:
                                log.pop(0)
                except queue.Empty:
                    pass
                self.screen.erase()
                h, w = self.screen.getmaxyx()
                self.put(0, 0, self.title(title, w), w, curses.color_pair(4))
                for i, line in enumerate(log[-max(0, h - 3):]):
                    self.put(i + 1, 1, line, w - 2)
                footer = " Esc: cancel scan " if allow_cancel else " Working" + "." * ((self.frame // 4) % 4) + " keep this terminal open "
                self.put(h - 1, 0, footer.ljust(w), w, curses.color_pair(4))
                self.screen.refresh()
                key = self.screen.getch()
                if allow_cancel and key == 27 and active and not cancelled:
                    cancelled = True
                    active[0].terminate()
        finally:
            self.screen.timeout(140)
            thread.join()
        self.last_log = log
        self.message = (f"{title} cancelled." if cancelled else f"{title} finished." if result["code"] == 0 else f"{title} FAILED (exit {result['code']}): {log[-1] if log else 'see output'}")
        if result["code"] != 0 and not cancelled:
            self.show_log(log, title)
        return result["code"] == 0 and not cancelled

    def inspect_disc(self, device: str) -> MediaReport:
        tool = xorriso_path()
        assert tool is not None
        results: queue.Queue[MediaReport] = queue.Queue(maxsize=1)
        thread = threading.Thread(target=lambda: results.put(inspect_media(tool, device, xorriso_env(tool))), daemon=True)
        thread.start()
        while thread.is_alive():
            self.message = f"READING {device}" + "." * ((self.frame // 4) % 4)
            self.draw()
            self.screen.getch()
        thread.join()
        self.message = f"Inspection complete: {device}."
        return results.get()

    def view_disc(self, report: MediaReport, for_burn: bool = False, for_backup: bool = False) -> bool:
        offset = 0
        scan = self.scan_results.get(report.fingerprint)
        while True:
            self.screen.erase()
            h, w = self.screen.getmaxyx()
            self.screen.bkgd(" ", curses.color_pair(1))
            self.screen.erase()
            self.put(0, 0, self.title("DISC INSPECTOR", w), w, curses.color_pair(4) | curses.A_BOLD)
            summary = [
                f"Drive: {report.device}    Media: {report.media_type or 'unknown'}",
                f"Status: {report.status or 'unknown'}",
                f"Media summary: {report.summary or 'unknown'}",
                f"Volume: {report.volume_id or '(none / unreadable)'}",
                "",
                "DISC NOTES / BURN STATUS:",
                *[f"  {line}" for line in report.implications],
                f"  Integrity: {scan[1] if scan else 'Catalogue only; press V for a full surface scan.'}",
                "",
                f"CONTENTS ({max(0, len(report.paths) - (1 if '/' in report.paths else 0))} entries):",
            ]
            if report.paths:
                summary += [f"  {path}" for path in report.paths if path != "/"]
            else:
                summary.append("  (none listed)")
            body = max(1, h - 3)
            offset = min(offset, max(0, len(summary) - body))
            for i, line in enumerate(summary[offset : offset + body]):
                self.put(i + 1, 1, line, w - 2, curses.color_pair(3) if line in ("DISC NOTES / BURN STATUS:",) or line.startswith("CONTENTS (") else 0)
            can_continue = (report.action != "blocked" if for_burn else bool(report.paths) and not report.catalog_error) and not (scan and not scan[0])
            footer = " Up/Down scroll  V scan  Enter continue  Esc cancel " if (for_burn or for_backup) and can_continue else " Up/Down scroll  V scan  Esc close "
            self.put(h - 1, 0, footer.ljust(w), w, curses.color_pair(4))
            self.screen.refresh()
            key = self.screen.getch()
            if key == curses.KEY_UP:
                offset = max(0, offset - 1)
            elif key == curses.KEY_DOWN:
                offset = min(max(0, len(summary) - body), offset + 1)
            elif key in (ord("v"), ord("V")):
                if "is blank" in report.status:
                    scan = (True, "Blank disc has no existing data to scan; a write can still fail.")
                else:
                    tool = xorriso_path()
                    assert tool is not None
                    done = self.run_process(scan_command(tool, report.device), "SCANNING DISC", allow_cancel=True)
                    scan = parse_scan("\n".join(self.last_log), 0 if done else 1)
                    if self.message.endswith("cancelled."):
                        scan = (False, "Surface scan cancelled; integrity unknown.")
                self.scan_results[report.fingerprint] = scan
            elif key in (10, 13, curses.KEY_ENTER) and (for_burn or for_backup) and can_continue:
                return True
            elif key in (27, ord("q"), ord("Q")):
                return False

    def inspect(self) -> None:
        if not xorriso_path():
            self.message = "xorriso missing. Install it with: sudo apt install xorriso"
            return
        device = self.select_drive()
        if device:
            self.view_disc(self.inspect_disc(device))

    def backup(self) -> None:
        tool = xorriso_path()
        if not tool:
            self.message = "xorriso missing. Install it with: sudo apt install xorriso"
            return
        device = self.select_drive("CHOOSE DISC TO BACK UP")
        if not device:
            return
        report = self.inspect_disc(device)
        if not self.view_disc(report, for_backup=True):
            self.message = "Backup cancelled or disc contents are unreadable."
            return
        raw = self.prompt("Backup location: folder or new .iso path (blank = current folder):")
        if raw is None:
            self.message = "Backup cancelled."
            return
        try:
            destination = destination_from_input(raw, self.cwd, report.volume_id)
        except (OSError, ValueError) as exc:
            self.message = f"Backup destination: {exc}"
            return
        latest = self.inspect_disc(device)
        if latest.fingerprint != report.fingerprint or not latest.paths:
            self.message = "Disc changed before backup. Inspect it and try again."
            return
        self.run_backup(tool, device, destination, report)

    def run_backup(self, tool: str, device: str, destination: Path, report: MediaReport) -> None:
        cancel = threading.Event()
        state: dict[str, object] = {"done": 0, "total": None, "stage": "Preparing disc", "result": None, "error": None}

        def update(done: int, total: int | None, stage: str) -> None:
            state.update(done=done, total=total, stage=stage)

        def worker() -> None:
            try:
                state["result"] = backup_disc(tool, device, destination, report.paths, xorriso_env(tool), update, cancel)
            except Exception as exc:
                state["error"] = exc

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        while thread.is_alive():
            self.screen.bkgd(" ", curses.color_pair(1))
            self.screen.erase()
            h, w = self.screen.getmaxyx()
            self.put(0, 0, self.title("DISC BACKUP / READ ONLY", w), w, curses.color_pair(4) | curses.A_BOLD)
            self.put(2, 2, f"SOURCE      {device}  [{report.media_type}]", w - 4, curses.color_pair(2))
            self.put(3, 2, f"DESTINATION {destination}", w - 4, curses.color_pair(3))
            self.put(5, 2, str(state["stage"]) + "." * ((self.frame // 4) % 4), w - 4)
            done = int(state["done"])
            total = state["total"]
            if isinstance(total, int) and total > 0:
                fraction = min(1.0, done / total)
                self.put(6, 2, f"{human_size(done)} / {human_size(total)}  ({fraction:.0%})", w - 4)
            else:
                fraction = 0.0
                self.put(6, 2, f"{human_size(done)} copied", w - 4)
            bar_width = max(1, w - 8)
            filled = int(bar_width * fraction)
            self.put(8, 2, "[" + "#" * filled + "." * (bar_width - filled) + "]", w - 4, curses.color_pair(3))
            self.put(h - 1, 0, " ESC cancel backup  ::  Existing files are never overwritten ".ljust(w), w, curses.color_pair(4))
            self.screen.refresh()
            if self.screen.getch() == 27:
                cancel.set()
        thread.join()
        if state["error"] is not None:
            error = state["error"]
            self.message = "Backup cancelled." if isinstance(error, BackupCancelled) else f"Backup failed: {error}"
            if not isinstance(error, BackupCancelled):
                self.show_log([str(error)], "BACKUP FAILED")
            return
        self.message = f"Backup saved: {destination}"
        self.refresh()
        self.show_log(["Backup saved to:", str(destination), f"Size: {human_size(int(state['result']))}"], "BACKUP COMPLETE")

    def show_log(self, log: list[str], title: str) -> None:
        offset = max(0, len(log) - max(1, self.screen.getmaxyx()[0] - 4))
        while True:
            self.screen.erase()
            h, w = self.screen.getmaxyx()
            self.put(0, 0, self.title(f"{title} :: OUTPUT", w), w, curses.color_pair(4))
            for i, line in enumerate(log[offset : offset + h - 3]):
                self.put(i + 1, 1, line, w - 2)
            self.put(h - 1, 0, " Up/Down scroll   Enter/Esc close ".ljust(w), w, curses.color_pair(4))
            self.screen.refresh()
            key = self.screen.getch()
            if key in (10, 13, 27, ord("q")):
                return
            if key == curses.KEY_UP:
                offset = max(0, offset - 1)
            if key == curses.KEY_DOWN:
                offset = min(max(0, len(log) - h + 3), offset + 1)

    def burn(self) -> None:
        if not self.items:
            self.message = "Add files or folders first."
            return
        tool = xorriso_path()
        if not tool:
            self.message = "xorriso missing. Install it with: sudo apt install xorriso"
            return
        try:
            for item in self.items:
                if not item.source.exists():
                    raise ValueError(f"Source disappeared: {item.source}")
            size = estimate_size(self.items)
            free = shutil.disk_usage(tempfile.gettempdir()).free
            if free < size + 128 * 1024 * 1024:
                raise ValueError("Not enough free temporary space to build the disc image.")
        except (OSError, ValueError) as exc:
            self.message = str(exc)
            return
        device = self.select_drive()
        if not device:
            return
        if not os.access(device, os.W_OK):
            self.message = f"No write access to {device}. Add your user to the cdrom group."
            return
        report = self.inspect_disc(device)
        proceed = self.view_disc(report, for_burn=True)
        if report.action == "blocked" or self.scan_results.get(report.fingerprint, (True, ""))[0] is False:
            self.message = "Disc is not safe to burn. Inspect it or insert another disc."
            return
        if not proceed:
            self.message = "Burn cancelled."
            return
        label = "BACKUP_" + datetime.now().strftime("%y%m%d")
        with tempfile.TemporaryDirectory(prefix="disc-master-") as temp:
            iso = Path(temp) / "disc.iso"
            if not self.run_process(iso_command(tool, iso, self.items, label), "BUILDING ISO"):
                return
            updated = self.inspect_disc(device)
            if updated.fingerprint != report.fingerprint or updated.action != report.action:
                self.message = "Disc changed during ISO creation. Inspect it and try again."
                return
            capacity = updated.free_bytes if updated.action == "burn" else updated.capacity_bytes
            if capacity is not None and iso.stat().st_size > capacity:
                self.message = f"ISO is {human_size(iso.stat().st_size)}; disc has about {human_size(capacity)} available."
                return
            token = "ERASE" if updated.action == "erase" else "BURN"
            verb = "replace existing contents" if updated.action == "erase" else "write blank disc"
            answer = self.prompt(f"{updated.media_type} in {device}: {verb}. Type {token}:")
            if answer != token:
                self.message = "Burn cancelled."
                return
            latest = self.inspect_disc(device)
            if latest.fingerprint != updated.fingerprint or latest.action != updated.action:
                self.message = "Disc changed after confirmation. Burn stopped; inspect it again."
                return
            if not self.run_process(burn_command(tool, device, iso, erase=updated.action == "erase"), "BURNING DISC"):
                return
        self.message = f"Disc burned successfully in {device}."

    def main(self) -> None:
        while True:
            self.draw()
            key = self.screen.getch()
            if key in (ord("q"), ord("Q")):
                return
            if key == 9:
                self.focus = 1 - self.focus
            elif key == curses.KEY_UP:
                if self.focus == 0:
                    self.browser_index = max(0, self.browser_index - 1)
                else:
                    self.queue_index = max(0, self.queue_index - 1)
            elif key in (curses.KEY_DOWN, ord("j")):
                if self.focus == 0:
                    self.browser_index = min(len(self.entries) - 1, self.browser_index + 1) if self.entries else 0
                else:
                    self.queue_index = min(len(self.items) - 1, self.queue_index + 1) if self.items else 0
            elif key in (10, 13, curses.KEY_ENTER) and self.focus == 0 and self.entries:
                entry = self.entries[self.browser_index]
                if entry.path.is_dir():
                    self.cwd = entry.path
                    self.browser_index = self.browser_scroll = 0
                    self.refresh()
                else:
                    self.add(entry.path)
            elif key in (curses.KEY_BACKSPACE, 127, 8, curses.KEY_LEFT) and self.focus == 0:
                self.cwd = self.cwd.parent
                self.browser_index = self.browser_scroll = 0
                self.refresh()
            elif key == ord(" ") and self.focus == 0 and self.entries:
                entry = self.entries[self.browser_index]
                if entry.shortcut:
                    self.cwd = entry.path
                    self.browser_index = self.browser_scroll = 0
                    self.refresh()
                else:
                    self.add(entry.path)
            elif key in (ord("p"), ord("P")):
                raw = self.prompt("Paste a file or folder path:")
                if raw:
                    path = Path(raw).expanduser()
                    self.add(path if path.is_absolute() else self.cwd / path)
            elif key in (ord("d"), ord("D")) and self.focus == 1 and self.items:
                removed = self.items.pop(self.queue_index)
                self.estimated_size = estimate_size(self.items)
                self.queue_index = min(self.queue_index, max(0, len(self.items) - 1))
                self.message = f"Removed {removed.name}."
            elif key in (ord("h"), ord("H")):
                self.show_hidden = not self.show_hidden
                self.refresh()
            elif key in (ord("r"), ord("R")):
                self.refresh()
            elif key in (ord("b"), ord("B")):
                self.burn()
            elif key in (ord("i"), ord("I")):
                self.inspect()
            elif key in (ord("k"), ord("K")):
                self.backup()
            elif key in (ord("e"), ord("E")):
                self.eject()
            elif key in (ord("t"), ord("T")):
                self.close_tray()

    def eject(self) -> None:
        device = self.select_drive("CHOOSE DISC DRIVE TO EJECT")
        if not device:
            return
        try:
            result = subprocess.run(["eject", device], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired) as exc:
            self.message = f"Could not eject {device}: {exc}"
            return
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()
            self.message = f"Could not eject {device}: {detail or 'eject failed'}"
        else:
            self.message = f"Ejected {device}."

    def close_tray(self) -> None:
        device = self.select_drive("CHOOSE DISC DRIVE TO CLOSE")
        if not device:
            return
        try:
            result = subprocess.run(["eject", "-t", device], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired) as exc:
            self.message = f"Could not close {device}: {exc}"
            return
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()
            self.message = f"Could not close {device}: {detail or 'tray close failed'}"
        else:
            self.message = f"Closed tray on {device}."

    def add(self, path: Path) -> None:
        try:
            item = validate_item(path, self.items)
            self.items.append(item)
            self.estimated_size = estimate_size(self.items)
            self.message = f"Added {item.name}."
        except (OSError, ValueError) as exc:
            self.message = f"Cannot add: {exc}"


def main() -> int:
    if len(sys.argv) > 1:
        if sys.argv[1:] != ["--check"]:
            print("Usage: disc_burner.py [--check]", file=sys.stderr)
            return 2
        print(f"xorriso: {xorriso_path() or 'missing (sudo apt install xorriso)'}")
        drives = optical_drives()
        for device, model in drives:
            print(f"writer: {device}  {model}")
        if not drives:
            print("writer: none found")
        return 0 if xorriso_path() and drives else 1
    try:
        curses.wrapper(lambda screen: App(screen).main())
        return 0
    except curses.error:
        print("Run this program inside a terminal of at least 62 x 14.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
