import "../css/styles.css";
import {
  clampDuration,
  parseDuration,
  formatClock,
  displaySeconds,
  toParam,
  formatEndTime,
} from "./time.js";
import { createBotElement, setEyes, setHeroLevel, PALETTE } from "./shapes.js";

const STORE_KEY = "grok-bot-timer";
const ACCENT = "#9B6BFF";

const $ = (id) => document.getElementById(id);
const worldEl = $("world");
const confettiEl = $("confetti");
const clockEl = $("clock");
const typedEl = $("typed");
const subEl = $("sub");
const heroEl = $("hero");
const heroWrapEl = heroEl.parentElement;
const endScreenEl = $("end-screen");
const themeBtn = $("theme");
const startBtn = $("start");
const hintEl = $("hint");
const focusDock = $("focus-dock");
const focusPauseBtn = $("focus-pause");

let theme = "light";
let mode = "timer";
let soundOn = false;
let alarmHHMM = "16:30";
let timerSeconds = 600;
let laps = [];
let armed = 600;
let state = "idle";
let virtual = 0;
let endVirtual = 0;
let runSpan = 600;
let lastTs = 0;
let motionClock = 0;
let bots = [];
let bursts = [];
let hero = null;
let audioCtx = null;
let width = window.innerWidth;
let height = window.innerHeight;
let nextId = 1;
let wind = 28;
let nextSpawnAt = 700;
let nextCatch = 8000;
let pageHidden = false;
let editing = false;
let dockTimer = 0;

function prefersReduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ seconds: timerSeconds, theme, sound: soundOn, mode, alarm: alarmHHMM }),
    );
  } catch {
    /* private mode */
  }
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("t");
  url.searchParams.delete("mode");
  url.searchParams.delete("alarm");
  if (mode === "stopwatch") url.searchParams.set("mode", "stopwatch");
  else if (mode === "alarm") url.searchParams.set("alarm", alarmHHMM);
  else url.searchParams.set("t", toParam(timerSeconds));
  history.replaceState(null, "", url);
}

