# Obama Discord Bot

A Discord bot that can converse in voice channels and text channels. It supports OpenAI or Gemini for responses, either provider for speech recognition, and Cartesia for every spoken response.

The bot is intentionally configured to identify itself as an assistant rather than the real Barack Obama. Only use a Cartesia voice you have permission to use, and disclose the bot and its audio processing to everyone in a voice channel.

## Features

- Member-list status shows `ObamaHelp for commands • ObamaJoin for voice` while the bot is online.
- Voice wake word: mention `Obama` anywhere in an utterance, or say `Obama` and ask a follow-up within 12 seconds.
- @mention the bot anywhere in a server message to get a direct text response.
- `ObamaText <message>` returns a text response.
- `ObamaSpeak <message>` returns a WAV audio attachment.
- `ObamaImage <prompt>` generates a PNG image attachment using Gemini or OpenAI.
- `ObamaJoin` and `ObamaLeave` control the voice-channel connection.
- Named Cartesia voice aliases, with an immutable `original` alias from the environment.
- Per-server custom instructions.
- Per-server runtime memory toggle and clear command.
- Conversation contents are RAM-only and always disappear when the process restarts.
- Persistent non-conversation settings in `data/guild-settings.json`.
- Console telemetry for captured transcripts, AI prompts/replies, and voice playback.
- Local duration and loudness filtering before paid speech recognition.
- Playback feedback suppression with spoken interruption (`Obama, stop`) and a one-answer-per-server guard.
- Optional voice captions in a text channel configured in code.
- Mention the bot with an attached image to ask about it; accompanying questions and links are included.

## Requirements

- Node.js 22.12 or newer.
- A Discord application and bot token.
- A Cartesia API key and a voice ID you are authorized to use.
- An OpenAI API key, a Gemini API key, or both, depending on the provider settings.

No system FFmpeg installation is required. The bot uses raw 48 kHz PCM and a JavaScript Opus codec.

## Discord setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), add a bot, and copy its token.
2. On the bot page, enable the privileged **Message Content Intent**. The code also uses Guilds, Guild Messages, Guild Voice States, and Message Content gateway intents.
3. In OAuth2 URL Generator, select the `bot` scope and grant: View Channels, Send Messages, Read Message History, Attach Files, Connect, and Speak.
4. Open the generated URL and add the bot to your server.

## Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`, then check it without exposing any secrets:

```bash
npm run doctor
```

For OpenAI-only operation:

```dotenv
AI_PROVIDER=openai
STT_PROVIDER=openai
OPENAI_API_KEY=...
```

For Gemini-only operation:

```dotenv
AI_PROVIDER=gemini
STT_PROVIDER=gemini
GEMINI_API_KEY=...
```

Providers can be mixed. The default low-cost combination uses OpenAI for replies and Gemini for transcription, so it needs both API keys. For a single-provider setup, use either example above. Cartesia remains required in every configuration.

### Lowest-cost model defaults

The included defaults favor the lowest-priced compatible models over maximum response quality:

| Task | Default model |
| --- | --- |
| OpenAI replies | `gpt-5-nano` with minimal reasoning |
| OpenAI transcription | `gpt-4o-mini-transcribe` |
| Gemini replies | `gemini-2.5-flash-lite` |
| Gemini transcription | `gemini-2.5-flash-lite` using audio input |
| Cartesia speech | `sonic-latest` |

Set the model variables in `.env` if you prefer quality over the lowest price. For `GEMINI_TRANSCRIPTION_MODEL`, use a general Gemini model that accepts audio through `generateContent`; Google's dedicated Transcribe model uses a different API and is not a drop-in override here. Cartesia bills Sonic TTS through plan credits rather than offering a separately priced budget model, so its model remains configurable without claiming that an older model is cheaper.

Start in development or production mode:

```bash
npm run dev
```

```bash
npm run build
npm start
```

## Commands

Commands are case-insensitive. Settings-changing commands require the Discord **Manage Server** permission.

