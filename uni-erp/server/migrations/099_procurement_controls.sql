-- المرحلة 6: ضوابط دورة الشراء العاجلة (تقرير فحص المشتريات والمخازن)

-- أمر توريد مباشر بلا طلب شراء: سبب مكتوب، ولا يُرسل إلا باعتماد شخص آخر غير منشئه
ALTER TABLE proc_orders ADD COLUMN direct_reason TEXT;
ALTER TABLE proc_orders ADD COLUMN direct_approved_by INTEGER REFERENCES users(id);
ALTER TABLE proc_orders ADD COLUMN direct_approved_at INTEGER;

-- نوع بند الأمر: مخزني (يدخل المخزون) أو خدمة/أعمال (تُستلم بلا حركة مخزن)
ALTER TABLE proc_order_lines ADD COLUMN kind TEXT NOT NULL DEFAULT 'stock';

-- بند الاستلام يُربط ببند الأمر، وبند الخدمة بلا صنف مخزني
ALTER TABLE proc_receipt_lines ADD COLUMN order_line_id INTEGER REFERENCES proc_order_lines(id);
ALTER TABLE proc_receipt_lines ALTER COLUMN item_id DROP NOT NULL;

-- قيد الاستلام: رقم القيد المرحّل، أو سبب تعذّره ليظهر للمالية ويُعاد ترحيله
ALTER TABLE proc_receipts ADD COLUMN journal_entry_id INTEGER;
ALTER TABLE proc_receipts ADD COLUMN journal_error TEXT;
