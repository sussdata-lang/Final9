-- أنظمة الدراسة: تجديد القيد السنوي، والترفيع السنوي، والتظلم من القرارات الانضباطية
CREATE TABLE sa_enrollment_renewals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  academic_year TEXT NOT NULL,
  level INTEGER,
  late INTEGER NOT NULL DEFAULT 0,
  created_by_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (student_id, academic_year)
);
CREATE TABLE sa_promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  academic_year TEXT NOT NULL,
  from_level INTEGER NOT NULL,
  to_level INTEGER NOT NULL,
  carried INTEGER NOT NULL DEFAULT 0,
  decided_by TEXT,
  decided_by_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (student_id, academic_year)
);
CREATE TABLE sa_disciplinary_appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appeal_no TEXT NOT NULL UNIQUE,
  hold_id INTEGER NOT NULL UNIQUE,
  student_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'reduced', 'cancelled')),
  decision_note TEXT,
  decided_by TEXT,
  decided_by_id INTEGER,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sa_appeals_student ON sa_disciplinary_appeals(student_id);
