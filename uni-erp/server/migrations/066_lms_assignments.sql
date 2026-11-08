-- الاختبارات والتكليفات: يعدّها عضو الهيئة وينشرها لجمهور محدد، ويسلّم الطلاب حلولهم عليها.
-- الجمهور يُحسب وقت العرض من جدول الأهداف، فلا تُنسخ قوائم الطلاب. مختلفة عن lms_quizzes (أسئلة بمؤقت وتصحيح آلي).
CREATE TABLE lms_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'assignment' CHECK (kind IN ('exam','assignment')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  starts_at BIGINT NOT NULL,
  due_at BIGINT NOT NULL,
  late_until BIGINT,
  max_score REAL NOT NULL CHECK (max_score > 0),
  submission_mode TEXT NOT NULL DEFAULT 'both' CHECK (submission_mode IN ('text','files','both')),
  allowed_types_json TEXT NOT NULL DEFAULT '[]',
  max_file_bytes BIGINT NOT NULL DEFAULT 20971520 CHECK (max_file_bytes > 0),
  max_files INTEGER NOT NULL DEFAULT 5 CHECK (max_files BETWEEN 1 AND 20),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 20),
  allow_edit INTEGER NOT NULL DEFAULT 0 CHECK (allow_edit IN (0,1)),
  allow_late INTEGER NOT NULL DEFAULT 0 CHECK (allow_late IN (0,1)),
  video_provider TEXT CHECK (video_provider IN ('youtube','drive')),
  video_ref TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','closed')),
  published_at BIGINT,
  reminder_sent_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  CHECK (due_at > starts_at),
  CHECK (late_until IS NULL OR (allow_late = 1 AND late_until >= due_at)),
  CHECK ((video_provider IS NULL) = (video_ref IS NULL))
);
CREATE INDEX idx_lms_assignments_owner ON lms_assignments(owner_id, status);
CREATE INDEX idx_lms_assignments_status_due ON lms_assignments(status, due_at);
CREATE INDEX idx_lms_assignments_course ON lms_assignments(course_id) WHERE course_id IS NOT NULL;

-- مرفقات المدرّس: الملف على القرص باسم عشوائي، ولا يُخزَّن شيء منه في القاعدة.
CREATE TABLE lms_assignment_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','word','powerpoint','image','zip','video')),
  mime TEXT NOT NULL,
  size BIGINT NOT NULL CHECK (size > 0),
  file TEXT NOT NULL UNIQUE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_lms_assignment_files_assignment ON lms_assignment_files(assignment_id);

-- الجمهور: هدف واحد في كل صف، والأهداف المعلّقة لا تُحسب حتى تُعتمد.
CREATE TABLE lms_assignment_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('group','program','faculty','all')),
  group_id INTEGER REFERENCES student_groups(id) ON DELETE CASCADE,
  program_id INTEGER REFERENCES programs(id) ON DELETE CASCADE,
  faculty_id INTEGER REFERENCES faculties(id) ON DELETE CASCADE,
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved','pending','rejected')),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id),
  decided_at BIGINT,
  created_at BIGINT NOT NULL,
  CHECK (
    (target_type = 'group' AND group_id IS NOT NULL AND program_id IS NULL AND faculty_id IS NULL) OR
    (target_type = 'program' AND program_id IS NOT NULL AND group_id IS NULL AND faculty_id IS NULL) OR
    (target_type = 'faculty' AND faculty_id IS NOT NULL AND group_id IS NULL AND program_id IS NULL) OR
    (target_type = 'all' AND group_id IS NULL AND program_id IS NULL AND faculty_id IS NULL)
  )
);
CREATE UNIQUE INDEX idx_lms_assignment_targets_group ON lms_assignment_targets(assignment_id, group_id) WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX idx_lms_assignment_targets_program ON lms_assignment_targets(assignment_id, program_id) WHERE program_id IS NOT NULL;
CREATE UNIQUE INDEX idx_lms_assignment_targets_faculty ON lms_assignment_targets(assignment_id, faculty_id) WHERE faculty_id IS NOT NULL;
CREATE UNIQUE INDEX idx_lms_assignment_targets_all ON lms_assignment_targets(assignment_id) WHERE target_type = 'all';
CREATE INDEX idx_lms_assignment_targets_by_group ON lms_assignment_targets(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_lms_assignment_targets_by_program ON lms_assignment_targets(program_id) WHERE program_id IS NOT NULL;
CREATE INDEX idx_lms_assignment_targets_by_faculty ON lms_assignment_targets(faculty_id) WHERE faculty_id IS NOT NULL;
CREATE INDEX idx_lms_assignment_targets_pending ON lms_assignment_targets(approval_status) WHERE approval_status = 'pending';
