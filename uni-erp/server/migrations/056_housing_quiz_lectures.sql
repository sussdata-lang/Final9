-- السكن الجامعي: المباني بقسم للذكور أو الإناث، والهيكلية الأساسية: 3 مبانٍ في كل منها 50 غرفة، وتُعدَّل من الشاشة
CREATE TABLE dorm_buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  gender TEXT NOT NULL DEFAULT 'ذكور' CHECK (gender IN ('ذكور', 'إناث')),
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO dorm_buildings (name, gender) VALUES ('المبنى A', 'ذكور'), ('المبنى B', 'ذكور'), ('المبنى C', 'إناث');
INSERT INTO dorm_buildings (name, gender)
  SELECT DISTINCT building_name, 'ذكور' FROM dorm_rooms WHERE building_name NOT IN (SELECT name FROM dorm_buildings);
INSERT INTO dorm_rooms (building_name, room_no, floor_no, capacity, occupied, room_type, annual_fee, status)
  SELECT b.name, (f * 100 + r)::text, f, 4, 0, 'رباعية', 0, 'متاحة'
  FROM dorm_buildings b CROSS JOIN generate_series(1, 5) f CROSS JOIN generate_series(1, 10) r
  WHERE b.name IN ('المبنى A', 'المبنى B', 'المبنى C');
CREATE UNIQUE INDEX IF NOT EXISTS uq_dorm_room ON dorm_rooms(building_name, room_no);
CREATE INDEX IF NOT EXISTS idx_dorm_alloc_student ON dorm_allocations(student_no, status);

-- المواد والمعدات المسلمة لكل طالب في السكن
CREATE TABLE housing_handouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handout_no TEXT NOT NULL UNIQUE,
  student_no TEXT NOT NULL REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE RESTRICT,
  student_name TEXT NOT NULL DEFAULT '',
  faculty_name TEXT NOT NULL DEFAULT '',
  room_label TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  handed_day TEXT NOT NULL,
  returned_day TEXT,
  handed_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_handouts_student ON housing_handouts(student_no);

-- الاختبارات: أسئلة منظمة، ودورة إعداد واعتماد ونشر
ALTER TABLE lms_quizzes ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE lms_quizzes ADD COLUMN faculty_name TEXT NOT NULL DEFAULT '';
ALTER TABLE lms_quizzes ADD COLUMN exam_day TEXT;
ALTER TABLE lms_quizzes ADD COLUMN publish_at BIGINT;
ALTER TABLE lms_quizzes ADD COLUMN close_at BIGINT;
ALTER TABLE lms_quizzes ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE lms_quizzes ADD COLUMN approved_by TEXT;
ALTER TABLE lms_quizzes ADD COLUMN approved_at BIGINT;
ALTER TABLE lms_quizzes ADD COLUMN rejection_note TEXT;
ALTER TABLE lms_quizzes ADD COLUMN created_by BIGINT;
CREATE TABLE lms_quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES lms_quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single', 'multi', 'essay')),
  text TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  correct_json TEXT NOT NULL DEFAULT '[]',
  marks NUMERIC(8,2) NOT NULL DEFAULT 1
);
CREATE INDEX idx_quiz_questions ON lms_quiz_questions(quiz_id, position);
CREATE TABLE lms_quiz_attempts (
  quiz_id INTEGER NOT NULL REFERENCES lms_quizzes(id) ON DELETE CASCADE,
  student_no TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  PRIMARY KEY (quiz_id, student_no)
);
ALTER TABLE lms_quiz_submissions ADD COLUMN essay_marks_json TEXT;
ALTER TABLE lms_quiz_submissions ADD COLUMN needs_grading INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lms_quiz_submissions ADD COLUMN graded_by TEXT;
ALTER TABLE lms_quiz_submissions ALTER COLUMN total_marks TYPE NUMERIC(8,2);

-- المحاضرات: لمن تُرسل
ALTER TABLE lms_lectures ADD COLUMN target_faculty TEXT NOT NULL DEFAULT '';
ALTER TABLE lms_lectures ADD COLUMN target_group_id BIGINT REFERENCES student_groups(id) ON DELETE SET NULL;
