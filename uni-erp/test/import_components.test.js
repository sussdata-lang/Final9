import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { runImport } from '../server/services/importer.js';
import { readXlsx } from '../server/lib/xlsx.js';
import { gradesTemplate, saveComponents } from '../server/services/grading.js';

const PW = 'Test#Pass12345';
let app, admin, prog, withComp, plain;
const csv = (rows) => Buffer.from(rows.map((r) => r.join(',')).join('\n'), 'utf8').toString('base64');
const imp = (rows, commit = true) => runImport(app, admin, 'grades', { filename: 'g.csv', data: csv(rows), commit }, '::1');
const grade = (no, code) => app.db.prepare('SELECT g.* FROM grades g JOIN users u ON u.id = g.student_id JOIN courses c ON c.id = g.course_id WHERE u.student_no = ? AND c.code = ?').get(no, code);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-impcomp-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  const hash = await hashPassword(PW, 1024), now = Date.now();
  admin = { id: Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('adm','مدير',?,'admin',?) RETURNING id").get(hash, now).id), role: 'admin', display_name: 'مدير', can: () => true };
  prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  for (const s of ['s1', 's2']) {
    const id = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,'student',?,?) RETURNING id").get(`IMC-${s}`, s, hash, `IMC-${s}`, now).id);
    app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, 'أ', 'ب', ?, 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id, s, `3${String(id).padStart(10, '0')}`, prog, now, now);
  }
  withComp = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'تشفير', 'IMC-101', 3) RETURNING id").get(prog).id);
  plain = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'برمجة', 'IMC-102', 3) RETURNING id").get(prog).id);
  saveComponents(app, admin, withComp, { components: [{ name: 'أعمال الفصل', kind: 'theory', max: 20 }, { name: 'العملي', kind: 'practical', max: 20 }, { name: 'النهائي', kind: 'theory', max: 60 }] }, '::1');
});
test.after(async () => { await app.close(); });

test('الاستيراد: مقرر المكونات يُرصد من أعمدتها، وغيره من النظري والعملي في الملف نفسه', async () => {
  const head = ['الرقم الجامعي', 'رمز المقرر', 'العام الدراسي', 'أعمال الفصل', 'العملي', 'النهائي', 'العلامة النظرية'];
  const r = await imp([head, ['IMC-s1', 'IMC-101', '2026/2027', '15', '18', '45', ''], ['IMC-s2', 'IMC-102', '2026/2027', '', '', '', '70']]);
  assert.equal(r.errorCount, 0, JSON.stringify(r.errors));
  const a = grade('IMC-s1', 'IMC-101');
  assert.equal(Number(a.mark), 78); assert.equal(Number(a.theory_mark), 60); assert.equal(Number(a.practical_mark), 18);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) AS n FROM grade_component_marks WHERE grade_id = ?').get(a.id).n), 3);
  assert.equal(Number(grade('IMC-s2', 'IMC-102').mark), 70);
});

test('الملف بلا عمود النظري يُقبل إن كانت فيه أعمدة مكونات، ويُكتب خطؤه صريحاً عند نقص مكوّن', async () => {
  const r = await imp([['الرقم الجامعي', 'رمز المقرر', 'العام الدراسي', 'أعمال الفصل', 'النهائي'], ['IMC-s2', 'IMC-101', '2026/2027', '10', '40']]);
  assert.equal(r.errorCount, 1);
  assert.match(r.errors[0].message ?? r.errors[0].error ?? JSON.stringify(r.errors[0]), /علامته من مكونات.*العملي/);
  assert.equal(grade('IMC-s2', 'IMC-101'), undefined, 'لا تُرصد علامة ناقصة');
  const over = await imp([['الرقم الجامعي', 'رمز المقرر', 'العام الدراسي', 'أعمال الفصل', 'العملي', 'النهائي'], ['IMC-s2', 'IMC-101', '2026/2027', '25', '10', '40']]);
  assert.match(JSON.stringify(over.errors[0]), /من 0 إلى 20/, 'فوق وزن المكوّن');
});

test('ملف دون أعمدة مكونات ولا نظري يُرفض كما كان، ورصد مقرر المكونات من الواجهة دون مكونات يشرح السبب', async () => {
  await assert.rejects(() => imp([['الرقم الجامعي', 'رمز المقرر', 'العام الدراسي'], ['IMC-s1', 'IMC-101', '2026/2027']]), /العلامة النظرية/);
  const { enterGrade } = await import('../server/services/academics.js');
  assert.throws(() => enterGrade(app, admin, app.db.prepare("SELECT id FROM users WHERE student_no = 'IMC-s2'").get().id, { courseId: withComp, academicYear: '2026/2027', theory: 50 }, '::1'),
    (e) => e.status === 400 && /أعمال الفصل \(من 20\)/.test(e.message));
});

test('القالب الجاهز: عمود لكل مكوّن باسمه، ويُستورد كما هو', async () => {
  const wb = readXlsx(gradesTemplate(app, withComp));
  const sheet = wb.sheets.find((s) => s.name === 'العلامات');
  assert.deepEqual(sheet.rows[0], ['الرقم الجامعي', 'رمز المقرر', 'العام الدراسي', 'أعمال الفصل', 'العملي', 'النهائي']);
  assert.deepEqual(readXlsx(gradesTemplate(app, plain)).sheets.find((s) => s.name === 'العلامات').rows[0].slice(3), ['العلامة النظرية', 'العلامة العملية']);
  const filled = [...sheet.rows[0]], row = ['IMC-s2', 'IMC-101', '2026/2027', '12', '16', '50'];
  const r = await imp([filled, row]);
  assert.equal(r.errorCount, 0, JSON.stringify(r.errors));
  assert.equal(Number(grade('IMC-s2', 'IMC-101').mark), 78);
});
