-- =====================================================================
-- 029_high_concurrency_indexes.sql
-- فهارس الأداء الفائق والضغط العالي (10,000+ مستخدم متزامن + 10+ عملية/ثانية)
-- =====================================================================

-- 1. فهارس الجلسات والمصادقة السريعة (O(1) Session Lookup)
CREATE INDEX IF NOT EXISTS idx_hc_sessions_token_exp ON sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_hc_sessions_user_exp ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_hc_users_active_role ON users(active, role, unit_id);

-- 2. فهارس الديوان والمراسلات الرسمية (10+ مراسلة/ثانية)
CREATE INDEX IF NOT EXISTS idx_hc_corr_docs_status_created ON corr_docs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hc_corr_docs_creator_status ON corr_docs(creator_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hc_corr_approvers_user_state ON corr_approvers(user_id, state, doc_id);
CREATE INDEX IF NOT EXISTS idx_hc_corr_approvers_doc_seq ON corr_approvers(doc_id, state, seq);
CREATE INDEX IF NOT EXISTS idx_hc_corr_cc_user_doc ON corr_cc(user_id, doc_id);
CREATE INDEX IF NOT EXISTS idx_hc_corr_notifs_user_at ON corr_notifs(user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_hc_corr_events_doc_id ON corr_events(doc_id, id);

-- 3. فهارس المالية والقيود اليومية المزدوجة والسندات (10+ عملية مالية/ثانية)
CREATE INDEX IF NOT EXISTS idx_hc_fin_entries_status_day ON fin_entries(status, entry_day DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_hc_fin_entries_type_status ON fin_entries(type, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_hc_fin_lines_entry_acc ON fin_lines(entry_id, account_id);
CREATE INDEX IF NOT EXISTS idx_hc_fin_lines_acc_entry ON fin_lines(account_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_hc_fin_lines_party ON fin_lines(party_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_hc_fin_lines_student ON fin_lines(student_id, entry_id);

-- 4. فهارس الطلبات الطلابية والداخلية وسلسلة التدقيق
CREATE INDEX IF NOT EXISTS idx_hc_requests_status_created ON requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hc_requests_student_created ON requests(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hc_requests_service_status ON requests(service_code, status);
CREATE INDEX IF NOT EXISTS idx_hc_audit_log_at ON audit_log(at DESC);
