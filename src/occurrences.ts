// Turns the weekly timetable (course_sessions) into concrete dated classes (occurrences).

import { iranWeekday, zonedToEpoch } from './time.ts';

interface SessionRow {
  id: number;
  course_id: number;
  start_time: string;
  end_time: string;
  location: string | null;
  title: string;
  kind: string;
}

/** Make sure every class of the given local date exists as an occurrence row. */
export async function ensureOccurrences(db: D1Database, date: string, tz: string): Promise<void> {
  const weekday = iranWeekday(date);
  const sessions = await db
    .prepare(
      `SELECT s.id, s.course_id, s.start_time, s.end_time,
              COALESCE(s.location, c.location) AS location, c.name AS title, c.kind AS kind
         FROM course_sessions s
         JOIN courses c   ON c.id = s.course_id
         JOIN semesters m ON m.id = c.semester_id
        WHERE s.active = 1 AND c.active = 1 AND m.is_active = 1 AND m.archived_at IS NULL
          AND s.weekday = ?1`,
    )
    .bind(weekday)
    .all<SessionRow>();
  if (sessions.results.length === 0) return;

  const existing = await db
    .prepare(`SELECT session_id FROM occurrences WHERE date = ?1 AND session_id IS NOT NULL`)
    .bind(date)
    .all<{ session_id: number }>();
  const have = new Set(existing.results.map((r) => r.session_id));

  const inserts = sessions.results
    .filter((s) => !have.has(s.id))
    .map((s) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO occurrences (session_id, course_id, date, title, location, start_ts, end_ts, kind)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(
          s.id,
          s.course_id,
          date,
          s.title,
          s.location,
          zonedToEpoch(date, s.start_time, tz),
          zonedToEpoch(date, s.end_time, tz),
          s.kind,
        ),
    );
  if (inserts.length > 0) await db.batch(inserts);
}
