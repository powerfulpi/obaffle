"""Sync each public Apple Music playlist listed in playlists.txt."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
urls = [line.strip() for line in (ROOT / "playlists.txt").read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")]
failed = False
for url in urls:
    result = subprocess.run([sys.executable, str(ROOT / "import_apple.py"), url, "--download"])
    if result.returncode:
        failed = True
sys.exit(1 if failed else 0)