function parseAlarm(raw) {
  const m = String(raw || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function alarmDate(hhmm = alarmHHMM) {
  const [h, min] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= Date.now() + 400) d.setDate(d.getDate() + 1);
  return d;
}

function secondsUntilAlarm() {
  return Math.max(1, Math.round((alarmDate().getTime() - Date.now()) / 1000));
}

function remainingSec() {
  if (mode === "stopwatch") return Infinity;
  if (mode === "alarm" && state === "idle") return secondsUntilAlarm();
  if (state === "idle") return armed;
  return Math.max(0, (endVirtual - virtual) / 1000);
}

function displayValue() {
  if (mode === "stopwatch") return state === "idle" ? 0 : virtual / 1000;
  return remainingSec();
}

function timeProgress() {
  if (mode === "stopwatch" || state === "idle") return 0;
  if (state === "done") return 1;
  return Math.max(0, Math.min(1, (virtual / 1000) / Math.max(0.001, runSpan)));
}

function phase() {
  if (mode === "stopwatch" || state === "done" || state === "idle") return state === "done" ? "done" : "ok";
  const r = remainingSec();
  if (r <= 60) return "final";
  return "ok";
}

function heroFill() {
  return theme === "dark" ? "#2E2E33" : "#0A0A0A";
}

function showHint(text) {
  hintEl.hidden = !text;
  hintEl.textContent = text || "";
}

function renderDigits(text) {
  if (clockEl.dataset.face === text) return;
  clockEl.dataset.face = text;
  clockEl.replaceChildren(
    ...[...text].map((ch) => {
      const slot = document.createElement("span");
      slot.className = ch === ":" ? "colon" : "slot";
      slot.textContent = ch;
      return slot;
    }),
  );
}

function renderLaps() {
  const list = $("laps");
  list.replaceChildren(
    ...laps.map((sec, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      const time = document.createElement("span");
      name.textContent = `Lap ${laps.length - i}`;
      time.textContent = formatClock(Math.floor(sec));
      li.append(name, time);
      return li;
    }),
  );
}

function renderChrome() {
  if (mode === "alarm" && state === "idle") armed = secondsUntilAlarm();
  const shown = displaySeconds(displayValue());
  if (!editing) renderDigits(formatClock(shown));
  const rem = mode === "stopwatch" ? displayValue() : remainingSec();
  clockEl.dataset.remaining = String(Math.round(rem * 1000) / 1000);
  document.body.dataset.state = state;
  document.body.dataset.mode = mode;
  document.body.dataset.phase = phase();
  endScreenEl.hidden = state !== "done";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#000000" : "#ffffff";

  if (state !== "done") {
    if (mode === "alarm") subEl.textContent = `until ${formatEndTime(alarmDate())}`;
    else if (mode === "stopwatch") subEl.textContent = laps.length ? `${laps.length} lap${laps.length === 1 ? "" : "s"}` : "Counting up";
    else subEl.textContent = `Ends ${formatEndTime(new Date(Date.now() + remainingSec() * 1000))}`;
  }

  for (const btn of document.querySelectorAll(".modes button")) {
    btn.setAttribute("aria-selected", btn.dataset.mode === mode ? "true" : "false");
  }
  for (const btn of document.querySelectorAll("[data-preset]")) {
    btn.setAttribute("aria-pressed", btn.dataset.preset === String(timerSeconds) && state === "idle" ? "true" : "false");
  }
  const label = state === "running" ? "Pause" : state === "paused" ? "Resume" : "Start";
  startBtn.textContent = label;
  focusPauseBtn.textContent = state === "paused" ? "Resume" : "Pause";
  const soundBtn = $("sound");
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
  soundBtn.setAttribute("aria-label", soundOn ? "Sound on" : "Sound off");
  themeBtn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  themeBtn.setAttribute("aria-label", theme === "dark" ? "Light theme" : "Dark theme");
  const air = bots.filter((b) => b.state === "drift" || b.state === "caught").length;
  worldEl.dataset.bots = String(bots.length);
  worldEl.dataset.landed = "0";
  worldEl.dataset.air = String(air);
}

function nudge(seconds) {
  if (mode === "stopwatch" || state === "done") return;
  if (mode === "alarm" && state === "idle") {
    const [h, m] = alarmHHMM.split(":").map(Number);
    const total = (h * 60 + m + Math.round(seconds / 60) + 24 * 60) % (24 * 60);
    alarmHHMM = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    $("alarm-time").value = alarmHHMM;
    save();
    updateUrl();
    renderChrome();
    return;
  }
  if (state === "idle") {
    const next = clampDuration(armed + seconds);
    if (!next) return;
    armed = next;
    timerSeconds = next;
    save();
    updateUrl();
    renderChrome();
    return;
  }
  const nextEnd = endVirtual + seconds * 1000;
  if (nextEnd <= virtual + 40) {
    endVirtual = virtual;
    finish();
    return;
  }
  endVirtual = nextEnd;
  runSpan = Math.max(1, runSpan + seconds);
  armed = Math.max(1, Math.round(runSpan));
  if (mode === "timer") timerSeconds = armed;
  save();
  updateUrl();
  renderChrome();
}

function commitTyped(raw) {
  const seconds = parseDuration(raw, { bare: "minutes" });
  editing = false;
  typedEl.hidden = true;
  clockEl.hidden = false;
  if (!seconds) {
    showHint("Try 10, 10:00, or 1:30:00.");
    renderChrome();
    return;
  }
  showHint("");
  if (state === "running" || state === "paused") nudge(seconds - remainingSec());
  else {
    armed = seconds;
    timerSeconds = seconds;
    save();
    updateUrl();
    renderChrome();
  }
}

function openEditor() {
  if (mode !== "timer" || state === "done") return;
  editing = true;
  typedEl.value = formatClock(displaySeconds(displayValue()));
  typedEl.hidden = false;
  clockEl.hidden = true;
  typedEl.focus();
  typedEl.select();
}

function setMode(next) {
  if (state !== "idle") reset();
  mode = next;
  if (mode === "timer") armed = timerSeconds;
  if (mode === "alarm") armed = secondsUntilAlarm();
  if (mode === "stopwatch") {
    laps = [];
    renderLaps();
  }
  showHint("");
  updateUrl();
  save();
  renderChrome();
}

function applyTheme(next) {
  theme = next === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  save();
  renderChrome();
}

function tone(freq, dur, gain) {
  if (!soundOn) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(now);
    o.stop(now + dur + 0.02);
  } catch {
    /* autoplay blocked */
  }
}

function boop() {
  tone(640, 0.08, 0.03);
}

function chime() {
  if (!soundOn) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const t0 = now + i * 0.07;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + 0.95);
    });
  } catch {
    /* autoplay blocked */
  }
}

