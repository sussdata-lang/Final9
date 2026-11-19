-- المرحلة 13: الأصول الثابتة — من الشراء، والإهلاك، والإتلاف باعتماد وقيد، والعهدة والجرد الدوري (تقرير المشتريات 7.1-7.3 و13.14)

-- بيانات الأصل: الرقم التسلسلي، ومصدره من الشراء، والعهدة بمستخدم، والإهلاك بالقسط الثابت
ALTER TABLE proc_assets ADD COLUMN serial_no TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_assets ADD COLUMN order_id INTEGER REFERENCES proc_orders(id);
ALTER TABLE proc_assets ADD COLUMN receipt_id INTEGER REFERENCES proc_receipts(id);
ALTER TABLE proc_assets ADD COLUMN assigned_user_id INTEGER REFERENCES users(id);
ALTER TABLE proc_assets ADD COLUMN useful_life_months INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proc_assets ADD COLUMN salvage_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proc_assets ADD COLUMN depreciation_start TEXT;
ALTER TABLE proc_assets ADD COLUMN accumulated_dep INTEGER NOT NULL DEFAULT 0;
-- الإتلاف بخطوتين: طلب بسبب ثم اعتماد شخص آخر، وقيده
ALTER TABLE proc_assets ADD COLUMN disposal_reason TEXT;
ALTER TABLE proc_assets ADD COLUMN disposal_requested_by INTEGER REFERENCES users(id);
ALTER TABLE proc_assets ADD COLUMN disposal_requested_at INTEGER;
ALTER TABLE proc_assets ADD COLUMN disposed_by INTEGER REFERENCES users(id);
ALTER TABLE proc_assets ADD COLUMN disposed_at INTEGER;
ALTER TABLE proc_assets ADD COLUMN disposal_entry_id INTEGER;
ALTER TABLE proc_assets ADD COLUMN disposal_error TEXT;
-- آخر جرد فعلي للأصل
ALTER TABLE proc_assets ADD COLUMN last_verified_at INTEGER;
ALTER TABLE proc_assets ADD COLUMN last_verified_by INTEGER REFERENCES users(id);

-- قسط الإهلاك الشهري لكل أصل (مرة واحدة لكل شهر) وقيد الشهر
CREATE TABLE proc_asset_depreciation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES proc_assets(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL,
  entry_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE (asset_id, period)
);

-- محاضر الجرد الدوري للأصول: موجود في موقعه أو مفقود
CREATE TABLE proc_asset_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES proc_assets(id) ON DELETE CASCADE,
  found INTEGER NOT NULL DEFAULT 1,
  location_ok INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  checked_by INTEGER REFERENCES users(id),
  checked_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_asset_checks_asset ON proc_asset_checks(asset_id, id);
