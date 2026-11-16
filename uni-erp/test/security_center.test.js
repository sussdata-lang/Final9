import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { audit } from '../server/audit.js';
import { resetWaf } from '../server/waf.js';
import { runDetection, recordSecurityEvent } from '../server/services/security_center.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {};
const api = async (m, u, who = 'adm', body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j, t, h: r.headers };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const alerts = (rule) => app.db.prepare('SELECT * FROM security_alerts WHERE rule = ? ORDER BY id').all(rule);
const fail = (ip, user) => audit(app.db, null, 'دخول مرفوض', user, ip);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-siem-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  const user = (u, role, perms) => { id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, now, perms ? 'custom' : 'role', JSON.stringify(perms || [])).id); };
  user('adm', 'admin'); user('sec', 'staff', ['security:monitor']); user('aud', 'staff', ['audit:read']); user('emp', 'staff', ['student:read']);
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of Object.keys(id)) ck[u] = await login(u);
  runDetection(app.db); // يضبط المؤشر: ما سبق لا يُعاد
});
test.after(async () => { resetWaf(); await app.close(); });

test('تخمين ورش من عنوان واحد: تنبيه واحد لكل نمط يُحدَّث ولا يتكرر، ويُبلَّغ المراقب والمدير', () => {
  for (let i = 0; i < 12; i++) fail('203.0.113.7', `user${i % 6}`);
  runDetection(app.db);
  const bf = alerts('brute_force'), sp = alerts('password_spray');
  assert.equal(bf.length, 1); assert.equal(bf[0].severity, 'high'); assert.equal(Number(bf[0].count), 12); assert.equal(bf[0].ip, '203.0.113.7');
  assert.equal(sp.length, 1); assert.equal(Number(sp[0].count), 6);
  for (let i = 0; i < 3; i++) fail('203.0.113.7', 'user1');
  runDetection(app.db);
  assert.equal(alerts('brute_force').length, 1, 'لا تنبيه مكرر');
  assert.equal(Number(alerts('brute_force')[0].count), 15, 'يُحدَّث العدد');
  const notified = app.db.prepare("SELECT user_id FROM user_notifications WHERE kind = 'security_alert' AND ref_id = ?").all(bf[0].id).map((r) => Number(r.user_id)).sort();
  assert.deepEqual(notified, [id.adm, id.sec].sort(), 'المراقب والمدير فقط');
});

test('الإغلاق يتطلب ملاحظة، ولا يُعاد التنبيه للأحداث السابقة، ويعود عند هجوم جديد', async () => {
  const a = alerts('brute_force')[0];
  assert.equal((await api('POST', `/api/security/alerts/${a.id}`, 'aud', { action: 'ack' })).s, 403, 'المدقق يقرأ فقط');
  assert.equal((await api('POST', `/api/security/alerts/${a.id}`, 'sec', { action: 'ack' })).s, 200);
  const nonote = await api('POST', `/api/security/alerts/${a.id}`, 'sec', { action: 'close', note: '' });
  assert.equal(nonote.s, 400); assert.match(JSON.stringify(nonote.j), /ملاحظة الإغلاق/);
  const ok = await api('POST', `/api/security/alerts/${a.id}`, 'sec', { action: 'close', note: 'عنوان خارجي، أُضيف إلى قائمة الحجب في الجدار' });
  assert.equal(ok.s, 200); assert.equal(ok.j.status, 'closed'); assert.equal(ok.j.closedBy, 'مستخدم sec');
  runDetection(app.db);
  assert.equal(alerts('brute_force').length, 1, 'الأحداث التي سبقت الإغلاق لا تفتح تنبيهاً');
  await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 10; i++) fail('203.0.113.7', 'user2');
  runDetection(app.db);
  const after = alerts('brute_force');
  assert.equal(after.length, 2); assert.equal(after[1].status, 'open'); assert.equal(Number(after[1].count), 10);
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'إغلاق تنبيه أمني'").get(), 'الإغلاق في سجل التدقيق');
});

