import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  parseDuration,
  formatClock,
  displaySeconds,
  botCountFor,
  toParam,
  landingTimes,
  ceilEndMs,
  formatEndTime,
  createEndClock,
} from "../js/time.js";

test("typed durations: bare number is minutes, clocks, and unit strings", () => {
  assert.equal(parseDuration("10", { bare: "minutes" }), 600);
  assert.equal(parseDuration("10:00", { bare: "minutes" }), 600);
  assert.equal(parseDuration("1:30:00", { bare: "minutes" }), 5400);
  assert.equal(parseDuration("1:30", { bare: "minutes" }), 90);
  assert.equal(parseDuration("10m", { bare: "minutes" }), 600);
  assert.equal(parseDuration("1h30m", { bare: "minutes" }), 5400);
  assert.equal(parseDuration("90s", { bare: "minutes" }), 90);
  assert.equal(parseDuration("0", { bare: "minutes" }), null);
  assert.equal(parseDuration("nope", { bare: "minutes" }), null);
});

test("url durations: bare number is seconds", () => {
  assert.equal(parseDuration("600", { bare: "seconds" }), 600);
  assert.equal(parseDuration("10m", { bare: "seconds" }), 600);
  assert.equal(parseDuration("1h30m", { bare: "seconds" }), 5400);
  assert.equal(parseDuration("10", { bare: "seconds" }), 10);
  assert.equal(parseDuration("1:30:00", { bare: "seconds" }), 5400);
});

test("clock format matches the hourglass face", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(32), "00:32");
  assert.equal(formatClock(600), "10:00");
  assert.equal(formatClock(5400), "1:30:00");
  assert.equal(displaySeconds(600), 600);
  assert.equal(displaySeconds(599.2), 600);
  assert.equal(displaySeconds(599), 599);
  assert.equal(displaySeconds(0), 0);
  assert.equal(displaySeconds(0.2), 1);
});

test("bot count drops about one bot every three seconds", () => {
  assert.equal(botCountFor(60), 20);
  assert.equal(botCountFor(600), 200);
  assert.equal(botCountFor(7200), 300);
  assert.ok(botCountFor(10) < botCountFor(60));
  assert.ok(botCountFor(60) >= 15);
});

test("the last landing time is exactly the end", () => {
  for (const n of [1, 6, 11, 44]) {
    const times = landingTimes(n, 0, 10_000);
    assert.equal(times.length, n);
    assert.equal(times[n - 1], 10_000);
    for (let i = 1; i < n; i++) assert.ok(times[i] > times[i - 1]);
  }
  const shifted = landingTimes(4, 2500, 10_000);
  assert.equal(shifted[3], 10_000);
  assert.ok(shifted[0] > 2500);
});

test("end time ceils to the second and never shows an earlier minute", () => {
  assert.equal(ceilEndMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(ceilEndMs(1_700_000_000_400), 1_700_000_001_000);
  assert.ok(ceilEndMs(1_700_000_000_400) >= 1_700_000_000_400);
  const early = new Date(2026, 0, 1, 5, 36, 0, 400);
  assert.equal(formatEndTime(early, "en-US"), "5:36:01 AM");
  assert.equal(formatEndTime(new Date(2026, 0, 1, 5, 36, 0), "en-US"), "5:36:00 AM");
});

test("setup end time follows the wheel and the clock, including midnight", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date(2026, 0, 1, 5, 26, 0) });
  try {
    const clock = createEndClock({ durationSec: 600 });
    assert.equal(clock.label(), "5:36:00 AM");
    mock.timers.tick(1000);
    assert.equal(clock.label(), "5:36:01 AM");
    clock.setDuration(10);
    assert.equal(clock.label(), "5:26:11 AM");
    clock.setDuration(20);
    const midnight = createEndClock({ durationSec: 20, now: () => new Date(2026, 0, 1, 23, 59, 50).getTime() });
    assert.equal(midnight.label(), "12:00:10 AM");
    const nextDay = new Date(ceilEndMs(new Date(2026, 0, 1, 23, 59, 50).getTime() + 20_000));
    assert.equal(nextDay.getDate(), 2);
    assert.equal(nextDay.getHours(), 0);
    assert.equal(nextDay.getMinutes(), 0);
    assert.equal(nextDay.getSeconds(), 10);
  } finally {
    mock.timers.reset();
  }
});

test("running end time is the start target, and a background gap does not drift it", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date(2026, 5, 15, 23, 59, 50) });
  try {
    const clock = createEndClock({ durationSec: 120 });
    const endAt = clock.start();
    const label = clock.label();
    assert.equal(label, "12:01:50 AM");
    mock.timers.tick(30_000);
    assert.equal(clock.endAt, endAt);
    assert.equal(clock.remainingSec(), 90);
    assert.equal(clock.label(), label);
    mock.timers.tick(90_000);
    assert.equal(clock.remainingSec(), 0);
    assert.equal(clock.label(), label);
  } finally {
    mock.timers.reset();
  }
});

test("pause freezes remaining and resume captures a new target", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date(2026, 0, 2, 9, 0, 0) });
  try {
    const clock = createEndClock({ durationSec: 60 });
    clock.start();
    mock.timers.tick(10_000);
    assert.equal(clock.pause(), 50_000);
    mock.timers.tick(25_000);
    assert.equal(clock.remainingSec(), 50);
    assert.equal(clock.label(), "9:01:25 AM");
    const endAt = clock.resume();
    assert.equal(endAt, new Date(2026, 0, 2, 9, 1, 25).getTime());
    mock.timers.tick(10_000);
    assert.equal(clock.endAt, endAt);
    assert.equal(clock.remainingSec(), 40);
    assert.equal(clock.label(), "9:01:25 AM");
  } finally {
    mock.timers.reset();
  }
});

test("share param round-trips", () => {
  assert.equal(parseDuration(toParam(600), { bare: "seconds" }), 600);
  assert.equal(parseDuration(toParam(5400), { bare: "seconds" }), 5400);
  assert.equal(parseDuration(toParam(45), { bare: "seconds" }), 45);
  assert.equal(toParam(600), "10m");
  assert.equal(toParam(5400), "1h30m");
});
