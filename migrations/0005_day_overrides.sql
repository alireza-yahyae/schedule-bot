-- Special days: a different sleep / wake time and/or a quiet period, for ONE date or for a weekday every week.
-- Weekday numbers follow the rest of the app: 0 = Saturday ... 6 = Friday.

CREATE TABLE day_overrides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL CHECK (scope IN ('date', 'weekday')),
  date       TEXT,                                            -- "YYYY-MM-DD" when scope = 'date'
  weekday    INTEGER CHECK (weekday BETWEEN 0 AND 6),         -- when scope = 'weekday'
  sleep_time TEXT,                                            -- NULL = use the normal setting
  wake_time  TEXT,
  quiet_mode TEXT NOT NULL DEFAULT 'none' CHECK (quiet_mode IN ('none', 'all_day', 'window')),
  quiet_from TEXT,
  quiet_to   TEXT,
  created_at INTEGER NOT NULL,
  CHECK ((scope = 'date' AND date IS NOT NULL AND weekday IS NULL) OR (scope = 'weekday' AND weekday IS NOT NULL AND date IS NULL))
);
CREATE UNIQUE INDEX ux_day_override_date    ON day_overrides(date)    WHERE scope = 'date';
CREATE UNIQUE INDEX ux_day_override_weekday ON day_overrides(weekday) WHERE scope = 'weekday';
