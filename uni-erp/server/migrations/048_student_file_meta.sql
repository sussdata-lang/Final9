-- بنود إضافية على ملف الطالب، كلها اختيارية، مع حالة «تم التدقيق» ومن دقّقه.
CREATE TABLE student_file_meta (
  student_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  general_notes TEXT NOT NULL DEFAULT '',
  box_no TEXT NOT NULL DEFAULT '',
  dossier_no TEXT NOT NULL DEFAULT '',
  cert_notes TEXT NOT NULL DEFAULT '',
  exception_note TEXT NOT NULL DEFAULT '',
  audited INTEGER NOT NULL DEFAULT 0,
  audited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  audited_at INTEGER,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER
);
