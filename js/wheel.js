function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function measure(col) {
  const item = col._items?.[0];
  const height = item?.offsetHeight || 0;
  col._row = height > 8 ? height : 44;
  return col._row;
}

function indexFrom(col) {
  const max = (col._items?.length || 1) - 1;
  const row = col._row || 44;
  const top = col._top ?? col.scrollTop;
  return Math.max(0, Math.min(max, Math.round(top / row)));
}

function valueFrom(col) {
  const items = col._items || [];
  return items[indexFrom(col)]?.dataset.value ?? items[0]?.dataset.value;
}

function readAll(root) {
  const values = {};
  for (const col of root.querySelectorAll(".wheel-col")) values[col.dataset.unit] = valueFrom(col);
  return values;
}

function markSelected(col, index) {
  if (col._shown === index) return false;
  col._items[col._shown]?.setAttribute("aria-selected", "false");
  col._items[index]?.setAttribute("aria-selected", "true");
  col._shown = index;
  col.dataset.index = String(index);
  return true;
}

export function mountWheel(root, columns, onChange, onPreview) {
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
    const items = [];
    for (const item of spec.values) {
      const row = document.createElement("div");
      row.className = "wheel-item";
      row.dataset.value = String(item.value);
      row.textContent = item.text;
      row.setAttribute("role", "option");
      col.append(row);
      items.push(row);
    }
    col.append(pad());
    col._items = items;
    col._shown = -1;
    col._top = 0;
    root.append(col);
    if (i < columns.length - 1 && spec.colon !== false) {
      const colon = document.createElement("span");
      colon.className = "wheel-colon";
      colon.textContent = ":";
      root.append(colon);
    }
    bindColumn(root, col);
  });

  const fade = document.createElement("div");
  fade.className = "wheel-fade";
  fade.setAttribute("aria-hidden", "true");
  root.append(fade);

  root._onChange = onChange;
  root._onPreview = onPreview;
  root._writing = 0;
  requestAnimationFrame(() => {
    for (const col of root.querySelectorAll(".wheel-col")) measure(col);
  });
}

function commit(root) {
  if (root._writing > 0) return;
  const cols = [...root.querySelectorAll(".wheel-col")];
  if (!cols.some((col) => col.dataset.user === "1")) return;
  for (const col of cols) col._top = col.scrollTop;
  const values = readAll(root);
  const key = JSON.stringify(values);
  for (const col of cols) delete col.dataset.user;
  if (key === root._last) return;
  root._last = key;
  root._onChange?.(values);
}

function preview(root, col) {
  const changed = markSelected(col, indexFrom(col));
  if (changed && root._writing <= 0 && typeof root._onPreview === "function") root._onPreview(readAll(root));
}

function bindColumn(root, col) {
  let drag = null;
  let buffer = "";
  let bufferTimer = 0;
  let flingId = 0;

  const schedule = () => {
    if (col._raf) return;
    col._raf = requestAnimationFrame(() => {
      col._raf = 0;
      preview(root, col);
    });
  };

  const armSettle = () => {
    clearTimeout(col._timer);
    col._timer = setTimeout(() => commit(root), 140);
  };

  col.addEventListener(
    "scroll",
    () => {
      col._top = col.scrollTop;
      if (root._writing > 0) {
        schedule();
        return;
      }
      col.dataset.user = "1";
      schedule();
      armSettle();
    },
    { passive: true },
  );

  col.addEventListener("scrollend", () => {
    clearTimeout(col._timer);
    col._top = col.scrollTop;
    preview(root, col);
    commit(root);
  });

  col.addEventListener("wheel", () => {
    col.dataset.user = "1";
  }, { passive: true });

  col.addEventListener("pointerdown", (e) => {
    col.dataset.user = "1";
    flingId += 1;
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
    let vel = drag.v * 16;
    drag = null;
    const id = ++flingId;
    const step = () => {
      if (id !== flingId) return;
      if (Math.abs(vel) < 0.45) {
        const row = col._row || 44;
        const index = Math.max(0, Math.min(col._items.length - 1, Math.round(col.scrollTop / row)));
        col.style.scrollSnapType = "";
        col.scrollTop = index * row;
        col._top = col.scrollTop;
        delete col.dataset.dragging;
        preview(root, col);
        commit(root);
        return;
      }
      col.scrollTop -= vel;
      vel *= 0.9;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  col.addEventListener("pointerup", endDrag);
  col.addEventListener("pointercancel", endDrag);

  if (col._items[0] && typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      const prev = col._row || 0;
      const next = measure(col);
      if (Math.abs(next - prev) < 0.5) return;
      if (col.dataset.dragging || col.dataset.user === "1") return;
      const index = Number(col.dataset.index);
      if (Number.isFinite(index) && index >= 0) {
        col.scrollTop = index * next;
        col._top = col.scrollTop;
      }
    });
    observer.observe(col._items[0]);
  }

  col.addEventListener("keydown", (e) => {
    const items = col._items;
    const max = items.length - 1;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const next = indexFrom(col) + (e.key === "ArrowDown" ? 1 : -1);
      scrollToIndex(root, col, Math.max(0, Math.min(max, next)), true, true);
      return;
    }
    if (col.dataset.unit === "p" && /^[ap]$/i.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      scrollToValue(root, col, e.key.toLowerCase() === "a" ? "AM" : "PM", true, true);
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
      scrollToValue(root, col, String(clamped), true, true);
      buffer = "";
    };
    if (!room) apply(typed);
    else bufferTimer = setTimeout(() => apply(Number(buffer)), 650);
  });
}

function scrollToIndex(root, col, index, smooth, notify) {
  root._writing = (root._writing || 0) + 1;
  const row = col._row || measure(col);
  col.dataset.index = String(index);
  col._top = index * row;
  markSelected(col, index);
  col.scrollTo({ top: index * row, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  setTimeout(() => {
    root._writing = Math.max(0, root._writing - 1);
    col._top = col.scrollTop;
    const values = readAll(root);
    root._last = JSON.stringify(values);
    if (notify) root._onChange?.(values);
    else if (typeof root._onPreview === "function") root._onPreview(values);
  }, smooth && !reducedMotion() ? 420 : 40);
}

function scrollToValue(root, col, value, smooth, notify) {
  const index = col._items.findIndex((item) => item.dataset.value === String(value));
  if (index < 0) return;
  scrollToIndex(root, col, index, smooth, notify);
}

export function relayoutWheel(root) {
  if (!root) return;
  for (const col of root.querySelectorAll(".wheel-col")) {
    const row = measure(col);
    const index = Number(col.dataset.index);
    if (Number.isFinite(index) && index >= 0) {
      col.scrollTop = index * row;
      col._top = col.scrollTop;
      markSelected(col, index);
    }
  }
}

export function setWheel(root, values, smooth = false) {
  if (!root) return;
  for (const [unit, value] of Object.entries(values)) {
    const col = root.querySelector(`.wheel-col[data-unit="${unit}"]`);
    if (!col || col.dataset.dragging) continue;
    const index = col._items.findIndex((item) => item.dataset.value === String(value));
    if (index < 0 || Number(col.dataset.index) === index) continue;
    scrollToIndex(root, col, index, smooth, false);
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
