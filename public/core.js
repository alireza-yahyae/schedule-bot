// Shared state + API client + helpers used by all screens.

import { hmOf, makeD } from './lib.js';
import { errorToast, haptic, tg, toast } from './ui.js';

/** Hooks filled in by app.js (avoids circular imports). */
export const hooks = { render() {}, go() {}, refresh: async () => {} };

export const S = {
  data: null, // /api/state
  stats: null, // /api/stats (loaded when the stats tab opens)
  texts: null,
  tab: 'today',
  weekSeg: 'grid',
  offline: false,
  skew: 0,
  user: tg && tg.initDataUnsafe ? tg.initDataUnsafe.user || null : null,
};

export let D = makeD('fa');
export function setDigits(mode) {
  D = makeD(mode === 'en' ? 'en' : 'fa');
}

export const nowSec = () => Math.floor(Date.now() / 1000) + S.skew;
export const hm = (ts) => D(hmOf(ts, S.data.tz));
export const courseById = (id) => (S.data ? S.data.courses.find((c) => c.id === id) : null);

// ------------------------------------------------------------------ API
export async function api(method, path, body) {
  const initData = tg && tg.initData ? tg.initData : '';
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { Authorization: 'tma ' + initData, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const e = new Error('اتصال به اینترنت برقرار نیست.');
    e.status = 0;
    throw e;
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const e = new Error(data.error || 'یه مشکلی پیش اومد.');
    e.status = res.status;
    throw e;
  }
  return data;
}

const CACHE_KEY = 'state_v1';
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Load /api/state (falls back to the saved copy when offline). Returns true when there is data to show. */
export async function load() {
  try {
    const data = await api('GET', '/state');
    S.skew = data.now - Math.floor(Date.now() / 1000);
    S.data = data;
    S.offline = false;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      /* storage full or blocked */
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e;
    const cached = readCache();
    if (!cached) throw e;
    S.data = cached;
    S.offline = true;
  }
  setDigits(S.data.settings.digits);
  return true;
}

export async function refresh() {
  await load();
  hooks.render();
}

// ------------------------------------------------------------------ settings
export async function saveSetting(patch, { quiet = false, rerender = false } = {}) {
  const before = { ...S.data.settings };
  Object.assign(S.data.settings, patch);
  try {
    const res = await api('PUT', '/settings', patch);
    S.data.settings = res.settings;
    if ('digits' in patch) setDigits(S.data.settings.digits);
    if (!quiet) toast('ذخیره شد ✓', { ms: 1200 });
    if (rerender || 'digits' in patch) hooks.render();
    return true;
  } catch (e) {
    S.data.settings = before;
    errorToast(e);
    hooks.render();
    return false;
  }
}

// ------------------------------------------------------------------ class actions
const DONE_TEXT = {
  went: 'ثبت شد: رفتی ✅',
  cancel: 'ثبت شد: کلاس برگزار نشد',
  skip: 'ثبت شد: نمی‌ری',
  reopen: 'به حالت قبل برگشت',
  snooze: 'یادآوری عقب افتاد',
};

export async function act(occ, action, reason) {
  haptic(action === 'went' ? 'success' : 'medium');
  try {
    await api('POST', `/occ/${occ.id}`, { action, reason });
    S.stats = null;
    await load();
    hooks.render();
    toast(DONE_TEXT[action] || 'انجام شد', action === 'reopen' ? {} : { undo: () => act(occ, 'reopen') });
    return true;
  } catch (e) {
    errorToast(e);
    return false;
  }
}

/** «🏅 نشان جدید» for the badges that were unlocked by the last action. */
export function toastUnlocked(list) {
  if (!Array.isArray(list) || !list.length) return;
  const text = list.map((b) => `${b.icon} ${b.title}`).join('، ');
  setTimeout(() => toast(`🏅 نشان جدید: ${text}`, { ms: 5500 }), 1800);
}

// ------------------------------------------------------------------ focus timer store (survives closing the app)
const FOCUS_KEY = 'focus_v1';
export function getFocus() {
  try {
    return JSON.parse(localStorage.getItem(FOCUS_KEY));
  } catch {
    return null;
  }
}
export function setFocus(f) {
  try {
    if (f) localStorage.setItem(FOCUS_KEY, JSON.stringify(f));
    else localStorage.removeItem(FOCUS_KEY);
  } catch {
    /* ignore */
  }
}
let finishing = false;
let retryAt = 0;
let failedOnce = false;
export async function focusFinishIfDone() {
  const f = getFocus();
  if (!f || finishing || Date.now() < retryAt || Date.now() - f.start < f.minutes * 60000) return false;
  finishing = true;
  let finished = false;
  try {
    // The saved timer is removed only AFTER the server accepted the session, so a lost connection never loses it.
    const fr = await api('POST', '/focus', {
      minutes: f.minutes,
      course_id: f.courseId || undefined,
      category_id: f.categoryId || undefined,
      started_at: Math.floor(f.start / 1000),
    });
    setFocus(null);
    failedOnce = false;
    finished = true;
    S.stats = null;
    haptic('success');
    toast(`آفرین! ${D(f.minutes)} دقیقه تمرکز ثبت شد 🎯` + (f.breakMinutes ? ` ${D(f.breakMinutes)} دقیقه استراحت کن ☕` : ''), { ms: 5500 });
    await refresh();
    toastUnlocked(fr && fr.unlocked);
    hooks.render();
  } catch (e) {
    if (e && e.status === 400) {
      setFocus(null); // the server will never accept this one: do not retry forever
    } else {
      retryAt = Date.now() + 15000; // try again in 15 seconds
      if (!failedOnce) {
        failedOnce = true;
        toast('تمرکزت تموم شد ولی ثبتش نشد؛ چند ثانیه‌ی دیگه دوباره تلاش می‌کنم.', { ms: 5000 });
      }
    }
  }
  finishing = false;
  return finished;
}

// ------------------------------------------------------------------ misc
export const COURSE_COLORS = ['#4F8CFF', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#14B8A6', '#EC4899', '#64748B'];

/** Press-and-hold helper: calls onHold after `ms`, and suppresses the click that follows. */
export function onLongPress(el, onHold, ms = 520) {
  let timer = null;
  let fired = false;
  let sx = 0;
  let sy = 0;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  el.addEventListener('pointerdown', (e) => {
    fired = false;
    sx = e.clientX;
    sy = e.clientY;
    cancel();
    timer = setTimeout(() => {
      fired = true;
      haptic('medium');
      onHold();
    }, ms);
  });
  el.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, cancel);
  el.addEventListener(
    'click',
    (e) => {
      if (fired) {
        e.stopImmediatePropagation();
        e.preventDefault();
        fired = false;
      }
    },
    true,
  );
}
