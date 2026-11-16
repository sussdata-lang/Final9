-- قائمة الشاشات المخصصة للحساب أو الوحدة كانت تحجب كل شاشة لم تُذكر فيها، ومنها ما أُضيف بعد حفظها.
-- views_known_json يحفظ الشاشات الموجودة لحظة الحفظ، فما يُضاف بعدها يظهر لمن يملك صلاحيته.
-- القوائم المحفوظة قبل هذا الترحيل تُختم بالشاشات الثلاث والعشرين الموجودة حتى 2026-11-05،
-- فتظهر المجالس والخدمات الإدارية والتوظيف وعروض الأسعار المضافة في 2026-11-10 لمن يملك صلاحيتها.
ALTER TABLE users ADD COLUMN views_known_json TEXT;
ALTER TABLE org_units ADD COLUMN views_known_json TEXT;
UPDATE users SET views_known_json = '["overview","guidelines","affairs","academics","attendance","expansions","student_life","labtools","lms","research","alumni","qa","payroll","corr","finance","procurement","dashboard","exchange","comms","ai","admin","access","audit"]'
  WHERE views_known_json IS NULL AND allowed_views_json IS NOT NULL AND allowed_views_json NOT IN ('', '[]');
UPDATE org_units SET views_known_json = '["overview","guidelines","affairs","academics","attendance","expansions","student_life","labtools","lms","research","alumni","qa","payroll","corr","finance","procurement","dashboard","exchange","comms","ai","admin","access","audit"]'
  WHERE views_known_json IS NULL AND allowed_views_json IS NOT NULL AND allowed_views_json NOT IN ('', '[]');
