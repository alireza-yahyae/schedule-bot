// The partner's own Mini App: home (how he is doing), write & send messages to him, daily challenge, bot texts.

import { clock } from './lib.js';
import { confirmSheet, emptyState, errorToast, field, h, haptic, icon, segmented, textArea, textInput, toast } from './ui.js';
import { D, S, api, hm, hooks, nowSec } from './core.js';
import { fmtMinutes } from './daily.js';
import { viewMessages as viewBotTexts } from './partner.js';

const hdr = (title, sub) => h('div', { class: 'hdr' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null);
const hoursText = (n) => D(String(n).replace('.', '٫'));

// ------------------------------------------------------------------ data
export async function reloadPH() {
  S.ph = await api('GET', '/partner/home');
}
export function ensurePH() {
  if (!S.ph && !S.phLoading) {
    S.phLoading = true;
    S.phError = null;
    reloadPH()
      .catch((e) => { S.phError = e.message; })
      .finally(() => { S.phLoading = false; hooks.render(); });
  }
  return S.ph;
}
export async function pollPartner() {
  if (document.hidden || !S.ph) return;
  const before = JSON.stringify([S.ph.study, S.ph.classes, S.ph.challenge, S.ph.owner, S.ph.outbox]);
  try {
    await reloadPH();
    if (JSON.stringify([S.ph.study, S.ph.classes, S.ph.challenge, S.ph.owner, S.ph.outbox]) !== before) hooks.render();
  } catch {
    /* keep what we have */
  }
}
function waiting(title) {
  if (S.phError) return h('div', { class: 'screen' }, hdr(title), h('div', { class: 'card' }, emptyState({ emoji: '😕', title: 'بارگذاری نشد', text: S.phError, action: h('button', { class: 'btn soft', onClick: () => { S.phError = null; hooks.render(); } }, 'تلاش دوباره') })));
  return h('div', { class: 'screen' }, hdr(title), h('div', { class: 'skeleton-wrap' }, h('div', { class: 'skeleton', style: { height: '150px' } }), h('div', { class: 'skeleton', style: { height: '90px' } })));
}
const myName = () => (S.user && S.user.first_name) || '';

// ------------------------------------------------------------------ home
export function viewPHome() {
  const p = ensurePH();
  if (!p) return waiting('خانه');
  const now = nowSec();
  const status = p.owner.quiet ? ['warn', '🔕 خاموشی'] : p.owner.awake ? ['ok', '🟢 بیداره'] : ['info', '😴 خوابه'];

  let hero;
  if (!p.study) {
    hero = h('section', { class: 'hero calm' }, h('div', { class: 'eyebrow' }, 'وضعیت فعالیت'), h('div', { class: 'title' }, 'برای تو پنهانه 🙈'), h('div', { class: 'meta' }, 'صاحب برنامه این بخش رو به اشتراک نذاشته.'));
  } else if (p.study.running) {
    hero = h(
      'section',
      { class: 'hero' },
      h('div', { class: 'eyebrow' }, p.study.running_label ? `${p.study.running_label} • الان مشغوله` : '⏱ الان مشغوله 🤫'),
      h('div', { class: 'count num', 'data-up': p.study.running }, clock(now - p.study.running, D)),
      h('div', { class: 'count-label' }, p.study.running_label ? `از ساعت ${hm(p.study.running)} • امروز جمعاً ${fmtMinutes(p.study.today_minutes)}` : `از ساعت ${hm(p.study.running)}`),
    );
  } else {
    const idle = p.study.idle_hours;
    hero = h(
      'section',
      { class: 'hero calm' },
      h('div', { class: 'eyebrow' }, p.study.activities && p.study.activities.length ? `امروز: ${p.study.activities.join(' و ')}` : 'امروز فعالیت'),
      h('div', { class: 'title' }, p.study.today_minutes ? fmtMinutes(p.study.today_minutes) : 'هنوز شروع نکرده'),
      h('div', { class: 'meta' }, p.owner.awake ? (idle >= 1 ? `⏳ ${hoursText(idle)} ساعته فعالیتی ثبت نکرده` : 'الان مشغول نیست') : 'خوابه؛ بذار استراحت کنه 😴'),
      h('div', { class: 'actions', style: { gridTemplateColumns: '1fr 1fr' } }, h('button', { class: 'hbtn main', onClick: () => hooks.go('p_send') }, '💌 پیام بفرست'), h('button', { class: 'hbtn', onClick: () => hooks.go('p_chal') }, '🏆 چالش')),
    );
  }

  const c = p.challenge && p.challenge.today;
  return h(
    'div',
    { class: 'screen' },
    h('div', { class: 'hdr hdr-row' }, h('div', { class: 'grow' }, h('div', { class: 'eyebrow-date' }, 'خانه'), h('h1', null, `سلام ${myName() || p.partner.name} 💗`)), h('span', { class: 'chip ' + status[0] }, status[1])),
    hero,
    c ? challengeSummary(c) : h('button', { class: 'card nudge', onClick: () => hooks.go('p_chal') }, h('span', { class: 'nudge-emoji' }, '🏆'), h('div', { class: 'grow', style: { textAlign: 'start' } }, h('b', null, 'برای امروز چالش بذار'), h('div', { class: 'small muted' }, 'جایزه یا تنبیه تعیین کن تا انگیزه‌ش بیشتر بشه')), icon('chevron', 18)),
    p.classes ? classesCard(p.classes) : null,
    p.outbox.length ? h('div', { class: 'banner quiet' }, icon('clock', 18), h('span', { class: 'grow' }, `${D(p.outbox.length)} پیام زمان‌بندی‌شده منتظر ارسال داری.`), h('button', { class: 'btn sm soft', onClick: () => hooks.go('p_send') }, 'ببین')) : null,
  );
}

function classesCard(list) {
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-title' }, '📅 برنامه‌ی امروزش'),
    list.length === 0
      ? h('div', { class: 'small muted' }, 'کلاسی نداره.')
      : h(
          'div',
          { class: 'list' },
          list.map((o) => {
            const chip = { attended: ['ok', 'رفت'], cancelled: ['warn', 'برگزار نشد'], skipped: ['bad', 'نرفت'] }[o.status];
            return h('div', { class: 'sess-row static' }, h('div', { class: 'grow', style: { textAlign: 'start' } }, h('b', null, o.title), o.location ? h('div', { class: 'xs muted' }, o.location) : null), h('span', { class: 'num small' }, `${hm(o.start_ts)}–${hm(o.end_ts)}`), chip ? h('span', { class: 'chip ' + chip[0] }, chip[1]) : null);
          }),
        ),
  );
}

