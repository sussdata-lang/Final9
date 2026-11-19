-- طبقة المنصة المشتركة لكل الوحدات: النقاش وتتبع التغييرات على أي سجل، والمتابعون،
-- والأنشطة والمهام، ومحرك الموافقات العام، وقواعد الأتمتة التي يعرّفها المدير.
-- السجل يُعرَّف بالزوج (model, res_id)؛ أسماء النماذج المسموحة في services/platform/records.js.

-- سجل النقاش على السجل: تعليق (يُشعر المتابعين)، ملاحظة داخلية (بلا إشعار)،
-- تغيير حقل متتبَّع (tracking)، حدث من النظام (system)
CREATE TABLE record_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  res_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'note', 'tracking', 'system')),
  body TEXT NOT NULL DEFAULT '',
  tracking_json TEXT NOT NULL DEFAULT '[]',
  author_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_record_messages_rec ON record_messages(model, res_id, id);

CREATE TABLE record_followers (
  model TEXT NOT NULL,
  res_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (model, res_id, user_id)
);
CREATE INDEX idx_record_followers_user ON record_followers(user_id);

-- الأنشطة والمهام: مرتبطة بسجل أو مستقلة (شخصية أو مسندة إلى زميل)
CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT,
  res_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'todo' CHECK (kind IN ('todo', 'call', 'meeting', 'review', 'deadline')),
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER NOT NULL REFERENCES users(id),
  creator_id INTEGER NOT NULL REFERENCES users(id),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  done_note TEXT NOT NULL DEFAULT '',
  done_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK ((model IS NULL) = (res_id IS NULL))
);
CREATE INDEX idx_activities_assignee ON activities(assignee_id, status, due_date);
CREATE INDEX idx_activities_creator ON activities(creator_id, status);
CREATE INDEX idx_activities_rec ON activities(model, res_id);

-- محرك الموافقات العام: أنواع موافقة يعرّفها المدير، ولكل نوع خطوات مرتبة.
-- الخطوة تنطبق فقط إن بلغ مبلغ الطلب min_amount.
CREATE TABLE approval_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'sequential' CHECK (mode IN ('sequential', 'parallel')),
  amount_required INTEGER NOT NULL DEFAULT 0 CHECK (amount_required IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- أنواع المعتمد: مستخدم بعينه، أو أي حامل لصلاحية، أو رئيس وحدة مقدّم الطلب
CREATE TABLE approval_type_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type_id INTEGER NOT NULL REFERENCES approval_types(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  approver_kind TEXT NOT NULL CHECK (approver_kind IN ('user', 'permission', 'unit_head')),
  approver_user_id INTEGER REFERENCES users(id),
  approver_perm TEXT,
  min_amount INTEGER NOT NULL DEFAULT 0,
  UNIQUE (type_id, seq)
);

CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  type_id INTEGER NOT NULL REFERENCES approval_types(id),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  amount INTEGER,
  model TEXT,
  res_id INTEGER,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX idx_approval_requests_requester ON approval_requests(requester_id, status);
CREATE INDEX idx_approval_requests_status ON approval_requests(status, created_at);

-- نسخة من خطوات النوع لحظة التقديم: تعديل النوع لاحقاً لا يغيّر الطلبات القائمة
CREATE TABLE approval_request_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  approver_kind TEXT NOT NULL CHECK (approver_kind IN ('user', 'permission')),
  approver_user_id INTEGER REFERENCES users(id),
  approver_perm TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  pending_since INTEGER,
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (request_id, seq)
);
CREATE INDEX idx_approval_steps_pending ON approval_request_steps(status, approver_user_id);

-- الأتمتة: قاعدة تنطلق عند حدث في النظام أو في الفحص الدوري كل ساعة، فتنفّذ إجراءً محدوداً
-- (إشعار، أو إنشاء نشاط، أو ملاحظة على السجل). لا تنفّذ أي كود يدخله المستخدم.
CREATE TABLE automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('event', 'schedule')),
  event TEXT NOT NULL,
  condition_json TEXT NOT NULL DEFAULT '{}',
  action TEXT NOT NULL CHECK (action IN ('notify', 'create_activity', 'post_note')),
  action_json TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0
);

-- سجل التنفيذ؛ الفهرس الفريد يمنع تنفيذ القاعدة المجدولة مرتين على السجل نفسه
CREATE TABLE automation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_automation_log_once ON automation_log(rule_id, ref);
