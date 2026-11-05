// تعريف أنواع الاستيراد الجدولي: كل نوع يصف جدوله وأعمدته ومفتاحه، والمحرك العام (import_engine.js) ينفّذ الفحص والحفظ والتراجع.
// name: عمود الملف، to: عمود الجدول (الافتراضي name)، key: مفتاح التحديث بدل التكرار، unique: أعمدة فريدة أخرى.
// fk: يُكتب في الملف رمز مقروء ويُخزَّن معرّفه؛ by أعمدة البحث، copy أعمدة تُنسخ من السجل المرتبط.
// derive: يحسب الأعمدة المشتقة بمعادلات الشاشات نفسها، after: يكتب في جدول آخر عبر updateSide (ويشمله التراجع)، sideOnly: عمود لا يُكتب في جدول النوع.
import { getHrAlertSettingsMap, universityDepartments } from './hr_integrated.js';
import { calcAttendanceCommitment, calcAbsenceDeduction, calcLeaveMetrics, calcAdvanceMetrics, calcContractMetrics } from './hr_calculations.js';
import { computeFacultyOverloadPay } from './enterprise_suite.js';
import { dayKey } from './staffatt.js';
import { HttpError } from '../http.js';
import { yearFor } from './finance/core.js';
import { createCharge, voidCharge, createPayment, voidPayment } from './finance/fees.js';
import { LIFECYCLE_STATUS, LIFECYCLE_IMPACT } from './student_affairs_suite.js';
import { createReceipt, createIssue } from './procurement/core.js';
import { createEntry, reverseEntry, toMinor } from './finance/core.js';
import { getSetting } from './settings.js';
import { GROUP_KINDS } from './student_groups.js';
const c = (name, label, type, opts = {}) => ({ name, label, type, ...opts });
const req = (name, label, type, opts = {}) => c(name, label, type, { required: true, ...opts });
const bool = (name, label, opts = {}) => c(name, label, 'bool', opts);
const active = () => bool('active', 'فعّال', { default: 1, example: 'نعم' });
const unitFk = (name, label, to) => c(name, label, 'fk', { to, fk: { table: 'org_units', by: ['code', 'name'], hint: 'رمز الوحدة' } });
const courseFk = (name, label, to, opts = {}) => c(name, label, 'fk', { to, fk: { table: 'courses', by: ['code'], hint: 'رمز المقرر' }, ...opts });
const accountFk = (name, label, to, opts = {}) => c(name, label, 'fk', { to, fk: { table: 'fin_accounts', by: ['code'], hint: 'رمز الحساب' }, ...opts });
const NOW = { created_at: 'now' };
const employeeFk = () => req('employee_no', 'رقم الموظف', 'fk', { to: 'employee_id', fk: { table: 'hr_employees', by: ['employeeno'], hint: 'رقم الموظف' } });
const userFk = () => req('username', 'اسم المستخدم', 'fk', { to: 'user_id', fk: { table: 'users', by: ['username'], hint: 'اسم المستخدم', noList: true } });

const ORDER_REF = 'الكليات والبرامج والوحدات، ثم دليل الحسابات والعملات والسنوات ومراكز التكلفة، ثم الموردون والمستودعات والأصناف، ثم الموظفون فالعقود والإجازات والسلف والرواتب.';

// الطالب يُحدَّد برقمه الجامعي، واسمه يؤخذ من حسابه لا من الملف
const studentFk = () => req('student_no', 'الرقم الجامعي', 'fk', { to: 'student_id', fk: { table: 'users', by: ['student_no'], hint: 'الرقم الجامعي', noList: true } });
const studentNoFk = () => req('student_no', 'الرقم الجامعي', 'fk', { fk: { table: 'users', by: ['student_no'], pk: 'student_no', copy: { student_name: 'display_name' }, hint: 'الرقم الجامعي', noList: true } });
const fail = (message) => { throw new HttpError(400, message, 'validation'); };
const openYear = (ctx, day) => {
  try { yearFor(ctx.db, day); return null; } catch (e) { if (e instanceof HttpError) return e.message; throw e; }
};
// قيد في سنة أقفلت بعد الاستيراد لا يُعكس حتى يبقى الإقفال صحيحاً
const entryYearStillOpen = (db, entryId) => {
  const year = entryId ? db.prepare('SELECT y.name, y.status FROM fin_entries e JOIN fin_years y ON y.id = e.year_id WHERE e.id = ?').get(entryId) : null;
  if (year?.status === 'closed') fail(`السنة المالية ${year.name} مقفلة، فلا يُعكس قيدها.`);
};
const hrSettings = (ctx) => ctx.memo('hrSettings', () => getHrAlertSettingsMap(ctx.db).map);
const employeeOf = (ctx, id) => ctx.memo(`emp:${id}`, () => ctx.db.prepare('SELECT salary_base, annual_leave_quota FROM hr_employees WHERE id = ?').get(id));
const today = () => new Date().toISOString().slice(0, 10);
const officialDepartment = (value, ctx) => (value !== undefined && !ctx.memo('departments', () => universityDepartments(ctx.db)).includes(value) ? '«القسم» يجب أن يكون من أقسام الجامعة المعتمدة في القائمة.' : null);
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const LEAVE_TYPES = { سنوية: 'annual', اعتيادي: 'annual', مرضية: 'sick', 'بدون راتب': 'unpaid', أمومة: 'maternity', أبوة: 'paternity', عارضة: 'annual', منحة: 'annual', 'حج وعمرة': 'annual' };
const employeeStatus = (label) => (label === 'في إجازة' ? 'on_leave' : label === 'استقالة' || label === 'انتهاء عقد' ? 'terminated' : 'active');
// الراتب الساري: آخر سجل بدأ سريانه، فالراتب المستقبلي لا يُطبَّق قبل موعده
const currentSalary = (db, employeeId, now) => db.prepare('SELECT amount, effective_at FROM hr_salaries WHERE employee_id = ? AND effective_at <= ? ORDER BY effective_at DESC, id DESC LIMIT 1').get(employeeId, now);

