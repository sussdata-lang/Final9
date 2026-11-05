// بيئة اختبار: تنسخ قاعدة إلى قاعدة أخرى وتخفي كل البيانات الشخصية في النسخة.
//   SOURCE_URL=postgres://... TARGET_URL=postgres://.../suss_test node scripts/make-anon-test-db.mjs --confirm
// الهدف يُمسح بالكامل. يرفض ما لم يكن اسم قاعدة الهدف يحوي test أو staging، أو كانت هي المصدر.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const source = process.env.SOURCE_URL ?? '', target = process.env.TARGET_URL ?? '';
const dbName = (u) => decodeURIComponent(new URL(u).pathname.slice(1));
const fail = (m) => { console.error(m); process.exit(1); };
if (!process.argv.includes('--confirm') || !source || !target) fail('حدّد SOURCE_URL وTARGET_URL وأضف --confirm.');
if (source === target) fail('الهدف هو المصدر نفسه.');
if (!/(test|staging)/i.test(dbName(target))) fail('اسم قاعدة الهدف يجب أن يحوي test أو staging.');

// الأعمدة الشخصية: جدول ← عمود ← قيمة بديلة مبنية على رقم السطر
const PII = {
  users: { display_name: "'مستخدم ' || id", failed_logins: '0' },
  student_profiles: {
    first_name: "'اسم'", father_name: "'أب'", last_name: "'كنية ' || user_id", mother_name: "'أم'", name_en: "'Student ' || user_id",
    national_id: "lpad(user_id::text, 11, '0')", phone: 'NULL', email: 'NULL', address: 'NULL', birth_place: 'NULL',
    guardian_name: 'NULL', guardian_phone: 'NULL', emergency_phone: 'NULL', notes: 'NULL', hs_school: 'NULL',
  },
  faculty_members: { name: "'عضو هيئة ' || id", email: 'NULL', phone: 'NULL' },
  hr_employees: { name: "'موظف ' || id", personalid: "'ID-' || id", email: 'NULL', phone: 'NULL' },
  hr_signed_payslips: { employee_name: "'موظف ' || id" },
  sa_applicants: { full_name: "'متقدم ' || id" },
  alumni_records: { full_name: "'خريج ' || id" },
  library_loans: { borrower_name: "'مستعير ' || id" },
  dorm_allocations: { student_name: "'طالب ' || id" },
  housing_handouts: { student_name: "'طالب ' || id" },
  lms_quiz_submissions: { student_name: "'طالب ' || id" },
  complaints: { body: "'نص مخفي'" },
};
const CLEAR = ['sessions', 'push_subscriptions', 'idempotency_keys', 'import_staging_chunks', 'import_staging', 'rate_counters'];

const dump = path.join(process.env.TEMP || os.tmpdir(), `anon-${crypto.randomBytes(6).toString('hex')}.dump`);
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }); if (r.status !== 0) fail(`${cmd}: ${String(r.stderr).slice(0, 400)}`); };

const adminUrl = new URL(target); adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.href }); await admin.connect();
const name = dbName(target).replace(/"/g, '');
await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();
try {
  run('pg_dump', ['--no-owner', '--no-privileges', '-Fc', '-f', dump, source]);
  run('pg_restore', ['--no-owner', '--no-privileges', '-d', target, dump]);
} finally { fs.rmSync(dump, { force: true }); }

const db = new pg.Client({ connectionString: target }); await db.connect();
const columns = async (t) => new Set((await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', ['public', t])).rows.map((r) => r.column_name));
await db.query('BEGIN');
for (const [table, map] of Object.entries(PII)) {
  const have = await columns(table);
  const sets = Object.entries(map).filter(([c]) => have.has(c)).map(([c, v]) => `"${c}" = ${v}`);
  if (sets.length) await db.query(`UPDATE "${table}" SET ${sets.join(', ')}`);
}
for (const t of CLEAR) if ((await columns(t)).size) await db.query(`DELETE FROM "${t}"`);
// كلمات المرور في النسخة لا تصلح لشيء حتى يعيّنها من يهيئ البيئة، والأسرار لا تُنقل
await db.query("UPDATE users SET password_hash = '!', must_change_password = 1");
await db.query("DELETE FROM site_settings WHERE key ILIKE '%secret%' OR key ILIKE '%token%' OR key ILIKE '%vapid%' OR key ILIKE '%password%'");
await db.query('COMMIT');
const left = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE password_hash <> '!'");
await db.end();
if (left.rows[0].n) fail('بقيت كلمات مرور في النسخة.');
console.log(`جاهزة: ${name}. البيانات الشخصية مخفية وكلمات المرور ملغاة.`);
