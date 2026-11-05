-- سلسلة التدقيق لا تتفرع مع تعدد العمليات: كل صف جديد يحجز البصمة السابقة في عمود فريد.
-- الصفوف القديمة تبقى NULL، فلا يمنع أي تكرار فيها إقلاع الخادم.
DROP INDEX IF EXISTS idx_audit_log_prev_hash;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS chain_prev TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_chain_prev ON audit_log(chain_prev);
