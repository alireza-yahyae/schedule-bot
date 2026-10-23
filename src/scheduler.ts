// The scheduler runs every minute (Cloudflare Cron Trigger).
// It creates today's/tomorrow's classes, sends the reminders, runs the nag loop,
// and closes classes that nobody answered.

import type { Env, Occ, OccJoined, Settings } from './types.ts';
import type { Telegram } from './telegram.ts';
import type { KeyboardKind } from './messages.ts';
import { claim, emit, loadSettings, loadTexts, markFailed, markSent, parseOffsets } from './db.ts';
import { keyboard, render } from './messages.ts';
import { ensureOccurrences } from './occurrences.ts';
import { quietNow } from './overrides.ts';
import { runPartnerAuto } from './partner.ts';
import { processOutbox } from './pmsg.ts';
import { settleChallenges } from './challenges.ts';
import { sendWeeklyReport } from './report.ts';
import { sendWeeklyBackup } from './backup.ts';
import { addDays, localDate, localHM, makeDigits } from './time.ts';

/** A reminder that is more than this many seconds late is skipped (not sent). */
const GRACE_SEC = 180;
/** If the user never typed a reason, nagging resumes after this many seconds. */
const REASON_TIMEOUT_SEC = 900;
/** A class that ended longer ago than this is closed silently (no "no response" message). */
const LATE_CLOSE_SEC = 1800;

export interface SchedCtx {
  db: D1Database;
  tg: Telegram;
  s: Settings;
  chatId: number;
  now: number;
  getTexts: () => Promise<Map<string, string>>;
}

/** Variables available in class messages. */
export function classVars(o: Occ, s: Settings): Record<string, string | number> {
  const d = makeDigits(s.digits);
  return {
    class_name: o.title,
    time: d(localHM(o.start_ts, s.timezone)),
    end_time: d(localHM(o.end_ts, s.timezone)),
    location: o.location && o.location.trim() !== '' ? o.location : 'مکان نامشخص',
    is_work: o.kind === 'work' ? 1 : 0,
  };
}

/** Remove the buttons of the previous message of this class (or delete it if it was a nag). */
export async function retireMessage(ctx: { db: D1Database; tg: Telegram; chatId: number }, o: Occ): Promise<void> {
  if (!o.last_msg_id) return;
  if (o.last_msg_kind === 'nag' || o.last_msg_kind === 'snooze_end') {
    await ctx.tg.deleteMessage(ctx.chatId, o.last_msg_id);
  } else {
    await ctx.tg.stripKeyboard(ctx.chatId, o.last_msg_id);
  }
}

/**
 * Send one message about a class, exactly once per key.
 * Returns true if the message was sent now.
 */
async function sendLive(
  ctx: SchedCtx,
  o: Occ,
  key: string,
  textKey: string,
  extraVars: Record<string, string | number>,
  kind: string,
  kb: KeyboardKind | null,
): Promise<boolean> {
  if (!(await claim(ctx.db, key, ctx.now))) {
    // Already sent earlier (for example the state update after the send failed last time): let the caller finish its state update.
    const prev = await ctx.db.prepare(`SELECT status FROM sent_log WHERE key = ?1`).bind(key).first<{ status: string }>();
    return prev !== null && prev.status === 'sent';
  }
  const texts = await ctx.getTexts();
  const text = render(texts, textKey, { ...classVars(o, ctx.s), ...extraVars });
  const res = await ctx.tg.sendMessage(ctx.chatId, text, kb === null ? undefined : keyboard(texts, kb, o.id, makeDigits(ctx.s.digits)(ctx.s.snoozeMin)));
  if (!res.ok) {
    await markFailed(ctx.db, key);
    console.error(`send failed key=${key} code=${res.code} ${res.description}`);
    return false;
  }
  await markSent(ctx.db, key, res.result.message_id);
  await retireMessage(ctx, o); // old buttons go away only after the new message is out
  await ctx.db
    .prepare(`UPDATE occurrences SET last_msg_id = ?1, last_msg_kind = ?2 WHERE id = ?3`)
    .bind(res.result.message_id, kind, o.id)
    .run();
  o.last_msg_id = res.result.message_id;
  o.last_msg_kind = kind;
  return true;
}

/** The user did not answer: mark the class and tell the user. Stage 2 will read the event. */
async function closeAsNoResponse(ctx: SchedCtx, o: Occ): Promise<void> {
  const r = await ctx.db
    .prepare(
      `UPDATE occurrences SET status = 'no_response', resolved_at = ?1
        WHERE id = ?2 AND status IN ('upcoming', 'awaiting_reason')`,
    )
    .bind(ctx.now, o.id)
    .run();
  if ((r.meta.changes ?? 0) === 0) return;
  await emit(
    ctx.db,
    'no_response_escalation',
    o.id,
    { title: o.title, start_ts: o.start_ts, nags: o.nag_count, is_test: o.is_test },
    ctx.now,
  );
  await sendLive(ctx, o, `noresp:${o.id}`, 'no_response', {}, 'noresp', 'noresp');
}

