# Separate LiveKit Inference phone experiment

This is a separate process from `Obama/src/phone.ts`. It does not use the Twilio Media Streams webhook, change the existing number, or change the Discord bot. It uses LiveKit Inference for Gemini streaming transcription, Gemini replies, and Cartesia speech. LiveKit Cloud bills model usage; no direct Gemini or Cartesia API key is needed here.

## Local test

1. Create a LiveKit Cloud project. Copy `.env.example` to `.env.local` and fill in its LiveKit credentials and a Cartesia voice ID you may use. This file stays local.
2. Run `npm ci` in this directory.
3. Run `npm run dev` in this directory. In your LiveKit project Agent Console, select the `obama-livekit-test` agent and start a microphone session.

The process reads only its own `.env.local`. `LIVEKIT_PHONE_AGENT_NAME` lets this experiment coexist with other LiveKit agents. Stop it with Ctrl-C. The existing `npm run phone` process is unaffected.

## Optional phone call test

To test a real call, set up a **separate test number** with a SIP trunk in LiveKit Cloud. Create an inbound trunk and a dispatch rule that sends each caller to a separate room and explicitly dispatches `obama-livekit-test`. Point only the test number to that trunk. Do not change the existing Twilio Media Streams number until the experiment is acceptable.

LiveKit SIP trunk and dispatch setup happens in LiveKit Cloud and the phone provider; starting this process alone does not route phone calls. Keep the existing phone server running during evaluation. Return to the old behavior by leaving the original number on its current Twilio webhook and stopping this process.

The agent opens with an AI disclosure and will not claim to be the real Barack Obama. It uses the same general voice and conversation role but does not import the existing phone settings or conversation history. On this development host, importing the LiveKit agent runtime exits with code 132 (native CPU instruction fault), so a live session has not been validated here. Run the experiment on a compatible host after configuring LiveKit credentials.
