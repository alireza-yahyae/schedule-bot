-- Stage 1 seed data: settings, Persian texts, and the semester timetable.
-- Everything here is an editable database row. Nothing is hard-coded in the source code.
-- Weekdays: 0 = Saturday, 1 = Sunday, 2 = Monday, 3 = Tuesday, 4 = Wednesday, 5 = Thursday, 6 = Friday.

INSERT INTO settings (key, value) VALUES
  ('timezone', 'Asia/Tehran'),
  ('offsets', '15,10,0'),
  ('nag_interval_min', '5'),
  ('max_nags', '6'),
  ('snooze_min', '10'),
  ('vacation', '0'),
  ('paused_until', '0'),
  ('digits', 'fa'),
  ('weekend_days', '6');

-- ---------------------------------------------------------------- semester + courses
INSERT INTO semesters (id, name, is_active) VALUES (1, 'ترم اول ۱۴۰۵-۱۴۰۶', 1);

INSERT INTO courses
  (id, semester_id, name, group_no, teacher, location, units, color, exam_date, exam_date_j, exam_start, exam_end, exam_location)
VALUES
  (1, 1, 'آیرودینامیک ۱', '82', NULL, 'دانشکده هوافضا، کلاس ۲۰۴', NULL, '#4F8CFF', '2027-01-25', '1405/11/05', '08:00', '10:30', NULL),
  (2, 1, 'مبانی هوش مصنوعی', '81', NULL, 'دانشکده هوافضا', NULL, '#8B5CF6', '2027-01-18', '1405/10/28', '08:00', '10:30', 'سالن'),
  (3, 1, 'آیین نگارش و گزارش‌نویسی فنی', '82', NULL, 'دانشکده هوافضا، کلاس ۲۰۳', NULL, '#10B981', '2027-01-13', '1405/10/23', '08:00', '10:30', NULL),
  (4, 1, 'ترمودینامیک ۲', '83', NULL, 'دانشکده هوافضا', NULL, '#F59E0B', '2027-01-11', '1405/10/21', '08:00', '10:30', 'سالن'),
  (5, 1, 'آز مبانی برق و الکترونیک', '81', NULL, NULL, NULL, '#EF4444', NULL, NULL, NULL, NULL, NULL),
  (6, 1, 'کارگاه موتور، بدنه و سیستم‌های هواپیما', '81', NULL, 'مجتمع آزمایشگاه‌های دانشکده', NULL, '#14B8A6', NULL, NULL, NULL, NULL, NULL);

-- ---------------------------------------------------------------- weekly sessions
INSERT INTO course_sessions (course_id, weekday, start_time, end_time, kind) VALUES
  (1, 0, '09:00', '10:30', 'class'),     -- Aerodynamics 1: Saturday
  (1, 3, '09:00', '10:30', 'class'),     -- Aerodynamics 1: Tuesday
  (2, 1, '13:30', '15:00', 'class'),     -- AI fundamentals: Sunday
  (2, 4, '13:30', '15:00', 'class'),     -- AI fundamentals: Wednesday
  (3, 3, '10:30', '12:30', 'class'),     -- Technical writing: Tuesday
  (4, 3, '13:30', '15:00', 'class'),     -- Thermodynamics 2: Tuesday
  (5, 4, '10:30', '12:30', 'lab'),       -- Electronics lab: Wednesday
  (6, 5, '07:30', '09:00', 'workshop'),  -- Workshop: Thursday (first part)
  (6, 5, '09:00', '10:30', 'workshop');  -- Workshop: Thursday (second part)

-- ---------------------------------------------------------------- Persian texts (editable)
-- Variables look like {class_name}. Basic HTML (<b>, <i>, <code>) is allowed.
INSERT INTO bot_texts (key, text, description) VALUES
('remind_before',
 '⏳ <b>{minutes} دقیقه</b> دیگه کلاس شروع می‌شه
📚 {class_name}
🕘 {time}
📍 {location}',
 'یادآوری قبل از کلاس. متغیرها: minutes, class_name, time, end_time, location'),

('class_time',
 '🔔 <b>الان وقت کلاسه!</b>
📚 {class_name}
🕘 {time} تا {end_time}
📍 {location}

رفتی کلاس؟',
 'پیام لحظه شروع کلاس'),

('nag',
 '⏰ <b>هنوز جواب ندادی!</b> (یادآوری {n} از {max})
📚 {class_name} شروع شده.
رفتی یا نمی‌ری؟',
 'پیام تکراری بعد از شروع کلاس. متغیرها: n, max, class_name'),

('snooze_end',
 '⏰ <b>مهلتت تموم شد!</b>
📚 {class_name} شروع شده. الان چی؟',
 'وقتی زمان «چند دقیقه دیگه» تموم می‌شه'),

('snoozed',
 '⏰ باشه، {minutes} دقیقه دیگه دوباره یادآوری می‌کنم.
📚 {class_name}',
 'تایید دکمه «چند دقیقه دیگه»'),

