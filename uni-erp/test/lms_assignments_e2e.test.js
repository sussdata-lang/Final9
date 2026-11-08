// سيناريو كامل في متصفح حقيقي للاختبارات والتكليفات. يُتخطّى إن لم يتوفر Playwright/Chromium (PLAYWRIGHT_MODULE لتحديد مساره).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345', TITLE = 'تكليف أمن الشبكات النهائي';
let pw = null;
for (const spec of [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)) {
  try { pw = await import(spec); break; } catch { /* التالي */ }
}
let app, base, browser, dir, pdfPath, answerPath;
const errors = [];
const local = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

async function pageFor(username) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${username}: ${e.message}`));
  await page.goto(base);
  await page.evaluate(async ([u, p]) => { await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) }); }, [username, PW]);
  await page.reload();
  await page.waitForFunction(() => window.UA && UA.S && UA.S.me && document.querySelector('.sx-nav'));
  return page;
}
async function openAssignments(page) {
  await page.evaluate(() => UA.go('lms'));
  await page.locator('.sx-sub-list button', { hasText: 'الاختبارات والتكليفات' }).click();
}

test.before(async () => {
  if (!pw) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-assign-e2e-'));
  pdfPath = path.join(dir, 'ورقة الأسئلة.pdf'); answerPath = path.join(dir, 'حلي.pdf');
  for (const f of [pdfPath, answerPath]) fs.writeFileSync(f, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4000, 0x20)]));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false, publicDir: path.resolve('public') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const db = app.db, hash = await hashPassword(PW, 1024), t = Date.now(), program = db.prepare('SELECT id FROM programs WHERE faculty_id IS NOT NULL ORDER BY id LIMIT 1').get().id;
  const add = (u, name, role, perms = null, no = null) => Number(db.prepare('INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, student_no, created_at) VALUES (?,?,?,?,?,?,?,?)').run(u, name, hash, role, perms ? 'custom' : 'role', perms ? JSON.stringify(perms) : null, no, t).lastInsertRowid);
  const uid = add('teacher', 'د. سامر', 'staff', ['lms_lib:write', 'lms_lib:view']);
  const m = Number(db.prepare("INSERT INTO faculty_members (name, rank, status, user_id, created_at) VALUES ('د. سامر', 'أستاذ', 'active', ?, ?)").run(uid, t).lastInsertRowid);
  db.prepare("INSERT INTO courses (program_id, level, semester, name, code, member_id) VALUES (?, 1, 1, 'أمن الشبكات', 'NET-1', ?)").run(program, m);
  let nat = 20000000000;
  const student = (u, no, first) => {
    const id = add(u, first, 'student', null, no);
    db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, ?, 'أحمد', 'العلي', 'سعاد', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944000000', 'دمشق', 'دمشق', 'شارع', 'علمي', 2023, 200, ?, 'عام', 2023, 'الأول', 1, 'أب', 'الأب', '0933000000', ?, ?)`).run(id, first, String(nat++), program, t, t);
    return id;
  };
  const inside = student('stu_in', 'S100', 'سارة'); student('stu_out', 'S200', 'خالد');
  const g = Number(db.prepare("INSERT INTO student_groups (name, program_id, created_at) VALUES ('شعبة التجربة', ?, ?)").run(program, t).lastInsertRowid);
  db.prepare('INSERT INTO student_group_members (group_id, student_id, added_at) VALUES (?,?,?)').run(g, inside, t);
  try { browser = await pw.chromium.launch(); } catch { pw = null; }
});
test.after(async () => { if (browser) await browser.close(); if (app) await app.close(); });

