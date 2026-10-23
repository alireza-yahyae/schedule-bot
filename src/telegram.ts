// Tiny Telegram Bot API client (only what this project needs).

import type { InlineKeyboard } from './types.ts';
import { stripTelegramHtml } from './messages.ts';

export interface TgOk<T> {
  ok: true;
  result: T;
}
export interface TgErr {
  ok: false;
  code: number;
  description: string;
  retryAfter?: number;
}
export type TgRes<T> = TgOk<T> | TgErr;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Telegram {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<TgRes<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        return { ok: false, code: 0, description: 'network error' };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (json && json.ok) return { ok: true, result: json.result as T };
      const code: number = json?.error_code ?? res.status;
      const retryAfter: number | undefined = json?.parameters?.retry_after;
      // Telegram rate limit (429): wait a few seconds and try once more.
      if (code === 429 && typeof retryAfter === 'number' && retryAfter <= 5 && attempt === 0) {
        await sleep(retryAfter * 1000 + 200);
        continue;
      }
      return { ok: false, code, description: json?.description ?? 'unknown error', retryAfter };
    }
    return { ok: false, code: 0, description: 'retry exhausted' };
  }

  async sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard, silent = false): Promise<TgRes<{ message_id: number }>> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
    if (silent) body.disable_notification = true;
    const res = await this.call<{ message_id: number }>('sendMessage', body);
    // Safety net: if Telegram cannot read the HTML, send the same text once as plain text so the message is never lost.
    if (!res.ok && res.code === 400 && /parse entities|unsupported start tag|unclosed|can't find end/i.test(res.description)) {
      const plain: Record<string, unknown> = { ...body, text: stripTelegramHtml(text) };
      delete plain.parse_mode;
      console.error('HTML refused by Telegram, retrying as plain text:', res.description);
      return this.call<{ message_id: number }>('sendMessage', plain);
    }
    return res;
  }

  /** Send a small text file (used for the weekly backup). */
  async sendDocument(chatId: number, filename: string, content: string, caption?: string): Promise<TgRes<{ message_id: number }>> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('disable_notification', 'true');
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    form.append('document', new Blob([content], { type: 'application/json' }), filename);
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, { method: 'POST', body: form });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await res.json().catch(() => null);
      if (json && json.ok) return { ok: true, result: json.result as { message_id: number } };
      return { ok: false, code: json?.error_code ?? res.status, description: json?.description ?? 'unknown error' };
    } catch {
      return { ok: false, code: 0, description: 'network error' };
    }
  }

  editMessageText(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<TgRes<unknown>> {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  }

  /** Remove the buttons from a message (keeps its text). */
  stripKeyboard(chatId: number, messageId: number): Promise<TgRes<unknown>> {
    return this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  deleteMessage(chatId: number, messageId: number): Promise<TgRes<unknown>> {
    return this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  answerCallbackQuery(id: string, text?: string, alert = false): Promise<TgRes<unknown>> {
    const body: Record<string, unknown> = { callback_query_id: id };
    if (text) {
      body.text = text;
      body.show_alert = alert;
    }
    return this.call('answerCallbackQuery', body);
  }

  setMyCommands(chatId: number, commands: { command: string; description: string }[]): Promise<TgRes<unknown>> {
    return this.call('setMyCommands', { commands, scope: { type: 'chat', chat_id: chatId } });
  }

  /** The button next to the message box that opens the Mini App. */
  setChatMenuButton(chatId: number, text: string, url: string): Promise<TgRes<unknown>> {
    return this.call('setChatMenuButton', {
      chat_id: chatId,
      menu_button: { type: 'web_app', text, web_app: { url } },
    });
  }
}
