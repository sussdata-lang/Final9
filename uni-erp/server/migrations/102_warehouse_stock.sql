-- المرحلة 9: الرصيد لكل مستودع والتحويل بين المستودعات (تقرير المشتريات 4.3 و13.12)

-- رصيد الصنف في كل مستودع؛ رصيد الصنف الكلي (proc_items.qty_on_hand) = مجموع أرصدته في المستودعات
CREATE TABLE proc_item_stock (
  item_id INTEGER NOT NULL REFERENCES proc_items(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES proc_warehouses(id),
  qty REAL NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (item_id, warehouse_id)
);
CREATE INDEX idx_proc_item_stock_wh ON proc_item_stock(warehouse_id);

-- مستودع الاستلام على السند
ALTER TABLE proc_receipts ADD COLUMN warehouse_id INTEGER REFERENCES proc_warehouses(id);

-- سند تحويل بخطوتين: إخراج من المستودع المرسِل (قيد النقل) ثم استلام في المستودع المستلِم بيد شخص آخر
CREATE TABLE proc_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  from_wh INTEGER NOT NULL REFERENCES proc_warehouses(id),
  to_wh INTEGER NOT NULL REFERENCES proc_warehouses(id),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'received', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  sent_by INTEGER REFERENCES users(id),
  sent_at INTEGER NOT NULL,
  received_by INTEGER REFERENCES users(id),
  received_at INTEGER,
  receive_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE proc_transfer_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES proc_transfers(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES proc_items(id),
  qty REAL NOT NULL CHECK (qty > 0),
  unit_cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_proc_transfer_lines_t ON proc_transfer_lines(transfer_id);

-- ترحيل الأرصدة القائمة: صنف له رصيد بلا مستودع يُنسب إلى أول مستودع (ويُنشأ «المستودع الافتراضي» إن لم يوجد أي مستودع)
INSERT INTO proc_warehouses (code, name, location, created_at)
SELECT 'WH-DEFAULT', 'المستودع الافتراضي', '', strftime('%s', 'now') * 1000
WHERE EXISTS (SELECT 1 FROM proc_items WHERE qty_on_hand <> 0) AND NOT EXISTS (SELECT 1 FROM proc_warehouses);
UPDATE proc_items SET warehouse_id = (SELECT MIN(id) FROM proc_warehouses) WHERE warehouse_id IS NULL AND qty_on_hand <> 0;
INSERT INTO proc_item_stock (item_id, warehouse_id, qty) SELECT id, warehouse_id, qty_on_hand FROM proc_items WHERE qty_on_hand > 0 AND warehouse_id IS NOT NULL;
UPDATE proc_stock_moves SET warehouse_id = (SELECT i.warehouse_id FROM proc_items i WHERE i.id = proc_stock_moves.item_id) WHERE warehouse_id IS NULL;
