-- موعد المحاضرة قد يخص فئة من طلاب المقرر؛ بلا فئة يخصهم جميعاً.
ALTER TABLE course_schedules ADD COLUMN group_id INTEGER;
