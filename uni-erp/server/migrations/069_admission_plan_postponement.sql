-- خطة القبول لكل برنامج (الفارغ يأخذ القيم الافتراضية من الإعدادات)، ومدة التأجيل بالفصول لاحتساب الحد الأقصى المسموح.
ALTER TABLE programs ADD COLUMN admission_min_score REAL;
ALTER TABLE programs ADD COLUMN admission_capacity INTEGER;
ALTER TABLE sa_lifecycle_movements ADD COLUMN duration_semesters INTEGER NOT NULL DEFAULT 1;
