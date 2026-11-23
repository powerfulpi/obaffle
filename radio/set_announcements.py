"""Change the live station's announcement setting through its local admin API."""

import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
ORIGIN = "http://127.0.0.1:3004"


def request(path, body=None, *, cookie=None, csrf=None):
    headers = {"Origin": ORIGIN, "Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    if csrf:
        headers["X-CSRF-Token"] = csrf
    req = Request(ORIGIN + path, data=json.dumps(body).encode() if body is not None else None,
                  headers=headers)
    with urlopen(req, timeout=15) as response:
        return json.load(response), response.headers


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"on", "off"}:
        raise SystemExit("Usage: set_announcements.py on|off")
    password = next((line.split("=", 1)[1].strip() for line in
                     (ROOT / "admin.env").read_text().splitlines()
                     if line.startswith("RADIO_ADMIN_PASSWORD=")), None)
    if not password:
        raise SystemExit("Admin password is not configured")
    _, headers = request("/admin/login", {"password": password})
    cookie = headers["Set-Cookie"].split(";", 1)[0]
    status, _ = request("/admin/api/status", cookie=cookie)
    enabled = sys.argv[1] == "on"
    result, _ = request("/admin/api/announcements", {"enabled": enabled},
                        cookie=cookie, csrf=status["csrf"])
    if result.get("announcements_enabled") is not enabled:
        raise SystemExit("The station did not confirm the setting")
    print("Announcer", "on" if enabled else "off")


if __name__ == "__main__":
    main()
