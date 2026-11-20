import "../css/styles.css";
import {
  clampDuration,
  parseDuration,
  formatClock,
  displaySeconds,
  botCountFor,
  toParam,
  formatEndTime,
  landingTimes,
} from "./time.js";
import { createBotElement, setEyes, PALETTE, DECOR } from "./shapes.js";

const STORE_KEY = "grok-bot-timer";

const $ = (id) => document.getElementById(id);
const decorEl = $("decor");
const worldEl = $("world");
const confettiEl = $("confetti");
const clockEl = $("clock");
const subEl = $("sub");
const doneEl = $("done-line");
const eyebrowEl = $("eyebrow");
const bubbleEl = $("bubble");
const heroEl = $("hero");
const themeBtn = $("theme");
const startBtn = $("start");
const hintEl = $("hint");
const hhEl = $("hh");
const mmEl = $("mm");
const ssEl = $("ss");
const typedEl = $("typed");

let theme = "light";
let label = "BUILD TIME";
let labelFrozen = false;
let armed = 600;
let state = "idle";
let virtual = 0;
let endVirtual = 0;
let runSpan = 600;
let lastTs = 0;
let bots = [];
let decorBots = [];
let hero = null;
let lastLanded = null;
let line = null;
let lineSince = 0;
let confetti = [];
let confettiAt = 0;
let confettiSpawned = false;
let audioCtx = null;
let width = window.innerWidth;
let height = window.innerHeight;
let nextId = 1;

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
      JSON.stringify({ seconds: armed, label, theme }),
    );
  } catch {
    /* private mode */
  }
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("t", toParam(armed));
  history.replaceState(null, "", url);
}

function remainingSec() {
  if (state === "idle") return armed;
  return Math.max(0, (endVirtual - virtual) / 1000);
}

function elapsedSec() {
  if (state === "idle") return 0;
  return virtual / 1000;
}

function phase() {
  if (state === "done") return "done";
  const r = remainingSec();
  if (state !== "idle" && r <= 60) return "final";
  if (state !== "idle" && r <= 300) return "warn";
  return "ok";
}

function heroFill() {
  return theme === "dark" ? "#FFFFFF" : "#0A0A0A";
}
function heroEye() {
  return theme === "dark" ? "#0A0A0A" : "#FFFFFF";
}

function fieldFocused() {
  const a = document.activeElement;
  return a === hhEl || a === mmEl || a === ssEl || a === typedEl;
}

function fromSteppers() {
  const h = Number(hhEl.value);
  const m = Number(mmEl.value);
  const s = Number(ssEl.value);
  if (![h, m, s].every((n) => Number.isFinite(n) && n >= 0)) return null;
  if (s > 59) return null;
  return clampDuration(h * 3600 + m * 60 + s);
}

function fillSteppers(total) {
  if (fieldFocused()) return;
  const t = Math.max(0, Math.round(total));
  hhEl.value = String(Math.floor(t / 3600));
  mmEl.value = String(Math.floor((t % 3600) / 60));
  ssEl.value = String(t % 60).padStart(2, "0");
}

function showHint(text) {
  hintEl.hidden = !text;
  hintEl.textContent = text || "";
}

function pickSize() {
  const r = Math.random();
  if (r < 0.18) return 30 + Math.random() * 8;
  if (r < 0.72) return 42 + Math.random() * 18;
  if (r < 0.92) return 64 + Math.random() * 14;
  return 82 + Math.random() * 12;
}

function mount(parent, spec, extra = {}) {
  const parts = createBotElement(spec);
  parts.svg.classList.add("bot");
  parts.svg.style.position = "absolute";
  parent.appendChild(parts.svg);
  return {
    ...parts,
    ...extra,
    kind: spec.kind,
    fill: spec.fill,
    x: 0,
    y: 0,
    hx: 0,
    hy: 0,
    rot: extra.rot ?? 0,
    size: extra.size ?? 64,
    state: extra.state ?? "air",
  };
}