function buildHero() {
  heroEl.replaceChildren();
  hero = createBotElement({ kind: "hero", fill: heroFill(), eye: "#FFFFFF" });
  hero.svg.style.position = "relative";
  hero.svg.style.width = "100%";
  hero.svg.style.height = "100%";
  hero.id = 0;
  hero.nextBlink = 1200;
  hero.blinkStart = 0;
  hero.dash = false;
  heroEl.appendChild(hero.svg);
  setHeroLevel(hero, 0);
}

function paintHero() {
  let level = timeProgress();
  if (mode === "stopwatch" && state !== "idle") {
    const breath = Math.sin((virtual / 1000) * Math.PI * 2 / 60);
    level = 0.38 + breath * 0.08;
  }
  if (state === "done") level = 1;
  setHeroLevel(hero, level);
  danceHero();
  const box = heroEl.getBoundingClientRect();
  const hx = box.left + box.width / 2;
  const hy = box.top + box.height / 2;
  let nearest = null;
  let best = 480;
  for (const b of bots) {
    if (b.state !== "drift" && b.state !== "caught") continue;
    const d = Math.hypot(b.x - hx, b.y - hy);
    if (d < best) {
      best = d;
      nearest = b;
    }
  }
  const target = nearest || { x: hx, y: hy - 40 };
  const dx = target.x - hx;
  const dy = target.y - hy;
  const m = Math.hypot(dx, dy) || 1;
  if (motionClock > hero.nextBlink) {
    hero.blinkStart = motionClock;
    hero.nextBlink = motionClock + 1600 + Math.random() * 1800;
  }
  const blinkT = hero.blinkStart ? (motionClock - hero.blinkStart) / 140 : -1;
  let blink = blinkT < 0 || blinkT > 1 ? 1 : blinkT < 0.45 ? 1 - (blinkT / 0.45) * 0.92 : 0.08 + ((blinkT - 0.45) / 0.55) * 0.92;
  if (state === "done" && !prefersReduced()) {
    const beat = Math.sin((motionClock % 5200) / 5200 * Math.PI * 8);
    if (beat > 0.86) blink = 0.22;
  }
  setEyes(hero, {
    gazeX: Math.max(-1, Math.min(1, dx / m)),
    gazeY: Math.max(-1, Math.min(1, dy / m)),
    blink,
    eye: "#FFFFFF",
    fill: heroFill(),
  });
}

function rainCap() {
  return state === "running" ? 9 : 3;
}

function spawnDrift() {
  if (prefersReduced() || pageHidden) return;
  if (state !== "running" && state !== "idle") return;
  if (bots.filter((b) => b.state === "drift").length >= rainCap()) return;
  const spec = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const depth = Math.random();
  const size = Math.round(16 + depth * 30);
  const drag = 2.8;
  const vt = 78 + depth * 110;
  const bot = createBotElement({ kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: "#FFFFFF" });
  bot.svg.classList.add("bot");
  worldEl.appendChild(bot.svg);
  Object.assign(bot, {
    id: nextId++,
    state: "drift",
    depth,
    size,
    x: 36 + Math.random() * Math.max(40, width - 72),
    y: -size - 8 - Math.random() * 40,
    vx: wind * (0.35 + depth * 0.45) * (0.7 + Math.random() * 0.5),
    vy: 8 + depth * 16,
    drag,
    grav: vt * drag,
    rot: (Math.random() - 0.5) * 12,
    spinRate: (Math.random() - 0.5) * 16,
    opacity: 0.24 + depth * 0.32,
    dash: !!spec.dash,
    nextBlink: motionClock + 800,
    blinkStart: 0,
  });
  bot.svg.style.zIndex = String(Math.round(depth * 4));
  bot.svg.style.opacity = String(bot.opacity);
  bots.push(bot);
}

function digitShield(x, y) {
  const r = clockEl.getBoundingClientRect();
  if (!r.width) return 1;
  const padX = 28;
  const padY = 18;
  const left = r.left - padX;
  const right = r.right + padX;
  const top = r.top - padY;
  const bottom = r.bottom + padY;
  const cx = Math.max(left, Math.min(x, right));
  const cy = Math.max(top, Math.min(y, bottom));
  const dist = Math.hypot(x - cx, y - cy);
  if (dist >= 72) return 1;
  return 0.12 + 0.88 * (dist / 72);
}

