import { createHostAudio } from "./audio.js?v=20261122-podium";

const app = document.querySelector("#app");
const queryCode = new URLSearchParams(location.search).get("code")?.toUpperCase() || "";
const saved = JSON.parse(sessionStorage.getItem("trivia-session") || "null");
let session = saved?.code === queryCode || !queryCode ? saved : null;
let currentState = null;
let generatedQuestions = null;
let polling = null;
let timerPolling = null;
let busy = false;
let serverClock = { time: Date.now(), observedAt: performance.now() };
let lastTickSecond = null;
let playerResultKey = null;
let playerResultDetails = false;
let playerResultTimer = null;
const hostAudio = createHostAudio();
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function applyTheme(theme) {
  document.body.classList.remove("theme-thanksgiving", "theme-christmas");
  if (theme === "thanksgiving" || theme === "christmas") document.body.classList.add(`theme-${theme}`);
}

async function api(path, method = "GET", data = null, token = session?.token) {
  const response = await fetch(path, {
    method,
    headers: { ...(data ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

function errorMessage(message) {
  const existing = document.querySelector(".notice");
  if (existing) existing.remove();
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "alert");
  notice.textContent = message;
  app.prepend(notice);
}

function updateFullscreenButton() {
  const button = document.querySelector("#fullscreen-toggle");
  if (!button) return;
  const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const label = active ? "Exit full screen" : "Full screen";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.querySelector(".fullscreen-label").textContent = label;
  button.querySelector(".fullscreen-icon").textContent = active ? "×" : "⛶";
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else await document.webkitExitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      await document.documentElement.webkitRequestFullscreen();
    } else {
      throw new Error("Full screen is not available in this browser.");
    }
    updateFullscreenButton();
  } catch (error) {
    errorMessage("Full screen is not available here. Try your browser's full-screen option.");
  }
}

function saveSession(code, token, role) {
  session = { code, token, role };
  sessionStorage.setItem("trivia-session", JSON.stringify(session));
  history.replaceState(null, "", role === "host" ? "/" : `/join?code=${code}`);
  startPolling();
}

function home() {
  clearInterval(polling);
  clearInterval(timerPolling);
  resetPlayerResult();
  applyTheme("starter");
  hostAudio.phase({ phase: "lobby" });
  document.body.classList.remove("game-active", "player-game-active", "final-countdown");
  app.innerHTML = `<section class="hero"><div><div class="eyebrow">Your next game night starts here</div><h1>Good questions.<br><span class="accent">Great company.</span></h1><p class="lead">Bring everyone into the game. Put the questions on the big screen, let friends answer on their phones, and see who knows their stuff.</p><div class="actions"><button class="button" id="host-button">Create a game</button><button class="button secondary" id="join-button">Join a game</button></div></div><div class="hero-art" aria-hidden="true"><div class="art-top"><span>QUESTION 04 / 08</span><span>● LIVE</span></div><div class="art-question">Which planet has the most prominent rings?</div><div class="art-options"><div class="art-option">A &nbsp; Mars</div><div class="art-option">B &nbsp; Saturn</div><div class="art-option">C &nbsp; Venus</div><div class="art-option">D &nbsp; Mercury</div></div><div class="art-bottom"><div class="mini-avatars"><span>J</span><span>M</span><span>A</span></div><span>3 friends are playing</span></div></div></section>`;
  document.querySelector("#host-button").onclick = hostForm;
  document.querySelector("#join-button").onclick = () => joinForm("");
}

async function hostForm() {
  clearInterval(polling);
  clearInterval(timerPolling);
  resetPlayerResult();
  applyTheme("starter");
  hostAudio.phase({ phase: "lobby" });
  document.body.classList.remove("game-active", "player-game-active", "final-countdown");
  let sets = [];
  try { ({ sets } = await api("/api/sets")); }
  catch (error) { errorMessage(error.message); return; }
  const designs = [
    { id: "starter", title: "Original", icon: "✦", description: "Purple and gold, the familiar look." },
    { id: "thanksgiving", title: "Thanksgiving", icon: "🍂", description: "Warm amber and autumn colors." },
    { id: "christmas", title: "Christmas", icon: "🎄", description: "Evergreen, red, and winter gold." }
  ];
  const designChoices = designs.map((design, index) => `<label class="theme-option theme-option-${design.id}"><input type="radio" name="theme" value="${design.id}" ${index === 0 ? "checked" : ""}><span class="theme-icon" aria-hidden="true">${design.icon}</span><strong>${design.title}</strong><span>${design.description}</span><small>Design only</small></label>`).join("");
  app.innerHTML = `<section class="form-wrap"><div class="eyebrow">Set the stage</div><h2>Create a game</h2><p class="muted">Choose a look, pick your questions, and set the pace before players join.</p><form class="panel" id="create-form"><div class="field"><span>Website design</span><div class="theme-options" role="radiogroup" aria-label="Website design">${designChoices}</div></div><div class="field"><span>Question source</span><div class="source-cards"><label class="source-card"><input type="radio" name="source" value="set" checked><strong>Ready-made set</strong><span>Pick a curated pack and play.</span></label><label class="source-card"><input type="radio" name="source" value="ai"><strong>Make it with Gemini</strong><span>Generate questions around any topic.</span></label></div></div><div id="source-fields"></div><div class="two-fields"><div class="field"><label for="count">Questions</label><input id="count" type="number" min="1" max="30" value="8" required></div><div class="field"><label for="seconds">Seconds per question</label><input id="seconds" type="number" min="5" max="120" value="20" required></div></div><div class="field"><label for="host-pin">Host PIN <span class="muted">(if configured)</span></label><input id="host-pin" type="password" autocomplete="off" placeholder="Optional on local setup"></div><div id="review-area"></div><button class="button" id="create-button" type="submit">Create game</button></form></section>`;
  const form = document.querySelector("#create-form");
  const timerSetting = document.createElement("div");
  timerSetting.className = "field";
  timerSetting.innerHTML = '<label for="auto-end">When everyone has answered</label><select id="auto-end"><option value="no">Keep the timer running</option><option value="yes">Reveal answers immediately</option></select><small>This applies to every question in the game.</small>';
  form.querySelector("#host-pin").closest(".field").before(timerSetting);
  const countInput = form.querySelector("#count");
  const sourceFields = form.querySelector("#source-fields");
  form.querySelectorAll('input[name="theme"]').forEach(input => input.onchange = () => applyTheme(input.value));
  function drawSource() {
    generatedQuestions = null;
    form.querySelector("#review-area").innerHTML = "";
    const source = form.elements.source.value;
    if (source === "set") {
      sourceFields.innerHTML = `<div class="field"><label for="set-id">Question set</label><select id="set-id">${sets.map(set => `<option value="${escape(set.id)}">${escape(set.title)} · ${set.count} questions</option>`).join("")}</select><small id="set-description"></small></div>`;
      const select = form.querySelector("#set-id");
      const updateSet = () => { const set = sets.find(item => item.id === select.value); countInput.max = set.count; countInput.value = set.count; form.querySelector("#set-description").textContent = set.description; };
      select.onchange = updateSet;
      updateSet();
    } else {
      countInput.max = 20;
      countInput.value = 8;
      sourceFields.innerHTML = `<div class="field"><label for="topic">Topic prompt</label><input id="topic" maxlength="200" placeholder="e.g. 90s movies, space, our family vacation" required><small>Gemini creates a mix of multiple choice and true or false questions.</small></div><button class="button secondary small" id="generate-button" type="button">Generate &amp; review questions</button>`;
      form.querySelector("#generate-button").onclick = generate;
    }
  }
  form.querySelectorAll('input[name="source"]').forEach(input => input.onchange = drawSource);
  drawSource();
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const source = form.elements.source.value;
    const questionCount = Number(countInput.value);
    if (source === "ai" && (!generatedQuestions || generatedQuestions.length !== questionCount)) { errorMessage("Generate and review the questions first."); return; }
    busy = true;
    form.querySelector("#create-button").disabled = true;
    try {
      const data = await api("/api/games", "POST", {
        source, theme: form.querySelector('input[name="theme"]:checked')?.value,
        setId: form.querySelector("#set-id")?.value, topic: form.querySelector("#topic")?.value,
        questions: generatedQuestions, questionCount, seconds: Number(form.querySelector("#seconds").value),
        autoEndOnAllAnswers: form.querySelector("#auto-end").value === "yes",
        hostPin: form.querySelector("#host-pin").value
      }, null);
      saveSession(data.code, data.hostToken, "host");
    } catch (error) { errorMessage(error.message); }
    finally { busy = false; form.querySelector("#create-button")?.removeAttribute("disabled"); }
  };
  async function generate() {
    if (busy) return;
    busy = true;
    const button = form.querySelector("#generate-button");
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>Generating…';
    try {
      const data = await api("/api/generate", "POST", { topic: form.querySelector("#topic").value, count: Number(countInput.value), hostPin: form.querySelector("#host-pin").value }, null);
      generatedQuestions = data.questions;
      form.querySelector("#review-area").innerHTML = `<div class="review"><strong>Review your questions and answers</strong>${generatedQuestions.map((question, index) => `<p>${index + 1}. ${escape(question.question)} <span class="muted">(${question.type === "boolean" ? "True / False" : "Multiple choice"})</span><br><span class="accent">Answer: ${escape(question.options[question.answer])}</span></p>`).join("")}</div>`;
    } catch (error) { errorMessage(error.message); }
    finally { busy = false; button.disabled = false; button.textContent = "Regenerate questions"; }
  }
}

function joinForm(code) {
  clearInterval(polling);
  clearInterval(timerPolling);
  resetPlayerResult();
  applyTheme("starter");
  document.body.classList.remove("game-active", "player-game-active", "final-countdown");
  app.innerHTML = `<section class="form-wrap narrow"><div class="eyebrow">You're invited</div><h2>Join the game</h2><p class="muted">Enter your code and a name everyone will recognize.</p><form class="panel" id="join-form"><div class="field"><label for="join-code">Game code</label><input id="join-code" maxlength="6" autocapitalize="characters" autocomplete="off" value="${escape(code)}" placeholder="ABC123" required></div><div class="field"><label for="player-name">Your name</label><input id="player-name" maxlength="24" autocomplete="nickname" placeholder="Your name" required></div><button class="button" type="submit">Join game</button></form></section>`;
  document.querySelector("#join-form").onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const result = await api("/api/join", "POST", { code: form.querySelector("#join-code").value.toUpperCase(), name: form.querySelector("#player-name").value }, null);
      saveSession(result.code, result.playerToken, "player");
    } catch (error) { errorMessage(error.message); button.disabled = false; }
  };
}

