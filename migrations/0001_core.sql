-- Stage 1: core tables.
-- Weekday numbers: 0 = Saturday, 1 = Sunday, 2 = Monday, 3 = Tuesday, 4 = Wednesday, 5 = Thursday, 6 = Friday.
-- All timestamps are epoch SECONDS (UTC). Local dates are "YYYY-MM-DD" (Gregorian).

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- All owner-facing message templates and button labels (editable, Persian).
CREATE TABLE bot_texts (
  key         TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE semesters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  archived_at INTEGER
);

CREATE TABLE courses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id      INTEGER NOT NULL REFERENCES semesters(id),
  name             TEXT NOT NULL,
  group_no         TEXT,
  teacher          TEXT,
  location         TEXT,
  units            REAL,
  color            TEXT NOT NULL DEFAULT '#4F8CFF',
  notes            TEXT,
  exam_date        TEXT,  -- Gregorian YYYY-MM-DD
  exam_date_j      TEXT,  -- Jalali YYYY/MM/DD (for display)
  exam_start       TEXT,  -- HH:MM
  exam_end         TEXT,
  exam_location    TEXT,
  offsets          TEXT,  -- NULL = use global default, e.g. "15,10"; "0" = no early reminders
  nag_interval_min INTEGER,
  notify_partner   INTEGER NOT NULL DEFAULT 1,
  allowed_absences INTEGER NOT NULL DEFAULT 3,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

CREATE TABLE course_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,  -- HH:MM (24h, local time)
  end_time   TEXT NOT NULL,
  location   TEXT,           -- NULL = use the course location
  kind       TEXT NOT NULL DEFAULT 'class',  -- class | lab | workshop
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_sessions_weekday ON course_sessions(weekday);

-- One row per class per date. History lives here (title/location are copied, so
-- editing or deleting a course never changes the past).
CREATE TABLE occurrences (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     INTEGER REFERENCES course_sessions(id) ON DELETE SET NULL,
  course_id      INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  date           TEXT NOT NULL,
  title          TEXT NOT NULL,
  location       TEXT,
  start_ts       INTEGER NOT NULL,
  end_ts         INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'upcoming',
  nag_count      INTEGER NOT NULL DEFAULT 0,
  next_nag_ts    INTEGER,
  snooze_until   INTEGER,
  snooze_count   INTEGER NOT NULL DEFAULT 0,
  skip_reason    TEXT,
  last_msg_id    INTEGER,
  last_msg_kind  TEXT,
  awaiting_since INTEGER,
  is_test        INTEGER NOT NULL DEFAULT 0,
  resolved_at    INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  UNIQUE (session_id, date)
);
CREATE INDEX idx_occ_date ON occurrences(date);
CREATE INDEX idx_occ_status_start ON occurrences(status, start_ts);

-- Idempotency: a message key can be sent only once (class reminders, nags, ...).
CREATE TABLE sent_log (
  key        TEXT PRIMARY KEY,
  status     TEXT NOT NULL,   -- claimed | sent | failed
  attempts   INTEGER NOT NULL DEFAULT 1,
  message_id INTEGER,
  created_at INTEGER NOT NULL
);

-- "Waiting for you to type something" (for example the reason for skipping a class).
CREATE TABLE pending_input (
  chat_id    INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,
  ref_id     INTEGER,
  created_at INTEGER NOT NULL
);

-- Events that Stage 2 (partner messages) will read. Stage 1 only writes them.
CREATE TABLE trigger_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,  -- class_cancelled | class_skipped_with_reason | class_skipped_no_reason | no_response_escalation
  occurrence_id INTEGER,
  data          TEXT,           -- JSON
  created_at    INTEGER NOT NULL,
  processed     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_events_processed ON trigger_events(processed, id);
