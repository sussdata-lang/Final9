-- مركز الأمان: تذكير المسؤولين بالتنبيهات العالية والحرجة التي بقيت دون استلام
ALTER TABLE security_alerts ADD COLUMN reminded_at INTEGER;
ALTER TABLE security_alerts ADD COLUMN reminders INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_security_alerts_remind ON security_alerts(status, reminded_at);
