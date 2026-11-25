import { chromium } from "playwright";
import { chromePath } from "./env.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.TIMER_URL || "http://127.0.0.1:43123";
const OUT = process.env.SHOT_DIR || "/opt/cursor/artifacts";
fs.mkdirSync(OUT, { recursive: true });

const sizes = [
  [320, 568, "320x568"],
  [375, 667, "375x667"],
  [390, 844, "390x844"],
  [393, 852, "393x852"],
  [430, 932, "430x932"],
  [360, 800, "360x800"],
  [844, 390, "844x390"],
  [768, 1024, "768x1024"],
  [1024, 1366, "1024x1366"],
  [1280, 800, "1280x800"],
  [1440, 900, "1440x900"],
  [1920, 1080, "1920x1080"],
  [2560, 1440, "2560x1440"],
];

const browser = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const shots = [];
const report = [];

for (const [width, height, name] of sizes) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#wheel .wheel-item");
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => {
    const view = { w: innerWidth, h: innerHeight };
    const nodes = [...document.querySelectorAll(".hero-wrap, #wheel, #start, .modes, .modes button")];
    const selected = document.querySelector("#wheel .wheel-item");
    const clipped = [];
    let minTarget = Infinity;
    for (const el of nodes) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.top < -1 || r.left < -1 || r.bottom > view.h + 1 || r.right > view.w + 1) {
        clipped.push({ name: el.id || el.className, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) });
      }
      if (el.matches("button")) minTarget = Math.min(minTarget, r.height);
    }
    if (selected) minTarget = Math.min(minTarget, selected.getBoundingClientRect().height);
    const hero = document.querySelector(".hero-wrap").getBoundingClientRect();
    return {
      hero: Math.round(hero.width),
      minDim: Math.min(view.w, view.h),
      minTarget: Math.round(minTarget),
      clipped,
    };
  });
  const share = info.hero / info.minDim;
  report.push({ name, ...info, share: Number(share.toFixed(2)) });
  if (info.clipped.length) console.error(name, JSON.stringify(info.clipped));
  if (info.minTarget < 44) console.error(name, "target", info.minTarget);
  const png = await page.screenshot();
  shots.push({ name, png: png.toString("base64"), hero: info.hero });
  if (name === "1920x1080") fs.writeFileSync(path.join(OUT, "fullscreen-1920.png"), png);
  if (name === "390x844") fs.writeFileSync(path.join(OUT, "phone-390.png"), png);
}

await page.setViewportSize({ width: 1600, height: 1400 });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #111; color: #fff; font-family: Inter, sans-serif; }
  h1 { font-size: 18px; margin: 12px 16px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 0 12px 16px; }
  figure { margin: 0; background: #1c1c1c; border-radius: 10px; overflow: hidden; }
  img { width: 100%; display: block; background: #fff; }
  figcaption { font-size: 12px; padding: 6px 8px 8px; }
</style><h1>Grok Bot Timer sizes</h1><div class="grid"></div>`);
await page.evaluate((items) => {
  const grid = document.querySelector(".grid");
  for (const item of items) {
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = `data:image/png;base64,${item.png}`;
    const cap = document.createElement("figcaption");
    cap.textContent = `${item.name} · hero ${item.hero}px`;
    fig.append(img, cap);
    grid.append(fig);
  }
}, shots.map(({ name, png, hero }) => ({ name, png, hero })));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "sizes-grid.png"), fullPage: true });
await browser.close();

const bad = report.filter((row) => row.clipped.length || row.minTarget < 44);
console.log(report.map((row) => `${row.name} hero ${row.hero} (${row.share}) target ${row.minTarget}`).join("\n"));
if (bad.length) {
  console.error(JSON.stringify(bad, null, 2));
  process.exit(1);
}
console.log("sizes ok");
