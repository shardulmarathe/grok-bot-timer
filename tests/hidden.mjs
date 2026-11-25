import { chromium, webkit, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { chromePath, shotDir } from "./env.mjs";

const BASE = process.env.TIMER_URL || "http://127.0.0.1:43123";
const OUT = shotDir();
fs.mkdirSync(OUT, { recursive: true });

const errors = [];

function track(page) {
  page.on("pageerror", (err) => {
    if (/audio device/i.test(err.message)) return;
    errors.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
}

async function open(browser, options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  track(page);
  await page.addInitScript(() => {
    window.Notification = class {
      static permission = "default";
      static requestPermission() {
        this.permission = "denied";
        return Promise.resolve("denied");
      }
      constructor() {}
    };
  });
  return { context, page };
}

const chrome = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const { page } = await open(chrome);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/?t=20`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/?t=20`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#clock")?.textContent.includes("00:20"));

  await page.click("#colors");
  await page.waitForSelector("#color-sheet:not([hidden])");
  await page.screenshot({ path: path.join(OUT, "c-picker-desktop.png") });

  await page.locator("#bot-swatches .swatch").nth(1).click();
  await page.locator("#bg-swatches .swatch").nth(3).click();
  await page.click("#color-close");
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "running");
  await page.waitForTimeout(400);
  const runningFill = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    bot: document.querySelector(".hero .body circle")?.getAttribute("fill"),
    liquid: document.querySelector(".hero .liquid")?.getAttribute("fill"),
    eyes: [...document.querySelectorAll(".hero .e")].map((el) => el.getAttribute("fill")),
  }));
  if (runningFill.bot?.toLowerCase() !== "#9b6bff") throw new Error(`bot color ${runningFill.bot}`);
  if (!runningFill.eyes.every((c) => c.toUpperCase() === "#FFFFFF")) throw new Error(`eyes ${runningFill.eyes}`);
  await page.screenshot({ path: path.join(OUT, "c-custom-running.png") });

  const hiddenTitle = await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    return document.title;
  });
  fs.writeFileSync(path.join(OUT, "title-hidden.txt"), `${hiddenTitle}\n`);
  if (!/· Grok Bot Timer$/.test(hiddenTitle) && hiddenTitle !== "⏰ Time's Up") {
    throw new Error(`hidden title: ${hiddenTitle}`);
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.body.dataset.state === "idle");
  await page.click("#theme");
  await page.click("#colors");
  await page.locator("#bg-swatches .swatch").nth(6).click();
  await page.click("#color-close");
  await page.screenshot({ path: path.join(OUT, "c-dark-custom.png") });

  await page.goto(`${BASE}/?t=30`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "running");
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => ({
    remaining: Number(document.querySelector("#clock").dataset.remaining),
    run: JSON.parse(localStorage.getItem("grok-bot-timer-run")),
  }));
  if (!before.run?.endAt) throw new Error("run was not persisted");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.dataset.state === "running");
  const after = await page.evaluate(() => Number(document.querySelector("#clock").dataset.remaining));
  if (!(after > 0 && after < before.remaining)) {
    throw new Error(`reload did not restore a shorter countdown: before ${before.remaining} after ${after}`);
  }

  await page.evaluate(() => localStorage.clear());
} finally {
  await chrome.close();
}

const jump = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const context = await jump.newContext();
  const page = await context.newPage();
  track(page);
  await page.clock.install({ time: new Date("2026-11-20T12:00:00Z") });
  await page.addInitScript(() => {
    window.Notification = class {
      static permission = "denied";
      static requestPermission() {
        return Promise.resolve("denied");
      }
    };
  });
  await page.goto(`${BASE}/?t=8`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/?t=8`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#clock")?.textContent.includes("00:08"));
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "running");
  await page.clock.fastForward(12000);
  await page.waitForFunction(() => document.body.dataset.state === "done", { timeout: 5000 });
  const title = await page.title();
  if (!title.includes("Time's Up") && title !== "Grok Bot Timer") {
    throw new Error(`title after jump: ${title}`);
  }
  const done = await page.evaluate(() => document.body.dataset.state);
  if (done !== "done") throw new Error(`expected done after clock jump, got ${done}`);
} finally {
  await jump.close();
}

const phone = await webkit.launch({ headless: true });
try {
  const { page } = await open(phone, { ...devices["iPhone 14"] });
  await page.goto(`${BASE}/?t=10m`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#colors");
  await page.waitForSelector("#color-sheet:not([hidden])");
  const box = await page.locator(".sheet-card").boundingBox();
  const view = page.viewportSize();
  if (!box || box.y + box.height > view.height + 2 || box.width > view.width + 2) {
    throw new Error(`sheet clipped: ${JSON.stringify(box)} view ${JSON.stringify(view)}`);
  }
  const reset = await page.locator("#color-reset").boundingBox();
  if (!reset || reset.height < 40) throw new Error(`reset target too small: ${JSON.stringify(reset)}`);
  await page.screenshot({ path: path.join(OUT, "c-picker-mobile.png") });
  await page.click("#color-close");
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "running");
  const clipped = await page.evaluate(() => {
    const controls = document.querySelector(".controls");
    const style = getComputedStyle(controls);
    return style.visibility === "hidden" || style.position === "absolute";
  });
  if (!clipped) throw new Error("running controls still in flow on iPhone");
} finally {
  await phone.close();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("hidden + color checks passed");
