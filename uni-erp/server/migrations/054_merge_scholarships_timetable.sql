-- توحيد المنح في sa_scholarships، وجدول المحاضرات في course_schedules

-- ما يطابق حساب طالب يُنقل، وغيره لا مكان له في جدول مربوط بالطالب
INSERT INTO sa_scholarships (grant_no, student_id, scholarship_type, discount_percent, amount, academic_year, status, note, created_at)
  SELECT 'SCH-MIG-' || s.id, u.id, s.scholarship_type, s.discount_percent, s.amount_covered, s.academic_year,
         CASE WHEN s.status = 'مفعّلة' THEN 'active' ELSE s.status END, 'منقول من سجل المنح الإداري', s.created_at
  FROM scholarships s JOIN users u ON u.student_no = s.student_no;
DROP TABLE scholarships;

-- الفترة النصية والمقرر برمزه تصبح موعداً مربوطاً بالمقرر؛ ما لا يطابق مقرراً أو لا يُقرأ وقته لا يُنقل
INSERT INTO course_schedules (course_id, day, start_min, end_min, hall)
  SELECT c.id,
         CASE s.day_name WHEN 'السبت' THEN 0 WHEN 'الأحد' THEN 1 WHEN 'الاثنين' THEN 2 WHEN 'الإثنين' THEN 2 WHEN 'الثلاثاء' THEN 3 WHEN 'الأربعاء' THEN 4 WHEN 'الخميس' THEN 5 WHEN 'الجمعة' THEN 6 END,
         split_part(split_part(s.time_slot, ' - ', 1), ':', 1)::int * 60 + split_part(split_part(s.time_slot, ' - ', 1), ':', 2)::int,
         split_part(split_part(s.time_slot, ' - ', 2), ':', 1)::int * 60 + split_part(split_part(s.time_slot, ' - ', 2), ':', 2)::int,
         s.hall_code
  FROM smart_schedule_slots s JOIN courses c ON c.code = s.course_code
  WHERE s.time_slot ~ '^[0-9]{1,2}:[0-9]{2} - [0-9]{1,2}:[0-9]{2}$'
    AND s.day_name IN ('السبت', 'الأحد', 'الاثنين', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة');
DROP TABLE smart_schedule_slots;
