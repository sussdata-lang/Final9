-- سلسلة اعتماد حركات القيد: لا تتغير حالة الطالب إلا بعد القرار النهائي. الحركات السابقة تبقى معتمدة كما هي.
ALTER TABLE sa_lifecycle_movements ADD COLUMN request_id INTEGER;
ALTER TABLE sa_lifecycle_movements ADD COLUMN created_by_id INTEGER;
ALTER TABLE sa_lifecycle_movements ADD COLUMN current_step INTEGER;
ALTER TABLE sa_lifecycle_movements ADD COLUMN decided_at INTEGER;
ALTER TABLE sa_lifecycle_movements ADD COLUMN reject_reason TEXT;

CREATE TABLE IF NOT EXISTS sa_movement_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id INTEGER NOT NULL REFERENCES sa_lifecycle_movements(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'not_applicable')),
  decided_by INTEGER,
  decided_by_name TEXT,
  decided_at INTEGER,
  note TEXT,
  UNIQUE (movement_id, step_no)
);
CREATE INDEX IF NOT EXISTS idx_sa_movement_steps_status ON sa_movement_steps(status, step_key);
CREATE INDEX IF NOT EXISTS idx_sa_movements_pending ON sa_lifecycle_movements(status, student_id);
CREATE INDEX IF NOT EXISTS idx_sa_movements_request ON sa_lifecycle_movements(request_id);