function rankedPlayers(state) {
  return [...state.players].sort((first, second) => second.score - first.score || first.name.localeCompare(second.name));
}

function podiumSlot(player, place) {
  if (!player) return `<div class="podium-slot podium-empty" aria-hidden="true"></div>`;
  const label = ["", "first", "second", "third"][place];
  return `<div class="podium-slot podium-${label}" role="listitem" aria-label="${place}${place === 1 ? "st" : place === 2 ? "nd" : "rd"} place: ${escape(player.name)}, ${player.score.toLocaleString()} points"><div class="podium-person"><span class="podium-crown" aria-hidden="true">${place === 1 ? "✦" : place === 2 ? "◆" : "●"}</span><strong>${escape(player.name)}</strong><span>${player.score.toLocaleString()} pts</span></div><div class="podium-step"><strong>${place}</strong><span>PLACE</span></div></div>`;
}

function finalConfetti() {
  const pieces = Array.from({ length: 64 }, (unused, index) => {
    const position = (index * 47) % 100;
    const drift = (index * 29) % 51 - 25;
    const spin = 360 + (index * 73) % 720;
    const delay = (3.5 + ((index * 17) % 50) / 100).toFixed(2);
    return `<span class="confetti-piece" style="--confetti-x:${position}%;--confetti-drift:${drift}vw;--confetti-spin:${spin}deg;--confetti-delay:${delay}s"></span>`;
  }).join("");
  return `<div class="confetti-burst" aria-hidden="true">${pieces}</div>`;
}

