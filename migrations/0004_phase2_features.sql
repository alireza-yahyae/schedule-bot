-- Phase 2: partner messages, study log, habits and grades.
-- Same conventions as the earlier migrations: timestamps are epoch SECONDS, local dates are "YYYY-MM-DD" (Gregorian).
-- This bot has ONE owner, so these tables have no user_id column.

-- Exactly one row (id = 1): who the partner is and how the automatic messages behave.
CREATE TABLE partner_settings (
  id                           INTEGER PRIMARY KEY CHECK (id = 1),
  chat_id                      TEXT,                              -- Telegram id of the partner (NULL = nobody connected)
  name                         TEXT NOT NULL DEFAULT 'پارتنر',
  pairing_code                 TEXT,                              -- one-time code; NULL while a partner is connected
  allow_partner_edit_templates INTEGER NOT NULL DEFAULT 1,
  auto_notify_enabled          INTEGER NOT NULL DEFAULT 1,
  idle_threshold_hours         INTEGER NOT NULL DEFAULT 2,
  hard_study_threshold_hours   INTEGER NOT NULL DEFAULT 4,
  last_notified_at             INTEGER,
  paired_at                    INTEGER,
  created_at                   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
INSERT INTO partner_settings (id, pairing_code) VALUES (1, upper(hex(randomblob(4))));

CREATE TABLE message_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  category       TEXT NOT NULL CHECK (category IN ('partner_not_studying', 'user_slacking', 'user_studied_hard', 'custom_scheduled')),
  time_condition TEXT NOT NULL DEFAULT 'manual' CHECK (time_condition IN ('morning', 'night', 'after_2_hours_idle', 'after_4_hours_study', 'manual', 'any')),
  message_text   TEXT NOT NULL,                                   -- may contain {hours} and {partner}
  created_by     TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'partner')),
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX idx_message_templates_lookup ON message_templates(category, time_condition, is_active);

-- Study time typed in by hand (/study or the app). Finished focus (Pomodoro) sessions count too.
CREATE TABLE study_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  minutes    INTEGER NOT NULL,
  note       TEXT,
  date       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_study_date ON study_sessions(date);

CREATE TABLE habits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '✅',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- A row exists only for the days the habit was done.
CREATE TABLE habit_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  UNIQUE (habit_id, date)
);
CREATE INDEX idx_habit_logs_date ON habit_logs(habit_id, date);

CREATE TABLE grades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_name   TEXT NOT NULL,
  units         REAL NOT NULL DEFAULT 3,
  midterm_score REAL NOT NULL DEFAULT 0,
  final_score   REAL NOT NULL DEFAULT 0,
  project_score REAL NOT NULL DEFAULT 0,
  total_score   REAL NOT NULL DEFAULT 0,
  semester      TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX idx_grades_semester ON grades(semester);

-- ---------------------------------------------------------------- ready-made partner messages
-- Seed Data: Category 1 (partner_not_studying)
INSERT INTO message_templates (category, time_condition, message_text, created_by, is_active) VALUES
('partner_not_studying', 'manual', 'خانم محترم، رادارهای من نشون میده الان به جای درس خوندن داری تو گوشی می‌چرخی! برو سر کتابات تا نیومدم گوشاتو بکشم.', 'user', 1),
('partner_not_studying', 'manual', 'الو! قرار بود امروز بترکونی یا کتابا رو دکور گذاشتی جلوت؟ پاشو برو درس بخون تنبل خانوم!', 'user', 1),
('partner_not_studying', 'morning', 'صبح بخیر خوشگلم، فقط خواستم یادآوری کنم کتابات دارن از تنهایی گریه می‌کنن. پاشو دست به کار شو!', 'user', 1),
('partner_not_studying', 'after_2_hours_idle', 'الان {hours} ساعته از برنامه‌ت عقب افتادی‌ها! گوشی رو بذار کنار و برگرد سر درس خوندن.', 'user', 1),
('partner_not_studying', 'manual', 'اخطار رسمی از طرف دوست‌پسرت: اگه تا ۵ دقیقه دیگه نری سر درس، از جایزه و قربون صدقه خبری نیست!', 'user', 1),
('partner_not_studying', 'night', 'قبل اینکه خوابت ببره اون مبحثی که مونده رو جمع کن، فردا بهانه نیاری‌ها!', 'user', 1),
('partner_not_studying', 'manual', 'ببین کی دوباره داره از زیر درس در میره! زود باش برگرد سر میز مطالعه.', 'user', 1),
('partner_not_studying', 'after_2_hours_idle', 'گزارش سیستم: خانم دکتر/مهندس آینده الان {hours} ساعته کتاب باز نکرده. سریع جبران کن!', 'user', 1),
('partner_not_studying', 'manual', 'نکنه منتظری کتابا خودشون بیان برن تو مخت؟ پاشو بخون دیگه دختر خوب!', 'user', 1),
('partner_not_studying', 'manual', 'یک عدد پارتنر حواس‌پرت شناسایی شد! تمرکز رو برگردون روی درسات عزیزم.', 'user', 1),
('partner_not_studying', 'morning', 'امروز روز خرخونیه، حق نداری تنبلی کنی! از همین الان استارت بزن.', 'user', 1);

