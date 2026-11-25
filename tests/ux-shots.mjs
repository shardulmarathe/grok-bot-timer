import { chromium } from "playwright";
import { chooseFill, contrastOnWhite, hexToOklch } from "../js/color.js";
import { chromePath, shotDir } from "./env.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.TIMER_URL || "http://127.0.0.1:43123";
const OUT = shotDir();
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

function track(page) {
  page.on("pageerror", (err) => {
    if (/audio device/i.test(err.message)) return;
    errors.push(err.message);
  });
}

async function overflow(page) {
  return page.evaluate(() => {
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const nodes = [...document.querySelectorAll(".wheel, .controls, .modes, .hero-wrap, #start, .presets")];
    const boxes = nodes.filter((el) => getComputedStyle(el).display !== "none").map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.id || el.className, top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) };
    });
    const clipped = boxes.filter((b) => b.bottom > viewH + 2 || b.right > viewW + 2 || b.top < -2);
    const wheelShown = getComputedStyle(document.querySelector("#wheel")).display !== "none";
    const clockShown = getComputedStyle(document.querySelector("#clock")).display !== "none";
    return { viewH, viewW, clipped, wheelShown, clockShown, both: wheelShown && clockShown };
  });
}

const browser = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  track(page);
  await page.addInitScript(() => {
    window.Notification = class {
      static permission = "denied";
      static requestPermission() {
        return Promise.resolve("denied");
      }
    };
  });
  await page.goto(`${BASE}/?t=10m`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#wheel .wheel-item");
  const desk = await overflow(page);
  if (desk.both) throw new Error("timer shows wheel and digits together");
  if (!desk.wheelShown) throw new Error("timer wheel hidden");
  if (desk.clipped.length) throw new Error(`desktop overflow ${JSON.stringify(desk.clipped)}`);
  await page.screenshot({ path: path.join(OUT, "timer-wheel-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const phone = await overflow(page);
  if (phone.both || !phone.wheelShown) throw new Error(`mobile wheel ${JSON.stringify(phone)}`);
  if (phone.clipped.length) throw new Error(`mobile overflow ${JSON.stringify(phone.clipped)}`);
  await page.screenshot({ path: path.join(OUT, "timer-wheel-mobile.png") });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.click("#mode-stopwatch");
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "running");
  const level = await page.$eval("#hero .liquid", (el) => Number(el.getAttribute("y")));
  if (level < 100) throw new Error(`stopwatch still filling y=${level}`);
  await page.evaluate(() => {
    const run = JSON.parse(localStorage.getItem("grok-bot-timer-run"));
    run.state = "paused";
    run.watchAccum = 95000;
    run.laps = [
      { total: 95, split: 20 },
      { total: 75, split: 40 },
      { total: 35, split: 15 },
      { total: 20, split: 20 },
    ];
    localStorage.setItem("grok-bot-timer-run", JSON.stringify(run));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#laps li.lap-fast");
  await page.screenshot({ path: path.join(OUT, "stopwatch-laps-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const watchPhone = await overflow(page);
  if (watchPhone.clipped.length) throw new Error(`stopwatch mobile overflow ${JSON.stringify(watchPhone.clipped)}`);
  await page.screenshot({ path: path.join(OUT, "stopwatch-laps-mobile.png") });

  const combos = [
    ["#0A0A0A", "#ffffff", "light"],
    ["#9B6BFF", "#ffffff", "light"],
    ["#2F7BFF", "#E5F7F2", "light"],
    ["#FFB020", "#F6F1E7", "light"],
    ["#14C4A8", "#E7F2FF", "light"],
    ["#FF6A1F", "#EDE7FF", "light"],
    ["#0A0A0A", "#111114", "dark"],
    ["#9B6BFF", "#0E1A33", "dark"],
    ["#EA4798", "#111114", "dark"],
    ["#FFB020", "#0E1A33", "dark"],
    ["#2F7BFF", "#111114", "dark"],
    ["#959595", "#0E1A33", "dark"],
  ];
  const shots = [];
  for (const [bot, bg, theme] of combos) {
    const fill = chooseFill(bot, bg);
    await page.evaluate(({ bot, bg, theme }) => {
      localStorage.setItem("grok-bot-timer", JSON.stringify({
        botColor: bot, bgValue: bg, theme, seconds: 600, mode: "timer", sound: false,
      }));
      localStorage.removeItem("grok-bot-timer-run");
    }, { bot, bg, theme });
    await page.goto(`${BASE}/?t=10m`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hero .liquid");
    await page.click("#start");
    await page.waitForFunction(() => document.body.dataset.state === "running");
    await page.evaluate(() => {
      const liquid = document.querySelector("#hero .liquid");
      const orig = liquid.setAttribute.bind(liquid);
      liquid.setAttribute = (name, value) => orig(name, name === "y" ? "55" : value);
      orig("y", "55");
    });
    await page.waitForTimeout(80);
    const png = await page.locator(".hero-wrap").screenshot();
    const got = await page.$eval("#hero .liquid", (el) => el.getAttribute("fill"));
    const sample = hexToOklch(got);
    const disc = await page.locator("#hero .eye-back").count();
    if (disc) throw new Error(`eye disc still present for ${bot} on ${bg}`);
    if (sample.C < 0.12) throw new Error(`muddy fill ${got} for ${bot} on ${bg}`);
    if (contrastOnWhite(got) < 2.95) throw new Error(`fill ${got} contrast ${contrastOnWhite(got)} for ${bot}`);
    shots.push({ png: png.toString("base64"), label: `${theme} ${bot} on ${bg}`, fill: got });
  }

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><title>fills</title>
    <style>
      body { margin: 0; background: #f4f4f5; font-family: Inter, sans-serif; }
      .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; padding: 16px; }
      figure { margin: 0; background: white; border-radius: 16px; overflow: hidden; }
      img { width: 100%; display: block; background: #eee; }
      figcaption { font-size: 11px; padding: 6px 8px 8px; color: #222; }
    </style>
    <div class="grid"></div>`);
  await page.evaluate((items) => {
    const grid = document.querySelector(".grid");
    for (const item of items) {
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${item.png}`;
      const cap = document.createElement("figcaption");
      cap.textContent = `${item.label}  ${item.fill}`;
      fig.append(img, cap);
      grid.append(fig);
    }
  }, shots);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "fill-colors.png"), fullPage: true });
} finally {
  await browser.close();
}

if (errors.length) throw new Error(errors.join("\n"));
console.log("ux shots ok");