function resultsView(state, isHost) {
  const ranked = rankedPlayers(state);
  const finished = state.phase === "finished";
  const action = isHost
    ? finished
      ? '<button class="button results-action" id="new-game">New game</button>'
      : '<button class="button results-action" id="next-button">Next question</button>'
    : `<p class="results-wait">${finished ? "Thanks for playing!" : "Waiting for the host to continue…"}</p>`;
  const rows = ranked.map((player, index) => `<div class="standings-row ${player.id === state.myId ? "you" : ""}" style="--row-delay:${(0.35 + Math.min(index, 8) * 0.13).toFixed(2)}s"><span class="standings-rank">${index + 1}</span><strong>${escape(player.name)}${player.id === state.myId ? ' <small>(you)</small>' : ""}</strong><span class="standings-gain">${player.lastPoints ? `+${player.lastPoints.toLocaleString()}` : ""}</span><b>${player.score.toLocaleString()}</b></div>`).join("");
  const podium = finished ? `<div class="podium" role="list" aria-label="Top three players">${podiumSlot(ranked[1], 2)}${podiumSlot(ranked[0], 1)}${podiumSlot(ranked[2], 3)}</div>` : "";
  return `<div class="results-screen ${isHost ? "host-results" : "player-results"} ${finished ? "final-results" : "round-results"}"><div class="results-heading"><div class="eyebrow">${finished ? "Final results" : `Question ${state.questionNumber} complete`}</div><h2>${finished ? "The final podium" : "Round standings"}</h2><p>Fast correct answers earn more points.</p></div>${podium}<div class="standings-list"><div class="standings-title">${finished ? "All players" : "Player"} <span>${finished ? "Points" : "Round · Total"}</span></div><div class="standings-rows">${rows}</div></div>${action}${finished && ranked.length ? finalConfetti() : ""}</div>`;
}

