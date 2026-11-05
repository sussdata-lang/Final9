// تعدد العمليات على المنفذ نفسه: لا يتكرر رقم مستند، ولا تتفرع سلسلة التدقيق، ويسري الخروج على كل العمليات.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const baseUrl = process.env.DATABASE_URL;
const dbName = `cluster_${crypto.randomBytes(4).toString('hex')}`;
const url = new URL(baseUrl); const admin = new URL(baseUrl);
url.pathname = '/' + dbName;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-cluster-'));
const PW = 'Test-Only-Pass-1!', PORT = 34000 + Math.floor(Math.random() * 2000), base = `http://127.0.0.1:${PORT}`;
let child;
const servedBy = new Set();

async function sql(q) { const c = new pg.Client({ connectionString: admin.href }); await c.connect(); try { return await c.query(q); } finally { await c.end(); } }
const call = async (method, u, { cookie, body } = {}) => {
  const r = await fetch(base + u, { method, headers: { Connection: 'close', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.headers.get('x-served-by')) servedBy.add(r.headers.get('x-served-by'));
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], json: await r.json().catch(() => null) };
};
const login = async () => (await call('POST', '/api/auth/login', { body: { username: 'admin', password: PW } }));

test.before(async () => {
  await sql(`CREATE DATABASE ${dbName}`);
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/cluster.js'], { env: { ...process.env, DATABASE_URL: url.href, WEB_CONCURRENCY: '3', PORT: String(PORT), HOST: '127.0.0.1', SEED_PASSWORD: PW, BACKUP_AUTO: '0', UPLOAD_DIR: path.join(dir, 'up'), LOG_DIR: path.join(dir, 'logs'), BACKUP_DIR: path.join(dir, 'bk'), DATA_DIR: dir, DEMO_MODE: '', LOG_LEVEL: 'error', NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) })).status === 200) { await new Promise((r) => setTimeout(r, 2500)); return; } } catch { /* لم يبدأ بعد */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('لم يبدأ الخادم');
});

test.after(async () => {
  child?.kill('SIGTERM');
  await new Promise((r) => { const t = setTimeout(() => { child.kill('SIGKILL'); r(); }, 8000); child.once('exit', () => { clearTimeout(t); r(); }); });
  await sql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('طلبات متزامنة: الأرقام لا تتكرر وسلسلة التدقيق خط واحد', async () => {
  const { cookie, status } = await login();
  assert.equal(status, 200);
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => call('POST', '/api/finance/vouchers', { cookie, body: { kind: 'receipt', amount: 10 + i, description: `سند ${i}` } })));
  assert.deepEqual(results.filter((r) => r.status !== 201).map((r) => [r.status, r.json?.message]), []);
  const nos = results.map((r) => r.json.voucher.no);
  assert.equal(new Set(nos).size, 40, 'رقم مكرر');

  const docs = await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '/api/finance/parties', { cookie, body: { name: `طرف متزامن ${i}`, kind: 'customer' } })));
  assert.deepEqual(docs.filter((r) => r.status !== 201).map((r) => r.status), []);

  const v = await call('GET', '/api/audit/verify', { cookie });
  assert.equal(v.status, 200);
  assert.equal(v.json.ok, true, JSON.stringify(v.json));
  assert.ok(servedBy.size >= 2, `الطلبات لم تتوزع: ${[...servedBy]}`);
  const c = new pg.Client({ connectionString: url.href }); await c.connect();
  const guard = (await c.query('SELECT COUNT(chain_prev)::int n, COUNT(DISTINCT chain_prev)::int d FROM audit_log')).rows[0];
  await c.end();
  assert.ok(guard.n >= 60, 'حماية السلسلة مفعلة على الصفوف الجديدة');
  assert.equal(guard.n, guard.d);
});

test('الخروج وتغيير الإعدادات يسريان على كل العمليات', async () => {
  const { cookie } = await login();
  for (let i = 0; i < 12; i++) assert.equal((await call('GET', '/api/me', { cookie })).status, 200);
  await call('POST', '/api/auth/logout', { cookie });
  await new Promise((r) => setTimeout(r, 600));
  const after = await Promise.all(Array.from({ length: 12 }, () => call('GET', '/api/me', { cookie })));
  assert.ok(after.every((r) => !r.json?.user), 'جلسة بقيت صالحة على عملية أخرى');
});

test('سجل تدقيق قديم فيه بصمات مكررة لا يمنع الإقلاع ولا التسجيل', async () => {
  const c = new pg.Client({ connectionString: url.href }); await c.connect();
  try {
    const cols = await c.query("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_log_chain_prev'");
    assert.equal(cols.rows.length, 1);
    await c.query("INSERT INTO audit_log (at, actor_label, role, action, ref, prev_hash, hash) VALUES (1, 'x', 'x', 'x', '', 'dup', 'h1'), (2, 'x', 'x', 'x', '', 'dup', 'h2')");
  } finally { await c.end(); }
  const { status } = await login();
  assert.equal(status, 200, 'يبقى تسجيل الدخول والتدقيق يعملان');
});

test('حد المعدل مشترك بين العمليات، والعملية المتكررة بالتوازي تُنفذ مرة واحدة', async () => {
  const c = new pg.Client({ connectionString: url.href }); await c.connect();
  await c.query("UPDATE users SET must_change_password = 0");
  await c.end();
  // 30 طلبًا في الدقيقة للعنوان: لو كان لكل عملية حدها لمر 90 طلبًا
  let limited = 0, passed = 0;
  for (let i = 0; i < 70; i++) {
    const r = await call('GET', '/api/verify/NOPE-CODE');
    if (r.status === 429) limited++; else passed++;
    await new Promise((res) => setTimeout(res, 60));
  }
  assert.ok(limited > 15, `لم يسرِ الحد على كل العمليات: مر ${passed} ورُفض ${limited}`);

  const { cookie } = await login();
  const res = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/api/finance/payroll-entry', { cookie, body: { month: '2026-01' } })));
  assert.ok(res.every((r) => r.status < 500), JSON.stringify(res.map((r) => r.status)));
});
