-- المرحلة 12: التصنيفات الهرمية والوحدات والتحويل والكميات العشرية (تقرير المشتريات 6.1 و6.2 و6.3)

-- الكميات عشرية (كغ، ليتر، متر)؛ الوحدة تقرر هل تقبل الكسور
ALTER TABLE proc_items ALTER COLUMN qty_on_hand TYPE REAL;
ALTER TABLE proc_items ALTER COLUMN min_stock TYPE REAL;
ALTER TABLE proc_items ALTER COLUMN max_stock TYPE REAL;
ALTER TABLE proc_request_lines ALTER COLUMN qty TYPE REAL;
ALTER TABLE proc_request_lines ALTER COLUMN stock_balance TYPE REAL;
ALTER TABLE proc_order_lines ALTER COLUMN qty TYPE REAL;
ALTER TABLE proc_receipt_lines ALTER COLUMN qty TYPE REAL;
ALTER TABLE proc_receipt_lines ALTER COLUMN expected_qty TYPE REAL;
ALTER TABLE proc_issue_lines ALTER COLUMN qty TYPE REAL;
ALTER TABLE proc_issue_lines ALTER COLUMN requested_qty TYPE REAL;
ALTER TABLE proc_issue_lines ALTER COLUMN balance_after TYPE REAL;

-- دليل الوحدات: وحدة تقبل الكسور أو لا، وتحويل عام اختياري إلى وحدة أساس (1 غرام = 0.001 كغ)
CREATE TABLE proc_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  fractional INTEGER NOT NULL DEFAULT 0,
  base_name TEXT,
  factor REAL NOT NULL DEFAULT 1 CHECK (factor > 0),
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO proc_units (name, fractional) VALUES
  ('قطعة', 0), ('علبة', 0), ('رزمة', 0), ('كرتونة', 0), ('عبوة', 0), ('لفة', 0), ('جهاز', 0), ('طقم', 0), ('حزمة', 0),
  ('كغ', 1), ('ليتر', 1), ('متر', 1), ('متر مربع', 1);
INSERT INTO proc_units (name, fractional, base_name, factor) VALUES ('غرام', 1, 'كغ', 0.001), ('مليلتر', 1, 'ليتر', 0.001), ('سنتيمتر', 1, 'متر', 0.01);
-- وحدات الأصناف القائمة تُضاف إلى الدليل (بلا كسور) كي لا يُرفض صنف قديم
INSERT INTO proc_units (name, fractional) SELECT DISTINCT TRIM(unit), 0 FROM proc_items WHERE TRIM(COALESCE(unit, '')) <> '' AND TRIM(unit) NOT IN (SELECT name FROM proc_units);

-- تحويل خاص بالصنف: «1 علبة = 12 من وحدة الصنف»؛ يُستعمل عند الشراء بوحدة والتخزين بأخرى
CREATE TABLE proc_item_units (
  item_id INTEGER NOT NULL REFERENCES proc_items(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  factor REAL NOT NULL CHECK (factor > 0),
  PRIMARY KEY (item_id, unit_name)
);

-- شجرة التصنيفات: تصنيف أب، ورمز التصنيف بادئةً لترقيم أصنافه تلقائياً (CAT-IT-0001)
ALTER TABLE proc_categories ADD COLUMN parent_id INTEGER REFERENCES proc_categories(id);
