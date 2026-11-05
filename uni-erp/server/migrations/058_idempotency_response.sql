-- منع تكرار العمليات المالية: يُحفظ رد العملية لإعادته عند تكرار الطلب
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS body_hash TEXT;
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS status_code INTEGER;
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response_json TEXT;
