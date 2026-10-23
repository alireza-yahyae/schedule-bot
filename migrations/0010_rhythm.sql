-- Phase 4, step 5: Pomodoro per category, streaks per category, habits that tick themselves, weekly report.

-- Focus (Pomodoro) sessions belong to a category (old ones count as study = 1).
ALTER TABLE focus_sessions ADD COLUMN category_id INTEGER NOT NULL DEFAULT 1;

-- Focus and break length per category (NULL = use the general setting).
ALTER TABLE categories ADD COLUMN focus_minutes INTEGER;
ALTER TABLE categories ADD COLUMN break_minutes INTEGER;

-- A habit can follow a category: it counts as done on every day that category reached auto_minutes.
ALTER TABLE habits ADD COLUMN category_id  INTEGER;
ALTER TABLE habits ADD COLUMN auto_minutes INTEGER;

-- Friday evening summary in Telegram (turn off from Settings).
INSERT OR IGNORE INTO settings (key, value) VALUES ('weekly_report', '1');
