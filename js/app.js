import "../css/styles.css";
import {
  clampDuration,
  parseDuration,
  formatClock,
  displaySeconds,
  toParam,
  formatEndTime,
} from "./time.js";
import { createBotElement, setEyes, PALETTE } from "./shapes.js";

const STORE_KEY = "grok-bot-timer";

const $ = (id) => document.getElementById(id);
const decorEl = $("decor");
const worldEl = $("world");
const confettiEl = $("confetti");
const clockEl = $("clock");
const clusterEl = $("clock-cluster");
const subEl = $("sub");
const doneEl = $("done-line");
const eyebrowEl = $("eyebrow");
const bubbleEl = $("bubble");
const heroEl = $("hero");
const heroWrapEl = heroEl.parentElement;
const playLayerEl = $("play-layer");
const endScreenEl = $("end-screen");
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
let motionClock = 0;
let wind = 36;
let nextSpawnAt = Infinity;
let finalQueued = true;
let flipToken = 0;
let heroPlaying = false;
let playClock = 0;
const play = {
  x: 0,
  y: 0,
  tx: 0,
  ty: 0,
  hopping: false,
  hopT: 0,
  nextHop: 0,
};

function prefersReduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function layoutMode(next = state) {
  if (next === "running" || next === "paused") return "focus";
  if (next === "done") return "end";
  return "setup";
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
  return theme === "dark" ? "#2E2E33" : "#0A0A0A";
}
function heroEye() {
  return "#FFFFFF";
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

const BOT_EYE = "#FFFFFF";

function baseSize() {
  const min = width < 720 ? 40 : 56;
  const max = width < 720 ? 52 : 72;
  const pct = width < 720 ? 0.12 : 0.06;
  return Math.round(Math.max(min, Math.min(max, width * pct)));
}

function frameSize() {
  const base = baseSize();
  const min = width < 720 ? 40 : 56;
  const max = width < 720 ? 52 : 72;
  return Math.round(Math.max(min, Math.min(max, base * (0.94 + Math.random() * 0.1))));
}

function fallPhysics(depth) {
  const drag = 6.4;
  const vt = (500 + depth * 480) * Math.max(0.8, height / 880);
  return { drag, vt, grav: vt * drag };
}

function mixHex(from, to, t) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(from);
  const b = parse(to);
  return `#${a
    .map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0"))
    .join("")}`;
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

function splashScale(bot) {
  const t = bot.splashT || 0;
  if (t < 90) return { sx: 1.26, sy: 0.72 };
  if (t < 200) return { sx: 0.9, sy: 1.16 };
  if (t < 310) return { sx: 1.08, sy: 0.9 };
  return { sx: 1, sy: 1 };
}

function place(bot) {
  const bob = bot.state === "frame" ? Math.sin(motionClock / 620 + bot.id) * 3.4 : 0;
  const sc = bot.state === "splash" ? splashScale(bot) : { sx: 1, sy: 1 };
  bot.svg.style.width = `${bot.size}px`;
  bot.svg.style.height = `${bot.size}px`;
  bot.svg.style.transform = `translate(${bot.x - bot.size / 2}px, ${bot.y + bob - bot.size / 2}px) rotate(${bot.rot || 0}deg) scale(${sc.sx}, ${sc.sy})`;
}

function gazeVector(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const m = Math.hypot(dx, dy) || 1;
  return { x: Math.max(-1, Math.min(1, dx / m)), y: Math.max(-1, Math.min(1, dy / m)) };
}

function blinkScale(bot, clock = virtual) {
  if (!bot.blinkStart) return 1;
  const t = (clock - bot.blinkStart) / 150;
  if (t < 0 || t > 1) return 1;
  return t < 0.45 ? 1 - (t / 0.45) * 0.9 : 0.1 + ((t - 0.45) / 0.55) * 0.9;
}

function clockCenter() {
  const r = clockEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function arrivalPoint() {
  const falling = bots.filter((b) => b.state === "falling" || b.state === "splash");
  if (falling.length) {
    const b = falling[falling.length - 1];
    return { x: b.x, y: b.y };
  }
  return clockCenter();
}

function layoutMound(list) {
  if (!list.length) return;
  const sorted = [...list].sort((a, b) => b.size - a.size || a.id - b.id);
  const maxW = Math.max(160, width - 16);
  const rows = [];
  let i = 0;
  let row = 0;
  while (i < sorted.length) {
    const budget = maxW * Math.max(0.58, 1 - row * 0.05);
    const rowBots = [];
    let used = 0;
    while (i < sorted.length) {
      const b = sorted[i];
      const need = b.size * 0.74;
      if (rowBots.length && used + need > budget) break;
      rowBots.push(b);
      used += need;
      i++;
    }
    rows.push({ bots: rowBots, used, h: Math.max(...rowBots.map((b) => b.size)) });
    row++;
  }
  let floor = height - 8;
  for (const r of rows) {
    let x = width / 2 - r.used / 2;
    for (const b of r.bots) {
      const inset = b.size * 0.55;
      let hx = x + b.size * 0.37;
      hx = Math.max(inset, Math.min(width - inset, hx));
      b.hx = hx;
      b.hy = floor - b.size / 2;
      x += b.size * 0.74;
    }
    floor -= r.h * 0.5;
  }
}

function pileCap() {
  const s = baseSize();
  const per = Math.max(4, Math.floor((width - 16) / (s * 0.74)));
  const rows = Math.max(1, Math.floor((height * 0.36) / (s * 0.5)));
  return per * rows;
}

function layoutLanded() {
  const landed = bots.filter((b) => b.state === "landed" && !b.retiring);
  const cap = pileCap();
  if (landed.length > cap) {
    const ranked = [...landed].sort((a, b) => {
      const edgeA = Math.abs(a.x - width / 2) / width;
      const edgeB = Math.abs(b.x - width / 2) / width;
      return a.id - edgeA * 1e6 - (b.id - edgeB * 1e6);
    });
    for (let i = 0; i < landed.length - cap; i++) {
      ranked[i].retiring = true;
      ranked[i].retireT = ranked[i].retireT || 0;
    }
  }
  layoutMound(bots.filter((b) => b.state === "landed" && !b.retiring));
}

function frameSlots() {
  const s = baseSize();
  const slots = [];
  const step = s * 0.82;
  const across = Math.max(8, Math.min(18, Math.round((width + s * 0.35) / step)));
  const rows = height >= 500 ? 2 : 1;
  for (let row = 0; row < rows; row++) {
    const n = row === 0 ? across : Math.max(6, across - 2);
    const span = width + s * 0.45;
    const dx = span / n;
    for (let i = 0; i < n; i++) {
      slots.push({
        edge: "top",
        x: -s * 0.22 + i * dx + (row ? dx * 0.48 : 0),
        y: s * (0.28 + row * 0.52),
      });
    }
  }
  const bStep = (width + s * 0.35) / across;
  for (let i = 0; i < across; i++) {
    slots.push({
      edge: "bottom",
      x: -s * 0.18 + i * bStep,
      y: height - s * 0.2,
    });
  }
  const vStep = s * 0.8;
  const sideN = Math.max(2, Math.floor((height - s * 2.2) / vStep));
  for (let i = 0; i < sideN; i++) {
    const y = s * 1.25 + i * vStep;
    if (y > height - s * 1.2) break;
    slots.push({ edge: "left", x: s * 0.16, y });
    slots.push({ edge: "right", x: width - s * 0.16, y });
  }
  return slots;
}

function orderWorld() {
  const rank = (b) => (b.state === "frame" ? 0 : b.state === "falling" ? 1 + (b.depth || 0) : 4);
  const ordered = [...bots].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  for (const b of ordered) worldEl.appendChild(b.svg);
}

function rebuildFrame() {
  for (const b of bots) {
    if (b.state === "frame") b.svg.remove();
  }
  bots = bots.filter((b) => b.state !== "frame");
  frameSlots().forEach((slot, i) => {
    const spec = PALETTE[i % PALETTE.length];
    const bot = mount(worldEl, { kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: BOT_EYE }, {
      id: nextId++,
      size: frameSize(),
      rot: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 8),
      state: "frame",
      nextBlink: motionClock + 400 + Math.random() * 2400,
      blinkStart: 0,
    });
    bot.edge = slot.edge;
    bot.fill = spec.fill;
    bot.dash = !!spec.dash;
    bot.hx = slot.x;
    bot.hy = slot.y;
    bot.x = slot.x;
    bot.y = slot.y;
    bot.svg.dataset.edge = slot.edge;
    bot.svg.dataset.role = "frame";
    bots.push(bot);
  });
  orderWorld();
}

function surfaceY(x, size) {
  let y = height - size * 0.18;
  for (const b of bots) {
    if ((b.state !== "landed" && b.state !== "splash") || b.retiring) continue;
    if (Math.abs(b.x - x) < (b.size + size) * 0.45) y = Math.min(y, b.y - b.size * 0.46);
  }
  return y;
}

function predictFallMs(depth, size) {
  const { drag, grav } = fallPhysics(depth);
  let y = -size * 0.2;
  let vy = 30 + depth * 30;
  const floor = height - size * 0.18;
  let t = 0;
  const step = 16;
  while (y < floor && t < 5000) {
    const sec = step / 1000;
    vy += (grav - drag * vy) * sec;
    y += vy * sec;
    t += step;
  }
  return t;
}

function pulseTop(x) {
  let best = null;
  let dist = Infinity;
  for (const b of bots) {
    if (b.state !== "frame" || b.edge !== "top" || b.refillStart != null) continue;
    const d = Math.abs(b.hx - x);
    if (d < dist) {
      dist = d;
      best = b;
    }
  }
  if (best && dist < best.size * 1.6) best.refillStart = motionClock;
}

function spawnDrop(opts = {}) {
  const spec = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const depth = opts.depth ?? Math.random();
  const base = baseSize();
  const min = width < 720 ? 40 : 56;
  const max = width < 720 ? 52 : 72;
  const size = Math.round(Math.max(min, Math.min(max, base * (0.86 + depth * 0.16))));
  const phys = fallPhysics(depth);
  const bot = mount(worldEl, { kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: BOT_EYE }, {
    id: nextId++,
    size,
    rot: Math.max(-6, Math.min(6, wind * 0.055 + (Math.random() - 0.5) * 2.2)),
    state: "falling",
    nextBlink: motionClock + 600,
    blinkStart: 0,
  });
  bot.depth = depth;
  bot.fill = spec.fill;
  bot.dash = !!spec.dash;
  bot.x = opts.x ?? size * 0.15 + Math.random() * Math.max(20, width - size * 0.3);
  bot.y = -size * (0.08 + Math.random() * 0.28);
  bot.vx = wind * (0.72 + Math.random() * 0.5) * (0.62 + depth * 0.5);
  bot.vy = 16 + depth * 36;
  bot.drag = phys.drag;
  bot.grav = phys.grav;
  bot.opacity = 0.5 + depth * 0.5;
  bot.final = !!opts.final;
  bot.svg.classList.add("falling");
  bot.svg.dataset.role = "rain";
  bot.svg.style.opacity = String(bot.opacity);
  bot.svg.style.zIndex = String(2 + Math.round(depth * 6));
  bots.push(bot);
  pulseTop(bot.x);
  orderWorld();
}

function armRain() {
  wind = (Math.random() < 0.5 ? -1 : 1) * (24 + Math.random() * 42);
  nextSpawnAt = virtual + 140 + Math.random() * 360;
  finalQueued = false;
}

function tickSpawn() {
  if (state !== "running" || finalQueued) return;
  const size = baseSize();
  const travel = predictFallMs(0.84, size);
  const finalAt = endVirtual - travel;
  const span = Math.max(1, runSpan * 1000);
  const prog = Math.max(0, Math.min(1, 1 - (endVirtual - virtual) / span));
  if (virtual >= finalAt) {
    spawnDrop({ depth: 0.84, final: true });
    finalQueued = true;
    return;
  }
  if (virtual < nextSpawnAt) return;
  spawnDrop();
  const interval = (720 - prog * 260) * (0.58 + Math.random() * 0.85);
  nextSpawnAt = virtual + interval;
  if (nextSpawnAt > finalAt) nextSpawnAt = finalAt;
}

function startSplash(bot) {
  bot.state = "splash";
  bot.splashT = 0;
  bot.bounces = 1;
  bot.splashFloor = bot.y;
  bot.vy = -Math.min(210, Math.abs(bot.vy) * 0.25);
  bot.svg.classList.remove("falling");
  lastLanded = bot;
}

function tickMotion(dt) {
  const sec = Math.max(0, dt / 1000);
  for (const bot of bots) {
    if (bot.state === "frame") {
      bot.x = bot.hx;
      bot.y = bot.hy;
    } else if (bot.state === "falling" && sec > 0) {
      bot.vy += (bot.grav - bot.drag * bot.vy) * sec;
      bot.x += bot.vx * sec;
      bot.y += bot.vy * sec;
      if (bot.final && virtual < endVirtual - 40 && bot.y > surfaceY(bot.x, bot.size) - 10) {
        bot.y = Math.min(bot.y, surfaceY(bot.x, bot.size) - 8);
        bot.vy = Math.min(bot.vy, 80);
      }
      if (bot.y >= surfaceY(bot.x, bot.size)) {
        bot.y = surfaceY(bot.x, bot.size);
        startSplash(bot);
      }
    } else if (bot.state === "splash" && sec > 0) {
      bot.splashT += dt;
      bot.vy += bot.grav * sec;
      bot.y += bot.vy * sec;
      bot.x += bot.vx * sec * 0.2;
      if (bot.y >= bot.splashFloor) {
        bot.y = bot.splashFloor;
        bot.vy = -bot.vy * 0.28;
        bot.bounces = (bot.bounces || 0) + 1;
        if (bot.bounces >= 2 || Math.abs(bot.vy) < 55 || bot.splashT > 460) {
          bot.state = "landed";
          bot.vy = 0;
          bot.vx = 0;
          layoutLanded();
        }
      }
    } else if (bot.state === "landed" && sec > 0 && bot.hx != null) {
      const k = Math.min(1, dt / 170);
      bot.x += (bot.hx - bot.x) * k;
      bot.y += (bot.hy - bot.y) * k;
    }
    if (motionClock > (bot.nextBlink || 0)) {
      bot.blinkStart = motionClock;
      bot.nextBlink = motionClock + 1800 + Math.random() * 3200;
    }
  }
}

function tickRetire(dt) {
  for (const bot of bots) {
    if (!bot.retiring) continue;
    bot.retireT = (bot.retireT || 0) + dt;
    bot.svg.style.opacity = String(Math.max(0, 1 - bot.retireT / 380));
    if (bot.retireT > 380) bot.dead = true;
  }
  if (!bots.some((b) => b.dead)) return;
  bots = bots.filter((b) => {
    if (!b.dead) return true;
    b.svg.remove();
    return false;
  });
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
  finalQueued = true;
  nextSpawnAt = Infinity;
  lastLanded = null;
  line = null;
  bubbleEl.hidden = true;
  rebuildFrame();
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
    else if (bot.state === "falling" || bot.state === "splash") target = { x: bot.x + (bot.vx || 0) * 0.15, y: bot.y + bot.size };
    const g = gazeVector(bot.x, bot.y, target.x, target.y);
    setEyes(bot, { gazeX: g.x, gazeY: g.y, blink: blinkScale(bot, motionClock), eye: BOT_EYE });
    if (bot.state === "frame" && bot.refillStart != null) {
      const p = Math.min(1, (motionClock - bot.refillStart) / 1000);
      const ease = 1 - Math.pow(1 - p, 2);
      bot.svg.style.opacity = String(0.22 + 0.78 * ease);
      setEyes(bot, {
        gazeX: g.x,
        gazeY: g.y,
        blink: blinkScale(bot, motionClock),
        eye: BOT_EYE,
        fill: mixHex("#141414", bot.fill, ease),
      });
      if (p >= 1) {
        bot.refillStart = null;
        bot.svg.style.opacity = "1";
      }
    } else if (bot.state === "falling") {
      bot.svg.style.opacity = String(bot.opacity ?? 1);
    }
    place(bot);
  }
  for (const bot of decorBots) {
    const g = gazeVector(bot.cx, bot.cy, center.x, center.y);
    setEyes(bot, { gazeX: g.x, gazeY: g.y, blink: blinkScale(bot), eye: BOT_EYE });
  }
  if (hero) {
    const clock = state === "done" ? playClock : virtual;
    const target = heroPlaying
      ? { x: play.tx, y: play.ty }
      : lastLanded
        ? { x: lastLanded.x, y: lastLanded.y }
        : arrive;
    const hr = heroEl.getBoundingClientRect();
    const g = gazeVector(hr.left + hr.width / 2, hr.top + hr.height / 2, target.x, target.y);
    if (clock > hero.nextBlink) {
      hero.blinkStart = clock;
      hero.nextBlink = clock + (state === "done" ? 900 : 2600) + Math.random() * (state === "done" ? 1400 : 3000);
    }
    setEyes(hero, {
      gazeX: g.x,
      gazeY: g.y,
      blink: blinkScale(hero, clock),
      eye: heroEye(),
      fill: heroFill(),
    });
  }
}

