const musicPaths = {
  ambience: "/audio/ambience.mp3?v=20261122-sound",
  level1: "/audio/level-1.mp3?v=20261122-sound",
  level2: "/audio/level-2.mp3?v=20261122-sound",
  level3: "/audio/level-3.mp3?v=20261122-sound",
  level4: "/audio/level-4.mp3?v=20261122-sound",
  level5: "/audio/level-5.mp3?v=20261122-sound",
  level6: "/audio/level-6.mp3?v=20261122-sound"
};
const questionVolume = .4;
const ambienceVolume = .85;
const voiceDuckVolume = .12;

export function intensityLevel(remaining) {
  return Math.max(1, Math.min(6, 1 + Math.floor((60 - remaining) / 10)));
}

export function createHostAudio() {
  let enabled = localStorage.getItem("trivia-host-sound") !== "off";
  let context = null;
  let music = null;
  let voice = null;
  let musicGeneration = 0;
  let voiceGeneration = 0;
  let requestedMusic = null;
  const musicBuffers = new Map();

  function ready() {
    return context?.state === "running";
  }

  function loadMusic(kind) {
    if (!musicBuffers.has(kind)) {
      musicBuffers.set(kind, fetch(musicPaths[kind])
        .then(response => {
          if (!response.ok) throw new Error(`Music unavailable (${response.status}).`);
          return response.arrayBuffer();
        })
        .then(bytes => context.decodeAudioData(bytes)));
    }
    return musicBuffers.get(kind);
  }

  function unlock() {
    if (!enabled) return Promise.resolve();
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return Promise.resolve();
    context ||= new AudioContextType();
    for (const kind of Object.keys(musicPaths)) void loadMusic(kind).catch(() => musicBuffers.delete(kind));
    return context.resume().catch(() => {});
  }

  function fadeOut(active, duration = .08) {
    if (!active || !context) return;
    active.gain.gain.setTargetAtTime(0, context.currentTime, duration);
    setTimeout(() => { try { active.source.stop(); } catch {} }, duration * 5000);
  }

  function stopMusic() {
    musicGeneration += 1;
    requestedMusic = null;
    fadeOut(music);
    music = null;
  }

  function stopVoice() {
    voiceGeneration += 1;
    fadeOut(voice);
    voice = null;
  }

  function tone(frequency, delay, duration, volume, wave = "sine") {
    if (!enabled || !ready()) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  }

  function newQuestion() {
    tone(523, 0, .16, .085);
    tone(659, .11, .19, .085);
    tone(784, .22, .3, .1);
  }

  function tick(urgent, remaining) {
    if (urgent) {
      tone(remaining <= 3 ? 1100 : 880, 0, remaining <= 3 ? .19 : .12, .09, "triangle");
      if (remaining <= 3) tone(660, .11, .11, .055, "triangle");
    } else {
      tone(620, 0, .055, .035, "triangle");
    }
  }

  async function startMusic(kind) {
    if (!enabled || !ready()) return;
    if (requestedMusic === kind) return;
    requestedMusic = kind;
    const generation = ++musicGeneration;
    try {
      const buffer = await loadMusic(kind);
      if (generation !== musicGeneration || !enabled || !ready()) return;
      const previous = music;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain).connect(context.destination);
      source.start();
      music = { source, gain, kind };
      gain.gain.setTargetAtTime(kind === "ambience" ? ambienceVolume : voice ? voiceDuckVolume : questionVolume, context.currentTime, .3);
      fadeOut(previous, .3);
    } catch (error) {
      musicBuffers.delete(kind);
      if (generation === musicGeneration) requestedMusic = null;
      console.warn(error.message);
    }
  }

  async function speak(code, token) {
    if (!enabled || !ready()) return;
    const generation = ++voiceGeneration;
    try {
      const response = await fetch(`/api/games/${code}/voice`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error(`Question voice unavailable (${response.status}).`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (generation !== voiceGeneration || !enabled || !ready()) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = .8;
      source.connect(gain).connect(context.destination);
      source.onended = () => {
        if (voice?.source !== source) return;
        voice = null;
        if (music?.kind !== "ambience") music?.gain.gain.setTargetAtTime(questionVolume, context.currentTime, .2);
      };
      voice = { source, gain };
      source.start();
    } catch (error) {
      console.warn(error.message);
    }
  }

  function intensity(remaining) {
    if (!enabled || !ready()) return;
    void startMusic(`level${intensityLevel(remaining)}`);
  }

  function phase(state, token, remaining) {
    if (state.phase === "reading") {
      stopMusic();
      stopVoice();
      newQuestion();
      if (state.voiceAvailable) void speak(state.code, token);
    } else if (state.phase === "question") {
      if (!voice) voiceGeneration += 1;
      intensity(remaining);
    } else if (["reveal", "leaderboard", "finished"].includes(state.phase)) {
      stopVoice();
      void startMusic("ambience");
    } else {
      stopVoice();
      stopMusic();
    }
  }

  async function toggle(state, token, remaining) {
    if (enabled && ready()) {
      enabled = false;
      stopVoice();
      stopMusic();
    } else {
      enabled = true;
      await unlock();
      phase(state, token, remaining);
      if (state.phase === "lobby") newQuestion();
    }
    localStorage.setItem("trivia-host-sound", enabled ? "on" : "off");
  }

  function label() {
    return !enabled ? "🔇 Sound off" : ready() ? "🔊 Sound on" : "🔊 Enable sound";
  }

  return { unlock, phase, intensity, tick, toggle, label };
}
