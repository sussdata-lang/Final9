-- ====================================================================
-- 027_devops_incidents.sql
-- جدول تقارير وبلاغات أخطاء استوديو الكود والبنية التحتية لوحدة DevOps
-- ====================================================================

CREATE TABLE IF NOT EXISTS devops_incident_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_code TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  file_path TEXT,
  error_message TEXT NOT NULL,
  error_details TEXT,
  client_context TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_at INTEGER,
  resolved_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devops_incidents_status ON devops_incident_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_devops_incidents_severity ON devops_incident_reports(severity, created_at);

-- بيانات أولية لاختبار جاهزية وحدة DevOps
INSERT OR IGNORE INTO devops_incident_reports 
(report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, resolution_note, resolved_at, resolved_by, created_at)
VALUES 
('INC-2026-1001', 'DevOps Monitor', 'SYNTAX_CHECK', 'warning', 'public/v12_views.js', 'تحذير أداء: حجم حزمة جافاسكربت تجاوزت 80KB', 'Bundle analyzer warning for client bundle', '{"engine":"V8","platform":"Linux"}', 'resolved', 'تم تفعيل ضغط Gzip والتخزين المؤقت في سيرفر Express', 1793000000000, 'مهندس البنية التحتية', 1792980000000),
('INC-2026-1002', 'Storage Engine', 'WAL_CHECKPOINT', 'info', 'data/uni-erp.db', 'تنفيذ نقطة تفتيش WAL دورية لقاعدة البيانات', 'PRAGMA wal_checkpoint(PASSIVE) executed successfully', '{"daemon":"sqlite-wal"}', 'resolved', 'اكتملت المزامنة بنجاح', 1793010000000, 'النظام الآلي', 1793005000000);
