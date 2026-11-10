-- شعب المقررات لكل فصل، وحذف التسجيل دون فقدان أثره، وتصعيد الطلبات المتأخرة، وإيقاف البطاقة الجامعية
CREATE TABLE course_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  term TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  instructor TEXT NOT NULL DEFAULT '',
  hall TEXT NOT NULL DEFAULT '',
  schedule TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (course_id, term, name)
);
CREATE INDEX idx_course_sections_term ON course_sections(term, active);

ALTER TABLE student_self_enrollments ADD COLUMN section_id INTEGER REFERENCES course_sections(id);
ALTER TABLE student_self_enrollments ADD COLUMN dropped_at INTEGER;
CREATE INDEX idx_self_enrollments_section ON student_self_enrollments(section_id);

ALTER TABLE requests ADD COLUMN escalation_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN escalated_at INTEGER;
CREATE INDEX idx_requests_escalation ON requests(status, escalation_level);

CREATE TABLE card_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('lost', 'stolen', 'damaged', 'admin')),
  note TEXT NOT NULL DEFAULT '',
  blocked_at INTEGER NOT NULL,
  blocked_by INTEGER,
  cleared_at INTEGER,
  cleared_by INTEGER,
  clear_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_card_blocks_active ON card_blocks(student_id) WHERE cleared_at IS NULL;