function place(bot) {
  const bob =
    bot.state === "air" ? Math.sin(virtual / 520 + bot.id) * 3 : 0;
  bot.svg.style.width = `${bot.size}px`;
  bot.svg.style.height = `${bot.size}px`;
  bot.svg.style.transform = `translate(${bot.x - bot.size / 2}px, ${bot.y + bob - bot.size / 2}px) rotate(${bot.rot}deg)`;
}

function gazeVector(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const m = Math.hypot(dx, dy) || 1;
  return { x: Math.max(-1, Math.min(1, dx / m)), y: Math.max(-1, Math.min(1, dy / m)) };
}

function blinkScale(bot) {
  if (!bot.blinkStart) return 1;
  const t = (virtual - bot.blinkStart) / 150;
  if (t < 0 || t > 1) return 1;
  return t < 0.45 ? 1 - (t / 0.45) * 0.9 : 0.1 + ((t - 0.45) / 0.55) * 0.9;
}

function clockCenter() {
  const r = clockEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function arrivalPoint() {
  const falling = bots.filter((b) => b.state === "falling");
  if (falling.length) {
    const b = falling[falling.length - 1];
    return { x: b.x, y: b.y };
  }
  const air = bots.filter((b) => b.state === "air");
  if (air.length) {
    const low = air.reduce((a, b) => (a.hy > b.hy ? a : b));
    return { x: low.hx, y: low.hy };
  }
  return clockCenter();
}

/** Wide sticker mound. The first row sits on baseY; later rows stack upward and may leave the frame. */
function layoutMound(list, baseY, margin = 0) {
  if (!list.length) return;
  const sorted = [...list].sort((a, b) => b.size - a.size || a.id - b.id);
  const maxW = Math.min(Math.max(140, width - margin * 2), 640);
  let y = baseY;
  let i = 0;
  let row = 0;
  while (i < sorted.length) {
    const budget = maxW * Math.max(0.46, 1 - row * 0.08);
    const rowBots = [];
    let used = 0;
    while (i < sorted.length) {
      const b = sorted[i];
      const need = b.size * 0.68;
      if (rowBots.length && used + need > budget) break;
      rowBots.push(b);
      used += need;
      i++;
    }
    let x = width / 2 - used / 2;
    const rowH = Math.max(...rowBots.map((b) => b.size));
    for (const b of rowBots) {
      b.hx = x + b.size * 0.34 + Math.sin(b.id * 1.7) * 4;
      b.hy = y + Math.cos(b.id * 2.1) * 3;
      x += b.size * 0.68;
    }
    y -= rowH * 0.52;
    row++;
  }
}

function layoutAir(fresh) {
  const air = bots.filter((b) => b.state === "air");
  const narrow = width < 720;
  layoutMound(air, narrow ? -42 : 26, narrow ? 118 : 20);
  if (fresh) {
    for (const b of air) {
      b.x = b.hx;
      b.y = b.hy;
    }
  }
}

function layoutLanded() {
  layoutMound(
    bots.filter((b) => b.state === "landed"),
    height - 6,
  );
}

function makePileBot(index, { fromAbove = false } = {}) {
  const spec = PALETTE[index % PALETTE.length];
  const rotSign = Math.random() < 0.5 ? -1 : 1;
  const rot = rotSign * (8 + Math.random() * 14);
  const bot = mount(worldEl, { kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: "#FFFFFF" }, {
    id: nextId++,
    size: pickSize(),
    rot,
    state: "air",
    blinkStart: 0,
    nextBlink: 800 + Math.random() * 4000,
  });
  bot.hx = width / 2;
  bot.hy = -bot.size;
  bot.x = width / 2 + (Math.random() - 0.5) * 80;
  bot.y = fromAbove ? -bot.size - 40 : -20;
  return bot;
}

function destroyBot(bot) {
  bot.svg.remove();
  bots = bots.filter((b) => b !== bot);
}

function rebuild() {
  for (const b of bots) b.svg.remove();
  bots = [];
  confetti = [];
  confettiEl.replaceChildren();
  confettiSpawned = false;
  confettiAt = 0;
  worldEl.classList.remove("hop");
  heroEl.classList.remove("cheer");
  const n = botCountFor(armed);
  for (let i = 0; i < n; i++) bots.push(makePileBot(i));
  layoutAir(true);
  lastLanded = null;
  line = null;
  bubbleEl.hidden = true;
}

function ensureCount(spanSeconds) {
  const want = botCountFor(spanSeconds);
  let guard = 0;
  while (bots.length < want && guard++ < 80) {
    const bot = makePileBot(bots.length, { fromAbove: true });
    bots.push(bot);
  }
  const airborne = () => bots.filter((b) => b.state === "air" || b.state === "falling");
  while (bots.length > want) {
    const air = bots.filter((b) => b.state === "air");
    if (!air.length) break;
    const top = air.reduce((a, b) => (a.hy < b.hy ? a : b));
    destroyBot(top);
  }
  if (remainingSec() > 0.05 && airborne().length === 0) {
    const bot = makePileBot(bots.length, { fromAbove: true });
    bots.push(bot);
  }
  layoutAir(false);
}

function guardAirborne() {
  if (remainingSec() <= 0.05) return;
  const flying = bots.some((b) => b.state === "air" || b.state === "falling");
  if (flying) return;
  const bot = makePileBot(bots.length, { fromAbove: true });
  bots.push(bot);
  layoutAir(false);
  bot.landAt = endVirtual;
}

function scheduleAir() {
  for (const b of bots) {
    if (b.state === "falling" && b.landAt > endVirtual) {
      b.landAt = endVirtual;
      b.fallDur = Math.max(80, b.landAt - b.fallStart);
    }
  }
  let air = bots
    .filter((b) => b.state === "air")
    .slice()
    .sort((a, b) => b.hy - a.hy);
  const falling = bots.filter((b) => b.state === "falling");
  if (!air.length && remainingSec() > 0.05) {
    const latest = falling.reduce((m, b) => Math.max(m, b.landAt || 0), 0);
    if (!falling.length || latest < endVirtual - 40) {
      const bot = makePileBot(bots.length, { fromAbove: true });
      bots.push(bot);
      layoutAir(false);
      air = bots.filter((b) => b.state === "air").sort((a, b) => b.hy - a.hy);
    }
  }
  if (!air.length) return;
  let cursor = virtual;
  for (const b of falling) cursor = Math.max(cursor, b.landAt || virtual);
  if (cursor > endVirtual) cursor = endVirtual;
  const times = landingTimes(air.length, cursor, endVirtual);
  air.forEach((b, i) => {
    b.landAt = times[i];
  });
}

function startFall(bot) {
  const sx = bot.x;
  const sy = bot.y;
  bot.state = "falling";
  bot.fallStart = virtual;
  bot.fallDur = Math.max(180, bot.landAt - virtual);
  const landed = bots.filter((b) => b.state === "landed");
  const prev = landed.map((b) => ({ b, x: b.x, y: b.y }));
  layoutMound([...landed, bot], height - 6);
  bot.tx = bot.hx;
  bot.ty = bot.hy;
  bot.sx = sx;
  bot.sy = sy;
  bot.x = sx;
  bot.y = sy;
  for (const s of prev) {
    s.b.x = s.x;
    s.b.y = s.y;
  }
  layoutAir(false);
}

function tickMotion() {
  const air = bots.filter((b) => b.state === "air");
  for (const bot of air) {
    if (state === "running" && bot.landAt != null && virtual + 900 >= bot.landAt) {
      startFall(bot);
      continue;
    }
    bot.x += (bot.hx - bot.x) * 0.14;
    bot.y += (bot.hy - bot.y) * 0.14;
  }
  for (const bot of bots) {
    if (bot.state === "falling") {
      const t = Math.min(1, (virtual - bot.fallStart) / bot.fallDur);
      const ease = t * t * (3 - 2 * t);
      const drop = 1 - Math.pow(1 - t, 2.15);
      bot.x = bot.sx + (bot.tx - bot.sx) * ease;
      bot.y = bot.sy + (bot.ty - bot.sy) * drop;
      if (t >= 1) {
        bot.state = "landed";
        bot.x = bot.tx;
        bot.y = bot.ty;
        bot.hx = bot.tx;
        bot.hy = bot.ty;
        lastLanded = bot;
        layoutLanded();
      }
    } else if (bot.state === "landed") {
      bot.x += (bot.hx - bot.x) * 0.2;
      bot.y += (bot.hy - bot.y) * 0.2;
    }
    if (virtual > bot.nextBlink) {
      bot.blinkStart = virtual;
      bot.nextBlink = virtual + 2200 + Math.random() * 4200;
    }
  }
}

function paintGaze() {
  const center = clockCenter();
  const arrive = arrivalPoint();
  let topCut = Infinity;
  const landed = bots.filter((b) => b.state === "landed");
  if (landed.length) {
    const ys = landed.map((b) => b.y).sort((a, b) => a - b);
    topCut = ys[Math.min(ys.length - 1, Math.max(0, Math.floor(ys.length * 0.28)))];
  }
  for (const bot of bots) {
    let target = center;
    if (bot.state === "landed" && bot.y <= topCut + 8) target = arrive;
    else if (bot.state === "falling") target = { x: bot.tx, y: bot.ty };
    else if (bot.state === "air") target = center;
    const g = gazeVector(bot.x, bot.y, target.x, target.y);
    setEyes(bot, { gazeX: g.x, gazeY: g.y, blink: blinkScale(bot) });
    place(bot);
  }
  for (const bot of decorBots) {
    const g = gazeVector(bot.cx, bot.cy, center.x, center.y);
    setEyes(bot, { gazeX: g.x, gazeY: g.y, blink: blinkScale(bot) });
  }
  if (hero) {
    const target = lastLanded
      ? { x: lastLanded.x, y: lastLanded.y }
      : arrive;
    const hr = heroEl.getBoundingClientRect();
    const g = gazeVector(hr.left + hr.width / 2, hr.top + hr.height / 2, target.x, target.y);
    if (virtual > hero.nextBlink) {
      hero.blinkStart = virtual;
      hero.nextBlink = virtual + 2600 + Math.random() * 3000;
    }
    setEyes(hero, {
      gazeX: g.x,
      gazeY: g.y,
      blink: blinkScale(hero),
      eye: heroEye(),
      fill: heroFill(),
    });
  }
}

function counts() {
  const landed = bots.filter((b) => b.state === "landed").length;
  const air = bots.filter((b) => b.state === "air" || b.state === "falling").length;
  worldEl.dataset.bots = String(bots.length);
  worldEl.dataset.landed = String(landed);
  worldEl.dataset.air = String(air);
}

function renderChrome() {
  const rem = remainingSec();
  const shown = displaySeconds(rem);
  clockEl.textContent = formatClock(shown);
  clockEl.dataset.remaining = String(Math.round(rem * 1000) / 1000);
  document.body.dataset.state = state;
  document.body.dataset.phase = phase();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#000000" : "#ffffff";

  if (state === "done") {
    subEl.hidden = true;
    doneEl.hidden = false;
  } else {
    subEl.hidden = false;
    doneEl.hidden = true;
    const end = new Date(Date.now() + rem * 1000);
    subEl.textContent = `Ends ${formatEndTime(end)}`;
  }

  const preset = String(state === "idle" ? armed : Math.round(rem));
  for (const btn of document.querySelectorAll("[data-preset]")) {
    btn.setAttribute("aria-pressed", btn.dataset.preset === String(armed) && state !== "running" ? "true" : "false");
  }
  startBtn.textContent = state === "running" ? "Pause" : state === "paused" ? "Resume" : "Start";
  fillSteppers(state === "idle" ? armed : rem);
  counts();
  void preset;
}

function say(text, hold = 3400) {
  line = text;
  lineSince = virtual;
  bubbleEl.textContent = text;
  bubbleEl.hidden = false;
  bubbleEl.dataset.hold = String(hold);
}

function updateBubble() {
  if (state !== "running") {
    if (state !== "paused") bubbleEl.hidden = true;
    return;
  }
  const rem = remainingSec();
  const total = Math.max(rem, runSpan);
  let next = null;
  let hold = 3400;
  if (rem <= 12 && total > 15) {
    next = "almost…";
    hold = 20000;
  } else if (rem <= 60 && total >= 70) {
    next = "one minute left";
    hold = 20000;
  } else {
    const p = 1 - rem / total;
    if (p >= 0.72 && p < 0.86 && total >= 90) next = "still here with you";
    else if (p >= 0.48 && p < 0.6 && total >= 30) next = "halfway there";
    else if (p < 0.06) next = "on it.";
  }
  if (next && next !== line) say(next, hold);
  const allowed = Number(bubbleEl.dataset.hold || 3400);
  if (line && virtual - lineSince > allowed && next !== line) {
    line = null;
    bubbleEl.hidden = true;
  }
  if (!next && line && virtual - lineSince > Number(bubbleEl.dataset.hold || 3400)) {
    line = null;
    bubbleEl.hidden = true;
  }
}

function chime() {
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
      g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + 1.15);
    });
  } catch {
    /* autoplay blocked */
  }
}