-- Seed Data: Category 2 (user_slacking)
INSERT INTO message_templates (category, time_condition, message_text, created_by, is_active) VALUES
('user_slacking', 'after_2_hours_idle', 'گزارش وضعیت: دوست‌پسر به درد نخورت الان {hours} ساعته لای کتاب رو باز نکرده و داره وقت تلف می‌کنه. لطفاً اقدام لازم رو مبنی بر جر دادن ایشون انجام بده.', 'user', 1),
('user_slacking', 'manual', 'هشدار سیستم: این بشر باز درس نمی‌خونه. وقتشه بیای و از خجالتش دربیای!', 'user', 1),
('user_slacking', 'after_2_hours_idle', 'آژیر قرمز تنبلی: آقا الان {hours} ساعته به جای درس خوندن رفته تو فاز استراحت ابدی. بیا حسابشو برس!', 'user', 1),
('user_slacking', 'manual', 'گزارش خودکار: دوست‌پسرت رسماً زده به جاده خاکی و کتاباش خاک خورده. مجوز برخورد فیزیکی و لفظی صادر شد!', 'user', 1),
('user_slacking', 'after_2_hours_idle', 'وضعیت بحرانی: {hours} ساعت بیکاری مطلق ثبت شد! اگه نیای دعواش کنی امروزش کامل می‌پره.', 'user', 1),
('user_slacking', 'manual', 'اعتراف‌نامه رسمی: من باز دارم تنبلی می‌کنم و زورم به خودم نمی‌رسه. لطفاً بیا منو بشور بذار کنار تا برم سر درس!', 'user', 1),
('user_slacking', 'night', 'گزارش شبانه: این آقا امروز به اندازه کافی نخونده و الانم داره سوسول‌بازی درمیاره. یه تهدید درست و حسابی لازمه!', 'user', 1),
('user_slacking', 'after_2_hours_idle', 'پشتیبانی محترم پارتنر: دستگاه درس‌خوان دوست‌پسرت از {hours} ساعت پیش هنگ کرده. با یه اردنگی ریستارتش کن!', 'user', 1),
('user_slacking', 'manual', 'اعلام جرم: متهم ردیف اول (دوست‌پسرت) در حال فرار از مطالعه دستگیر شد. حکم رو شما صادر کن!', 'user', 1),
('user_slacking', 'morning', 'ساعت‌هاست روز شروع شده ولی این تنبل هنوز استارت درس رو نزده. بیا بیدارش کن وگرنه تا ظهر می‌خوابه!', 'user', 1),
('user_slacking', 'after_2_hours_idle', 'اپراتور عزیز، دوست‌پسر شما به مدت {hours} ساعت در حالت علافی قرار دارد. جهت قطع دسترسی او به تفریح اقدام نمایید.', 'user', 1),
('user_slacking', 'manual', 'کمک فوری! شیطان درونم بر من غلبه کرده و نمی‌ذاره درس بخونم. بیا با دمپایی ابری نجاتم بده!', 'user', 1);

