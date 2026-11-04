-- توحيد الاختبارات الإلكترونية: تبقى بيانات الجدولين كما هي، وتُسجَّل تسليمات الجدولين في مكان واحد مع مصدرها
ALTER TABLE online_quiz_submissions ADD COLUMN source TEXT NOT NULL DEFAULT 'online';
CREATE INDEX IF NOT EXISTS idx_quiz_submissions_source ON online_quiz_submissions(source, quiz_id, student_no);

-- جدول الامتحانات: العام والفصل كانا يظهران في ملف PDF فقط ولا يُحفظان
ALTER TABLE exam_schedules ADD COLUMN academic_year TEXT;
ALTER TABLE exam_schedules ADD COLUMN semester TEXT;
CREATE INDEX IF NOT EXISTS idx_exam_schedules_term ON exam_schedules(course_code, academic_year, semester);