test('حساب واحد من عناوين متعددة، ودخول المدير من عنوان جديد، وتعطيل التحقق بخطوتين، وحجب الجدار', () => {
  for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) for (let i = 0; i < 2; i++) fail(ip, 'dean');
  const adm = { id: id.adm, label: 'مستخدم adm', role: 'admin' };
  audit(app.db, adm, 'تسجيل دخول', '', '10.1.1.1');
  runDetection(app.db);
  assert.equal(alerts('targeted_account').length, 1); assert.equal(alerts('targeted_account')[0].subject, 'dean');
  assert.equal(alerts('admin_new_ip').filter((a) => a.ip === '10.1.1.1').length, 1, 'العنوان لم يُر من قبل لهذا المدير');
  audit(app.db, adm, 'تسجيل دخول', '', '10.1.1.1');
  audit(app.db, adm, 'تعطيل التحقق بخطوتين', 'dean', '10.1.1.1');
  recordSecurityEvent(app.db, { kind: 'waf_ban', severity: 'medium', ip: '192.0.2.9', subject: '192.0.2.9', detail: 'scanner_agent' });
  runDetection(app.db);
  assert.equal(alerts('admin_new_ip').filter((a) => a.ip === '10.1.1.1').length, 1, 'لا يتكرر للعنوان نفسه');
  assert.equal(alerts('mfa_change').length, 1); assert.equal(alerts('mfa_change')[0].severity, 'high');
  assert.equal(alerts('waf_ban').length, 1); assert.equal(alerts('waf_ban')[0].ip, '192.0.2.9');
});

test('تغييرات الصلاحيات المكثفة، وإيقاف الكشف من الإعدادات', async () => {
  const adm = { id: id.adm, label: 'مستخدم adm', role: 'admin' };
  for (let i = 0; i < 5; i++) audit(app.db, adm, `تعديل دور: دور${i}`, '', '10.1.1.1');
  runDetection(app.db);
  assert.equal(alerts('priv_burst').length, 1); assert.equal(Number(alerts('priv_burst')[0].count), 5);
  assert.equal((await api('PUT', '/api/admin/general', 'adm', { values: { 'siem.enabled': false } })).s, 200);
  assert.equal(runDetection(app.db).skipped, true);
  assert.equal((await api('PUT', '/api/admin/general', 'adm', { values: { 'siem.enabled': true } })).s, 200);
});

test('الواجهة البرمجية: الصلاحيات، والملخص، والتصدير بصيغة NDJSON', async () => {
  assert.equal((await api('GET', '/api/security/overview', 'emp')).s, 403);
  const o = await api('GET', '/api/security/overview', 'aud');
  assert.equal(o.s, 200); assert.equal(o.j.canManage, false); assert.ok(o.j.openTotal >= 1); assert.ok(o.j.failed24h >= 25);
  assert.equal(o.j.topIps[0].ip, '203.0.113.7');
  assert.equal((await api('GET', '/api/security/export.ndjson', 'aud')).s, 403);
  const ex = await api('GET', '/api/security/export.ndjson', 'sec');
  assert.equal(ex.s, 200); assert.match(ex.h.get('content-type'), /ndjson/);
  const lines = ex.t.trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.rule.name === 'brute_force' && l.source.ip === '203.0.113.7'));
  const list = await api('GET', '/api/security/alerts?status=closed', 'sec');
  assert.equal(list.j.alerts.length, 1);
  const me = (await api('GET', '/api/me', 'sec')).j;
  assert.ok(me.user.allowedViews.includes('audit'), 'شاشة المراقبة ظاهرة لصاحب الصلاحية');
});

test('حجب جدار الحماية يُسجَّل حدثاً أمنياً', async () => {
  resetWaf();
  const before = Number(app.db.prepare("SELECT COUNT(*) AS n FROM security_events WHERE kind = 'waf_ban'").get().n);
  const r = await fetch(`${base}/api/health`, { headers: { 'User-Agent': 'sqlmap/1.7' } });
  assert.equal(r.status, 403);
  const after = Number(app.db.prepare("SELECT COUNT(*) AS n FROM security_events WHERE kind = 'waf_ban'").get().n);
  assert.equal(after, before + 1);
  resetWaf();
});

