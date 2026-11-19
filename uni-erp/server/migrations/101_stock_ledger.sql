-- المرحلة 8: دفتر الحركات المخزنية (تقرير المشتريات 4.7)
-- كل تغيّر في رصيد صنف يُكتب سطراً هنا مع الرصيد بعده ومرجعه، فتُبنى منه بطاقة الصنف والرصيد في أي تاريخ سابق.
CREATE TABLE proc_stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES proc_items(id) ON DELETE CASCADE,
  warehouse_id INTEGER REFERENCES proc_warehouses(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'receipt', 'issue', 'adjust', 'reversal', 'transfer_out', 'transfer_in', 'return')),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  balance_after REAL NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  ref_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_stock_moves_item ON proc_stock_moves(item_id, id);
CREATE INDEX idx_proc_stock_moves_at ON proc_stock_moves(created_at);
CREATE INDEX idx_proc_stock_moves_ref ON proc_stock_moves(ref_type, ref_id);

-- رصيد افتتاحي لكل صنف له رصيد عند تفعيل الدفتر، فيطابق الدفتر الأرصدة الحالية من أول يوم
INSERT INTO proc_stock_moves (item_id, warehouse_id, kind, qty, unit_cost, balance_after, ref_type, note, created_at)
SELECT id, warehouse_id, 'opening', qty_on_hand, avg_cost, qty_on_hand, 'opening', 'رصيد افتتاحي عند تفعيل دفتر الحركات', strftime('%s', 'now') * 1000
FROM proc_items WHERE qty_on_hand <> 0;
