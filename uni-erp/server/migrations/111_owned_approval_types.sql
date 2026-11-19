-- نوع موافقة تملكه وحدة: خطواته يعرّفها المدير من «أنواع الموافقات»، وتنفّذها الوحدة بمسارها
-- (لا يُقدَّم من «طلب جديد»). أولها المراسلات: خطوات ثابتة تسبق معتمدي المستند الذين يختارهم كاتبه.
ALTER TABLE approval_types ADD COLUMN owner TEXT;
INSERT INTO approval_types (code, name, description, mode, amount_required, active, owner, created_at)
VALUES ('corr_doc', 'المراسلات الداخلية', 'خطوات ثابتة تُضاف قبل معتمدي المستند الذين يختارهم كاتبه عند إرساله. نمط المسار (تسلسلي أو متوازٍ) يحدده المستند.', 'sequential', 0, 1, 'corr', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
ON CONFLICT (code) DO NOTHING;
