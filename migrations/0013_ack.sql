-- "👍 باشه" on a reminder means: I will go. After it the bot stops asking.

ALTER TABLE occurrences ADD COLUMN acked_at INTEGER;   -- when the person pressed "باشه" (NULL = never)

-- One plain heads-up when the class starts (no buttons, no questions). Turn it off with ack_start_notice = 0.
INSERT OR IGNORE INTO settings (key, value) VALUES ('ack_start_notice', '1');

INSERT OR IGNORE INTO bot_texts (key, text, description) VALUES
('ack_start',   '⏰ <b>{class_name}</b> شروع شد؛ موفق باشی! 🍀', 'پیام شروع کلاس بعد از زدن «باشه» (بدون دکمه و سوال)'),
('ack_toast',   'باشه 👍 دیگه یادآوری و سوالی نمی‌فرستم.',       'پیام کوتاه بعد از زدن «باشه»');
