-- المرحلة 11: طلب الصرف الإلكتروني من الأقسام، والمرتجع من الأقسام إلى المستودع (تقرير المشتريات 5.4)

-- طلب الصرف: يقدّمه موظف القسم، ويعتمده رئيس وحدته، ويصرفه أمين المستودع، ويؤكد المستلم الاستلام
CREATE TABLE proc_issue_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  requester_id INTEGER REFERENCES users(id),
  unit_id INTEGER REFERENCES org_units(id),
  department TEXT NOT NULL DEFAULT '',
  warehouse_id INTEGER NOT NULL REFERENCES proc_warehouses(id),
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'partial', 'issued', 'received', 'rejected', 'cancelled')),
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER,
  decision_note TEXT NOT NULL DEFAULT '',
  received_by INTEGER REFERENCES users(id),
  received_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_issue_requests_status ON proc_issue_requests(status);
CREATE TABLE proc_issue_request_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES proc_issue_requests(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES proc_items(id),
  qty REAL NOT NULL CHECK (qty > 0),
  issued_qty REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
ALTER TABLE proc_issues ADD COLUMN issue_request_id INTEGER REFERENCES proc_issue_requests(id);

-- المرتجع إلى المستودع: مواد صُرفت ولم تُستهلك تعود برصيدها وبقيد عكسي لقيد الصرف
CREATE TABLE proc_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER NOT NULL REFERENCES proc_warehouses(id),
  issue_id INTEGER REFERENCES proc_issues(id),
  department TEXT NOT NULL DEFAULT '',
  returned_by_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  journal_entry_id INTEGER,
  journal_error TEXT
);
CREATE TABLE proc_return_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES proc_returns(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES proc_items(id),
  qty REAL NOT NULL CHECK (qty > 0),
  unit_cost REAL NOT NULL DEFAULT 0,
  item_condition TEXT NOT NULL DEFAULT ''
);
