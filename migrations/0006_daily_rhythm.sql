-- Phase 3: study timer, meals, partner -> owner messages, daily challenges, and the owner's real daily rhythm.

-- Sleep 07:00 -> wake 12:00 (the owner's normal day; special days can still override it).
INSERT INTO settings (key, value, updated_at) VALUES
  ('sleep_time', '07:00', CAST(strftime('%s','now') AS INTEGER)),
  ('wake_time',  '12:00', CAST(strftime('%s','now') AS INTEGER))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

-- A study session can now have a start (the timer) as well as an end (created_at).
ALTER TABLE study_sessions ADD COLUMN started_at INTEGER;

-- "I started studying" button: exactly one row; started_at is NULL while the timer is off.
CREATE TABLE study_timer (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  started_at INTEGER
);
INSERT INTO study_timer (id, started_at) VALUES (1, NULL);

-- Lunch / dinner of one "day" (the cycle that starts when the owner wakes up).
CREATE TABLE meal_log (
  day    TEXT NOT NULL,
  meal   TEXT NOT NULL CHECK (meal IN ('lunch', 'dinner')),
  status TEXT NOT NULL CHECK (status IN ('done', 'later')),
  after  TEXT CHECK (after IN ('dinner', 'wake')),              -- for status = 'later'
  at_ts  INTEGER,                                               -- when it was eaten, for status = 'done'
  PRIMARY KEY (day, meal)
);

-- What the partner may do / see.
ALTER TABLE partner_settings ADD COLUMN allow_partner_send INTEGER NOT NULL DEFAULT 1;
ALTER TABLE partner_settings ADD COLUMN share_study       INTEGER NOT NULL DEFAULT 1;
ALTER TABLE partner_settings ADD COLUMN share_schedule    INTEGER NOT NULL DEFAULT 1;

-- Messages the PARTNER writes for the owner. Only the partner can see these (the owner just receives them in Telegram).
CREATE TABLE partner_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  send_at    INTEGER NOT NULL,                                  -- epoch seconds; "now" = creation time
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  created_at INTEGER NOT NULL,
  sent_at    INTEGER
);
CREATE INDEX idx_outbox_due ON partner_outbox(status, send_at);

CREATE TABLE partner_library (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One challenge per day, written by the partner: a reward for studying enough, a punishment for studying too little.
CREATE TABLE challenges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  day              TEXT NOT NULL UNIQUE,                        -- the owner's "day" (cycle) key, YYYY-MM-DD
  target_hours     REAL,
  reward_text      TEXT,
  min_hours        REAL,
  punishment_text  TEXT,
  created_at       INTEGER NOT NULL,
  settled_at       INTEGER,
  result_minutes   INTEGER,
  reward_earned    INTEGER,
  punishment_due   INTEGER
);
