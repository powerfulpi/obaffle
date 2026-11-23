import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { handle } from "./server.js";

test("host and player can complete a question without leaking the answer", async () => {
  const server = createServer(handle).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = "GET", data, token) {
    const response = await fetch(origin + path, {
      method,
      headers: { ...(data ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: data ? JSON.stringify(data) : undefined
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    const home = await fetch(origin);
    assert.match(await home.text(), /mobile\.css/);
    assert.equal(home.headers.get("cache-control"), "no-store");
    const mobileStyles = await fetch(origin + "/mobile.css");
    assert.equal(mobileStyles.status, 200);
    assert.match(mobileStyles.headers.get("content-type"), /text\/css/);
    assert.equal(mobileStyles.headers.get("cache-control"), "no-store");
    const created = await request("/api/games", "POST", { source: "set", setId: "starter", questionCount: 2, seconds: 20 });
    assert.equal(created.status, 201);
    const { code, hostToken } = created.data;
    const joined = await request("/api/join", "POST", { code, name: "Alex" });
    assert.equal(joined.status, 201);
    const playerToken = joined.data.playerToken;
    assert.equal((await request(`/api/games/${code}/state`)).status, 400);
    assert.equal((await request(`/api/games/${code}/next`, "POST", {}, playerToken)).status, 400);
    await request(`/api/games/${code}/next`, "POST", {}, hostToken);
    const beforeState = Date.now();
    let state = (await request(`/api/games/${code}/state`, "GET", null, playerToken)).data;
    assert.ok(state.serverNow >= beforeState && state.serverNow <= Date.now());
    assert.equal(state.phase, "reading");
    assert.equal((await request(`/api/games/${code}/answer`, "POST", { choice: 1 }, playerToken)).status, 400);
    assert.equal((await request(`/api/games/${code}/voice`, "GET", null, playerToken)).status, 400);
    await new Promise(resolve => setTimeout(resolve, 5_050));
    state = (await request(`/api/games/${code}/state`, "GET", null, playerToken)).data;
    assert.equal(state.phase, "question");
    assert.equal(state.question.answer, undefined);
    assert.equal(state.question.options.length, 4);
    assert.equal((await request(`/api/games/${code}/answer`, "POST", { choice: 1 }, playerToken)).status, 200);
    state = (await request(`/api/games/${code}/state`, "GET", null, hostToken)).data;
    assert.equal(state.players[0].answered, true);
    assert.equal(state.players[0].score, 0);
    assert.equal((await request(`/api/games/${code}/answer`, "POST", { choice: 1 }, playerToken)).status, 400);
    await request(`/api/games/${code}/end`, "POST", {}, hostToken);
    state = (await request(`/api/games/${code}/state`, "GET", null, playerToken)).data;
    assert.equal(state.question.answer, 1);
    assert.ok(state.players[0].score >= 100 && state.players[0].score <= 1000);
    assert.equal(state.myPoints, state.players[0].score);
    assert.equal((await request(`/api/games/${code}/next`, "POST", {}, hostToken)).status, 400);
    assert.equal((await request(`/api/games/${code}/leaderboard`, "POST", {}, playerToken)).status, 400);
    state = (await request(`/api/games/${code}/leaderboard`, "POST", {}, hostToken)).data;
    assert.equal(state.phase, "leaderboard");
    assert.equal((await request(`/api/games/${code}/state`, "GET", null, playerToken)).data.phase, "leaderboard");
    assert.equal((await request(`/api/games/${code}/restart`, "POST", {}, playerToken)).status, 400);
    state = (await request(`/api/games/${code}/restart`, "POST", {}, hostToken)).data;
    assert.equal(state.phase, "lobby");
    assert.equal(state.players[0].score, 0);
    assert.equal(state.players.length, 1);
    await request(`/api/games/${code}/next`, "POST", {}, hostToken);
    state = (await request(`/api/games/${code}/finish`, "POST", {}, hostToken)).data;
    assert.equal(state.phase, "finished");
    const christmas = await request("/api/games", "POST", { source: "set", setId: "christmas", theme: "thanksgiving", questionCount: 2, seconds: 20 });
    assert.equal(christmas.status, 201);
    state = (await request(`/api/games/${christmas.data.code}/state`, "GET", null, christmas.data.hostToken)).data;
    assert.equal(state.title, "Christmas");
    assert.equal(state.theme, "thanksgiving");
    const ai = await request("/api/games", "POST", { source: "ai", topic: "Planets", theme: "christmas", questions: [{ type: "boolean", question: "Earth is a planet.", options: ["True", "False"], answer: 0 }], questionCount: 1, seconds: 20 });
    assert.equal(ai.status, 201);
    state = (await request(`/api/games/${ai.data.code}/state`, "GET", null, ai.data.hostToken)).data;
    assert.equal(state.theme, "christmas");
    const autoEnd = await request("/api/games", "POST", { source: "set", setId: "starter", questionCount: 1, seconds: 20, autoEndOnAllAnswers: true });
    assert.equal(autoEnd.status, 201);
    state = (await request(`/api/games/${autoEnd.data.code}/state`, "GET", null, autoEnd.data.hostToken)).data;
    assert.equal(state.autoEndOnAllAnswers, true);
    assert.equal((await request("/api/games", "POST", { source: "set", setId: "starter", questionCount: 1, seconds: 20, autoEndOnAllAnswers: "yes" })).status, 400);
    assert.equal((await request("/api/games", "POST", { source: "set", setId: "starter", theme: "not-a-theme", questionCount: 1, seconds: 20 })).status, 400);
  } finally {
    server.close();
  }
});