function spawnConfetti() {
  confettiSpawned = true;
  const sources = bots.filter((b) => b.state === "landed");
  const n = 70;
  for (let i = 0; i < n; i++) {
    const spec = PALETTE[i % PALETTE.length];
    const src = sources.length ? sources[i % sources.length] : { x: width / 2, y: height - 40 };
    const bot = mount(confettiEl, { kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: "#FFFFFF" }, {
      id: nextId++,
      size: 10 + Math.random() * 12,
      rot: Math.random() * 40 - 20,
      state: "confetti",
    });
    bot.x = src.x + (Math.random() - 0.5) * 24;
    bot.y = src.y - 8;
    bot.vx = (Math.random() - 0.5) * 260;
    bot.vy = -40 - Math.random() * 150;
    bot.vr = (Math.random() - 0.5) * 240;
    bot.life = 2.4 + Math.random() * 0.8;
    bot.age = 0;
    confetti.push(bot);
  }
}

function tickConfetti(dt) {
  if (confettiAt && !confettiSpawned && performance.now() >= confettiAt) spawnConfetti();
  const sec = dt / 1000;
  for (const c of confetti) {
    c.age += sec;
    c.vy += 720 * sec;
    c.x += c.vx * sec;
    c.y += c.vy * sec;
    c.rot += c.vr * sec;
    const fade = Math.max(0, 1 - c.age / c.life);
    c.svg.style.opacity = String(fade);
    place(c);
  }
  if (confetti.length && confetti.every((c) => c.age > c.life)) {
    confetti = [];
    confettiEl.replaceChildren();
  }
}