const itemFk = (opts = {}) => c('item_code', 'رمز الصنف', 'fk', { to: 'item_id', fk: { table: 'proc_items', by: ['code'], hint: 'رمز الصنف' }, ...opts });
const warehouseFk = (opts = {}) => c('warehouse_code', 'المستودع', 'fk', { to: 'warehouse_id', fk: { table: 'proc_warehouses', by: ['code'], hint: 'رمز المستودع' }, ...opts });
function insertDocument(db, table, head, linesTable, parentCol, lines) {
  const insert = (t, row) => { const names = Object.keys(row); return db.prepare(`INSERT INTO ${t} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => row[k])); };
  const id = Number(insert(table, head).lastInsertRowid);
  for (const line of lines) insert(linesTable, { ...line, [parentCol]: id });
  return id;
}

const list = [
  /* ---------- الأكاديمي والهيكل ---------- */
  { kind: 'faculties', table: 'faculties', title: 'الكليات والمعاهد', group: 'academic', perm: 'import:academic', risk: 'low', key: ['name'], unique: ['code'],
    desc: 'الجهات الأكاديمية التي تُبنى عليها البرامج. الرمز حروف إنجليزية كبيرة (2 إلى 8) ولا يتكرر.',
    columns: [req('name', 'الاسم', 'text', { max: 120, example: 'كلية تجريبية' }), req('name_en', 'الاسم بالإنجليزية', 'latin', { max: 120, example: 'Sample College' }),
      req('code', 'الرمز', 'code', { upper: true, pattern: /^[A-Z]{2,8}$/, patternMsg: 'حروف إنجليزية كبيرة من 2 إلى 8', example: 'SMPL' }),
      req('kind', 'النوع', 'enum', { options: { college: ['كلية'], institute: ['معهد'], center: ['مركز'] }, example: 'كلية' }), active()] },
  { kind: 'programs', table: 'programs', title: 'البرامج الدراسية', group: 'academic', perm: 'import:academic', risk: 'low', key: ['faculty', 'name', 'degree'], deps: ['faculties'],
    desc: 'برامج كل كلية. الاسم والكلية والدرجة معاً مفتاح التحديث، وعدد السنوات يحدد سنوات المقررات.',
    columns: [req('faculty_ref', 'الكلية', 'fk', { to: 'faculty_id', fk: { table: 'faculties', by: ['name', 'code', 'name_en'], copy: { faculty: 'name' }, hint: 'اسم الكلية أو رمزها' } }),
      req('name', 'اسم البرنامج', 'text', { max: 80, example: 'برنامج تجريبي' }), c('degree', 'الدرجة', 'text', { max: 30, default: 'بكالوريوس', example: 'بكالوريوس' }),
      c('years', 'عدد السنوات', 'int', { min: 1, max: 7, default: 4, example: 4 }), active()] },
  { kind: 'org_units', table: 'org_units', title: 'الوحدات التنظيمية', group: 'academic', perm: 'import:academic', risk: 'medium', key: ['code'],
    desc: 'الهيكل الإداري للجامعة. يمكن أن تشير الوحدة إلى وحدة أب في الملف نفسه؛ يرتّب النظام الآباء قبل الأبناء.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'UNIT-SMPL' }), req('name', 'الاسم', 'text', { max: 120, example: 'وحدة تجريبية' }),
      req('kind', 'النوع', 'enum', { options: { university: ['جامعة'], sector: ['قطاع'], college: ['كلية'], department: ['قسم'], office: ['مكتب'] }, example: 'قسم' }),
      c('parent_code', 'الوحدة الأب', 'fk', { to: 'parent_id', fk: { table: 'org_units', by: ['code'], hint: 'رمز الوحدة الأب' } }), c('description', 'الوصف', 'text', { max: 300 }), active()] },
  { kind: 'unit_links', table: 'unit_links', title: 'روابط الإحالة بين الوحدات', group: 'academic', perm: 'import:academic', risk: 'low', key: ['from_unit', 'to_unit'], deps: ['org_units'], stamp: NOW,
    desc: 'تحدد الوحدات التي يمكن إحالة الطلبات بينها.',
    validate: (v) => (v.from_unit === v.to_unit ? 'لا تُربط الوحدة بنفسها.' : null),
    columns: [req('from_code', 'من الوحدة', 'fk', { to: 'from_unit', fk: { table: 'org_units', by: ['code', 'name'], hint: 'رمز الوحدة' } }), req('to_code', 'إلى الوحدة', 'fk', { to: 'to_unit', fk: { table: 'org_units', by: ['code', 'name'], hint: 'رمز الوحدة' } }), bool('two_way', 'باتجاهين', { default: 0, example: 'لا' })] },
  { kind: 'faculty_members', table: 'faculty_members', title: 'أعضاء الهيئة التدريسية', group: 'academic', perm: 'import:academic', risk: 'low', key: [], deps: ['org_units'], stamp: NOW,
    desc: 'ملفات أعضاء الهيئة التدريسية. لا يوجد مفتاح فريد لهذا الجدول، فإعادة استيراد الملف نفسه تكرر السجلات.',
    columns: [req('name', 'الاسم', 'text', { max: 100, example: 'د. مثال تجريبي' }), req('rank', 'الدرجة العلمية', 'text', { max: 60, example: 'أستاذ مساعد' }), unitFk('unit_code', 'الوحدة', 'unit_id'),
      c('specialty', 'التخصص', 'text', { max: 120 }), c('email', 'البريد', 'email'), c('phone', 'الهاتف', 'tel'), c('office_hours', 'الساعات المكتبية', 'text', { max: 200 }), c('office_location', 'موقع المكتب', 'text', { max: 120 }),
      c('status', 'الحالة', 'enum', { options: { active: ['على رأس العمل'], leave: ['في إجازة'], inactive: ['منتهي الخدمة'] }, default: 'active', example: 'على رأس العمل' }), c('hire_date', 'تاريخ التعيين', 'dateEpoch'), c('notes', 'ملاحظات', 'text', { max: 300 })] },
  { kind: 'course_schedules', table: 'course_schedules', title: 'جدول المحاضرات الأسبوعي', group: 'academic', perm: 'import:academic', risk: 'low', key: [], deps: ['courses'],
    desc: 'مواعيد محاضرات المقررات. يُحدَّد المقرر برمزه، ويجب أن يكون الرمز غير متكرر. الوقت بصيغة 09:30.',
    validate: (v) => (v.end_min <= v.start_min ? 'وقت النهاية يجب أن يكون بعد وقت البداية.' : null),
    columns: [courseFk('course_code', 'رمز المقرر', 'course_id', { required: true }), req('day', 'اليوم', 'enum', { options: { 0: ['الأحد'], 1: ['الإثنين', 'الاثنين'], 2: ['الثلاثاء'], 3: ['الأربعاء'], 4: ['الخميس'], 5: ['الجمعة'], 6: ['السبت'] }, numeric: true, example: 'الأحد' }),
      req('start_min', 'وقت البداية', 'minutes', { example: '09:00' }), req('end_min', 'وقت النهاية', 'minutes', { example: '11:00' }), c('hall', 'القاعة', 'text', { max: 60 })] },
  { kind: 'course_prerequisites', table: 'sa_course_prerequisites', title: 'المتطلبات السابقة للمقررات', group: 'academic', perm: 'import:academic', risk: 'low', key: ['course_id', 'prereq_course_id'], deps: ['courses'],
    desc: 'تربط المقرر بمتطلبه السابق. يرفض النظام الدورات المغلقة بين المقررات.',
    validate: (v) => (v.course_id === v.prereq_course_id ? 'لا يكون المقرر متطلباً لنفسه.' : null),
    closure: { from: 'course_id', to: 'prereq_course_id', message: 'هذا الربط يُنشئ دورة مغلقة بين المقررات.' },
    columns: [courseFk('course_code', 'رمز المقرر', 'course_id', { required: true }), courseFk('prereq_code', 'رمز المتطلب السابق', 'prereq_course_id', { required: true }), c('min_mark', 'أدنى علامة', 'num', { min: 0, max: 100, default: 60, example: 60 })] },
  { kind: 'exam_schedules', table: 'exam_schedules', title: 'جدول الامتحانات', group: 'academic', perm: 'import:academic', risk: 'low', key: [], stamp: NOW,
    desc: 'جلسات الامتحانات. لا يوجد مفتاح فريد، فإعادة الاستيراد تكرر الجلسات.',
    columns: [req('course_code', 'رمز المقرر', 'code', { max: 30, example: 'SMPL-101' }), req('course_name', 'اسم المقرر', 'text', { max: 100, example: 'مقرر تجريبي' }), req('program_name', 'البرنامج', 'text', { max: 100, example: 'برنامج تجريبي' }),
      c('exam_type', 'نوع الامتحان', 'text', { max: 30, default: 'نهائي', example: 'نهائي' }), req('exam_date', 'التاريخ', 'date', { example: '2026-12-20' }), req('start_time', 'وقت البدء', 'time', { example: '09:00' }), req('end_time', 'وقت الانتهاء', 'time', { example: '11:00' }),
      req('hall_name', 'القاعة', 'text', { max: 60, example: 'القاعة 1' }), c('capacity', 'السعة', 'int', { min: 0, max: 5000, default: 60, example: 60 }), c('enrolled_count', 'المسجلون', 'int', { min: 0, max: 5000, default: 0, example: 40 }), req('proctor_name', 'المراقب', 'text', { max: 100, example: 'مراقب تجريبي' }), c('status', 'الحالة', 'text', { max: 30, default: 'مجدول' })] },
  { kind: 'hr_lookups', table: 'hr_system_lookups', title: 'قوائم الموارد البشرية', group: 'hr', perm: 'import:hr', risk: 'low', key: ['category', 'label'],
    desc: 'قيم قوائم الموارد البشرية مثل المسميات وأنواع الإجازات. الأقسام تتبع هيكل الجامعة.',
    columns: [req('category', 'الفئة', 'enum', { options: { positions: ['المسميات'], emp_statuses: ['حالات الموظف'], contract_types: ['أنواع العقود'], leave_types: ['أنواع الإجازات'], absence_reasons: ['أسباب الغياب'], advance_statuses: ['حالات السلف'], contract_statuses: ['حالات العقود'] }, example: 'المسميات' }),
      req('label', 'القيمة', 'text', { max: 80, example: 'مسمى تجريبي' }), c('sort_order', 'الترتيب', 'int', { min: 0, max: 9999, default: 1, example: 1 }), active()] },

  /* ---------- الموارد البشرية ---------- */
  { kind: 'hr_employees', table: 'hr_employees', title: 'الموظفون', group: 'hr', perm: 'import:hr', risk: 'medium', key: ['employeeno'], unique: ['personalid'], deps: ['org_units', 'hr_lookups'], stamp: { created_at: 'now', updated_at: 'now' }, touch: { updated_at: 'now' },
    desc: 'بيانات الموظفين الوظيفية. القسم من أقسام الجامعة المعتمدة، ولا يُنشئ الاستيراد حسابات دخول، والرواتب والبدلات تُستورد من «سجلات الرواتب».',
    validate: (v, row, ctx) => officialDepartment(v.department_name, ctx),
    derive: (v, row, ctx) => {
      if (v.emp_status_label !== undefined) v.status = employeeStatus(v.emp_status_label);
      if (!row) v.joindate = v.hiredate;
      if (v.unit_id === undefined && v.department_name !== undefined) { const unit = ctx.memo(`unit:${v.department_name}`, () => ctx.db.prepare('SELECT id FROM org_units WHERE name = ? AND active = 1 LIMIT 1').get(v.department_name)); if (unit) v.unit_id = unit.id; }
    },
    columns: [req('employee_no', 'رقم الموظف', 'code', { to: 'employeeno', max: 30, example: 'EMP-SMPL' }), req('name', 'الاسم', 'text', { max: 100, example: 'موظف تجريبي' }), req('personal_id', 'الرقم الشخصي', 'code', { to: 'personalid', max: 40, example: '00000000000' }), req('hire_date', 'تاريخ التعيين', 'date', { to: 'hiredate', example: '2026-01-01' }),
      c('email', 'البريد', 'email'), c('phone', 'الهاتف', 'tel'), c('department_name', 'القسم', 'text', { max: 80, list: universityDepartments }), c('position', 'المسمى الوظيفي', 'text', { max: 80, example: 'إداري' }), unitFk('unit_code', 'الوحدة', 'unit_id'),
      c('contract_type_label', 'نوع العقد', 'text', { max: 50, default: 'عقد مفتوح' }), c('emp_status_label', 'الحالة', 'text', { max: 40, default: 'نشط', example: 'نشط' }), c('annual_leave_quota', 'رصيد الإجازة السنوي', 'int', { min: 0, max: 366, default: 21, example: 21 })] },
  { kind: 'hr_contracts', table: 'hr_contracts', title: 'عقود الموظفين', group: 'hr', perm: 'import:hr', risk: 'medium', key: ['employee_id', 'start_date'], deps: ['hr_employees'], stamp: { created_by: 'actor', created_at: 'now' },
    desc: 'عقود الموظفين. الموظف وتاريخ البداية معاً مفتاح التحديث، وحالة العقد تُحسب من تاريخ نهايته.',
    validate: (v) => (v.end_date < v.start_date ? 'تاريخ النهاية يجب ألا يسبق تاريخ البداية.' : null),
    derive: (v, row, ctx) => {
      const s = hrSettings(ctx), m = calcContractMetrics(v.start_date, v.end_date, today(), Number(s.contract_expiry_warning_days ?? 60), Number(s.contract_expiry_critical_days ?? 15));
      v.status_ar = m.contractStatus;
      if (!row) { if (v.salary === undefined) v.salary = Number(employeeOf(ctx, v.employee_id)?.salary_base) || 0; if (v.notes === undefined) v.notes = m.renewalAlert; if (v.title === undefined) v.title = `عقد ${v.contract_type_ar}`; }
    },
    columns: [employeeFk(), c('contract_type', 'نوع العقد', 'enum', { options: { fixed: ['محدد المدة'], indefinite: ['مفتوح', 'غير محدد المدة'], temporary: ['مؤقت'], freelance: ['عمل حر'] }, default: 'fixed', example: 'محدد المدة' }), c('contract_type_ar', 'صفة الدوام', 'text', { max: 50, default: 'دوام كامل', example: 'دوام كامل' }), c('title', 'عنوان العقد', 'text', { max: 120 }),
      req('start_date', 'تاريخ البداية', 'date', { example: '2026-01-01' }), req('end_date', 'تاريخ النهاية', 'date', { example: '2026-12-31' }), c('salary', 'راتب العقد', 'int', { min: 0, max: 1e13 }), c('notes', 'ملاحظات', 'text', { max: 300 })] },
  { kind: 'hr_salaries', table: 'hr_salaries', title: 'سجلات الرواتب', group: 'hr', perm: 'import:hr', risk: 'high', key: ['employee_id', 'effective_at'], deps: ['hr_employees'], stamp: { created_by: 'actor', created_at: 'now' }, side: { hr_employees: 'id' },
    desc: 'الرواتب بتاريخ سريانها. أحدث راتب ساري يصبح الراتب الأساسي للموظف، والبدلات والاقتطاعات تُطبَّق معه. الموظف وتاريخ السريان معاً مفتاح التحديث.',
    impactNote: 'أحدث راتب ساري يصبح الراتب الأساسي للموظف وتُطبَّق معه البدلات والاقتطاعات، فيتغير صافي راتبه.',
    sideUnchanged: (side, v, ctx) => {
      const cur = currentSalary(ctx.db, v.employee_id, Date.now());
      if (!cur || String(cur.effective_at) !== String(v.effective_at)) return true;
      const emp = ctx.db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(v.employee_id);
      return Object.keys(side).every((k) => String(emp[k] ?? '') === String(side[k]));
    },
    after: ({ db, values, side, updateSide, now }) => {
      const cur = currentSalary(db, values.employee_id, now);
      if (!cur) return;
      // البدلات تتبع الصف الساري فقط، فصف قديم في الملف لا يغيّر القيم الحالية
      const own = String(cur.effective_at) === String(values.effective_at);
      updateSide('hr_employees', [values.employee_id], { salary_base: cur.amount, ...(own ? side : {}) }, { updated_at: now });
    },
    columns: [employeeFk(), req('amount', 'الراتب الأساسي', 'int', { min: 0, max: 1e13, example: 500000 }), req('effective_at', 'تاريخ السريان', 'dateEpoch', { example: '2026-01-01' }),
      c('housing_allowance', 'بدل السكن', 'num', { min: 0, max: 1e13, sideOnly: true }), c('transport_allowance', 'بدل النقل', 'num', { min: 0, max: 1e13, sideOnly: true }), c('insurance_amount', 'التأمينات', 'num', { min: 0, max: 1e13, sideOnly: true }), c('tax_amount', 'الضريبة', 'num', { min: 0, max: 1e13, sideOnly: true })] },
  { kind: 'hr_advances', table: 'hr_advances', title: 'السلف المالية', group: 'hr', perm: 'import:hr', risk: 'high', key: ['advance_code'], deps: ['hr_employees'], stamp: NOW,
    desc: 'سلف الموظفين. القسط الشهري والمبلغ المتبقي يُحسبان بمعادلة الشاشة نفسها.',
    impactNote: 'أقساط السلف غير المسددة تُخصم من صافي راتب الموظف.',
    validate: (v, row) => { const paid = v.paid_installments ?? row?.paid_installments, count = v.installments_count ?? row?.installments_count; return Number(paid) > Number(count) ? 'الأقساط المدفوعة أكثر من عدد الأقساط.' : null; },
    derive: (v, row) => {
      const m = calcAdvanceMetrics(v.amount ?? row?.amount, v.installments_count ?? row?.installments_count, v.paid_installments ?? row?.paid_installments ?? 0, v.status ?? row?.status ?? 'مستحقة');
      Object.assign(v, { amount: m.amount, installments_count: m.installmentsCount, paid_installments: m.paidInstallments, monthly_installment: m.monthlyInstallment, remaining_amount: m.remainingAmount, status: m.status });
    },
    columns: [req('advance_code', 'رمز السلفة', 'code', { max: 30, example: 'ADV-SMPL' }), employeeFk(), req('advance_date', 'تاريخ السلفة', 'date', { example: '2026-01-15' }), req('amount', 'قيمة السلفة', 'num', { min: 0, max: 1e13, example: 100000 }), c('installments_count', 'عدد الأقساط', 'int', { min: 1, max: 120, default: 1, example: 4 }), c('paid_installments', 'الأقساط المدفوعة', 'int', { min: 0, max: 120, default: 0, example: 0 }), c('status', 'الحالة', 'text', { max: 30, default: 'مستحقة', example: 'مستحقة' }), c('notes', 'ملاحظات', 'text', { max: 200 })] },
  { kind: 'hr_leaves', table: 'hr_leaves', title: 'الإجازات', group: 'hr', perm: 'import:hr', risk: 'medium', key: ['employee_id', 'start_date'], deps: ['hr_employees'], stamp: { created_by: 'actor', created_at: 'now' },
    desc: 'إجازات الموظفين. الموظف وتاريخ البداية معاً مفتاح التحديث حتى لا تُحسب الإجازة مرتين في الرصيد، وخصم الإجازة بدون راتب يُحسب تلقائياً.',
    validate: (v) => (v.end_date < v.start_date ? 'تاريخ النهاية يجب ألا يسبق تاريخ البداية.' : null),
    derive: (v, row, ctx) => {
      const emp = employeeOf(ctx, v.employee_id);
      v.leave_type = LEAVE_TYPES[v.leave_type_ar] ?? 'annual';
      v.unpaid_deduction = calcLeaveMetrics(v.leave_type_ar, v.days, emp?.salary_base, emp?.annual_leave_quota || 21, 0, Number(hrSettings(ctx).salary_day_divisor ?? 30)).unpaidDeduction;
    },
    columns: [employeeFk(), req('leave_type_ar', 'نوع الإجازة', 'text', { max: 40, example: 'سنوية' }), req('start_date', 'تاريخ البداية', 'date', { example: '2026-02-01' }), req('end_date', 'تاريخ النهاية', 'date', { example: '2026-02-03' }), req('days', 'عدد الأيام', 'int', { min: 1, max: 366, example: 3 }),
      c('status', 'الحالة', 'enum', { options: { approved: ['معتمدة', 'معتمد'], pending: ['قيد الاعتماد'], rejected: ['مرفوضة'], cancelled: ['ملغاة'] }, default: 'approved', example: 'معتمدة' }), c('reason', 'السبب', 'text', { max: 200 }), c('notes', 'ملاحظات', 'text', { max: 200 })] },
  { kind: 'leave_entitlements', table: 'leave_entitlements', pk: ['user_id', 'year'], title: 'أرصدة الإجازات السنوية', group: 'hr', perm: 'import:hr', risk: 'low', key: ['user_id', 'year'],
    desc: 'رصيد الإجازة لكل حساب في كل سنة. المستخدم والسنة معاً مفتاح التحديث.',
    columns: [userFk(), req('year', 'السنة', 'int', { min: 2000, max: 2100, example: 2026 }), req('days', 'الأيام', 'num', { min: 0, max: 366, example: 30 })] },
  { kind: 'hr_absences', table: 'hr_absences', title: 'الغيابات', group: 'hr', perm: 'import:hr', risk: 'medium', key: ['employee_id', 'month_code', 'reason'], deps: ['hr_employees'], stamp: NOW,
    desc: 'غياب الموظفين. خصم اليوم وإجمالي الخصم يُحسبان من الراتب الأساسي الحالي، فاستورد الرواتب قبل الغياب.',
    derive: (v, row, ctx) => {
      const s = hrSettings(ctx), m = calcAbsenceDeduction(employeeOf(ctx, v.employee_id)?.salary_base, v.absence_days, v.reason ?? row?.reason, Number(s.salary_day_divisor ?? 30), Number(s.absence_review_threshold_days ?? 3));
      Object.assign(v, { daily_rate: m.dailyRate, total_deduction: m.totalDeduction, status_note: m.statusNote, month: MONTHS_AR[Number(v.month_code.slice(5, 7)) - 1] });
    },
    columns: [employeeFk(), req('month_code', 'الشهر', 'monthCode', { example: '2026-01' }), req('absence_days', 'أيام الغياب', 'int', { min: 0, max: 31, example: 1 }), c('reason', 'السبب', 'text', { max: 80, default: 'تأخير متكرر', example: 'تأخير متكرر' })] },
  { kind: 'hr_monthly_attendance', table: 'hr_monthly_attendance', title: 'الحضور الشهري', group: 'hr', perm: 'import:hr', risk: 'medium', key: ['employee_id', 'month'], deps: ['hr_employees'], stamp: { updated_at: 'now' }, touch: { updated_at: 'now' },
    desc: 'حضور الموظف في كل شهر. الموظف والشهر معاً مفتاح التحديث، ونسبة الالتزام والتقييم تُحسبان تلقائياً.',
    validate: (v, row, ctx) => { const work = v.work_days_month ?? row?.work_days_month ?? Number(hrSettings(ctx).standard_month_work_days ?? 26); return Number(v.actual_days) > Number(work) ? 'أيام الحضور أكثر من أيام عمل الشهر.' : (Number(v.late_days ?? 0) > Number(v.actual_days) ? 'أيام التأخير أكثر من أيام الحضور.' : null); },
    derive: (v, row, ctx) => {
      const s = hrSettings(ctx), m = calcAttendanceCommitment(v.actual_days, v.late_days ?? row?.late_days ?? 0, v.work_days_month ?? row?.work_days_month ?? Number(s.standard_month_work_days ?? 26), Number(s.attendance_excellent_pct ?? 95), Number(s.attendance_good_pct ?? 85));
      Object.assign(v, { work_days_month: m.workDaysMonth, actual_days: m.actualDays, late_days: m.lateDays, full_days: m.fullDays, commitment_rate: m.commitmentRate, evaluation_note: m.evaluationNote });
    },
    columns: [employeeFk(), req('month', 'الشهر', 'monthCode', { example: '2026-01' }), req('actual_days', 'أيام الحضور', 'int', { min: 0, max: 31, example: 24 }), c('work_days_month', 'أيام عمل الشهر', 'int', { min: 1, max: 31, example: 26 }), c('late_days', 'أيام التأخير', 'int', { min: 0, max: 31, example: 1 }), c('late_hours', 'ساعات التأخير', 'num', { min: 0, max: 744, default: 0, example: 2 })] },
  { kind: 'staff_attendance', table: 'staff_attendance', pk: ['user_id', 'day'], title: 'بصمة الحضور اليومية', group: 'hr', perm: 'import:hr', risk: 'medium', key: ['user_id', 'day'],
    desc: 'دخول وخروج الحسابات يومياً. المستخدم واليوم معاً مفتاح التحديث.',
    validate: (v, row) => {
      if (dayKey(v.check_in) !== v.day) return 'وقت الدخول لا يقع في اليوم المذكور.';
      const out = v.check_out ?? row?.check_out;   // الخلية الفارغة تُبقي الخروج المحفوظ، فيقارَن به أيضاً
      return out !== undefined && out !== null && Number(out) <= v.check_in ? 'وقت الخروج يجب أن يكون بعد وقت الدخول.' : null;
    },
    columns: [userFk(), req('day', 'اليوم', 'date', { example: '2026-01-15' }), req('check_in', 'وقت الدخول', 'datetimeEpoch', { example: '2026-01-15 08:00' }), c('check_out', 'وقت الخروج', 'datetimeEpoch', { example: '2026-01-15 16:00' })] },
  { kind: 'hr_biometric_devices', table: 'hr_biometric_devices', title: 'أجهزة البصمة', group: 'hr', perm: 'import:hr', risk: 'low', key: ['device_code'], stamp: { last_sync_at: 'now' },
    desc: 'أجهزة البصمة وعناوينها. عدد الحركات المتزامنة لا يُستورد.',
    columns: [req('device_code', 'رمز الجهاز', 'code', { max: 30, example: 'BIO-SMPL' }), req('location', 'الموقع', 'text', { max: 120, example: 'البوابة الرئيسية' }), req('ip_address', 'عنوان IP', 'latin', { max: 45, pattern: /^(\d{1,3}\.){3}\d{1,3}$/, patternMsg: 'عنوان IPv4 مثل 10.0.0.5', example: '10.0.0.5' }), c('protocol', 'البروتوكول', 'text', { max: 60 }), c('status', 'الحالة', 'text', { max: 30 }), c('last_sync_at', 'آخر مزامنة', 'datetimeEpoch')] },
  { kind: 'hr_trainings', table: 'hr_trainings', title: 'الدورات التدريبية', group: 'hr', perm: 'import:hr', risk: 'low', key: ['title', 'start_date'],
    desc: 'الدورات التدريبية. العنوان وتاريخ البداية معاً مفتاح التحديث.',
    columns: [req('title', 'العنوان', 'text', { max: 150, example: 'دورة تجريبية' }), req('trainer_name', 'المدرب', 'text', { max: 100, example: 'مدرب تجريبي' }), req('target_department', 'القسم المستهدف', 'text', { max: 100, example: 'الموارد البشرية' }), req('start_date', 'تاريخ البداية', 'date', { example: '2026-03-01' }), c('hours_count', 'عدد الساعات', 'int', { min: 0, max: 5000, default: 20, example: 20 }), c('enrolled_count', 'المسجلون', 'int', { min: 0, max: 5000, default: 0, example: 15 }), c('status', 'الحالة', 'text', { max: 40, default: 'مفتوح للتسجيل' })] },
  { kind: 'hr_appraisals', table: 'hr_appraisals', title: 'تقييم الأداء', group: 'hr', perm: 'import:hr', risk: 'medium', key: ['employee_name', 'period_label'], stamp: { created_at: 'now', evaluator_name: 'actorName' },
    desc: 'تقييمات الأداء. الاسم والفترة معاً مفتاح التحديث، والدرجة الكلية متوسط الدرجات الثلاث.',
    validate: (v, row, ctx) => officialDepartment(v.department, ctx),
    derive: (v) => { v.overall_score = Number(((v.punctuality_score + v.productivity_score + v.teamwork_score) / 3).toFixed(1)); },
    columns: [req('employee_name', 'اسم الموظف', 'text', { max: 100, example: 'موظف تجريبي' }), req('department', 'القسم', 'text', { max: 100, list: universityDepartments }), c('period_label', 'الفترة', 'text', { max: 60, default: 'التقييم السنوي 2026', example: 'التقييم السنوي 2026' }), req('punctuality_score', 'الالتزام', 'int', { min: 0, max: 100, example: 90 }), req('productivity_score', 'الإنتاجية', 'int', { min: 0, max: 100, example: 90 }), req('teamwork_score', 'العمل الجماعي', 'int', { min: 0, max: 100, example: 90 }), c('recommendation', 'التوصية', 'text', { max: 80, default: 'علاوة دورية' }), c('evaluator_name', 'المقيّم', 'text', { max: 80 })] },
  { kind: 'faculty_promotions', table: 'faculty_promotions', title: 'ترفيع أعضاء الهيئة', group: 'hr', perm: 'import:hr', risk: 'low', key: ['faculty_name', 'target_rank'],
    desc: 'طلبات الترفيع العلمي. الاسم والرتبة المستهدفة معاً مفتاح التحديث.',
    columns: [req('faculty_name', 'اسم العضو', 'text', { max: 100, example: 'د. مثال تجريبي' }), req('specialty', 'التخصص', 'text', { max: 120, example: 'تخصص تجريبي' }), req('current_rank', 'الرتبة الحالية', 'text', { max: 60, example: 'مدرس' }), req('target_rank', 'الرتبة المستهدفة', 'text', { max: 60, example: 'أستاذ مساعد' }), req('submitted_at', 'تاريخ التقديم', 'dateEpoch', { example: '2026-01-10' }), c('research_points', 'النقاط البحثية', 'num', { min: 0, max: 10000, default: 0, example: 40 }), c('required_points', 'النقاط المطلوبة', 'num', { min: 0, max: 10000, default: 100, example: 100 }), c('teaching_years', 'سنوات التدريس', 'int', { min: 0, max: 80, default: 4, example: 4 }), c('committee_status', 'حالة اللجنة', 'text', { max: 60, default: 'قيد التحكيم العلمي' })] },
  { kind: 'faculty_overload', table: 'faculty_overload_records', title: 'سجلات النصاب والزيادة', group: 'hr', perm: 'import:hr', risk: 'low', key: ['instructor_name', 'semester'], stamp: { updated_at: 'now' }, touch: { updated_at: 'now' },
    desc: 'العبء التدريسي الإضافي. الساعات الزائدة والأجر يُحسبان بمعادلة الشاشة نفسها، والاسم والفصل معاً مفتاح التحديث.',
    derive: (v, row) => {
      const m = computeFacultyOverloadPay(v.quorum_hours ?? row?.quorum_hours, v.actual_teaching_hours ?? row?.actual_teaching_hours, v.supervision_hours ?? row?.supervision_hours ?? 0, v.hourly_rate ?? row?.hourly_rate);
      v.overload_hours = m.overloadHours; v.total_overload_pay = m.totalOverloadPay;
    },
    columns: [req('instructor_name', 'اسم العضو', 'text', { max: 100, example: 'د. مثال تجريبي' }), req('academic_rank', 'الرتبة', 'text', { max: 60, example: 'أستاذ مساعد' }), req('faculty_name', 'الكلية', 'text', { max: 100, example: 'كلية تجريبية' }), req('quorum_hours', 'ساعات النصاب', 'int', { min: 0, max: 200, example: 10 }), req('actual_teaching_hours', 'ساعات التدريس الفعلية', 'int', { min: 0, max: 200, example: 14 }), c('supervision_hours', 'ساعات الإشراف', 'int', { min: 0, max: 200, default: 0, example: 2 }), req('hourly_rate', 'أجر الساعة', 'num', { min: 0, max: 1e12, example: 1000 }), c('semester', 'الفصل', 'text', { max: 60, default: 'الفصل الأول 2026/2027', example: 'الفصل الأول 2026/2027' }), c('status', 'الحالة', 'text', { max: 40, default: 'معتمد للرواتب' })] },

  /* ---------- فئات الطلاب ---------- */
  { kind: 'student_groups', table: 'student_groups', title: 'فئات الطلاب', group: 'students', perm: 'import:groups', risk: 'low', key: ['name'], stamp: NOW, touch: { updated_at: 'now' },
    desc: 'أسماء الفئات وأنواعها. استوردها أولاً، ثم استورد أعضاءها. الاسم مفتاح التحديث.',
    columns: [req('name', 'اسم الفئة', 'text', { max: 80, example: 'مختبر تجريبي 1' }), c('kind', 'النوع', 'text', { max: 20, default: 'lecture', list: () => Object.keys(GROUP_KINDS), example: 'lab' }), c('notes', 'ملاحظات', 'text', { max: 500, default: '' })] },
  { kind: 'student_group_members', table: 'student_group_members', title: 'أعضاء فئات الطلاب', group: 'students', perm: 'import:groups', risk: 'low', key: ['group_id', 'student_id'], stamp: { added_at: 'now' },
    desc: 'صف لكل طالب في فئة. الفئة يجب أن تكون موجودة، والطالب يُحدَّد برقمه الجامعي.',
    columns: [req('group_name', 'اسم الفئة', 'fk', { to: 'group_id', fk: { table: 'student_groups', by: ['name'], hint: 'اسم الفئة' }, example: 'مختبر تجريبي 1' }), studentFk()] },

  /* ---------- المشتريات والمخزون ---------- */
  { kind: 'proc_categories', table: 'proc_categories', title: 'تصنيفات المشتريات', group: 'procurement', perm: 'import:procurement', risk: 'low', key: ['code'],
    desc: 'تصنيفات الأصناف في المخازن.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'CAT-SMPL' }), req('name', 'الاسم', 'text', { max: 100, example: 'تصنيف تجريبي' }), active()] },
  { kind: 'proc_warehouses', table: 'proc_warehouses', title: 'المستودعات', group: 'procurement', perm: 'import:procurement', risk: 'low', key: ['code'], stamp: NOW,
    desc: 'مستودعات الجامعة. مدير المستودع اختياري ويُحدَّد باسم المستخدم.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'WH-SMPL' }), req('name', 'الاسم', 'text', { max: 100, example: 'مستودع تجريبي' }), c('location', 'الموقع', 'text', { max: 200, example: 'المبنى الرئيسي' }),
      c('manager_username', 'مدير المستودع', 'fk', { to: 'manager_id', fk: { table: 'users', by: ['username'], hint: 'اسم المستخدم', noList: true } }), active()] },
  { kind: 'proc_suppliers', table: 'proc_suppliers', title: 'الموردون', group: 'procurement', perm: 'import:procurement', risk: 'low', key: ['code'], stamp: NOW,
    desc: 'بيانات الموردين. المورد الموجود بالرمز نفسه يُحدَّث ولا يتكرر.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'SUP-SMPL' }), req('name', 'الاسم', 'text', { max: 120, example: 'مورد تجريبي' }), c('phone', 'الهاتف', 'tel', { example: '0944000000' }), c('email', 'البريد', 'email', { example: 'supplier@example.com' }), c('address', 'العنوان', 'text', { max: 200, example: 'دمشق' }), c('tax_no', 'الرقم الضريبي', 'code', { max: 40 }), active()] },
  { kind: 'proc_items', table: 'proc_items', title: 'أصناف المخزون', group: 'procurement', perm: 'import:procurement', risk: 'low', key: ['code'], deps: ['proc_categories', 'proc_warehouses'], stamp: NOW,
    desc: 'تعريف الأصناف فقط. الكميات والتكلفة لا تُستورد هنا لأنها تأتي من حركات الاستلام والصرف.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'ITEM-SMPL' }), req('name', 'الاسم', 'text', { max: 120, example: 'صنف تجريبي' }), c('category_code', 'التصنيف', 'fk', { to: 'category_id', fk: { table: 'proc_categories', by: ['code', 'name'], hint: 'رمز التصنيف' } }),
      c('unit', 'الوحدة', 'text', { max: 30, default: 'قطعة', example: 'قطعة' }), c('warehouse_code', 'المستودع', 'fk', { to: 'warehouse_id', fk: { table: 'proc_warehouses', by: ['code', 'name'], hint: 'رمز المستودع' } }),
      c('min_stock', 'الحد الأدنى', 'int', { min: 0, max: 1e9, default: 0, example: 5 }), c('max_stock', 'الحد الأعلى', 'int', { min: 0, max: 1e9, default: 0, example: 100 }), c('notes', 'ملاحظات', 'text', { max: 300 }), active()] },
  { kind: 'proc_assets', table: 'proc_assets', title: 'الأصول الثابتة', group: 'procurement', perm: 'import:procurement', risk: 'medium', key: ['code'], deps: ['proc_suppliers', 'proc_warehouses'], stamp: NOW,
    desc: 'سجل الأصول الثابتة. حركات النقل والصيانة والإتلاف تُسجَّل من شاشة الأصول.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'AST-SMPL' }), req('name', 'الاسم', 'text', { max: 120, example: 'أصل تجريبي' }), c('category', 'الفئة', 'text', { max: 60, default: 'عام', example: 'عام' }), c('warehouse_code', 'المستودع', 'fk', { to: 'warehouse_id', fk: { table: 'proc_warehouses', by: ['code', 'name'], hint: 'رمز المستودع' } }),
      c('status', 'الحالة', 'enum', { options: { available: ['متاح'], in_use: ['قيد الاستخدام'], maintenance: ['صيانة'], disposed: ['متلف'] }, default: 'available', example: 'متاح' }), c('purchase_day', 'تاريخ الشراء', 'date'), c('cost', 'التكلفة', 'int', { min: 0, max: 1e13, default: 0 }), c('supplier_code', 'المورد', 'fk', { to: 'supplier_id', fk: { table: 'proc_suppliers', by: ['code', 'name'], hint: 'رمز المورد' } }), c('assigned_to', 'مسند إلى', 'text', { max: 120 }), c('notes', 'ملاحظات', 'text', { max: 300 })] },

  /* ---------- المالية الأساسية ---------- */
  { kind: 'fin_currencies', table: 'fin_currencies', pk: 'code', title: 'العملات', group: 'finance', perm: 'import:finance', risk: 'low', key: ['code'],
    desc: 'العملات وأسعار تحويلها. العملة الأساسية لا تُغيَّر من الاستيراد.',
    columns: [req('code', 'الرمز', 'code', { upper: true, max: 8, example: 'SMP' }), req('name', 'الاسم', 'text', { max: 60, example: 'عملة تجريبية' }), req('symbol', 'الرمز المختصر', 'text', { max: 8, example: 'م.ت' }), c('rate', 'سعر التحويل', 'num', { min: 0, max: 1e12, default: 1, example: 1 }), active()] },
  { kind: 'fin_years', table: 'fin_years', title: 'السنوات المالية', group: 'finance', perm: 'import:finance', risk: 'medium', key: ['name'], stamp: NOW,
    desc: 'السنوات المالية. السنة المقفلة لا تُعدَّل، وتاريخ النهاية بعد تاريخ البداية.',
    validate: (v) => (v.start_day && v.end_day && v.end_day <= v.start_day ? 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.' : null),
    protect: (row) => (row.status === 'closed' ? 'هذه السنة المالية مقفلة ولا تُعدَّل.' : null),
    columns: [req('name', 'الاسم', 'text', { max: 30, example: 'سنة تجريبية 2090' }), req('start_day', 'تاريخ البداية', 'date', { example: '2090-01-01' }), req('end_day', 'تاريخ النهاية', 'date', { example: '2090-12-31' })] },
  { kind: 'fin_cost_centers', table: 'fin_cost_centers', title: 'مراكز التكلفة', group: 'finance', perm: 'import:finance', risk: 'low', key: ['code'], deps: ['org_units'],
    desc: 'مراكز التكلفة، ويمكن ربطها بوحدة تنظيمية.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'CC-SMPL' }), req('name', 'الاسم', 'text', { max: 120, example: 'مركز تجريبي' }), unitFk('unit_code', 'الوحدة', 'unit_id'), active()] },
  { kind: 'fin_accounts', table: 'fin_accounts', title: 'دليل الحسابات', group: 'finance', perm: 'import:finance', risk: 'medium', key: ['code'], stamp: NOW,
    desc: 'الحسابات المحاسبية. يمكن أن يشير الحساب إلى حساب أب في الملف نفسه.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: '9990' }), req('name', 'الاسم', 'text', { max: 120, example: 'حساب تجريبي' }), req('type', 'النوع', 'enum', { options: { asset: ['أصول'], liability: ['خصوم'], equity: ['حقوق ملكية'], revenue: ['إيرادات'], expense: ['مصروفات'] }, example: 'مصروفات' }),
      c('parent_code', 'الحساب الأب', 'fk', { to: 'parent_id', fk: { table: 'fin_accounts', by: ['code'], hint: 'رمز الحساب الأب' } }), bool('postable', 'يقبل الترحيل', { default: 1, example: 'نعم' }), bool('require_cc', 'يتطلب مركز تكلفة', { default: 0, example: 'لا' }), active()] },
  { kind: 'fin_fee_types', table: 'fin_fee_types', title: 'أنواع الرسوم الدراسية', group: 'finance', perm: 'import:finance', risk: 'medium', key: ['code'], deps: ['fin_accounts'],
    desc: 'أنواع الرسوم والخصومات وحساب كل منها في دليل الحسابات.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'FEE-SMPL' }), req('name', 'الاسم', 'text', { max: 120, example: 'رسم تجريبي' }), c('kind_type', 'النوع', 'enum', { to: 'kind', options: { fee: ['رسم'], discount: ['خصم'] }, default: 'fee', example: 'رسم' }), accountFk('account_code', 'الحساب', 'account_id', { required: true }), c('default_amount', 'المبلغ الافتراضي', 'int', { min: 0, max: 1e13, default: 0, example: 1000 }), active()] },
  { kind: 'fin_parties', table: 'fin_parties', title: 'الأطراف المالية', group: 'finance', perm: 'import:finance', risk: 'low', key: [], deps: ['fin_accounts'], stamp: NOW,
    desc: 'الموردون والعملاء في المالية. لا يوجد مفتاح فريد، فإعادة الاستيراد تكرر السجلات.',
    columns: [req('kind_type', 'النوع', 'enum', { to: 'kind', options: { supplier: ['مورد'], customer: ['عميل'], employee: ['موظف'], other: ['أخرى'] }, example: 'مورد' }), req('name', 'الاسم', 'text', { max: 120, example: 'طرف تجريبي' }), c('phone', 'الهاتف', 'tel'), c('email', 'البريد', 'email'), c('notes', 'ملاحظات', 'text', { max: 300 }), accountFk('account_code', 'الحساب', 'account_id'), active()] },

  /* ---------- متفرقات ---------- */
  { kind: 'corr_templates', table: 'corr_templates', pk: 'code', title: 'قوالب المراسلات', group: 'misc', perm: 'import:misc', risk: 'low', key: ['code'], stamp: NOW,
    desc: 'قوالب الكتب الرسمية. القوالب المضمّنة في النظام لا تُعدَّل من الاستيراد.',
    protect: (row) => (Number(row.builtin) ? 'هذا قالب مضمّن في النظام ولا يُعدَّل من الاستيراد.' : null),
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'TPL-SMPL' }), req('name', 'الاسم', 'text', { max: 120, example: 'قالب تجريبي' }), c('category', 'الفئة', 'text', { max: 60, default: 'عام', example: 'عام' }), req('title', 'العنوان', 'text', { max: 200, example: 'كتاب تجريبي' }), c('subject', 'الموضوع', 'text', { max: 200 }), c('body', 'النص', 'text', { max: 5000 }),
      c('mode', 'مسار الموافقات', 'enum', { options: { sequential: ['متسلسل'], parallel: ['متوازٍ', 'متوازي'] }, default: 'parallel', example: 'متوازٍ' }), active()] },
  { kind: 'news', table: 'news', title: 'الأخبار', group: 'misc', perm: 'import:misc', risk: 'low', key: [], stamp: { created_by: 'actor' },
    desc: 'الأخبار الجامعية. لا يوجد مفتاح فريد، فإعادة الاستيراد تكرر الأخبار، ولا تُرسل إشعارات عند الاستيراد.',
    columns: [req('title', 'العنوان', 'text', { max: 200, example: 'خبر تجريبي' }), req('body', 'النص', 'text', { max: 5000, example: 'نص الخبر التجريبي' }), bool('pinned', 'مثبّت', { default: 0, example: 'لا' }), req('published_at', 'تاريخ النشر', 'datetimeEpoch', { example: '2026-11-01 09:00' })] },

  /* ---------- مستندات المشتريات والمخزون ---------- */
  { kind: 'proc_requests', table: 'proc_requests', linesTable: 'proc_request_lines', title: 'طلبات الشراء', group: 'procurement', perm: 'import:procurement', risk: 'medium', key: ['no'], deps: ['proc_warehouses', 'proc_items'], stamp: NOW,
    desc: 'طلب برأس وبنود تربطهما رقم الطلب. الطلب الموجود لا يُحدَّث، ولا يؤثر الاستيراد في المخزون.',
    duplicateMsg: 'طلب شراء بهذا الرقم موجود، والمستندات لا تُحدَّث من الاستيراد.',
    columns: [req('no', 'رقم الطلب', 'code', { max: 30, example: 'PRQ-SMPL-1' }), req('title', 'العنوان', 'text', { max: 100, example: 'طلب شراء تجريبي' }), c('description', 'الوصف', 'text', { max: 500 }),
      req('requester', 'مقدم الطلب', 'fk', { to: 'requester_id', fk: { table: 'users', by: ['username'], hint: 'اسم المستخدم', noList: true } }), warehouseFk(),
      c('status', 'الحالة', 'enum', { options: { draft: ['مسودة'], pending: ['قيد المراجعة'], approved: ['معتمد'], rejected: ['مرفوض'], cancelled: ['ملغى'] }, default: 'draft', example: 'مسودة' })],
    lineColumns: [itemFk(), req('line_description', 'وصف البند', 'text', { to: 'description', max: 100, example: 'بند تجريبي' }), req('qty', 'الكمية', 'int', { min: 1, max: 1000000, example: 2 }), c('est_cost', 'التكلفة التقديرية', 'int', { min: 0, max: 1000000000000, default: 0, example: 1000 }), c('line_note', 'ملاحظة البند', 'text', { to: 'note', max: 200 })],
    createDoc: ({ deps, head, lines }) => insertDocument(deps.db, 'proc_requests', head, 'proc_request_lines', 'request_id', lines),
    revertRow: ({ deps, id }) => {
      if (deps.db.prepare('SELECT 1 AS x FROM proc_orders WHERE request_id = ? LIMIT 1').get(id)) fail('صدر عن هذا الطلب أمر توريد.');
      deps.db.prepare('DELETE FROM proc_requests WHERE id = ?').run(id);
    } },
  { kind: 'proc_orders', table: 'proc_orders', linesTable: 'proc_order_lines', title: 'أوامر الشراء', group: 'procurement', perm: 'import:procurement', risk: 'high', key: ['no'], deps: ['proc_suppliers', 'proc_requests', 'proc_items'], stamp: { created_by: 'actor', created_at: 'now' }, side: { proc_requests: 'id' },
    desc: 'أمر توريد برأس وبنود. الأمر المرتبط بطلب يتطلب طلباً معتمداً بلا أمر سابق، ويصير الطلب «تم الطلب». المجموع يُحسب من البنود.',
    impactNote: 'يغيّر حالة طلب الشراء المرتبط، ويصبح الأمر المرسَل قابلاً للاستلام.',
    duplicateMsg: 'أمر توريد بهذا الرقم موجود، والمستندات لا تُحدَّث من الاستيراد.',
    columns: [req('no', 'رقم الأمر', 'code', { max: 30, example: 'PO-SMPL-1' }), req('supplier_code', 'المورد', 'fk', { to: 'supplier_id', fk: { table: 'proc_suppliers', by: ['code'], hint: 'رمز المورد' } }),
      c('request_no', 'طلب الشراء', 'fk', { to: 'request_id', fk: { table: 'proc_requests', by: ['no'], hint: 'رقم الطلب', noList: true } }),
      c('status', 'الحالة', 'enum', { options: { draft: ['مسودة'], ordered: ['مرسل'], cancelled: ['ملغى'] }, default: 'draft', example: 'مسودة' }), c('note', 'ملاحظة', 'text', { max: 300 })],
    lineColumns: [itemFk(), req('line_description', 'وصف البند', 'text', { to: 'description', max: 100, example: 'بند تجريبي' }), req('qty', 'الكمية', 'int', { min: 1, max: 1000000, example: 2 }), c('unit_cost', 'سعر الوحدة', 'int', { min: 0, max: 1000000000000, default: 0, example: 1000 })],
    validateDoc: (head, lines, ctx) => {
      if (head.status === 'ordered') head.ordered_at = Date.now();
      head.total_amount = lines.reduce((sum, l) => sum + l.qty * (l.unit_cost ?? 0), 0);
      for (const l of lines) l.line_total = l.qty * (l.unit_cost ?? 0);
      if (!head.request_id) return null;
      const used = ctx.memo('requestsInFile', () => new Set()), rq = ctx.db.prepare('SELECT status FROM proc_requests WHERE id = ?').get(head.request_id);
      if (rq.status !== 'approved') return 'طلب الشراء ليس معتمداً.';
      if (used.has(head.request_id) || ctx.db.prepare("SELECT 1 AS x FROM proc_orders WHERE request_id = ? AND status <> 'cancelled' LIMIT 1").get(head.request_id)) return 'يوجد أمر توريد مرتبط بهذا الطلب.';
      used.add(head.request_id);
      return null;
    },
    touches: (head) => [['proc_requests', head.request_id]],
    createDoc: ({ deps, head, lines }) => {
      const id = insertDocument(deps.db, 'proc_orders', head, 'proc_order_lines', 'order_id', lines);
      if (head.request_id) deps.db.prepare("UPDATE proc_requests SET status = 'ordered' WHERE id = ?").run(head.request_id);
      return id;
    },
    revertRow: ({ deps, id }) => {
      if (deps.db.prepare('SELECT 1 AS x FROM proc_receipts WHERE order_id = ? LIMIT 1').get(id)) fail('استُلمت كميات من هذا الأمر.');
      deps.db.prepare('DELETE FROM proc_orders WHERE id = ?').run(id);
    } },
  { kind: 'proc_receipts', table: 'proc_receipts', linesTable: 'proc_receipt_lines', title: 'استلام البضائع', group: 'procurement', perm: 'import:procurement', risk: 'high', key: ['import_ref'], keyScope: 'import_ref IS NOT NULL', deps: ['proc_orders', 'proc_items'], side: { proc_items: 'id', proc_orders: 'id' }, undoKeepsRow: true,
    desc: 'سند استلام يزيد رصيد الأصناف ويعدّل متوسط التكلفة ويرحّل قيد الاستحقاق بمنطق شاشة الاستلام نفسه. الكمية لا تتجاوز المتبقي من الأمر.',
    impactNote: 'يزيد رصيد المخزون ويغيّر متوسط التكلفة ويرحّل قيداً محاسبياً. التراجع يعيد الأرصدة ويعكس القيد ويبقي السند معكوساً، ويُمنع إذا تغيّر الصنف بعد الاستيراد.',
    duplicateMsg: 'سند بهذا الرقم استُورد من قبل؛ استخدم رقماً جديداً.',
    columns: [req('import_ref', 'رقم السند', 'code', { max: 40, example: 'GRN-SMPL-1' }), req('order_no', 'أمر الشراء', 'fk', { to: 'order_id', fk: { table: 'proc_orders', by: ['no'], hint: 'رقم الأمر', noList: true } }), req('received_date', 'تاريخ الاستلام', 'dateEpoch', { to: 'received_at', example: '2026-10-15' }), c('note', 'ملاحظة', 'text', { max: 300 })],
    lineColumns: [itemFk({ required: true }), req('qty', 'الكمية', 'int', { min: 1, max: 1000000, example: 1 }), c('unit_cost', 'سعر الوحدة', 'int', { min: 0, max: 1000000000000 })],
    validateDoc: (head, lines, ctx) => {
      const order = ctx.db.prepare('SELECT no, status FROM proc_orders WHERE id = ?').get(head.order_id);
      if (order.status !== 'ordered') return 'أمر التوريد ليس مرسلاً.';
      const orderLines = ctx.db.prepare('SELECT item_id, qty, unit_cost FROM proc_order_lines WHERE order_id = ?').all(head.order_id);
      const got = ctx.memo(`received:${head.order_id}`, () => new Map(ctx.db.prepare('SELECT rl.item_id, SUM(rl.qty) AS q FROM proc_receipt_lines rl JOIN proc_receipts r ON r.id = rl.receipt_id WHERE r.order_id = ? AND r.reversed_at IS NULL GROUP BY rl.item_id').all(head.order_id).map((x) => [Number(x.item_id), Number(x.q)])));
      const pending = new Map(got);
      for (const l of lines) {
        const ol = orderLines.find((x) => Number(x.item_id) === Number(l.item_id));
        if (orderLines.length && !ol) return `الصنف غير مدرج في أمر الشراء ${order.no}.`;
        const total = (pending.get(Number(l.item_id)) ?? 0) + l.qty;
        if (ol && total > Number(ol.qty)) return `الكمية تتجاوز المتبقي من أمر الشراء (المطلوب ${ol.qty}).`;
        if (ol && Number(ol.unit_cost) > 0 && (l.unit_cost ?? Number(ol.unit_cost)) > Number(ol.unit_cost)) return `سعر الوحدة يتجاوز السعر المعتمد في الأمر (${ol.unit_cost}).`;
        pending.set(Number(l.item_id), total);
      }
      for (const [item, qty] of pending) got.set(item, qty);
      return null;
    },
    touches: (head, lines) => [['proc_orders', head.order_id], ...lines.map((l) => ['proc_items', l.item_id])],
    createDoc: ({ deps, actor, head, lines, ip }) => {
      const { receiptId } = createReceipt(deps, actor, { orderId: head.order_id, note: head.note ?? '', lines: lines.map((l) => ({ itemId: l.item_id, qty: l.qty, unitCost: l.unit_cost })) }, ip);
      deps.db.prepare('UPDATE proc_receipts SET received_at = ?, import_ref = ? WHERE id = ?').run(head.received_at, head.import_ref, receiptId);
      return receiptId;
    },
    revertRow: ({ deps, actor, id, ip }) => {
      const entry = deps.db.prepare('SELECT id FROM fin_entries WHERE source = ? AND reversed_by IS NULL').get(`proc_receipt:${id}`);
      if (entry) { entryYearStillOpen(deps.db, entry.id); reverseEntry(deps, actor, entry.id, { reason: 'تراجع عن دفعة استيراد' }, ip); }
      deps.db.prepare('UPDATE proc_receipts SET reversed_at = ?, reversed_by = ? WHERE id = ?').run(Date.now(), actor.id, id);
    } },
  { kind: 'proc_issues', table: 'proc_issues', linesTable: 'proc_issue_lines', title: 'صرف المخزون', group: 'procurement', perm: 'import:procurement', risk: 'high', key: ['no'], deps: ['proc_warehouses', 'proc_items'], side: { proc_items: 'id' }, undoKeepsRow: true,
    desc: 'سند صرف ينقص رصيد الأصناف. يُرفض إذا لم يكفِ الرصيد، ويُحسب ذلك داخل الملف نفسه.',
    impactNote: 'ينقص رصيد المخزون. التراجع يعيد الأرصدة ويبقي السند معكوساً، ويُمنع إذا تغيّر الصنف بعد الاستيراد.',
    duplicateMsg: 'سند صرف بهذا الرقم موجود؛ استخدم رقماً جديداً.',
    columns: [req('no', 'رقم السند', 'code', { max: 30, example: 'IS-SMPL-1' }), warehouseFk({ required: true }), req('issued_to', 'الجهة المستلمة', 'text', { max: 60, example: 'جهة تجريبية' }), c('purpose', 'الغرض', 'text', { max: 200 }), req('issued_date', 'تاريخ الصرف', 'dateEpoch', { to: 'issued_at', example: '2026-10-15' })],
    lineColumns: [itemFk({ required: true }), req('qty', 'الكمية', 'int', { min: 1, max: 1000000, example: 1 })],
    validateDoc: (head, lines, ctx) => {
      const stock = ctx.memo('stock', () => new Map()), pending = new Map();
      for (const l of lines) {
        const id = Number(l.item_id), have = pending.get(id) ?? stock.get(id) ?? Number(ctx.db.prepare('SELECT qty_on_hand FROM proc_items WHERE id = ?').get(id).qty_on_hand);
        if (l.qty > have) return `رصيد الصنف لا يكفي (${have} متاح).`;
        pending.set(id, have - l.qty);
      }
      for (const [id, qty] of pending) stock.set(id, qty);
      return null;
    },
    touches: (head, lines) => lines.map((l) => ['proc_items', l.item_id]),
    createDoc: ({ deps, actor, head, lines, ip }) => {
      const { issueId } = createIssue(deps, actor, { warehouseId: head.warehouse_id, issuedTo: head.issued_to, purpose: head.purpose ?? '', lines: lines.map((l) => ({ itemId: l.item_id, qty: l.qty })) }, ip);
      deps.db.prepare('UPDATE proc_issues SET no = ?, issued_at = ? WHERE id = ?').run(head.no, head.issued_at, issueId);
      return issueId;
    },
    revertRow: ({ deps, actor, id }) => { deps.db.prepare('UPDATE proc_issues SET reversed_at = ?, reversed_by = ? WHERE id = ?').run(Date.now(), actor.id, id); } },
  { kind: 'proc_asset_moves', table: 'proc_asset_moves', title: 'حركات الأصول', group: 'procurement', perm: 'import:procurement', risk: 'high', key: ['asset_id', 'kind', 'moved_at'], deps: ['proc_assets', 'proc_warehouses'], stamp: { moved_by: 'actor' }, side: { proc_assets: 'id' }, undoKeepsRow: 2,
    desc: 'نقل الأصول وإتلافها وصيانتها وإعادتها. الصفوف تُطبَّق بترتيب الملف وتغيّر موقع الأصل وحالته. الحركة المسجلة لا تُعدَّل.',
    impactNote: 'يغيّر موقع الأصل وحالته. التراجع يعيدهما ويسجّل حركة معاكسة، ويُمنع إذا تغيّر الأصل بعد الاستيراد.',
    protect: () => 'هذه الحركة مسجلة ولا تُعدَّل.',
    derive: (v, row, ctx, side) => {
      if (row) return;
      const states = ctx.memo('assetStates', () => new Map());
      const state = states.get(v.asset_id) ?? ctx.db.prepare('SELECT warehouse_id, assigned_to, status FROM proc_assets WHERE id = ?').get(v.asset_id);
      if (v.kind === 'transfer' && !v.to_wh) fail('حدد المستودع الهدف للنقل.');
      v.from_wh = state.warehouse_id;
      const next = { warehouse_id: v.kind === 'transfer' ? v.to_wh : state.warehouse_id, assigned_to: v.kind === 'transfer' ? (v.to_user ?? '') : state.assigned_to, status: { dispose: 'disposed', maintenance: 'maintenance', return: 'available' }[v.kind] ?? state.status };
      states.set(v.asset_id, next);
      side.next = next;
    },
    after: ({ values, side, op, updateSide }) => { if (op === 'insert') updateSide('proc_assets', [values.asset_id], side.next); },
    revertRow: ({ deps, actor, id }) => {
      const m = deps.db.prepare('SELECT * FROM proc_asset_moves WHERE id = ?').get(id);
      deps.db.prepare('INSERT INTO proc_asset_moves (asset_id, kind, from_wh, to_wh, to_user, reason, moved_at, moved_by) VALUES (?,?,?,?,?,?,?,?)').run(m.asset_id, m.kind === 'transfer' ? 'transfer' : 'return', m.to_wh, m.from_wh, '', 'تراجع عن دفعة استيراد', Date.now(), actor.id);
    },
    columns: [req('asset_code', 'رمز الأصل', 'fk', { to: 'asset_id', fk: { table: 'proc_assets', by: ['code'], hint: 'رمز الأصل' } }), req('kind', 'نوع الحركة', 'enum', { options: { transfer: ['نقل'], dispose: ['إتلاف'], maintenance: ['صيانة'], return: ['إعادة'] }, example: 'صيانة' }),
      c('to_warehouse', 'المستودع الهدف', 'fk', { to: 'to_wh', fk: { table: 'proc_warehouses', by: ['code'], hint: 'رمز المستودع' } }), c('to_user', 'إلى المستخدم', 'text', { max: 80 }), c('reason', 'السبب', 'text', { max: 200 }), req('moved_date', 'تاريخ الحركة', 'dateEpoch', { to: 'moved_at', example: '2026-10-15' })] },

  /* ---------- القيود اليومية ---------- */
  { kind: 'fin_entries', table: 'fin_entries', linesTable: 'fin_lines', title: 'القيود اليومية', group: 'finance', perm: 'import:finance', risk: 'critical', key: ['reference'], keyScope: "source = 'import' AND reversed_by IS NULL", deps: ['fin_accounts', 'fin_cost_centers', 'fin_parties'],
    desc: 'قيد برأس وأسطر تربطهما رقم القيد. المدين يساوي الدائن إلزامياً. يُحفظ مسودة إلا إذا اخترت الترحيل. التراجع يحذف المسودة ويعكس المرحَّل بقيد عكسي.',
    impactNote: 'القيود المرحَّلة تغيّر أرصدة الحسابات فوراً، ولا تُعكس في سنة مالية مقفلة.',
    duplicateMsg: 'قيد بهذا الرقم استُورد من قبل؛ المستندات لا تُحدَّث من الاستيراد.',
    columns: [req('reference', 'رقم القيد', 'code', { max: 60, example: 'JV-SMPL-1' }), req('entry_day', 'التاريخ', 'date', { example: today() }), req('description', 'البيان', 'text', { max: 300, example: 'قيد تجريبي' }),
      c('type', 'النوع', 'enum', { options: { JV: ['قيد يومية'], RV: ['سند قبض'], PV: ['سند صرف'] }, default: 'JV', example: 'قيد يومية' }), bool('post', 'ترحيل', { sideOnly: true, default: 0, example: 'لا' })],
    lineColumns: [req('account_code', 'رمز الحساب', 'fk', { to: 'account_id', fk: { table: 'fin_accounts', by: ['code'], hint: 'رمز الحساب' }, list: (db) => db.prepare('SELECT code FROM fin_accounts WHERE postable = 1 AND active = 1 AND require_cc = 0 ORDER BY code').all().map((r) => r.code) }),
      c('debit', 'مدين', 'num', { min: 0, max: 100000000000, example: 100, example2: '' }), c('credit', 'دائن', 'num', { min: 0, max: 100000000000, example: '', example2: 100 }),
      c('cost_center', 'مركز الكلفة', 'fk', { to: 'cost_center_id', fk: { table: 'fin_cost_centers', by: ['code'], hint: 'رمز المركز' } }), c('party', 'الطرف', 'fk', { to: 'party_id', fk: { table: 'fin_parties', by: ['name'], hint: 'اسم الطرف' } }),
      c('student', 'الرقم الجامعي', 'fk', { to: 'student_id', fk: { table: 'users', by: ['student_no'], hint: 'الرقم الجامعي', noList: true } }), c('line_note', 'بيان السطر', 'text', { to: 'note', max: 200 })],
    validateDoc: (head, lines, ctx, side) => {
      const closed = openYear(ctx, head.entry_day); if (closed) return closed;
      if (lines.length < 2) return 'القيد يحتاج سطرين على الأقل.';
      if (lines.length > 200) return 'عدد أسطر القيد حتى 200.';
      let debit = 0, credit = 0;
      for (const [i, l] of lines.entries()) {
        const acc = ctx.db.prepare('SELECT name, active, postable, require_cc FROM fin_accounts WHERE id = ?').get(l.account_id);
        if (!acc.active) return `السطر ${i + 1}: الحساب «${acc.name}» معطّل.`;
        if (!acc.postable) return `السطر ${i + 1}: الحساب «${acc.name}» تجميعي لا تُرحَّل عليه قيود.`;
        if (acc.require_cc && !l.cost_center_id) return `السطر ${i + 1}: الحساب «${acc.name}» يتطلب مركز كلفة.`;
        if ((Number(l.debit) > 0) === (Number(l.credit) > 0)) return `السطر ${i + 1}: أدخل مبلغاً مديناً أو دائناً (واحداً فقط).`;
        debit += toMinor(l.debit ?? 0); credit += toMinor(l.credit ?? 0);
      }
      if (debit !== credit) return `القيد غير متوازن: المدين ${debit / 100} والدائن ${credit / 100}.`;
      if (side.post && getSetting(ctx.db, 'finance.separate_poster')) return 'سياسة فصل المهام تمنع من يستورد القيد من ترحيله؛ استورده مسودة.';
      return null;
    },
    createDoc: ({ deps, actor, head, lines, side, ip }) => createEntry(deps, actor, { type: head.type, day: head.entry_day, description: head.description, reference: head.reference, post: !!side.post, lines: lines.map((l) => ({ accountId: l.account_id, debit: l.debit, credit: l.credit, costCenterId: l.cost_center_id, partyId: l.party_id, studentId: l.student_id, note: l.note ?? '' })) }, ip, { source: 'import' }).id,
    revertRow: ({ deps, actor, id, ip }) => {
      const e = deps.db.prepare('SELECT status FROM fin_entries WHERE id = ?').get(id);
      if (e.status !== 'posted') { deps.db.prepare('DELETE FROM fin_lines WHERE entry_id = ?').run(id); deps.db.prepare('DELETE FROM fin_entries WHERE id = ?').run(id); return; }
      entryYearStillOpen(deps.db, id);
      reverseEntry(deps, actor, id, { reason: 'تراجع عن دفعة استيراد' }, ip);
    } },

  /* ---------- الطلاب والقبول ---------- */
  { kind: 'sa_applicants', table: 'sa_applicants', title: 'المتقدمون للقبول', group: 'students', perm: 'import:academic', risk: 'medium', key: ['application_no'], deps: ['programs'], stamp: NOW,
    desc: 'طلبات المفاضلة. المتقدم الذي ثُبّت قيده لا يُعدَّل من الاستيراد، ولا يُنشئ الاستيراد حسابات دخول.',
    protect: (row) => (row.sorting_status === 'enrolled' ? 'ثُبّت قيد هذا المتقدم ولا يُعدَّل من الاستيراد.' : null),
    columns: [req('application_no', 'رقم الطلب', 'code', { max: 30, example: 'ADM-SMPL-1' }), req('full_name', 'الاسم الكامل', 'text', { max: 120, example: 'متقدم تجريبي' }), req('national_id', 'الرقم الوطني', 'code', { max: 20, example: '00000000001' }), c('phone', 'الهاتف', 'tel'), c('hs_type', 'نوع الشهادة', 'text', { max: 60, default: 'علمي', example: 'علمي' }), req('hs_score', 'مجموع الثانوية', 'num', { min: 0, max: 1000, example: 220 }), c('hs_year', 'سنة الشهادة', 'int', { min: 1950, max: 2100, default: new Date().getFullYear(), example: 2026 }),
      c('category', 'فئة القبول', 'enum', { options: { general: ['عام'], parallel: ['موازي'], martyrs: ['ذوو الشهداء'], transfer: ['تحويل'] }, default: 'general', example: 'عام' }),
      req('pref1', 'الرغبة الأولى', 'fk', { to: 'pref1_program_id', fk: { table: 'programs', by: ['name'], hint: 'اسم البرنامج' } }), c('pref2', 'الرغبة الثانية', 'fk', { to: 'pref2_program_id', fk: { table: 'programs', by: ['name'], hint: 'اسم البرنامج' } }), c('pref3', 'الرغبة الثالثة', 'fk', { to: 'pref3_program_id', fk: { table: 'programs', by: ['name'], hint: 'اسم البرنامج' } }), c('notes', 'ملاحظات', 'text', { max: 200 })] },
  { kind: 'student_holds', table: 'student_holds', title: 'ذمم وموانع الطلاب', group: 'students', perm: 'import:academic', risk: 'medium', key: ['student_id', 'hold_type', 'note'], deps: ['students'], stamp: { created_by: 'actor', created_at: 'now' },
    desc: 'الذمم المالية والانضباطية وذمم المكتبة. الطالب والنوع والملاحظة معاً مفتاح التحديث.',
    impactNote: 'الذمة الفعالة تحجب عن الطالب الخدمات والوثائق المرتبطة بها.',
    columns: [studentFk(), req('hold_type', 'نوع الذمة', 'enum', { options: { financial: ['مالية'], disciplinary: ['انضباطية'], library: ['مكتبة'] }, example: 'مالية' }), c('note', 'الملاحظة', 'text', { max: 200, default: '', example: 'ذمة تجريبية' }), active()] },
  { kind: 'sa_credit_equivalences', table: 'sa_credit_equivalences', title: 'معادلة المقررات', group: 'students', perm: 'import:academic', risk: 'medium', key: ['student_id', 'source_university', 'external_course_code'], deps: ['students', 'courses'], stamp: { decided_by: 'actorName', created_at: 'now' }, side: { grades: 'id' },
    desc: 'مقررات الطلاب المحولين. المعادلة المعتمدة ترصد علامة المقرر إن لم تكن له علامة، كما تفعل الشاشة.',
    impactNote: 'المعادلة المعتمدة تضيف علامة إلى سجل الطالب إن لم تكن له علامة في المقرر.',
    after: ({ db, actor, values, op, insertSide, now }) => {
      if (op !== 'insert' || values.equivalence_status !== 'approved') return;
      if (db.prepare('SELECT id FROM grades WHERE student_id = ? AND course_id = ?').get(values.student_id, values.internal_course_id)) return;
      const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(values.internal_course_id);
      const mark = Math.round(values.external_mark);
      insertSide('grades', { student_id: values.student_id, course_id: course.id, course: course.name, term: 'الفصل الأول', hours: course.hours || values.external_hours, mark, theory_mark: mark, academic_year: 'معادلة نقل', semester: course.semester || 1, level: course.level || 1, workflow_status: 'approved', entered_by: actor.id, entered_at: now, approved_by: actor.id, approved_at: now });
    },
    columns: [studentFk(), req('source_university', 'الجامعة المصدر', 'text', { max: 120, example: 'جامعة تجريبية' }), req('external_course_code', 'رمز المقرر الخارجي', 'code', { max: 30, example: 'EXT-SMPL' }), req('external_course_name', 'اسم المقرر الخارجي', 'text', { max: 120, example: 'مقرر خارجي' }), c('external_hours', 'الساعات', 'int', { min: 0, max: 12, default: 3, example: 3 }), req('external_mark', 'العلامة', 'num', { min: 0, max: 100, example: 75 }), courseFk('internal_course', 'رمز المقرر المقابل', 'internal_course_id', { required: true }),
      c('equivalence_status', 'الحالة', 'enum', { options: { approved: ['معتمدة'], pending: ['قيد الدراسة'], rejected: ['مرفوضة'] }, default: 'approved', example: 'معتمدة' }), c('note', 'ملاحظات', 'text', { max: 200 })] },
  { kind: 'sa_advising_warnings', table: 'sa_advising_warnings', title: 'الإنذارات الإرشادية', group: 'students', perm: 'import:academic', risk: 'medium', key: ['student_id', 'session_date', 'warning_type'], deps: ['students'], stamp: NOW,
    desc: 'جلسات الإرشاد والإنذار المبكر. الطالب والتاريخ والنوع معاً مفتاح التحديث.',
    columns: [studentFk(), req('warning_type', 'نوع الإنذار', 'enum', { options: { gpa_low: ['انخفاض المعدل'], repeated_fail: ['رسوب متكرر'], absence_high: ['غياب مرتفع'] }, example: 'انخفاض المعدل' }), c('severity', 'الشدة', 'enum', { options: { warning: ['تحذير'], critical: ['حرج'], probation: ['مراقبة أكاديمية'] }, default: 'warning', example: 'تحذير' }), req('advisor_name', 'المرشد', 'text', { max: 100, example: 'مرشد تجريبي' }), req('action_plan', 'الخطة العلاجية', 'text', { max: 500, example: 'متابعة أسبوعية' }), req('session_date', 'تاريخ الجلسة', 'date', { example: '2026-02-01' }), c('gpa_snapshot', 'المعدل', 'num', { min: 0, max: 100 }), c('absence_rate', 'نسبة الغياب', 'num', { min: 0, max: 100 }), c('failed_courses_count', 'المقررات الراسبة', 'int', { min: 0, max: 100, default: 0 }), c('status', 'الحالة', 'enum', { options: { open: ['مفتوح'], resolved: ['مغلق'] }, default: 'open', example: 'مفتوح' })] },
  { kind: 'sa_lifecycle_movements', table: 'sa_lifecycle_movements', title: 'حركات القيد', group: 'students', perm: 'import:academic', risk: 'high', key: ['movement_no'], deps: ['students'], stamp: { created_by: 'actorName', created_at: 'now' }, side: { student_profiles: 'user_id' },
    desc: 'التأجيل والإيقاف والانسحاب وإعادة القيد والنقل. الصفوف تُطبَّق بترتيب الملف، والحركة المسجلة لا تُعدَّل.',
    impactNote: 'كل حركة تغيّر حالة قيد الطالب فوراً، وقد تغيّر برنامجه.',
    protect: () => 'حركة بهذا الرقم مسجلة ولا تُعدَّل؛ سجّل حركة جديدة.',
    derive: (v, row, ctx, side) => {
      const profiles = ctx.memo('lifecycle', () => new Map());
      let prof = profiles.get(v.student_id);
      if (!prof) { prof = ctx.db.prepare('SELECT status, program_id FROM student_profiles WHERE user_id = ?').get(v.student_id); if (!prof) fail('لا يوجد ملف قيد لهذا الطالب.'); prof = { status: prof.status, program: prof.program_id }; }
      if (v.movement_type === 'program_transfer' && !side.to_program) fail('حركة النقل تحتاج إلى البرنامج الجديد.');
      let toProgram = prof.program;
      if (side.to_program) {
        const found = ctx.db.prepare('SELECT id FROM programs WHERE name = ? AND active = 1').all(side.to_program);
        if (found.length !== 1) fail(`البرنامج «${side.to_program}» غير موجود أو يتكرر اسمه.`);
        toProgram = found[0].id;
      }
      const to = LIFECYCLE_STATUS[v.movement_type], impact = LIFECYCLE_IMPACT[v.movement_type];
      Object.assign(v, { from_status: prof.status, to_status: to, from_program_id: prof.program, to_program_id: toProgram, financial_impact: impact.fin, academic_impact: impact.acad });
      profiles.set(v.student_id, { status: to, program: toProgram });
    },
    after: ({ values, updateSide, now }) => updateSide('student_profiles', [values.student_id], { status: values.to_status, program_id: values.to_program_id }, { updated_at: now }),
    columns: [req('movement_no', 'رقم الحركة', 'code', { max: 30, example: 'MOV-SMPL-1' }), studentFk(), req('movement_type', 'نوع الحركة', 'enum', { options: { postponement: ['تأجيل'], suspension: ['إيقاف'], withdrawal: ['انسحاب'], reinstatement: ['إعادة قيد'], program_transfer: ['نقل برنامج'] }, example: 'تأجيل' }), req('academic_year', 'العام الدراسي', 'text', { max: 20, example: '2025-2026' }), c('semester', 'الفصل', 'int', { min: 1, max: 3, default: 1, example: 1 }), req('reason', 'السبب', 'text', { max: 300, example: 'ظروف صحية' }), c('decision_no', 'رقم القرار', 'text', { max: 60 }), c('to_program', 'البرنامج الجديد', 'text', { max: 80, sideOnly: true })] },
  { kind: 'student_self_enrollments', table: 'student_self_enrollments', title: 'التسجيل الذاتي في المقررات', group: 'students', perm: 'import:academic', risk: 'medium', key: ['student_no', 'course_code', 'semester'], deps: ['students'], stamp: { registered_at: 'now' },
    desc: 'تسجيل الطلاب في المقررات. الطالب والمقرر والفصل معاً مفتاح التحديث.',
    columns: [studentNoFk(), req('course_code', 'رمز المقرر', 'code', { max: 30, example: 'SMPL-101' }), req('course_name', 'اسم المقرر', 'text', { max: 120, example: 'مقرر تجريبي' }), c('credits', 'الساعات', 'int', { min: 0, max: 12, default: 3, example: 3 }), c('semester', 'الفصل', 'text', { max: 60, default: 'الفصل الأول 2026/2027', example: 'الفصل الأول 2026/2027' }), c('prerequisite_code', 'رمز المتطلب', 'code', { max: 30 }), c('status', 'الحالة', 'text', { max: 30, default: 'مسجل' })] },
  { kind: 'grade_appeals', table: 'grade_appeals', title: 'تظلمات العلامات', group: 'students', perm: 'import:academic', risk: 'medium', key: ['student_no', 'course_code'], deps: ['students'], stamp: NOW,
    desc: 'طلبات التظلم قبل البت فيها. التظلم الذي بُتّ فيه لا يُعدَّل من الاستيراد.',
    protect: (row) => (row.status !== 'قيد اللجنة' ? 'بُتّ في هذا التظلم ولا يُعدَّل من الاستيراد.' : null),
    columns: [studentNoFk(), req('course_code', 'رمز المقرر', 'code', { max: 30, example: 'SMPL-101' }), req('course_name', 'اسم المقرر', 'text', { max: 120, example: 'مقرر تجريبي' }), req('old_mark', 'العلامة المعلنة', 'num', { min: 0, max: 100, example: 60 }), req('reason', 'سبب التظلم', 'text', { max: 300, example: 'مراجعة الجمع' })] },
  { kind: 'office_hour_bookings', table: 'office_hour_bookings', title: 'حجوزات الساعات المكتبية', group: 'students', perm: 'import:academic', risk: 'low', key: ['faculty_name', 'student_no', 'slot_day', 'slot_time'], deps: ['students'], stamp: NOW,
    desc: 'مواعيد الطلاب مع أعضاء الهيئة التدريسية.',
    columns: [req('faculty_name', 'عضو الهيئة', 'text', { max: 100, example: 'د. مثال تجريبي' }), studentNoFk(), req('slot_day', 'اليوم', 'text', { max: 30, example: 'الأحد' }), req('slot_time', 'الوقت', 'text', { max: 30, example: '10:00 - 10:30' }), req('topic', 'الموضوع', 'text', { max: 200, example: 'استشارة أكاديمية' }), c('status', 'الحالة', 'text', { max: 30, default: 'مؤكد' })] },

  /* ---------- مالية الطلاب ---------- */
  { kind: 'student_fee_installments', table: 'student_fee_installments', title: 'أقساط الرسوم', group: 'student_fin', perm: 'import:student_fin', risk: 'high', key: ['installment_code'], deps: ['students'],
    desc: 'أقساط رسوم الطلاب. كل صف يُنشئ استحقاقاً مالياً، والمبلغ المسدد يُنشئ دفعة. الحالة تُحسب من المبلغ المسدد، والقسط المسدد بالكامل لا يُعدَّل.',
    impactNote: 'كل صف يُرحَّل قيداً محاسبياً، والمبالغ تظهر في رصيد الطالب.',
    protect: (row) => (Number(row.paid_at) ? 'هذا القسط مسدد ولا يُعدَّل من الاستيراد.' : null),
    validate: (v, row, ctx) => {
      if (Number(v.paid_amount ?? row?.paid_amount ?? 0) > Number(v.amount ?? row?.amount)) return 'المبلغ المسدد أكبر من قيمة القسط.';
      if (row) return null;
      return openYear(ctx, String(v.due_date).slice(0, 10)) || (ctx.db.prepare("SELECT 1 AS x FROM fin_fee_types WHERE kind = 'fee' AND active = 1 LIMIT 1").get() ? null : 'عرّف نوع رسم في المالية قبل استيراد الأقساط.');
    },
    createRow: ({ deps, actor, values, ip }) => {
      const { db } = deps, cols = Object.keys(values), q = (k) => `"${k}"`;
      const id = Number(db.prepare(`INSERT INTO student_fee_installments (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((k) => values[k])).lastInsertRowid);
      const stu = db.prepare("SELECT id FROM users WHERE student_no = ? AND role = 'student'").get(values.student_no);
      if (!stu) throw new Error('لا يوجد حساب طالب بهذا الرقم الجامعي.');
      const fee = db.prepare("SELECT id FROM fin_fee_types WHERE kind = 'fee' AND active = 1 ORDER BY id LIMIT 1").get();
      const charge = createCharge(deps, actor, { studentId: stu.id, feeTypeId: fee.id, amount: values.amount, dueDay: String(values.due_date).slice(0, 10), note: `قسط ${values.installment_code}` }, ip);
      const paid = Number(values.paid_amount) > 0 ? createPayment(deps, actor, { studentId: stu.id, amount: values.paid_amount, note: `قسط ${values.installment_code}` }, ip) : null;
      db.prepare('UPDATE student_fee_installments SET fin_charge_id = ?, fin_payment_id = ? WHERE id = ?').run(charge.id, paid?.payment.id ?? null, id);
      return id;
    },
    revertRow: ({ deps, actor, id, ip }) => {
      const { db } = deps, row = db.prepare('SELECT fin_charge_id, fin_payment_id FROM student_fee_installments WHERE id = ?').get(id);
      if (row?.fin_payment_id) voidPayment(deps, actor, row.fin_payment_id, { reason: 'تراجع عن دفعة استيراد' }, ip);
      if (row?.fin_charge_id) voidCharge(deps, actor, row.fin_charge_id, { reason: 'تراجع عن دفعة استيراد' }, ip);
      db.prepare('DELETE FROM student_fee_installments WHERE id = ?').run(id);   // القيود تُعكس وتبقى، أما القسط نفسه فليس قيداً
    },
    derive: (v, row) => {
      const amount = Number(v.amount ?? row?.amount), paid = Number(v.paid_amount ?? row?.paid_amount ?? 0);
      v.paid_amount = paid;
      v.status = paid >= amount ? 'مسدد بالكامل' : paid > 0 ? 'مسدد جزئياً' : 'غير مسدد';
      v.paid_at = paid >= amount ? Date.now() : 0;
    },
    columns: [req('installment_code', 'رمز القسط', 'code', { max: 30, example: 'INST-SMPL-1' }), studentNoFk(), req('faculty_name', 'الجهة', 'text', { max: 120, list: universityDepartments }), req('installment_no', 'رقم القسط', 'int', { min: 1, max: 60, example: 1 }), req('amount', 'قيمة القسط', 'num', { min: 0, max: 1e13, example: 500000 }), req('due_date', 'تاريخ الاستحقاق', 'date', { example: '2026-12-01' }), c('paid_amount', 'المبلغ المسدد', 'num', { min: 0, max: 1e13 }), c('payment_method', 'طريقة الدفع', 'text', { max: 40 }), c('receipt_no', 'رقم الإيصال', 'code', { max: 40 })] },
  { kind: 'fin_charges', table: 'fin_charges', title: 'المستحقات المالية', group: 'student_fin', perm: 'import:student_fin', risk: 'high', key: ['student_id', 'fee_type_id', 'due_day'], keyScope: "status = 'open'", deps: ['students', 'fin_fee_types'], undoKeepsRow: true,
    desc: 'مستحقات الطلاب. كل صف يُنشئ قيداً محاسبياً مرحَّلاً، والتراجع يعكس القيد ويلغي الاستحقاق ولا يحذفه.',
    impactNote: 'كل صف يُرحَّل قيداً محاسبياً إلى دفتر الأستاذ.',
    protect: () => 'يوجد استحقاق مفتوح مطابق لهذا الطالب ونوع الرسم وتاريخ الاستحقاق.',
    validate: (v, row, ctx) => openYear(ctx, v.due_day),
    createRow: ({ deps, actor, values, ip }) => createCharge(deps, actor, { studentId: values.student_id, feeTypeId: values.fee_type_id, amount: values.amount, dueDay: values.due_day, academicYear: values.academic_year, note: values.note ?? '' }, ip).id,
    revertRow: ({ deps, actor, id, ip }) => {
      const row = deps.db.prepare('SELECT entry_id FROM fin_charges WHERE id = ?').get(id);
      entryYearStillOpen(deps.db, row.entry_id);
      voidCharge(deps, actor, id, { reason: 'تراجع عن دفعة استيراد' }, ip);
    },
    columns: [studentFk(), req('fee_type', 'نوع الرسم', 'fk', { to: 'fee_type_id', fk: { table: 'fin_fee_types', by: ['code'], hint: 'رمز نوع الرسم' } }), req('amount', 'المبلغ', 'num', { min: 0.01, max: 1e13, example: 1000 }), req('due_day', 'تاريخ الاستحقاق', 'date', { example: today() }), c('academic_year', 'العام الدراسي', 'text', { max: 20 }), c('note', 'ملاحظة', 'text', { max: 200 })] },
  { kind: 'fin_payments', table: 'fin_payments', title: 'إيصالات القبض', group: 'student_fin', perm: 'import:student_fin', risk: 'high', key: ['receipt_no'], deps: ['students'], undoKeepsRow: true,
    desc: 'الدفعات المستلمة. كل صف يُنشئ قيد قبض مرحَّلاً، والتراجع يعكس القيد ويلغي الإيصال ولا يحذفه.',
    impactNote: 'كل صف يزيد رصيد الصندوق أو المصرف ويخفض ذمة الطالب بقيد مرحَّل.',
    protect: () => 'إيصال بهذا الرقم موجود مسبقاً ولا يُعدَّل.',
    validate: (v, row, ctx) => openYear(ctx, v.paid_day),
    createRow: ({ deps, actor, values, ip }) => {
      createPayment(deps, actor, { receiptNo: values.receipt_no, studentId: values.student_id, amount: values.amount, method: values.method, paidDay: values.paid_day, note: values.note ?? '' }, ip);
      return deps.db.prepare('SELECT id FROM fin_payments WHERE receipt_no = ?').get(values.receipt_no).id;
    },
    revertRow: ({ deps, actor, id, ip }) => {
      const row = deps.db.prepare('SELECT entry_id FROM fin_payments WHERE id = ?').get(id);
      entryYearStillOpen(deps.db, row.entry_id);
      voidPayment(deps, actor, id, { reason: 'تراجع عن دفعة استيراد' }, ip);
    },
    columns: [req('receipt_no', 'رقم الإيصال', 'code', { max: 40, example: 'RCP-SMPL-1' }), studentFk(), req('amount', 'المبلغ', 'num', { min: 0.01, max: 1e13, example: 1000 }), req('method', 'الطريقة', 'enum', { options: { cash: ['نقداً', 'نقدي'], bank: ['مصرف', 'بنك'] }, example: 'نقداً' }), req('paid_day', 'تاريخ الدفع', 'date', { example: today() }), c('note', 'ملاحظة', 'text', { max: 200 })] },
  { kind: 'sa_scholarships', table: 'sa_scholarships', title: 'المنح المعتمدة', group: 'student_fin', perm: 'import:student_fin', risk: 'high', key: ['grant_no'], deps: ['students', 'fin_fee_types'], stamp: { approved_by: 'actorName', created_at: 'now' },
    desc: 'المنح والحسومات. كل منحة تُرحَّل خصماً إلى حساب الطالب، والتراجع يعكس القيد ويحذف المنحة، والمنحة المسجلة لا تُعدَّل.',
    impactNote: 'كل منحة تخفض ذمة الطالب بقيد خصم مرحَّل.',
    protect: () => 'منحة بهذا الرقم مسجلة ولا تُعدَّل.',
    validate: (v, row, ctx) => openYear(ctx, today()) || (ctx.db.prepare("SELECT 1 AS x FROM fin_fee_types WHERE kind = 'discount' AND active = 1 LIMIT 1").get() ? null : 'عرّف نوع رسم من فئة «خصم» قبل استيراد المنح.'),
    createRow: ({ deps, actor, values, ip }) => {
      const { db } = deps, fee = db.prepare("SELECT id FROM fin_fee_types WHERE kind = 'discount' AND active = 1 ORDER BY id LIMIT 1").get();
      const charge = createCharge(deps, actor, { studentId: values.student_id, feeTypeId: fee.id, amount: values.amount, dueDay: today(), academicYear: values.academic_year, note: `منحة ${values.grant_no}` }, ip);
      const cols = { ...values, fin_charge_id: charge.id }, names = Object.keys(cols);
      return db.prepare(`INSERT INTO sa_scholarships (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k])).lastInsertRowid;
    },
    revertRow: ({ deps, actor, id, ip }) => {
      const { db } = deps, row = db.prepare('SELECT fin_charge_id FROM sa_scholarships WHERE id = ?').get(id);
      const charge = db.prepare('SELECT id, entry_id, status FROM fin_charges WHERE id = ?').get(row.fin_charge_id);
      if (charge) { entryYearStillOpen(db, charge.entry_id); if (charge.status === 'open') voidCharge(deps, actor, charge.id, { reason: 'تراجع عن دفعة استيراد' }, ip); }
      db.prepare('DELETE FROM sa_scholarships WHERE id = ?').run(id);
    },
    columns: [req('grant_no', 'رقم المنحة', 'code', { max: 30, example: 'SCH-SMPL-1' }), studentFk(), req('scholarship_type', 'نوع المنحة', 'text', { max: 60, example: 'تفوق أكاديمي' }), req('discount_percent', 'نسبة الحسم', 'num', { min: 0, max: 100, example: 50 }), req('amount', 'قيمة المنحة', 'num', { min: 0.01, max: 1e13, example: 750000 }), c('academic_year', 'العام الدراسي', 'text', { max: 20, default: '2026/2027', example: '2026/2027' }), c('gpa_at_grant', 'المعدل عند المنح', 'num', { min: 0, max: 100 }), c('note', 'ملاحظة', 'text', { max: 200 })] },
  { kind: 'alumni_records', table: 'alumni_records', title: 'سجل الخريجين', group: 'misc', perm: 'import:misc', risk: 'low', key: ['student_no'], stamp: NOW,
    desc: 'الخريجون، ومنهم من ليس له حساب في النظام. رمز التوثيق يُولَّد تلقائياً.',
    derive: (v, row) => { if (!row) v.verified_code = `GRAD-${v.grad_year}-${String(v.student_no).replace(/[^A-Za-z0-9]/g, '')}`; },
    columns: [req('student_no', 'الرقم الجامعي', 'code', { max: 40, example: 'GRAD-SMPL-1' }), req('full_name', 'الاسم الكامل', 'text', { max: 120, example: 'خريج تجريبي' }), req('faculty_name', 'الكلية', 'text', { max: 120, example: 'كلية تجريبية' }), req('program_name', 'البرنامج', 'text', { max: 120, example: 'برنامج تجريبي' }), req('grad_year', 'سنة التخرج', 'int', { min: 1950, max: 2100, example: 2025 }), req('gpa', 'المعدل', 'num', { min: 0, max: 100, example: 85 }), c('honor_rank', 'التقدير', 'text', { max: 40, default: 'جيد جداً', example: 'جيد جداً' }), c('current_employer', 'جهة العمل', 'text', { max: 120 }), c('job_title', 'المسمى الوظيفي', 'text', { max: 100 }), c('email', 'البريد', 'email'), c('phone', 'الهاتف', 'tel')] },
  { kind: 'career_jobs', table: 'career_jobs', title: 'فرص التوظيف', group: 'misc', perm: 'import:misc', risk: 'low', key: ['title', 'company_name'], stamp: NOW,
    desc: 'فرص العمل والتدريب. المسمى والشركة معاً مفتاح التحديث.',
    columns: [req('title', 'المسمى الوظيفي', 'text', { max: 150, example: 'وظيفة تجريبية' }), req('company_name', 'الشركة', 'text', { max: 120, example: 'شركة تجريبية' }), req('sector', 'القطاع', 'text', { max: 80, example: 'تقانة' }), req('location', 'الموقع', 'text', { max: 60, example: 'دمشق' }), c('job_type', 'نوع الدوام', 'text', { max: 40, default: 'دوام كامل', example: 'دوام كامل' }), c('salary_range', 'الراتب', 'text', { max: 80 }), c('requirements', 'المتطلبات', 'text', { max: 300 }), c('deadline', 'آخر موعد', 'date'), active()] },
  { kind: 'career_applications', table: 'career_applications', title: 'طلبات التوظيف', group: 'misc', perm: 'import:misc', risk: 'low', key: ['job_id', 'student_no'], deps: ['career_jobs'], stamp: { applied_at: 'now' }, side: { career_jobs: 'id' },
    desc: 'طلبات المتقدمين للوظائف. يزيد عدد المتقدمين في الوظيفة عند كل طلب جديد.',
    after: ({ db, values, op, updateSide }) => { if (op === 'insert') updateSide('career_jobs', [values.job_id], { applicants_count: Number(db.prepare('SELECT applicants_count FROM career_jobs WHERE id = ?').get(values.job_id).applicants_count) + 1 }); },
    columns: [req('job_title', 'المسمى الوظيفي', 'fk', { to: 'job_id', fk: { table: 'career_jobs', by: ['title'], hint: 'مسمى الوظيفة' } }), req('applicant_name', 'اسم المتقدم', 'text', { max: 100, example: 'متقدم تجريبي' }), req('student_no', 'الرقم الجامعي', 'code', { max: 40, example: 'GRAD-SMPL-1' }), c('gpa', 'المعدل', 'num', { min: 0, max: 100, default: 0, example: 85 }), c('cv_summary', 'ملخص السيرة', 'text', { max: 400 }), c('status', 'الحالة', 'text', { max: 30, default: 'قيد المراجعة' })] },
  { kind: 'postgrad_theses', table: 'postgrad_theses', title: 'رسائل الدراسات العليا', group: 'misc', perm: 'import:misc', risk: 'low', key: ['student_no', 'title'], stamp: NOW,
    desc: 'رسائل الماجستير والدكتوراه. الطالب والعنوان معاً مفتاح التحديث.',
    columns: [req('student_no', 'الرقم الجامعي', 'code', { max: 40, example: 'PG-SMPL-1' }), req('student_name', 'اسم الطالب', 'text', { max: 100, example: 'باحث تجريبي' }), c('degree', 'الدرجة', 'text', { max: 30, default: 'ماجستير', example: 'ماجستير' }), req('program_name', 'البرنامج', 'text', { max: 100, example: 'برنامج تجريبي' }), req('title', 'عنوان الرسالة', 'text', { max: 200, example: 'رسالة تجريبية' }), req('supervisor_name', 'المشرف', 'text', { max: 100, example: 'د. مثال تجريبي' }), c('co_supervisor', 'المشرف المشارك', 'text', { max: 100 }), c('stage', 'المرحلة', 'text', { max: 60, default: 'كتابة الأطروحة' }), c('defense_date', 'تاريخ المناقشة', 'date'), c('grade_label', 'التقدير', 'text', { max: 60, default: 'قيد الإعداد' })] },
  { kind: 'research_projects', table: 'research_projects', title: 'المشاريع البحثية', group: 'misc', perm: 'import:misc', risk: 'low', key: ['code'], stamp: NOW,
    desc: 'المشاريع البحثية والنشر العلمي.',
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'RES-SMPL-1' }), req('title', 'العنوان', 'text', { max: 200, example: 'بحث تجريبي' }), req('principal_investigator', 'الباحث الرئيسي', 'text', { max: 100, example: 'د. مثال تجريبي' }), req('faculty_name', 'الكلية', 'text', { max: 100, example: 'كلية تجريبية' }), req('domain', 'المجال', 'text', { max: 100, example: 'الأمن السيبراني' }), c('budget', 'الميزانية', 'num', { min: 0, max: 1e13, default: 0, example: 0 }), c('journal_name', 'المجلة', 'text', { max: 150 }), c('impact_factor', 'معامل التأثير', 'num', { min: 0, max: 500, default: 0 }), c('citations_count', 'الاقتباسات', 'int', { min: 0, max: 1e7, default: 0 }), c('status', 'الحالة', 'text', { max: 20, default: 'active' }), c('published_at', 'تاريخ النشر', 'date')] },
  { kind: 'student_activities', table: 'student_activities', title: 'الأنشطة الطلابية', group: 'misc', perm: 'import:misc', risk: 'low', key: ['club_name', 'title', 'event_date'],
    desc: 'فعاليات الأندية الطلابية.',
    columns: [req('club_name', 'النادي', 'text', { max: 100, example: 'نادي تجريبي' }), req('title', 'العنوان', 'text', { max: 150, example: 'نشاط تجريبي' }), c('category', 'الفئة', 'text', { max: 40, default: 'علمي', example: 'علمي' }), req('event_date', 'التاريخ', 'date', { example: '2026-12-10' }), req('location', 'المكان', 'text', { max: 100, example: 'القاعة 1' }), req('supervisor_name', 'المشرف', 'text', { max: 100, example: 'د. مثال تجريبي' }), c('participants_count', 'المشاركون', 'int', { min: 0, max: 100000, default: 0, example: 25 }), c('budget', 'الميزانية', 'num', { min: 0, max: 1e13, default: 0 }), c('status', 'الحالة', 'text', { max: 30, default: 'قادم' })] },

  /* ---------- السكن والمكتبة ---------- */
  { kind: 'dorm_buildings', table: 'dorm_buildings', title: 'مباني السكن', group: 'misc', perm: 'import:misc', risk: 'low', key: ['name'], stamp: NOW,
    desc: 'مباني السكن الجامعي وقسم كل مبنى (ذكور أو إناث). تُستورد قبل الغرف.',
    columns: [req('name', 'اسم المبنى', 'text', { max: 100, example: 'مبنى تجريبي' }), req('gender', 'القسم', 'enum', { options: { 'ذكور': ['ذكور'], 'إناث': ['إناث'] }, example: 'ذكور' }), c('notes', 'ملاحظات', 'text', { max: 300, example: 'مبنى جديد' })] },
  { kind: 'housing_handouts', table: 'housing_handouts', title: 'مواد السكن المسلمة', group: 'misc', perm: 'import:misc', risk: 'low', key: ['handout_no'], deps: ['students'], stamp: NOW,
    desc: 'المواد المسلمة لطلاب السكن. اكتب أسماء المواد مفصولة بفاصلة كما في قائمة الإعدادات العامة، وأضف ×2 بعد الاسم للكمية.',
    derive: (v, row, ctx, side) => {
      const allowed = new Set(getSetting(ctx.db, 'housing.supply_items'));
      const items = String(side.items ?? '').split(/[,،]/).map((s) => s.trim()).filter(Boolean).map((s) => { const m = s.match(/^(.*?)\s*[×x]\s*(\d+)$/); return { name: m ? m[1].trim() : s, qty: m ? Number(m[2]) : 1, serial: '' }; });
      if (!items.length) fail('اكتب مادة واحدة على الأقل.');
      for (const it of items) if (!allowed.has(it.name)) fail(`«${it.name}» ليست في قائمة المواد في الإعدادات العامة.`);
      v.items_json = JSON.stringify(items);
      const place = ctx.db.prepare("SELECT r.building_name, r.room_no FROM dorm_allocations a JOIN dorm_rooms r ON r.id = a.room_id WHERE a.student_no = ? AND a.status = 'ساكن' LIMIT 1").get(v.student_no);
      v.room_label = place ? `${place.building_name} / ${place.room_no}` : '';
      v.faculty_name = ctx.db.prepare('SELECT g.faculty AS f FROM users u JOIN student_profiles p ON p.user_id = u.id JOIN programs g ON g.id = p.program_id WHERE u.student_no = ?').get(v.student_no)?.f ?? '';
    },
    columns: [req('handout_no', 'رقم السجل', 'code', { max: 40, example: 'HND-SMPL-1' }), studentNoFk(), req('items', 'المواد', 'text', { max: 1000, sideOnly: true, example: 'سرير، فرشة، كمبيوتر محمول' }), req('handed_day', 'تاريخ التسليم', 'date', { example: '2026-10-01' }), c('returned_day', 'تاريخ الإرجاع', 'date'), c('note', 'ملاحظات', 'text', { max: 300, example: 'تسليم أولي' }), c('handed_by', 'المسلِّم', 'text', { max: 100, example: 'أمين السكن' })] },
  { kind: 'dorm_rooms', table: 'dorm_rooms', title: 'غرف السكن', group: 'misc', perm: 'import:misc', risk: 'low', key: ['building_name', 'room_no'],
    deps: ['dorm_buildings'],
    desc: 'غرف السكن الجامعي. عدد الساكنين يأتي من الإسكان لا من الملف.',
    validate: (v, row) => (row && v.capacity !== undefined && v.capacity < Number(row.occupied) ? 'السعة أقل من عدد الساكنين الحاليين.' : null),
    derive: (v, row) => { if (!row) v.occupied = 0; },
    columns: [req('building_name', 'المبنى', 'text', { max: 100, example: 'مبنى تجريبي 2' }), req('room_no', 'رقم الغرفة', 'code', { max: 20, example: '201' }), c('floor_no', 'الطابق', 'int', { min: -5, max: 100, default: 1, example: 2 }), c('capacity', 'السعة', 'int', { min: 1, max: 50, default: 2, example: 2 }), c('room_type', 'النوع', 'text', { max: 30, default: 'مزدوجة', example: 'مزدوجة' }), c('annual_fee', 'الرسم السنوي', 'num', { min: 0, max: 1e13, default: 0, example: 0 }), c('status', 'الحالة', 'text', { max: 30, default: 'متاحة' })] },
  { kind: 'dorm_allocations', table: 'dorm_allocations', title: 'إسكان الطلاب', group: 'misc', perm: 'import:misc', risk: 'low', key: ['student_no', 'academic_year'], deps: ['dorm_rooms', 'students'], side: { dorm_rooms: 'id' },
    desc: 'إسكان الطلاب في الغرف. يزيد عدد ساكني الغرفة، ويُرفض الصف إذا امتلأت. الطالب المسكَّن في العام نفسه لا يُعدَّل من الاستيراد.',
    protect: () => 'هذا الطالب مسكَّن في هذا العام؛ عدّل إسكانه من شاشة السكن.',
    derive: (v, row, ctx, side) => {
      const room = ctx.db.prepare('SELECT id, capacity, occupied FROM dorm_rooms WHERE building_name = ? AND room_no = ?').get(side.building_name, side.room_no);
      if (!room) fail(`لا توجد الغرفة ${side.room_no} في «${side.building_name}». استورد «غرف السكن» أولاً.`);
      const taken = ctx.memo('roomOccupancy', () => new Map()), occupied = taken.get(room.id) ?? Number(room.occupied);
      if (occupied >= Number(room.capacity)) fail('الغرفة ممتلئة.');
      taken.set(room.id, occupied + 1);
      v.room_id = room.id;
    },
    after: ({ db, values, op, updateSide }) => { if (op === 'insert') updateSide('dorm_rooms', [values.room_id], { occupied: Number(db.prepare('SELECT occupied FROM dorm_rooms WHERE id = ?').get(values.room_id).occupied) + 1 }); },
    columns: [req('building_name', 'المبنى', 'text', { max: 100, sideOnly: true, example: 'مبنى تجريبي' }), req('room_no', 'رقم الغرفة', 'code', { max: 20, sideOnly: true, example: '101' }), studentNoFk(), req('faculty_name', 'الجهة', 'text', { max: 120, list: universityDepartments }), req('check_in_date', 'تاريخ السكن', 'date', { example: '2026-09-01' }), c('academic_year', 'العام الدراسي', 'text', { max: 20, default: '2026/2027', example: '2026/2027' }), c('payment_status', 'حالة الدفع', 'text', { max: 30, default: 'غير مسدد', example: 'غير مسدد' }), c('status', 'الحالة', 'text', { max: 30, default: 'ساكن' })] },
  { kind: 'library_books', table: 'library_books', title: 'كتب المكتبة', group: 'misc', perm: 'import:misc', risk: 'low', key: ['isbn'], stamp: NOW,
    desc: 'فهرس المكتبة. النسخ المتاحة تُحسب من إجمالي النسخ والإعارات القائمة.',
    derive: (v, row) => {
      if (!row) { v.copies_available = v.copies_total; return; }
      if (v.copies_total === undefined) return;
      const borrowed = Number(row.copies_total) - Number(row.copies_available);
      if (v.copies_total < borrowed) fail('إجمالي النسخ أقل من النسخ المعارة حالياً.');
      v.copies_available = v.copies_total - borrowed;
    },
    columns: [req('isbn', 'ISBN', 'code', { max: 30, example: '978-SMPL-1' }), req('title', 'العنوان', 'text', { max: 200, example: 'كتاب تجريبي' }), req('author', 'المؤلف', 'text', { max: 120, example: 'مؤلف تجريبي' }), req('category', 'التصنيف', 'text', { max: 80, example: 'عام' }), c('publish_year', 'سنة النشر', 'int', { min: 1000, max: 2100, default: new Date().getFullYear(), example: 2024 }), c('copies_total', 'إجمالي النسخ', 'int', { min: 0, max: 100000, default: 1, example: 5 }), c('shelf_code', 'رمز الرف', 'code', { max: 20, default: 'A-01', example: 'A-01' }), bool('digital_available', 'متاح رقمياً', { default: 0, example: 'لا' })] },
  { kind: 'library_loans', table: 'library_loans', title: 'إعارات المكتبة', group: 'misc', perm: 'import:misc', risk: 'low', key: ['book_id', 'borrower_no', 'loan_date'], deps: ['library_books'], stamp: NOW, side: { library_books: 'id' },
    desc: 'إعارات الكتب. الإعارة القائمة تخصم نسخة من المتاح، ويُرفض الصف إذا لم تبق نسخ. الإعارة المسجلة تُعدَّل من شاشة المكتبة.',
    protect: () => 'هذه الإعارة مسجلة؛ أرجع الكتاب من شاشة المكتبة.',
    validate: (v) => (v.due_date < v.loan_date ? 'تاريخ الإرجاع المتوقع يسبق تاريخ الإعارة.' : null),
    derive: (v, row, ctx) => {
      v.status = v.return_date ? 'returned' : 'borrowed';
      if (v.status !== 'borrowed') return;
      const left = ctx.memo('bookCopies', () => new Map()), book = ctx.db.prepare('SELECT copies_available FROM library_books WHERE id = ?').get(v.book_id);
      const available = left.get(v.book_id) ?? Number(book.copies_available);
      if (available <= 0) fail('لا توجد نسخ متاحة من هذا الكتاب.');
      left.set(v.book_id, available - 1);
    },
    after: ({ db, values, op, updateSide }) => { if (op === 'insert' && values.status === 'borrowed') updateSide('library_books', [values.book_id], { copies_available: Number(db.prepare('SELECT copies_available FROM library_books WHERE id = ?').get(values.book_id).copies_available) - 1 }); },
    columns: [req('isbn', 'ISBN', 'fk', { to: 'book_id', fk: { table: 'library_books', by: ['isbn'], hint: 'رقم ISBN' } }), req('borrower_name', 'اسم المستعير', 'text', { max: 100, example: 'مستعير تجريبي' }), req('borrower_no', 'رقم المستعير', 'code', { max: 40, example: 'LIB-SMPL-1' }), req('loan_date', 'تاريخ الإعارة', 'date', { example: '2026-10-01' }), req('due_date', 'تاريخ الإرجاع المتوقع', 'date', { example: '2026-10-15' }), c('return_date', 'تاريخ الإرجاع الفعلي', 'date')] },

  /* ---------- الجودة ---------- */
  { kind: 'qa_kpis', table: 'qa_kpis', title: 'مؤشرات الجودة', group: 'misc', perm: 'import:misc', risk: 'low', key: ['code'], stamp: { updated_at: 'now' }, touch: { updated_at: 'now' },
    desc: 'مؤشرات الأداء. الحالة تُحسب من القيمة المستهدفة والفعلية بمعادلة الشاشة نفسها.',
    derive: (v, row) => { const target = Number(v.target_value ?? row?.target_value), actual = Number(v.actual_value ?? row?.actual_value); v.status = actual >= target ? 'متحقق' : actual >= target * 0.85 ? 'قيد التحسين' : 'حرِج'; },
    columns: [req('code', 'الرمز', 'code', { max: 30, example: 'KPI-SMPL-1' }), req('title', 'المؤشر', 'text', { max: 160, example: 'مؤشر تجريبي' }), req('standard_domain', 'المجال', 'text', { max: 80, example: 'الجودة الأكاديمية' }), req('target_value', 'المستهدف', 'num', { min: 0, max: 1e9, example: 90 }), req('actual_value', 'الفعلي', 'num', { min: 0, max: 1e9, example: 85 }), c('unit', 'الوحدة', 'text', { max: 20, default: '%', example: '%' }), c('academic_year', 'العام الدراسي', 'text', { max: 20, default: '2026/2027', example: '2026/2027' })] },
  { kind: 'qa_surveys', table: 'qa_surveys', title: 'استبيانات الجودة', group: 'misc', perm: 'import:misc', risk: 'low', key: ['course_code', 'instructor_name', 'semester'], stamp: NOW,
    desc: 'تقييم المقررات. الدرجة الكلية متوسط الدرجات الثلاث.',
    derive: (v) => { v.overall_score = Number(((v.content_score + v.teaching_score + v.assessment_score) / 3).toFixed(2)); },
    columns: [req('course_code', 'رمز المقرر', 'code', { max: 30, example: 'SMPL-101' }), req('course_name', 'اسم المقرر', 'text', { max: 100, example: 'مقرر تجريبي' }), req('instructor_name', 'المدرّس', 'text', { max: 100, example: 'د. مثال تجريبي' }), c('semester', 'الفصل', 'text', { max: 50, default: 'الفصل الأول 2026/2027', example: 'الفصل الأول 2026/2027' }), c('responses_count', 'عدد الردود', 'int', { min: 0, max: 100000, default: 0, example: 50 }), req('content_score', 'المحتوى', 'num', { min: 0, max: 5, example: 4.5 }), req('teaching_score', 'التدريس', 'num', { min: 0, max: 5, example: 4.5 }), req('assessment_score', 'التقييم', 'num', { min: 0, max: 5, example: 4.5 }), c('notes', 'ملاحظات', 'text', { max: 300 })] },
  { kind: 'qa_accreditations', table: 'qa_accreditations', title: 'الاعتماد الأكاديمي', group: 'misc', perm: 'import:misc', risk: 'low', key: ['program_name', 'standard_code'], stamp: NOW,
    desc: 'ملفات اعتماد البرامج. البرنامج والمعيار معاً مفتاح التحديث.',
    columns: [req('program_name', 'البرنامج', 'text', { max: 120, example: 'برنامج تجريبي' }), req('agency_name', 'الجهة المانحة', 'text', { max: 120, example: 'هيئة تجريبية' }), req('standard_code', 'رمز المعيار', 'code', { max: 40, example: 'STD-SMPL' }), c('self_study_progress', 'إنجاز الدراسة الذاتية', 'int', { min: 0, max: 100, default: 0, example: 80 }), req('audit_date', 'تاريخ التدقيق', 'date', { example: '2026-12-15' }), c('status', 'الحالة', 'text', { max: 30, default: 'قيد المراجعة' }), c('notes', 'ملاحظات', 'text', { max: 300 })] },

  /* ---------- التعلم الإلكتروني ---------- */
  { kind: 'lms_lectures', table: 'lms_lectures', title: 'المحاضرات الإلكترونية', group: 'misc', perm: 'import:misc', risk: 'low', key: ['course_code', 'title'], stamp: NOW,
    desc: 'بيانات المحاضرات وروابطها والجهة المستهدفة. الملفات نفسها لا تُرفع من هنا.',
    columns: [c('target_faculty', 'الكلية المستهدفة', 'text', { max: 120 }), req('course_code', 'رمز المقرر', 'code', { max: 30, example: 'SMPL-101' }), req('course_name', 'اسم المقرر', 'text', { max: 100, example: 'مقرر تجريبي' }), req('title', 'العنوان', 'text', { max: 160, example: 'محاضرة تجريبية' }), c('kind_type', 'النوع', 'enum', { to: 'kind', options: { pdf: ['ملف PDF'], video: ['فيديو'], slides: ['عرض تقديمي'], assignment: ['تكليف'] }, default: 'pdf', example: 'ملف PDF' }), c('week_no', 'الأسبوع', 'int', { min: 1, max: 60, default: 1, example: 1 }), req('instructor_name', 'المدرّس', 'text', { max: 100, example: 'د. مثال تجريبي' }), c('content_url', 'الرابط', 'latin', { max: 300, pattern: /^(https?:\/\/|\/)\S*$/, patternMsg: 'رابط يبدأ بـ https:// أو /' }), c('summary', 'الملخص', 'text', { max: 400 }), bool('published', 'منشور', { default: 1, example: 'نعم' })] },
  { kind: 'lms_quizzes', table: 'lms_quizzes', title: 'اختبارات التعلم الإلكتروني', group: 'misc', perm: 'import:misc', risk: 'low', key: ['course_code', 'title'], stamp: NOW,
    desc: 'بنك الأسئلة. الأسئلة قائمة JSON وكل سؤال فيه q وoptions وans (رقم الخيار الصحيح من الصفر).',
    columns: [req('course_code', 'رمز المقرر', 'code', { max: 30, example: 'SMPL-101' }), req('course_name', 'اسم المقرر', 'text', { max: 100, example: 'مقرر تجريبي' }), req('title', 'العنوان', 'text', { max: 150, example: 'اختبار تجريبي' }), c('duration_min', 'المدة بالدقائق', 'int', { min: 1, max: 600, default: 30, example: 30 }), c('total_marks', 'الدرجة الكلية', 'int', { min: 1, max: 1000, default: 20, example: 20 }), req('questions', 'الأسئلة', 'questions', { to: 'questions_json', answerKey: 'ans', example: '[{"q":"سؤال تجريبي","options":["أ","ب"],"ans":0}]' }), bool('published', 'منشور', { default: 1, example: 'نعم' })] },
  { kind: 'lms_quiz_questions', table: 'lms_quiz_questions', title: 'أسئلة الاختبارات', group: 'misc', perm: 'import:misc', risk: 'low', key: ['quiz_id', 'position'], deps: ['lms_quizzes'],
    desc: 'أسئلة الاختبار سطراً لكل سؤال. الخيارات تفصل بينها العلامة | والإجابة الصحيحة رقم الخيار من 1، وللمتعدد أرقام بفاصلة. السؤال النظري بلا خيارات.',
    derive: (v, row, ctx, side) => {
      const options = String(side.options ?? '').split('|').map((s) => s.trim()).filter(Boolean);
      const correct = String(side.correct ?? '').split(/[,،]/).map((s) => Number(s.trim()) - 1).filter((n) => n >= 0);
      if (v.type === 'essay') { v.options_json = '[]'; v.correct_json = '[]'; return; }
      if (options.length < 2) fail('أضف خيارين على الأقل تفصل بينهما العلامة |');
      if (!correct.length || correct.some((n) => n >= options.length)) fail('رقم الإجابة الصحيحة خارج الخيارات.');
      if (v.type === 'single' && correct.length !== 1) fail('اختيار واحد يعني إجابة صحيحة واحدة.');
      v.options_json = JSON.stringify(options); v.correct_json = JSON.stringify(correct);
    },
    columns: [req('quiz_title', 'عنوان الاختبار', 'fk', { to: 'quiz_id', fk: { table: 'lms_quizzes', by: ['title'], hint: 'عنوان الاختبار' }, example: 'اختبار تجريبي' }), req('position', 'رقم السؤال', 'int', { min: 1, max: 500, example: 1 }), req('type', 'النوع', 'enum', { options: { single: ['اختيار واحد'], multi: ['اختيار متعدد'], essay: ['نظري'] }, example: 'اختيار واحد' }), req('text', 'نص السؤال', 'text', { max: 2000, example: 'سؤال تجريبي' }), c('options', 'الخيارات', 'text', { max: 2000, sideOnly: true, example: 'أ|ب|ج' }), c('correct', 'الإجابة الصحيحة', 'text', { max: 40, sideOnly: true, example: '1' }), req('marks', 'العلامة', 'num', { min: 0.25, max: 1000, example: 2 })] },
];

export const IMPORT_GROUPS = { academic: 'الأكاديمي والهيكل', students: 'الطلاب والقبول', procurement: 'المشتريات والمخزون', finance: 'المالية', hr: 'الموارد البشرية', student_fin: 'مالية الطلاب', misc: 'متفرقات' };
export const IMPORT_DEFS = Object.fromEntries(list.map((d) => [d.kind, { pk: 'id', stamp: {}, unique: [], deps: [], ...d }]));
export const IMPORT_ORDER_HINT = ORDER_REF;
