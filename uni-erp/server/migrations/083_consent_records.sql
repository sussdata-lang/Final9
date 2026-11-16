-- سجل الموافقات على معالجة البيانات الشخصية لأغراض محددة (نشر الصور، المشاركة الخارجية، ...).
-- كل صف حدث منح أو سحب؛ آخر صف لكل (المستخدم، الغرض) هو الحالة الحالية، فيبقى تاريخ التغييرات كاملاً.
CREATE TABLE consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES users(id),
  purpose_code TEXT NOT NULL,
  granted INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  recorded_by INTEGER,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX idx_consent_records_subject ON consent_records(subject_id, purpose_code, id DESC);
