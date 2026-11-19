// ملفات الترقيات العلمية: إضافة من سجل الهيئة التدريسية أو باسم مكتوب، وتحديث، والاعتماد يرفع رتبة العضو
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, member;
const api = async (m, u, who, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-promo-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  const user = (u, perms) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at, access_mode, custom_permissions_json, must_change_password) VALUES (?,?,?,?,?,?,?,0)').run(u, `مستخدم ${u}`, hash, 'staff', now, 'custom', JSON.stringify(perms));
  user('fac', ['faculty:manage']); user('other', ['grade:manage']);
  member = Number(app.db.prepare("INSERT INTO faculty_members (name, rank, specialty, status, created_at) VALUES ('د. ليلى حداد', 'أستاذ مساعد', 'التشفير', 'active', ?) RETURNING id").get(now).id);
  for (const u of ['fac', 'other']) ck[u] = await login(u);
});
test.after(async () => { await app.close(); });

test('إضافة ملف ترقية: لصاحب الصلاحية، بقيم صحيحة، ولا ملفين مفتوحين للرتبة نفسها', async () => {
  assert.equal((await api('POST', '/api/expansions/promotions', 'other', { faculty_name: 'س', target_rank: 'أستاذ' })).s, 403);
  const o = (await api('GET', '/api/expansions/promotions/options', 'fac')).j;
  assert.ok(o.ranks.includes('أستاذ مشارك') && o.members.some((m) => m.id === member));
  assert.equal((await api('POST', '/api/expansions/promotions', 'fac', { member_id: member, target_rank: 'رتبة وهمية', research_points: 50, teaching_years: 4 })).s, 400, 'الرتبة من القائمة');
  assert.equal((await api('POST', '/api/expansions/promotions', 'fac', { member_id: member, target_rank: 'أستاذ مساعد', research_points: 50, teaching_years: 4 })).s, 400, 'المستهدفة تختلف عن الحالية');
  assert.equal((await api('POST', '/api/expansions/promotions', 'fac', { member_id: member, target_rank: 'أستاذ مشارك', research_points: -3, teaching_years: 4 })).s, 400, 'النقاط ضمن الحدود');
  const ok = await api('POST', '/api/expansions/promotions', 'fac', { member_id: member, target_rank: 'أستاذ مشارك', research_points: 64, required_points: 100, teaching_years: 5 });
  assert.equal(ok.s, 201, JSON.stringify(ok.j));
  const row = app.db.prepare('SELECT * FROM faculty_promotions WHERE id = ?').get(ok.j.id);
  assert.equal(row.faculty_name, 'د. ليلى حداد'); assert.equal(row.current_rank, 'أستاذ مساعد', 'من سجل العضو'); assert.equal(row.specialty, 'التشفير');
  assert.equal((await api('POST', '/api/expansions/promotions', 'fac', { member_id: member, target_rank: 'أستاذ مشارك', research_points: 70, teaching_years: 5 })).s, 409, 'ملف مفتوح للرتبة نفسها');
  // عضو غير مسجَّل في السجل: باسم مكتوب ورتبة حالية لازمة
  const free = await api('POST', '/api/expansions/promotions', 'fac', { faculty_name: 'د. سامر خليل', specialty: 'الأدلة الجنائية', current_rank: 'محاضر', target_rank: 'أستاذ مساعد', research_points: 30, teaching_years: 3 });
  assert.equal(free.s, 201, JSON.stringify(free.j));
  assert.ok((await api('GET', '/api/expansions/overview', 'fac')).j.promotions.length >= 2);
});

test('تحديث الملف واعتماده بقرار المجلس يرفع رتبة العضو، ولا يُعدَّل بعدها', async () => {
  const p = app.db.prepare('SELECT id FROM faculty_promotions WHERE member_id = ?').get(member);
  assert.equal((await api('PUT', `/api/expansions/promotions/${p.id}`, 'fac', { committee_status: 'حالة غير معروفة' })).s, 400);
  const up = await api('PUT', `/api/expansions/promotions/${p.id}`, 'fac', { research_points: 104, committee_status: 'مستوفٍ للشروط' });
  assert.equal(up.s, 200, JSON.stringify(up.j)); assert.equal(up.j.rankUpdated, false);
  assert.equal(app.db.prepare('SELECT rank FROM faculty_members WHERE id = ?').get(member).rank, 'أستاذ مساعد');
  const fin = await api('PUT', `/api/expansions/promotions/${p.id}`, 'fac', { committee_status: 'معتمدة بقرار مجلس الجامعة' });
  assert.equal(fin.s, 200); assert.equal(fin.j.rankUpdated, true);
  assert.equal(app.db.prepare('SELECT rank FROM faculty_members WHERE id = ?').get(member).rank, 'أستاذ مشارك');
  assert.equal((await api('PUT', `/api/expansions/promotions/${p.id}`, 'fac', { research_points: 1 })).s, 409, 'المعتمد لا يُعدَّل');
});
