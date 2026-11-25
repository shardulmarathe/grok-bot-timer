import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "../tests/env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const port = 43129;
const url = `http://127.0.0.1:${port}/`;

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("dist/ is missing. Run npm run build first.");
  process.exit(1);
}

const preview = spawn(
  process.execPath,
  [path.join(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

function stopPreview() {
  if (!preview.killed) preview.kill("SIGTERM");
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The preview server did not start.");
}

try {
  await waitForServer();
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.evaluate(() => localStorage.clear());
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForSelector("#wheel .wheel-item");
    await page.waitForFunction(() => Number(document.querySelector("#world")?.dataset.air) > 0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const frame = await page.evaluate(() => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, display: getComputedStyle(el).display };
      };
      return {
        hero: box(".hero-wrap"),
        wheel: box("#wheel"),
        start: box("#start"),
        presets: document.querySelector("[data-preset]") != null,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    });
    const inside = (rect) => rect.top >= -1 && rect.left >= -1 && rect.bottom <= frame.height + 1 && rect.right <= frame.width + 1;
    if (frame.presets) throw new Error("Preset buttons are still on the page.");
    if (frame.wheel.display === "none") throw new Error("The timer wheel is hidden.");
    if (![frame.hero, frame.wheel, frame.start].every(inside)) {
      throw new Error(`The front page is clipped at 1200x630: ${JSON.stringify(frame)}`);
    }
    const png = await page.screenshot({ type: "png" });
    const out = path.join(root, "public/og-image.png");
    fs.writeFileSync(out, png);
    fs.writeFileSync(path.join(dist, "og-image.png"), png);
    console.log(`Wrote ${out} (${png.length} bytes, ${frame.width}x${frame.height})`);
  } finally {
    await browser.close();
  }
} finally {
  stopPreview();
}