('ask_reason',
 '✍️ دلیل نرفتنت به کلاس <b>{class_name}</b> رو بنویس و بفرست.
(مثلاً: مریضم، کار فوری دارم، ...)

اگه نمی‌خوای دلیل بدی، دکمه پایین رو بزن.',
 'وقتی «نمی‌رم» رو می‌زنی'),

('marked_went', '✅ ثبت شد: کلاس <b>{class_name}</b> رو رفتی. آفرین! 👏', 'بعد از دکمه رفتم'),
('marked_cancelled', '🚫 ثبت شد: کلاس <b>{class_name}</b> برگزار نشد.', 'بعد از دکمه برگزار نشد'),
('marked_skipped',
 '❌ ثبت شد: کلاس <b>{class_name}</b> رو نمی‌ری.
📝 دلیل: {reason}',
 'بعد از نوشتن دلیل'),
('marked_skipped_noreason', '❌ ثبت شد: کلاس <b>{class_name}</b> رو نمی‌ری. (بدون دلیل)', 'وقتی دلیل نمی‌دی'),

('no_response',
 '⚠️ چند بار یادآوری کردم و جوابی نگرفتم.
کلاس <b>{class_name}</b> «بدون پاسخ» ثبت شد.
اگه رفتی یا برگزار نشد، یکی از دکمه‌ها رو بزن.',
 'وقتی تعداد یادآوری‌ها به سقف می‌رسه'),

('old_button', 'این دکمه قدیمیه و دیگه کار نمی‌کنه.', 'دکمه‌ی قدیمی'),
('already_same', 'قبلاً همین رو ثبت کرده بودی ✅', 'دوباره زدن همون دکمه'),
('already_other', 'قبلاً ثبت شده: {status}', 'زدن دکمه‌ی دیگه بعد از ثبت'),

('btn_went', '✅ رفتم', 'دکمه'),
('btn_cancelled', '🚫 کلاس برگزار نشد', 'دکمه'),
('btn_skip', '❌ نمی‌رم، دلیل دیگه', 'دکمه'),
('btn_snooze', '⏰ {minutes} دقیقه دیگه', 'دکمه'),
('btn_ack', '👍 باشه', 'دکمه'),
('btn_noreason', '⏭ بدون دلیل', 'دکمه'),

('welcome',
 'سلام {name} 👋
من دستیار برنامه‌ی دانشگاهتم.
قبل از هر کلاس بهت یادآوری می‌کنم و تا جواب ندی ولت نمی‌کنم 😄

برای دیدن دستورها /help رو بزن. برای امتحان کردن هم /test.',
 'پیام /start'),

('help',
 '📖 <b>راهنما</b>

/today — برنامه امروز
/tomorrow — برنامه فردا
/week — برنامه هفته
/courses — درس‌ها و تاریخ امتحان‌ها
/pause — توقف موقت (مثلاً <code>/pause 3</code> یعنی ۳ ساعت، <code>/pause day</code> یعنی یک روز)
/resume — شروع دوباره یادآوری‌ها
/test — ساخت یک کلاس تستی برای دیدن یادآوری‌ها (<code>/test full</code> یعنی با یادآوری قبل از کلاس)
/help — همین راهنما

دستورهای بیشتر (افزودن درس، آمار و ...) در مرحله‌های بعدی اضافه می‌شن.',
 'پیام /help'),

('today_title', '📅 <b>امروز — {day}</b>', 'عنوان /today'),
('tomorrow_title', '📅 <b>فردا — {day}</b>', 'عنوان /tomorrow'),
('week_title', '🗓 <b>برنامه هفته</b>', 'عنوان /week'),
('courses_title', '📚 <b>درس‌های ترم</b>', 'عنوان /courses'),
('no_classes', '🎉 کلاسی نداری!', 'روز بدون کلاس'),
('day_free', 'بدون کلاس 🎉', 'روز بدون کلاس در /week'),

('paused', '⏸ همه یادآوری‌ها تا {until} متوقف شد.
برای شروع دوباره: /resume', 'پیام /pause'),
('resumed', '▶️ یادآوری‌ها دوباره فعال شد.', 'پیام /resume'),
('pause_bad_arg', 'عدد ساعت رو درست بنویس. مثال: <code>/pause 3</code> یا <code>/pause day</code>', 'ورودی اشتباه /pause'),
('unknown_text', 'متوجه نشدم 🤔 برای دیدن دستورها /help رو بزن.', 'متن بی‌ربط'),

('test_title', 'کلاس تستی', 'اسم کلاس تستی'),
('test_location', 'اتاق تست', 'مکان کلاس تستی'),
('test_created',
 '🧪 کلاس تستی ساخته شد و {minutes} دقیقه دیگه شروع می‌شه.
یادآوری‌ها و دکمه‌ها دقیقاً مثل کلاس واقعی کار می‌کنن. (این فقط تسته.)',
 'پیام /test');