test('قواعد البيانات الحساسة: تعديل العلامات وحذفها، والإبطال المالي، وفتح ملفات الطلاب بكثرة', () => {
  const emp = { id: id.emp, label: 'مستخدم emp', role: 'staff' }, aud = { id: id.aud, label: 'مستخدم aud', role: 'staff' };
  for (let i = 0; i < 19; i++) audit(app.db, emp, i % 2 ? 'تعديل علامة' : 'حذف علامة', `STU-${i} / مقرر`, '10.2.2.2');
  for (let i = 0; i < 25; i++) audit(app.db, emp, 'إدخال علامة', `STU-${i} / مقرر`, '10.2.2.2');   // الإدخال الأول لا يُحتسب
  for (let i = 0; i < 4; i++) audit(app.db, aud, 'إلغاء دفعة', `RV-${i}`, '10.2.2.3');
  for (let i = 0; i < 59; i++) audit(app.db, aud, 'عرض ملف طالب', `STU-${i}`, '10.2.2.3');
  runDetection(app.db);
  assert.equal(alerts('grade_burst').length + alerts('finance_void_burst').length + alerts('record_view_burst').length, 0, 'تحت الحد لا تنبيه');
  audit(app.db, emp, 'تعديل علامة معتمدة', 'STU-99 / مقرر', '10.2.2.2');
  audit(app.db, aud, 'عكس قيد', 'JV-1 ← JV-2', '10.2.2.3');
  audit(app.db, aud, 'عرض ملف طالب', 'STU-99', '10.2.2.3');
  runDetection(app.db);
  const g = alerts('grade_burst'), f = alerts('finance_void_burst'), v = alerts('record_view_burst');
  assert.equal(g.length, 1); assert.equal(g[0].severity, 'high'); assert.equal(Number(g[0].count), 20); assert.equal(g[0].subject, 'مستخدم emp');
  assert.equal(f.length, 1); assert.equal(f[0].severity, 'high'); assert.equal(Number(f[0].count), 5);
  assert.equal(v.length, 1); assert.equal(v[0].severity, 'medium'); assert.equal(Number(v[0].count), 60);
});

test('تعديل علامة بعد إعلان نتائج المقرر: تنبيه عالٍ يجمع تعديلات اليوم، وإشعار برابط مركز الأمان', () => {
  const db = app.db, now = Date.now();
  let prog = db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get()?.id;
  if (!prog) {
    db.prepare("INSERT INTO faculties (id, name, name_en, code, kind, active) VALUES (900, 'كلية الاختبار', 'Test', 'TST', 'college', 1) ON CONFLICT DO NOTHING").run();
    prog = Number(db.prepare("INSERT INTO programs (faculty_id, faculty, name, degree, years, active) VALUES (900, 'كلية الاختبار', 'برنامج الاختبار', 'بكالوريوس', 4, 1) RETURNING id").get().id);
  }
  const course = Number(db.prepare("INSERT INTO courses (program_id, level, semester, name, code) VALUES (?, 1, 1, 'أمن الشبكات', 'NET-1') RETURNING id").get(prog).id);
  const stu = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('stu-lock', 'طالب', 'x', 'student', 'STU-LOCK', ?) RETURNING id").get(now).id);
  const gid = Number(db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, entered_at, workflow_status) VALUES (?, 't', 'أمن الشبكات', 3, 55, ?, 1, 1, '2026/2027', ?, 'approved') RETURNING id").get(stu, course, now).id);
  const change = (oldT, newT, at) => db.prepare("INSERT INTO grade_changes (grade_id, student_id, course, action, old_total, new_total, justification, actor_id, at) VALUES (?, ?, 'أمن الشبكات', 'تعديل علامة بعد إعلان النتائج', ?, ?, 'قرار لجنة التظلمات 7', ?, ?)").run(gid, stu, oldT, newT, id.emp, at);
  change(50, 55, now - 1000);   // قبل القفل: لا تنبيه
  db.prepare("INSERT INTO grade_locks (course_id, academic_year, locked_by, locked_at) VALUES (?, '2026/2027', ?, ?)").run(course, id.adm, now - 500);
  runDetection(app.db);
  assert.equal(alerts('grade_after_lock').length, 0, 'التعديل السابق للقفل لا يُنبَّه عليه');
  change(55, 70, now + 100);
  const r = runDetection(app.db);
  let a = alerts('grade_after_lock');
  assert.equal(a.length, 1); assert.equal(a[0].severity, 'high'); assert.match(a[0].detail, /STU-LOCK: 55 ← 70\. التبرير: قرار لجنة التظلمات 7/);
  assert.ok(r.pushed >= 1, 'العالي يُرسل إشعاراً فورياً');
  change(70, 72, now + 200);
  runDetection(app.db);
  a = alerts('grade_after_lock');
  assert.equal(a.length, 1, 'تعديلات اليوم نفسه في تنبيه واحد'); assert.equal(Number(a[0].count), 2);
  const n = db.prepare("SELECT user_id, url FROM user_notifications WHERE kind = 'security_alert' AND ref_id = ?").all(a[0].id);
  assert.deepEqual(n.map((x) => Number(x.user_id)).sort(), [id.adm, id.sec].sort());
  assert.ok(n.every((x) => x.url === '/?view=audit&tab=siem'), 'الإشعار يفتح مركز الأمان');
});

