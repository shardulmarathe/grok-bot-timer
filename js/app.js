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
import { chooseFill, eyeInk, fillIsLight } from "./color.js";
import { alarmColumns, mountWheel, setWheel, timerColumns } from "./wheel.js";

const STORE_KEY = "grok-bot-timer";
const RUN_KEY = "grok-bot-timer-run";
const ACCENT = "#9B6BFF";
const BOT_SWATCHES = ["#0A0A0A", "#9B6BFF", "#2F7BFF", "#14C4A8", "#FFB020", "#FF6A1F", "#EA4798", "#959595"];
const BG_SWATCHES = [
  { id: "white", value: "#ffffff" },
  { id: "cream", value: "#F6F1E7" },
  { id: "lavender", value: "#EDE7FF" },
  { id: "mint", value: "#E5F7F2" },
  { id: "sky", value: "#E7F2FF" },
  { id: "ink", value: "#111114" },
  { id: "navy", value: "#0E1A33" },
  { id: "fade", value: "linear-gradient(180deg, #F4F0FF 0%, #E5F6F1 100%)" },
];

const $ = (id) => document.getElementById(id);
const worldEl = $("world");
const confettiEl = $("confetti");
const clockEl = $("clock");
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
let dockTimer = 0;
let bobX = 0;
let bobY = 0;
let bobVX = 0;
let bobVY = 0;
let hop = 0;
let hopV = 0;
let frameDt = 16;
let endAt = 0;
let remainMs = 0;
let watchOrigin = 0;
let watchAccum = 0;
let endTimer = 0;
let titleTimer = 0;
let notified = false;
let notifyAsked = false;
let notifyOn = false;
let wakeLock = null;
let botColor = "";
let fillColor = "";
let bgValue = "";

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
      JSON.stringify({
        seconds: timerSeconds,
        theme,
        sound: soundOn,
        mode,
        alarm: alarmHHMM,
        notifyOn,
        notifyAsked,
        botColor,
        fillColor,
        bgValue,
      }),
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

function wallNow() {
  return Date.now();
}

function remainingSec() {
  if (mode === "stopwatch") return Infinity;
  if (mode === "alarm" && state === "idle") return secondsUntilAlarm();
  if (state === "idle") return armed;
  if (state === "done") return 0;
  if (state === "paused") return Math.max(0, remainMs / 1000);
  if (endAt) return Math.max(0, (endAt - wallNow()) / 1000);
  return armed;
}

function displayValue() {
  if (mode === "stopwatch") {
    if (state === "running") return (watchAccum + (wallNow() - watchOrigin)) / 1000;
    if (state === "paused") return watchAccum / 1000;
    return 0;
  }
  return remainingSec();
}

function syncFromWall() {
  if (mode === "stopwatch") {
    if (state === "running") virtual = watchAccum + (wallNow() - watchOrigin);
    else if (state === "paused") virtual = watchAccum;
    return;
  }
  if (state === "paused") {
    virtual = Math.max(0, runSpan * 1000 - remainMs);
    return;
  }
  if (state !== "running" || !endAt) return;
  const left = endAt - wallNow();
  if (left <= 0) {
    virtual = runSpan * 1000;
    finish();
    return;
  }
  virtual = Math.max(0, runSpan * 1000 - left);
}

function scheduleEnd() {
  clearTimeout(endTimer);
  if (mode === "stopwatch" || state !== "running" || !endAt) return;
  const delay = Math.max(0, endAt - wallNow());
  endTimer = setTimeout(() => syncFromWall(), delay);
}

function saveRun() {
  try {
    if (state === "idle") {
      localStorage.removeItem(RUN_KEY);
      return;
    }
    localStorage.setItem(
      RUN_KEY,
      JSON.stringify({
        mode,
        state,
        endAt,
        remainMs,
        watchOrigin,
        watchAccum,
        runSpan,
        armed,
        timerSeconds,
        alarmHHMM,
        notified,
        laps,
      }),
    );
  } catch {
    /* private mode */
  }
}

