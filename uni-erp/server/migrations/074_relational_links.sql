-- ربط الجداول التي كانت تعتمد على الاسم أو الرمز بمعرّف حقيقي.
-- الأعمدة النصية تبقى كما هي؛ يملأ المحفز المعرّف عند الإدخال، ويحدّث النص عند تغيّر الأصل.
ALTER TABLE lms_lectures ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE lms_lectures ADD COLUMN instructor_member_id INTEGER REFERENCES faculty_members(id) ON DELETE SET NULL;
ALTER TABLE lms_quizzes ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE library_loans ADD COLUMN borrower_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE research_projects ADD COLUMN faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;
ALTER TABLE postgrad_theses ADD COLUMN student_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE postgrad_theses ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE postgrad_theses ADD COLUMN supervisor_member_id INTEGER REFERENCES faculty_members(id) ON DELETE SET NULL;
ALTER TABLE alumni_records ADD COLUMN student_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE alumni_records ADD COLUMN faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;
ALTER TABLE alumni_records ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE career_applications ADD COLUMN student_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE qa_surveys ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE qa_surveys ADD COLUMN instructor_member_id INTEGER REFERENCES faculty_members(id) ON DELETE SET NULL;
ALTER TABLE qa_accreditations ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE exam_schedules ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE exam_schedules ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE grade_appeals ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE office_hour_bookings ADD COLUMN member_id INTEGER REFERENCES faculty_members(id) ON DELETE SET NULL;
ALTER TABLE faculty_promotions ADD COLUMN member_id INTEGER REFERENCES faculty_members(id) ON DELETE SET NULL;
ALTER TABLE dorm_allocations ADD COLUMN faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;
ALTER TABLE student_activities ADD COLUMN supervisor_member_id INTEGER REFERENCES faculty_members(id) ON DELETE SET NULL;
ALTER TABLE ai_early_warnings ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE student_self_enrollments ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE faculty_overload_records ADD COLUMN member_id INTEGER REFERENCES faculty_members(id) ON DELETE SET NULL;
ALTER TABLE faculty_overload_records ADD COLUMN faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;
ALTER TABLE student_fee_installments ADD COLUMN faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;
ALTER TABLE offline_sync_batches ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE housing_handouts ADD COLUMN faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;

-- خريطة الروابط: is_key = 1 يحدد المعرّف، و src_col هو عمود الأصل الذي يُنسخ إلى النص عند تغيّره
CREATE TABLE text_link_map (
  kind TEXT NOT NULL,
  tbl TEXT NOT NULL,
  id_col TEXT NOT NULL,
  text_col TEXT NOT NULL,
  src_col TEXT NOT NULL,
  is_key INTEGER NOT NULL,
  PRIMARY KEY (tbl, text_col)
);
INSERT INTO text_link_map (kind, tbl, id_col, text_col, src_col, is_key) VALUES
  ('course', 'lms_lectures', 'course_id', 'course_code', 'code', 1),
  ('course', 'lms_lectures', 'course_id', 'course_name', 'name', 0),
  ('member', 'lms_lectures', 'instructor_member_id', 'instructor_name', 'name', 1),
  ('course', 'lms_quizzes', 'course_id', 'course_code', 'code', 1),
  ('course', 'lms_quizzes', 'course_id', 'course_name', 'name', 0),
  ('student', 'library_loans', 'borrower_id', 'borrower_no', 'student_no', 1),
  ('faculty', 'research_projects', 'faculty_id', 'faculty_name', 'name', 1),
  ('student', 'postgrad_theses', 'student_id', 'student_no', 'student_no', 1),
  ('program', 'postgrad_theses', 'program_id', 'program_name', 'name', 1),
  ('member', 'postgrad_theses', 'supervisor_member_id', 'supervisor_name', 'name', 1),
  ('student', 'alumni_records', 'student_id', 'student_no', 'student_no', 1),
  ('faculty', 'alumni_records', 'faculty_id', 'faculty_name', 'name', 1),
  ('program', 'alumni_records', 'program_id', 'program_name', 'name', 1),
  ('student', 'career_applications', 'student_id', 'student_no', 'student_no', 1),
  ('course', 'qa_surveys', 'course_id', 'course_code', 'code', 1),
  ('course', 'qa_surveys', 'course_id', 'course_name', 'name', 0),
  ('member', 'qa_surveys', 'instructor_member_id', 'instructor_name', 'name', 1),
  ('program', 'qa_accreditations', 'program_id', 'program_name', 'name', 1),
  ('course', 'exam_schedules', 'course_id', 'course_code', 'code', 1),
  ('course', 'exam_schedules', 'course_id', 'course_name', 'name', 0),
  ('program', 'exam_schedules', 'program_id', 'program_name', 'name', 1),
  ('course', 'grade_appeals', 'course_id', 'course_code', 'code', 1),
  ('course', 'grade_appeals', 'course_id', 'course_name', 'name', 0),
  ('member', 'office_hour_bookings', 'member_id', 'faculty_name', 'name', 1),
  ('member', 'faculty_promotions', 'member_id', 'faculty_name', 'name', 1),
  ('faculty', 'dorm_allocations', 'faculty_id', 'faculty_name', 'name', 1),
  ('member', 'student_activities', 'supervisor_member_id', 'supervisor_name', 'name', 1),
  ('program', 'ai_early_warnings', 'program_id', 'program_name', 'name', 1),
  ('course', 'student_self_enrollments', 'course_id', 'course_code', 'code', 1),
  ('course', 'student_self_enrollments', 'course_id', 'course_name', 'name', 0),
  ('member', 'faculty_overload_records', 'member_id', 'instructor_name', 'name', 1),
  ('faculty', 'faculty_overload_records', 'faculty_id', 'faculty_name', 'name', 1),
  ('faculty', 'student_fee_installments', 'faculty_id', 'faculty_name', 'name', 1),
  ('course', 'offline_sync_batches', 'course_id', 'course_code', 'code', 1),
  ('faculty', 'housing_handouts', 'faculty_id', 'faculty_name', 'name', 1);

