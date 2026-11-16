// تشفير النصوص الحساسة في ملفات الانضباط: دالتا التشفير مباشرةً، ثم مساره كاملاً عبر واجهات الموقع
// (تظلم الطالب حتى قراءة الموظف المخوَّل له، مروراً بالتخزين في القاعدة).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptField, decryptField } from '../server/lib/data_crypto.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { createDisciplinaryRecord } from '../server/services/student_affairs_suite.js';
import { encryptLegacyAppealText } from '../server/services/student_regulations.js';

test('encryptField / decryptField: تشفير عكسي، ونص قديم غير مشفَّر يمر كما هو', () => {
  const cfg = { dataKey: 'test-key-1' };
  const enc = encryptField(cfg, 'نص سري');
  assert.match(enc, /^enc1:/);
  assert.notEqual(enc, 'نص سري');
  assert.equal(decryptField(cfg, enc), 'نص سري');
  assert.equal(decryptField(cfg, ''), '');
  assert.equal(decryptField(cfg, null), null);
  assert.equal(decryptField(cfg, 'نص قديم بلا تشفير'), 'نص قديم بلا تشفير', 'بيانات ما قبل هذا التشفير تبقى مقروءة');
  // مفتاح مختلف لا يفك الشيفرة، ولا يرمي خطأ يكسر الصفحة
  assert.match(decryptField({ dataKey: 'غير ذلك' }, enc), /تعذّر فك التشفير/);
});

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {};
const api = async (m, u, who, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-datacrypto-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  const user = (u, role, perms) => { id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, role === 'student' ? u : null, now, perms ? 'custom' : 'role', JSON.stringify(perms || [])).id); };
  user('adm', 'admin'); user('committee', 'staff', ['sa_discipline:view']); user('dean', 'staff', ['sa_lifecycle:final']);
  user('STU-1', 'student');
  const prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', 'ج', 'د', '91234567890', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`)
    .run(id['STU-1'], prog, now, now);
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of ['adm', 'committee', 'dean', 'STU-1']) ck[u] = await login(u);
});
test.after(async () => { await app.close(); });

test('تظلم الطالب يُخزَّن مشفَّراً، ويقرؤه الموظف المخوَّل صريحاً عبر الواجهة، ويُرفَض لمن لا يملك الصلاحية', async () => {
  const dis = createDisciplinaryRecord(app, { id: id.adm, role: 'admin', can: () => true }, { studentId: id['STU-1'], note: 'مخالفة جسيمة', penaltyLevel: 'dismissal', decisionNo: 'D-ENC-1' }, '::1');
  const r = await api('POST', '/api/student-regulations/appeals', 'STU-1', { holdId: dis.holdId, reason: 'لم أرتكب هذه المخالفة إطلاقاً وهذا دفاعي المفصَّل.' });
  assert.equal(r.s, 201, JSON.stringify(r.j));

  const raw = app.db.prepare('SELECT reason FROM sa_disciplinary_appeals WHERE id = ?').get(r.j.id).reason;
  assert.match(raw, /^enc1:/);
  assert.doesNotMatch(raw, /أرتكب/);

  const forbidden = await api('GET', '/api/student-regulations/appeals', 'STU-1');
  assert.equal(forbidden.s, 403, 'الطالب لا يرى قائمة التظلمات');

  const list = await api('GET', '/api/student-regulations/appeals', 'committee');
  assert.equal(list.s, 200);
  const a = list.j.appeals.find((x) => x.id === r.j.id);
  assert.equal(a.reason, 'لم أرتكب هذه المخالفة إطلاقاً وهذا دفاعي المفصَّل.', 'الموظف المخوَّل يرى النص الصريح');

  const decide = await api('POST', `/api/student-regulations/appeals/${r.j.id}/decide`, 'dean', { outcome: 'upheld', note: 'القرار سليم وفق محضر اللجنة ودليل الواقعة.' });
  assert.equal(decide.s, 200, JSON.stringify(decide.j));
  const rawNote = app.db.prepare('SELECT decision_note FROM sa_disciplinary_appeals WHERE id = ?').get(r.j.id).decision_note;
  assert.match(rawNote, /^enc1:/);

  const list2 = await api('GET', '/api/student-regulations/appeals', 'committee');
  assert.equal(list2.j.appeals.find((x) => x.id === r.j.id).decision_note, 'القرار سليم وفق محضر اللجنة ودليل الواقعة.');
});

