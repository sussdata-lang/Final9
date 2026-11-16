-- مركز الأمان: حجب يدوي لعناوين IP. حالة جدار الحماية في الذاكرة فقط، فيُحفظ الحجب اليدوي هنا
-- ويُعاد تطبيقه عند كل إقلاع حتى لا يسقط بإعادة تشغيل الخادم.
CREATE TABLE security_ip_bans (
  ip TEXT PRIMARY KEY,
  until BIGINT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  banned_by INTEGER,
  banned_at BIGINT NOT NULL
);
CREATE INDEX idx_security_ip_bans_until ON security_ip_bans(until);
