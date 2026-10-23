// Database helpers.

import type { Occ, Settings } from './types.ts';

// ---------------------------------------------------------------- settings
export function parseOffsets(v: string | null | undefined): number[] | null {
  if (v === null || v === undefined || v.trim() === '') return null;
  const list = v
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(list)].sort((a, b) => b - a);
}

export async function loadSettings(db: D1Database): Promise<Settings> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const m = new Map<string, string>();
  for (const r of rows.results) m.set(r.key, r.value);
  const num = (k: string, d: number): number => {
    const raw = m.get(k);
    if (raw === undefined || raw.trim() === '') return d;
    const v = Number(raw);
    return Number.isFinite(v) ? v : d;
  };
  return {
    timezone: m.get('timezone') || 'Asia/Tehran',
    offsets: parseOffsets(m.get('offsets')) ?? [15, 10],
    nagIntervalMin: Math.max(1, num('nag_interval_min', 5)),
    maxNags: Math.max(1, num('max_nags', 6)),
    snoozeMin: Math.max(1, num('snooze_min', 10)),
    vacation: m.get('vacation') === '1',
    pausedUntil: num('paused_until', 0),
    digits: m.get('digits') === 'en' ? 'en' : 'fa',
    ackStartNotice: m.get('ack_start_notice') !== '0',
  };
}

/** Every setting as plain text (except internal ones). */
export async function loadRawSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare(`SELECT key, value FROM settings WHERE key != 'last_tick'`).all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const r of rows.results) out[r.key] = r.value;
  return out;
}

export async function setSetting(db: D1Database, key: string, value: string, nowSec: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3`,
    )
    .bind(key, value, nowSec)
    .run();
}

// ---------------------------------------------------------------- texts
export async function loadTexts(db: D1Database): Promise<Map<string, string>> {
  const rows = await db.prepare('SELECT key, text FROM bot_texts').all<{ key: string; text: string }>();
  const m = new Map<string, string>();
  for (const r of rows.results) m.set(r.key, r.text);
  return m;
}

// ---------------------------------------------------------------- occurrences
export async function getOcc(db: D1Database, id: number): Promise<Occ | null> {
  return await db.prepare('SELECT * FROM occurrences WHERE id = ?1').bind(id).first<Occ>();
}

// ---------------------------------------------------------------- idempotent sending
/**
 * Try to "claim" a message key. Returns true only if THIS caller may send it.
 * A key that was already sent (or is being sent right now) can never be claimed again.
 * A key whose last attempt failed can be retried (max 5 attempts).
 */
export async function claim(db: D1Database, key: string, nowSec: number): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT INTO sent_log (key, status, attempts, created_at) VALUES (?1, 'claimed', 1, ?2)
       ON CONFLICT(key) DO UPDATE SET status = 'claimed', attempts = sent_log.attempts + 1, created_at = ?2
       WHERE (sent_log.status = 'failed' AND sent_log.attempts < 5)
          OR (sent_log.status = 'claimed' AND sent_log.created_at < ?3)`,
    )
    .bind(key, nowSec, nowSec - 120)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function markSent(db: D1Database, key: string, messageId: number | null): Promise<void> {
  await db.prepare(`UPDATE sent_log SET status = 'sent', message_id = ?2 WHERE key = ?1`).bind(key, messageId).run();
}

export async function markFailed(db: D1Database, key: string): Promise<void> {
  await db.prepare(`UPDATE sent_log SET status = 'failed' WHERE key = ?1`).bind(key).run();
}

// ---------------------------------------------------------------- events for Stage 2
export async function emit(
  db: D1Database,
  type: string,
  occurrenceId: number | null,
  data: Record<string, unknown>,
  nowSec: number,
): Promise<void> {
  await db
    .prepare(`INSERT INTO trigger_events (type, occurrence_id, data, created_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(type, occurrenceId, JSON.stringify(data), nowSec)
    .run();
}
