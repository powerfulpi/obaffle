"""Back up a data disc to a verified ISO without overwriting files."""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable

from media import catalog_command, parse_scan


class BackupCancelled(Exception):
    pass


def disc_size(device: Path) -> int | None:
    info = device.stat()
    if stat.S_ISREG(info.st_mode):
        return info.st_size
    if stat.S_ISBLK(info.st_mode):
        try:
            sectors = int((Path("/sys/class/block") / device.name / "size").read_text().strip())
            return sectors * 512 if sectors else None
        except (OSError, ValueError):
            pass
    return None


def backup_filename(volume_id: str) -> str:
    label = re.sub(r"[^A-Za-z0-9._-]+", "_", volume_id).strip("._-")[:48]
    return (label or "DISC_" + datetime.now().strftime("%Y%m%d_%H%M%S")) + ".iso"


def destination_from_input(raw: str, cwd: Path, volume_id: str) -> Path:
    chosen = Path(raw).expanduser() if raw.strip() else cwd
    if not chosen.is_absolute():
        chosen = cwd / chosen
    chosen = chosen.resolve(strict=False)
    if chosen.is_dir():
        base = chosen / backup_filename(volume_id)
        destination = base
        number = 2
        while destination.exists():
            destination = base.with_name(f"{base.stem}_{number}.iso")
            number += 1
    else:
        destination = chosen
        if destination.suffix.lower() != ".iso":
            raise ValueError("Enter an existing folder or a new filename ending in .iso.")
    if not destination.parent.is_dir():
        raise ValueError("Destination folder does not exist.")
    if destination.exists():
        raise ValueError("Destination file already exists; choose another name.")
    if not os.access(destination.parent, os.W_OK):
        raise ValueError("Destination folder is not writable.")
    return destination


def backup_command(xorriso: str, device: str, image: Path) -> list[str]:
    return [xorriso, "--no_rc", "-indev", device, "-check_media", f"data_to={image}", "report=blocks_files", "--", "-end"]


def backup_disc(
    xorriso: str,
    device: str,
    destination: Path,
    expected_paths: tuple[str, ...],
    env: dict[str, str],
    progress: Callable[[int, int | None, str], None],
    cancel: threading.Event,
) -> int:
    """Read optical tracks, verify the image catalogue, then publish atomically."""
    total = disc_size(Path(device))
    if total and shutil.disk_usage(destination.parent).free < total + 16 * 1024 * 1024:
        raise ValueError("Not enough free space at the backup destination.")
    with tempfile.TemporaryDirectory(dir=destination.parent, prefix=f".{destination.stem}.") as work:
        image = Path(work) / "disc.iso"
        command = backup_command(xorriso, device, image)
        progress(0, total, "Reading optical tracks")
        process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1)
        assert process.stdout is not None

        def stop_if_cancelled() -> None:
            while process.poll() is None:
                if cancel.wait(0.1):
                    if process.poll() is None:
                        process.terminate()
                    return

        threading.Thread(target=stop_if_cancelled, daemon=True).start()
        output: list[str] = []
        for line in process.stdout:
            output.append(line.rstrip())
            progress_match = re.search(r"(\d+) blocks read", line)
            if progress_match:
                progress(int(progress_match.group(1)) * 2048, total, "Reading optical tracks")
        code = process.wait()
        if cancel.is_set():
            raise BackupCancelled("Backup cancelled.")
        ok, finding = parse_scan("\n".join(output), code)
        if not ok and finding != "Some data regions were not verified.":
            raise ValueError(f"Backup stopped: {finding} Last drive output: {output[-1] if output else '(none)'}")
        if not image.is_file() or image.stat().st_size == 0:
            raise ValueError("Disc reader produced no ISO image.")
        progress(image.stat().st_size, image.stat().st_size, "Verifying ISO directory")
        verified = subprocess.run(catalog_command(xorriso, f"stdio:{image}"), env=env, capture_output=True, text=True, errors="replace", timeout=120)
        if verified.returncode != 0:
            raise ValueError("Copied image could not be opened as an ISO data disc.")
        image_paths = tuple(line[1:-1] for line in verified.stdout.splitlines() if len(line) >= 2 and line.startswith("'") and line.endswith("'"))
        if set(image_paths) != set(expected_paths):
            raise ValueError("Copied image directory differs from the inserted disc.")
        if cancel.is_set():
            raise BackupCancelled("Backup cancelled.")
        os.link(image, destination)
        return image.stat().st_size
