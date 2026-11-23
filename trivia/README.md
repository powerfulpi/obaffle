# Gather Round Trivia

A live room trivia game for a host screen and up to 50 player devices. The host creates a game, chooses the Original, Thanksgiving, or Christmas website design independently of the question source, shares a six-character code or join link, and controls when questions start. Ready-made Starter Mix, Thanksgiving, and Christmas question sets are also available, or the host can generate questions with AI. Players see the same questions on their phones and answer within the host's chosen time limit. The host screen shows empty boxes until players answer, then green checks. The timer expands when ten seconds remain. Multiple choice and true/false questions are supported.

Each question begins with five seconds to read it before answers open and the configured answer timer starts. The host chooses whether questions always use the full answer timer or reveal immediately once everyone has answered. During questions, the phone view fits the question, timer, and answer buttons into the visible screen without page scrolling. It adjusts text size for smaller phones and uses reduced-motion settings when requested by the device. When a question ends, players first see a full-screen result, then their answer and the correct answer if they missed it. Correct answers earn 100–1,000 points based on how much of the answer timer remains; wrong or missing answers earn zero. The host screen shows a full-screen countdown during the final ten seconds. Between questions, an animated standings list appears after the answer reveal. The podium animation, revealing third, second, then first place, is reserved for the final results and ends with confetti.

Host audio uses the supplied GeoGuessr Ambient and Track_01–Track_06 files. Music intensity follows time remaining: level one at 60 seconds, level two at 50, and one level higher every ten seconds through level six for the final ten seconds. Shorter questions start at the appropriate level instead of rushing through every track. Music returns to Ambient when the answer is revealed. The host also hears a new-question chime and distinct normal and urgent countdown ticks. Sound can be toggled in the lobby or during the game; browsers require the host to interact with the page before audio plays. Players' phones stay silent.

## Run

Requires Node.js 22 or later. No packages need installing.

```bash
cd trivia
npm start
```

Open `http://127.0.0.1:3006` on the host. By default, the server listens only on loopback for the Cloudflare Tunnel. For direct Wi-Fi access instead, start it with `HOST=0.0.0.0 npm start` and open the app using its LAN IP (for example `http://192.168.1.20:3006`) before creating a game. The generated join link uses the address in the browser. Port `3006` is configurable with `PORT`.

For players outside the LAN, use the existing Cloudflare Tunnel. Add a published application route on `obama-phone` with hostname `trivia.shantry.com` and service URL `http://127.0.0.1:3006`. Open `https://trivia.shantry.com` on the host before creating a game so generated join links use the public address. Set `TRIVIA_HOST_PIN` to protect game creation and Gemini usage.

The included `trivia.service` user unit keeps the server running across logouts and reboots. It reads a private `service.env` containing `TRIVIA_HOST_PIN` and optionally `GEMINI_API_KEY`, `GEMINI_MODEL`, `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`, and `CARTESIA_MODEL`. Install it with `ln -s /home/aidensmith/obaffle/trivia/trivia.service ~/.config/systemd/user/trivia.service`, then run `systemctl --user daemon-reload` and `systemctl --user enable --now trivia.service`. This server has user lingering enabled. To read the host PIN on the server, run `sed -n 's/^TRIVIA_HOST_PIN=//p' trivia/service.env` from the repository root.

## Questions

Set `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID` in the server's `service.env` to read questions aloud on the host during the five-second reading phase. `CARTESIA_MODEL` optionally overrides `sonic-latest`. Voice audio stays server-side and is available only to the host during that phase; if generation fails, the game continues without voice.

The included **Starter Mix**, **Thanksgiving**, and **Christmas** question sets each contain eight questions and can be used with any website design. Add future sets to `sets.js` using the same structure: `type` is `multiple` with four options or `boolean` with `['True', 'False']`; `answer` is the zero-based correct option index. Keep questions within 160 characters and answer options within 60 characters so they fit on small phones without scrolling.

To enable AI question creation, set `GEMINI_API_KEY` in the server environment. `GEMINI_MODEL` optionally overrides the default `gemini-2.5-flash-lite`. The key stays on the server; players never receive it. The host previews the generated question list before creating the game. Review AI questions for accuracy before playing.

The host's Full screen button hides browser tabs and other browser controls during the game; press Escape or tap it again to exit. The three-dot menu can end a game early or restart it. Ending scores any submitted answers on the current question and shows final scores. Restarting resets scores and questions but keeps the same code and joined players in the lobby. Games live in server memory and expire after 24 hours when a new game is created. Restarting the service clears active games. Host and player credentials are kept in each browser tab's session storage so a refresh can resume the game.

Run `npm test` for the game logic tests.
