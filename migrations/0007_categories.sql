-- Phase 4, step 1: activity categories (study, work, anything you add) for the timer and study log.
-- Old sessions keep working: they all get category 1 (study).

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📌',
  color      TEXT NOT NULL DEFAULT '#4F8CFF',
  sort       INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,                       -- 0 = archived (hidden from pickers, old sessions keep it)
  is_builtin INTEGER NOT NULL DEFAULT 0,                       -- the study category can not be removed
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

INSERT INTO categories (id, title, icon, color, sort, is_builtin) VALUES
  (1, 'درس',         '📚', '#4F8CFF', 1, 1),
  (2, 'کار',         '💼', '#F59E0B', 2, 0),
  (3, 'پروژه شخصی', '🛠', '#10B981', 3, 0);

ALTER TABLE study_sessions ADD COLUMN category_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE study_timer    ADD COLUMN category_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_study_category ON study_sessions(category_id, created_at);

-- Add /work to /help, but only if you never edited that text yourself.
UPDATE bot_texts
   SET text = text || '
/work — ثبت کار (مثلاً <code>/work 90</code> یعنی ۹۰ دقیقه)'
 WHERE key = 'help' AND text NOT LIKE '%/work%' AND text LIKE '%/study%';
