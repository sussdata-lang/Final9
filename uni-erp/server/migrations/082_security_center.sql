-- مركز الأمان: أحداث أمنية لا يحفظها سجل التدقيق (حجب جدار الحماية في الذاكرة)، وتنبيهات قواعد الكشف ومتابعتها
CREATE TABLE security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  ip TEXT,
  user_id INTEGER,
  subject TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_security_events_at ON security_events(at DESC);
CREATE INDEX idx_security_events_kind_at ON security_events(kind, at DESC);

CREATE TABLE security_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT,
  subject TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ack', 'closed')),
  ack_by INTEGER,
  ack_at INTEGER,
  closed_by INTEGER,
  closed_at INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_security_alerts_active ON security_alerts(dedupe_key) WHERE status IN ('open', 'ack');
CREATE INDEX idx_security_alerts_status ON security_alerts(status, last_at DESC);
CREATE INDEX idx_security_alerts_key_closed ON security_alerts(dedupe_key, closed_at DESC);

-- مؤشر آخر صف من سجل التدقيق فُحص بقواعد الأحداث المفردة
CREATE TABLE security_cursor (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
