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

function relY(hex) {
  const rgb = parseHex(hex) || [0, 0, 0];
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a, b) {
  const ya = relY(a);
  const yb = relY(b);
  const hi = Math.max(ya, yb);
  const lo = Math.min(ya, yb);
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastOnWhite(hex) {
  return contrastRatio("#ffffff", hex);
}

/** Black pills on a light body, white pills otherwise. */
export function eyeColorFor(botHex) {
  return hexToOklch(botHex).L > 0.7 ? "#0A0A0A" : "#FFFFFF";
}

function eyesOnFillOk(fill, eye) {
  return contrastRatio(fill, eye) >= (eye === "#0A0A0A" ? 4.5 : 3);
}

function eyesOk(hex) {
  return contrastOnWhite(hex) >= 3;
}

function searchFill(hue, chroma, bot, bg, preferL, eye) {
  const lights = eye === "#0A0A0A"
    ? [preferL, 0.78, 0.84, 0.72, 0.88, 0.68]
    : [preferL, 0.4, 0.34, 0.46, 0.3, 0.5, 0.26, 0.38];
  let best = null;
  for (const L of lights) {
    const { hex, got } = inGamutFill(hue, chroma, L);
    if (got.C < 0.12) continue;
    if (!eyesOnFillOk(hex, eye)) continue;
    if (!contrastOk(got, bot) || !contrastOk(got, bg)) continue;
    const score = got.C * 3 + Math.abs(got.L - bot.L) + Math.abs(got.L - bg.L) * 0.35;
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
  const eye = eyeColorFor(botHex);
  const chroma = bot.C < 0.045 ? 0.16 : Math.min(0.2, Math.max(0.14, bot.C * 0.4 + 0.1));
  const preferL = eye === "#0A0A0A" ? 0.8 : 0.4;
  const hues = hueCandidates(bot, bg);
  const fallback = eye === "#0A0A0A" ? "#C4B5FD" : "#5B2FD6";

  if (customHex && parseHex(customHex)) {
    const custom = hexToOklch(customHex);
    const grey = custom.C < 0.06;
    const weak = !contrastOk(custom, bot) || !contrastOk(custom, bg) || !eyesOnFillOk(customHex, eye);
    if (!grey && !weak && custom.C >= 0.12) return normalizeHex(customHex);
    const keepHue = grey ? hues[0] : custom.H;
    const tuned = searchFill(keepHue, Math.max(0.14, grey ? chroma : custom.C), bot, bg, grey ? preferL : custom.L, eye)
      || hues.map((hue) => searchFill(hue, chroma, bot, bg, preferL, eye)).find(Boolean);
    if (tuned) return tuned;
  }

  for (const hue of hues) {
    const found = searchFill(hue, chroma, bot, bg, preferL, eye);
    if (found) return found;
  }
  return searchFill(292, 0.16, bot, bg, preferL, eye) || fallback;
}

/** Deepen a custom bot color until white eyes clear roughly 3:1, keeping its hue. */
export function readableBody(hex) {
  if (eyesOk(hex)) return normalizeHex(hex);
  const bot = hexToOklch(hex);
  for (let L = Math.min(bot.L, 0.48); L >= 0.16; L -= 0.02) {
    const next = oklchToHex(L, Math.max(bot.C, 0.1), bot.H || 292);
    if (eyesOk(next) && hexToOklch(next).C >= 0.07) return next;
  }
  return oklchToHex(0.32, Math.max(0.1, Math.min(bot.C || 0.12, 0.2)), bot.H || 292);
}
