/** OKLCH helpers and a vivid fill that stays distinct from the bot and the page. */

function lin(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function unlin(c) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function parseHex(hex) {
  const raw = String(hex || "").trim().replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToOklch(hex) {
  const rgb = parseHex(hex) || [0, 0, 0];
  const r = lin(rgb[0]);
  const g = lin(rgb[1]);
  const b = lin(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

function oklchToLinear(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const a = Math.cos(rad) * C;
  const b = Math.sin(rad) * C;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklchToHex(L, C, H) {
  let c = Math.max(0, C);
  let rgb = [0, 0, 0];
  for (let i = 0; i < 14; i++) {
    const linRgb = oklchToLinear(L, c, H);
    if (linRgb.every((v) => v >= -0.002 && v <= 1.002)) {
      rgb = linRgb;
      break;
    }
    c *= 0.82;
    rgb = linRgb;
  }
  const hex = rgb.map((v) => unlin(v).toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function contrastOk(fill, other) {
  if (fill.C < 0.145) return false;
  const dL = Math.abs(fill.L - other.L);
  if (other.C < 0.045) return dL >= 0.22;
  if (dL >= 0.2) return true;
  return dL >= 0.16 && hueDist(fill.H, other.H) > 40;
}

/** Brand hues for the eight swatches, plus the dark-theme body. */
const PRESET_HUE = {
  "#0a0a0a": 292,
  "#2e2e33": 292,
  "#9b6bff": 345,
  "#2f7bff": 178,
  "#14c4a8": 262,
  "#ffb020": 275,
  "#ff6a1f": 188,
  "#ea4798": 278,
  "#959595": 292,
};

function hueCandidates(bot, bg) {
  const preset = PRESET_HUE[normalizeHex(bot.hex || "")] ?? null;
  const base = bot.C < 0.045 ? 292 : preset != null ? preset : (bot.H + 38) % 360;
  const list = [base, (bot.H + 168) % 360, (base + 48) % 360, 292, 28, 145];
  return [...new Set(list.map((h) => (h + 360) % 360))].filter((hue) => {
    if (bg.C > 0.06 && hueDist(hue, bg.H) < 16) return false;
    if (bot.C > 0.08 && hueDist(hue, bot.H) < 16) return false;
    return true;
  });
}

function normalizeHex(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return "";
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function inGamutFill(hue, chroma, L) {
  const hex = oklchToHex(L, chroma, hue);
  return { hex, got: hexToOklch(hex) };
}

function searchFill(hue, chroma, bot, bg, preferL) {
  const lights = [preferL, 0.42, 0.64, 0.36, 0.74, 0.5, 0.8, 0.32];
  let best = null;
  for (const L of lights) {
    const { hex, got } = inGamutFill(hue, chroma, L);
    if (got.C < 0.135) continue;
    if (!contrastOk(got, bot) || !contrastOk(got, bg)) continue;
    const score = got.C * 3 + Math.abs(got.L - bot.L) + Math.abs(got.L - bg.L) * 0.4;
    if (!best || score > best.score) best = { hex, score };
  }
  return best?.hex || null;
}

/**
 * Fill color for the hero liquid.
 * No custom color: a vivid analogous or complementary hue for that bot.
 * A custom color is kept unless it is grey or too close to the bot or page.
 */
export function chooseFill(botHex, bgHex, customHex = "") {
  const bot = hexToOklch(botHex);
  bot.hex = botHex;
  const bg = hexToOklch(bgHex || "#ffffff");
  const chroma = bot.C < 0.045 ? 0.19 : Math.min(0.22, Math.max(0.16, bot.C * 0.45 + 0.12));
  const preferL = bot.L > 0.72 ? 0.46 : bot.L < 0.25 ? 0.64 : 0.7;
  const hues = hueCandidates(bot, bg);

  if (customHex && parseHex(customHex)) {
    const custom = hexToOklch(customHex);
    const grey = custom.C < 0.06;
    const weak = !contrastOk(custom, bot) || !contrastOk(custom, bg);
    if (!grey && !weak && custom.C >= 0.13) return normalizeHex(customHex);
    const keepHue = grey ? hues[0] : custom.H;
    const tuned = searchFill(keepHue, Math.max(0.17, grey ? chroma : custom.C), bot, bg, grey ? preferL : custom.L)
      || hues.map((hue) => searchFill(hue, chroma, bot, bg, preferL)).find(Boolean);
    if (tuned) return tuned;
  }

  for (const hue of hues) {
    const found = searchFill(hue, chroma, bot, bg, preferL);
    if (found) return found;
  }
  return searchFill(292, 0.19, bot, bg, bot.L > 0.5 ? 0.4 : 0.66) || "#7C4DFF";
}

/** Dark, saturated disc so white eyes stay readable on a light fill or body. */
export function eyeInk(fillHex) {
  const fill = hexToOklch(fillHex);
  return oklchToHex(0.3, Math.max(0.07, Math.min(0.12, fill.C)), fill.H || 292);
}

export function fillIsLight(fillHex) {
  return hexToOklch(fillHex).L > 0.62;
}
