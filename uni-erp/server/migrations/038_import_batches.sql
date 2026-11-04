-- الاستيراد الشامل: ملف مفحوص ينتظر قرار «حفظ/إلغاء»، وسجل دفعات وتغييرات يتيح التراجع.
-- الرمز المميز لا يُخزَّن نفسه بل بصمته، والصفوف على أجزاء لأن قناة قاعدة البيانات محدودة بـ 8 ميغابايت للاستجابة.
CREATE TABLE import_staging (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  filename    TEXT NOT NULL DEFAULT '',
  file_sha256 TEXT NOT NULL,
  total_rows  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_import_staging_exp ON import_staging(expires_at);

CREATE TABLE import_staging_chunks (
  token_hash TEXT NOT NULL REFERENCES import_staging(token_hash) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  rows_json  TEXT NOT NULL,
  PRIMARY KEY (token_hash, seq)
);

CREATE TABLE import_batches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  filename     TEXT NOT NULL DEFAULT '',
  file_sha256  TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('staged','committed','undone','undo_blocked')),
  created_at   INTEGER NOT NULL,
  committed_at INTEGER,
  undone_at    INTEGER,
  undone_by    INTEGER REFERENCES users(id),
  summary_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_import_batches_time ON import_batches(committed_at);

CREATE TABLE import_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,
  pk_json     TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  before_json TEXT,
  after_hash  TEXT
);
CREATE INDEX idx_import_changes_batch ON import_changes(batch_id, id);
