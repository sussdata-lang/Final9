-- المجالس واللجان: التشكيل، والاجتماعات وجدول أعمالها، والقرارات بالتصويت والتنحي، ومهام تنفيذ القرارات
CREATE TABLE councils (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('council', 'committee')),
  unit_id INTEGER REFERENCES org_units(id),
  quorum_percent INTEGER NOT NULL DEFAULT 50 CHECK (quorum_percent BETWEEN 1 AND 100),
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE council_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id INTEGER NOT NULL REFERENCES councils(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('chair', 'deputy', 'rapporteur', 'secretary', 'member')),
  voting INTEGER NOT NULL DEFAULT 1,
  from_day TEXT NOT NULL,
  to_day TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_council_members_active ON council_members(council_id, user_id) WHERE active = 1;
CREATE INDEX idx_council_members_user ON council_members(user_id);
CREATE TABLE council_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id INTEGER NOT NULL REFERENCES councils(id),
  no TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  meeting_at BIGINT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'held', 'closed', 'cancelled')),
  minutes TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  closed_by INTEGER,
  closed_at INTEGER
);
CREATE INDEX idx_council_meetings_council ON council_meetings(council_id, meeting_at);
CREATE TABLE council_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES council_meetings(id),
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'decided', 'deferred')),
  outcome TEXT CHECK (outcome IN ('approved', 'rejected', 'deferred')),
  decision_no TEXT UNIQUE,
  decision_text TEXT NOT NULL DEFAULT '',
  votes_for INTEGER NOT NULL DEFAULT 0,
  votes_against INTEGER NOT NULL DEFAULT 0,
  votes_abstain INTEGER NOT NULL DEFAULT 0,
  decided_by INTEGER,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_council_items_meeting ON council_items(meeting_id, seq);
CREATE TABLE council_attendance (
  meeting_id INTEGER NOT NULL REFERENCES council_meetings(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  present INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (meeting_id, user_id)
);
CREATE TABLE council_recusals (
  item_id INTEGER NOT NULL REFERENCES council_items(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, user_id)
);
CREATE TABLE council_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES council_items(id),
  assignee_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  due_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_note TEXT NOT NULL DEFAULT '',
  done_at INTEGER,
  done_by INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_council_tasks_assignee ON council_tasks(assignee_id, status);
