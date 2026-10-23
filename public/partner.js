// Phase 2 screens: partner connection, quick messages, study log and the message-template manager.
// The connected partner sees only the template manager (viewMessages switches on S.data.role).

import { emptyState, errorToast, field, h, haptic, icon, openSheet, confirmSheet, selectEl, stepper, switchEl, textArea, textInput, toast } from './ui.js';
import { D, S, api, hooks } from './core.js';

export const CATEGORY_LABEL = {
  partner_not_studying: 'یادآوری درس خوندن (برای پارتنر)',
  user_slacking: 'گزارش تنبلی من',
  user_studied_hard: 'گزارش خرخونی من',
  custom_scheduled: 'پیام زمان‌بندی‌شده',
};
const CATEGORY_SHORT = { partner_not_studying: 'یادآوری پارتنر', user_slacking: 'تنبلی من', user_studied_hard: 'خرخونی من', custom_scheduled: 'زمان‌بندی‌شده' };
export const CONDITION_LABEL = {
  manual: 'دستی',
  any: 'همه حالت‌ها',
  morning: 'صبح',
  night: 'شب',
  after_2_hours_idle: 'بعد از بیکاری',
  after_4_hours_study: 'بعد از خرخونی',
};

const hdr = (title, sub) => h('div', { class: 'hdr' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null);

// ------------------------------------------------------------------ data
async function reloadMsg() {
  S.msg = await api('GET', '/partner/state');
}

function ensureMsg() {
  if (!S.msg && !S.msgLoading) {
    S.msgLoading = true;
    S.msgError = null;
    reloadMsg()
      .catch((e) => { S.msgError = e.message; })
      .finally(() => { S.msgLoading = false; hooks.render(); });
  }
  return S.msg;
}

function loadingOrError() {
  if (S.msgError) {
    return h('div', { class: 'card' }, emptyState({ emoji: '😕', title: 'بارگذاری نشد', text: S.msgError, action: h('button', { class: 'btn soft', onClick: () => { S.msgError = null; hooks.render(); } }, 'تلاش دوباره') }));
  }
  return h('div', { class: 'skeleton-wrap' }, h('div', { class: 'skeleton', style: { height: '120px' } }), h('div', { class: 'skeleton', style: { height: '72px' } }));
}

async function savePartner(patch, { quiet = true } = {}) {
  try {
    S.msg = await api('PUT', '/partner', patch);
    if (!quiet) toast('ذخیره شد ✓', { ms: 1200 });
    return true;
  } catch (e) {
    errorToast(e);
    try { await reloadMsg(); } catch { /* keep what we have */ }
    hooks.render();
    return false;
  }
}

// ------------------------------------------------------------------ screens
export function viewMessages() {
  const isPartner = S.data.role === 'partner';
  const m = ensureMsg();
  if (!m) return h('div', { class: 'screen' }, hdr('پیام‌ها'), loadingOrError());

  if (isPartner) {
    return h(
      'div',
      { class: 'screen' },
      hdr('متن پیام‌ها', 'پیام‌هایی که برای تو فرستاده می‌شه'),
      h('div', { class: 'banner' }, icon('chat', 18), m.partner.allow_edit ? 'می‌تونی متن پیام‌ها رو ویرایش کنی یا پیام تازه اضافه کنی. {hours} جای تعداد ساعت می‌شینه.' : 'ویرایش پیام‌ها برای تو غیرفعال شده؛ فقط می‌تونی ببینی‌شون.'),
      templatesCard(m, !!m.partner.allow_edit),
      h('div', { class: 'center muted xs mt' }, 'برای خروج از ربات، توی چت /stop رو بفرست.'),
    );
  }

  return h(
    'div',
    { class: 'screen' },
    hdr('پیام‌ها', m.partner.paired ? `متصل به ${m.partner.name}` : 'هنوز پارتنری وصل نیست'),
    connectCard(m),
    quickCard(m),
    autoTextsCard(m),
  );
}

/** The bot's own automatic texts for the partner. Closed by default: the owner does not need to look at them. */
function autoTextsCard(m) {
  const open = !!S.tplOpen;
  return h(
    'div',
    { class: 'list' },
    h('section', { class: 'card compact' }, h('button', { class: 'compact-head', onClick: () => { S.tplOpen = !open; hooks.render(); } }, h('span', null, '🤖 متن پیام‌های خودکارِ ربات برای پارتنر'), h('span', { class: 'muted xs' }, open ? 'بستن' : 'ویرایش'))),
    open ? templatesCard(m, true) : null,
  );
}

// ------------------------------------------------------------------ connection card
function connectCard(m) {
  const p = m.partner;
  const rerender = () => hooks.render();

  if (!p.paired) {
    const link = p.invite_url;
    const share = () => {
      const text = 'برای وصل شدن به ربات برنامه‌ی من، این لینک رو بزن:';
      const url = link ? `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}` : null;
      if (url && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) window.Telegram.WebApp.openTelegramLink(url);
      else copy(link || p.pairing_code);
    };
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-title' }, '🔗 اتصال پارتنر'),
      h('div', { class: 'small muted' }, 'لینک رو برای پارتنرت بفرست و بگو بزنه روش و «Start» رو بزنه. کد فقط یک بار کار می‌کنه.'),
      h('div', { class: 'code-box num', dir: 'ltr' }, p.pairing_code || '—'),
      h(
        'div',
        { class: 'row wrap gap-s mt' },
        link ? h('button', { class: 'btn primary sm', onClick: share }, icon('chat', 16), 'ارسال لینک دعوت') : null,
        h('button', { class: 'btn soft sm', onClick: () => copy(link || p.pairing_code) }, link ? 'کپی لینک' : 'کپی کد'),
        h('button', { class: 'btn soft sm', onClick: async () => { try { S.msg = await api('POST', '/partner/newcode'); rerender(); } catch (e) { errorToast(e); } } }, 'کد جدید'),
      ),
      !link ? h('div', { class: 'xs muted mt' }, `یا پارتنرت توی چت ربات بنویسه: /pair ${p.pairing_code}`) : null,
      settingsRows(m),
    );
  }

  const nameIn = textInput({ value: p.name, maxlength: 40 });
  nameIn.addEventListener('change', async () => { if (await savePartner({ name: nameIn.value }, { quiet: false })) rerender(); });
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-title' }, '🔗 پارتنر'),
    field('اسم یا لقب', nameIn),
    h(
      'div',
      { class: 'row wrap gap-s mt' },
      h('button', { class: 'btn danger-soft sm', onClick: async () => {
        if (!(await confirmSheet({ title: 'قطع اتصال؟', text: `دیگه هیچ پیامی برای ${p.name} فرستاده نمی‌شه و دسترسیش به برنامه بسته می‌شه.`, confirmText: 'قطع کن', danger: true }))) return;
        try { S.msg = await api('POST', '/partner/unpair'); haptic('warning'); toast('اتصال قطع شد'); rerender(); } catch (e) { errorToast(e); }
      } }, 'قطع اتصال'),
    ),
    settingsRows(m),
  );
}

