import test from "node:test";
import assert from "node:assert/strict";
import { GameStore } from "./game.js";
import { questionSets, validateQuestions } from "./sets.js";

test("multiple choice and true or false answers score only after reveal", () => {
  let time = 1000;
  const store = new GameStore(() => time);
  const questions = validateQuestions(questionSets[0].questions);
  const game = store.create({ title: "Test", questions, seconds: 10, questionCount: 2 });
  const first = store.join(game, "Alex");
  const second = store.join(game, "Sam");
  store.next(game);
  assert.equal(game.phase, "reading");
  assert.equal(game.endsAt, time + 5_000);
  assert.equal(store.state(game, "host").serverNow, time);
  assert.throws(() => store.answer(game, first, 1), /closed/);
  time += 5_000;
  store.advanceTime(game);
  assert.equal(game.phase, "question");
  assert.equal(game.endsAt, time + 10_000);
  assert.equal(store.state(game, "player", first).question.answer, undefined);
  store.answer(game, first, 1);
  store.answer(game, second, 0);
  assert.equal(first.score, 0);
  assert.equal(game.phase, "question");
  assert.equal(store.state(game, "host").players[0].answered, true);
  assert.throws(() => store.answer(game, first, 1), /already answered/);
  time += 10_000;
  store.advanceTime(game);
  assert.equal(game.phase, "reveal");
  assert.equal(first.score, 1000);
  assert.equal(second.score, 0);
  assert.equal(store.state(game, "player", first).myPoints, 1000);
  assert.equal(store.state(game, "player", first).question.answer, 1);
  store.advanceTime(game);
  assert.equal(first.score, 1000);
  assert.throws(() => store.next(game), /Show the leaderboard/);
  store.showLeaderboard(game);
  assert.equal(store.state(game, "player", first).phase, "leaderboard");
  store.next(game);
  time += 5_000;
  store.advanceTime(game);
  assert.equal(store.state(game, "host").question.type, "boolean");
  assert.deepEqual(store.state(game, "host").question.options, ["True", "False"]);
  store.answer(game, second, 0);
  store.endQuestion(game);
  assert.equal(second.score, 1000);
  assert.throws(() => store.answer(game, first, 0), /closed/);
  store.showLeaderboard(game);
  assert.equal(game.phase, "finished");
});

test("faster correct answers earn more points and wrong answers earn none", () => {
  let time = 1000;
  const store = new GameStore(() => time);
  const game = store.create({ title: "Speed", questions: validateQuestions(questionSets[0].questions), seconds: 20, questionCount: 1 });
  const fast = store.join(game, "Fast");
  const slow = store.join(game, "Slow");
  const wrong = store.join(game, "Wrong");
  store.next(game);
  time += 5_000;
  store.advanceTime(game);
  time += 2_000;
  store.answer(game, fast, 1);
  time += 10_000;
  store.answer(game, slow, 1);
  store.answer(game, wrong, 0);
  assert.equal(fast.score, 0);
  store.endQuestion(game);
  assert.equal(fast.score, 900);
  assert.equal(slow.score, 400);
  assert.equal(wrong.score, 0);
  assert.equal(store.state(game, "player", slow).myPoints, 400);
  store.showLeaderboard(game);
  assert.throws(() => store.showLeaderboard(game), /Finish the question/);
});

test("optional auto-end reveals as soon as every player answers", () => {
  let time = 1000;
  const store = new GameStore(() => time);
  const game = store.create({ title: "Quick finish", questions: validateQuestions(questionSets[0].questions), seconds: 20, questionCount: 1, autoEndOnAllAnswers: true });
  const first = store.join(game, "Alex");
  const second = store.join(game, "Sam");
  store.next(game);
  time += 5_000;
  store.advanceTime(game);
  time += 2_000;
  store.answer(game, first, 1);
  assert.equal(game.phase, "question");
  time += 3_000;
  store.answer(game, second, 0);
  assert.equal(game.phase, "reveal");
  assert.equal(first.score, 900);
  assert.equal(second.score, 0);
  assert.equal(store.state(game, "host").autoEndOnAllAnswers, true);
  assert.throws(() => store.answer(game, second, 0), /closed/);
  store.advanceTime(game);
  assert.equal(first.score, 900);
});

test("late polling preserves the five-second reading phase and answer deadline", () => {
  let time = 10_000;
  const store = new GameStore(() => time);
  const game = store.create({ title: "Test", questions: validateQuestions(questionSets[0].questions), seconds: 10, questionCount: 1 });
  store.join(game, "Alex");
  store.next(game);
  time += 7_000;
  store.advanceTime(game);
  assert.equal(game.phase, "question");
  assert.equal(game.endsAt, 25_000);
  time += 9_000;
  store.advanceTime(game);
  assert.equal(game.phase, "reveal");
});

test("joining, answer values, and host access are validated", () => {
  const store = new GameStore();
  const game = store.create({ title: "Test", questions: validateQuestions(questionSets[0].questions), seconds: 20, questionCount: 1 });
  assert.throws(() => store.next(game), /at least one player/);
  store.join(game, "Alex");
  assert.throws(() => store.join(game, "alex"), /taken/);
  assert.throws(() => store.requireHost(game, "wrong"), /Host access/);
  store.next(game);
  assert.throws(() => store.join(game, "Sam"), /already started/);
  assert.throws(() => store.answer(game, game.players[0], 4), /closed/);
  assert.throws(() => store.next(game), /Wait for the timer/);
  assert.throws(() => store.endQuestion(game), /No question/);
});

test("questions and options must fit the phone layout", () => {
  assert.throws(() => validateQuestions([{
    type: "multiple", question: "Q".repeat(161), options: ["A", "B", "C", "D"], answer: 0
  }]), /too long for phone screens/);
  assert.throws(() => validateQuestions([{
    type: "multiple", question: "A question?", options: ["A".repeat(61), "B", "C", "D"], answer: 0
  }]), /too long for phone screens/);
});

test("all three themes have valid multiple-choice and true-or-false questions", () => {
  assert.deepEqual(questionSets.map(set => set.id), ["starter", "thanksgiving", "christmas"]);
  for (const set of questionSets) {
    assert.equal(validateQuestions(set.questions).length, 8);
    assert.ok(set.questions.some(question => question.type === "boolean"));
    assert.ok(set.questions.some(question => question.type === "multiple"));
  }
});

test("ending scores submitted answers and restarting keeps players but resets progress", () => {
  let time = 1000;
  const store = new GameStore(() => time);
  const game = store.create({ title: "Christmas", theme: "christmas", questions: validateQuestions(questionSets[2].questions), seconds: 20, questionCount: 2 });
  const player = store.join(game, "Alex");
  store.next(game);
  time += 5_000;
  store.advanceTime(game);
  store.answer(game, player, 1);
  store.endGame(game);
  assert.equal(store.state(game, "host").phase, "finished");
  assert.equal(store.state(game, "player", player).theme, "christmas");
  assert.equal(player.score, 1000);
  assert.throws(() => store.endGame(game), /already ended/);
  store.restart(game);
  assert.equal(game.phase, "lobby");
  assert.equal(game.index, -1);
  assert.equal(game.players[0], player);
  assert.equal(player.score, 0);
  assert.equal(store.state(game, "player", player).question, null);
  store.next(game);
  assert.equal(game.phase, "reading");
  store.endGame(game);
  assert.equal(game.phase, "finished");
});