function danceHero() {
  if (!heroEl) return;
  if (state !== "done") {
    heroEl.style.transform = "";
    return;
  }
  if (prefersReduced()) {
    const sway = Math.sin(motionClock / 980) * 8;
    heroEl.style.transform = `translateX(${sway.toFixed(2)}px)`;
    return;
  }
  const t = (motionClock % 5200) / 5200;
  const turn = t * Math.PI * 2;
  const x = Math.sin(turn * 2) * 56;
  const hop = Math.abs(Math.sin(turn * 2));
  const y = -hop * 26 + Math.sin(turn * 4) * -4;
  const squash = 1 + Math.cos(turn * 4) * 0.09;
  const sx = (1 / squash) * (1 + Math.sin(turn * 2) * 0.035);
  const sy = squash;
  const rot = Math.sin(turn * 2) * 11 + Math.sin(turn) * 5;
  heroEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
}

function tryCatch(bot) {
  if (motionClock < nextCatch) return false;
  const box = heroEl.getBoundingClientRect();
  const hx = box.left + box.width / 2;
  const hy = box.top + box.height * 0.55;
  if (Math.abs(bot.x - hx) > box.width * 0.7) return false;
  if (bot.y < box.top || bot.y > box.bottom) return false;
  bot.state = "caught";
  bot.caughtT = 0;
  bot.handX = hx;
  bot.handY = hy + box.height * 0.12;
  bot.svg.dataset.caught = "1";
  heroWrapEl.appendChild(bot.svg);
  nextCatch = motionClock + 14000 + Math.random() * 8000;
  boop();
  return true;
}

function tickBots(dt) {
  const sec = dt / 1000;
  for (const bot of bots) {
    if (bot.state === "drift" && sec > 0) {
      bot.vy += (bot.grav - bot.drag * bot.vy) * sec;
      bot.x += bot.vx * sec;
      bot.y += bot.vy * sec;
      bot.rot += (bot.spinRate || 0) * sec;
      const fadeStart = height * 0.78;
      const fadeEnd = height + bot.size;
      let fade = 1;
      if (bot.y > fadeStart) fade = 1 - Math.min(1, (bot.y - fadeStart) / (fadeEnd - fadeStart));
      bot.svg.style.opacity = String(bot.opacity * fade * digitShield(bot.x, bot.y));
      if (bot.y >= fadeEnd) bot.dead = true;
      else if (state === "running" && tryCatch(bot)) continue;
    } else if (bot.state === "caught") {
      bot.caughtT += dt;
      const bounce = Math.sin(Math.min(1, bot.caughtT / 380) * Math.PI) * 14;
      const wrap = heroWrapEl.getBoundingClientRect();
      const lx = bot.handX - wrap.left;
      const ly = bot.handY - wrap.top - bounce;
      bot.svg.style.width = `${bot.size}px`;
      bot.svg.style.height = `${bot.size}px`;
      bot.svg.style.transform = `translate(${lx - bot.size / 2}px, ${ly - bot.size / 2}px) rotate(${bot.rot}deg)`;
      if (bot.caughtT > 520) {
        const fade = Math.max(0, 1 - (bot.caughtT - 520) / 280);
        bot.svg.style.opacity = String(fade);
        if (bot.caughtT > 800) bot.dead = true;
      }
      continue;
    }
    if (bot.dead) continue;
    if (motionClock > (bot.nextBlink || 0)) {
      bot.blinkStart = motionClock;
      bot.nextBlink = motionClock + 1600 + Math.random() * 2400;
    }
    const blinkT = bot.blinkStart ? (motionClock - bot.blinkStart) / 140 : -1;
    const blink = blinkT < 0 || blinkT > 1 ? 1 : blinkT < 0.45 ? 1 - blinkT / 0.45 * 0.9 : 0.1;
    setEyes(bot, { gazeX: 0, gazeY: 1, blink, eye: "#FFFFFF" });
    if (bot.state !== "caught") {
      bot.svg.style.width = `${bot.size}px`;
      bot.svg.style.height = `${bot.size}px`;
      bot.svg.style.transform = `translate(${bot.x - bot.size / 2}px, ${bot.y - bot.size / 2}px) rotate(${bot.rot}deg)`;
    }
  }
  if (bots.some((b) => b.dead)) {
    bots = bots.filter((b) => {
      if (!b.dead) return true;
      b.svg.remove();
      return false;
    });
  }
}