function counts() {
  const landed = bots.filter((b) => b.state === "landed").length;
  const air = bots.filter((b) => b.state === "falling" || b.state === "splash").length;
  worldEl.dataset.bots = String(bots.length);
  worldEl.dataset.landed = String(landed);
  worldEl.dataset.air = String(air);
}

function runFlip(first, last) {
  const token = ++flipToken;
  const fw = first.width || 1;
  const lw = last.width || 1;
  const dx = first.left + fw / 2 - (last.left + lw / 2);
  const dy = first.top + first.height / 2 - (last.top + last.height / 2);
  const s = Math.max(0.2, Math.min(4, fw / lw));
  const ms = prefersReduced() ? 280 : 720;
  clusterEl.style.transition = "none";
  clusterEl.style.transformOrigin = "center center";
  clusterEl.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  void clusterEl.offsetWidth;
  requestAnimationFrame(() => {
    if (token !== flipToken) return;
    clusterEl.style.transition = `transform ${ms}ms cubic-bezier(.2,.8,.2,1)`;
    clusterEl.style.transform = "translate(0px, 0px) scale(1)";
  });
  const clear = () => {
    if (token !== flipToken) return;
    flipToken += 1;
    clusterEl.style.transition = "";
    clusterEl.style.transform = "";
    clusterEl.removeEventListener("transitionend", onEnd);
  };
  const onEnd = (event) => {
    if (event.target !== clusterEl || event.propertyName !== "transform") return;
    clear();
  };
  clusterEl.addEventListener("transitionend", onEnd);
  setTimeout(clear, ms + 90);
}