test('من الإنشاء إلى رؤية الدرجة: عضو هيئة وطالب من الشعبة وطالب من خارجها', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  // عضو الهيئة ينشئ اختباراً بمرفق وينشره لشعبة
  const teacher = await pageFor('teacher');
  await openAssignments(teacher);
  await teacher.click('#as-new');
  await teacher.fill('#v12-modal-form [name=title]', TITLE);
  await teacher.fill('#v12-modal-form [name=instructions]', 'ارفع الحل بصيغة PDF.');
  await teacher.fill('#v12-modal-form [name=startsAt]', local(Date.now() - 3600000));
  await teacher.fill('#v12-modal-form [name=dueAt]', local(Date.now() + 3 * 86400000));
  await teacher.click('#v12-modal-form button[type=submit]');
  await teacher.waitForSelector('#as-files');
  await teacher.setInputFiles('#as-files', pdfPath);
  await teacher.waitForFunction(() => document.querySelector('#v12-lms-body').innerText.includes('ورقة الأسئلة.pdf'));
  await teacher.click('#as-audience');
  await teacher.locator('.v12-dlg label', { hasText: 'شعبة التجربة' }).locator('input').check();
  await teacher.click('#v12-modal-form button[type=submit]');
  await teacher.waitForFunction(() => document.querySelector('#v12-lms-body').innerText.includes('شعبة التجربة'));
  await teacher.click('#as-publish');
  await teacher.waitForSelector('#as-close');

  // طالب من الشعبة يراه ويسلّم حلاً، والإشعار وصله
  const inside = await pageFor('stu_in');
  await inside.waitForFunction((v) => document.querySelector('#sx-notif')?.innerText.includes(v), TITLE);
  assert.equal(await inside.locator('[data-sx="notif"] .sx-dot').count(), 1);
  await openAssignments(inside);
  await inside.waitForSelector('.as-open');
  assert.ok((await inside.locator('#v12-lms-body').innerText()).includes(TITLE));
  await inside.click('.as-open');
  await inside.waitForSelector('#as-send');
  assert.ok((await inside.locator('#v12-lms-body').innerText()).includes('ورقة الأسئلة.pdf'));
  await inside.fill('#as-text', 'هذا حلي النصي');
  await inside.setInputFiles('#as-files', answerPath);
  await inside.waitForFunction(() => document.querySelector('#as-file-list')?.innerText.includes('حلي.pdf'));
  assert.equal(await inside.inputValue('#as-text'), 'هذا حلي النصي', 'النص لا يضيع عند إضافة ملف');
  await inside.click('#as-send');
  await inside.waitForFunction(() => document.querySelector('#v12-lms-body').innerText.includes('تم استلام حلك بنجاح'));

  // طالب من خارجها لا يراه
  const outside = await pageFor('stu_out');
  await openAssignments(outside);
  await outside.waitForFunction(() => document.querySelector('#v12-lms-body').innerText.includes('لا توجد اختبارات'));
  assert.equal((await outside.locator('#v12-lms-body').innerText()).includes(TITLE), false);

  // عضو الهيئة يرى الحل ويرصد الدرجة
  await teacher.click('#as-tab-solutions');
  await teacher.waitForSelector('.as-grade');
  assert.ok((await teacher.locator('#as-tab-body .v12-kpis').innerText()).includes('1'));
  await teacher.click('.as-grade');
  await teacher.waitForSelector('#v12-modal-form [name=score]');
  assert.ok((await teacher.locator('.v12-dlg').innerText()).includes('هذا حلي النصي'));
  await teacher.fill('#v12-modal-form [name=score]', '87');
  await teacher.fill('#v12-modal-form [name=feedback]', 'عمل ممتاز');
  await teacher.click('#v12-modal-form button[type=submit]');
  await teacher.waitForFunction(() => /87\s*\/\s*100/.test(document.querySelector('#as-tab-body').innerText));

  // الطالب يرى درجته وملاحظات المدرّس
  await inside.click('#as-back');
  await inside.waitForSelector('.as-open');
  await inside.click('.as-open');
  await inside.waitForFunction(() => document.querySelector('#v12-lms-body').innerText.includes('عمل ممتاز'));
  assert.ok((await inside.locator('#v12-lms-body').innerText()).includes('87'));
  assert.deepEqual(errors, [], 'لا أخطاء JavaScript في الصفحات');
});
