"""Read-only optical media inspection and burn policy."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass


REWRITABLE = {"CD-RW", "DVD-RW", "DVD+RW", "DVD-RAM", "BD-RE"}
ERROR_WORDS = ("FAILURE", "FATAL", "I/O error", "SCSI error", "read error")


@dataclass(frozen=True)
class MediaReport:
    device: str
    media_type: str
    status: str
    summary: str
    volume_id: str
    paths: tuple[str, ...]
    free_bytes: int | None
    capacity_bytes: int | None
    action: str  # burn, erase, or blocked
    implications: tuple[str, ...]
    catalog_error: str = ""

    @property
    def fingerprint(self) -> tuple[str, str, str, str, str]:
        return self.device, self.media_type, self.status, self.summary, self.volume_id


def _field(output: str, label: str) -> str:
    match = re.search(rf"^{re.escape(label)}\s*:\s*(.*)$", output, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _size(output: str, suffix: str) -> int | None:
    matches = re.findall(rf"(\d+(?:\.\d+)?)\s*([kmgt]?)\s+{suffix}\b", output, re.IGNORECASE)
    if not matches:
        return None
    value, unit = matches[-1]
    return int(float(value) * (1024 ** {"": 0, "k": 1, "m": 2, "g": 3, "t": 4}[unit.lower()]))


def atip_command(xorriso: str, device: str) -> list[str]:
    return [xorriso, "-as", "cdrecord", "--no_rc", f"dev={device}", "-atip"]


def catalog_command(xorriso: str, device: str) -> list[str]:
    return [xorriso, "--no_rc", "-indev", device, "-find", "/", "-exec", "echo", "--", "-end"]


def scan_command(xorriso: str, device: str) -> list[str]:
    return [xorriso, "--no_rc", "-indev", device, "-check_media", "report=blocks_files", "--", "-end"]


def parse_scan(output: str, returncode: int) -> tuple[bool, str]:
    if returncode != 0 or any(word in output for word in ERROR_WORDS):
        return False, "Scan failed or encountered a drive/read error."
    regions = re.findall(r"^Media region\s*:\s*\d+\s*,\s*\d+\s*,\s*([^\n]+)", output, re.MULTILINE)
    if not regions:
        return False, "No complete media scan result was reported."
    bad = [quality for quality in regions if quality.strip().startswith("-")]
    if bad:
        return False, f"Unreadable or damaged sectors found ({len(bad)} region(s))."
    unknown = [quality for quality in regions if quality.strip().startswith("0") and "tao_end" not in quality and "gap" not in quality]
    if unknown:
        return False, "Some data regions were not verified."
    return True, "Surface scan found no bad data regions."


def parse_report(device: str, atip: str, atip_code: int, catalog: str = "", catalog_code: int | None = None) -> MediaReport:
    media_type = _field(atip, "Media current")
    status = _field(atip, "Media status")
    summary = _field(atip, "Media summary")
    volume_id = _field(catalog, "Volume id").strip("'\"")
    free = _size(summary, "free")
    used = _size(summary, "data")
    capacity = free + used if free is not None and used is not None else free
    catalog_error = ""
    paths: tuple[str, ...] = ()
    if catalog_code is not None:
        if catalog_code != 0 or any(word in catalog for word in ERROR_WORDS):
            catalog_error = "Disc contents could not be read (audio disc, unsupported format, or read error)."
        else:
            paths = tuple(line[1:-1] for line in catalog.splitlines() if len(line) >= 2 and line.startswith("'") and line.endswith("'"))

    if atip_code != 0 or any(word in atip for word in ERROR_WORDS):
        action = "blocked"
        implications = ("Drive/media inspection failed. Check the disc and drive before burning.",)
    elif not media_type or not status or "is not recognizable" in status.lower():
        action = "blocked"
        implications = ("No recognizable disc is ready. Insert a blank recordable disc.",)
    elif "ROM" in media_type or media_type not in REWRITABLE | {"CD-R", "DVD-R", "DVD+R", "DVD-R DL", "DVD+R DL", "BD-R"}:
        action = "blocked"
        implications = (f"{media_type} is read-only or unsupported for this burn mode.",)
    elif "is blank" in status:
        action = "burn"
        implications = ("Blank disc: a new data session can be written.", "A write error can still occur during burning; this check cannot predict all defects.")
    elif "is written" in status and media_type in REWRITABLE:
        action = "erase"
        implications = ("This rewritable disc already contains data.", "Burning will remove its existing files from the disc directory.", "Quick erase is not a secure wipe of old data.")
    elif "is written" in status:
        action = "blocked"
        implications = ("This once-recordable disc already contains data.", "This app cannot safely add a new session; insert a blank disc.")
    else:
        action = "blocked"
        implications = (f"Unrecognized media status: {status}. Burning is blocked.",)
    if catalog_error:
        implications += (catalog_error,)
    return MediaReport(device, media_type, status, summary, volume_id, paths, free, capacity, action, implications, catalog_error)


def inspect_media(xorriso: str, device: str, env: dict[str, str]) -> MediaReport:
    try:
        probe = subprocess.run(atip_command(xorriso, device), env=env, capture_output=True, text=True, errors="replace", timeout=30)
        atip = probe.stdout + probe.stderr
        preliminary = parse_report(device, atip, probe.returncode)
        if "is written" not in preliminary.status:
            return preliminary
        catalog = subprocess.run(catalog_command(xorriso, device), env=env, capture_output=True, text=True, errors="replace", timeout=30)
        return parse_report(device, atip, probe.returncode, catalog.stdout + catalog.stderr, catalog.returncode)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return MediaReport(device, "Unknown", "inspection failed", "", "", (), None, None, "blocked", (f"Could not inspect disc: {exc}",))