function settingsRows(m) {
  const p = m.partner;
  const row = (label, desc, control) => h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, label), desc ? h('div', { class: 'desc' }, desc) : null), control);
  return h(
    'div',
    { class: 'mt' },
    row('پیام خودکار', 'وقتی بیکاری یا خرخونی طولانی شد، خودش به پارتنر خبر بده', switchEl(!!p.auto_notify_enabled, (on) => savePartner({ auto_notify_enabled: on }))),
    row('حساسیت بیکاری', 'بعد از چند ساعت درس نخوندن خبر بره', stepper(p.idle_threshold_hours, 1, 12, (v) => savePartner({ idle_threshold_hours: v }), D, ' ساعت')),
    row('حد نصاب خرخونی', 'بعد از چند ساعت مطالعه‌ی امروز خبر بره', stepper(p.hard_study_threshold_hours, 1, 16, (v) => savePartner({ hard_study_threshold_hours: v }), D, ' ساعت')),
    row('پارتنر برام پیام بفرسته', 'خودش می‌نویسه و می‌فرسته؛ اینجا نشون داده نمی‌شه، فقط توی تلگرام می‌رسه', switchEl(p.allow_partner_send !== 0, (on) => savePartner({ allow_partner_send: on }))),
    row('نمایش وضعیت درس خوندنم', 'پارتنر ساعت درس خوندن امروز و روشن بودن تایمر رو می‌بینه', switchEl(p.share_study !== 0, (on) => savePartner({ share_study: on }))),
    row('نمایش کلاس‌های امروزم', 'پارتنر فقط لیست کلاس‌های امروز رو (بدون ویرایش) می‌بینه', switchEl(p.share_schedule !== 0, (on) => savePartner({ share_schedule: on }))),
    row('ویرایش متن‌های خودکار توسط پارتنر', 'می‌تونه متن پیام‌های خودکار ربات رو ببینه، اضافه و ویرایش کنه', switchEl(!!p.allow_partner_edit_templates, (on) => savePartner({ allow_partner_edit_templates: on }))),
  );
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('کپی شد ✓', { ms: 1400 });
  } catch {
    toast('کپی نشد؛ متن رو دستی انتخاب کن.', { kind: 'error' });
  }
}