function setLabel(text, { freeze = false } = {}) {
  labelFrozen = freeze;
  eyebrowEl.contentEditable = freeze ? "false" : "true";
  eyebrowEl.textContent = text;
}

function finish() {
  if (state === "done") return;
  state = "done";
  virtual = endVirtual;
  for (const b of bots) {
    if (b.state !== "landed") {
      b.state = "landed";
    }
  }
  layoutLanded();
  for (const b of bots) {
    b.x = b.hx;
    b.y = b.hy;
  }
  worldEl.classList.remove("hop");
  void worldEl.offsetWidth;
  worldEl.classList.add("hop");
  heroEl.classList.remove("cheer");
  void heroEl.offsetWidth;
  heroEl.classList.add("cheer");
  setLabel("TIME'S UP", { freeze: true });
  bubbleEl.hidden = true;
  line = null;
  chime();
  confettiAt = performance.now() + 520;
  confettiSpawned = false;
  renderChrome();
}

function commit(seconds, { runningRetarget = true } = {}) {
  const next = clampDuration(seconds);
  if (!next) {
    showHint("Try 10, 10:00, or 1:30:00.");
    return false;
  }
  showHint("");
  armed = next;
  save();
  updateUrl();
  typedEl.value = "";
  if ((state === "running" || state === "paused") && runningRetarget) {
    endVirtual = virtual + next * 1000;
    runSpan = elapsedSec() + next;
    ensureCount(Math.max(runSpan, next));
    scheduleAir();
    if (endVirtual <= virtual + 40) finish();
  } else if (state === "done" || state === "idle") {
    state = "idle";
    virtual = 0;
    endVirtual = 0;
    runSpan = armed;
    if (!labelFrozen) {
      /* keep custom label */
    } else {
      setLabel(label, { freeze: false });
    }
    if (labelFrozen) setLabel(label, { freeze: false });
    rebuild();
  }
  renderChrome();
  return true;
}