function restoreRun() {
  let run = null;
  try {
    run = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
  } catch {
    return false;
  }
  if (!run || !run.state || run.state === "idle") return false;
  mode = run.mode || mode;
  state = run.state;
  endAt = run.endAt || 0;
  remainMs = run.remainMs || 0;
  watchOrigin = run.watchOrigin || 0;
  watchAccum = run.watchAccum || 0;
  runSpan = run.runSpan || runSpan;
  armed = run.armed || armed;
  timerSeconds = run.timerSeconds || timerSeconds;
  alarmHHMM = run.alarmHHMM || alarmHHMM;
  notified = !!run.notified;
  laps = Array.isArray(run.laps) ? run.laps.filter((lap) => lap && Number.isFinite(lap.total) && Number.isFinite(lap.split)) : [];
  if (state === "running") {
    scheduleEnd();
    lockWake();
  }
  if (state === "done") {
    startTitleFlash();
    setFavicon(true);
  }
  return true;
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

function luminance(hex) {
  const raw = String(hex || "").replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0.9;
  const n = parseInt(full, 16);
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

function mixHex(from, to, t) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(from.length === 7 ? from : "#000000");
  const b = parse(to.length === 7 ? to : "#ffffff");
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function heroFill() {
  if (botColor) return botColor;
  return theme === "dark" ? "#2E2E33" : "#0A0A0A";
}

function pageColor() {
  if (!bgValue) return theme === "dark" ? "#000000" : "#ffffff";
  if (bgValue.startsWith("linear")) return "#F4F0FF";
  return bgValue;
}

function resolvedFill() {
  return chooseFill(heroFill(), pageColor(), fillColor);
}

function bgLuminance(value) {
  if (!value) return theme === "dark" ? 0 : 1;
  if (value.startsWith("linear")) return 0.9;
  return luminance(value);
}

function applyAppearance() {
  document.documentElement.dataset.theme = theme;
  const body = heroFill();
  const fill = resolvedFill();
  document.documentElement.style.setProperty("--fill", fill);
  if (bgValue) {
    document.body.style.background = bgValue;
    const light = bgLuminance(bgValue) > 0.55;
    const ink = light ? "#0A0A0A" : "#FFFFFF";
    document.documentElement.style.setProperty("--ink", ink);
    document.documentElement.style.setProperty("--bg", light ? "#FFFFFF" : "#141418");
    document.documentElement.style.setProperty("--muted", light ? "rgba(10,10,10,0.55)" : "rgba(255,255,255,0.72)");
    document.documentElement.style.setProperty("--line", light ? "rgba(10,10,10,0.16)" : "rgba(255,255,255,0.28)");
    document.documentElement.style.setProperty("--primary-bg", ink);
    document.documentElement.style.setProperty("--primary-ink", light ? "#FFFFFF" : "#0A0A0A");
    document.documentElement.style.setProperty("--digit", ink);
  } else {
    document.body.style.background = "";
    for (const key of ["--ink", "--bg", "--muted", "--line", "--primary-bg", "--primary-ink", "--digit"]) {
      document.documentElement.style.removeProperty(key);
    }
  }
  if (hero?.body) {
    const circle = hero.body.querySelector("circle");
    if (circle) {
      if (luminance(body) > 0.62) {
        circle.setAttribute("stroke", "#0A0A0A");
        circle.setAttribute("stroke-width", "2.5");
      } else {
        circle.removeAttribute("stroke");
        circle.removeAttribute("stroke-width");
      }
    }
  }
  if (hero?.eyes) {
    const liquidY = Number(hero.liquid?.getAttribute("y") ?? 120);
    const cover = Math.max(0, Math.min(1, (72 - liquidY) / 20));
    const lightBody = luminance(body) > 0.55;
    let backdrop = hero.eyes.querySelector(".eye-back");
    if (lightBody || (fillIsLight(fill) && cover > 0.02)) {
      if (!backdrop) {
        backdrop = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        backdrop.setAttribute("class", "eye-back");
        backdrop.setAttribute("cx", "0");
        backdrop.setAttribute("cy", "0");
        backdrop.setAttribute("rx", "24");
        backdrop.setAttribute("ry", "18");
        hero.eyes.insertBefore(backdrop, hero.eyes.firstChild);
      }
      backdrop.setAttribute("fill", eyeInk(fill));
      backdrop.setAttribute("opacity", lightBody ? "1" : cover.toFixed(3));
    } else if (backdrop) {
      backdrop.remove();
    }
  }
  if (hero?.liquid) hero.liquid.setAttribute("fill", fill);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = bgValue && !bgValue.startsWith("linear") ? bgValue : theme === "dark" ? "#000000" : "#ffffff";
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
  const head = document.querySelector(".lap-head");
  if (head) head.hidden = laps.length === 0;
  const splits = laps.map((lap) => lap.split);
  const fastest = laps.length >= 3 ? Math.min(...splits) : null;
  const slowest = laps.length >= 3 ? Math.max(...splits) : null;
  const distinct = fastest != null && fastest !== slowest;
  list.replaceChildren(
    ...laps.map((lap, i) => {
      const li = document.createElement("li");
      const num = document.createElement("span");
      const split = document.createElement("span");
      const total = document.createElement("span");
      num.textContent = String(laps.length - i).padStart(2, "0");
      split.textContent = formatClock(Math.floor(lap.split));
      total.textContent = formatClock(Math.floor(lap.total));
      if (distinct && lap.split === fastest) li.classList.add("lap-fast");
      else if (distinct && lap.split === slowest) li.classList.add("lap-slow");
      li.append(num, split, total);
      return li;
    }),
  );
}

function renderChrome() {
  if (mode === "alarm" && state === "idle") armed = secondsUntilAlarm();
  const shown = displaySeconds(displayValue());
  renderDigits(formatClock(shown));
  const rem = mode === "stopwatch" ? displayValue() : remainingSec();
  clockEl.dataset.remaining = String(Math.round(rem * 1000) / 1000);
  document.body.dataset.state = state;
  document.body.dataset.mode = mode;
  document.body.dataset.phase = phase();
  endScreenEl.hidden = state !== "done";
  applyAppearance();
  updateTitle();

  if (state !== "done") {
    if (mode === "alarm") subEl.textContent = state === "idle" ? "Set an alarm" : `until ${formatEndTime(alarmDate())}`;
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
  if (!soundBtn) return;
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
  soundBtn.setAttribute("aria-label", soundOn ? "Sound on" : "Sound off");
  themeBtn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  themeBtn.setAttribute("aria-label", theme === "dark" ? "Light theme" : "Dark theme");
  const notifyBtn = $("notify");
  notifyBtn.setAttribute("aria-pressed", notifyOn ? "true" : "false");
  notifyBtn.setAttribute("aria-label", notifyOn ? "Notifications on" : "Notifications off");
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
    syncAlarmWheel(true);
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
    syncTimerWheel(true);
    save();
    updateUrl();
    renderChrome();
    return;
  }
  if (state === "running") {
    if (endAt + seconds * 1000 <= wallNow() + 40) {
      endAt = wallNow();
      finish();
      return;
    }
    endAt += seconds * 1000;
  } else if (state === "paused") {
    remainMs = Math.max(1000, remainMs + seconds * 1000);
  }
  runSpan = Math.max(1, runSpan + seconds);
  armed = Math.max(1, Math.round(runSpan));
  if (mode === "timer") timerSeconds = armed;
  scheduleEnd();
  save();
  saveRun();
  updateUrl();
  renderChrome();
}

function splitSeconds(total) {
  const s = Math.max(0, Math.round(total));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

function syncTimerWheel(smooth) {
  const wheel = $("wheel");
  if (!wheel) return;
  const parts = splitSeconds(mode === "timer" ? timerSeconds : armed);
  setWheel(wheel, parts, smooth);
}

function syncAlarmWheel(smooth) {
  const wheel = $("alarm-wheel");
  if (!wheel) return;
  let [hour, minute] = alarmHHMM.split(":").map(Number);
  const pm = hour >= 12;
  let h12 = hour % 12;
  if (h12 === 0) h12 = 12;
  setWheel(wheel, { h: h12, m: minute, p: pm ? "PM" : "AM" }, smooth);
}

function onTimerWheel(values) {
  let h = Number(values.h);
  let m = Number(values.m);
  let s = Number(values.s);
  if (h >= 12) {
    m = 0;
    s = 0;
  }
  const seconds = clampDuration(h * 3600 + m * 60 + s);
  if (!seconds) return;
  if (h >= 12) setWheel($("wheel"), { m: 0, s: 0 }, true);
  if (seconds === timerSeconds) return;
  armed = seconds;
  timerSeconds = seconds;
  save();
  updateUrl();
  renderChrome();
}

function onAlarmWheel(values) {
  let hour = Number(values.h) % 12;
  if (values.p === "PM") hour += 12;
  const next = `${String(hour).padStart(2, "0")}:${String(Number(values.m)).padStart(2, "0")}`;
  if (!parseAlarm(next) || next === alarmHHMM) return;
  alarmHHMM = next;
  save();
  updateUrl();
  renderChrome();
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
  syncTimerWheel(false);
  syncAlarmWheel(false);
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
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
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
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
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
  hero.lookX = 0;
  hero.lookY = 0;
  hero.lookVX = 0;
  hero.lookVY = 0;
  heroEl.appendChild(hero.svg);
  setHeroLevel(hero, 0);
}

function stepHeroLook(targetX, targetY, dtMs) {
  const reduced = prefersReduced();
  const dt = Math.min(0.032, Math.max(0, dtMs) / 1000);
  if (!dt) return;
  const settle = reduced ? 0.55 : 0.2;
  const stiff = reduced ? 40 : 160;
  const damp = reduced ? 10 : 14;
  const maxSpeed = 2 / settle;
  let vx = hero.lookVX + (targetX - hero.lookX) * stiff * dt - hero.lookVX * damp * dt;
  let vy = hero.lookVY + (targetY - hero.lookY) * stiff * dt - hero.lookVY * damp * dt;
  const speed = Math.hypot(vx, vy);
  if (speed > maxSpeed) {
    vx = (vx / speed) * maxSpeed;
    vy = (vy / speed) * maxSpeed;
  }
  hero.lookX += vx * dt;
  hero.lookY += vy * dt;
  hero.lookVX = vx;
  hero.lookVY = vy;
}

function paintHero() {
  let level = mode === "stopwatch" ? 0 : timeProgress();
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
    const squint = Math.max(0, Math.min(1, (beat - 0.55) / 0.45));
    blink = Math.min(blink, 1 - squint * 0.78);
  }
  const gazeX = Math.max(-1, Math.min(1, dx / m));
  const gazeY = Math.max(-1, Math.min(1, dy / m));
  if (hero.lookX == null) {
    hero.lookX = 0;
    hero.lookY = 0;
    hero.lookVX = 0;
    hero.lookVY = 0;
  }
  stepHeroLook(gazeX, gazeY, frameDt);
  setEyes(hero, {
    gazeX: hero.lookX,
    gazeY: hero.lookY,
    blink,
    eye: "#FFFFFF",
    fill: heroFill(),
  });
}

function phone() {
  return width < 720;
}

function rainCap() {
  if (phone()) {
    if (state === "done") return 12;
    if (state === "running") return 9;
    return 5;
  }
  if (state === "done") return 22;
  if (state === "running") return 15;
  return 6;
}

function spawnDrift({ y, festive = false } = {}) {
  if (prefersReduced() || pageHidden) return;
  if (state !== "running" && state !== "idle" && state !== "done") return;
  if (bots.filter((b) => b.state === "drift").length >= rainCap()) return;
  const spec = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const depth = Math.random();
  const size = phone() ? Math.round(16 + depth * 18) : Math.round(22 + depth * 34);
  const drag = 3.2;
  const travel = Math.max(480, height + size + 30);
  const seconds = festive ? 2.6 + (1 - depth) * 2.2 : 6 + (1 - depth) * 8;
  const vt = travel / seconds;
  const bot = createBotElement({ kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: "#FFFFFF" });
  bot.svg.classList.add("bot");
  worldEl.appendChild(bot.svg);
  Object.assign(bot, {
    id: nextId++,
    state: "drift",
    depth,
    size,
    x: 24 + Math.random() * Math.max(40, width - 48),
    y: y ?? -size - 6 - Math.random() * 36,
    vx: wind * (0.25 + depth * 0.35) * (0.65 + Math.random() * 0.5),
    vy: vt * 0.35,
    drag,
    grav: vt * drag,
    rot: (Math.random() - 0.5) * 16,
    spinRate: (Math.random() - 0.5) * 14,
    opacity: 0.35 + depth * 0.4,
    dash: !!spec.dash,
    nextBlink: motionClock + 600,
    blinkStart: 0,
  });
  bot.svg.style.zIndex = String(Math.round(depth * 5));
  bot.svg.style.opacity = String(bot.opacity);
  bots.push(bot);
}

function fillRain() {
  const target = rainCap();
  const have = bots.filter((b) => b.state === "drift").length;
  for (let i = have; i < target; i++) {
    spawnDrift({
      y: -10 + Math.random() * (height * 0.92),
      festive: state === "done",
    });
  }
}

function digitShield(x, y, size = 24) {
  if (state === "done") return 1;
  let factor = 1;
  const r = clockEl.getBoundingClientRect();
  if (r.width) {
    const pad = size * 0.55;
    const dx = Math.max(r.left - pad - x, 0, x - (r.right + pad));
    const dy = Math.max(r.top - pad - y, 0, y - (r.bottom + pad));
    const dist = Math.hypot(dx, dy);
    if (dist < 12) factor = Math.min(factor, 0.22 + 0.78 * (dist / 12));
  }
  const floor = height - (120 + 24);
  if ((state === "running" || state === "paused") && y > floor) {
    factor = Math.min(factor, Math.max(0, (height - y) / 120));
  }
  return factor;
}

function hopHero() {
  hopV = prefersReduced() ? -26 : -70;
}

function stepBob() {
  const dt = Math.min(0.032, Math.max(0.001, frameDt) / 1000);
  const live = mode === "stopwatch" && state === "running" && !prefersReduced();
  const t = motionClock / 1000;
  const tx = live ? Math.sin(t * 1.15) * 5 : 0;
  const ty = live ? Math.sin(t * 1.55) * 6 : 0;
  bobVX += ((tx - bobX) * 12 - bobVX * 7) * dt;
  bobVY += ((ty - bobY) * 12 - bobVY * 7) * dt;
  bobX += bobVX * dt;
  bobY += bobVY * dt;
  hopV += (-hop * 46 - hopV * 8) * dt;
  hop += hopV * dt;
  const x = bobX;
  const y = bobY + hop;
  if (!live && Math.abs(x) < 0.25 && Math.abs(y) < 0.25 && Math.abs(bobVX) < 0.3 && Math.abs(hopV) < 0.3) {
    heroEl.style.transform = "";
    bobX = 0;
    bobY = 0;
    bobVX = 0;
    bobVY = 0;
    hop = 0;
    hopV = 0;
    return;
  }
  heroEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
}

let jumpRoom = null;

function measureJumpRoom() {
  const prev = heroEl.style.transform;
  heroEl.style.transform = "none";
  const box = heroEl.getBoundingClientRect();
  heroEl.style.transform = prev;
  const margin = 12;
  const up = Math.max(24, box.top - margin);
  const side = Math.max(10, Math.min(box.left - margin, window.innerWidth - box.right - margin));
  return {
    up: Math.min(74, up),
    side: Math.min(42, side),
  };
}

function jumpArc(u) {
  const t = Math.max(0, Math.min(1, u));
  if (t < 0.42) {
    const p = t / 0.42;
    return 1 - (1 - p) * (1 - p);
  }
  const p = (t - 0.42) / 0.58;
  const s = p * p * (3 - 2 * p);
  return 1 - s;
}

function danceHero() {
  if (!heroEl) return;
  if (state !== "done") {
    jumpRoom = null;
    heroEl.style.transformOrigin = "";
    stepBob();
    return;
  }
  if (!jumpRoom) jumpRoom = measureJumpRoom();
  const reduced = prefersReduced();
  const cycle = reduced ? 2200 : 1680;
  const u = (motionClock % cycle) / cycle;
  let air = 0;
  let dir = 1;
  let gain = 0;
  if (u < 0.46) {
    air = u / 0.46;
    dir = 1;
    gain = 1;
  } else if (u >= 0.54 && u < 0.88) {
    air = (u - 0.54) / 0.34;
    dir = -1;
    gain = 0.62;
  }
  const lift = air ? jumpArc(air) * gain : 0;
  const travel = air ? Math.sin(air * Math.PI) * gain : 0;
  const quiet = reduced ? 0.34 : 1;
  const x = travel * dir * jumpRoom.side * quiet;
  const y = -lift * jumpRoom.up * quiet;
  const rot = travel * dir * (reduced ? 3 : 7.5);
  heroEl.style.transformOrigin = "center center";
  heroEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rot.toFixed(2)}deg)`;
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
      const sway = Math.sin(motionClock / 680 + bot.id) * (7 + bot.depth * 12);
      bot.sway = sway;
      if (bot.y > height + bot.size) bot.dead = true;
      else {
        bot.svg.style.opacity = String(bot.opacity * digitShield(bot.x, bot.y, bot.size));
        if (state === "running" && tryCatch(bot)) continue;
      }
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
      const sway = bot.sway || 0;
      bot.svg.style.transform = `translate(${bot.x + sway - bot.size / 2}px, ${bot.y - bot.size / 2}px) rotate(${bot.rot}deg)`;
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
  if (state !== "running" && state !== "idle" && state !== "done") return;
  if (motionClock < nextSpawnAt) return;
  spawnDrift({ festive: state === "done" });
  const gap = state === "done"
    ? 220 + Math.random() * 180
    : state === "running"
      ? 400 + Math.random() * 400
      : 700 + Math.random() * 500;
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
  clearTimeout(endTimer);
  virtual = runSpan * 1000;
  for (const b of bots) b.svg.remove();
  bots = [];
  if (!notified) {
    chime();
    notifyDone();
    notified = true;
  }
  startTitleFlash();
  setFavicon(true);
  burst();
  fillRain();
  nextSpawnAt = motionClock + 180;
  unlockWake();
  saveRun();
  renderChrome();
}

function beginRun() {
  virtual = 0;
  notified = false;
  stopTitleFlash();
  setFavicon(false);
  wind = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 24);
  nextSpawnAt = motionClock + 350 + Math.random() * 250;
  nextCatch = motionClock + 9000;
  if (mode === "stopwatch") {
    watchAccum = 0;
    watchOrigin = wallNow();
    endAt = 0;
    runSpan = 0;
    laps = [];
    renderLaps();
  } else if (mode === "alarm") {
    armed = secondsUntilAlarm();
    runSpan = armed;
    endAt = wallNow() + armed * 1000;
  } else {
    runSpan = armed;
    endAt = wallNow() + armed * 1000;
  }
  state = "running";
  scheduleEnd();
  fillRain();
  lockWake();
  saveRun();
  renderChrome();
}

function pauseRun() {
  if (mode === "stopwatch") {
    watchAccum += wallNow() - watchOrigin;
    virtual = watchAccum;
  } else {
    remainMs = Math.max(0, endAt - wallNow());
    endAt = 0;
  }
  state = "paused";
  clearTimeout(endTimer);
  unlockWake();
  saveRun();
  renderChrome();
}

function resumeRun() {
  if (mode === "stopwatch") watchOrigin = wallNow();
  else endAt = wallNow() + remainMs;
  state = "running";
  scheduleEnd();
  lockWake();
  saveRun();
  renderChrome();
}

function startOrPause() {
  unlockAudio();
  askNotify();
  if (state === "running") {
    pauseRun();
    return;
  }
  if (state === "done") {
    restart();
    return;
  }
  if (state === "paused") {
    resumeRun();
    return;
  }
  beginRun();
}

function reset() {
  state = "idle";
  virtual = 0;
  endAt = 0;
  remainMs = 0;
  watchAccum = 0;
  clearTimeout(endTimer);
  notified = false;
  if (mode === "timer") armed = timerSeconds;
  if (mode === "stopwatch") {
    laps = [];
    renderLaps();
  }
  clearMotion();
  fillRain();
  stopTitleFlash();
  setFavicon(false);
  unlockWake();
  saveRun();
  showHint("");
  syncTimerWheel(false);
  syncAlarmWheel(false);
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
    syncAlarmWheel(false);
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
  document.body.classList.toggle("is-coarse", window.matchMedia("(pointer: coarse)").matches || width < 720);
  focusDock.classList.add("visible");
  focusDock.setAttribute("aria-hidden", "false");
  clearTimeout(dockTimer);
  dockTimer = setTimeout(() => {
    focusDock.classList.remove("visible");
    focusDock.setAttribute("aria-hidden", "true");
  }, 2000);
}

function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  } catch {
    /* ignore */
  }
}

function setFavicon(alert) {
  const link = document.querySelector("link[rel='icon']");
  if (!link) return;
  const base = import.meta.env.BASE_URL || "./";
  link.href = `${base}${alert ? "favicon-alert.svg" : "favicon.svg"}`;
}

function updateTitle() {
  if (state === "done") return;
  if (state === "running" || pageHidden) {
    const secs = mode === "stopwatch" ? displayValue() : remainingSec();
    document.title = `${formatClock(displaySeconds(secs))} · Grok Bot Timer`;
    return;
  }
  document.title = "Grok Bot Timer";
}

function stopTitleFlash() {
  clearInterval(titleTimer);
  titleTimer = 0;
  if (state !== "done") document.title = "Grok Bot Timer";
}

function startTitleFlash() {
  clearInterval(titleTimer);
  let on = true;
  document.title = "⏰ Time's Up";
  titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? "⏰ Time's Up" : "Grok Bot Timer";
  }, 1000);
}

function notifyDone() {
  if (!notifyOn || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const base = import.meta.env.BASE_URL || "./";
    new Notification("Time's Up", {
      body: "Your Grok Bot timer finished.",
      icon: new URL(`${base}apple-touch-icon.png`, location.href).href,
    });
  } catch {
    /* notifications blocked */
  }
}

async function askNotify() {
  if (!("Notification" in window) || Notification.permission !== "default" || notifyAsked) return;
  notifyAsked = true;
  try {
    const result = await Notification.requestPermission();
    notifyOn = result === "granted";
  } catch {
    notifyOn = false;
  }
  save();
  renderChrome();
}

async function toggleNotify() {
  if (!("Notification" in window)) {
    showHint("Notifications aren't available in this browser.");
    return;
  }
  if (Notification.permission === "denied") {
    notifyOn = false;
    showHint("Notifications are blocked in the browser settings.");
    renderChrome();
    return;
  }
  if (Notification.permission === "default") {
    notifyAsked = false;
    await askNotify();
    return;
  }
  notifyOn = !notifyOn;
  save();
  renderChrome();
}

async function lockWake() {
  try {
    if (!navigator.wakeLock || state !== "running" || pageHidden) return;
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}

function unlockWake() {
  const lock = wakeLock;
  wakeLock = null;
  lock?.release?.().catch(() => {});
}

function onVisibleAgain() {
  pageHidden = document.visibilityState === "hidden";
  syncFromWall();
  updateTitle();
  if (pageHidden) unlockWake();
  else if (state === "running") lockWake();
}

function swatchButton(color, pressed, onPick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "swatch";
  btn.style.background = color;
  btn.setAttribute("aria-label", color);
  btn.setAttribute("aria-pressed", pressed ? "true" : "false");
  btn.addEventListener("click", onPick);
  return btn;
}

function renderSwatches() {
  const botHost = $("bot-swatches");
  const fillHost = $("fill-swatches");
  const bgHost = $("bg-swatches");
  botHost.replaceChildren(
    ...BOT_SWATCHES.map((color) =>
      swatchButton(color, botColor.toLowerCase() === color.toLowerCase(), () => {
        botColor = color;
        save();
        renderChrome();
        renderSwatches();
      }),
    ),
  );
  fillHost.replaceChildren(
    ...BOT_SWATCHES.map((color) =>
      swatchButton(color, fillColor.toLowerCase() === color.toLowerCase(), () => {
        fillColor = color;
        save();
        renderChrome();
        renderSwatches();
      }),
    ),
  );
  bgHost.replaceChildren(
    ...BG_SWATCHES.map((item) =>
      swatchButton(item.value, bgValue === item.value, () => {
        bgValue = item.value;
        save();
        renderChrome();
        renderSwatches();
      }),
    ),
  );
}

function boot() {
  const stored = readStore();
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("t");
  const alarmParam = parseAlarm(params.get("alarm"));
  if (stored?.theme) theme = stored.theme === "dark" ? "dark" : "light";
  if (stored?.sound) soundOn = true;
  if (stored?.notifyOn) notifyOn = true;
  if (stored?.notifyAsked) notifyAsked = true;
  if (stored?.botColor) botColor = String(stored.botColor);
  if (stored?.fillColor) fillColor = String(stored.fillColor);
  if (stored?.bgValue) bgValue = String(stored.bgValue);
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
  const intent = {
    mode,
    timerSeconds,
    alarmHHMM,
    explicit: Boolean(fromUrl || alarmParam || params.get("mode")),
  };
  const resumed = restoreRun();
  if (resumed && intent.explicit) {
    const same =
      intent.mode === mode &&
      (mode !== "timer" || intent.timerSeconds === timerSeconds) &&
      (mode !== "alarm" || intent.alarmHHMM === alarmHHMM);
    if (!same) {
      state = "idle";
      endAt = 0;
      remainMs = 0;
      watchAccum = 0;
      notified = false;
      mode = intent.mode;
      timerSeconds = intent.timerSeconds;
      alarmHHMM = intent.alarmHHMM;
      armed = mode === "alarm" ? secondsUntilAlarm() : timerSeconds;
      try {
        localStorage.removeItem(RUN_KEY);
      } catch {
        /* private mode */
      }
    }
  }
  applyTheme(theme);
  document.body.classList.toggle("is-coarse", window.matchMedia("(pointer: coarse)").matches || width < 720);
  buildHero();
  fillRain();
  mountWheel($("wheel"), timerColumns(), onTimerWheel);
  mountWheel($("alarm-wheel"), alarmColumns(), onAlarmWheel);
  renderLaps();
  syncTimerWheel(false);
  syncAlarmWheel(false);
  save();
  updateUrl();
  renderChrome();
  requestAnimationFrame(loop);
}

function loop(ts) {
  const dt = lastTs ? Math.min(48, ts - lastTs) : 16;
  frameDt = dt;
  lastTs = ts;
  syncFromWall();
  if (!pageHidden) motionClock += dt;
  if (state === "running") {
    if (!pageHidden) {
      tickSpawn();
      tickBots(dt);
    }
  } else if (!pageHidden && (state === "idle" || state === "done")) {
    tickSpawn();
    tickBots(dt);
  }
  tickBurst(dt);
  paintHero();
  renderChrome();
  requestAnimationFrame(loop);
}

themeBtn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));
$("sound").addEventListener("click", () => {
  soundOn = !soundOn;
  unlockAudio();
  save();
  if (soundOn) boop();
  renderChrome();
});
$("notify").addEventListener("click", () => {
  toggleNotify();
});
$("colors").addEventListener("click", () => {
  renderSwatches();
  $("color-sheet").hidden = false;
});
$("color-close").addEventListener("click", () => {
  $("color-sheet").hidden = true;
});
$("color-sheet").addEventListener("click", (e) => {
  if (e.target === $("color-sheet")) $("color-sheet").hidden = true;
});
$("color-reset").addEventListener("click", () => {
  botColor = "";
  fillColor = "";
  bgValue = "";
  save();
  renderSwatches();
  renderChrome();
});
$("bot-custom").addEventListener("input", (e) => {
  botColor = e.target.value;
  save();
  renderChrome();
});
$("fill-custom").addEventListener("input", (e) => {
  fillColor = e.target.value;
  save();
  renderChrome();
});
$("bg-custom").addEventListener("input", (e) => {
  bgValue = e.target.value;
  save();
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
  if (mode !== "stopwatch" || (state !== "running" && state !== "paused")) return;
  syncFromWall();
  const total = displayValue();
  const prev = laps[0]?.total || 0;
  laps.unshift({ total, split: Math.max(0, total - prev) });
  renderLaps();
  hopHero();
  saveRun();
  renderChrome();
});
$("watch-reset").addEventListener("click", reset);
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
      syncTimerWheel(true);
      save();
      updateUrl();
      renderChrome();
    }
  });
}
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
  const onWheel = e.target.closest?.(".wheel-col");
  if (!onWheel && (e.key === "ArrowUp" || e.key === "ArrowDown") && !typing) {
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
  jumpRoom = null;
  document.body.classList.toggle("is-coarse", window.matchMedia("(pointer: coarse)").matches || width < 720);
});
document.addEventListener("visibilitychange", onVisibleAgain);
window.addEventListener("focus", () => syncFromWall());
window.addEventListener("pageshow", () => syncFromWall());
setInterval(() => {
  syncFromWall();
  updateTitle();
}, 1000);

boot();
