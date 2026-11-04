import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { runRules, cleanRuleParams, RULE_KINDS } from '../server/services/rules.js';

const PW = 'Str0ng-Test-Pass!';
let app, call, adm, plain, stuId;
const DAY = 86400000;
const service = () => app.db.prepare('SELECT code FROM service_types ORDER BY code LIMIT 1').get().code;

// قاعدة واحدة فقط فعّالة حتى لا تتدخل القواعد المبذورة
function only(kind, params) {
  app.db.prepare('UPDATE rules SET enabled = 0').run();
  app.db.prepare('DELETE FROM rules WHERE message = ?').run('تجربة');
  app.db.prepare('INSERT INTO rules (service_code, kind, params_json, message) VALUES (NULL, ?, ?, ?)').run(kind, JSON.stringify(params), 'تجربة');
  return runRules(app.db, { studentId: stuId, serviceCode: service(), hasAttachment: false }).ok;
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-rules-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const hash = await hashPassword(PW, 1024), add = (u, role, no = null) => Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, u, hash, role, no, Date.now()).lastInsertRowid);
  add('adm', 'admin'); add('plain', 'auditor'); stuId = add('stu', 'student', 'R-1');
  const prog = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id, now = Date.now();
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', 'ج', 'د', '90000000003', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2026, 'الفصل الأول', 2, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(stuId, prog, now, now);
  const login = async (username) => { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
  adm = await login('adm'); plain = await login('plain');
});
test.after(async () => { if (app) await app.close(); });

test('كل نوع معلن له فحص يعمل', () => {
  assert.equal(only('no_active_hold', { hold_type: 'library' }), true);
  app.db.prepare("INSERT INTO student_holds (student_id, hold_type, note, created_at) VALUES (?, 'library', 'x', ?)").run(stuId, Date.now());
  assert.equal(only('no_active_hold', { hold_type: 'library' }), false);
  assert.equal(only('student_status', { allowed: ['active'] }), true);
  assert.equal(only('student_status', { allowed: ['graduated'] }), false);
  assert.equal(only('attachment_required', {}), false);
  assert.equal(only('min_study_level', { min: 2 }), true);
  assert.equal(only('min_study_level', { min: 3 }), false);

  // المعدل والساعات من العلامات المعتمدة فقط
  const prog = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  const course = (c) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, ?, ?, 3)').run(prog, c, c).lastInsertRowid);
  const grade = (c, mark, st) => app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'c', 3, ?, ?, 1, 1, '2025/2026', ?, ?, ?)").run(stuId, mark, c, mark, Date.now(), st);
  assert.equal(only('min_average', { min: 10 }), false, 'لا علامات معتمدة');
  grade(course('R-A'), 80, 'approved'); grade(course('R-B'), 40, 'approved'); grade(course('R-C'), 100, 'draft');
  assert.equal(only('min_average', { min: 60 }), true, 'المعدل 60، والمسودة لا تُحسب');
  assert.equal(only('min_average', { min: 61 }), false);
  assert.equal(only('min_passed_hours', { min: 3 }), true, 'الناجح فقط');
  assert.equal(only('min_passed_hours', { min: 6 }), false);

  // الطلبات السابقة
  const code = service(), request = (st, at) => app.db.prepare('INSERT INTO requests (no, student_id, service_code, details_json, status, created_at) VALUES (?,?,?,?,?,?)').run(`R-${at}-${st}`, stuId, code, '{}', st, at);
  assert.equal(only('request_cooldown', { days: 30 }), true);
  request('rejected', Date.now() - DAY);
  assert.equal(only('request_cooldown', { days: 30 }), true, 'المرفوض لا يحتسب');
  request('approved', Date.now() - 5 * DAY);
  assert.equal(only('request_cooldown', { days: 30 }), false);
  assert.equal(only('request_cooldown', { days: 3 }), true);
  assert.equal(only('max_per_year', { max: 2 }), true);
  assert.equal(only('max_per_year', { max: 1 }), false);
  request('approved', Date.now() - 400 * DAY);
  assert.equal(only('max_per_year', { max: 2 }), true, 'الأقدم من سنة لا يحتسب');
  assert.equal(only('max_open_per_service', { max: 1 }), true);
  request('review', Date.now());
  assert.equal(only('max_open_per_service', { max: 1 }), false);
});

test('المستحقات من الرصيد الفعلي: المستحق المفتوح ناقص الإيصالات', () => {
  const fee = app.db.prepare("INSERT INTO fin_fee_types (code, name, kind, account_id) SELECT 'R-FEE', 'رسم', 'fee', id FROM fin_accounts LIMIT 1 RETURNING id").get();
  if (!fee) return;
  const entry = null, now = Date.now();
  const charge = (amt, st) => app.db.prepare('INSERT INTO fin_charges (student_id, fee_type_id, amount, due_day, status, entry_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(stuId, fee.id, amt, '2026-01-01', st, entry, null, now);
  assert.equal(only('no_financial_dues', { max_due: 0 }), true);
  charge(10000, 'open'); charge(99999, 'void');
  assert.equal(only('no_financial_dues', { max_due: 0 }), false, '100 مستحقة، والملغى لا يحتسب');
  assert.equal(only('no_financial_dues', { max_due: 100 }), true, 'ضمن الحد');
});

test('الشاشة: الأنواع معلنة، والإنشاء يتحقق من النوع والمعاملات، والصلاحية مطلوبة', async () => {
  const kinds = (await call('GET', '/api/admin/rules/kinds', { cookie: adm })).json.kinds;
  assert.equal(kinds.length, RULE_KINDS.length);
  assert.ok(kinds.every((k) => k.label && k.desc && Array.isArray(k.fields)));
  const post = (body, cookie = adm) => call('POST', '/api/admin/rules', { cookie, body });
  const good = { kind: 'min_average', message: 'معدلك أقل من المطلوب', params: { min: 70 } };
  assert.equal((await post(good, plain)).status, 403);
  assert.equal((await post({ ...good, kind: 'drop_table' })).status, 400);
  assert.equal((await post({ ...good, params: { min: 'كثير' } })).status, 400);
  assert.equal((await post({ ...good, params: { min: 101 } })).status, 400);
  assert.equal((await post({ ...good, message: 'x' })).status, 400);
  assert.equal((await post({ ...good, service: 'no_such_service' })).status, 400);
  const made = await post(good);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual(JSON.parse(app.db.prepare('SELECT params_json FROM rules WHERE id = ?').get(made.json.id).params_json), { min: 70 });
  const edit = await call('PUT', `/api/admin/rules/${made.json.id}`, { cookie: adm, body: { message: 'رسالة جديدة', params: { min: 75 } } });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal((await call('PUT', `/api/admin/rules/${made.json.id}`, { cookie: adm, body: { params: { min: 900 } } })).status, 400);
  assert.equal(cleanRuleParams('attachment_required', { anything: 1 }).params && Object.keys(cleanRuleParams('attachment_required', { anything: 1 }).params).length, 0, 'لا يُخزَّن إلا المعلن');
});
