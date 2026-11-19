// المرحلة الرابعة: أجهزة البصمة (تعريف كامل، ADMS، HTTP برمز، استيراد USB، ربط الموظفين) وتقييم الأداء الشامل
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { dayKey } from '../server/services/staffatt.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {};
const call = async (m, u, who, body, opts = {}) => {
  const headers = { ...(who ? { Cookie: ck[who] } : {}), ...(opts.headers || {}) };
  if (body !== undefined && !opts.raw) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + u, { method: m, headers, body: body === undefined ? undefined : opts.raw ? body : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* نص */ } return { s: r.status, j, t };
};
const yday = dayKey(Date.now() - 86400000);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph4-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024), now = Date.now();
  const add = (u, perms) => { id[u] = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, created_at, must_change_password) VALUES (?,?,?,'staff','custom',?,?,0) RETURNING id").get(u, `الموظف ${u}`, h, JSON.stringify(perms), now).id); };
  add('mgr', ['hr:manage']); add('hr1', ['hr_emp:edit']); add('emp', []); add('emp2', []);
  for (const u of Object.keys(id)) { app.limiter.hits.clear(); ck[u] = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0]; }
});
test.after(async () => { await app.close(); });

test('تعريف جهاز البصمة: الحقول والتحقق، والرقم التسلسلي إلزامي لـ ADMS، والصلاحية', async () => {
  const dev = { code: 'BIO-GATE-1', name: 'بوابة المبنى الرئيسي', brand: 'ZKTeco', model: 'SpeedFace-V5L', location: 'البوابة الرئيسية', ip: '192.168.1.201', port: 4370, commType: 'push_adms', direction: 'both', verifyModes: ['fingerprint', 'face', 'card'], mac: '00:17:61:AB:CD:EF', installedOn: '2026-09-01' };
  assert.equal((await call('POST', '/api/hr/biometric/devices', 'emp', dev)).s, 403);
  assert.equal((await call('POST', '/api/hr/biometric/devices', 'mgr', dev)).s, 400, 'بلا رقم تسلسلي');
  assert.equal((await call('POST', '/api/hr/biometric/devices', 'mgr', { ...dev, serialNo: 'CJ4F201', ip: '999.1.1.1' })).s, 400, 'عنوان IP');
  const ok = await call('POST', '/api/hr/biometric/devices', 'mgr', { ...dev, serialNo: 'CJ4F201' });
  assert.equal(ok.s, 201, JSON.stringify(ok.j));
  assert.equal(ok.j.device.state, 'لم يتصل بعد'); assert.deepEqual(ok.j.device.verifyModes, ['fingerprint', 'face', 'card']);
  id.dev = ok.j.device.id;
  assert.equal((await call('POST', '/api/hr/biometric/devices', 'mgr', { ...dev, code: 'BIO-2', serialNo: 'CJ4F201' })).s, 409, 'الرقم التسلسلي فريد');
});

