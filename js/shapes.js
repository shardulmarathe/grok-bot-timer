const SVG_NS = "http://www.w3.org/2000/svg";

function unit(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function roundedPolygon(cx, cy, radius, sides, corner, rotation) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const v1 = unit(curr.x - prev.x, curr.y - prev.y);
    const v2 = unit(next.x - curr.x, next.y - curr.y);
    const p1x = curr.x - v1.x * corner;
    const p1y = curr.y - v1.y * corner;
    const p2x = curr.x + v2.x * corner;
    const p2y = curr.y + v2.y * corner;
    d += i === 0
      ? `M ${p1x.toFixed(2)} ${p1y.toFixed(2)}`
      : ` L ${p1x.toFixed(2)} ${p1y.toFixed(2)}`;
    d += ` Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${p2x.toFixed(2)} ${p2y.toFixed(2)}`;
  }
  return `${d} Z`;
}

const HEX_D = roundedPolygon(60, 60, 54, 6, 12, -Math.PI / 2);

function circles(list, fill) {
  return list
    .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`)
    .join("");
}

function bodyMarkup(kind, fill) {
  switch (kind) {
    case "cloud":
      return circles(
        [
          [60, 34, 28],
          [30, 58, 26],
          [90, 58, 26],
          [60, 84, 27],
          [60, 58, 24],
        ],
        fill,
      );
    case "flower":
      return circles(
        [
          [60, 24, 20],
          [90, 40, 18],
          [98, 70, 17],
          [74, 96, 18],
          [46, 96, 18],
          [22, 70, 17],
          [30, 40, 18],
          [60, 62, 24],
        ],
        fill,
      );
    case "square":
      return `<rect x="10" y="10" width="100" height="100" rx="34" fill="${fill}"/>`;
    case "hex":
      return `<path d="${HEX_D}" fill="${fill}"/>`;
    case "ghost":
      return `<path d="M82 16 C108 26 118 50 112 76 C106 104 84 118 58 116 C28 114 8 96 12 68 C16 40 34 16 62 12 C70 10 76 12 82 16 Z" fill="${fill}"/>`;
    case "pill":
      return `<rect x="6" y="36" width="108" height="48" rx="24" fill="${fill}"/>`;
    case "leaf":
      return `<path d="M60 6 C84 28 106 50 102 78 C98 106 78 116 60 116 C42 116 22 106 18 78 C14 50 36 28 60 6 Z" fill="${fill}"/>`;
    case "pebble":
      return `<circle cx="60" cy="60" r="56" fill="${fill}"/>`;
    case "hero":
      return `<circle cx="60" cy="60" r="58" fill="${fill}"/>`;
    default:
      return `<circle cx="60" cy="60" r="56" fill="${fill}"/>`;
  }
}

function eyeMarkup(dash) {
  if (dash) {
    return `<rect class="e" x="-14" y="-1.7" width="11" height="3.4" rx="1.7"/>
            <rect class="e" x="3.2" y="-1.7" width="11" height="3.4" rx="1.7"/>`;
  }
  return `<rect class="e" x="-13.4" y="-11" width="8.2" height="22" rx="4.1"/>
          <rect class="e" x="5.2" y="-11" width="8.2" height="22" rx="4.1"/>`;
}

/**
 * Flat Grok Bot sticker. Eyes are a pair of rounded pills, slanted ~15°,
 * with no pupils. `dash` is the sleepy leaf. Gaze and blink are applied
 * by updating the returned groups — the shape itself never changes.
 */
export function createBotElement({ kind, fill, dash = false, eye = "#FFFFFF" }) {
  const html = `<svg xmlns="${SVG_NS}" viewBox="0 0 120 120" aria-hidden="true">
    <g class="body">${bodyMarkup(kind, fill)}</g>
    <g class="eyes">
      <g class="spin">${eyeMarkup(dash)}</g>
    </g>
  </svg>`;
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const svg = wrap.querySelector("svg");
  const eyes = svg.querySelector(".eyes");
  const spin = svg.querySelector(".spin");
  for (const el of svg.querySelectorAll(".e")) el.setAttribute("fill", eye);
  eyes.setAttribute("transform", "translate(60 50)");
  spin.setAttribute("transform", dash ? "rotate(0) scale(1 1)" : "rotate(15) scale(1 1)");
  return { svg, eyes, spin, dash, body: svg.querySelector(".body") };
}

export function setEyes(bot, { gazeX = 0, gazeY = 0, blink = 1, eye, fill }) {
  const ox = 60 + gazeX * 5.5;
  const oy = 50 + gazeY * 4.2;
  bot.eyes.setAttribute("transform", `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`);
  const tilt = bot.dash ? 0 : 15;
  const sy = Math.max(0.08, blink);
  bot.spin.setAttribute("transform", `rotate(${tilt}) scale(1 ${sy.toFixed(3)})`);
  if (eye) {
    for (const el of bot.svg.querySelectorAll(".e")) el.setAttribute("fill", eye);
  }
  if (fill && bot.body) {
    for (const el of bot.body.querySelectorAll("*")) {
      if (el.hasAttribute("fill")) el.setAttribute("fill", fill);
    }
  }
}

export const PALETTE = [
  { kind: "cloud", fill: "#FFB020" },
  { kind: "flower", fill: "#FF6A1F" },
  { kind: "square", fill: "#14C4A8" },
  { kind: "hex", fill: "#9B6BFF" },
  { kind: "square", fill: "#9B6BFF" },
  { kind: "ghost", fill: "#EA4798" },
  { kind: "pill", fill: "#2F7BFF" },
  { kind: "leaf", fill: "#959595", dash: true },
  { kind: "pebble", fill: "#FFB020" },
];

export const DECOR = [
  { kind: "cloud", fill: "#FFB020", x: "90%", y: "-9%", size: 168, rot: 12 },
  { kind: "flower", fill: "#FF6A1F", x: "104%", y: "20%", size: 116, rot: -16 },
  { kind: "square", fill: "#14C4A8", x: "-8%", y: "26%", size: 108, rot: -18 },
  { kind: "hex", fill: "#9B6BFF", x: "80%", y: "-6%", size: 68, rot: 16 },
  { kind: "ghost", fill: "#EA4798", x: "-12%", y: "62%", size: 146, rot: 10 },
  { kind: "pill", fill: "#2F7BFF", x: "98%", y: "50%", size: 96, rot: -18 },
  { kind: "leaf", fill: "#959595", dash: true, x: "70%", y: "4%", size: 46, rot: 18 },
  { kind: "square", fill: "#9B6BFF", x: "-7%", y: "90%", size: 84, rot: 14 },
  { kind: "pebble", fill: "#FFB020", x: "93%", y: "94%", size: 86, rot: -8 },
];
