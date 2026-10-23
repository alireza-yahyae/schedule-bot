-- Stage 3: Mini App tables and settings.

CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  course_id  INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  due_date   TEXT,                 -- Gregorian YYYY-MM-DD
  due_time   TEXT,                 -- HH:MM
  priority   INTEGER NOT NULL DEFAULT 1,  -- 0 low, 1 normal, 2 high
  notes      TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  done_at    INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX idx_tasks_due ON tasks(done, due_date);

-- Finished focus (Pomodoro) sessions.
CREATE TABLE focus_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  minutes    INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  date       TEXT NOT NULL
);
CREATE INDEX idx_focus_date ON focus_sessions(date);

-- Default values for new settings (you can change them in the Mini App).
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('onboarded', '0'),
  ('gaps_dismissed', '0'),
  ('lunch_time', '13:00'),
  ('dinner_time', '20:00'),
  ('sleep_time', '23:30'),
  ('wake_time', '07:00'),
  ('focus_minutes', '25'),
  ('break_minutes', '5');

INSERT OR REPLACE INTO bot_texts (key, text, description) VALUES
('open_app',
 '📱 برای دیدن برنامه، مدیریت درس‌ها، امتحان‌ها و آمار، برنامه رو باز کن:',
 'پیام /app'),
('btn_open_app', '📱 باز کردن برنامه', 'دکمه باز کردن Mini App'),
('help',
 '📖 <b>راهنما</b>

/app — باز کردن برنامه (Mini App)
/today — برنامه امروز
/tomorrow — برنامه فردا
/week — برنامه هفته
/courses — درس‌ها و تاریخ امتحان‌ها
/pause — توقف موقت (مثلاً <code>/pause 3</code> یعنی ۳ ساعت، <code>/pause day</code> یعنی یک روز)
/resume — شروع دوباره یادآوری‌ها
/test — ساخت یک کلاس تستی برای دیدن یادآوری‌ها (<code>/test full</code> یعنی با یادآوری قبل از کلاس)
/help — همین راهنما

افزودن و ویرایش درس، کارها، آمار و تنظیمات توی برنامه (/app) هستن.',
 'پیام /help');