// ------------------------------------------------------------------ quick actions
const hoursText = (h0) => D(String(Math.round(h0 * 10) / 10).replace('.', '٫'));

function quickCard(m) {
  const st = m.study;
  const paired = m.partner.paired;
  const trigger = (category, emoji, text, cls) =>
    h('button', { class: 'btn ' + cls + ' block trigger', disabled: !paired, onClick: () => openSendSheet(category) }, h('span', null, emoji + ' ' + text), icon('chevron', 18));

  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-title' }, '⚡ ارسال سریع به پارتنر'),
    h('div', { class: 'row between small muted' }, h('span', { class: 'num' }, `مطالعه‌ی امروز: ${hoursText(st.today_hours)} ساعت`), h('span', { class: 'num' }, `بیکاری: ${hoursText(st.idle_hours)} ساعت`)),
    h(
      'div',
      { class: 'list mt' },
      trigger('partner_not_studying', '📢', 'یادآوری درس خوندن برای پارتنر', 'warn-soft'),
      trigger('user_slacking', '🚨', 'من درس نخوندم (بیا تلنگر بزن)', 'danger-soft'),
      trigger('user_studied_hard', '🏆', 'کلی درس خوندم (روحیه بده!)', 'ok-soft'),
    ),
    paired ? h('div', { class: 'xs muted mt' }, 'قبل از ارسال، متن رو می‌بینی و می‌تونی عوضش کنی. ثبت درس خوندن از تب «امروز» انجام می‌شه.') : h('div', { class: 'xs muted mt' }, 'برای ارسال، اول پارتنر رو وصل کن.'),
  );
}

function openSendSheet(category) {
  const ta = textArea({ value: '', rows: 5, maxlength: 1000 });
  const info = h('div', { class: 'field-hint' }, 'در حال ساخت پیام…');
  let sheet = null;
  let busy = false;
  const roll = async () => {
    ta.disabled = true;
    try {
      const r = await api('POST', '/partner/preview', { category });
      ta.value = r.text;
      info.textContent = `برای ${r.name} • می‌تونی متن رو ویرایش کنی`;
    } catch (e) {
      errorToast(e);
      info.textContent = e.message;
    }
    ta.disabled = false;
  };
  sheet = openSheet({
    title: CATEGORY_LABEL[category],
    body: h('div', { class: 'form' }, field('متن پیام', ta, null), info, h('button', { class: 'btn soft block', onClick: roll }, icon('undo', 18), 'یه پیام دیگه')),
    primary: {
      text: 'ارسال',
      onClick: async () => {
        const text = ta.value.trim();
        if (!text) { haptic('error'); toast('متن پیام خالیه', { kind: 'error' }); return; }
        if (busy) return;
        busy = true;
        sheet.setBusy(true);
        try {
          await api('POST', '/partner/send', { text });
          await reloadMsg();
          haptic('success');
          toast('پیام فرستاده شد ✓');
          sheet.close();
          hooks.render();
        } catch (e) {
          errorToast(e);
        }
        busy = false;
        sheet.setBusy(false);
      },
    },
  });
  roll();
}

// ------------------------------------------------------------------ templates
const SAMPLE_HOURS = 3;
const preview = (text, name) => text.replace(/\{hours\}/g, D(SAMPLE_HOURS)).replace(/\{partner\}/g, name || 'پارتنر');

