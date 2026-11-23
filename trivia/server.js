import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { GameStore } from "./game.js";
import { questionSets, validateQuestions } from "./sets.js";

const root = dirname(fileURLToPath(import.meta.url));
const store = new GameStore();
const voiceTasks = new WeakMap();
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/join", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/mobile.css", ["mobile.css", "text/css; charset=utf-8"]],
  ["/audio.js", ["audio.js", "text/javascript; charset=utf-8"]],
  ["/audio/ambience.mp3", ["audio/ambience.mp3", "audio/mpeg"]],
  ...Array.from({ length: 6 }, (_, index) => [
    `/audio/level-${index + 1}.mp3`, [`audio/level-${index + 1}.mp3`, "audio/mpeg"]
  ])
]);

function json(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(data));
}

async function body(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 32_000) throw new Error("Request is too large.");
  }
  try { return JSON.parse(text || "{}"); }
  catch { throw new Error("Invalid JSON."); }
}

async function generateQuestions(topic, count) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Set GEMINI_API_KEY on the server to use AI questions.");
  if (!topic || topic.length > 200) throw new Error("Enter a topic of up to 200 characters.");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const prompt = `Create ${count} accurate, family-friendly trivia questions about ${topic}. Include a mix of four-option multiple choice and true/false. Each question must be at most 160 characters and each answer option at most 60 characters so everything fits on a phone screen. Return only a JSON array. Each object must have type ("multiple" or "boolean"), question, options (four strings for multiple choice; ["True","False"] for boolean), and answer (zero-based index). Avoid ambiguous facts and repeated questions.`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}).`);
  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no questions.");
  let questions;
  try { questions = validateQuestions(JSON.parse(text)); }
  catch (error) {
    if (error.message?.includes("too long for phone screens")) throw new Error("Gemini made a question too long for phones. Regenerate the questions.");
    throw new Error("Gemini returned questions in an unexpected format. Try again.");
  }
  if (questions.length !== count) throw new Error("Gemini returned the wrong number of questions. Try again.");
  return questions;
}

async function synthesizeQuestion(question) {
  const key = process.env.CARTESIA_API_KEY;
  const voiceId = process.env.CARTESIA_VOICE_ID;
  if (!key || !voiceId) return null;
  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "Cartesia-Version": "2026-08-14",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model_id: process.env.CARTESIA_MODEL || "sonic-latest",
      transcript: question,
      voice: { id: voiceId },
      language: "en",
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 }
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Cartesia returned ${response.status}.`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 44 || audio.length > 2_000_000 || audio.toString("ascii", 0, 4) !== "RIFF") throw new Error("Cartesia returned invalid audio.");
  return audio;
}

function prepareVoice(game, index) {
  if (index >= game.questions.length) return Promise.resolve(null);
  let tasks = voiceTasks.get(game);
  if (!tasks) {
    tasks = new Map();
    voiceTasks.set(game, tasks);
  }
  if (!tasks.has(index)) {
    tasks.set(index, synthesizeQuestion(game.questions[index].question).catch(error => {
      tasks.delete(index);
      console.warn(`Question voice unavailable: ${error.message}`);
      return null;
    }));
  }
  return tasks.get(index);
}

function credentials(request, game) {
  const supplied = request.headers.authorization?.replace(/^Bearer /, "");
  if (supplied === game.hostToken) return { role: "host" };
  return { role: "player", player: store.player(game, supplied) };
}