function tickSpawn() {
  if (prefersReduced() || pageHidden) return;
  if (state !== "running" && state !== "idle") return;
  if (motionClock < nextSpawnAt) return;
  spawnDrift();
  const gap = state === "running" ? 1000 + Math.random() * 1000 : 2600 + Math.random() * 1600;
  nextSpawnAt = motionClock + gap;
}

function burst() {
  confettiEl.replaceChildren();
  bursts = [];
  const origin = heroEl.getBoundingClientRect();
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;
  for (let i = 0; i < 12; i++) {
    const spec = PALETTE[i % PALETTE.length];
    const bot = createBotElement({ kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: "#FFFFFF" });
    bot.svg.classList.add("bot");
    confettiEl.appendChild(bot.svg);
    const ang = (i / 12) * Math.PI * 2 + Math.random() * 0.2;
    const speed = prefersReduced() ? 40 : 140 + Math.random() * 80;
    Object.assign(bot, {
      x: ox,
      y: oy,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 40,
      size: 14 + Math.random() * 8,
      rot: 0,
      age: 0,
      life: prefersReduced() ? 0.45 : 1.15,
    });
    bursts.push(bot);
  }
}

function tickBurst(dt) {
  const sec = dt / 1000;
  for (const b of bursts) {
    b.age += sec;
    b.vy += 280 * sec;
    b.x += b.vx * sec;
    b.y += b.vy * sec;
    const fade = Math.max(0, 1 - b.age / b.life);
    b.svg.style.opacity = String(fade);
    b.svg.style.width = `${b.size}px`;
    b.svg.style.height = `${b.size}px`;
    b.svg.style.transform = `translate(${b.x - b.size / 2}px, ${b.y - b.size / 2}px)`;
  }
  if (bursts.length && bursts.every((b) => b.age > b.life)) {
    bursts = [];
    confettiEl.replaceChildren();
  }
}

function clearMotion() {
  for (const b of bots) b.svg.remove();
  bots = [];
  bursts = [];
  confettiEl.replaceChildren();
  heroEl.classList.remove("cheer");
}

function finish() {
  if (state === "done" || mode === "stopwatch") return;
  state = "done";
  virtual = endVirtual;
  for (const b of bots) b.svg.remove();
  bots = [];
  chime();
  burst();
  renderChrome();
}

function beginRun() {
  virtual = 0;
  wind = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 24);
  nextSpawnAt = motionClock + 280 + Math.random() * 500;
  nextCatch = motionClock + 9000;
  if (mode === "stopwatch") {
    endVirtual = Number.POSITIVE_INFINITY;
    runSpan = 0;
    laps = [];
    renderLaps();
  } else if (mode === "alarm") {
    armed = secondsUntilAlarm();
    endVirtual = armed * 1000;
    runSpan = armed;
  } else {
    endVirtual = armed * 1000;
    runSpan = armed;
  }
  state = "running";
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  renderChrome();
}

function startOrPause() {
  if (state === "running") {
    state = "paused";
    renderChrome();
    return;
  }
  if (state === "done") {
    restart();
    return;
  }
  if (state === "paused") {
    state = "running";
    renderChrome();
    return;
  }
  beginRun();
}

function reset() {
  state = "idle";
  virtual = 0;
  endVirtual = 0;
  editing = false;
  typedEl.hidden = true;
  clockEl.hidden = false;
  if (mode === "timer") armed = timerSeconds;
  clearMotion();
  showHint("");
  renderChrome();
}

function restart() {
  clearMotion();
  beginRun();
}

function plusFive() {
  clearMotion();
  if (mode === "alarm") {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    alarmHHMM = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    $("alarm-time").value = alarmHHMM;
  } else {
    mode = "timer";
    timerSeconds = clampDuration((timerSeconds || armed || 0) + 300) || 300;
    armed = timerSeconds;
  }
  save();
  updateUrl();
  beginRun();
}

function revealDock() {
  if (state !== "running" && state !== "paused") return;
  focusDock.classList.add("visible");
  focusDock.setAttribute("aria-hidden", "false");
  clearTimeout(dockTimer);
  dockTimer = setTimeout(() => {
    focusDock.classList.remove("visible");
    focusDock.setAttribute("aria-hidden", "true");
  }, 2000);
}