export function templatesCard(m, canEdit) {
  const f = (S.tplFilter = S.tplFilter || { cat: 'all', cond: 'all' });
  const list = m.templates.filter((t) => (f.cat === 'all' || t.category === f.cat) && (f.cond === 'all' || t.time_condition === f.cond));
  const catOpts = [{ value: 'all', label: 'همه دسته‌ها' }, ...Object.entries(CATEGORY_SHORT).map(([value, label]) => ({ value, label }))];
  const condOpts = [{ value: 'all', label: 'همه شرط‌ها' }, ...Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label }))];

  const item = (t) =>
    h(
      'div',
      { class: 'tpl' + (t.is_active ? '' : ' off') },
      h('div', { class: 'row wrap gap-s' }, h('span', { class: 'chip info' }, CATEGORY_SHORT[t.category] || t.category), h('span', { class: 'chip' }, CONDITION_LABEL[t.time_condition] || t.time_condition), t.created_by === 'partner' ? h('span', { class: 'chip ok' }, 'از طرف پارتنر') : null),
      h('div', { class: 'tpl-text' }, t.message_text),
      canEdit
        ? h(
            'div',
            { class: 'row between mt' },
            h('div', { class: 'row gap-s' }, switchEl(!!t.is_active, (on) => toggleTemplate(t, on)), h('span', { class: 'xs muted' }, t.is_active ? 'فعال' : 'غیرفعال')),
            h('div', { class: 'row gap-s' }, h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onClick: () => openTemplateForm(t) }, icon('edit', 18)), h('button', { class: 'icon-btn', 'aria-label': 'حذف', onClick: () => removeTemplate(t) }, icon('trash', 18))),
          )
        : null,
    );

  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-title row between' }, h('span', null, `🗂 متن پیام‌ها (${D(list.length)})`), canEdit ? h('button', { class: 'btn primary sm', onClick: () => openTemplateForm(null) }, icon('plus', 16), 'پیام جدید') : null),
    h('div', { class: 'two' }, selectEl(catOpts, f.cat, (v) => { f.cat = v; hooks.render(); }), selectEl(condOpts, f.cond, (v) => { f.cond = v; hooks.render(); })),
    list.length === 0 ? emptyState({ emoji: '💬', title: 'پیامی نیست', text: 'با دکمه‌ی «پیام جدید» یکی اضافه کن.' }) : h('div', { class: 'list mt' }, list.map(item)),
  );
}

async function toggleTemplate(t, on) {
  try {
    await api('PUT', `/templates/${t.id}`, { is_active: on });
    await reloadMsg();
  } catch (e) {
    errorToast(e);
    await reloadMsg().catch(() => {});
  }
  hooks.render();
}

async function removeTemplate(t) {
  if (!(await confirmSheet({ title: 'حذف این پیام؟', text: t.message_text.length > 90 ? t.message_text.slice(0, 90) + '…' : t.message_text, confirmText: 'حذف', danger: true }))) return;
  try {
    await api('DELETE', `/templates/${t.id}`);
    await reloadMsg();
    haptic('warning');
    toast('پیام حذف شد');
  } catch (e) {
    errorToast(e);
  }
  hooks.render();
}

export function openTemplateForm(t) {
  const editing = !!t;
  const cat = selectEl(Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })), t ? t.category : 'user_slacking', () => {});
  const cond = selectEl(Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label })), t ? t.time_condition : 'manual', () => {});
  const ta = textArea({ value: t ? t.message_text : '', rows: 5, maxlength: 500, placeholder: 'متن پیام…' });
  const pv = h('div', { class: 'tpl-text muted small' });
  const draw = () => { pv.textContent = ta.value.trim() ? 'پیش‌نمایش: ' + preview(ta.value, S.msg && S.msg.partner.name) : ''; };
  ta.addEventListener('input', draw);
  draw();
  const sheet = openSheet({
    title: editing ? 'ویرایش پیام' : 'پیام جدید',
    body: h(
      'div',
      { class: 'form' },
      field('دسته‌بندی', cat),
      field('کی فرستاده بشه؟', cond, '«دستی» یعنی فقط وقتی خودت دکمه رو می‌زنی. بقیه‌ی شرط‌ها برای پیام خودکار هستن.'),
      field('متن پیام', ta, '{hours} جای تعداد ساعت و {partner} جای اسم پارتنر می‌شینه.'),
      pv,
    ),
    primary: {
      text: editing ? 'ذخیره' : 'افزودن',
      onClick: async () => {
        const text = ta.value.trim();
        if (!text) { haptic('error'); toast('متن پیام لازمه', { kind: 'error' }); return; }
        const body = { category: cat.value, time_condition: cond.value, message_text: text };
        sheet.setBusy(true);
        try {
          if (editing) await api('PUT', `/templates/${t.id}`, body);
          else await api('POST', '/templates', body);
          await reloadMsg();
          haptic('success');
          toast('ذخیره شد ✓');
          sheet.close();
          hooks.render();
        } catch (e) {
          errorToast(e);
        }
        sheet.setBusy(false);
      },
    },
  });
}
