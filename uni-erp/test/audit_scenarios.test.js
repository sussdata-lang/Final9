import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { writeXlsx } from '../server/lib/xlsx.js';

const PW = 'Test#Pass12345';
let app, base, cAdmin, cStaff, cStu1, cStu2, stu1Id, stu2Id, stu1No, prog1Id, prog2Id, fac1Id, course1Id, course2Id;

async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function loginAs(username, password = PW) {
  const r = await api('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(r.status, 200, `login ${username}: ${r.text}`);
  return r.headers.get('set-cookie').split(';')[0];
}

const form = (o = {}) => ({
  first_name: 'طارق', father_name: 'محمد', last_name: 'العلي', mother_name: 'سعاد الخطيب',
  national_id: '01099887761', gender: 'ذكر', birth_date: '2005-03-14',
  birth_place: 'دمشق', nationality: 'سورية', phone: '0944123456', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء',
  hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)',
  enroll_year: 2025, enroll_term: 'الفصل الأول', study_level: 1, guardian_name: 'محمد العلي', guardian_relation: 'الأب', guardian_phone: '0933111222', ...o
});

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-audit-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;

  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['staff', 'موظف شؤون الطلاب', 'staff'], ['admin', 'مدير النظام', 'admin'], ['auditor', 'مدقق', 'auditor']]) {
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  }

  cStaff = await loginAs('staff');
  cAdmin = await loginAs('admin');

  const progs = app.db.prepare('SELECT id, name, faculty_id FROM programs ORDER BY id LIMIT 2').all();
  prog1Id = progs[0].id;
  prog2Id = progs[1].id;
  fac1Id = progs[0].faculty_id;

  const s1Res = await api('POST', '/api/students', { cookie: cStaff, body: form({ program_id: prog1Id, study_level: 1 }) });
  const s2Res = await api('POST', '/api/students', { cookie: cStaff, body: form({ first_name: 'سارة', mother_name: 'هدى', national_id: '01099887762', program_id: prog2Id, study_level: 1 }) });
  stu1Id = s1Res.json.student.id;
  stu1No = s1Res.json.student.studentNo;
  stu2Id = s2Res.json.student.id;

  app.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE role = ?').run(h, 'student');
  cStu1 = await loginAs(s1Res.json.student.username);
  cStu2 = await loginAs(s2Res.json.student.username);

  const c1Res = await api('POST', '/api/courses', { cookie: cAdmin, body: { code: 'CYB101', name: 'مبادئ الأمن السيبراني', hours: 3, programId: prog1Id, level: 1, semester: 1 } });
  const c2Res = await api('POST', '/api/courses', { cookie: cAdmin, body: { code: 'LAW201', name: 'القانون الجنائي المتقدم', hours: 3, programId: prog2Id, level: 2, semester: 1 } });
  course1Id = c1Res.json.course.id;
  course2Id = c2Res.json.course.id;
});

test.after(async () => { await app.close(); });

test('1. اختبارات دور الطالب: عزل البيانات ومنع IDOR ومنع التقديم المتكرر للخدمات النشطة', async () => {
  // أ) محاولة الطالب 1 الوصول لبيانات الطالب 2 عبر المسارات المباشرة (IDOR)
  assert.equal((await api('GET', `/api/students/${stu2Id}/unified-record`, { cookie: cStu1 })).status, 403);
  assert.equal((await api('GET', `/api/students/${stu2Id}/grades`, { cookie: cStu1 })).status, 403);
  assert.equal((await api('GET', `/api/students/${stu2Id}/files`, { cookie: cStu1 })).status, 403);
  assert.equal((await api('GET', `/api/students/${stu2Id}/schedule-conflicts`, { cookie: cStu1 })).status, 403);

  // ب) التقديم المتكرر لنفس الخدمة طالما أن الطلب الأول قيد المراجعة (review)
  const req1 = await api('POST', '/api/requests', { cookie: cStu1, body: { service: 'attendance', details: { purpose: 'سفارة', copies: 1 } } });
  assert.equal(req1.status, 201);
  assert.equal(req1.json.request.status, 'review');

  const reqDup = await api('POST', '/api/requests', { cookie: cStu1, body: { service: 'attendance', details: { purpose: 'أخرى', copies: 1 } } });
  assert.equal(reqDup.status, 409, 'يجب منع وجود طلبين نشطين قيد المراجعة لنفس الخدمة');
  assert.equal(reqDup.json.error, 'duplicate_active_request');

  // بعد بت الموظف في الطلب الأول، يُسمح بتقديم طلب جديد
  const appRes = await api('POST', `/api/requests/${req1.json.request.id}/approve`, { cookie: cStaff });
  assert.equal(appRes.status, 200);

  const reqAfterDecide = await api('POST', '/api/requests', { cookie: cStu1, body: { service: 'attendance', details: { purpose: 'أخرى', copies: 1 } } });
  assert.equal(reqAfterDecide.status, 201);
});

