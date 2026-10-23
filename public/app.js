// Entry point: boot, tab bar, router and live tickers.

import { clock } from './lib.js';
import { emptyState, errorToast, h, haptic, icon, skeleton, tg, toast } from './ui.js';
import { D, S, focusFinishIfDone, hooks, load, nowSec, refresh } from './core.js';
import { openOnboarding } from './forms.js';
import { openPasteSchedule } from './exports.js';
import { viewSettings, viewStats, viewToday, viewWeek } from './screens.js';
import { viewMessages } from './partner.js';
import { viewGrowth } from './growth.js';
import { pollPartner, viewPChallenge, viewPHome, viewPSend, viewPTexts } from './partnerapp.js';

const root = document.getElementById('app');
const isPartner = () => !!(S.data && S.data.role === 'partner');

const TABS = [
  { id: 'today', label: 'امروز', icon: 'home', view: viewToday },
  { id: 'week', label: 'هفته', icon: 'calendar', view: viewWeek },
  { id: 'messages', label: 'پیام‌ها', icon: 'chat', view: viewMessages },
  { id: 'growth', label: 'پیشرفت', icon: 'flag', view: viewGrowth },
  { id: 'stats', label: 'آمار', icon: 'chart', view: viewStats },
  { id: 'settings', label: 'تنظیمات', icon: 'sliders', view: viewSettings },
];

const PARTNER_TABS = [
  { id: 'p_home', label: 'خانه', icon: 'home', view: viewPHome },
  { id: 'p_send', label: 'پیام', icon: 'chat', view: viewPSend },
  { id: 'p_chal', label: 'چالش', icon: 'flag', view: viewPChallenge },
  { id: 'p_texts', label: 'متن‌ها', icon: 'list', view: viewPTexts },
];
const tabsNow = () => (isPartner() ? PARTNER_TABS : TABS);

let tabbarEl = null;
const scrollMemory = {};

function buildTabbar() {
  return h(
    'nav',
    { class: 'tabbar', 'aria-label': 'منوی اصلی' },
    tabsNow().map((t) =>
      h(
        'button',
        { class: 'tab' + (S.tab === t.id ? ' active' : ''), 'aria-label': t.label, 'aria-current': S.tab === t.id ? 'page' : 'false', onClick: () => go(t.id) },
        icon(t.icon, 24),
        h('span', null, t.label),
      ),
    ),
  );
}

function shell() {
  tabbarEl = buildTabbar();
  root.replaceChildren(h('main', { id: 'view' }), tabbarEl);
}

function render() {
  const view = document.getElementById('view');
  if (!view || !S.data) return;
  const tab = tabsNow().find((t) => t.id === S.tab) || tabsNow()[0];
  try {
    view.replaceChildren(tab.view());
  } catch (e) {
    console.error(e);
    view.replaceChildren(
      h('div', { class: 'screen' }, h('div', { class: 'card' }, emptyState({ emoji: '🛠', title: 'این صفحه خطا داد', text: String(e && e.message ? e.message : e), action: h('button', { class: 'btn soft', onClick: () => location.reload() }, 'بارگذاری دوباره') }))),
    );
  }
  // The round «+» button is fixed to the screen. Inside an animated element it would be positioned
  // relative to that element, so it lives next to the tab bar instead.
  root.querySelectorAll(':scope > .fab').forEach((el) => el.remove());
  const fabEl = view.querySelector('.fab');
  if (fabEl) root.appendChild(fabEl);
  view.classList.toggle('has-fab', !!fabEl);
  const next = buildTabbar();
  tabbarEl.replaceWith(next);
  tabbarEl = next;
  lastSig = signature();
}

function go(tab, weekSeg) {
  if (weekSeg) S.weekSeg = weekSeg;
  if (tab === S.tab && !weekSeg) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  scrollMemory[S.tab] = window.scrollY;
  S.tab = tab;
  haptic('select');
  render();
  window.scrollTo(0, weekSeg ? 0 : scrollMemory[tab] || 0);
}

hooks.render = render;
hooks.go = go;
hooks.refresh = refresh;

