import { chromium } from "playwright";
import { chromePath, shotDir } from "./env.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.TIMER_URL || "http://127.0.0.1:43123";
const OUT = shotDir();
fs.mkdirSync(OUT, { recursive: true });

function track(page, errors) {
  page.on("pageerror", (err) => {
    if (/audio device/i.test(err.message)) return;
    errors.push(err.message);
  });
}

async function prep(page) {
  await page.addInitScript(() => {
    window.Notification = class {
      static permission = "denied";
      static requestPermission() {
        return Promise.resolve("denied");
      }
    };
  });
  await page.goto(`${BASE}/?t=2`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.goto(`${BASE}/?t=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hero svg");
  await page.click("#start");
  await page.waitForFunction(() => document.body.dataset.state === "done", { timeout: 8000 });
  await page.waitForTimeout(200);
}

async function sample(page, ms) {
  return page.evaluate(async (duration) => {
    const hero = document.querySelector("#hero");
    const title = document.querySelector("#end-title");
    const actions = document.querySelector(".end-actions");
    const start = performance.now();
    let minTop = Infinity;
    let restTop = null;
    let maxLift = 0;
    let maxSide = 0;
    let bad = "";
    let flatMs = 0;
    let flatRun = 0;
    let lastTop = null;
    let contacts = 0;
    let wasAir = false;
    const shots = [];
    await new Promise((resolve) => {
      const frame = () => {
        const transform = hero.style.transform || "";
        if (/scale|skew/.test(transform)) bad = transform;
        const box = hero.getBoundingClientRect();
        const circle = hero.querySelector("circle");
        const r = circle?.getBoundingClientRect();
        if (r && Math.abs(r.width - r.height) > 1.5) bad = `circle ${r.width}x${r.height}`;
        if (box.top < -1 || box.left < -1 || box.bottom > innerHeight + 1 || box.right > innerWidth + 1) {
          bad = `offscreen ${Math.round(box.top)} ${Math.round(box.left)} ${Math.round(box.bottom)} ${Math.round(box.right)}`;
        }
        const titleBox = title.getBoundingClientRect();
        const actionBox = actions.getBoundingClientRect();
        if (box.bottom > titleBox.top + 1 || box.bottom > actionBox.top + 1) {
          bad = `overlap title ${Math.round(box.bottom)} ${Math.round(titleBox.top)}`;
        }
        if (restTop == null || box.top > restTop) restTop = box.top;
        const lift = restTop - box.top;
        if (lift > maxLift) maxLift = lift;
        const motion = /translate\(([-\d.]+)px,\s*([-\d.]+)px/.exec(transform);
        const py = motion ? Number(motion[2]) : 0;
        const now = performance.now();
        if (lastTop != null) {
          const step = now - (frame.prev || now);
          if (Math.abs(py) < 0.8 && Math.abs(py - lastTop) < 0.35) {
            flatRun += step;
            flatMs = Math.max(flatMs, flatRun);
          } else flatRun = 0;
          if (py < -8) wasAir = true;
          if (wasAir && py >= -0.6) {
            contacts += 1;
            wasAir = false;
          }
        }
        frame.prev = now;
        lastTop = py;
        maxSide = Math.max(maxSide, Math.abs(box.left + box.width / 2 - innerWidth / 2));
        if (box.top < minTop) minTop = box.top;
        if (lift > 36 && shots.length < 6) shots.push(lift);
        if (performance.now() - start < duration) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    return {
      bad,
      maxLift: Math.round(maxLift),
      maxSide: Math.round(maxSide),
      minTop: Math.round(minTop),
      flat: Math.round(flatMs),
      contacts,
    };
  }, ms);
}

async function grabJump(page, file) {
  await page.waitForFunction(() => {
    const box = document.querySelector("#hero").getBoundingClientRect();
    const title = document.querySelector("#end-title").getBoundingClientRect();
    return title.top - box.bottom > 70 && box.top > 8;
  }, { timeout: 4000 });
  await page.screenshot({ path: file });
}

const errors = [];
const browser = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  track(desk, errors);
  await prep(desk);
  const deskSample = await sample(desk, 15000);
  if (deskSample.bad) throw new Error(`desktop ${deskSample.bad}`);
  if (deskSample.maxLift < 48) throw new Error(`desktop hop too small ${deskSample.maxLift}`);
  if (deskSample.flat > 150) throw new Error(`desktop stalled ${deskSample.flat}ms`);
  if (deskSample.contacts < 10) throw new Error(`desktop too few bounces ${deskSample.contacts}`);
  await grabJump(desk, path.join(OUT, "timesup-jump-1.png"));
  await desk.waitForTimeout(280);
  await grabJump(desk, path.join(OUT, "timesup-jump-2.png"));
  console.log("desktop", deskSample);

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  track(phone, errors);
  await prep(phone);
  const phoneSample = await sample(phone, 2200);
  if (phoneSample.bad) throw new Error(`phone ${phoneSample.bad}`);
  if (phoneSample.maxLift < 40) throw new Error(`phone hop too small ${phoneSample.maxLift}`);
  console.log("phone", phoneSample);
} finally {
  await browser.close();
}

if (errors.length) throw new Error(errors.join("\n"));
console.log("jump ok");