function challengeSummary(c) {
  const stateChip = { reward_earned: ['ok', '🎉 داره می‌بره!'], at_risk: ['bad', '⚠️ کمتر از حداقل'], running: ['info', 'در جریانه'], upcoming: ['info', 'در جریانه'], settled: ['', 'تموم شد'] }[c.state];
  const max = Math.max((c.target_hours || 0) * 60, (c.min_hours || 0) * 60, 60);
  const pct = Math.min(100, ((c.progress_minutes || 0) / max) * 100);
  return h(
    'section',
    { class: 'card chal-card' },
    h('div', { class: 'row between' }, h('div', { class: 'card-title', style: { margin: 0 } }, '🏆 چالش امروز'), h('span', { class: 'chip ' + stateChip[0] }, stateChip[1])),
    c.reward_text && c.target_hours ? h('div', { class: 'chal-line' }, h('span', null, '🎁'), h('div', null, h('b', null, `${hoursText(c.target_hours)} ساعت یا بیشتر:`), ' ', c.reward_text)) : null,
    c.punishment_text && c.min_hours ? h('div', { class: 'chal-line' }, h('span', null, '😈'), h('div', null, h('b', null, `کمتر از ${hoursText(c.min_hours)} ساعت:`), ' ', c.punishment_text)) : null,
    c.scope_label ? h('div', { class: 'xs muted' }, `حساب می‌شه: ${c.scope_label}`) : null,
    h('div', { class: 'meter chal-meter' }, h('i', { style: { width: pct + '%' } })),
    h('div', { class: 'row between small muted' }, h('span', null, `تا الان ${fmtMinutes(c.progress_minutes || 0)}`), h('button', { class: 'btn ghost sm', onClick: () => hooks.go('p_chal') }, 'ویرایش')),
  );
}

