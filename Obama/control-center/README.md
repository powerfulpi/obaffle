# Obama + Waffle control center

From the Obama project directory, run:

```sh
npm run bots
```

Open **http://127.0.0.1:3001** (or http://localhost:3001). Both bots start automatically.
Each has Start, Stop, and Restart controls, a process status, PID, and uptime.
Their stdout/stderr appears in both the terminal and a live web console. Filter
by bot, turn off Follow to read earlier output, or clear the current browser view.
The most recent 1,000 lines are held in RAM, with each line capped at 8,192 characters.
Reloading the page replays this recent output; restarting the launcher clears it.

Obama's existing dashboard appears in the right-hand frame once its web server
is reachable. It still uses port 3000. The launcher supplies the one local origin
allowed to frame it; standalone Obama continues to block embedding. Visiting the
control center via `localhost` redirects to `127.0.0.1` so this origin stays consistent.
The frame disappears while Obama is stopped and reconnects after a restart.

## First-time setup

Use Node.js 22.12+, Python 3.11+, and FFmpeg on PATH. The controller itself adds
no dependencies. Each bot still needs its existing dependencies and `.env` file.
Keep the two folders next to each other by default (capitalization matters on Linux):

```text
your-folder/
  obama/       # Run npm run bots here
  Waffle/
```

In Obama, run `npm install`. The controller builds Obama automatically on each
start using its existing restart launcher, without a file watcher. `ObamaRestart`
continues to work and its replacement process continues streaming output here.

In Waffle, create and install a virtual environment if it doesn't already exist:

macOS / Ubuntu:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install .
```

Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install .
```

Then return to Obama and run `npm run bots` (`npm.cmd run bots` also works in
PowerShell when script execution policy blocks npm.ps1). The launcher selects
`.venv/bin/python` on macOS/Linux and `.venv/Scripts/python.exe` on Windows.
It makes its Node executable available on Waffle's PATH for YouTube extraction.
When moving between operating systems, copy source, `.env`, and saved settings;
reinstall dependencies instead of transferring `node_modules` or `.venv`.

**Stop any copies started in other terminals before using the launcher.** It
controls only processes it starts and cannot adopt an already-running bot or its
output. An occupied Obama dashboard port blocks its startup with an explanatory
error. Waffle instances launched elsewhere are not detected. The dashboard labels
refer to managed processes, not independently started copies or Discord readiness.

## Options

```sh
npm run bots -- --help
npm run bots -- --port 3010 --obama-port 3000
npm run bots -- --waffle-dir "/path/to/Waffle"
npm run bots -- --python "/path/to/venv/bin/python"
npm run bots -- --no-autostart
```

`--obama-dir` overrides the Obama project location. Directory arguments resolve
relative to the terminal's current directory; defaults resolve relative to this
launcher, so invoking `node /path/to/obama/control-center/server.mjs` works from
any directory. `--python` accepts an executable path or command on PATH, without
extra command-line arguments. The two web ports must differ. The chosen Obama port
overrides `DASHBOARD_PORT` for the managed process only.

If one bot fails to start, the dashboard and the other bot remain available.
Check its output, fix the configuration, and click Start. Crashed bots stay stopped
until explicitly started; the controller doesn't run a crash/retry loop.

Ctrl+C stops both managed process trees and the web server. On macOS/Linux it
sends SIGTERM to the bot's process group, then forces remaining children to exit
after five seconds. Windows uses `taskkill /T /F` to stop the whole tree, so its
stop/restart is immediate. This includes Waffle's FFmpeg processes. Stopping or
restarting a bot interrupts its current requests/music and clears its RAM-only state.

The web server binds only to `127.0.0.1`. Host/origin checks and a per-launch action
token protect its fixed start/stop/restart routes. It doesn't expose a shell, `.env`
files, or arbitrary files. Logs can include conversations, just like the bots'
normal terminal output; they are not persisted by this controller.

## Verification

```sh
npm run test:control
npm test
```

Controller tests start isolated fixture processes and a local test web server.
They exercise logs, process replacement, process-tree cleanup, crash handling,
SSE streaming, dashboard readiness, and HTTP access checks without logging into
Discord or calling paid APIs. Automated checks do not replace a live Windows or
Ubuntu deployment test.
