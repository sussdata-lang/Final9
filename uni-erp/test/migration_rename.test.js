// ترحيل أُعيدت تسميته: وجود الاسمين معاً في القاعدة، أو بقاء الملف القديم على الخادم، لا يمنع التشغيل.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createApp } from '../server/app.js';
import { migrationFiles } from '../server/db.js';

const OLD = '029_student_affairs_suite.sql', NEW = '029b_student_affairs_suite.sql';

test('الملف القديم لا يُنفَّذ حتى لو بقي مع الجديد', () => {
  assert.deepEqual(migrationFiles(['030_b.sql', OLD, NEW, '029_high_concurrency_indexes.sql', 'readme.txt']), ['029_high_concurrency_indexes.sql', NEW, '030_b.sql']);
});

test('التشغيل ينجح مع الاسمين معاً، ومع الاسم القديم وحده', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-mig-'));
  const opts = { uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), dataDir: dir, scryptN: 1024, port: 0, backupAuto: false };
  const adminUrl = process.env.DATABASE_URL, dbName = `mig_rename_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const dbUrl = new URL(adminUrl); dbUrl.pathname = `/${dbName}`;
  const prev = { DATABASE_URL: adminUrl, DEMO_MODE: process.env.DEMO_MODE };
  process.env.DATABASE_URL = dbUrl.href;
  delete process.env.DEMO_MODE;
  const names = (app) => app.db.prepare('SELECT name FROM schema_migrations WHERE name IN (?, ?) ORDER BY name').all(OLD, NEW).map((r) => r.name);
  try {
    const first = await createApp(opts);
    assert.deepEqual(names(first), [NEW]);
    first.db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(OLD, Date.now());
    await first.close();

    const second = await createApp(opts);
    assert.deepEqual(names(second), [NEW], 'يبقى الاسم الجديد وحده');
    second.db.prepare('UPDATE schema_migrations SET name = ? WHERE name = ?').run(OLD, NEW);
    await second.close();

    const third = await createApp(opts);
    assert.deepEqual(names(third), [NEW], 'الاسم القديم وحده يُعاد تسميته ولا يُنفَّذ من جديد');
    await third.close();
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