function playerChips(state) {
  return state.players.map(player => `<div class="player-chip"><span class="status-icon ${player.answered ? "done" : ""}" aria-label="${player.answered ? "Answered" : "Not answered"}">${player.answered ? "✓" : ""}</span>${escape(player.name)}</div>`).join("");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Could not copy the link. Select it instead.");
}

function questionCard(state, isHost, animate = false) {
  const question = state.question;
  const reading = state.phase === "reading";
  const revealed = state.phase === "reveal" || state.phase === "finished";
  const answered = state.myAnswer !== null && state.myAnswer !== undefined;
  const answers = reading
    ? '<div class="reading-message">Listen to the question. Answers appear shortly.</div>'
    : `<div class="answer-grid ${question.type}">${question.options.map((option, index) => `<button class="answer-tile ${revealed && question.answer === index ? "correct" : ""} ${!isHost && answered && state.myAnswer === index ? "selected" : ""}" data-choice="${index}" ${isHost || revealed || answered ? "disabled" : ""}><span class="letter">${String.fromCharCode(65 + index)}</span><span class="answer-text">${escape(option)}</span></button>`).join("")}</div>`;
  return `<div class="question-card ${reading ? "reading" : ""} ${animate ? "enter" : ""}"><div class="eyebrow">Question ${state.questionNumber} of ${state.totalQuestions} · ${question.type === "boolean" ? "True or false" : "Multiple choice"}</div><h2><span class="question-text">${escape(question.question)}</span></h2>${answers}${revealed ? `<div class="reveal">✓ Correct answer: ${escape(question.options[question.answer])}</div>` : ""}</div>`;
}

function fitPlayerQuestion() {
  const view = document.querySelector(".player-view.active");
  if (!view || innerWidth > 700) return;
  const title = view.querySelector(".question-card h2");
  if (!title) return;
  const questionText = title.querySelector(".question-text");
  const options = [...view.querySelectorAll(".answer-tile")];
  let questionSize = 26;
  let answerSize = 17;
  view.style.setProperty("--mobile-question-size", `${questionSize}px`);
  view.style.setProperty("--mobile-answer-size", `${answerSize}px`);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const questionClipped = questionText.offsetHeight > title.clientHeight + 1;
    const answerClipped = options.some(option => {
      const style = getComputedStyle(option);
      const available = option.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      return option.querySelector(".answer-text").offsetHeight > available + 1;
    });
    if (!questionClipped && !answerClipped) break;
    if (questionClipped && questionSize > 14) view.style.setProperty("--mobile-question-size", `${--questionSize}px`);
    if (answerClipped && answerSize > 13) view.style.setProperty("--mobile-answer-size", `${--answerSize}px`);
  }
}

function timer(state) {
  if (state.phase !== "reading" && state.phase !== "question") return "";
  const remaining = remainingSeconds(state);
  return `<div class="timer-card ${state.phase === "reading" ? "reading-timer" : remaining <= 10 ? "urgent" : ""}" id="timer"><div class="timer-label">${state.phase === "reading" ? "Answers in" : "Time left"}</div><div class="timer-number" id="time-number">${remaining}</div><div>seconds</div></div>`;
}