| Command | Result |
| --- | --- |
| `ObamaDM <@person or user ID> <message>` | Send a DM from the bot to one human member of this server (server owner only). Supports up to 2,000 characters; does not require enabling member-list DMs. Example: `ObamaDM @Alex Hello there!` |
| `ObamaText <message>` | Generate a text-channel response. |
| `@Obama <message>` | Mention the actual bot anywhere in a server message for a direct text response, regardless of conversation mode. |
| `ObamaStatus` | Have the AI report live uptime, Discord latency, model, voice session, and memory settings in the server's current personality. Status reports do not read or update conversation memory. |
| `ObamaSpeak <message>` | Generate a WAV attachment using the selected Cartesia voice. |
| `ObamaImage <prompt>` | Generate an image from a description. |
| `ObamaImage --recreate [instructions]` | Recreate one attached PNG, JPEG, or WebP image (up to 5 MB). |
| `ObamaShortcuts [on\|off\|status\|toggle]` | Toggle or inspect server command shortcuts; Manage Server to change. |
| `ObamaJoin` | Join the caller's current voice channel. |
| `ObamaLeave` | Leave the server's voice channel. |
| `ObamaRestart` | Restart the entire bot (Administrator or server owner only). |
| `ObamaVoice list` | List voice aliases and show the selected alias. |
| `ObamaVoice set <name>` | Select a saved alias. |
| `ObamaVoice add <name> <voice-id>` | Save or replace an alias. |
| `ObamaVoice remove <name>` | Remove an alias; `original` cannot be removed. |
| `ObamaVoice reset` | Select the environment-provided `original` voice. |
| `ObamaInstructions show` | Show the effective system instructions. |
| `ObamaInstructions set <text>` | Set server-specific instructions and clear its memory. |
| `ObamaInstructions reset` | Restore defaults and clear its memory. |
| `ObamaMemory on` / `off` | Enable or disable context across turns. Turning it off also clears existing context. |
| `ObamaMemory status` / `clear` | Inspect the setting or clear the server's current RAM-only conversations. |
| `ObamaPrivacy` | Explain voice data handling. |
| `ObamaHelp` | Show the command list. |

Memory is shared by conversation location: one history per text channel or voice channel. The speaker's Discord display name is included with each user turn. Only the most recent `MAX_MEMORY_MESSAGES` messages are retained.

## Voice behavior and privacy

Discord sends encoded audio per speaker. The bot collects one utterance until the configured silence threshold, decodes it in memory, and sends it to the selected speech-recognition API. It must do that before it can know whether the utterance contains the wake word. Consequently, **all completed speech segments from non-bot users while the bot is connected are sent to the configured STT provider**, not only speech after “Obama.”

This implementation does not save audio to disk. It discards utterances longer than `MAX_UTTERANCE_SECONDS`. Provider-side retention and processing are controlled by your provider account and terms. Get participant consent before using `ObamaJoin`.

At the default `LOG_LEVEL=info`, the console includes transcribed user speech and generated AI replies. The bot does not write these logs to a file itself, but your terminal, process manager, or hosting provider may retain console output. Treat it as sensitive conversation data. Audio is captured and transcribed during playback and for `VOICE_FEEDBACK_COOLDOWN_MS` afterward (1.5 seconds by default), but only explicit stop requests are accepted during that period. Ordinary triggers are ignored to prevent speaker-to-microphone feedback loops. This means interruption support also makes STT calls for speech during playback.

Before calling the speech-recognition API, the bot discards audio shorter than `VOICE_MIN_UTTERANCE_MS` (350 ms by default) or quieter than `VOICE_MIN_RMS_DBFS` (-42 dBFS by default). Discarded segments and their measured duration/RMS level appear in the console. To make recognition less sensitive, raise the RMS threshold toward zero (for example, `VOICE_MIN_RMS_DBFS=-36`) or increase the duration (for example, `VOICE_MIN_UTTERANCE_MS=500`). To admit quieter speech, lower the RMS threshold toward `-50`. Restart the bot after changing `.env`.

Wake matching recognizes the whole name anywhere in a transcript, case-insensitively.
`Obama, tell me a joke`, `What do you think, Obama, about pizza?`, and
`Tell me a joke, Obama` all trigger a voice response. When the name comes later,
the full utterance is retained as the question. Words such as `Obamacare` do not
trigger it. Saying only `Obama` still opens the existing 12-second follow-up window.

In server text channels, select the bot in Discord's @mention picker anywhere in
your message to get a direct reply. This uses the current personality and text
memory settings, without conversation mode's random chance or cooldown. A bare
mention gets a short greeting. Explicit Obama commands retain their normal behavior
and produce only one response. Messages from bots and webhooks are ignored.

Voice joins log each safe connection and networking state without exposing Discord voice tokens. `VOICE_JOIN_TIMEOUT_MS` controls how long a join may take and defaults to 30,000 milliseconds. If a join ends at `signalling`, check Discord channel permissions; if it ends during `UdpHandshaking`, check VPN, firewall, and network UDP access.

Voice-channel flow:

1. A user speaks and then pauses.
2. The configured STT provider transcribes the utterance.
3. If it contains the wake word, the configured AI provider generates a reply with that channel's optional memory.
4. Cartesia generates raw PCM with the selected voice.
5. The bot queues and plays the response in the voice channel.

The bot supports one connected voice channel per Discord server. It can connect independently in multiple servers.

## Data and permissions

`data/guild-settings.json` contains voice aliases, the selected alias, custom instructions, and the memory on/off preference. It does not contain conversation messages or API keys. The file is created with owner-only permissions where supported.

