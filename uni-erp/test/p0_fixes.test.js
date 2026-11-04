// بنود P0 من التدقيق: وضع العرض في الإنتاج، ورد قاعدة البيانات المتأخر، والمعالجات المضمنة التي تمنعها CSP.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { SyncExecutor } from '../server/db.js';
import { demoModeBlocked } from '../server/services/dev_accounts.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const executor = (opts) => new SyncExecutor({ connectionString: process.env.DATABASE_URL }, opts);

test('DEMO_MODE يُرفض مع NODE_ENV=production فقط', () => {
  assert.equal(demoModeBlocked({ DEMO_MODE: '1', NODE_ENV: 'production' }), true);
  assert.equal(demoModeBlocked({ DEMO_MODE: '1', NODE_ENV: 'development' }), false);
  assert.equal(demoModeBlocked({ DEMO_MODE: '1' }), false);
  assert.equal(demoModeBlocked({ NODE_ENV: 'production' }), false);
});

test('التشغيل يتوقف قبل لمس قاعدة البيانات عند DEMO_MODE في الإنتاج', async () => {
  const prev = { DEMO_MODE: process.env.DEMO_MODE, NODE_ENV: process.env.NODE_ENV };
  process.env.DEMO_MODE = '1'; process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(createApp({ port: 0 }), /DEMO_MODE/);
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('رد الاستعلام الذي انتهت مهلته لا يُقرأ نتيجةً للاستعلام التالي', () => {
  const ex = executor({ waitMs: 150, statementTimeoutMs: 0 });
  try {
    assert.throws(() => ex.query("SELECT pg_sleep(0.5), 'old' AS v"), /timed out/);
    ex.waitMs = 5000;
    // ينتهي النوم القديم أثناء انتظار هذا الاستعلام
    assert.equal(ex.query("SELECT pg_sleep(0.8), 'new' AS v")[0].v, 'new');
    assert.equal(ex.query("SELECT 'after' AS v")[0].v, 'after');
  } finally { ex.terminate(); }
});

test('خطأ الاستعلام المتخلى عنه لا يُقرأ خطأً للاستعلام التالي', () => {
  const ex = executor({ waitMs: 150, statementTimeoutMs: 0 });
  try {
    assert.throws(() => ex.query('SELECT pg_sleep(0.5), 1 / 0 AS v FROM generate_series(1, 1)'), /timed out|division/);
    ex.waitMs = 5000;
    assert.equal(ex.query("SELECT pg_sleep(0.8), 'new' AS v")[0].v, 'new');
  } finally { ex.terminate(); }
});

test('القاعدة تلغي الاستعلام قبل انتهاء مهلة الانتظار', () => {
  const ex = executor({ waitMs: 5000, statementTimeoutMs: 150 });
  try {
    assert.throws(() => ex.query('SELECT pg_sleep(3)'), /statement timeout/);
    assert.equal(ex.query('SELECT 1 AS v')[0].v, 1);
  } finally { ex.terminate(); }
});

test('النتيجة الأكبر من الذاكرة المشتركة تصل كاملة بعد انتهاء مهلة سابقة', () => {
  const ex = executor({ waitMs: 150, statementTimeoutMs: 0 });
  try {
    assert.throws(() => ex.query('SELECT pg_sleep(0.4)'), /timed out/);
    ex.waitMs = 10000;
    const v = ex.query("SELECT repeat('ع', 9000000) AS v")[0].v;
    assert.equal(v.length, 9000000);
    assert.ok(/^ع+$/.test(v));
  } finally { ex.terminate(); }
});

test('الميزانية العمومية تقرأ الصفوف والإجماليات بالشكل الذي يرسله الخادم', () => {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'finance.js'), 'utf8');
  assert.doesNotMatch(src, /bs\.(assets|liabilities|equity)\.map\(|bs\.(totalAssets|totalLiabilities|totalEquity|retainedEarnings)/);
  for (const part of ['bs.assets.rows.map(', 'bs.liabilities.rows.map(', 'bs.equity.rows.map(', 'bs.equity.surplus']) assert.ok(src.includes(part), part);
});

test('لا معالجات أحداث مضمنة في الواجهة، فسياسة CSP تمنعها', () => {
  const inline = /<[^>]*\son(click|change|input|submit|error|load|key\w+|mouse\w+|focus|blur)=/;
  const found = fs.readdirSync(PUBLIC_DIR).filter((f) => /\.(js|html)$/.test(f))
    .filter((f) => inline.test(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8')));
  assert.deepEqual(found, []);
});
