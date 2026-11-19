-- كشف حضور المحاضرة: المدرّس (أو من يملك إدارة المقررات أو الحضور) يسجّل انعقاد محاضرة المقرر في يوم ويؤشّر الحاضرين.
-- تُحتسب المحاضرة منعقدة ولو لم يمسح أحد بطاقته، ويُحتسب غائباً كل من لم يُؤشَّر ولم يمسح بطاقته في ذلك اليوم.
-- الحضور نفسه يبقى في hall_logs (يدوي بملاحظة «كشف حضور المحاضرة») ليجتمع مع مسح البطاقات في حساب نسبة الغياب.
CREATE TABLE lecture_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  hall TEXT,
  taken_by INTEGER REFERENCES users(id),
  taken_at INTEGER NOT NULL,
  present_count INTEGER NOT NULL DEFAULT 0,
  absent_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (course_id, day)
);
CREATE INDEX idx_lecture_sessions_course ON lecture_sessions(course_id, day);
