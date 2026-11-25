import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { chromePath, shotDir } from "./env.mjs";

const BASE = process.env.TIMER_URL || "http://127.0.0.1:43123";
const OUT = shotDir();
fs.mkdirSync(OUT, { recursive: true });

function track(page, errors) {
  page.on("pageerror", (err) => {
    if (/audio device/i.test(err.message)) return;
    errors.push(err.message);
  });
}

async function sample(page, ms) {
  return page.evaluate(async (duration) => {
    const eyes = document.querySelector("#hero .eyes");
    const spin = document.querySelector("#hero .spin");
    const samples = [];
    const start = performance.now();
    await new Promise((resolve) => {
      const frame = () => {
        const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(eyes.getAttribute("transform") || "");
        samples.push({
          x: Number(m?.[1]),
          y: Number(m?.[2]),
          spin: spin.getAttribute("transform"),
          eye: document.querySelector("#hero .e")?.getAttribute("fill"),
        });
        if (performance.now() - start < duration) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    let max = 0;
    for (let i = 1; i < samples.length; i++) {
      max = Math.max(max, Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
    }
    return {
      n: samples.length,
      max: Number(max.toFixed(3)),
      eye: samples.at(-1)?.eye,
      spin: samples.at(-1)?.spin,
    };
  }, ms);
}

const errors = [];
const notes = [];
const browser = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  track(page, errors);
  await page.addInitScript(() => {
    window.Notification = class {
      static permission = "denied";
      static requestPermission() {
        return Promise.resolve("denied");
      }
    };
  });
  await page.addInitScript(() => {
    window.__eyeSteps = [];
    const watch = () => {
      const eyes = document.querySelector("#hero .eyes");
      if (!eyes) {
        requestAnimationFrame(watch);
        return;
      }
      const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(eyes.getAttribute("transform") || "");
      const step = { x: Number(m?.[1]), y: Number(m?.[2]) };
      const prev = window.__eyeSteps.at(-1);
      if (!prev || prev.x !== step.x || prev.y !== step.y) window.__eyeSteps.push(step);
      if (window.__eyeSteps.length < 50) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.goto(`${BASE}/?t=3`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#hero .eyes");
  const boot = await page.evaluate(() => {
    const steps = window.__eyeSteps || [];
    let max = 0;
    for (let i = 1; i < steps.length; i++) {
      max = Math.max(max, Math.hypot(steps[i].x - steps[i - 1].x, steps[i].y - steps[i - 1].y));
    }
    return { n: steps.length, max: Number(max.toFixed(3)), start: steps[0], end: steps.at(-1) };
  });
  notes.push(`boot\tmaxMove=${boot.max}px\tframes=${boot.n}\tfrom=${boot.start?.x},${boot.start?.y}\tto=${boot.end?.x},${boot.end?.y}`);
  if (!(boot.max < 2.2)) throw new Error(`boot eye jumped ${boot.max}px`);

  const phases = [];
  phases.push(["load", await sample(page, 700)]);
  await page.screenshot({ path: path.join(OUT, "eye-glide-1.png") });
  await page.setViewportSize({ width: 820, height: 640 });
  phases.push(["resize", await sample(page, 500)]);
  await page.screenshot({ path: path.join(OUT, "eye-glide-2.png") });
  await page.click("#start");
  phases.push(["running", await sample(page, 600)]);
  await page.screenshot({ path: path.join(OUT, "eye-glide-3.png") });
  await page.keyboard.press("Space");
  phases.push(["pause", await sample(page, 400)]);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  phases.push(["return", await sample(page, 500)]);
  await page.keyboard.press("Escape");
  await page.click("#mode-stopwatch");
  phases.push(["mode", await sample(page, 400)]);
  await page.goto(`${BASE}/?t=2`, { waitUntil: "networkidle" });
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "done", { timeout: 8000 });
  phases.push(["dance", await sample(page, 700)]);
  await page.screenshot({ path: path.join(OUT, "eye-glide-4.png") });

  for (const [name, result] of phases) {
    notes.push(`${name}\tmaxMove=${result.max}px\tframes=${result.n}\teye=${result.eye}`);
    if (!(result.max < 2.2)) throw new Error(`${name} eye jumped ${result.max}px`);
    if (result.eye?.toUpperCase() !== "#FFFFFF") throw new Error(`${name} eye color ${result.eye}`);
    if (!/scale\(1 /.test(result.spin || "")) throw new Error(`${name} blink moved the eyes: ${result.spin}`);
  }
} finally {
  await browser.close();
}

const reduced = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await reduced.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  track(page, errors);
  await page.goto(`${BASE}/?t=10`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hero .eyes");
  const result = await sample(page, 600);
  notes.push(`reduced\tmaxMove=${result.max}px\tframes=${result.n}`);
  if (!(result.max < 1.2)) throw new Error(`reduced-motion eye jumped ${result.max}px`);
} finally {
  await reduced.close();
}

fs.writeFileSync(path.join(OUT, "eye-glide.txt"), `${notes.join("\n")}\n`);
if (errors.length) throw new Error(errors.join("\n"));
console.log(notes.join("\n"));
