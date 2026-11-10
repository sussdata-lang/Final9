-- التقويم الأكاديمي، وإلغاء المحاضرات وتعويضها، والحرمان من المقرر بنسبة الغياب
CREATE TABLE academic_calendar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('term', 'registration', 'add_drop', 'exams', 'holiday', 'event')),
  title TEXT NOT NULL,
  start_day TEXT NOT NULL,
  end_day TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (end_day >= start_day)
);
CREATE INDEX idx_academic_calendar_term ON academic_calendar(term, start_day);

CREATE TABLE lecture_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  kind TEXT NOT NULL CHECK (kind IN ('cancel', 'makeup')),
  lecture_day TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  hall TEXT NOT NULL DEFAULT '',
  makeup_day TEXT,
  makeup_start TEXT NOT NULL DEFAULT '',
  makeup_end TEXT NOT NULL DEFAULT '',
  makeup_hall TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_lecture_changes_course ON lecture_changes(course_id, lecture_day);

CREATE TABLE course_deprivations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  term TEXT NOT NULL,
  absence_percent NUMERIC(5,1) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lifted')),
  decided_by INTEGER,
  decided_at INTEGER NOT NULL,
  lifted_by INTEGER,
  lifted_at INTEGER,
  lift_reason TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_course_deprivations_active ON course_deprivations(student_id, course_id, term) WHERE status = 'active';