function remainingSeconds(state) {
  const serverNow = serverClock.time + performance.now() - serverClock.observedAt;
  return Math.max(0, Math.ceil((state.endsAt - serverNow) / 1000));
}

function soundButton() {
  return `<button class="button secondary small sound-toggle" type="button">${hostAudio.label()}</button>`;
}

function hostView(state, joinLink, animate) {
  const title = state.phase === "lobby" ? "Game lobby" : state.phase === "finished" ? "Final scores" : "Let's play";
  const heading = `<div class="stage-head"><div><div class="eyebrow">${escape(state.title)}</div><h2>${title}</h2></div><span class="pill">${state.players.length} player${state.players.length === 1 ? "" : "s"}</span></div>`;
  let content;
  if (state.phase === "lobby") {
    content = `<div class="panel"><div class="eyebrow">Join at this link</div><div class="code">${state.code}</div><div class="join-link"><a href="${escape(joinLink)}"><code>${escape(joinLink)}</code></a><button class="button secondary small" id="copy-link">Copy link</button></div>${["localhost", "127.0.0.1"].includes(location.hostname) ? '<p class="muted">For phones to use the link, open this app through your computer’s LAN IP or public address first.</p>' : ""}<div class="players">${playerChips(state)}</div>${state.players.length ? "" : '<div class="empty">Waiting for players to join…</div>'}<div class="lobby-actions"><button class="button" id="next-button" ${state.players.length ? "" : "disabled"}>Start game</button>${soundButton()}</div><p class="muted sound-note">Tap the sound button to enable and test host audio before starting. Players' phones stay silent.</p></div>`;
  } else if (state.phase === "leaderboard" || state.phase === "finished") {
    content = resultsView(state, true);
  } else {
    const status = `<div class="side-box answer-status"><strong>${state.phase === "reading" ? "Players" : "Answers in"}</strong><div class="players">${playerChips(state)}</div></div>`;
    const action = state.phase === "reading"
      ? '<div class="side-box muted">Answers open automatically after the read-aloud.</div>'
      : state.phase === "question"
        ? '<button class="button secondary" id="end-button">End question</button>'
        : `<button class="button" id="leaderboard-button">${state.questionNumber === state.totalQuestions ? "Show final results" : "Show leaderboard"}</button>`;
    content = `<div class="question-layout">${questionCard(state, true, animate)}<aside class="side-panel">${timer(state)}${status}${action}${soundButton()}</aside></div>`;
  }
  const overlay = state.phase === "question" ? '<div class="countdown-overlay" aria-hidden="true"><span class="countdown-label">Final seconds</span><strong id="big-time-number">10</strong><span class="countdown-subtitle">Lock in your answers</span></div>' : "";
  const menu = `<details class="host-menu"><summary aria-label="Game options" title="Game options">⋮</summary><div class="host-menu-popover"><button type="button" id="restart-game">Restart game</button>${state.phase === "finished" ? "" : '<button type="button" id="finish-game">End game</button>'}</div></details>`;
  const controls = `<div class="host-controls"><button class="fullscreen-toggle" id="fullscreen-toggle" type="button" aria-label="Full screen" title="Full screen"><span class="fullscreen-icon" aria-hidden="true">⛶</span><span class="fullscreen-label">Full screen</span></button>${menu}</div>`;
  return `<section class="stage">${heading}${content}${controls}</section>${overlay}`;
}

function resetPlayerResult() {
  clearTimeout(playerResultTimer);
  playerResultTimer = null;
  playerResultKey = null;
  playerResultDetails = false;
}

