-- أقسام الموارد البشرية تأتي الآن من الهيكل التنظيمي المعتمد والجهات الأكاديمية، لا من قائمة مستقلة.
DELETE FROM hr_system_lookups WHERE category = 'departments';

-- الأسماء القديمة التي لها مقابل واضح في الهيكل. ما لا مقابل له (المبيعات، التسويق، خدمة العملاء، التشغيل والإنتاج) يبقى
-- على الموظف كما هو حتى يصحَّح من ملفه، فلا يُنقل موظف إلى قسم لم يُختر له.
UPDATE hr_employees SET department_name = 'المالية والحسابات' WHERE department_name = 'الحسابات';
UPDATE hr_employees SET department_name = 'تقنية المعلومات والأمن السيبراني' WHERE department_name = 'تقنية المعلومات';
UPDATE hr_employees SET department_name = 'المشتريات والمخازن' WHERE department_name IN ('المشتريات', 'المخازن');
UPDATE hr_employees SET department_name = 'الشؤون الإدارية' WHERE department_name = 'الإدارة';
UPDATE hr_employees SET department_name = 'الشؤون الأكاديمية' WHERE department_name = 'الشؤون الأكاديمية والامتحانات';
UPDATE hr_appraisals SET department = 'المالية والحسابات' WHERE department = 'الحسابات';
UPDATE hr_appraisals SET department = 'تقنية المعلومات والأمن السيبراني' WHERE department = 'تقنية المعلومات';
UPDATE hr_appraisals SET department = 'المشتريات والمخازن' WHERE department IN ('المشتريات', 'المخازن');
UPDATE hr_appraisals SET department = 'الشؤون الإدارية' WHERE department = 'الإدارة';
UPDATE hr_appraisals SET department = 'الشؤون الأكاديمية' WHERE department = 'الشؤون الأكاديمية والامتحانات';

-- وحدات أنشأها الإقلاع القديم تلقائياً من تلك الأسماء: تُعطَّل ولا تُحذف لأن سجلات قد تشير إليها
UPDATE org_units SET active = 0 WHERE code IS NULL AND name IN ('الحسابات', 'تقنية المعلومات', 'المشتريات', 'المخازن', 'الإدارة', 'الشؤون الأكاديمية والامتحانات', 'المبيعات', 'التسويق', 'خدمة العملاء', 'التشغيل والإنتاج');
