-- Phase 4, step 3: goals per category, challenges per category, what the partner may see, work-friendly messages.

-- A challenge can be about one category (study, work, ...) or about everything (NULL = all, like before).
ALTER TABLE challenges ADD COLUMN category_id INTEGER;

-- Daily / weekly goal per category in minutes (NULL = no goal).
ALTER TABLE categories ADD COLUMN daily_goal_minutes  INTEGER;
ALTER TABLE categories ADD COLUMN weekly_goal_minutes INTEGER;

-- 0 = the partner does not see this category's minutes or name (she only sees "busy").
ALTER TABLE categories ADD COLUMN share_with_partner INTEGER NOT NULL DEFAULT 1;

-- Messages that work for any activity: {activity} becomes the name of the category (study, work, ...).
INSERT INTO message_templates (category, time_condition, message_text, created_by, is_active) VALUES
('user_slacking',     'after_2_hours_idle',  'آژیر قرمز: {hours} ساعته سراغ «{activity}» نرفتم. بیا یه تلنگر بزن!', 'user', 1),
('user_slacking',     'manual',              'هشدار: امروز هنوز سراغ «{activity}» نرفتم و کمک لازم دارم. بیا نجاتم بده!', 'user', 1),
('user_studied_hard', 'after_4_hours_study', 'گزارش: امروز {hours} ساعت «{activity}» کردم و نیاز به روحیه دارم! 💪', 'user', 1),
('user_studied_hard', 'manual',              'مأموریت «{activity}» انجام شد! الان رسماً نیازمند لوس شدن هستم.', 'user', 1);
