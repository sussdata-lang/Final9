-- السنة الدراسية ثلاثة فصول بحسب دليل الطالب الرسمي (الأول، الثاني، الثالث).
-- قيد CHECK القديم على المقررات يقصر الفصل على 1 أو 2، فيُستبدل بقيد يسمح بالفصل الثالث.
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_semester_check;
ALTER TABLE courses ADD CONSTRAINT courses_semester_check CHECK (semester IN (1, 2, 3));

-- القيم النصية القديمة «الفصل الصيفي» صارت «الفصل الثالث» (الكود يقرأ القديمة أيضاً، وهذا للتوحيد فقط)
UPDATE student_profiles SET enroll_term = 'الفصل الثالث' WHERE enroll_term = 'الفصل الصيفي';
UPDATE site_settings SET value = '"الفصل الثالث"' WHERE key IN ('cfg.academic.current_semester', 'default.academic.current_semester') AND value = '"الفصل الصيفي"';