function shift(ms) {
  if (state === "done") {
    state = "idle";
    commit(Math.max(1, armed + ms / 1000), { runningRetarget: false });
    return;
  }
  if (state === "idle") {
    commit(armed + ms / 1000, { runningRetarget: false });
    return;
  }
  const nextEnd = endVirtual + ms;
  if (nextEnd <= virtual + 40) {
    endVirtual = virtual;
    finish();
    return;
  }
  endVirtual = nextEnd;
  runSpan = Math.max(1, runSpan + ms / 1000);
  armed = Math.max(1, Math.round(runSpan));
  save();
  updateUrl();
  ensureCount(runSpan);
  scheduleAir();
  if (ms > 0) say("still here with you");
  renderChrome();
}

function startOrPause() {
  if (state === "running") {
    state = "paused";
    renderChrome();
    return;
  }
  if (state === "done") {
    setLabel(label, { freeze: false });
    state = "idle";
    rebuild();
  }
  if (state === "idle") {
    virtual = 0;
    endVirtual = armed * 1000;
    runSpan = armed;
    scheduleAir();
    say("on it.");
  }
  state = "running";
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  renderChrome();
}

function reset() {
  state = "idle";
  virtual = 0;
  endVirtual = 0;
  runSpan = armed;
  setLabel(label, { freeze: false });
  confettiAt = 0;
  rebuild();
  renderChrome();
}

