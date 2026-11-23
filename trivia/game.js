import { randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const token = () => randomBytes(24).toString("base64url");
const readingMilliseconds = 5_000;

export class GameStore {
  constructor(now = () => Date.now()) {
    this.games = new Map();
    this.now = now;
  }

  create({ title, theme = "starter", questions, seconds, questionCount, autoEndOnAllAnswers = false }) {
    for (const [existingCode, existingGame] of this.games) {
      if (this.now() - existingGame.createdAt > 24 * 60 * 60 * 1000) this.games.delete(existingCode);
    }
    let code;
    do {
      const bytes = randomBytes(6);
      code = Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
    } while (this.games.has(code));
    const game = {
      code, title, theme, questions: questions.slice(0, questionCount), seconds, autoEndOnAllAnswers, hostToken: token(),
      players: [], phase: "lobby", index: -1, endsAt: null, answers: new Map(), scored: false,
      createdAt: this.now()
    };
    this.games.set(code, game);
    return game;
  }

  get(code) {
    const game = this.games.get(String(code ?? "").toUpperCase());
    if (!game) throw new Error("Game not found. Check the code.");
    this.advanceTime(game);
    return game;
  }

  advanceTime(game) {
    if (game.phase === "reading" && this.now() >= game.endsAt) {
      game.phase = "question";
      game.endsAt += game.seconds * 1000;
    }
    if (game.phase === "question" && this.now() >= game.endsAt) this.reveal(game);
  }

  reveal(game) {
    if (game.scored) return;
    game.phase = "reveal";
    game.scored = true;
    const correct = game.questions[game.index].answer;
    for (const player of game.players) {
      const answer = game.answers.get(player.id);
      player.lastPoints = answer?.choice === correct ? answer.points : 0;
      player.score += player.lastPoints;
    }
  }

  join(game, name) {
    if (game.phase !== "lobby") throw new Error("This game has already started.");
    const cleanName = String(name ?? "").trim().replace(/\s+/g, " ");
    if (!cleanName || cleanName.length > 24) throw new Error("Enter a name of 1 to 24 characters.");
    if (game.players.length >= 50) throw new Error("This game is full.");
    if (game.players.some(player => player.name.toLowerCase() === cleanName.toLowerCase())) throw new Error("That name is taken.");
    const player = { id: token(), name: cleanName, token: token(), score: 0, lastPoints: 0 };
    game.players.push(player);
    return player;
  }

  requireHost(game, hostToken) {
    if (game.hostToken !== hostToken) throw new Error("Host access required.");
  }

  player(game, playerToken) {
    const player = game.players.find(entry => entry.token === playerToken);
    if (!player) throw new Error("Join the game first.");
    return player;
  }

  next(game) {
    if (game.phase === "reading" || game.phase === "question") throw new Error("Wait for the timer or end this question first.");
    if (game.phase === "finished") throw new Error("This game has ended.");
    if (game.phase === "reveal") throw new Error("Show the leaderboard before starting the next question.");
    if (game.phase === "lobby" && game.players.length === 0) throw new Error("Wait for at least one player to join.");
    if (game.index + 1 >= game.questions.length) {
      game.phase = "finished";
      game.endsAt = null;
      return;
    }
    game.index += 1;
    game.answers = new Map();
    game.scored = false;
    for (const player of game.players) player.lastPoints = 0;
    game.phase = "reading";
    game.endsAt = this.now() + readingMilliseconds;
  }

  showLeaderboard(game) {
    if (game.phase !== "reveal") throw new Error("Finish the question before showing the leaderboard.");
    game.phase = game.index + 1 >= game.questions.length ? "finished" : "leaderboard";
    if (game.phase === "finished") {
      game.endsAt = null;
      game.voiceAudio = null;
    }
  }

  endQuestion(game) {
    if (game.phase !== "question") throw new Error("No question is running.");
    this.reveal(game);
  }

  endGame(game) {
    if (game.phase === "finished") throw new Error("This game has already ended.");
    if (game.phase === "question") this.reveal(game);
    game.phase = "finished";
    game.endsAt = null;
    game.voiceAudio = null;
  }

  restart(game) {
    game.phase = "lobby";
    game.index = -1;
    game.endsAt = null;
    game.answers = new Map();
    game.scored = false;
    game.voiceAudio = null;
    for (const player of game.players) {
      player.score = 0;
      player.lastPoints = 0;
    }
  }

  answer(game, player, choice) {
    const answeredAt = this.now();
    if (game.phase !== "question" || answeredAt >= game.endsAt) throw new Error("The question is closed.");
    const question = game.questions[game.index];
    if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length) throw new Error("Choose a valid answer.");
    if (game.answers.has(player.id)) throw new Error("You already answered.");
    const remaining = game.endsAt - answeredAt;
    const points = Math.max(100, Math.round(1000 * remaining / (game.seconds * 1000)));
    game.answers.set(player.id, { choice, points });
    if (game.autoEndOnAllAnswers && game.answers.size === game.players.length) this.reveal(game);
  }

  state(game, role, player = null) {
    const question = game.index >= 0 ? game.questions[game.index] : null;
    const reveal = ["reveal", "leaderboard", "finished"].includes(game.phase);
    return {
      code: game.code, title: game.title, theme: game.theme, phase: game.phase, seconds: game.seconds,
      autoEndOnAllAnswers: game.autoEndOnAllAnswers,
      questionNumber: game.index + 1, totalQuestions: game.questions.length, endsAt: game.endsAt, serverNow: this.now(),
      ...(role === "host" ? { voiceAvailable: Boolean(game.voiceAudio) } : {}),
      question: question ? { type: question.type, question: question.question, options: question.options, ...(reveal ? { answer: question.answer } : {}) } : null,
      players: game.players.map(entry => ({ id: entry.id, name: entry.name, score: entry.score, lastPoints: entry.lastPoints, answered: game.answers.has(entry.id) })),
      ...(role === "player" ? { myId: player.id, myAnswer: game.answers.get(player.id)?.choice ?? null, myPoints: player.lastPoints } : {})
    };
  }
}
