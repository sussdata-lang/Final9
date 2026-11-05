-- سجل فواتير المبيعات والمشتريات: كانت قيود يومية بلا نوع ولا حالة ولا تتبع للدفع
CREATE TABLE IF NOT EXISTS fin_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('sale','purchase')),
  party_id INTEGER REFERENCES fin_parties(id),
  issue_day TEXT NOT NULL,
  description TEXT NOT NULL,
  total BIGINT NOT NULL CHECK (total > 0),        -- بالوحدة الصغرى كبقية جداول المالية
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  settle_account_id INTEGER NOT NULL REFERENCES fin_accounts(id),   -- الذمم المدينة أو الدائنة
  counter_account_id INTEGER REFERENCES fin_accounts(id),           -- الإيراد أو المصروف
  entry_id INTEGER REFERENCES fin_entries(id),
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_invoices_status ON fin_invoices(status, issue_day);

-- الفواتير السابقة قيود مرحّلة بمرجع INV-: تُنقل كفواتير مبيعات صادرة غير مسددة
INSERT INTO fin_invoices (no, kind, party_id, issue_day, description, total, status, settle_account_id, counter_account_id, entry_id, created_by, created_at)
SELECT e.no, 'sale',
  (SELECT l.party_id FROM fin_lines l WHERE l.entry_id = e.id AND l.debit > 0 ORDER BY l.line_no LIMIT 1),
  e.entry_day, e.description,
  (SELECT SUM(l.debit) FROM fin_lines l WHERE l.entry_id = e.id),
  CASE WHEN e.reversed_by IS NULL THEN 'issued' ELSE 'cancelled' END,
  (SELECT l.account_id FROM fin_lines l WHERE l.entry_id = e.id AND l.debit > 0 ORDER BY l.line_no LIMIT 1),
  (SELECT l.account_id FROM fin_lines l WHERE l.entry_id = e.id AND l.credit > 0 ORDER BY l.line_no LIMIT 1),
  e.id, e.created_by, e.created_at
FROM fin_entries e
WHERE e.type = 'JV' AND e.status = 'posted' AND e.reference LIKE 'INV-%' AND e.reversal_of IS NULL;