test('تشفير النصوص القديمة بالجملة: يشفّر الصريح فقط، ولا يكرر على ما سبق تشفيره', () => {
  const dis = createDisciplinaryRecord(app, { id: id.adm, role: 'admin', can: () => true }, { studentId: id['STU-1'], note: 'مخالفة أخرى', penaltyLevel: 'exam_zero', decisionNo: 'D-ENC-2' }, '::1');
  // إدراج تظلم قديم يحاكي ما أُدخل قبل هذا التشفير: نص صريح مباشرة في القاعدة
  const { id: appealId } = app.db.prepare("INSERT INTO sa_disciplinary_appeals (appeal_no, hold_id, student_id, reason, status, created_at) VALUES ('APL-LEGACY-1', ?, ?, 'نص قديم صريح', 'pending', ?) RETURNING id").get(dis.holdId, id['STU-1'], Date.now());
  const n1 = encryptLegacyAppealText(app.db, app.cfg);
  assert.ok(n1 >= 1);
  const row1 = app.db.prepare('SELECT reason, decision_note FROM sa_disciplinary_appeals WHERE id = ?').get(appealId);
  assert.match(row1.reason, /^enc1:/);
  assert.equal(decryptField(app.cfg, row1.reason), 'نص قديم صريح');
  const n2 = encryptLegacyAppealText(app.db, app.cfg);
  assert.equal(n2, 0, 'لا تكرار: لا صفوف صريحة متبقية');
  const row2 = app.db.prepare('SELECT reason FROM sa_disciplinary_appeals WHERE id = ?').get(appealId);
  assert.equal(row2.reason, row1.reason, 'لم يُعَد تشفير ما سبق تشفيره (لا تضاعف)');
});

test('ملاحظة المانع الانضباطي: مشفَّرة من مسار الإنشاء المخصص، صريحة في كل شاشات العرض المخوَّلة', async () => {
  const dis = createDisciplinaryRecord(app, { id: id.adm, role: 'admin', can: () => true }, { studentId: id['STU-1'], note: 'واقعة غش موثَّقة بمحضر المراقب', penaltyLevel: 'warning', decisionNo: 'D-NOTE-1' }, '::1');
  const rawNote = app.db.prepare('SELECT note FROM student_holds WHERE id = ?').get(dis.holdId).note;
  assert.match(rawNote, /^enc1:/, 'ملاحظة المانع مخزَّنة مشفَّرة');
  assert.doesNotMatch(rawNote, /غش/);

  const list = await api('GET', '/api/admin/holds', 'adm');
  assert.equal(list.s, 200);
  const row = list.j.holds.find((h) => h.id === dis.holdId);
  assert.match(row.note, /واقعة غش موثَّقة/, 'قائمة الموانع الإدارية تعرض النص الصريح');

  const overview = await api('GET', '/api/student-affairs-suite/overview', 'adm');
  assert.equal(overview.s, 200);
  const d = overview.j.lifecycle.disciplinaryRecords.find((x) => x.holdId === dis.holdId);
  assert.match(d.note, /واقعة غش موثَّقة/, 'نظرة شؤون الطلاب الشاملة تعرض النص الصريح');

  const rec360 = await api('GET', `/api/students/${id['STU-1']}/unified-record`, 'adm');
  assert.equal(rec360.s, 200);
  const h360 = rec360.j.holds.find((x) => x.id === dis.holdId);
  assert.match(h360.note, /واقعة غش موثَّقة/, 'الملف الموحَّد 360 يعرض النص الصريح');
});

test('ملاحظة المانع: المالية والمكتبة تبقيان صريحتين (مفتاح الاستيراد الجماعي)، والانضباطية وحدها تُشفَّر عبر المسار العام', async () => {
  const fin = await api('POST', '/api/admin/holds', 'adm', { studentNo: 'STU-1', holdType: 'financial', note: 'رسم فصلي متأخر' });
  assert.equal(fin.s, 201, JSON.stringify(fin.j));
  assert.equal(app.db.prepare('SELECT note FROM student_holds WHERE id = ?').get(fin.j.id).note, 'رسم فصلي متأخر', 'المالية تبقى صريحة');

  const dis = await api('POST', '/api/admin/holds', 'adm', { studentNo: 'STU-1', holdType: 'disciplinary', note: 'مخالفة عبر الشاشة العامة' });
  assert.equal(dis.s, 201, JSON.stringify(dis.j));
  const disRaw = app.db.prepare('SELECT note FROM student_holds WHERE id = ?').get(dis.j.id).note;
  assert.match(disRaw, /^enc1:/, 'الانضباطية تُشفَّر ولو أُنشئت من الشاشة العامة لا المسار المخصص');

  // الانتقال بين الأنواع: فكّ عند الخروج من الانضباطية، وتشفير عند الدخول إليها، دون تضاعف
  await api('PUT', `/api/admin/holds/${dis.j.id}`, 'adm', { holdType: 'library' });
  assert.equal(app.db.prepare('SELECT note FROM student_holds WHERE id = ?').get(dis.j.id).note, 'مخالفة عبر الشاشة العامة', 'فُكَّت عند الخروج من الانضباطية');

  await api('PUT', `/api/admin/holds/${dis.j.id}`, 'adm', { holdType: 'disciplinary' });
  const back = app.db.prepare('SELECT note FROM student_holds WHERE id = ?').get(dis.j.id).note;
  assert.match(back, /^enc1:/, 'شُفِّرت عند العودة إلى الانضباطية');
  assert.equal(decryptField(app.cfg, back), 'مخالفة عبر الشاشة العامة', 'النص نفسه دون تضاعف');
});
