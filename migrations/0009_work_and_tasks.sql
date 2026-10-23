-- Phase 4, step 4: work events in the weekly schedule, tasks that belong to a category and can be timed.

-- A "course" is either a class or a work event (shift, meeting, ...). Work events skip exams and absence limits.
ALTER TABLE courses     ADD COLUMN kind TEXT NOT NULL DEFAULT 'class';   -- class | work
ALTER TABLE occurrences ADD COLUMN kind TEXT NOT NULL DEFAULT 'class';   -- copied from the course when the day is generated

-- Tasks: category, time estimate, optional repeat.
ALTER TABLE tasks ADD COLUMN category_id  INTEGER;
ALTER TABLE tasks ADD COLUMN estimate_min INTEGER;
ALTER TABLE tasks ADD COLUMN repeat       TEXT;                          -- NULL | daily | weekly | monthly (every 30 days)

-- A timer / session can belong to a task, so time spent per task adds up.
ALTER TABLE study_sessions ADD COLUMN task_id INTEGER;
ALTER TABLE study_timer    ADD COLUMN task_id INTEGER;
CREATE INDEX idx_study_task ON study_sessions(task_id);
