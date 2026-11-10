-- ربط ملف الموظف بحسابه في المنظومة، ومراحل اعتماد طلب الشراء حسب المبلغ
ALTER TABLE hr_employees ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
UPDATE hr_employees SET user_id = (SELECT u.id FROM users u WHERE u.username = hr_employees.employeeNo LIMIT 1) WHERE user_id IS NULL;
CREATE INDEX idx_hr_employees_user ON hr_employees(user_id);

CREATE TABLE proc_request_approvals (
  request_id INTEGER NOT NULL REFERENCES proc_requests(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  user_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (request_id, level)
);