function endOccupied() {
  const title = $("end-title")?.getBoundingClientRect();
  const actions = document.querySelector(".end-actions")?.getBoundingClientRect();
  if (!title || !actions || title.width < 8) return null;
  const padX = 96;
  const padY = 72;
  return {
    left: Math.min(title.left, actions.left) - padX,
    right: Math.max(title.right, actions.right) + padX,
    top: title.top - padY,
    bottom: actions.bottom + padY,
  };
}

function playBlocked(x, y) {
  const box = endOccupied();
  if (!box) return false;
  return x > box.left && x < box.right && y > box.top && y < box.bottom;
}

function pickPlayTarget() {
  const spots = [
    { x: width * (0.1 + Math.random() * 0.8), y: height * (0.76 + Math.random() * 0.14) },
    { x: width * (0.08 + Math.random() * 0.18), y: height * (0.74 + Math.random() * 0.16) },
    { x: width * (0.74 + Math.random() * 0.18), y: height * (0.74 + Math.random() * 0.16) },
    { x: width * (0.12 + Math.random() * 0.76), y: height * (0.06 + Math.random() * 0.1) },
  ];
  for (const spot of spots) {
    if (!playBlocked(spot.x, spot.y)) {
      play.tx = Math.max(70, Math.min(width - 70, spot.x));
      play.ty = Math.max(70, Math.min(height - 70, spot.y));
      return;
    }
  }
  play.tx = width * 0.5;
  play.ty = height * 0.86;
}

