-- المرحلة 10: قيود الصرف وفروقات الجرد (تقرير المشتريات 5.1)
-- الصرف: مدين حساب المصروف (بمركز تكلفة القسم إن وُجد) / دائن المخزون بمتوسط التكلفة.
-- التسوية: العجز مدين حساب الفروقات / دائن المخزون، والزيادة بالعكس. تعذّر القيد يُحفظ سببه ليُعاد ترحيله.
ALTER TABLE proc_issues ADD COLUMN journal_entry_id INTEGER;
ALTER TABLE proc_issues ADD COLUMN journal_error TEXT;
ALTER TABLE proc_stock_moves ADD COLUMN journal_entry_id INTEGER;
ALTER TABLE proc_stock_moves ADD COLUMN journal_error TEXT;
