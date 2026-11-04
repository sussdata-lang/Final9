// لوحة الأداء: أرقامها من الخادم فعلاً، والاختبار الحي يرسل طلبات حقيقية ولا يترك أثراً، ولا يُكرَّر فوراً.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';

test('القياسات حقيقية، والاختبار الحي لا يترك سجلات ولا يُكرَّر فوراً', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-bench-'));
  const app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  t.after(() => app.close());
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`, PW = 'Str0ng-Test-Pass!';
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('adm', 'مدير', await hashPassword(PW, 1024), 'admin', Date.now());
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'adm', password: PW }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (method, url) => { const r = await fetch(base + url, { method, headers: { Cookie } }); return { status: r.status, json: await r.json() }; };

  const tele = (await call('GET', '/api/v12/high-concurrency/telemetry')).json;
  assert.equal(tele.database.indexes, Number(app.db.prepare("SELECT COUNT(*) AS c FROM pg_indexes WHERE schemaname = 'public'").get().c));
  assert.ok(tele.database.openConnections >= 1);
  assert.equal(tele.database.poolMax, 20);
  assert.equal(tele.architecture, undefined, 'لا ادعاءات ثابتة عن سعة المستخدمين');

  const before = Number(app.db.prepare('SELECT COUNT(*) AS c FROM corr_docs').get().c);
  const r = await call('POST', '/api/v12/high-concurrency/benchmark');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const b = r.json.benchmark;
  assert.deepEqual(b.stages.map((s) => s.concurrency), [10, 25, 50]);
  assert.equal(b.totalRequests, 360);
  for (const s of b.stages) { assert.equal(s.errors, 0, JSON.stringify(s)); assert.ok(s.p95Ms > 0 && s.requestsPerSec > 0); }
  assert.equal(b.writes.inserted, 50);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) AS c FROM corr_docs').get().c), before, 'الكتابة أُلغيت');
  assert.equal((await call('POST', '/api/v12/high-concurrency/benchmark')).status, 429, 'لا يُكرَّر فوراً');
  assert.equal(verifyAuditChain(app.db).ok, true);
});