function startHeroPlay() {
  if (heroPlaying) return;
  const box = heroEl.getBoundingClientRect();
  play.x = box.left + box.width / 2;
  play.y = box.top + box.height / 2;
  play.tx = play.x;
  play.ty = play.y;
  play.hopping = false;
  play.hopT = 0;
  play.nextHop = playClock + 280;
  hero.blinkStart = 0;
  hero.nextBlink = playClock + 360;
  heroPlaying = true;
  playLayerEl.hidden = false;
  playLayerEl.setAttribute("aria-hidden", "false");
  playLayerEl.appendChild(heroEl);
  const playSize = Math.max(112, Math.min(156, box.width));
  heroEl.style.width = `${playSize}px`;
  heroEl.style.height = `${playSize}px`;
  heroEl.style.transform = `translate(${play.x}px, ${play.y}px) translate(-50%, -50%)`;
  pickPlayTarget();
}

function stopHeroPlay() {
  if (!heroPlaying && heroEl.parentElement === heroWrapEl) return;
  heroPlaying = false;
  heroWrapEl.appendChild(heroEl);
  heroEl.style.transform = "";
  heroEl.style.width = "";
  heroEl.style.height = "";
  playLayerEl.hidden = true;
  playLayerEl.setAttribute("aria-hidden", "true");
}

