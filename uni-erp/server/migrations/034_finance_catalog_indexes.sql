-- ============================================================================
-- 034_finance_catalog_indexes.sql
-- فهارس جداول الكتالوج المالي (أطراف، عملات، مراكز كلفة، حسابات، رسوم)
-- + فهارس إضافية لسجل التدقيق والإعدادات
-- جميعها آمنة ومطابقة لمخطط الجداول الفعلي مع IF NOT EXISTS
-- ============================================================================

-- ===== 1. الأطراف المالية (fin_parties) — يُستعلَم عنها في كل قيد =====
-- البحث بالاسم (أكثر الفلاتر شيوعاً في واجهة الاختيار)
CREATE INDEX IF NOT EXISTS idx_fin_parties_name ON fin_parties(name);
-- البحث بالنوع (supplier / customer / employee / other)
CREATE INDEX IF NOT EXISTS idx_fin_parties_kind_active ON fin_parties(kind, active);

-- ===== 2. مراكز الكلفة (fin_cost_centers) =====
-- البحث بالرمز (يُستخدَم في التحقق من التفرد)
CREATE INDEX IF NOT EXISTS idx_fin_cc_code ON fin_cost_centers(code);
-- ربط بالوحدة التنظيمية
CREATE INDEX IF NOT EXISTS idx_fin_cc_unit ON fin_cost_centers(unit_id);

-- ===== 3. العملات (fin_currencies) =====
CREATE INDEX IF NOT EXISTS idx_fin_currencies_base ON fin_currencies(is_base);

-- ===== 4. الحسابات المحاسبية (fin_accounts) =====
-- البحث برقم الحساب
CREATE INDEX IF NOT EXISTS idx_fin_accounts_code ON fin_accounts(code);
-- الحسابات القابلة للترحيل (postable) — يُستعلَم في كل قيد جديد
CREATE INDEX IF NOT EXISTS idx_fin_accounts_postable_active ON fin_accounts(postable, active, type);

-- ===== 5. أنواع ورسوم الطلاب (fin_fee_types & charges & payments) =====
CREATE INDEX IF NOT EXISTS idx_fin_fee_types_active ON fin_fee_types(active);
CREATE INDEX IF NOT EXISTS idx_fin_charges_student ON fin_charges(student_id);
CREATE INDEX IF NOT EXISTS idx_fin_payments_student ON fin_payments(student_id);

-- ===== 6. سجل التدقيق (audit_log) — بحث بالمنفِّذ والإجراء =====
CREATE INDEX IF NOT EXISTS idx_audit_actor_at ON audit_log(actor_label, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_at ON audit_log(action, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ref_at ON audit_log(ref, at DESC);

-- ===== 7. الإعدادات (site_settings) =====
CREATE INDEX IF NOT EXISTS idx_site_settings_key ON site_settings(key);

-- ===== 8. إعادة ANALYZE للجداول الجديدة =====
ANALYZE fin_parties;
ANALYZE fin_cost_centers;
ANALYZE fin_currencies;
ANALYZE fin_accounts;
ANALYZE audit_log;