test('ADMS: مصافحة الجهاز، واستقبال ATTLOG وتطبيقه بوقت الجهاز، والحركات غير المربوطة تُطبَّق عند الربط', async () => {
  assert.equal((await call('PUT', `/api/hr/biometric/users/${id.emp}`, 'mgr', { pin: '101', cardNo: '0012345' })).s, 200);
  assert.equal((await call('PUT', `/api/hr/biometric/users/${id.emp2}`, 'mgr', { pin: '101' })).s, 409, 'الرقم فريد');
  const hs = await call('GET', '/iclock/cdata?SN=CJ4F201&options=all');
  assert.equal(hs.s, 200); assert.match(hs.t, /GET OPTION FROM: CJ4F201/);
  assert.equal((await call('GET', '/iclock/cdata?SN=UNKNOWN')).s, 404);
  const body = `101\t${yday} 08:02:11\t0\t1\n101\t${yday} 15:31:00\t1\t1\n202\t${yday} 08:10:00\t0\t15\n`;
  const post = await call('POST', `/iclock/cdata?SN=CJ4F201&table=ATTLOG&Stamp=1`, null, body, { raw: true, headers: { 'Content-Type': 'text/plain' } });
  assert.equal(post.s, 200, post.t); assert.equal(post.t, 'OK: 3');
  const a = app.db.prepare('SELECT * FROM staff_attendance WHERE user_id = ? AND day = ?').get(id.emp, yday);
  assert.equal(Number(a.check_in), Date.parse(`${yday}T08:02:11+03:00`), 'وقت الجهاز لا وقت الوصول');
  assert.equal(Number(a.check_out), Date.parse(`${yday}T15:31:00+03:00`));
  assert.equal((await call('POST', `/iclock/cdata?SN=CJ4F201&table=ATTLOG`, null, body, { raw: true, headers: { 'Content-Type': 'text/plain' } })).t, 'OK: 0', 'التكرار لا يُدخل مرتين');
  let ov = (await call('GET', '/api/hr/biometric', 'mgr')).j;
  assert.equal(ov.unmapped, 1); assert.equal(ov.devices[0].state, 'متصل'); assert.equal(ov.devices[0].logsSynced, 3);
  const map = await call('PUT', `/api/hr/biometric/users/${id.emp2}`, 'mgr', { pin: '202' });
  assert.equal(map.j.applied, 1, 'طُبّقت الحركة السابقة');
  assert.ok(app.db.prepare('SELECT 1 FROM staff_attendance WHERE user_id = ? AND day = ?').get(id.emp2, yday));
  // جهاز معطّل لا يُقبل منه
  await call('POST', `/api/hr/biometric/devices/${id.dev}/toggle`, 'mgr', { active: false });
  assert.equal((await call('GET', '/iclock/cdata?SN=CJ4F201')).s, 404);
  await call('POST', `/api/hr/biometric/devices/${id.dev}/toggle`, 'mgr', { active: true });
});

test('HTTP برمز الجهاز واستيراد ملف USB', async () => {
  const d = (await call('POST', '/api/hr/biometric/devices', 'mgr', { code: 'BIO-HTTP', name: 'جهاز المكتبة', location: 'مدخل المكتبة', commType: 'push_http', verifyModes: ['card'] })).j.device;
  const tk = (await call('POST', `/api/hr/biometric/devices/${d.id}/token`, 'mgr')).j.token;
  assert.match(tk, /^bio_/);
  const rec = { records: [{ pin: '101', time: `${yday} 17:45:00` }] };
  assert.equal((await call('POST', '/api/hr/biometric/push', null, rec, { headers: { Authorization: 'Bearer bio_wrong' } })).s, 401);
  const p = await call('POST', '/api/hr/biometric/push', null, rec, { headers: { Authorization: `Bearer ${tk}` } });
  assert.equal(p.s, 200, JSON.stringify(p.j)); assert.equal(p.j.applied, 1);
  assert.equal(Number(app.db.prepare('SELECT check_out FROM staff_attendance WHERE user_id = ? AND day = ?').get(id.emp, yday).check_out), Date.parse(`${yday}T17:45:00+03:00`), 'آخر حركة خروج');
  const usb = (await call('POST', '/api/hr/biometric/devices', 'mgr', { code: 'BIO-USB', name: 'جهاز الكلية', location: 'كلية العلوم', commType: 'usb_import' })).j.device;
  const file = Buffer.from(`202\t${yday} 07:55:00\t0\t1\nسطر غير صالح\n`).toString('base64');
  const im = await call('POST', `/api/hr/biometric/devices/${usb.id}/import`, 'mgr', { data: file });
  assert.equal(im.s, 200, JSON.stringify(im.j)); assert.equal(im.j.inserted, 1);
  assert.equal(Number(app.db.prepare('SELECT check_in FROM staff_attendance WHERE user_id = ? AND day = ?').get(id.emp2, yday).check_in), Date.parse(`${yday}T07:55:00+03:00`), 'الحركة الأبكر دخول');
});

