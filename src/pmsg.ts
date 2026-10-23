// Messages that the PARTNER writes and sends to the owner (now or at a chosen time), and her private message library.

import type { Env, Settings } from './types.ts';
import type { Telegram } from './telegram.ts';
import { ApiError, bad } from './http.ts';
import { claim, markFailed, markSent } from './db.ts';
import { escapeHtml } from './messages.ts';
import { currentCycle, quietNow } from './overrides.ts';
import { getPartner } from './partner.ts';
import { zonedToEpoch, localDate, addDays } from './time.ts';

const MAX_LEN = 500;
const DAILY_CAP = 40;

export interface OutboxRow {
  id: number;
  text: string;
  send_at: number;
  status: string;
}

export async function listLibrary(db: D1Database): Promise<{ id: number; text: string }[]> {
  return (await db.prepare(`SELECT id, text FROM partner_library ORDER BY id DESC LIMIT 100`).all<{ id: number; text: string }>()).results;
}

export async function addLibrary(db: D1Database, textRaw: unknown, now: number): Promise<void> {
  const text = String(textRaw ?? '').trim();
  if (!text) bad('متن پیام خالیه');
  if (text.length > MAX_LEN) bad(`متن پیام حداکثر ${MAX_LEN} حرف می‌تونه باشه`);
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM partner_library`).first<{ n: number }>();
  if ((n?.n ?? 0) >= 100) bad('حداکثر ۱۰۰ پیام آماده می‌تونی داشته باشی');
  await db.prepare(`INSERT INTO partner_library (text, created_at) VALUES (?1, ?2)`).bind(text, now).run();
}

export async function deleteLibrary(db: D1Database, id: number): Promise<void> {
  const r = await db.prepare(`DELETE FROM partner_library WHERE id = ?1`).bind(id).run();
  if ((r.meta.changes ?? 0) === 0) throw new ApiError(404, 'این پیام پیدا نشد');
}

export async function listOutbox(db: D1Database): Promise<OutboxRow[]> {
  return (await db.prepare(`SELECT id, text, send_at, status FROM partner_outbox WHERE status = 'pending' ORDER BY send_at`).all<OutboxRow>()).results;
}

/** Deliver one message to the owner's Telegram chat. It is delivered silently while he sleeps or in a quiet period. */
async function deliver(env: Env, tg: Telegram, s: Settings, name: string, text: string, now: number): Promise<boolean> {
  const [q, cyc] = await Promise.all([quietNow(env.DB, s.timezone, now), currentCycle(env.DB, s.timezone, now)]);
  const silent = q.quiet || !cyc.awake;
  const r = await tg.sendMessage(Number(env.OWNER_ID), `💌 <b>${escapeHtml(name)}</b>\n\n${escapeHtml(text)}`, undefined, silent);
  return r.ok;
}

/** "HH:MM" -> the next time that clock reads that (today if still ahead, otherwise tomorrow). */
function nextClock(hm: string, tz: string, now: number): number {
  const today = localDate(now, tz);
  let ts = zonedToEpoch(today, hm, tz);
  if (ts <= now + 30) ts = zonedToEpoch(addDays(today, 1), hm, tz);
  return ts;
}

export async function sendOrSchedule(env: Env, tg: Telegram, s: Settings, now: number, b: Record<string, unknown>): Promise<{ scheduled: boolean; send_at: number }> {
  const db = env.DB;
  const p = await getPartner(db);
  if (!p.allow_partner_send) throw new ApiError(403, 'ارسال پیام برات غیرفعال شده.');
  const text = String(b.text ?? '').trim();
  if (!text) bad('متن پیام خالیه');
  if (text.length > MAX_LEN) bad(`متن پیام حداکثر ${MAX_LEN} حرف می‌تونه باشه`);
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM partner_outbox WHERE created_at > ?1 AND status != 'cancelled'`).bind(now - 86400).first<{ n: number }>();
  if ((recent?.n ?? 0) >= DAILY_CAP) bad('امروز خیلی پیام فرستادی؛ بعداً دوباره امتحان کن.');

  let sendAt = now;
  const at = b.send_at;
  if (at !== undefined && at !== null && at !== '') {
    if (typeof at !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) bad('ساعت ارسال درست نیست');
    sendAt = nextClock(at, s.timezone, now);
  }
  const scheduled = sendAt > now + 30;
  const row = await db
    .prepare(`INSERT INTO partner_outbox (text, send_at, status, created_at) VALUES (?1, ?2, 'pending', ?3) RETURNING id`)
    .bind(text, sendAt, now)
    .first<{ id: number }>();
  if (!scheduled && row) {
    // Same claim as the minute job uses, so the message can never be delivered twice.
    const key = `outbox:${row.id}`;
    if (await claim(db, key, now)) {
      const ok = await deliver(env, tg, s, p.name, text, now);
      if (ok) await markSent(db, key, null);
      else await markFailed(db, key);
      await db.prepare(`UPDATE partner_outbox SET status = ?1, sent_at = ?2 WHERE id = ?3`).bind(ok ? 'sent' : 'failed', now, row.id).run();
      if (!ok) throw new ApiError(502, 'پیام نرسید. بعداً دوباره امتحان کن.');
    }
  }
  return { scheduled, send_at: sendAt };
}

export async function cancelOutbox(db: D1Database, id: number): Promise<void> {
  const r = await db.prepare(`UPDATE partner_outbox SET status = 'cancelled' WHERE id = ?1 AND status = 'pending'`).bind(id).run();
  if ((r.meta.changes ?? 0) === 0) throw new ApiError(404, 'این پیام پیدا نشد یا قبلاً رفته.');
}

/** Cron: send the scheduled messages whose time has come. */
export async function processOutbox(env: Env, tg: Telegram, s: Settings, now: number): Promise<void> {
  const db = env.DB;
  const due = (await db.prepare(`SELECT id, text, send_at, status FROM partner_outbox WHERE status = 'pending' AND send_at <= ?1 ORDER BY send_at LIMIT 10`).bind(now).all<OutboxRow>()).results;
  if (!due.length) return;
  const p = await getPartner(db);
  for (const m of due) {
    if (!p.allow_partner_send) {
      await db.prepare(`UPDATE partner_outbox SET status = 'failed' WHERE id = ?1 AND status = 'pending'`).bind(m.id).run();
      continue;
    }
    // claim it first (same mechanism as the class reminders) so two runs never send the same message;
    // a failed delivery is retried on the next minutes, up to 5 attempts.
    const key = `outbox:${m.id}`;
    if (!(await claim(db, key, now))) {
      const st = await db.prepare(`SELECT status, attempts FROM sent_log WHERE key = ?1`).bind(key).first<{ status: string; attempts: number }>();
      if (st && st.status === 'sent') await db.prepare(`UPDATE partner_outbox SET status = 'sent', sent_at = ?1 WHERE id = ?2 AND status = 'pending'`).bind(now, m.id).run();
      else if (st && st.status === 'failed' && st.attempts >= 5) await db.prepare(`UPDATE partner_outbox SET status = 'failed' WHERE id = ?1 AND status = 'pending'`).bind(m.id).run();
      continue;
    }
    const ok = await deliver(env, tg, s, p.name, m.text, now);
    if (ok) {
      await markSent(db, key, null);
      await db.prepare(`UPDATE partner_outbox SET status = 'sent', sent_at = ?1 WHERE id = ?2`).bind(now, m.id).run();
    } else {
      await markFailed(db, key);
    }
  }
}
