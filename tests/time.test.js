import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDuration,
  formatClock,
  displaySeconds,
  botCountFor,
  toParam,
  landingTimes,
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

test("share param round-trips", () => {
  assert.equal(parseDuration(toParam(600), { bare: "seconds" }), 600);
  assert.equal(parseDuration(toParam(5400), { bare: "seconds" }), 5400);
  assert.equal(parseDuration(toParam(45), { bare: "seconds" }), 45);
  assert.equal(toParam(600), "10m");
  assert.equal(toParam(5400), "1h30m");
});
