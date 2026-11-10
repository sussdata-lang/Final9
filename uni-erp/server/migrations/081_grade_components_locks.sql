-- مكونات علامة كل مقرر وأوزانها، وعلامات الطالب في كل مكوّن، وقفل علامات المقرر عند إعلان نتائجه
CREATE TABLE course_grade_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('theory', 'practical')),
  max_mark INTEGER NOT NULL CHECK (max_mark > 0),
  seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_course_grade_components_course ON course_grade_components(course_id, seq);

CREATE TABLE grade_component_marks (
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES course_grade_components(id),
  mark INTEGER NOT NULL CHECK (mark >= 0),
  PRIMARY KEY (grade_id, component_id)
);

CREATE TABLE grade_locks (
  course_id INTEGER NOT NULL REFERENCES courses(id),
  academic_year TEXT NOT NULL,
  locked_by INTEGER,
  locked_at INTEGER NOT NULL,
  PRIMARY KEY (course_id, academic_year)
);