test('2. اختبارات دور الموظف والأكاديمي: جودة تبرير تعديل العلامات المعتمدة وإعادة ضبط الاعتماد (Workflow Reset)', async () => {
  // إدخال علامة ومراجعتها واعتمادها
  const g1 = await api('POST', `/api/students/${stu1Id}/grades`, {
    cookie: cStaff,
    body: { courseId: course1Id, academicYear: '2025/2026', theory: 50, practical: 25 }
  });
  assert.equal(g1.status, 200);
  const gid = g1.json.grades[0].id;

  await api('POST', '/api/grades/workflow', { cookie: cStaff, body: { gradeIds: [gid], stage: 'reviewed' } });
  await api('POST', '/api/grades/workflow', { cookie: cAdmin, body: { gradeIds: [gid], stage: 'approved' } });

  // رفض التبرير الوهمي أو الرقمي العشوائي مثل "12345" أو "أأأأأأ"
  const badJust1 = await api('POST', `/api/students/${stu1Id}/grades`, {
    cookie: cAdmin,
    body: { courseId: course1Id, academicYear: '2025/2026', theory: 55, practical: 25, justification: '12345' }
  });
  assert.equal(badJust1.status, 400, 'يجب رفض التبرير المكون من أرقام عشوائية فقط');

  const badJust2 = await api('POST', `/api/students/${stu1Id}/grades`, {
    cookie: cAdmin,
    body: { courseId: course1Id, academicYear: '2025/2026', theory: 55, practical: 25, justification: 'أأأأأأ' }
  });
  assert.equal(badJust2.status, 400, 'يجب رفض التبرير المكون من حرف مكرر بلا معنى');

  // تعديل الموظف للعلامة المعتمدة بتبرير موضوعي ورقم قرار رسمي يعيد حالتها تلقائياً إلى draft لإعادة التدقيق
  const staffResetEdit = await api('POST', `/api/students/${stu1Id}/grades`, {
    cookie: cStaff,
    body: {
      courseId: course1Id,
      academicYear: '2025/2026',
      theory: 58,
      practical: 27,
      justification: 'تصحيح خطأ جمع مادي بموجب محضر لجنة الامتحانات',
      decisionNo: '42/امتحانات'
    }
  });
  assert.equal(staffResetEdit.status, 200);
  assert.equal(staffResetEdit.json.grades[0].workflowStatus, 'draft', 'يجب أن تعود العلامة المعتمدة بعد تعديل الموظف لدرجتها إلى مرحلة المسودة draft لإعادة التدقيق');

  // التأكد من اختفائها من بوابة الطالب ريثما تُراجَع وتُعتمد مجدداً
  const stuGrades = await api('GET', '/api/me/grades', { cookie: cStu1 });
  assert.equal(stuGrades.json.grades.length, 0);
});

test('3. اختبارات دور الإدارة والتحكم: منع تكرار الكليات والبرامج (409) وحماية الحذف عند وجود ارتباطات', async () => {
  // إضافة كلية جديدة ثم محاولة تكرار نفس الاسم
  const f1 = await api('POST', '/api/admin/faculties', { cookie: cAdmin, body: { name: 'كلية الهندسة النووية التجريبية', nameEn: 'Faculty of Nuclear Engineering', code: 'NUC' } });
  assert.equal(f1.status, 201);
  const fDup = await api('POST', '/api/admin/faculties', { cookie: cAdmin, body: { name: 'كلية الهندسة النووية التجريبية', nameEn: 'Faculty of Nuclear Engineering II', code: 'NUCB' } });
  assert.equal(fDup.status, 409, 'يجب إرجاع 409 Conflict عند تكرار اسم الكلية');

  // محاولة حذف كلية مرتبطة ببرامج وطلاب
  const delLinkedFac = await api('DELETE', `/api/admin/faculties/${fac1Id}`, { cookie: cAdmin });
  assert.equal(delLinkedFac.status, 409, 'يجب منع حذف كلية مرتبطة ببرامج أو طلاب');

  // محاولة حذف برنامج مرتبط بطلاب أو مقررات
  const delLinkedProg = await api('DELETE', `/api/admin/programs/${prog1Id}`, { cookie: cAdmin });
  assert.equal(delLinkedProg.status, 409, 'يجب منع حذف برنامج مرتبط بطلاب أو مقررات');
});

test('4. اختبارات الحضور والباركود: التحقق المزدوج من تسجيل الطالب في برنامج المقرر', async () => {
  // الطالب 1 مسجّل في prog1Id والمقرر course2Id يتبع برنامجاً آخر (prog2Id)
  const crossScan = await api('POST', '/api/attendance/scan', {
    cookie: cStaff,
    body: { code: stu1No, kind: 'course', courseId: course2Id, hall: 'مدرج القانون 1' }
  });
  assert.equal(crossScan.status, 400, 'يجب رفض مسح باركود طالب لمقرر لا ينتمي لبرنامجه الأكاديمي');
  assert.equal(crossScan.json.error, 'unenrolled_course');

  // مسح باركود الطالب 1 لمقرره الصحيح course1Id ينجح
  const validScan = await api('POST', '/api/attendance/scan', {
    cookie: cStaff,
    body: { code: stu1No, kind: 'course', courseId: course1Id, hall: 'مخبر السيبراني 1' }
  });
  assert.equal(validScan.status, 200);
  assert.equal(validScan.json.action, 'in');
});