test('العمليات المالية الحساسة خارج ساعات العمل', async () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Damascus', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const ws = (h + 1) % 24;
  assert.equal((await api('PUT', '/api/admin/general', 'adm', { values: { 'siem.work_start': ws, 'siem.work_end': ws + 1 } })).s, 200);
  const fin = { id: id.emp, label: 'مستخدم emp', role: 'staff' };
  audit(app.db, fin, 'ترحيل قيد', 'JV-10', '10.2.2.2');
  audit(app.db, fin, 'إلغاء استحقاق', '#4', '10.2.2.2');
  audit(app.db, fin, 'تسجيل دخول', '', '10.2.2.2');   // ليس عملية مالية
  runDetection(app.db);
  // يُحصر في مستخدم هذا الاختبار: إلغاءات الاختبار السابق تُرصد أيضاً إن شُغّل بعد نهاية الدوام الفعلي
  const a = alerts('finance_off_hours').filter((x) => x.subject === 'مستخدم emp');
  assert.equal(a.length, 1); assert.equal(Number(a[0].count), 2, 'تنبيه واحد في اليوم يزيد عدده'); assert.match(a[0].detail, /إلغاء استحقاق/);
  assert.equal((await api('PUT', '/api/admin/general', 'adm', { values: { 'siem.work_start': 7, 'siem.work_end': 20 } })).s, 200);
});

test('تذكير التنبيه العالي غير المستلم: إشعار واحد يتجدد، ويتوقف بالاستلام', async () => {
  const a = alerts('grade_after_lock')[0], later = Date.now() + 31 * 60_000;
  const reminders = () => app.db.prepare("SELECT user_id, read FROM user_notifications WHERE kind = 'security_reminder' AND ref_id = ?").all(a.id);
  const count = () => Number(app.db.prepare('SELECT reminders FROM security_alerts WHERE id = ?').get(a.id).reminders);
  assert.equal(reminders().length, 0, 'لا تذكير قبل المهلة');
  assert.ok(runDetection(app.db, later).reminded >= 1);
  assert.deepEqual(reminders().map((x) => Number(x.user_id)).sort(), [id.adm, id.sec].sort());
  assert.equal(count(), 1);
  runDetection(app.db, later + 60_000);
  assert.equal(count(), 1, 'لا تذكير قبل انقضاء المهلة التالية');
  app.db.prepare("UPDATE user_notifications SET read = 1 WHERE kind = 'security_reminder' AND ref_id = ?").run(a.id);
  runDetection(app.db, later + 31 * 60_000);
  const rows = reminders();
  assert.equal(count(), 2);
  assert.equal(rows.length, 2, 'إشعار واحد لكل مستخدم يتجدد ولا يتكرر'); assert.ok(rows.every((x) => !Number(x.read)), 'يعود غير مقروء');
  assert.equal((await api('POST', `/api/security/alerts/${a.id}`, 'sec', { action: 'ack' })).s, 200);
  runDetection(app.db, later + 62 * 60_000);
  assert.equal(count(), 2, 'الاستلام يوقف التذكير');
});
