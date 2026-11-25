import { spawnSync } from "node:child_process";
import fs from "node:fs";

export function shotDir() {
  return process.env.SHOT_DIR || "artifacts";
}

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("sh", ["-c", 'command -v "$1"', "sh", name], { encoding: "utf8" });
    const line = found.stdout?.trim();
    if (found.status === 0 && line && fs.existsSync(line)) return line;
  }
  throw new Error("Set CHROME to a Chrome or Chromium executable.");
}
