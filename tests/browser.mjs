import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.TIMER_URL || "http://127.0.0.1:43123";
const OUT = process.env.SHOT_DIR || "/opt/cursor/artifacts";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];

function track(page) {
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
}

async function clock(page) {
  return page.$eval("#clock", (el) => el.textContent.trim());
}

async function stats(page) {
  return page.$eval("#world", (el) => ({
    bots: Number(el.dataset.bots),
    landed: Number(el.dataset.landed),
    air: Number(el.dataset.air),
    state: document.body.dataset.state,
    remaining: Number(document.querySelector("#clock").dataset.remaining),
  }));
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/opt/google/chrome/chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});

try {
  const page = await browser.newPage();
  track(page);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());

  await page.goto(`${BASE}/?t=10m`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("#clock")?.textContent.includes("10:00"));
  if ((await clock(page)) !== "10:00") throw new Error(`expected 10:00, got ${await clock(page)}`);

  await page.screenshot({ path: path.join(OUT, "set-time-desktop.png") });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.screenshot({ path: path.join(OUT, "set-time-mobile.png") });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const before = await stats(page);
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "running");
  await page.$eval("#plus1", (el) => el.click());
  await page.waitForFunction(() => Number(document.querySelector("#clock").dataset.remaining) > 650);
  const after = await stats(page);
  if (!(after.remaining > 650 && after.remaining < 670)) {
    throw new Error(`+1 min remaining out of range: ${after.remaining}`);
  }
  if (after.bots < before.bots) throw new Error(`bot count dropped ${before.bots} -> ${after.bots}`);
  if (after.bots <= before.bots) throw new Error(`+1 min did not add bots (${before.bots} -> ${after.bots})`);
  await page.screenshot({ path: path.join(OUT, "running-10m.png") });

  await page.goto(`${BASE}/?t=10s`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("#clock")?.textContent.trim() === "00:10");
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "running");
  await new Promise((r) => setTimeout(r, 6000));
  await page.screenshot({ path: path.join(OUT, "running-pile.png") });
  await page.waitForFunction(() => document.body.dataset.state === "done", { timeout: 12000 });
  await new Promise((r) => setTimeout(r, 700));
  const done = await stats(page);
  const doneClock = await clock(page);
  const title = await page.$eval("#end-title", (el) => el.textContent.trim());
  const endOpacity = await page.$eval("#end-screen", (el) => getComputedStyle(el).opacity);
  const confetti = await page.$eval("#confetti", (el) => el.querySelectorAll("svg").length);
  if (doneClock !== "00:00") throw new Error(`end clock ${doneClock}`);
  if (done.landed !== done.bots) throw new Error(`not all bots landed ${done.landed}/${done.bots}`);
  if (title !== "Time's Up") throw new Error(`title ${title}`);
  if (Number(endOpacity) < 0.9) throw new Error(`end opacity ${endOpacity}`);
  if (confetti < 10) throw new Error(`confetti ${confetti}`);
  await page.screenshot({ path: path.join(OUT, "done.png") });

  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/?t=600`, { waitUntil: "networkidle0" });
  if ((await clock(page)) !== "10:00") throw new Error(`?t=600 showed ${await clock(page)}`);
  await page.goto(`${BASE}/?t=1h30m`, { waitUntil: "networkidle0" });
  if ((await clock(page)) !== "1:30:00") throw new Error(`?t=1h30m showed ${await clock(page)}`);

  await page.goto(`${BASE}/?t=10m`, { waitUntil: "networkidle0" });
  await page.$eval("#typed", (el) => {
    el.value = "1:30:00";
  });
  await page.click("#set-btn");
  await page.waitForFunction(() => document.querySelector("#clock")?.textContent.trim() === "1:30:00");
  await page.$eval("#typed", (el) => {
    el.value = "10";
  });
  await page.click("#set-btn");
  await page.waitForFunction(() => document.querySelector("#clock")?.textContent.trim() === "10:00");

  const realErrors = errors.filter(
    (e) => !/favicon|Download the React DevTools|AudioContext/i.test(e),
  );
  if (realErrors.length) {
    console.error(realErrors.join("\n"));
    throw new Error(`${realErrors.length} console errors`);
  }
  console.log("browser ok", { before, after, done, confetti, title });
} finally {
  await browser.close();
}