function applyTheme(next) {
  theme = next === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === "dark" ? "Light" : "Dark";
  themeBtn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  save();
  renderChrome();
}

function buildDecor() {
  decorEl.replaceChildren();
  decorBots = [];
  const small = window.innerWidth < 720;
  DECOR.forEach((spec, i) => {
    const bot = mount(decorEl, { kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: "#FFFFFF" }, {
      id: 1000 + i,
      size: small ? spec.size * 0.62 : spec.size,
      rot: spec.rot,
      state: "decor",
      nextBlink: 1000 + Math.random() * 4000,
      blinkStart: 0,
    });
    bot.svg.style.left = spec.x;
    bot.svg.style.top = spec.y;
    bot.svg.style.width = `${bot.size}px`;
    bot.svg.style.height = `${bot.size}px`;
    bot.svg.style.transform = `translate(-30%, -30%) rotate(${spec.rot}deg)`;
    const r = () => bot.svg.getBoundingClientRect();
    bot.cx = 0;
    bot.cy = 0;
    bot.readCenter = () => {
      const box = r();
      bot.cx = box.left + box.width / 2;
      bot.cy = box.top + box.height / 2;
    };
    decorBots.push(bot);
  });
}

function buildHero() {
  heroEl.replaceChildren();
  hero = mount(heroEl, { kind: "hero", fill: heroFill(), eye: heroEye() }, {
    id: 0,
    size: 160,
    rot: 0,
    state: "hero",
    nextBlink: 1500,
    blinkStart: 0,
  });
  hero.svg.style.position = "relative";
  hero.svg.style.width = "100%";
  hero.svg.style.height = "100%";
  hero.svg.style.transform = "none";
}

