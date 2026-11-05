-- تعدد العمليات: آخر نشاط للجلسة مشترك بين العمليات
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen BIGINT;