/** The person pressed «باشه»: at most one plain heads-up when the class starts, nothing to confirm, no nagging. */
async function processAcked(ctx: SchedCtx, o: OccJoined): Promise<void> {
  const { db, s, now } = ctx;
  if (now < o.start_ts || o.next_nag_ts !== null) return; // earlier reminders are skipped; the start was already handled
  if (s.ackStartNotice) await sendLive(ctx, o, `ackstart:${o.id}`, 'ack_start', {}, 'ackstart', null);
  // next_nag_ts marks "the start is handled"; past the end nothing is ever sent
  await db.prepare(`UPDATE occurrences SET next_nag_ts = ?1 WHERE id = ?2`).bind(o.end_ts + 1, o.id).run();
}

async function processOccurrence(ctx: SchedCtx, o: OccJoined): Promise<void> {
  const { db, s, now } = ctx;
  if (o.acked_at !== null && o.acked_at !== undefined) {
    await processAcked(ctx, o);
    return;
  }
  const offsets = parseOffsets(o.c_offsets) ?? s.offsets;
  const intervalSec = (o.c_nag ?? s.nagIntervalMin) * 60;

  // 1) Reminders before the class starts.
  if (now < o.start_ts) {
    for (const off of offsets) {
      const due = o.start_ts - off * 60;
      if (now >= due && now < Math.min(due + GRACE_SEC, o.start_ts)) {
        const d = makeDigits(s.digits);
        await sendLive(ctx, o, `rem:${o.id}:${off}`, 'remind_before', { minutes: d(off) }, 'pre', 'pre');
        break; // never send two early reminders in the same minute
      }
    }
    return;
  }

  // 2) The "class time" message (once).
  if (o.next_nag_ts === null) {
    const sent = await sendLive(ctx, o, `start:${o.id}`, 'class_time', {}, 'start', 'main');
    if (sent) {
      await db
        .prepare(`UPDATE occurrences SET next_nag_ts = ?1 WHERE id = ?2`)
        .bind(now + intervalSec, o.id)
        .run();
    }
    return;
  }

  // 3) Snooze: wait until it ends, then ask again.
  if (o.snooze_until !== null) {
    if (now < o.snooze_until) return;
    const sent = await sendLive(ctx, o, `snz:${o.id}:${o.snooze_count}`, 'snooze_end', {}, 'snooze_end', 'main');
    if (sent) {
      await db
        .prepare(`UPDATE occurrences SET snooze_until = NULL, next_nag_ts = ?1 WHERE id = ?2`)
        .bind(now + intervalSec, o.id)
        .run();
    }
    return;
  }

  // 4) Nag loop.
  if (now >= o.next_nag_ts) {
    if (o.nag_count >= s.maxNags) {
      await closeAsNoResponse(ctx, o);
      return;
    }
    const n = o.nag_count + 1;
    const d = makeDigits(s.digits);
    const sent = await sendLive(
      ctx,
      o,
      `nag:${o.id}:${o.snooze_count}:${n}`,
      'nag',
      { n: d(n), max: d(s.maxNags) },
      'nag',
      'main',
    );
    if (sent) {
      await db
        .prepare(`UPDATE occurrences SET nag_count = ?1, next_nag_ts = ?2 WHERE id = ?3`)
        .bind(n, now + intervalSec, o.id)
        .run();
    }
  }
}

