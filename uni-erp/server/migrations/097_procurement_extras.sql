-- المشتريات حسب الواقع: مورد غير معتمد يُكتب اسمه، ومورد مقترح في طلب الشراء، ورمز QR للصنف،
-- وسجل إرسال أمر الشراء إلى المورد، ومرفقات الأمر (فاتورة المورد ومذكرة التسليم وعرض السعر).

-- مورد يُكتب اسمه في أمر الشراء يُسجَّل «غير معتمد» (approved = 0) ليُراجع لاحقاً، وتبقى التقارير والمطابقة تعمل عليه
ALTER TABLE proc_suppliers ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;

-- المورد المقترح في طلب الشراء: من القائمة أو اسماً مكتوباً (لا يُنشأ له سجل قبل أمر الشراء)
ALTER TABLE proc_requests ADD COLUMN supplier_id INTEGER REFERENCES proc_suppliers(id) ON DELETE SET NULL;
ALTER TABLE proc_requests ADD COLUMN supplier_name TEXT;

-- رمز QR للصنف: يُولَّد أو يُقرأ من الملصق الموجود، فريد على مستوى الأصناف
ALTER TABLE proc_items ADD COLUMN qr_code TEXT;
CREATE UNIQUE INDEX idx_proc_items_qr ON proc_items(qr_code) WHERE qr_code IS NOT NULL;

-- كل إرسال لأمر الشراء إلى المورد: القناة والجهة ومن أرسل ومتى
CREATE TABLE proc_order_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES proc_orders(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'fax', 'hand', 'print')),
  recipient TEXT,
  note TEXT,
  sent_by INTEGER REFERENCES users(id),
  sent_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_order_dispatches_order ON proc_order_dispatches(order_id);

-- مرفقات أمر الشراء: فاتورة المورد (PDF أو صورة ممسوحة أو مصوّرة) وغيرها
CREATE TABLE proc_order_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES proc_orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'delivery', 'quote', 'other')),
  orig_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_order_files_order ON proc_order_files(order_id);