CREATE OR REPLACE FUNCTION link_lookup(link_kind text, v text) RETURNS bigint LANGUAGE sql STABLE AS $lk$
  SELECT CASE link_kind
    WHEN 'course' THEN (SELECT id FROM courses WHERE code = v ORDER BY active DESC, id LIMIT 1)
    WHEN 'program' THEN (SELECT id FROM programs WHERE name = v ORDER BY active DESC, id LIMIT 1)
    WHEN 'faculty' THEN (SELECT id FROM faculties WHERE name = v ORDER BY id LIMIT 1)
    WHEN 'member' THEN (SELECT id FROM faculty_members WHERE name = v ORDER BY id LIMIT 1)
    WHEN 'student' THEN (SELECT id FROM users WHERE student_no = v LIMIT 1)
  END
$lk$;

CREATE OR REPLACE FUNCTION link_fill() RETURNS trigger LANGUAGE plpgsql AS $lf$
DECLARE
  m record;
  v text;
  found_id bigint;
  patch jsonb := '{}'::jsonb;
BEGIN
  FOR m IN SELECT kind, id_col, text_col FROM text_link_map WHERE tbl = TG_TABLE_NAME AND is_key = 1 LOOP
    v := to_jsonb(NEW) ->> m.text_col;
    IF v IS NOT NULL AND v <> '' THEN
      found_id := link_lookup(m.kind, v);
      IF found_id IS NOT NULL THEN patch := patch || jsonb_build_object(m.id_col, found_id); END IF;
    END IF;
  END LOOP;
  IF patch <> '{}'::jsonb THEN NEW := jsonb_populate_record(NEW, patch); END IF;
  RETURN NEW;
END
$lf$;

CREATE OR REPLACE FUNCTION link_propagate() RETURNS trigger LANGUAGE plpgsql AS $lp$
DECLARE
  m record;
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
BEGIN
  FOR m IN SELECT tbl, id_col, text_col, src_col FROM text_link_map WHERE kind = TG_ARGV[0] LOOP
    IF (old_row ->> m.src_col) IS DISTINCT FROM (new_row ->> m.src_col) THEN
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', m.tbl, m.text_col, m.id_col) USING new_row ->> m.src_col, NEW.id;
    END IF;
  END LOOP;
  RETURN NULL;
END
$lp$;

DO $bf$
DECLARE
  m record;
BEGIN
  FOR m IN SELECT kind, tbl, id_col, text_col FROM text_link_map WHERE is_key = 1 LOOP
    EXECUTE format('UPDATE %I SET %I = link_lookup(%L, %I) WHERE %I IS NULL AND COALESCE(%I, %L) <> %L', m.tbl, m.id_col, m.kind, m.text_col, m.id_col, m.text_col, '', '');
  END LOOP;
  FOR m IN SELECT DISTINCT tbl FROM text_link_map LOOP
    EXECUTE format('CREATE TRIGGER link_fill_trg BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION link_fill()', m.tbl);
  END LOOP;
  FOR m IN SELECT DISTINCT tbl, id_col FROM text_link_map LOOP
    EXECUTE format('CREATE INDEX %I ON %I(%I)', 'idx_link_' || m.tbl || '_' || m.id_col, m.tbl, m.id_col);
  END LOOP;
END
$bf$;

CREATE TRIGGER link_propagate_course AFTER UPDATE OF code, name ON courses FOR EACH ROW EXECUTE FUNCTION link_propagate('course');
CREATE TRIGGER link_propagate_program AFTER UPDATE OF name ON programs FOR EACH ROW EXECUTE FUNCTION link_propagate('program');
CREATE TRIGGER link_propagate_faculty AFTER UPDATE OF name ON faculties FOR EACH ROW EXECUTE FUNCTION link_propagate('faculty');
CREATE TRIGGER link_propagate_member AFTER UPDATE OF name ON faculty_members FOR EACH ROW EXECUTE FUNCTION link_propagate('member');
CREATE TRIGGER link_propagate_student AFTER UPDATE OF student_no ON users FOR EACH ROW EXECUTE FUNCTION link_propagate('student');
