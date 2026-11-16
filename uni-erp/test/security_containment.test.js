// مركز الأمان: إجراءات الاحتواء اليدوية (حجب عنوان IP ورفعه، وإنهاء جلسات حساب).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { resetWaf } from '../server/waf.js';
import { restoreManualBans } from '../server/services/security_containment.js';

const PW = 'Test#Pass12345';
let app, base, ck = {};
// trustProxy مفعّل فيُقرأ العنوان من X-Forwarded-For، فيمكن محاكاة طلبات من عناوين مختلفة
const req = (m, u, { who, body, from = '10.9.9.1' } = {}) => fetch(base + u, { method: m, headers: { 'X-Forwarded-For': from, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who ? { Cookie: ck[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
const api = async (m, u, who, body, from) => { const r = await req(m, u, { who, body, from }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j }; };
const login = async (u, from = '10.9.9.1') => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': from }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };

test.before(async () => {
  resetWaf();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-contain-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false, trustProxy: true });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  const user = (u, perms) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?)').run(u, `مستخدم ${u}`, hash, 'staff', now, perms ? 'custom' : 'role', JSON.stringify(perms || []));
  user('sec', ['security:monitor']); user('aud', ['audit:read']); user('emp', ['student:read']); user('victim', ['student:read']);
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of ['sec', 'aud', 'emp']) ck[u] = await login(u);
});
test.after(async () => { resetWaf(); await app.close(); });

test('حجب عنوان يدوياً: يمنعه من الموقع فوراً، ويُرفع، ويبقى بعد إعادة التشغيل', async () => {
  const attacker = '203.0.113.9';
  assert.equal((await req('GET', '/api/health', { from: attacker })).status, 200, 'قبل الحجب');

  assert.equal((await api('POST', '/api/security/bans', 'aud', { ip: attacker, reason: 'تخمين كلمات مرور' })).s, 403, 'المدقق يقرأ فقط');
  assert.equal((await api('POST', '/api/security/bans', 'emp', { ip: attacker, reason: 'تخمين كلمات مرور' })).s, 403);
  assert.equal((await api('POST', '/api/security/bans', 'sec', { ip: 'ليس-عنواناً', reason: 'تخمين كلمات مرور' })).s, 400);
  assert.equal((await api('POST', '/api/security/bans', 'sec', { ip: attacker, reason: 'لا' })).s, 400, 'السبب إلزامي');
  assert.equal((await api('POST', '/api/security/bans', 'sec', { ip: '10.9.9.1', reason: 'حجب عنواني نفسه' })).s, 409, 'لا يحجب المسؤول عنوانه');

  const ban = await api('POST', '/api/security/bans', 'sec', { ip: attacker, minutes: 60, reason: 'تخمين كلمات مرور من عنوان خارجي' });
  assert.equal(ban.s, 200, JSON.stringify(ban.j));
  const blocked = await req('GET', '/api/health', { from: attacker });
  assert.equal(blocked.status, 429, 'العنوان محجوب فوراً');
  assert.equal((await blocked.json()).code, 'ip_banned');
  assert.equal((await req('GET', '/api/health', { from: '198.51.100.20' })).status, 200, 'غيره لا يتأثر');

  const list = await api('GET', '/api/security/bans', 'aud');
  assert.equal(list.s, 200);
  const row = list.j.bans.find((x) => x.ip === attacker);
  assert.equal(row.manual, true); assert.match(row.reason, /تخمين/); assert.equal(row.by, 'مستخدم sec');

  // إعادة تشغيل: حالة الجدار في الذاكرة تُمحى، والحجب اليدوي يُستعاد من القاعدة
  resetWaf();
  assert.equal((await req('GET', '/api/health', { from: attacker })).status, 200, 'بعد مسح الذاكرة');
  assert.equal(restoreManualBans(app.db), 1);
  assert.equal((await req('GET', '/api/health', { from: attacker })).status, 429, 'عاد الحجب من القاعدة');

  const un = await api('POST', '/api/security/bans/unban', 'sec', { ip: attacker });
  assert.equal(un.s, 200);
  assert.equal((await req('GET', '/api/health', { from: attacker })).status, 200, 'رُفع الحجب');
  assert.equal(restoreManualBans(app.db), 0, 'ولا يعود بعد الإقلاع');
  assert.equal((await api('POST', '/api/security/bans/unban', 'sec', { ip: attacker })).s, 404);

  for (const a of ['حجب عنوان IP يدوياً', 'رفع حجب عنوان IP']) assert.ok(app.db.prepare('SELECT 1 AS x FROM audit_log WHERE action = ?').get(a), a);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS n FROM security_events WHERE kind IN ('manual_ban', 'manual_unban')").get().n), 2);
});

test('إنهاء جلسات حساب: يُخرجه من كل أجهزته، ولصاحب صلاحية مراقبة الأمن فقط', async () => {
  const c1 = await login('victim', '10.1.1.1'), c2 = await login('victim', '10.1.1.2');
  ck.v1 = c1; ck.v2 = c2;
  assert.equal((await api('GET', '/api/me', 'v1')).j.user.username, 'victim');

  assert.equal((await api('POST', '/api/security/end-sessions', 'aud', { username: 'victim', reason: 'دخول مشبوه' })).s, 403);
  assert.equal((await api('POST', '/api/security/end-sessions', 'sec', { username: 'victim', reason: 'لا' })).s, 400);
  assert.equal((await api('POST', '/api/security/end-sessions', 'sec', { username: 'غير-موجود', reason: 'دخول مشبوه' })).s, 404);
  assert.equal((await api('POST', '/api/security/end-sessions', 'sec', { username: 'sec', reason: 'تجربة على نفسي' })).s, 409, 'لا ينهي جلساته هو');

  const r = await api('POST', '/api/security/end-sessions', 'sec', { username: 'VICTIM', reason: 'دخول من عنوان غير معتاد' });
  assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.ended, 2);
  assert.equal((await api('GET', '/api/me', 'v1')).j.user, null, 'الجلسة الأولى انتهت');
  assert.equal((await api('GET', '/api/me', 'v2')).j.user, null, 'والثانية');
  assert.equal((await api('GET', '/api/me', 'sec')).j.user.username, 'sec', 'جلسة المسؤول باقية');
  assert.ok(app.db.prepare("SELECT 1 AS x FROM audit_log WHERE action = 'إنهاء جلسات مستخدم' AND ref LIKE 'victim%'").get());
});