-- Seed Data: Category 3 (user_studied_hard)
INSERT INTO message_templates (category, time_condition, message_text, created_by, is_active) VALUES
('user_studied_hard', 'after_4_hours_study', 'گزارش عملکرد عالی: دوست‌پسرت امروز ترکونده و {hours} ساعت بکوب درس خونده. الان شدیداً افت انرژی داره و نیازمند روحیه‌ست؛ بدو بیا بهش جایزه و روحیه بده!', 'user', 1),
('user_studied_hard', 'manual', 'وضعیت اضطراری انرژی: مغز دوست‌پسرت از شدت درس خوندن سوت کشیده. سریع بیا شارژش کن!', 'user', 1),
('user_studied_hard', 'after_4_hours_study', 'ثبت رکورد جدید: این پسر باهوش امروز {hours} ساعت تمام پای کتاب بوده. یه پیام قربون صدقه ویژه طلبکاره!', 'user', 1),
('user_studied_hard', 'manual', 'گزارش سیستم: باتری دوست‌پسرت بعد از یه تایم سنگین خرخونی به ۱٪ رسیده. تنها راه شارژ مجدد: محبت و توجه پارتنر!', 'user', 1),
('user_studied_hard', 'after_4_hours_study', 'مژده به پارتنر محترم: امروز {hours} ساعت مطالعه خالص ثبت شد! بیا به این پسر پرتلاش خسته نباشید بگو.', 'user', 1),
('user_studied_hard', 'night', 'گزارش پایان شیفت خرخونی: امروز کل برنامه‌رو قورت دادم و الان لهِ لهم. نوبت جایزه شبانه‌ست!', 'user', 1),
('user_studied_hard', 'after_4_hours_study', 'هشدار داغ کردن موتور مغز: بعد از {hours} ساعت درس خوندن مداوم، سیستم نیاز به خنک‌کننده عاطفی فوری دارد!', 'user', 1),
('user_studied_hard', 'manual', 'ماموریت انجام شد! امروز مثل یه قهرمان درس خوندم. الان رسماً نیازمند لوس شدن توسط پارتنرم هستم.', 'user', 1),
('user_studied_hard', 'after_4_hours_study', 'گواهی افتخار: دارنده این پیام امروز {hours} ساعت بدون وقفه درس خونده و مستحق دریافت بیشترین میزان بوس و انرژی مثبته!', 'user', 1),
('user_studied_hard', 'manual', 'سنسورهای سیستم نشون میدن قند خون و روحیه دوست‌پسرت به خاطر درس زیاد افتاده. سریع به دادش برس!', 'user', 1),
('user_studied_hard', 'after_4_hours_study', 'تبریک! دوست‌پسرت امروز {hours} ساعت مثل ساعت کار کرده. یه ویس یا پیام قشنگ بفرست تا خستگیش در بره.', 'user', 1),
('user_studied_hard', 'manual', 'پایان ماراتن مطالعه! مغزم ذوب شد ولی جا نزدم. بیا تحویلم بگیر!', 'user', 1);

-- Seed Data: Category 4 (custom_scheduled)
INSERT INTO message_templates (category, time_condition, message_text, created_by, is_active) VALUES
('custom_scheduled', 'morning', 'صبح بخیر! برنامه امروزت آماده‌ست، بریم که یه روز فوق‌العاده بسازیم.', 'user', 1),
('custom_scheduled', 'night', 'شب بخیر! خسته نباشی بابت تمام تلاش‌های امروزت.', 'user', 1);

-- ---------------------------------------------------------------- bot texts (editable in the app)
INSERT OR IGNORE INTO bot_texts (key, text, description) VALUES
('partner_not_paired',
 '⚠️ هنوز پارتنری وصل نشده. از تب «پیام‌ها» توی برنامه (/app) کد اتصال رو بگیر و به پارتنرت بده.',
 'وقتی پیامی برای پارتنر هست ولی کسی وصل نیست'),
('partner_sent', '📤 برای {name} فرستاده شد:\n\n«{text}»', 'تایید ارسال پیام به پارتنر'),
('partner_send_failed',
 '❌ پیام نرفت. احتمالاً {name} هنوز ربات رو استارت نکرده یا بلاکش کرده.',
 'خطا در ارسال پیام به پارتنر'),
('study_logged', '✅ {minutes} دقیقه مطالعه ثبت شد. مجموع امروز: {hours} ساعت.', 'بعد از /study'),
('partner_paired_owner', '🎉 {name} به ربات وصل شد. از این به بعد پیام‌ها برای اون هم می‌ره.', 'خبر اتصال پارتنر برای تو'),
('partner_paired_partner',
 '✅ وصل شدی! از حالا گزارش‌های درس خوندن اینجا برات میاد. می‌تونی از برنامه، متن پیام‌ها رو هم ویرایش کنی (/app).\n\nهر وقت خواستی با /stop خارج شو.',
 'پیام خوش‌آمد برای پارتنر'),
('partner_unpaired_owner', '🔌 {name} از ربات خارج شد.', 'وقتی پارتنر /stop می‌زنه'),
('partner_unpaired_partner', '👋 اتصالت قطع شد و دیگه پیامی برات نمی‌آد.', 'جواب /stop برای پارتنر'),
('partner_bad_code', '❌ این کد درست نیست یا قبلاً استفاده شده.', 'کد اتصال اشتباه'),
('partner_open_app', '📱 برای ویرایش متن پیام‌ها برنامه رو باز کن:', 'پیام /app برای پارتنر');

-- Add the new commands to /help, but only if you never edited that text yourself.
UPDATE bot_texts
   SET text = text || '

<b>پیام به پارتنر</b>
/study — ثبت مطالعه (مثلاً <code>/study 90</code> یعنی ۹۰ دقیقه)
/slacking — به پارتنر خبر بده درس نخوندی
/studied — به پارتنر خبر بده کلی درس خوندی
/remind_partner — یادآوری درس خوندن برای پارتنر'
 WHERE key = 'help' AND text NOT LIKE '%/remind_partner%' AND text LIKE '%/resume%';
