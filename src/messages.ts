// Rendering of Persian message templates + inline keyboards.

import type { InlineButton, InlineKeyboard } from './types.ts';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Vars = Record<string, string | number>;

/** The class texts talk about «کلاس»; for a work event the same text says «کار» instead (the template is changed, never the event's own name). */
function workWording(tpl: string): string {
  return tpl
    .replace(/رفتی کلاس/g, 'رفتی سر کار')
    .replace(/وقت کلاسه/g, 'وقت کاره')
    .replace(/کلاسه/g, 'کاره')
    .replace(/کلاس/g, 'کار');
}

/** Fill {variables} in a template. Variable VALUES are HTML-escaped (the template itself is trusted). */
export function render(texts: Map<string, string>, key: string, vars: Vars = {}): string {
  let tpl = texts.get(key);
  if (tpl === undefined) return `[${key}]`;
  if (vars.is_work === 1) tpl = workWording(tpl);
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? escapeHtml(String(vars[k])) : m));
}

/** Same as render, but without HTML escaping (for button labels, which are plain text). */
export function renderPlain(texts: Map<string, string>, key: string, vars: Vars = {}): string {
  const tpl = texts.get(key);
  if (tpl === undefined) return key;
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export const STATUS_LABEL: Record<string, string> = {
  upcoming: 'در انتظار',
  awaiting_reason: 'منتظر دلیل',
  attended: 'رفتم',
  cancelled: 'برگزار نشد',
  skipped: 'نرفتم',
  no_response: 'بدون پاسخ',
  unmarked: 'ثبت نشده',
};

export const STATUS_EMOJI: Record<string, string> = {
  upcoming: '⏳',
  awaiting_reason: '✍️',
  attended: '✅',
  cancelled: '🚫',
  skipped: '❌',
  no_response: '⚠️',
  unmarked: '▫️',
};

export type KeyboardKind = 'pre' | 'main' | 'noresp' | 'noreason';

/** Inline keyboards. callback_data format: c:<action>:<occurrenceId> (always under 64 bytes). */
export function keyboard(
  texts: Map<string, string>,
  kind: KeyboardKind,
  occId: number,
  snoozeMinutesLabel: string,
): InlineKeyboard {
  const b = (key: string, action: string): InlineButton => ({
    text: renderPlain(texts, key, { minutes: snoozeMinutesLabel }),
    callback_data: `c:${action}:${occId}`,
  });
  switch (kind) {
    case 'pre':
      return [[b('btn_ack', 'ack')], [b('btn_cancelled', 'cancel'), b('btn_skip', 'skip')]];
    case 'main':
      return [[b('btn_went', 'went')], [b('btn_cancelled', 'cancel'), b('btn_skip', 'skip')], [b('btn_snooze', 'snooze')]];
    case 'noresp':
      return [[b('btn_went', 'went')], [b('btn_cancelled', 'cancel'), b('btn_skip', 'skip')]];
    case 'noreason':
      return [[b('btn_noreason', 'noreason')]];
  }
}


const TG_TAG_RE = /^<(\/?)(b|strong|i|em|u|ins|s|strike|del|code|pre|tg-spoiler|blockquote|a(?:\s+href="[^"<>]*")?)>/i;

/** Check that a bot text is valid Telegram HTML. Returns a Persian error message, or null when it is fine. */
export function validateTelegramHtml(text: string): string | null {
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<') {
      const m = TG_TAG_RE.exec(text.slice(i));
      if (!m) return 'توی متن یه علامت «<» هست که تگ درست نیست. اگه خواستی خود علامت رو بنویسی، به‌جاش &lt; بذار.';
      const closing = m[1] === '/';
      const name = m[2].toLowerCase().split(/\s/)[0];
      if (closing) {
        if (stack.pop() !== name) return `تگ «${name}» درست بسته نشده.`;
      } else {
        stack.push(name);
      }
      i += m[0].length - 1;
    } else if (ch === '>') {
      return 'توی متن یه علامت «>» تنها هست. به‌جاش &gt; بذار.';
    } else if (ch === '&') {
      if (!/^&(amp|lt|gt|quot|#\d{1,6});/.test(text.slice(i, i + 10))) return 'توی متن یه علامت «&» تنها هست. به‌جاش &amp; بذار.';
    }
  }
  if (stack.length > 0) return `تگ «${stack[stack.length - 1]}» باز مونده و بسته نشده.`;
  return null;
}

/** Turn Telegram HTML into plain text (used as a safety net when Telegram refuses the HTML). */
export function stripTelegramHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
