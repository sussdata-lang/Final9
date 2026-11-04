-- هياكل الرسوم: كان الجدول يُنشأ أثناء الطلب بصيغة لا يقبلها PostgreSQL فيفشل تبويب «الرسوم والأقساط» دائماً
CREATE TABLE IF NOT EXISTS fin_fee_structures (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id       INTEGER,
  academic_year    TEXT,
  semester         INTEGER,
  tuition_fee      REAL,
  registration_fee REAL,
  total_fee        REAL,
  created_at       INTEGER
);