Keep `.env` private. It is ignored by Git. For hosted deployments, provide the same variables through the platform's secret manager and mount `DATA_DIR` on durable storage if you want settings to survive container replacement.

## Verification

```bash
npm test
npm run typecheck
npm audit --omit=dev
```

API calls and a real Discord voice session require your credentials, so the automated tests cover command parsing, wake-word matching, memory bounds, and PCM/WAV conversion without making paid network requests.

## Local dashboard

To run **Obama and Waffle together** from one terminal, use `npm run bots` and
open **http://127.0.0.1:3001**. The shared control center starts both bots, streams
their output, and provides individual Start, Stop, and Restart controls. It embeds
Obama's port-3000 dashboard when ready. Stop any separately running bot instances
first. Waffle defaults to the sibling `../Waffle` directory and its `.venv` Python.
See the [control center setup and options](control-center/README.md) for Windows,
Ubuntu, custom paths, and ports. Ctrl+C shuts down both managed bots.

The dashboard starts automatically alongside the bot with `npm run dev` or `npm start`.
Open **http://127.0.0.1:3000** to see Discord connection status, active and total guild
counts, connection uptime, gateway latency, and a server list with member counts.
Data refreshes every five seconds. “Active” means the guild is available through
Discord while the bot is connected, rather than recent message activity.

Set `DASHBOARD_PORT=3001` in `.env` to use a different port. The server listens only
on this computer's loopback interface and requires no additional dependencies.
If the port is occupied, the bot still starts and logs a dashboard warning.
The dashboard runs with the bot: an already-open page shows “Unreachable” when
the process stops, and reconnects automatically when it returns. Restart an
already-running bot once after installing this update to enable the dashboard.

## Command shortcuts

`ObamaShortcuts` toggles shortcuts for this server; `on` and `off` explicitly set
it, and `status` shows the setting and alias list. Changing it requires Manage
Server. The setting defaults to off and survives restarts. Full commands always
work. Shortcuts are case-insensitive and must be the first complete word.

| Shortcut | Command |
| --- | --- |
| OT | ObamaText |
| OS | ObamaSpeak |
| OI | ObamaImage |
| ON | ObamaInstructions |
| OST | ObamaStatus |
| OG | ObamaGlobalStatus |
| OR | ObamaRestart |
| OH | ObamaHelp |
| OP | ObamaPrivacy |
| OJ | ObamaJoin |
| OL | ObamaLeave |
| OV | ObamaVoice |
| OM | ObamaMemory |
| OC | ObamaConversation |
| OD | ObamaDM |
| ODM | ObamaDMAll |
| OSH | ObamaShortcuts |

Common commands keep the first letter. Conflicts use the second letter (for
example, Instructions becomes ON); if that is also taken, use the first two
letters (Status becomes OST because OT is Text). Arguments and permissions
are the same as for full commands: `OT hello`, `OV list`, `OI --recreate`.

## Image generation

Use `ObamaImage a watercolor cat sitting on the moon` in a text channel.
To recreate an image, attach exactly one PNG, JPEG, or WebP (up to 5 MB) to
`ObamaImage --recreate`. You can add optional instructions, for example
`ObamaImage --recreate keep every detail but use watercolor`. The original image
is sent directly to the selected image model with instructions to preserve its
composition, subjects, colors, style, and text as closely as possible; results
are AI recreations and may differ from the original. Supports Gemini image models
and OpenAI models that support image edits.

