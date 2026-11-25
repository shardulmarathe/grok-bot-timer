const ROW = 44;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function indexOf(col) {
  const max = col.querySelectorAll(".wheel-item").length - 1;
  return Math.max(0, Math.min(max, Math.round(col.scrollTop / ROW)));
}

function valueOf(col) {
  const items = col.querySelectorAll(".wheel-item");
  return items[indexOf(col)]?.dataset.value ?? items[0]?.dataset.value;
}

function paint(col) {
  const mid = col.scrollTop + col.clientHeight / 2;
  for (const item of col.querySelectorAll(".wheel-item")) {
    const dist = Math.abs(item.offsetTop + ROW / 2 - mid) / ROW;
    const t = Math.min(dist, 3);
    item.style.transform = `scale(${(1 - t * 0.075).toFixed(3)})`;
    item.style.opacity = Math.max(0.28, 1 - t * 0.26).toFixed(3);
    item.setAttribute("aria-selected", dist < 0.5 ? "true" : "false");
  }
}

function readAll(root) {
  const values = {};
  for (const col of root.querySelectorAll(".wheel-col")) values[col.dataset.unit] = valueOf(col);
  return values;
}

export function mountWheel(root, columns, onChange) {
  root.replaceChildren();
  const band = document.createElement("div");
  band.className = "wheel-band";
  band.setAttribute("aria-hidden", "true");
  root.append(band);

  columns.forEach((spec, i) => {
    const col = document.createElement("div");
    col.className = "wheel-col";
    col.dataset.unit = spec.unit;
    col.tabIndex = 0;
    col.setAttribute("role", "listbox");
    col.setAttribute("aria-label", spec.label);
    const pad = () => {
      const el = document.createElement("div");
      el.className = "wheel-pad";
      return el;
    };
    col.append(pad());
    for (const item of spec.values) {
      const row = document.createElement("div");
      row.className = "wheel-item";
      row.dataset.value = String(item.value);
      row.textContent = item.text;
      row.setAttribute("role", "option");
      col.append(row);
    }
    col.append(pad());
    root.append(col);
    if (i < columns.length - 1 && spec.colon !== false) {
      const colon = document.createElement("span");
      colon.className = "wheel-colon";
      colon.textContent = ":";
      root.append(colon);
    }
    bindColumn(root, col, onChange);
  });

  root._onChange = onChange;
  root._writing = 0;
}

function commit(root) {
  if (root._writing > 0) return;
  const values = readAll(root);
  const key = JSON.stringify(values);
  if (key === root._last) return;
  root._last = key;
  root._onChange?.(values);
}

function bindColumn(root, col, onChange) {
  let buffer = "";
  let bufferTimer = 0;
  let drag = null;

  const schedule = () => {
    paint(col);
    clearTimeout(col._timer);
    col._timer = setTimeout(() => commit(root), 80);
  };

  col.addEventListener("scroll", schedule, { passive: true });
  col.addEventListener("scrollend", () => commit(root));

  col.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    col.setPointerCapture(e.pointerId);
    col.style.scrollSnapType = "none";
    col.dataset.dragging = "1";
    drag = { y: e.clientY, top: col.scrollTop, lastY: e.clientY, lastT: performance.now(), v: 0 };
  });
  col.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const now = performance.now();
    const dt = now - drag.lastT || 16;
    drag.v = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = now;
    col.scrollTop = drag.top - (e.clientY - drag.y);
  });
  const endDrag = () => {
    if (!drag) return;
    const velocity = drag.v;
    drag = null;
    delete col.dataset.dragging;
    fling(col, velocity, () => {
      col.style.scrollSnapType = "";
      const top = indexOf(col) * ROW;
      col.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
      setTimeout(() => commit(root), reducedMotion() ? 20 : 240);
    });
  };
  col.addEventListener("pointerup", endDrag);
  col.addEventListener("pointercancel", endDrag);

  col.addEventListener("keydown", (e) => {
    const items = [...col.querySelectorAll(".wheel-item")];
    const max = items.length - 1;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const next = indexOf(col) + (e.key === "ArrowDown" ? 1 : -1);
      scrollToIndex(root, col, Math.max(0, Math.min(max, next)), true);
      return;
    }
    if (col.dataset.unit === "p" && /^[ap]$/i.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      scrollToValue(root, col, e.key.toLowerCase() === "a" ? "AM" : "PM", true);
      return;
    }
    if (!/^\d$/.test(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    buffer += e.key;
    clearTimeout(bufferTimer);
    const maxValue = Number(items[max].dataset.value);
    const typed = Number(buffer);
    const room = buffer.length < 2 && typed * 10 <= maxValue;
    const apply = (n) => {
      const clamped = Math.max(Number(items[0].dataset.value), Math.min(maxValue, n));
      scrollToValue(root, col, String(clamped), true);
      buffer = "";
    };
    if (!room) apply(typed);
    else bufferTimer = setTimeout(() => apply(Number(buffer)), 650);
  });

  requestAnimationFrame(() => paint(col));
}

function fling(col, velocity, done) {
  let v = velocity * 16;
  let prev = performance.now();
  const step = (now) => {
    const dt = Math.min(32, now - prev);
    prev = now;
    col.scrollTop -= v * (dt / 16);
    v *= 0.9 ** (dt / 16);
    if (Math.abs(v) > 0.45) requestAnimationFrame(step);
    else done();
  };
  if (Math.abs(v) > 0.6) requestAnimationFrame(step);
  else done();
}

function scrollToIndex(root, col, index, smooth) {
  root._writing = (root._writing || 0) + 1;
  col.dataset.index = String(index);
  col.scrollTo({ top: index * ROW, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  paint(col);
  setTimeout(() => {
    root._writing = Math.max(0, root._writing - 1);
    root._last = JSON.stringify(readAll(root));
  }, smooth && !reducedMotion() ? 680 : 40);
}

function scrollToValue(root, col, value, smooth) {
  const items = [...col.querySelectorAll(".wheel-item")];
  const index = items.findIndex((item) => item.dataset.value === String(value));
  if (index < 0) return;
  scrollToIndex(root, col, index, smooth);
}

export function setWheel(root, values, smooth = false) {
  if (!root) return;
  for (const [unit, value] of Object.entries(values)) {
    const col = root.querySelector(`.wheel-col[data-unit="${unit}"]`);
    if (!col || col.dataset.dragging) continue;
    const items = [...col.querySelectorAll(".wheel-item")];
    const index = items.findIndex((item) => item.dataset.value === String(value));
    if (index < 0 || Number(col.dataset.index) === index) continue;
    scrollToIndex(root, col, index, smooth);
  }
}

export function timerColumns() {
  const nums = (count, start = 0) =>
    Array.from({ length: count }, (_, i) => {
      const value = start + i;
      return { value, text: String(value).padStart(2, "0") };
    });
  return [
    { unit: "h", label: "Hours", values: nums(13) },
    { unit: "m", label: "Minutes", values: nums(60) },
    { unit: "s", label: "Seconds", values: nums(60) },
  ];
}

export function alarmColumns() {
  const hours = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, text: String(i + 1) }));
  const minutes = Array.from({ length: 60 }, (_, i) => ({ value: i, text: String(i).padStart(2, "0") }));
  return [
    { unit: "h", label: "Hour", values: hours },
    { unit: "m", label: "Minute", values: minutes },
    { unit: "p", label: "AM or PM", values: [{ value: "AM", text: "AM" }, { value: "PM", text: "PM" }], colon: false },
  ];
}
