// المرحلة الخامسة: تقييد حقول التواصل في الخادم لكل الأقسام (الهاتف والبريد) — طبقة الواجهة input_guard.js تُفحص في المتصفح
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let app, base;
const post = async (u, body) => {
  const r = await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { s: r.status, j: await r.json().catch(() => null) };
};

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph5-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.after(() => app && app.close && app.close());

test('رقم هاتف فيه أحرف يُرفض في أي مسار قبل وصوله إلى القسم', async () => {
  for (const [body, field] of [[{ phone: '09ab123456' }, 'phone'], [{ supplier: { mobile: 'غير معروف' } }, 'mobile'], [{ rows: [{ guardian_phone: '12' }] }, 'guardian_phone'], [{ contactFax: '+12+34' }, 'contactFax']]) {
    const r = await post('/api/auth/login', { username: 'x', password: 'y', ...body });
    assert.equal(r.s, 400, JSON.stringify(body));
    assert.equal(r.j.field, field, 'الخطأ يسمّي الحقل');
    assert.match(r.j.message, /رقم الهاتف غير صالح/);
  }
});

test('بريد بلا @ أو نطاق يُرفض، والصيغ الصحيحة والقيم الفارغة تمر', async () => {
  const bad = await post('/api/auth/login', { username: 'x', password: 'y', email: 'name.example.com' });
  assert.equal(bad.s, 400);
  assert.equal(bad.j.field, 'email'); assert.match(bad.j.message, /البريد الإلكتروني غير صالح/);
  for (const body of [{ phone: '+963 944-123456', email: 'a.b@uni.edu.sy' }, { phone: '٠٩٤٤١٢٣٤٥٦' }, { phone: '', email: '' }, { phoneVisible: true, emailCount: 3 }]) {
    const r = await post('/api/auth/login', { username: 'x', password: 'y', ...body });
    assert.notEqual(r.s, 400, JSON.stringify(body));
  }
});