function showFatal(message) {
  root.replaceChildren(
    h(
      'div',
      { class: 'screen', style: { paddingTop: '60px' } },
      h('div', { class: 'card' }, emptyState({ emoji: '🔒', title: 'برنامه باز نشد', text: message, action: h('button', { class: 'btn soft', onClick: () => location.reload() }, 'تلاش دوباره') })),
    ),
  );
}

// ------------------------------------------------------------------ live updates
let lastSig = '';
const signature = () => (S.data ? JSON.stringify([S.data.occurrences, S.data.tasks, S.data.courses, S.data.settings, S.data.study, S.data.meals, S.data.challenge, S.data.today_plan, S.data.overrides]) : '');

function sheetOpen() {
  const host = document.getElementById('sheets');
  return !!(host && host.children.length > 0);
}

async function poll() {
  if (document.hidden || sheetOpen() || !S.data) return;
  if (isPartner()) return pollPartner();
  try {
    await load();
    if (signature() !== lastSig) render();
  } catch (e) {
    // After about 24 hours Telegram's sign-in for the app expires: say it, instead of silently showing old data.
    if (e && e.status === 401 && !S.expiredShown) {
      S.expiredShown = true;
      toast('نشست منقضی شده؛ برنامه رو از تلگرام دوباره باز کن.', { ms: 9000 });
    }
  }
}

let boundaryDone = 0;
function tick() {
  if (!S.data) return;
  const now = nowSec();
  document.querySelectorAll('[data-cd]').forEach((el) => {
    el.textContent = clock(Number(el.getAttribute('data-cd')) - now, D);
  });
  // live "since" clocks and the study total while the timer runs
  document.querySelectorAll('[data-up]').forEach((el) => {
    el.textContent = clock(now - Number(el.getAttribute('data-up')), D);
  });
  document.querySelectorAll('[data-live-min="1"]').forEach((el) => {
    const m = Number(el.getAttribute('data-base')) + Math.floor((now - Number(el.getAttribute('data-at'))) / 60);
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    el.textContent = hh === 0 ? `${D(mm)} دقیقه` : mm === 0 ? `${D(hh)} ساعت` : `${D(hh)} ساعت و ${D(mm)} دقیقه`;
  });
  focusFinishIfDone();
  // When a class starts or ends, refresh once so the screen switches to the right state.
  if (S.tab === 'today') {
    const edges = S.data.occurrences.flatMap((o) => [o.start_ts, o.end_ts]).filter((t) => t > boundaryDone && t <= now);
    if (edges.length) {
      boundaryDone = Math.max(...edges);
      poll();
    }
  }
}

// ------------------------------------------------------------------ boot
function setupTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    const applyTheme = () => {
      document.documentElement.setAttribute('data-theme', tg.colorScheme === 'dark' ? 'dark' : tg.colorScheme === 'light' ? 'light' : '');
      if (tg.setHeaderColor) tg.setHeaderColor('secondary_bg_color');
      if (tg.setBackgroundColor) tg.setBackgroundColor('secondary_bg_color');
    };
    applyTheme();
    tg.onEvent('themeChanged', applyTheme);
    tg.onEvent('activated', () => poll());
  } catch {
    /* old Telegram versions */
  }
}

async function main() {
  setupTelegram();
  root.replaceChildren(h('div', { class: 'screen' }, skeleton(3)));
  try {
    await load();
  } catch (e) {
    showFatal(e && e.message ? e.message : 'خطای نامشخص');
    return;
  }
  if (isPartner()) {
    S.tab = 'p_home';
    document.documentElement.setAttribute('data-who', 'partner');
  }
  shell();
  render();
  boundaryDone = nowSec();
  setInterval(tick, 1000);
  setInterval(poll, isPartner() ? 30000 : 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  // First time: build the schedule with an AI (once), then the short questions. Never shown again after that.
  if (!isPartner() && S.data.settings.onboarded !== '1') {
    if (S.data.settings.setup_done !== '1') openPasteSchedule({ firstRun: true, then: openOnboarding });
    else openOnboarding();
  }
}

window.addEventListener('error', (e) => errorToast(new Error('خطای برنامه: ' + (e.message || 'نامشخص'))));
window.addEventListener('unhandledrejection', (e) => errorToast(new Error('خطا: ' + ((e.reason && e.reason.message) || 'نامشخص'))));

main();