function boot() {
  const stored = readStore();
  const fromUrl = new URLSearchParams(location.search).get("t");
  if (stored?.label) label = String(stored.label).slice(0, 32) || label;
  if (stored?.theme) theme = stored.theme === "dark" ? "dark" : "light";
  let seconds = stored?.seconds || 600;
  if (fromUrl) {
    const parsed = parseDuration(fromUrl, { bare: "seconds" });
    if (parsed) seconds = parsed;
  }
  armed = clampDuration(seconds) || 600;
  runSpan = armed;
  setLabel(label, { freeze: false });
  applyTheme(theme);
  buildDecor();
  buildHero();
  rebuild();
  save();
  if (fromUrl) updateUrl();
  renderChrome();
  requestAnimationFrame(loop);
}

function loop(ts) {
  const dt = lastTs ? Math.min(48, ts - lastTs) : 16;
  lastTs = ts;
  if (state === "running") {
    virtual += dt;
    if (virtual > endVirtual) virtual = endVirtual;
    guardAirborne();
    tickMotion();
    updateBubble();
    if (virtual >= endVirtual) finish();
  } else {
    tickMotion();
  }
  for (const d of decorBots) d.readCenter?.();
  paintGaze();
  tickConfetti(dt);
  renderChrome();
  requestAnimationFrame(loop);
}

themeBtn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));
startBtn.addEventListener("click", startOrPause);
$("reset").addEventListener("click", reset);
$("minus1").addEventListener("click", () => shift(-60_000));
$("plus1").addEventListener("click", () => shift(60_000));
$("plus5").addEventListener("click", () => shift(300_000));

for (const btn of document.querySelectorAll("[data-preset]")) {
  btn.addEventListener("click", () => {
    const seconds = Number(btn.dataset.preset);
    if (state === "running" || state === "paused") commit(seconds);
    else commit(seconds, { runningRetarget: false });
  });
}

$("set-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const typed = typedEl.value.trim();
  const seconds = typed ? parseDuration(typed, { bare: "minutes" }) : fromSteppers();
  if (!seconds) {
    showHint("Try 10, 10:00, or 1:30:00.");
    return;
  }
  if (state === "running" || state === "paused") commit(seconds);
  else commit(seconds, { runningRetarget: false });
});

for (const input of [hhEl, mmEl, ssEl]) {
  input.addEventListener("input", () => {
    if (state !== "idle") return;
    const seconds = fromSteppers();
    if (seconds) commit(seconds, { runningRetarget: false });
  });
  input.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
}

eyebrowEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    eyebrowEl.blur();
  }
});
eyebrowEl.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData?.getData("text") || "").replace(/\s+/g, " ").trim().slice(0, 32);
  eyebrowEl.textContent = text;
});
eyebrowEl.addEventListener("blur", () => {
  if (labelFrozen) return;
  const text = (eyebrowEl.textContent || "").replace(/\s+/g, " ").trim().slice(0, 32);
  label = text || "BUILD TIME";
  eyebrowEl.textContent = label;
  save();
});

window.addEventListener("keydown", (e) => {
  if (e.key !== " " && e.code !== "Space") return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
  e.preventDefault();
  startOrPause();
});

window.addEventListener("resize", () => {
  width = window.innerWidth;
  height = window.innerHeight;
  buildDecor();
  layoutAir(false);
  layoutLanded();
});

boot();
