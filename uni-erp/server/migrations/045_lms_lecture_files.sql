-- مرفقات المحاضرات: pdf وفيديو وعروض pptx. الملف على القرص، وشرائح العرض محفوظة هنا بعد تحويلها.
CREATE TABLE lms_lecture_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lecture_id INTEGER NOT NULL REFERENCES lms_lectures(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('pdf','video','slides')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  file TEXT NOT NULL,
  slides_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_lms_lecture_files_lecture ON lms_lecture_files(lecture_id);
