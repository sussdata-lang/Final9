-- تخصص عضو الهيئة التدريسية: مواد من النظام يرتبط بها بشكل دائم (غير إسناد الفصل الذي في courses.member_id)،
-- ولكل ربط نوع تدريس (نظري، تطبيقات عملية، تدريبات مخبرية، ميداني وشرطي، عسكري وأمني وبدني)
CREATE TABLE faculty_specialties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES faculty_members(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teaching_kind TEXT NOT NULL CHECK (teaching_kind IN ('theory', 'practical', 'lab', 'field', 'military')),
  created_at INTEGER NOT NULL,
  UNIQUE (member_id, course_id, teaching_kind)
);
CREATE INDEX idx_faculty_specialties_course ON faculty_specialties(course_id);
