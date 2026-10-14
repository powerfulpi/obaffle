import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ServerOptions, cli, defineAgent, inference, voice } from '@livekit/agents';

dotenv.config({ path: new URL('.env.local', import.meta.url).pathname });

const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_PHONE_VOICE_ID'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing LiveKit phone configuration: ${missing.join(', ')}`);

const agentName = process.env.LIVEKIT_PHONE_AGENT_NAME || 'obama-livekit-test';
const greeting = process.env.LIVEKIT_PHONE_GREETING || 'How can I help?';
const personality = process.env.LIVEKIT_PHONE_INSTRUCTIONS || 'You are a friendly AI assistant called Obama. Keep phone answers brief and useful.';

export default defineAgent({
  entry: async (ctx) => {
    const session = new voice.AgentSession({
      stt: new inference.STT({ model: 'google/gemini-3.5-transcribe-live', language: 'en' }),
      llm: new inference.LLM({ model: 'google/gemini-3.8-flash' }),
      tts: new inference.TTS({
        model: 'cartesia/sonic-3',
        voice: process.env.LIVEKIT_PHONE_VOICE_ID,
        language: 'en',
      }),
      turnHandling: { turnDetection: new inference.TurnDetector() },
    });

    await session.start({
      agent: voice.Agent.create({
        instructions: `${personality}\nAlways identify yourself as an AI assistant when asked. Never claim to be the real Barack Obama. Avoid markdown because replies are spoken aloud.`,
      }),
      room: ctx.room,
    });
    await ctx.connect();
    await session.generateReply({ instructions: `Greet the caller by saying: "Hi, this is an AI assistant called Obama. ${greeting}"` });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName }));
