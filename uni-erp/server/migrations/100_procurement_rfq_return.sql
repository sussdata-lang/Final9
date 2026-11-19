-- المرحلة 7: بقية البنود العاجلة من تقرير المشتريات

-- طلب الشراء المعاد للتعديل: يعود مسودة تحت رقمه نفسه مع سبب الإعادة ومن أعاده، ويُعاد اعتماده من أوله
ALTER TABLE proc_requests ADD COLUMN returned_at INTEGER;
ALTER TABLE proc_requests ADD COLUMN returned_by INTEGER REFERENCES users(id);
ALTER TABLE proc_requests ADD COLUMN return_reason TEXT;

-- إلغاء طلب عروض الأسعار بسبب مكتوب، وإعادة فتحه بعد إلغاء أمر الترسية
ALTER TABLE proc_rfqs ADD COLUMN cancel_reason TEXT;
ALTER TABLE proc_rfqs ADD COLUMN cancelled_by INTEGER REFERENCES users(id);
ALTER TABLE proc_rfqs ADD COLUMN cancelled_at INTEGER;