test('5. اختبارات الاستيراد الجماعي للطلاب: عزل الصفوف الخاطئة عبر Savepoints وتطبيع الأحرف العربية', async () => {
  const fp = app.db.prepare('SELECT p.name AS prog_name, f.name AS fac_name FROM programs p JOIN faculties f ON f.id = p.faculty_id WHERE p.id = ?').get(prog1Id);
  const normFac = fp.fac_name.replace(/ة/g, 'ه').replace(/[أإآ]/g, 'ا');
  const normProg = fp.prog_name.replace(/ة/g, 'ه').replace(/[أإآ]/g, 'ا');

  const tpl = await fetch(base + '/templates/students-template.xlsx', { headers: { Cookie: cAdmin } });
  assert.equal(tpl.status, 200);

  // استيراد عبر CSV بترميز UTF-8 مع تطبيع عربي وصف خاطئ بالمنتصف
  const csvLines = [
    'first_name,father_name,last_name,mother_name,birth_date,birth_place,gender,national_id,phone,governorate,city,address,hs_type,hs_year,hs_score,faculty,program,admission_type,enroll_year,enroll_term,study_level,guardian_name,guardian_relation,guardian_phone',
    `أحمد,محمد,الشامي,فاطمة,2004-05-10,دمشق,ذكر,01055443321,0911111111,دمشق,المزة,شارع 1,الثانوية العامة - الفرع العلمي,2024,2100,${normFac},${normProg},القبول العام (المفاضلة),2025,الفصل الأول,1,محمد الشامي,الأب,0933000111`,
    `سامر,خالد,الخطيب,سعاد,2004-06-15,حلب,ذكر,999,0922222222,حلب,الفرقان,شارع 2,الثانوية العامة - الفرع العلمي,2024,2050,${fp.fac_name},${fp.prog_name},القبول العام (المفاضلة),2025,الفصل الأول,1,خالد الخطيب,الأب,0933000222`,
    `ريم,مازن,العبدالله,هدى,2005-01-20,حمص,أنثى,01055443322,0933333333,حمص,الإنشاءات,شارع 3,الثانوية العامة - الفرع العلمي,2024,2200,${fp.fac_name},${fp.prog_name},القبول العام (المفاضلة),2025,الفصل الأول,1,مازن العبدالله,الأب,0933000333`
  ].join('\n');

  const staged = async (kind, body, cookie) => {
  const url = `/api/import/${kind}`, check = await api('POST', url, { cookie, body });
  if (check.status !== 200 || !check.json.stagingToken) return check;
  return api('POST', url, { cookie, body: { commit: true, stagingToken: check.json.stagingToken, acceptPartial: true, confirm: check.json.confirmWord ?? undefined } });
};
  const res = await staged('students', { filename: 'students.csv', data: Buffer.from(csvLines, 'utf8').toString('base64') }, cAdmin);
  assert.equal(res.status, 200);
  assert.equal(res.json.total, 3);
  assert.equal(res.json.created, 2, 'يجب حفظ الصفين السليمين رغم فشل الصف الأوسط بفضل SAVEPOINT');
  assert.equal(res.json.errorCount, 1, 'يجب عزل الصف الخاطئ في قائمة الأخطاء');
  assert.equal(res.json.errors[0].row, 3);
  assert.ok(res.json.credentialsXlsx, 'يجب توليد ملف كلمات المرور المؤقتة للطلاب المقبولين');
});

test('6. اختبارات المشتريات والمخازن المعاد هيكلتها: لوحة الإمداد وتسوية الجرد المخزني', async () => {
  const ov = await api('GET', '/api/procurement/overview', { cookie: cAdmin });
  assert.equal(ov.status, 200);
  assert.ok(Array.isArray(ov.json.lowStockItems));
  assert.ok(Array.isArray(ov.json.warehouseSummary));
  assert.ok(Array.isArray(ov.json.assetBreakdown));

  const items = await api('GET', '/api/procurement/items', { cookie: cAdmin });
  assert.equal(items.status, 200);
  if (items.json.items.length > 0) {
    const it = items.json.items[0];
    const adj = await api('POST', `/api/procurement/items/${it.id}/adjust`, {
      cookie: cAdmin,
      body: { qtyOnHand: 42, avgCost: 15000, reason: 'محضر جرد لجنة المخازن السنوي' }
    });
    assert.equal(adj.status, 200);
    assert.equal(adj.json.item.qty_on_hand, 42);
  }
});