// ------------------------------------------------------------------ write & send a message to him
export function viewPSend() {
  const p = ensurePH();
  if (!p) return waiting('پیام');
  const canSend = !!p.partner.allow_send;
  const ta = textArea({ value: S.draft || '', rows: 5, maxlength: 500, placeholder: 'یه پیام قشنگ یا یه تلنگر برای او بنویس…' });
  const counter = h('div', { class: 'xs muted', style: { textAlign: 'end' } }, `${D((S.draft || '').length)}/${D(500)}`);
  ta.addEventListener('input', () => { S.draft = ta.value; counter.textContent = `${D(ta.value.length)}/${D(500)}`; });
  const timeIn = textInput({ type: 'time', value: S.draftTime || '' });
  timeIn.addEventListener('change', () => { S.draftTime = timeIn.value; });

  const done = () => { S.draft = ''; S.draftTime = ''; };
  const send = async (when) => {
    const text = ta.value.trim();
    if (!text) { haptic('error'); toast('اول یه چیزی بنویس', { kind: 'error' }); return; }
    if (when && !timeIn.value) { haptic('error'); toast('ساعت ارسال رو انتخاب کن', { kind: 'error' }); return; }
    try {
      const r = await api('POST', '/partner/message', when ? { text, send_at: timeIn.value } : { text });
      haptic('success');
      done();
      await reloadPH();
      toast(r.scheduled ? `ساعت ${hm(r.send_at)} فرستاده می‌شه ⏰` : 'فرستاده شد 💌');
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
  };
  const saveLib = async () => {
    const text = ta.value.trim();
    if (!text) return;
    try {
      const r = await api('POST', '/partner/library', { text });
      S.ph.library = r.library;
      haptic('success');
      toast('توی پیام‌های آماده ذخیره شد ✓', { ms: 1400 });
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
  };

  const lib = p.library.length
    ? h('div', { class: 'lib' }, p.library.map((m) => h('div', { class: 'lib-chip' }, h('button', { class: 'lib-text', onClick: () => { S.draft = m.text; hooks.render(); } }, m.text), h('button', { class: 'lib-x', 'aria-label': 'حذف', onClick: () => delLib(m) }, '×'))))
    : h('div', { class: 'small muted' }, 'هنوز پیام آماده‌ای نداری. یه پیام بنویس و «ذخیره» رو بزن.');

  return h(
    'div',
    { class: 'screen' },
    hdr('پیام برای او', 'خودت می‌نویسی، مستقیم توی تلگرامش می‌رسه'),
    !canSend ? h('div', { class: 'banner' }, icon('pause', 18), 'ارسال پیام فعلاً برات غیرفعال شده.') : null,
    h(
      'section',
      { class: 'card' },
      ta,
      counter,
      h('button', { class: 'btn ghost sm', onClick: saveLib }, icon('plus', 16), 'ذخیره در پیام‌های آماده'),
      h('button', { class: 'btn primary block big mt', disabled: !canSend, onClick: () => send(false) }, icon('chat', 18), 'ارسال الان'),
      h('div', { class: 'row gap-s mt' }, h('div', { class: 'grow' }, field('یا یه ساعت مشخص (امروز یا فردا)', timeIn)), h('button', { class: 'btn soft', disabled: !canSend, onClick: () => send(true) }, '⏰ زمان‌بندی')),
      h('div', { class: 'xs muted mt' }, 'اگه خوابه یا خاموشی داره، پیام بدون صدا می‌رسه.'),
    ),
    h('section', { class: 'card' }, h('div', { class: 'card-title' }, '💬 پیام‌های آماده‌ی من'), lib),
    p.outbox.length
      ? h(
          'section',
          { class: 'card' },
          h('div', { class: 'card-title' }, '⏰ منتظر ارسال'),
          h('div', { class: 'list' }, p.outbox.map((m) => h('div', { class: 'sess-row static' }, h('span', { class: 'num small' }, hm(m.send_at)), h('div', { class: 'grow', style: { textAlign: 'start' } }, m.text), h('button', { class: 'icon-btn', 'aria-label': 'لغو', onClick: () => cancel(m) }, icon('trash', 18))))),
        )
      : null,
  );
}

async function delLib(m) {
  try {
    const r = await api('DELETE', `/partner/library/${m.id}`);
    S.ph.library = r.library;
    hooks.render();
  } catch (e) {
    errorToast(e);
  }
}
async function cancel(m) {
  if (!(await confirmSheet({ title: 'این پیام لغو بشه؟', text: m.text.slice(0, 90), confirmText: 'لغو کن', danger: true }))) return;
  try {
    const r = await api('DELETE', `/partner/outbox/${m.id}`);
    S.ph.outbox = r.outbox;
    toast('لغو شد');
    hooks.render();
  } catch (e) {
    errorToast(e);
  }
}

// ------------------------------------------------------------------ daily challenge
const REWARDS = ['🎬 یه فیلم با هم', '🍕 شام بیرون', '🍦 بستنی', '💆 ماساژ', '🛍 یه هدیه‌ی کوچیک'];
const PUNISHMENTS = ['🍽 ظرف شستن', '📵 یه روز بدون گوشی', '🧹 مرتب کردن اتاق', '☕ چای دم کردن برای من'];

export function viewPChallenge() {
  const p = ensurePH();
  if (!p) return waiting('چالش');
  const which = S.chalDay || 'today';
  const cur = p.challenge[which] || null;
  const seg = segmented([{ value: 'today', label: 'امروز' }, { value: 'tomorrow', label: 'فردا' }], which, (v) => { S.chalDay = v; S.chalCat = undefined; hooks.render(); });
  const val = (x) => (x == null ? '' : String(x));
  const tgt = textInput({ value: val(cur && cur.target_hours), inputmode: 'decimal', dir: 'ltr', placeholder: 'مثلاً ۴' });
  const rew = textInput({ value: val(cur && cur.reward_text), maxlength: 200, placeholder: 'مثلاً شام بیرون' });
  const min = textInput({ value: val(cur && cur.min_hours), inputmode: 'decimal', dir: 'ltr', placeholder: 'مثلاً ۲' });
  const pun = textInput({ value: val(cur && cur.punishment_text), maxlength: 200, placeholder: 'مثلاً ظرف شستن' });
  const numv = (el) => { const t = el.value.trim().replace('٫', '.').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); return t === '' ? null : Number(t); };
  const chips = (list, input) => h('div', { class: 'row wrap gap-s' }, list.map((t) => h('button', { class: 'chip-btn', onClick: () => { input.value = t; } }, t)));
  const settled = cur && cur.settled_at;

  // what counts toward the challenge: everything, or one category
  let catSel = S.chalCat !== undefined ? S.chalCat : cur && cur.category_id ? cur.category_id : null;
  const catRow = h('div', { class: 'row wrap gap-s' });
  const drawCats = () =>
    catRow.replaceChildren(
      ...[{ id: null, icon: '⏱', title: 'همه‌ی فعالیت‌ها' }, ...(p.categories || [])].map((c) =>
        h('button', { class: 'chip-btn' + (c.id === catSel ? ' on' : ''), onClick: () => { catSel = c.id; S.chalCat = c.id; drawCats(); } }, `${c.icon} ${c.title}`),
      ),
    );
  drawCats();

  const save = async () => {
    try {
      const r = await api('PUT', '/challenges', { day: which, category_id: catSel === null ? 'all' : catSel, target_hours: numv(tgt), reward_text: rew.value, min_hours: numv(min), punishment_text: pun.value });
      S.ph.challenge = r;
      haptic('success');
      toast('چالش ثبت شد و براش فرستاده شد 🏆');
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
  };
  const remove = async () => {
    if (!(await confirmSheet({ title: 'چالش حذف بشه؟', confirmText: 'حذف', danger: true }))) return;
    try {
      S.ph.challenge = await api('DELETE', `/challenges/${cur.id}`);
      haptic('warning');
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
  };

  const hist = p.challenge.history;
  return h(
    'div',
    { class: 'screen' },
    hdr('چالش روزانه', 'جایزه برای تلاش، تنبیه برای تنبلی 😈'),
    seg.el,
    settled
      ? h('div', { class: 'card' }, emptyState({ emoji: '🏁', title: 'این چالش تموم شده', text: 'نتیجه‌ش پایین توی تاریخچه‌ست.' }))
      : h(
          'section',
          { class: 'card' },
          cur ? challengeSummary(cur) : null,
          p.categories && p.categories.length > 1 ? [h('div', { class: 'section-title' }, h('span', null, '📏 چی حساب بشه؟')), catRow] : null,
          h('div', { class: 'section-title' }, h('span', null, '🎁 جایزه')),
          h('div', { class: 'two' }, field('اگه این‌قدر ساعت بخونه', tgt), field('جایزه‌ش', rew)),
          chips(REWARDS, rew),
          h('div', { class: 'section-title' }, h('span', null, '😈 تنبیه')),
          h('div', { class: 'two' }, field('اگه کمتر از این‌قدر ساعت', min), field('تنبیه‌ش', pun)),
          chips(PUNISHMENTS, pun),
          h('div', { class: 'field-hint' }, 'یکی از جایزه یا تنبیه کافیه. نتیجه موقع خواب او حساب می‌شه و به هر دوتون خبر می‌رسه.'),
          h('button', { class: 'btn primary block big mt', onClick: save }, icon('check', 18), cur ? 'ذخیره‌ی تغییرات' : 'ثبت چالش'),
          cur ? h('button', { class: 'btn danger-soft block', onClick: remove }, icon('trash', 18), 'حذف چالش') : null,
        ),
    hist.length
      ? h(
          'section',
          { class: 'card' },
          h('div', { class: 'card-title' }, '📜 نتیجه‌ی چالش‌های قبل'),
          h('div', { class: 'list' }, hist.map((c) => h('div', { class: 'sess-row static' }, h('span', { class: 'num small' }, D(c.day)), h('div', { class: 'grow', style: { textAlign: 'start' } }, fmtMinutes(c.result_minutes || 0)), c.reward_earned ? h('span', { class: 'chip ok' }, '🎁 جایزه') : c.punishment_due ? h('span', { class: 'chip bad' }, '😈 تنبیه') : h('span', { class: 'chip' }, 'هیچ‌کدوم')))),
        )
      : null,
  );
}

export function viewPTexts() {
  return viewBotTexts();
}