export async function runScheduler(env: Env, tg: Telegram, now: number): Promise<void> {
  const db = env.DB;

  // Heartbeat (so /health can show that the scheduler is alive).
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('last_tick', ?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2`,
    )
    .bind(String(now), now)
    .run();

  const s = await loadSettings(db);
  // Not reminders, so they are not blocked by a pause: scheduled messages from the partner, and the end-of-day challenge result.
  // (Both are delivered silently while the owner sleeps or in a quiet period.)
  const safe = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      console.error(`${name} failed`, e instanceof Error ? e.message : String(e));
    }
  };
  await safe('partner outbox', () => processOutbox(env, tg, s, now));
  await safe('challenges', () => settleChallenges(env, tg, s, now));
  await safe('weekly report', () => sendWeeklyReport(env, tg, s, now));
  await safe('weekly backup', () => sendWeeklyBackup(env, tg, s, now));
  if (s.vacation || s.pausedUntil > now) return; // paused: stay silent
  // A quiet period for today (whole day or a time window) works exactly like a pause.
  if ((await quietNow(env.DB, s.timezone, now)).quiet) return;

  let cached: Map<string, string> | null = null;
  const ctx: SchedCtx = {
    db,
    tg,
    s,
    chatId: Number(env.OWNER_ID),
    now,
    getTexts: async () => {
      if (cached === null) cached = await loadTexts(db);
      return cached;
    },
  };

  // Make sure today's and tomorrow's classes exist.
  const today = localDate(now, s.timezone);
  await ensureOccurrences(db, today, s.timezone);
  await ensureOccurrences(db, addDays(today, 1), s.timezone);

  // If the user never typed the reason, go back to normal nagging.
  await db
    .prepare(
      `UPDATE occurrences SET status = 'upcoming', awaiting_since = NULL,
              next_nag_ts = CASE WHEN next_nag_ts IS NULL THEN NULL ELSE ?1 END
        WHERE status = 'awaiting_reason' AND awaiting_since < ?2`,
    )
    .bind(now + 60, now - REASON_TIMEOUT_SEC)
    .run();
  await db
    .prepare(`DELETE FROM pending_input WHERE kind = 'skip_reason' AND created_at < ?1`)
    .bind(now - REASON_TIMEOUT_SEC)
    .run();
  // Housekeeping once an hour: nothing reads the class events yet, so they are marked done and old log rows are removed.
  if (Math.floor(now / 60) % 60 === 0) {
    await safe('cleanup', async () => {
      const old30 = now - 30 * 86400;
      await db.prepare(`UPDATE trigger_events SET processed = 1 WHERE processed = 0`).run();
      await db.prepare(`DELETE FROM trigger_events WHERE created_at < ?1`).bind(old30).run();
      await db.prepare(`DELETE FROM sent_log WHERE created_at < ?1`).bind(old30).run();
    });
  }

  // Close classes that have ended without an answer.
  const ended = await db
    .prepare(`SELECT * FROM occurrences WHERE status IN ('upcoming', 'awaiting_reason') AND end_ts <= ?1`)
    .bind(now)
    .all<Occ>();
  for (const o of ended.results) {
    try {
      if (o.acked_at !== null && o.acked_at !== undefined) {
        // They said "باشه": count it as attended without asking (they can still change it in the app).
        await db
          .prepare(`UPDATE occurrences SET status = 'attended', resolved_at = ?1 WHERE id = ?2 AND status IN ('upcoming', 'awaiting_reason')`)
          .bind(now, o.id)
          .run();
        continue;
      }
      if (o.status === 'awaiting_reason' || (o.snooze_until !== null && o.snooze_until !== undefined && o.snooze_until > o.end_ts)) {
        // The person did answer (skip reason pending, or a snooze that runs past the end): never call it "no response".
        await db
          .prepare(`UPDATE occurrences SET status = 'unmarked', resolved_at = ?1 WHERE id = ?2 AND status IN ('upcoming', 'awaiting_reason')`)
          .bind(now, o.id)
          .run();
        continue;
      }
      const wasNotified = await db
        .prepare(`SELECT 1 AS x FROM sent_log WHERE key = ?1 AND status = 'sent'`)
        .bind(`start:${o.id}`)
        .first();
      if (wasNotified && now - o.end_ts <= LATE_CLOSE_SEC) {
        await closeAsNoResponse(ctx, o);
      } else {
        // Never notified (paused, deployed late, ...) or too old: close silently.
        await db
          .prepare(`UPDATE occurrences SET status = 'unmarked', resolved_at = ?1 WHERE id = ?2 AND status IN ('upcoming', 'awaiting_reason')`)
          .bind(now, o.id)
          .run();
      }
    } catch (e) {
      console.error('close class failed', o.id, e);
    }
  }

  // Classes that are starting soon or running now. The look-ahead must cover the largest reminder offset in use.
  let maxOffsetMin = Math.max(60, ...s.offsets);
  try {
    const rows = await db.prepare(`SELECT offsets FROM courses WHERE active = 1 AND offsets IS NOT NULL`).all<{ offsets: string }>();
    for (const r of rows.results) for (const n of parseOffsets(r.offsets) ?? []) if (n > maxOffsetMin) maxOffsetMin = n;
  } catch (e) {
    console.error('offset lookup failed', e instanceof Error ? e.message : String(e));
  }
  const lookaheadSec = Math.min(maxOffsetMin, 720) * 60 + GRACE_SEC;
  const active = await db
    .prepare(
      `SELECT o.*, c.offsets AS c_offsets, c.nag_interval_min AS c_nag
         FROM occurrences o
         LEFT JOIN courses c ON c.id = o.course_id
        WHERE o.status = 'upcoming' AND o.start_ts <= ?1 AND o.end_ts > ?2
        ORDER BY o.start_ts`,
    )
    .bind(now + lookaheadSec, now)
    .all<OccJoined>();
  for (const o of active.results) {
    try {
      await processOccurrence(ctx, o);
    } catch (e) {
      console.error('process class failed', o.id, e);
    }
  }

  // Phase 2: automatic messages to the partner (after the class reminders, which are time-critical).
  try {
    await runPartnerAuto(env, tg, s, now);
  } catch (e) {
    console.error('partner auto failed', e instanceof Error ? e.message : String(e));
  }
}
