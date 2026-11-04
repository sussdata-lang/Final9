-- فئات الطلاب: مجموعات للمحاضرات والمختبرات والامتحانات تُنشأ من الطلاب الموجودين، وتُربط بجدول الامتحانات وجلسات القاعات.
CREATE TABLE IF NOT EXISTS student_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'lecture',
  program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS student_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  UNIQUE (group_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_student_group_members_student ON student_group_members(student_id);

ALTER TABLE exam_schedules ADD COLUMN group_id INTEGER;