test('التقييم الشامل: محاور وأوزان ومسؤوليات، ونسبة الدوام آلياً، ومسار المسودة ← الإرسال ← الاعتماد ← اطلاع الموظف', async () => {
  const t = (await call('GET', '/api/hr/appraisals/template', 'hr1')).j;
  assert.equal(t.axes.length, 5); assert.ok(t.axes.find((a) => a.key === 'leadership').supervisorOnly);
  const from = dayKey(Date.now() - 7 * 86400000), to = dayKey(Date.now());
  const att = (await call('GET', `/api/hr/appraisals/attendance?userId=${id.emp}&from=${from}&to=${to}`, 'hr1')).j;
  assert.ok(att.workDays > 0 && att.presentDays >= 1 && att.pct > 0);
  const keys = t.axes.filter((a) => !a.supervisorOnly).flatMap((a) => a.criteria.map((c) => c.key));
  const base = { userId: id.emp, periodLabel: 'التقييم نصف السنوي 2026', periodFrom: from, periodTo: to, recommendation: 'علاوة دورية' };
  const draft = await call('POST', '/api/hr/appraisals', 'hr1', { ...base, scores: { rules: 4 } });
  assert.equal(draft.s, 201, JSON.stringify(draft.j)); assert.equal(draft.j.appraisal.status, 'draft');
  const aid = draft.j.appraisal.id;
  assert.equal((await call('PUT', `/api/hr/appraisals/${aid}`, 'hr1', { submit: true })).s, 400, 'كل المعايير قبل الإرسال');
  assert.equal((await call('POST', '/api/hr/appraisals', 'hr1', { ...base, userId: id.hr1 })).s, 403, 'لا يقيّم نفسه');
  const full = await call('PUT', `/api/hr/appraisals/${aid}`, 'hr1', { submit: true, scores: Object.fromEntries(keys.map((k) => [k, 4])), responsibilities: [{ title: 'أرشفة المراسلات الواردة إلكترونياً', rating: 5 }, { title: 'متابعة طلبات الطلاب', rating: 5, comment: 'متميز' }], strengths: 'دقة وانضباط', trainingNeeds: 'دورة في إدارة الوثائق' });
  assert.equal(full.s, 200, JSON.stringify(full.j));
  // (15+30+20+15)×80% + 20×100% = 84%
  assert.equal(full.j.appraisal.overall, 84); assert.equal(full.j.appraisal.grade, 'جيد جداً'); assert.equal(full.j.appraisal.status, 'submitted');
  assert.equal(full.j.appraisal.responsibilities.length, 2);
  assert.equal((await call('POST', `/api/hr/appraisals/${aid}/approve`, 'hr1')).s, 403, 'الاعتماد لمدير شؤون الموظفين');
  const ap = await call('POST', `/api/hr/appraisals/${aid}/approve`, 'mgr');
  assert.equal(ap.s, 200, JSON.stringify(ap.j)); assert.equal(ap.j.appraisal.status, 'approved');
  assert.ok(app.db.prepare("SELECT 1 FROM user_notifications WHERE user_id = ? AND kind = 'appraisal_approved'").get(id.emp));
  assert.equal((await call('PUT', `/api/hr/appraisals/${aid}`, 'hr1', { strengths: 'تعديل' })).s, 409, 'المعتمد لا يُعدَّل');
  const mine = (await call('GET', '/api/hr/my-appraisals', 'emp')).j.appraisals;
  assert.equal(mine.length, 1); assert.equal((await call('GET', '/api/hr/my-appraisals', 'emp2')).j.appraisals.length, 0);
  assert.equal((await call('POST', `/api/hr/my-appraisals/${aid}/acknowledge`, 'emp', { comment: 'اطلعت وأشكر الإدارة' })).s, 200);
  assert.equal((await call('POST', `/api/hr/my-appraisals/${aid}/acknowledge`, 'emp', {})).s, 409);
  assert.equal((await call('POST', `/api/hr/my-appraisals/${aid}/acknowledge`, 'emp2', {})).s, 404);
});