function tickPlay(dt) {
  if (!heroPlaying) return;
  playClock += dt;
  const reduce = prefersReduced();
  const rate = 1 - Math.pow(1 - (reduce ? 0.018 : 0.04), dt / 16.67);
  if (playBlocked(play.x, play.y) || playBlocked(play.tx, play.ty)) {
    play.tx = play.x < width / 2 ? width * 0.12 : width * 0.88;
    play.ty = height * 0.84;
    if (playBlocked(play.tx, play.ty)) {
      play.tx = width * 0.5;
      play.ty = height * 0.88;
    }
  }
  play.x += (play.tx - play.x) * rate;
  play.y += (play.ty - play.y) * rate;
  if (Math.hypot(play.tx - play.x, play.ty - play.y) < 28) pickPlayTarget();

  let hop = reduce ? Math.sin(playClock / 900) * 5 : 0;
  let sx = 1;
  let sy = 1;
  if (!reduce && playClock > play.nextHop && !play.hopping) {
    play.hopping = true;
    play.hopT = 0;
    play.nextHop = playClock + 1100 + Math.random() * 1600;
  }
  if (play.hopping) {
    play.hopT += dt;
    const t = play.hopT / 560;
    if (t >= 1) {
      play.hopping = false;
    } else {
      hop = Math.sin(Math.min(1, t) * Math.PI) * 42;
      if (t < 0.16) {
        sx = 1.18;
        sy = 0.82;
      } else if (t < 0.55) {
        sx = 0.88;
        sy = 1.16;
      } else {
        sx = 1.12;
        sy = 0.86;
      }
    }
  }
  const tilt = reduce ? 0 : Math.max(-14, Math.min(14, (play.tx - play.x) * 0.05));
  heroEl.style.transform = `translate(${play.x}px, ${play.y - hop}px) translate(-50%, -50%) scale(${sx}, ${sy}) rotate(${tilt}deg)`;
}

