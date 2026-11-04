-- إضافة fingerprint لجدول الجلسات (منع اختطاف الجلسات)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fingerprint TEXT;

-- جدول Idempotency Keys للعمليات المالية
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT PRIMARY KEY,
  entry_id    BIGINT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
