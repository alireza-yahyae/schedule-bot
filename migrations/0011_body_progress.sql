-- Phase 4, step 6: water / exercise / sleep / energy, achievements, weekly backup.

-- One row per day: glasses of water, minutes of exercise, hours slept last night.
CREATE TABLE day_logs (
  date         TEXT PRIMARY KEY,                -- local YYYY-MM-DD
  water        INTEGER NOT NULL DEFAULT 0,
  exercise_min INTEGER NOT NULL DEFAULT 0,
  sleep_hours  REAL,                            -- NULL = not entered
  updated_at   INTEGER NOT NULL
);

-- Energy 1..5, once per part of the day (a new tap replaces the old one).
CREATE TABLE mood_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  slot       TEXT NOT NULL CHECK (slot IN ('morning', 'afternoon', 'evening')),
  energy     INTEGER NOT NULL CHECK (energy BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL,
  UNIQUE (date, slot)
);

-- Badges that were unlocked (the rules live in the code).
CREATE TABLE achievements (
  key         TEXT PRIMARY KEY,
  unlocked_at INTEGER NOT NULL
);

-- A copy of your data arrives in Telegram every Friday evening (turn off from Settings).
INSERT OR IGNORE INTO settings (key, value) VALUES ('weekly_backup', '1');
