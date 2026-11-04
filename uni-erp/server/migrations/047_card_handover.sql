-- تسليم البطاقات الجامعية: كل تصدير بالفلاتر دفعة، ولكل طالب فيها صف يبيّن هل استلم ومتى ومن سلّمه.
CREATE TABLE card_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  filter_json TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE card_handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES card_batches(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  received_at INTEGER,
  receiver_name TEXT NOT NULL DEFAULT '',
  handed_by INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (batch_id, student_id)
);
CREATE INDEX idx_card_handovers_student ON card_handovers(student_id);