function boot() {
  const stored = readStore();
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("t");
  const alarmParam = parseAlarm(params.get("alarm"));
  if (stored?.theme) theme = stored.theme === "dark" ? "dark" : "light";
  if (stored?.sound) soundOn = true;
  if (stored?.alarm) alarmHHMM = parseAlarm(stored.alarm) || alarmHHMM;
  if (stored?.mode === "stopwatch" || stored?.mode === "alarm" || stored?.mode === "timer") mode = stored.mode;
  let seconds = stored?.seconds || 600;
  if (fromUrl) {
    const parsed = parseDuration(fromUrl, { bare: "seconds" });
    if (parsed) seconds = parsed;
  }
  timerSeconds = clampDuration(seconds) || 600;
  if (alarmParam) {
    mode = "alarm";
    alarmHHMM = alarmParam;
  } else if (params.get("mode") === "stopwatch") mode = "stopwatch";
  else if (fromUrl) mode = "timer";
  armed = mode === "alarm" ? secondsUntilAlarm() : timerSeconds;
  $("alarm-time").value = alarmHHMM;
  applyTheme(theme);
  buildHero();
  save();
  updateUrl();
  renderChrome();
  requestAnimationFrame(loop);
}

function loop(ts) {
  const dt = lastTs ? Math.min(48, ts - lastTs) : 16;
  lastTs = ts;
  if (!pageHidden) motionClock += dt;
  if (state === "running") {
    virtual += dt;
    if (mode !== "stopwatch" && virtual > endVirtual) virtual = endVirtual;
    if (!pageHidden) {
      tickSpawn();
      tickBots(dt);
    }
    if (mode !== "stopwatch" && virtual >= endVirtual) finish();
  } else if (!pageHidden) {
    if (state === "idle") tickSpawn();
    tickBots(state === "idle" ? dt : 0);
  }
  tickBurst(dt);
  paintHero();
  renderChrome();
  requestAnimationFrame(loop);
}

themeBtn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));
$("sound").addEventListener("click", () => {
  soundOn = !soundOn;
  save();
  if (soundOn) boop();
  renderChrome();
});
startBtn.addEventListener("click", startOrPause);
focusPauseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  startOrPause();
  revealDock();
});
$("focus-reset").addEventListener("click", (e) => {
  e.stopPropagation();
  reset();
});
$("restart").addEventListener("click", restart);
$("plus-five").addEventListener("click", plusFive);
$("new-timer").addEventListener("click", reset);
$("lap").addEventListener("click", () => {
  if (mode !== "stopwatch" || state !== "running") return;
  laps.unshift(virtual / 1000);
  renderLaps();
  renderChrome();
});
for (const btn of document.querySelectorAll(".modes button")) {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
}
for (const btn of document.querySelectorAll("[data-preset]")) {
  btn.addEventListener("click", () => {
    const seconds = Number(btn.dataset.preset);
    if (state === "running" || state === "paused") nudge(seconds - remainingSec());
    else {
      armed = seconds;
      timerSeconds = seconds;
      save();
      updateUrl();
      renderChrome();
    }
  });
}
$("alarm-time").addEventListener("input", () => {
  const next = parseAlarm($("alarm-time").value);
  if (!next) return;
  alarmHHMM = next;
  save();
  updateUrl();
  renderChrome();
});
clockEl.addEventListener("click", openEditor);
typedEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    commitTyped(typedEl.value);
  } else if (e.key === "Escape") {
    editing = false;
    typedEl.hidden = true;
    clockEl.hidden = false;
    renderChrome();
  }
});
typedEl.addEventListener("blur", () => {
  if (editing) commitTyped(typedEl.value);
});
clockEl.addEventListener("wheel", (e) => {
  if (mode === "stopwatch" || state === "done") return;
  e.preventDefault();
  nudge(e.deltaY > 0 ? -60 : 60);
}, { passive: false });

window.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA";
  if (e.key === "Escape" && state !== "idle") {
    if (typing) return;
    e.preventDefault();
    reset();
    return;
  }
  if (state === "done" && e.key === "Enter" && !typing) {
    e.preventDefault();
    restart();
    return;
  }
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !typing) {
    e.preventDefault();
    const dir = e.key === "ArrowUp" ? 1 : -1;
    nudge(dir * (e.shiftKey ? 1 : 60));
    return;
  }
  if (e.key !== " " && e.code !== "Space") return;
  if (typing) return;
  e.preventDefault();
  startOrPause();
});

window.addEventListener("pointermove", revealDock);
window.addEventListener("pointerdown", revealDock);
window.addEventListener("resize", () => {
  width = window.innerWidth;
  height = window.innerHeight;
});
document.addEventListener("visibilitychange", () => {
  pageHidden = document.hidden;
});

boot();
