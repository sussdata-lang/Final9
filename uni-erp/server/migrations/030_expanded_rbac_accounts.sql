-- 030_expanded_rbac_accounts.sql
-- توسيع مصفوفة الصلاحيات والحسابات لتناسب كل الأقسام مع تحديد الصلاحيات والسماحيات (عرض، كتابة، تعديل، اعتماد، حذف/تصدير)
-- ودعم أنماط الوصول (role, custom, hybrid) ونطاقات البيانات (all, faculty, unit, own) وصلاحيات الوحدات الافتراضية

-- 1. توسيع جدول المستخدمين لدعم التخصيص الدقيق للصلاحيات والشاشات
ALTER TABLE users ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'role';
ALTER TABLE users ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'unit';
ALTER TABLE users ADD COLUMN module_access_json TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN custom_permissions_json TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN revoked_permissions_json TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN allowed_views_json TEXT DEFAULT '[]';

-- 2. توسيع جدول الوحدات الإدارية لتحديد الصلاحيات الافتراضية لكل قسم
ALTER TABLE org_units ADD COLUMN default_permissions_json TEXT DEFAULT '[]';
ALTER TABLE org_units ADD COLUMN default_module_access_json TEXT DEFAULT '{}';
ALTER TABLE org_units ADD COLUMN allowed_views_json TEXT DEFAULT '[]';