function playerResult(state) {
  const key = `${state.code}:${state.questionNumber}`;
  if (playerResultKey !== key) {
    resetPlayerResult();
    playerResultKey = key;
    playerResultTimer = setTimeout(() => {
      if (currentState?.phase !== "reveal" || `${currentState.code}:${currentState.questionNumber}` !== key) return;
      playerResultDetails = true;
      renderGame(currentState);
    }, 2_000);
  }
  const correct = state.myAnswer === state.question.answer;
  const missed = state.myAnswer === null;
  const status = correct ? "correct" : missed ? "missed" : "incorrect";
  const symbol = correct ? "✓" : "×";
  const heading = correct ? "Correct!" : missed ? "Time's up" : "Not quite";
  const description = correct ? `+${state.myPoints.toLocaleString()} points` : missed ? "You didn't lock in an answer." : "That wasn't the answer.";
  if (!playerResultDetails) {
    return `<section class="player-result ${status} intro" role="status" aria-live="assertive"><div class="result-symbol" aria-hidden="true">${symbol}</div><h2>${heading}</h2><p>${description}</p></section>`;
  }
  const yourAnswer = missed ? "No answer submitted" : state.question.options[state.myAnswer];
  return `<section class="player-result ${status} details" role="status"><div class="result-details"><div class="result-symbol" aria-hidden="true">${symbol}</div><h2>${heading}</h2>${correct ? `<p class="result-points">+${state.myPoints.toLocaleString()} points</p>` : ""}<p class="result-question">${escape(state.question.question)}</p><div class="result-answer-list"><div class="result-answer"><span>Your answer</span><strong>${escape(yourAnswer)}</strong></div>${correct ? "" : `<div class="result-answer right-answer"><span>Correct answer</span><strong>${escape(state.question.options[state.question.answer])}</strong></div>`}</div><p class="result-wait">Waiting for the leaderboard…</p></div></section>`;
}

function renderGame(state, animate = false) {
  const isHost = session.role === "host";
  applyTheme(state.theme);
  const playing = ["reading", "question", "reveal", "leaderboard", "finished"].includes(state.phase);
  document.body.classList.toggle("game-active", playing);
  const playerActive = !isHost && ["reading", "question", "reveal"].includes(state.phase);
  document.body.classList.toggle("player-game-active", playerActive);
  const joinLink = `${location.origin}/join?code=${state.code}`;
  if (isHost) {
    app.innerHTML = hostView(state, joinLink, animate);
    updateFullscreenButton();
    document.querySelector("#fullscreen-toggle").addEventListener("click", toggleFullscreen);
    document.querySelector("#copy-link")?.addEventListener("click", async event => {
      try { await copyText(joinLink); event.currentTarget.textContent = "Copied!"; }
      catch (error) { errorMessage(error.message); }
    });
    document.querySelector("#next-button")?.addEventListener("click", () => hostAction("next"));
    document.querySelector("#leaderboard-button")?.addEventListener("click", () => hostAction("leaderboard"));
    document.querySelector("#end-button")?.addEventListener("click", () => hostAction("end"));
    document.querySelector("#new-game")?.addEventListener("click", () => { sessionStorage.removeItem("trivia-session"); session = null; hostForm(); });
    document.querySelector("#restart-game")?.addEventListener("click", () => {
      if (confirm("Restart this game? Scores and progress will reset, but players stay joined.")) hostAction("restart");
    });
    document.querySelector("#finish-game")?.addEventListener("click", () => {
      if (confirm("End this game now and show final scores?")) hostAction("finish");
    });
    document.querySelector(".sound-toggle")?.addEventListener("click", async event => {
      await hostAudio.toggle(state, session.token, state.phase === "question" ? remainingSeconds(state) : 0);
      event.currentTarget.textContent = hostAudio.label();
    });
  } else {
    const self = state.players.find(player => player.id === state.myId);
    if (state.phase !== "reveal") resetPlayerResult();
    app.innerHTML = state.phase === "leaderboard" || state.phase === "finished"
      ? resultsView(state, false)
      : state.phase === "reveal"
      ? playerResult(state)
      : playerActive
      ? `<section class="player-view active"><div class="player-topbar"><span class="pill">Question ${state.questionNumber} of ${state.totalQuestions}</span><span class="player-name">${escape(self?.name || "Player")}</span></div><div class="player-play-area">${timer(state)}${questionCard(state, false, animate)}<p class="player-hint">${state.phase === "reading" ? "Read the question. Answers open in a moment." : state.myAnswer !== null ? "Answer locked in. Waiting for everyone else…" : "Tap your answer before time runs out."}</p></div></section>`
      : `<section class="player-view"><div class="stage-head"><div><div class="eyebrow">${escape(state.title)}</div><h2>You're in!</h2></div><span class="pill">${escape(self?.name || "Player")}</span></div><div class="panel center"><div class="score-big">✓</div><h3>Waiting for the host</h3><p class="muted">Keep this page open. Questions will appear here when the game begins.</p><div class="players">${playerChips(state)}</div></div></section>`;
    document.querySelectorAll("[data-choice]:not(:disabled)").forEach(button => button.addEventListener("click", () => answer(Number(button.dataset.choice))));
    if (playerActive) requestAnimationFrame(fitPlayerQuestion);
  }
}