export async function handle(request, response) {
  const url = new URL(request.url, "http://localhost");
  const route = url.pathname;
  try {
    if (request.method === "GET" && files.has(route)) {
      const [file, contentType] = files.get(route);
      response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
      response.end(await readFile(join(root, "public", file)));
      return;
    }
    if (request.method === "GET" && route === "/api/sets") {
      json(response, 200, { sets: questionSets.map(({ id, title, description, questions }) => ({ id, title, description, count: questions.length })) });
      return;
    }
    if (request.method === "POST" && (route === "/api/generate" || route === "/api/games")) {
      const input = await body(request);
      if (process.env.TRIVIA_HOST_PIN && input.hostPin !== process.env.TRIVIA_HOST_PIN) throw new Error("Incorrect host PIN.");
      if (route === "/api/generate") {
        const count = Number(input.count);
        if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Choose 1 to 20 AI questions.");
        json(response, 200, { questions: await generateQuestions(String(input.topic ?? "").trim(), count) });
        return;
      }
      const seconds = Number(input.seconds);
      const questionCount = Number(input.questionCount);
      if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120) throw new Error("Time per question must be 5 to 120 seconds.");
      const autoEndOnAllAnswers = input.autoEndOnAllAnswers ?? false;
      if (typeof autoEndOnAllAnswers !== "boolean") throw new Error("Choose whether the question ends when everyone answers.");
      const theme = input.theme ?? "starter";
      if (!["starter", "thanksgiving", "christmas"].includes(theme)) throw new Error("Choose a valid website design.");
      const set = questionSets.find(entry => entry.id === input.setId);
      const questions = input.source === "ai" ? validateQuestions(input.questions) : validateQuestions(set?.questions);
      if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > questions.length) throw new Error("Choose a valid question count.");
      const title = input.source === "ai" ? String(input.topic ?? "AI Trivia").trim().slice(0, 80) : set.title;
      const game = store.create({ title, theme, questions, seconds, questionCount, autoEndOnAllAnswers });
      void prepareVoice(game, 0);
      json(response, 201, { code: game.code, hostToken: game.hostToken });
      return;
    }
    if (request.method === "POST" && route === "/api/join") {
      const input = await body(request);
      const game = store.get(input.code);
      const player = store.join(game, input.name);
      json(response, 201, { code: game.code, playerToken: player.token });
      return;
    }
    const match = route.match(/^\/api\/games\/([A-Z0-9]{6})(?:\/(state|next|end|answer|voice|leaderboard|finish|restart))?$/i);
    if (match) {
      const game = store.get(match[1]);
      const action = match[2] || "state";
      if (request.method === "GET" && action === "state") {
        const identity = credentials(request, game);
        json(response, 200, store.state(game, identity.role, identity.player));
        return;
      }
      if (request.method === "GET" && action === "voice") {
        store.requireHost(game, request.headers.authorization?.replace(/^Bearer /, ""));
        if (!game.voiceAudio || game.phase !== "reading") throw new Error("Question voice is unavailable.");
        response.writeHead(200, { "content-type": "audio/wav", "cache-control": "no-store" });
        response.end(game.voiceAudio);
        return;
      }
      if (request.method === "POST" && action === "answer") {
        const player = store.player(game, request.headers.authorization?.replace(/^Bearer /, ""));
        const input = await body(request);
        store.answer(game, player, input.choice);
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && ["next", "end", "leaderboard", "finish", "restart"].includes(action)) {
        store.requireHost(game, request.headers.authorization?.replace(/^Bearer /, ""));
        if (action === "next") {
          if (game.phase !== "lobby" && game.phase !== "leaderboard") throw new Error("Show the leaderboard before starting the next question.");
          game.voiceAudio = await prepareVoice(game, game.index + 1);
          store.next(game);
          void prepareVoice(game, game.index + 1);
        }
        else if (action === "end") store.endQuestion(game);
        else if (action === "leaderboard") store.showLeaderboard(game);
        else if (action === "finish") store.endGame(game);
        else store.restart(game);
        json(response, 200, store.state(game, "host"));
        return;
      }
    }
    json(response, 404, { error: "Not found." });
  } catch (error) {
    json(response, 400, { error: error.message || "Something went wrong." });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3006);
  const host = process.env.HOST || "127.0.0.1";
  createServer(handle).listen(port, host, () => {
    console.log(`Trivia is running at http://${host}:${port}`);
  });
}
