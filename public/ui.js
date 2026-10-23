// Small UI toolkit (no framework): DOM helper, icons, toasts, bottom sheets, form controls.

import { MONTHS, WEEKDAYS, isoToJalali, jalaliMonthLength, jalaliToIso, weekdayOf } from './lib.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'line', 'polyline', 'polygon', 'rect', 'g', 'defs', 'linearGradient', 'stop', 'text']);

export const tg = typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

/** Create an element: h('div', {class: 'x', onClick: fn}, child, child...) */
export function h(tag, props, ...kids) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === undefined || sv === null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
        else el.style[sk] = sv;
      }
    }
    else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(typeof kid === 'object' && kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ------------------------------------------------------------------ icons (24x24 line icons)
const ICONS = {
  home: [['path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }], ['polyline', { points: '9 22 9 12 15 12 15 22' }]],
  calendar: [['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }], ['line', { x1: 16, y1: 2, x2: 16, y2: 6 }], ['line', { x1: 8, y1: 2, x2: 8, y2: 6 }], ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }]],
  chat: [['path', { d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' }]],
  chart: [['line', { x1: 18, y1: 20, x2: 18, y2: 10 }], ['line', { x1: 12, y1: 20, x2: 12, y2: 4 }], ['line', { x1: 6, y1: 20, x2: 6, y2: 14 }]],
  sliders: [['line', { x1: 4, y1: 21, x2: 4, y2: 14 }], ['line', { x1: 4, y1: 10, x2: 4, y2: 3 }], ['line', { x1: 12, y1: 21, x2: 12, y2: 12 }], ['line', { x1: 12, y1: 8, x2: 12, y2: 3 }], ['line', { x1: 20, y1: 21, x2: 20, y2: 16 }], ['line', { x1: 20, y1: 12, x2: 20, y2: 3 }], ['line', { x1: 1, y1: 14, x2: 7, y2: 14 }], ['line', { x1: 9, y1: 8, x2: 15, y2: 8 }], ['line', { x1: 17, y1: 16, x2: 23, y2: 16 }]],
  check: [['polyline', { points: '20 6 9 17 4 12' }]],
  x: [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]],
  ban: [['circle', { cx: 12, cy: 12, r: 10 }], ['line', { x1: 4.93, y1: 4.93, x2: 19.07, y2: 19.07 }]],
  clock: [['circle', { cx: 12, cy: 12, r: 10 }], ['polyline', { points: '12 6 12 12 16 14' }]],
  plus: [['line', { x1: 12, y1: 5, x2: 12, y2: 19 }], ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }]],
  trash: [['polyline', { points: '3 6 5 6 21 6' }], ['path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }], ['path', { d: 'M10 11v6M14 11v6' }], ['path', { d: 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }]],
  edit: [['path', { d: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' }]],
  book: [['path', { d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' }], ['path', { d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' }]],
  flag: [['path', { d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' }], ['line', { x1: 4, y1: 22, x2: 4, y2: 15 }]],
  bell: [['path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }], ['path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }]],
  play: [['polygon', { points: '6 3 20 12 6 21 6 3' }]],
  pause: [['rect', { x: 6, y: 4, width: 4, height: 16 }], ['rect', { x: 14, y: 4, width: 4, height: 16 }]],
  alert: [['path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }], ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }], ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }]],
  pin: [['path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' }], ['circle', { cx: 12, cy: 10, r: 3 }]],
  user: [['path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }], ['circle', { cx: 12, cy: 7, r: 4 }]],
  moon: [['path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }]],
  chevron: [['polyline', { points: '15 18 9 12 15 6' }]],
  list: [['line', { x1: 8, y1: 6, x2: 21, y2: 6 }], ['line', { x1: 8, y1: 12, x2: 21, y2: 12 }], ['line', { x1: 8, y1: 18, x2: 21, y2: 18 }], ['line', { x1: 3, y1: 6, x2: 3.01, y2: 6 }], ['line', { x1: 3, y1: 12, x2: 3.01, y2: 12 }], ['line', { x1: 3, y1: 18, x2: 3.01, y2: 18 }]],
  undo: [['polyline', { points: '1 4 1 10 7 10' }], ['path', { d: 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10' }]],
};

export function icon(name, size = 22, cls = '') {
  const svg = h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon ' + cls, 'aria-hidden': 'true' });
  for (const [tag, attrs] of ICONS[name] || []) svg.append(h(tag, attrs));
  return svg;
}

// ------------------------------------------------------------------ Telegram helpers
export function haptic(kind = 'light') {
  try {
    const hf = tg && tg.HapticFeedback;
    if (!hf) return;
    if (kind === 'success' || kind === 'error' || kind === 'warning') hf.notificationOccurred(kind);
    else if (kind === 'select') hf.selectionChanged();
    else hf.impactOccurred(kind);
  } catch {
    /* ignore */
  }
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function host(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = h('div', { id });
    document.body.append(el);
  }
  return el;
}

// ------------------------------------------------------------------ toast (with optional undo)
export function toast(message, opts = {}) {
  const wrap = host('toasts');
  const el = h('div', { class: 'toast' + (opts.kind ? ' ' + opts.kind : ''), role: 'status' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), reduceMotion() ? 0 : 250);
  };
  el.append(h('span', { class: 'toast-msg' }, message));
  if (opts.undo) {
    el.append(
      h('button', { class: 'toast-undo', onClick: () => { close(); haptic('light'); opts.undo(); } }, 'برگردان'),
    );
  }
  wrap.append(el);
  setTimeout(close, opts.ms ?? (opts.undo ? 6500 : 3200));
  return close;
}

export function errorToast(e) {
  haptic('error');
  toast(e && e.message ? e.message : 'یه مشکلی پیش اومد. دوباره امتحان کن.', { kind: 'error', ms: 4500 });
}

// ------------------------------------------------------------------ bottom sheets
const sheets = [];
let mainHandler = null;
let backBound = false;

function applyTelegramButtons() {
  if (!tg) return;
  const top = sheets[sheets.length - 1];
  try {
    if (tg.MainButton) {
      if (mainHandler) tg.MainButton.offClick(mainHandler);
      mainHandler = null;
      if (top && top.primary && top.useMain) {
        mainHandler = top.primary.onClick;
        tg.MainButton.setParams({
          text: top.primary.text,
          is_visible: true,
          is_active: true,
          color: top.primary.danger ? '#E5484D' : '#4F8CFF',
          text_color: '#FFFFFF',
        });
        tg.MainButton.onClick(mainHandler);
      } else {
        tg.MainButton.hide();
      }
    }
    if (tg.BackButton) {
      if (!backBound) {
        tg.BackButton.onClick(() => {
          const t = sheets[sheets.length - 1];
          if (t) t.close();
        });
        backBound = true;
      }
      if (sheets.length) tg.BackButton.show();
      else tg.BackButton.hide();
    }
  } catch {
    /* old Telegram versions: ignore */
  }
}

/**
 * Open a bottom sheet.
 * options: { title, body (node), primary: {text, onClick, danger}, onClose }
 * Returns { close, setBusy, el }.
 */
export function openSheet({ title, body, primary, onClose, full = false }) {
  const wrap = host('sheets');
  const useMain = !!(tg && tg.MainButton && primary);
  let closed = false;
  let busy = false;

  const footerBtn =
    primary && !useMain
      ? h('button', { class: 'btn ' + (primary.danger ? 'danger' : 'primary') + ' block', onClick: () => !busy && primary.onClick() }, primary.text)
      : null;

  const backdrop = h('div', { class: 'backdrop', onClick: () => entry.close() });
  const sheet = h(
    'div',
    { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-label': title || '' },
    h('div', { class: 'sheet-grab' }),
    h(
      'div',
      { class: 'sheet-head' },
      h('div', { class: 'sheet-title' }, title || ''),
      h('button', { class: 'icon-btn', 'aria-label': 'بستن', onClick: () => entry.close() }, icon('x', 20)),
    ),
    h('div', { class: 'sheet-body' }, body),
    footerBtn ? h('div', { class: 'sheet-footer' }, footerBtn) : null,
  );
  const root = h('div', { class: 'sheet-root' }, backdrop, sheet);

  const entry = {
    primary,
    useMain,
    el: sheet,
    close() {
      if (closed) return;
      closed = true;
      const i = sheets.indexOf(entry);
      if (i >= 0) sheets.splice(i, 1);
      root.classList.remove('open');
      setTimeout(() => root.remove(), reduceMotion() ? 0 : 360);
      applyTelegramButtons();
      if (onClose) onClose();
    },
    setBusy(b) {
      busy = b;
      if (footerBtn) {
        footerBtn.disabled = b;
        footerBtn.classList.toggle('loading', b);
      }
      try {
        if (useMain && tg.MainButton) {
          if (b) tg.MainButton.showProgress(false);
          else tg.MainButton.hideProgress();
        }
      } catch {
        /* ignore */
      }
    },
  };
  sheets.push(entry);
  wrap.append(root);
  applyTelegramButtons();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => root.classList.add('open'));
  else root.classList.add('open');
  return entry;
}

export function closeAllSheets() {
  for (const s of [...sheets]) s.close();
}

/** Ask "are you sure?" -> Promise<boolean>. */
export function confirmSheet({ title, text, confirmText = 'تایید', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
      if (sh) sh.close();
    };
    const sh = openSheet({
      title,
      body: h('p', { class: 'confirm-text' }, text),
      primary: { text: confirmText, danger, onClick: () => finish(true) },
      onClose: () => finish(false),
    });
  });
}

// ------------------------------------------------------------------ form controls
export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function textInput({ value = '', placeholder = '', type = 'text', inputmode, maxlength, dir } = {}) {
  return h('input', { class: 'input', type, value, placeholder, inputmode, maxlength, dir, autocomplete: 'off' });
}

export function textArea({ value = '', placeholder = '', rows = 3, maxlength } = {}) {
  return h('textarea', { class: 'input', rows, placeholder, maxlength, value });
}

export function selectEl(options, value, onChange) {
  const el = h('select', { class: 'input select', onChange: (e) => onChange && onChange(e.target.value) });
  for (const o of options) el.append(h('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label));
  el.value = String(value);
  return el;
}

/** Row of pill buttons; returns { el, get }. */
export function segmented(options, value, onChange) {
  let current = value;
  const el = h('div', { class: 'segmented', role: 'tablist' });
  const draw = () => {
    el.replaceChildren(
      ...options.map((o) =>
        h(
          'button',
          {
            class: 'seg' + (o.value === current ? ' active' : ''),
            role: 'tab',
            'aria-selected': o.value === current ? 'true' : 'false',
            onClick: () => {
              if (current === o.value) return;
              current = o.value;
              haptic('select');
              draw();
              onChange && onChange(current);
            },
          },
          o.label,
        ),
      ),
    );
  };
  draw();
  return { el, get: () => current };
}

export function switchEl(checked, onChange) {
  let on = !!checked;
  const btn = h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false' }, h('span', { class: 'knob' }));
  btn.addEventListener('click', () => {
    on = !on;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    haptic('select');
    onChange && onChange(on);
  });
  return btn;
}

/** − value + */
export function stepper(value, min, max, onChange, D, unit = '', step = 1) {
  let v = value;
  const out = h('span', { class: 'stepper-val' }, D(v) + unit);
  const set = (n) => {
    n = Math.max(min, Math.min(max, n));
    if (n === v) return;
    v = n;
    out.textContent = D(v) + unit;
    haptic('select');
    onChange(v);
  };
  return h(
    'div',
    { class: 'stepper' },
    h('button', { class: 'icon-btn', 'aria-label': 'کمتر', onClick: () => set(v - step) }, '−'),
    out,
    h('button', { class: 'icon-btn', 'aria-label': 'بیشتر', onClick: () => set(v + step) }, '+'),
  );
}

/** Jalali date picker with a live Gregorian preview. Returns { el, getIso }. */
export function jalaliPicker({ iso, todayIso, D }) {
  const base = iso || todayIso;
  let [jy, jm, jd] = isoToJalali(base);
  const [ty] = isoToJalali(todayIso);
  const years = [];
  for (let y = Math.min(ty - 1, jy); y <= Math.max(ty + 2, jy); y++) years.push(y);

  const preview = h('div', { class: 'field-hint' });
  const dayHost = h('div', { class: 'jp-col' });
  const redraw = () => {
    const len = jalaliMonthLength(jy, jm);
    if (jd > len) jd = len;
    const days = Array.from({ length: len }, (_, i) => ({ value: i + 1, label: D(i + 1) }));
    dayHost.replaceChildren(selectEl(days, jd, (v) => { jd = Number(v); update(); }));
    update();
  };
  const update = () => {
    const g = jalaliToIso(jy, jm, jd);
    preview.textContent = `${WEEKDAYS[weekdayOf(g)]} — ${g} (میلادی)`;
  };
  const yearSel = selectEl(years.map((y) => ({ value: y, label: D(y) })), jy, (v) => { jy = Number(v); redraw(); });
  const monthSel = selectEl(MONTHS.map((n, i) => ({ value: i + 1, label: n })), jm, (v) => { jm = Number(v); redraw(); });
  const el = h('div', { class: 'jp' }, h('div', { class: 'jp-row' }, h('div', { class: 'jp-col' }, yearSel), h('div', { class: 'jp-col wide' }, monthSel), dayHost), preview);
  redraw();
  return { el, getIso: () => jalaliToIso(jy, jm, jd) };
}

// ------------------------------------------------------------------ small visuals
/** Circular progress ring (SVG). value 0..1 */
export function ring({ value, size = 96, stroke = 10, color = 'var(--accent)', track = 'var(--track)', label, sub }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  const svg = h(
    'svg',
    { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring-svg' },
    h('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: track, 'stroke-width': stroke }),
    h('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': `${c * v} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring-fg',
    }),
  );
  return h('div', { class: 'ring', style: { width: size + 'px', height: size + 'px' } }, svg, h('div', { class: 'ring-center' }, h('div', { class: 'ring-label' }, label ?? ''), sub ? h('div', { class: 'ring-sub' }, sub) : null));
}

export function emptyState({ emoji, title, text, action }) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-emoji' }, emoji), h('div', { class: 'empty-title' }, title), text ? h('div', { class: 'empty-text' }, text) : null, action || null);
}

export function skeleton(lines = 3) {
  return h('div', { class: 'skeleton-wrap' }, Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton', style: { height: i === 0 ? '120px' : '72px' } })));
}