Provider request formats: [OpenAI image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
and [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation).

Image generation defaults to Gemini. Configure:

```dotenv
IMAGE_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
```

The model must support image output; the ordinary Gemini chat model cannot be used.
See [Google's image generation guide](https://ai.google.dev/gemini-api/docs/generate-content/image-generation).
To use OpenAI instead, set `IMAGE_PROVIDER=openai` and `OPENAI_API_KEY`.
`OPENAI_IMAGE_MODEL` defaults to `gpt-image-2`. Image provider selection is independent
of `AI_PROVIDER` and `STT_PROVIDER`.
The default uses Gemini 3.1 Flash Image. The command wraps the
description in an explicit image-generation instruction and requests image-only
output, without conversation memory. Ordinary text-only completions are retried
once; explicit provider blocks are reported without retrying.
Images stay in memory until uploaded to Discord. One image request
runs per server at a time, with a three-minute timeout and a 10 MB attachment limit.
Restart the bot after changing environment variables. Automated image tests mock
the API and do not make paid requests.

## Restart from Discord

Run `ObamaRestart` as a server owner or a member with **Administrator** permission.
The bot acknowledges the command, closes voice connections and the dashboard, and
restarts through its launcher. This affects every server and clears RAM-only
conversation memory; saved settings remain on disk. Active requests are interrupted.

Start the bot with `npm start` or `npm run dev` to enable the restart launcher.
Stop and relaunch an already-running bot once after installing this change.
Directly running `node dist/src/index.js` leaves the restart command unavailable.
Production restarts use the compiled build; run `npm run build` to include source
changes. Development restarts rebuild automatically.

## Interruptible speech and live captions

Say **“Obama, stop”**, “Obama, stop talking”, or “Obama, be quiet” while the bot
is speaking. Once the utterance is transcribed, playback stops and queued audio
is cleared. Replies still being generated or synthesized are discarded before
playback; an already-started provider request may still finish and incur charges.
You can ask a follow-up without the wake name within the configured 12-second
window. Ordinary speech during playback does not interrupt the bot. Interruption
latency depends on the silence threshold and speech-recognition response time.

Set `LIVE_CAPTIONS_GUILD_ID` and `LIVE_CAPTIONS_CHANNEL_ID` at the top of
`src/live-captions.ts` to the destination Discord server and text channel IDs.
Captions from **all servers** go to that one channel, labeled with the source
server ID and voice channel. Leaving either ID empty disables captions. Rebuild
and restart for a code change to take effect. The channel must belong to the
configured destination server, and the bot must be in that server with View
Channel and Send Messages permissions.

Captions show accepted voice questions after transcription and the complete reply
when audio is queued, plus a notice when speech is interrupted. These are
utterance-level captions, not word-by-word streaming subtitles. Background chatter
is not captioned. Captions are normal Discord messages visible to everyone with
access to that text channel and remain there until deleted, even though the bot's
conversation memory is RAM-only. Caption delivery failures are logged and do not
block speech. Mentions in captions do not ping anyone.

## Image understanding

**@mention the bot and attach an image.** It describes the image, explains a meme,
or discusses what is visible in a screenshot using the current personality.
Accompanying text is used as your question, including any links to compare with the image.
Explicit commands keep their behavior; otherwise image mentions take priority over ambient conversation mode.

This uses the configured **chat provider/model**, independently of image generation.
The chat model must support image inputs. Supported uploads are PNG, JPEG, and WebP,
up to three images per message and 5 MB per image. Non-image attachments do not
activate this feature; unsupported image formats get a helpful error.
Uploaded Discord attachments are validated before downloading, and images stay in memory while
being sent to the provider. Public direct image links can also be inspected as described below. Image requests do not read or update conversation memory.

Provider request formats follow the official
[OpenAI image-input documentation](https://developers.openai.com/api/docs/guides/images-vision)
and [Gemini image-understanding documentation](https://ai.google.dev/gemini-api/docs/image-understanding).

## Global configuration status

Run `ObamaGlobalStatus` (alias `ObamaUniversalStatus`) for a complete text attachment
covering every current server and any additional servers with saved settings.
Only the Discord bot application owner, or the owner of its owning team, can run
this command. Server Administrator alone does not grant access. The report is
posted in the channel where the command is run.

The report includes full custom instructions, shared default instructions, enabled
conversation channels with chance/cooldown settings, all voice aliases and IDs,
the selected voice, memory preferences, live voice connection state, model/provider
choices, uptime, and the global captions destination. Saved settings for servers
or channels no longer available are labeled accordingly. It does not include API
keys, tokens, or conversation history, and makes no AI requests. `ObamaStatus`
continues to provide the existing personality-based status reply.

## Images and links in conversation

When `ObamaConversation` is on, a selected response considers images from the same
15-message transcript, prioritizing the triggering message and newest history.
It attempts up to three image attachments (PNG, JPEG, or WebP; 5 MB each), labels
which message each image belongs to, and includes Discord embed titles and
descriptions. Failed downloads and other files remain unopened placeholders.
The usual chance, cooldown, and channel permissions still apply; a losing random
roll does not download images or links.

Public `http://` and `https://` links are read automatically for conversational
responses: `ObamaText`, `ObamaSpeak`, direct mentions, image questions, conversation
mode, and URLs present in voice transcripts. No separate command is required.
For example: `ObamaText what is this about? https://example.com/article`.
Follow-up questions can reuse links in enabled conversation memory.

Each reply reads at most three distinct links, prioritizing the current message.
It extracts titles, descriptions, and readable HTML/plain-text/JSON content, or
passes a direct PNG/JPEG/WebP image to the chat model (up to three images total).
Page excerpts are capped at 8,000 characters; downloads have a 10-second deadline,
three-redirect limit, and a 512 KB page / 5 MB image limit. Only public network
addresses and standard web ports are allowed, including after redirects.

This is a page reader, not a logged-in browser: JavaScript-only pages, login/paywall
content, PDFs, audio, and video may be unavailable. Discord embeds can provide a
partial preview when the full page is unavailable. The bot is instructed to
acknowledge unavailable content rather than invent it, and to treat fetched content
as source material rather than instructions. Fetched page text and image bytes are
not stored in conversation memory. A chat model with image input is needed to see
images. No additional API key is required for fetching public pages.
