export const MAX_SECONDS = 12 * 60 * 60;
export const MIN_SECONDS = 1;

export function clampDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(seconds)));
}

/**
 * Parse a duration.
 * bare: "minutes" for the text field ("10" → 10 minutes).
 * bare: "seconds" for ?t= ("600" → 600 seconds).
 * Also accepts 10:00, 1:30:00, 10m, 1h30m, 90s.
 */
export function parseDuration(raw, { bare = "minutes" } = {}) {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
    const [h, m, sec] = s.split(":").map(Number);
    if (m > 59 || sec > 59) return null;
    return clampDuration(h * 3600 + m * 60 + sec);
  }
  if (/^\d{1,3}:\d{2}$/.test(s)) {
    const [m, sec] = s.split(":").map(Number);
    if (sec > 59) return null;
    return clampDuration(m * 60 + sec);
  }

  s = s
    .replace(/\s+/g, "")
    .replace(/hours?/g, "h")
    .replace(/hrs?/g, "h")
    .replace(/minutes?/g, "m")
    .replace(/mins?/g, "m")
    .replace(/seconds?/g, "s")
    .replace(/secs?/g, "s");

  if (/[hms]/.test(s)) {
    if (!/^(\d+(?:\.\d+)?h)?(\d+(?:\.\d+)?m)?(\d+(?:\.\d+)?s)?$/.test(s)) return null;
    let total = 0;
    let matched = false;
    for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(h|m|s)/g)) {
      matched = true;
      const v = Number(n);
      total += u === "h" ? v * 3600 : u === "m" ? v * 60 : v;
    }
    if (!matched) return null;
    return clampDuration(total);
  }

  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    return clampDuration(bare === "seconds" ? n : n * 60);
  }
  return null;
}

export function formatClock(seconds) {
  const s = Math.max(0, seconds | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

/** Countdown digits. An exact integer shows that second; it ticks down after it elapses. */
export function displaySeconds(remaining) {
  if (remaining <= 0) return 0;
  return Math.ceil(remaining - 1e-6);
}

/**
 * One bot every ~3 seconds, so a drop is always in view.
 * The last of these bots is scheduled to land at 0:00.
 * Capped so a long timer stays a mound of smaller stickers.
 */
export function botCountFor(seconds) {
  const n = Math.round(Math.max(1, seconds) / 3);
  return Math.max(2, Math.min(300, n));
}

/** Shareable ?t= value, e.g. 10m, 1h30m, 45s. */
export function toParam(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  let out = "";
  if (h) out += `${h}h`;
  if (m) out += `${m}m`;
  if (sec || !out) out += `${sec}s`;
  return out;
}

/** Next whole second. An exact second is left alone, so the label is never earlier than the finish. */
export function ceilEndMs(ms) {
  return Math.ceil(ms / 1000) * 1000;
}

/** Setup target: this instant plus the wheel duration. */
export function setupEndMs(nowMs, durationSec) {
  return nowMs + Math.round(durationSec) * 1000;
}

/** Milliseconds left until an absolute target. Late ticks do not accumulate error. */
export function remainingMs(nowMs, endAtMs) {
  return Math.max(0, endAtMs - nowMs);
}

/**
 * Local wall time, with seconds, ceiled so it is not earlier than `date`.
 * `locales` defaults to the user's locale.
 */
export function formatEndTime(date, locales) {
  const ms = date instanceof Date ? date.getTime() : Number(date);
  const shown = new Date(ceilEndMs(ms));
  return shown.toLocaleTimeString(locales, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * End-time clock for the timer.
 * Setup recomputes now + duration. Running keeps the absolute target from Start.
 * Pause freezes the remaining time; resume captures a new target.
 */
export function createEndClock({ now = () => Date.now(), durationSec = 0 } = {}) {
  let status = "idle";
  let duration = Math.max(0, Math.round(durationSec));
  let endAt = 0;
  let remain = 0;
  const target = () => {
    if (status === "running") return endAt;
    if (status === "paused") return now() + remain;
    return setupEndMs(now(), duration);
  };
  return {
    get status() {
      return status;
    },
    get endAt() {
      return endAt;
    },
    setDuration(sec) {
      duration = Math.max(0, Math.round(sec));
    },
    start() {
      endAt = setupEndMs(now(), duration);
      status = "running";
      return endAt;
    },
    pause() {
      remain = remainingMs(now(), endAt);
      status = "paused";
      return remain;
    },
    resume() {
      endAt = now() + remain;
      status = "running";
      return endAt;
    },
    remainingSec() {
      if (status === "running") return remainingMs(now(), endAt) / 1000;
      if (status === "paused") return remain / 1000;
      return duration;
    },
    label(locales = "en-US") {
      return formatEndTime(target(), locales);
    },
  };
}

/**
 * Landing timestamps for `count` bots. The last one is exactly `end`.
 * `cursor` is the earliest a still-waiting bot may land.
 */
export function landingTimes(count, cursor, end) {
  if (count <= 0) return [];
  const span = Math.max(0, end - cursor);
  const times = [];
  for (let i = 0; i < count; i++) times.push(cursor + (span * (i + 1)) / count);
  times[count - 1] = end;
  return times;
}