async function hostAction(action) {
  if (busy) return;
  if (action === "next") void hostAudio.unlock();
  busy = true;
  const button = document.querySelector(action === "next" ? "#next-button" : action === "end" ? "#end-button" : action === "leaderboard" ? "#leaderboard-button" : `#${action === "restart" ? "restart" : "finish"}-game`);
  const originalLabel = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = action === "next" ? "Preparing question…" : action === "end" ? "Ending question…" : action === "leaderboard" ? "Showing leaderboard…" : action === "restart" ? "Restarting…" : "Ending game…";
  }
  try { await api(`/api/games/${session.code}/${action}`, "POST"); await refresh(); }
  catch (error) { errorMessage(error.message); }
  finally { busy = false; if (button?.isConnected) { button.disabled = false; button.textContent = originalLabel; } }
}

async function answer(choice) {
  if (busy) return;
  busy = true;
  try { await api(`/api/games/${session.code}/answer`, "POST", { choice }); await refresh(); }
  catch (error) { errorMessage(error.message); }
  finally { busy = false; }
}

function updateTimer() {
  if (!currentState || (currentState.phase !== "reading" && currentState.phase !== "question")) {
    document.body.classList.remove("final-countdown");
    return;
  }
  const remaining = remainingSeconds(currentState);
  const number = document.querySelector("#time-number");
  const card = document.querySelector("#timer");
  if (number) number.textContent = remaining;
  if (card) card.classList.toggle("urgent", currentState.phase === "question" && remaining <= 10);
  const finalCountdown = session?.role === "host" && currentState.phase === "question" && remaining <= 10;
  document.body.classList.toggle("final-countdown", finalCountdown);
  const bigNumber = document.querySelector("#big-time-number");
  if (bigNumber && bigNumber.textContent !== String(remaining)) {
    bigNumber.textContent = remaining;
    bigNumber.classList.remove("beat");
    void bigNumber.offsetWidth;
    bigNumber.classList.add("beat");
  }
  if (session?.role === "host" && currentState.phase === "question" && lastTickSecond !== remaining) {
    if (lastTickSecond !== null && remaining > 0 && remaining < lastTickSecond) hostAudio.tick(remaining <= 10, remaining);
    lastTickSecond = remaining;
  }
  if (session?.role === "host" && currentState.phase === "question") hostAudio.intensity(remaining);
}

async function refresh() {
  if (!session) return;
  try {
    const startedAt = performance.now();
    const { serverNow, ...state } = await api(`/api/games/${session.code}/state`);
    const receivedAt = performance.now();
    serverClock = {
      time: Number.isFinite(serverNow) ? serverNow + (receivedAt - startedAt) / 2 : Date.now(),
      observedAt: receivedAt
    };
    const snapshot = JSON.stringify(state);
    if (snapshot !== JSON.stringify(currentState)) {
      const changedPhase = !currentState || currentState.phase !== state.phase || currentState.questionNumber !== state.questionNumber;
      const animate = changedPhase;
      currentState = state;
      renderGame(state, animate);
      if (changedPhase && session.role === "host") {
        lastTickSecond = null;
        hostAudio.phase(state, session.token, state.phase === "question" ? remainingSeconds(state) : 0);
      }
    }
    updateTimer();
  } catch (error) {
    clearInterval(polling);
    sessionStorage.removeItem("trivia-session");
    session = null;
    home();
    errorMessage(error.message);
  }
}

function startPolling() {
  clearInterval(polling);
  clearInterval(timerPolling);
  currentState = null;
  lastTickSecond = null;
  refresh();
  polling = setInterval(refresh, 800);
  timerPolling = setInterval(updateTimer, 100);
}

if (session) startPolling();
else if (queryCode || location.pathname === "/join") joinForm(queryCode);
else home();

window.addEventListener("resize", () => requestAnimationFrame(fitPlayerQuestion));
window.visualViewport?.addEventListener("resize", () => requestAnimationFrame(fitPlayerQuestion));
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
