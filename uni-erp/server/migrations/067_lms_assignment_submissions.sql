-- حلول الطلاب: صف لكل محاولة، ومسودة واحدة على الأكثر للطالب في الاختبار الواحد.
-- الحذف المتتابع يخص المسودات، أما الاختبار الذي له حلول مسلَّمة فترفض الخدمة حذفه.
CREATE TABLE lms_assignment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','graded')),
  body_text TEXT NOT NULL DEFAULT '',
  is_late INTEGER NOT NULL DEFAULT 0 CHECK (is_late IN (0,1)),
  submitted_at BIGINT,
  score REAL CHECK (score >= 0),
  feedback TEXT NOT NULL DEFAULT '',
  graded_by INTEGER REFERENCES users(id),
  graded_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  UNIQUE (assignment_id, student_id, attempt_no),
  CHECK (status = 'draft' OR submitted_at IS NOT NULL),
  CHECK (status <> 'graded' OR (score IS NOT NULL AND graded_at IS NOT NULL))
);
CREATE UNIQUE INDEX idx_lms_assignment_submissions_draft ON lms_assignment_submissions(assignment_id, student_id) WHERE status = 'draft';
CREATE INDEX idx_lms_assignment_submissions_list ON lms_assignment_submissions(assignment_id, status, submitted_at);
CREATE INDEX idx_lms_assignment_submissions_student ON lms_assignment_submissions(student_id, assignment_id);

-- ملفات الحل (student) وملف التصحيح من المدرّس (feedback).
CREATE TABLE lms_assignment_submission_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES lms_assignment_submissions(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','feedback')),
  filename TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','word','powerpoint','image','zip','video')),
  mime TEXT NOT NULL,
  size BIGINT NOT NULL CHECK (size > 0),
  file TEXT NOT NULL UNIQUE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_lms_assignment_submission_files_submission ON lms_assignment_submission_files(submission_id, role);