function renderChrome() {
  const rem = remainingSec();
  const shown = displaySeconds(rem);
  clockEl.textContent = formatClock(shown);
  clockEl.dataset.remaining = String(Math.round(rem * 1000) / 1000);
  const prevLayout = document.body.dataset.layout || "setup";
  const nextLayout = layoutMode();
  const shouldFlip =
    (prevLayout === "setup" && nextLayout === "focus") ||
    (prevLayout === "focus" && nextLayout === "setup");
  const first = shouldFlip ? clusterEl.getBoundingClientRect() : null;
  document.body.dataset.state = state;
  document.body.dataset.layout = nextLayout;
  document.body.dataset.phase = phase();
  if (first) {
    const last = clusterEl.getBoundingClientRect();
    if (last.width > 0 && first.width > 0) runFlip(first, last);
  }
  if (nextLayout === "end" && prevLayout !== "end") startHeroPlay();
  if (nextLayout !== "end" && prevLayout === "end") stopHeroPlay();
  endScreenEl.setAttribute("aria-hidden", nextLayout === "end" ? "false" : "true");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#000000" : "#ffffff";

  if (state === "done") {
    subEl.hidden = true;
    doneEl.hidden = true;
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
  const focusLabel = state === "paused" ? "Resume" : "Pause";
  startBtn.textContent = state === "running" ? "Pause" : state === "paused" ? "Resume" : "Start";
  if (focusPauseBtn) focusPauseBtn.textContent = focusLabel;
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
    const bot = mount(confettiEl, { kind: spec.kind, fill: spec.fill, dash: !!spec.dash, eye: BOT_EYE }, {
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
  finalQueued = true;
  for (const b of bots) {
    if (b.state === "falling" || b.state === "splash") {
      b.state = "landed";
      b.svg.classList.remove("falling");
      b.vy = 0;
      b.svg.style.opacity = "1";
    }
  }
  layoutLanded();
  for (const b of bots) {
    if (b.state === "landed" && b.hx != null) {
      b.x = b.hx;
      b.y = b.hy;
    }
  }
  worldEl.classList.remove("hop");
  void worldEl.offsetWidth;
  worldEl.classList.add("hop");
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
    if (finalQueued && endVirtual > virtual + 900) {
      finalQueued = false;
      nextSpawnAt = virtual + 180;
    }
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
  if (finalQueued && endVirtual > virtual + 900) {
    finalQueued = false;
    nextSpawnAt = virtual + 180;
  }
  if (ms > 0) say("still here with you");
  renderChrome();
}

function restart() {
  stopHeroPlay();
  setLabel(label, { freeze: false });
  state = "idle";
  virtual = 0;
  endVirtual = 0;
  runSpan = armed;
  confettiAt = 0;
  confettiSpawned = false;
  rebuild();
  virtual = 0;
  endVirtual = armed * 1000;
  runSpan = armed;
  armRain();
  say("on it.");
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
  if (state === "idle") {
    virtual = 0;
    endVirtual = armed * 1000;
    runSpan = armed;
    armRain();
    say("on it.");
  }
  state = "running";
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  renderChrome();
}

function reset() {
  stopHeroPlay();
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
  motionClock += dt;
  if (state === "running") {
    virtual += dt;
    if (virtual > endVirtual) virtual = endVirtual;
    tickSpawn();
    tickMotion(dt);
    updateBubble();
    if (virtual >= endVirtual) finish();
  } else {
    tickMotion(0);
  }
  tickRetire(dt);
  if (state === "done") tickPlay(dt);
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

const focusDock = $("focus-dock");
const focusPauseBtn = $("focus-pause");
const focusResetBtn = $("focus-reset");
let dockTimer = 0;

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

focusPauseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  startOrPause();
  revealDock();
});
focusResetBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  reset();
});
window.addEventListener("pointermove", revealDock);
window.addEventListener("pointerdown", revealDock);

$("restart").addEventListener("click", restart);
$("new-timer").addEventListener("click", reset);

window.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
  if (e.key === "Escape" && state !== "idle") {
    if (typing) return;
    e.preventDefault();
    reset();
    return;
  }
  if (typing || tag === "BUTTON") return;
  const space = e.key === " " || e.code === "Space";
  if (state === "done" && (space || e.key === "Enter")) {
    e.preventDefault();
    restart();
    return;
  }
  if (!space) return;
  e.preventDefault();
  startOrPause();
});

window.addEventListener("resize", () => {
  width = window.innerWidth;
  height = window.innerHeight;
  rebuildFrame();
  layoutLanded();
});

boot();
