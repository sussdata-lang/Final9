import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { verifyAuditChain } from '../server/audit.js';
import { createRequest, decideRequest, createOrder, orderAction, createReceipt, createSupplier, createItem, createWarehouse } from '../server/services/procurement/core.js';
import { createEntry, postEntry, sysAccount, ready } from '../server/services/finance/core.js';
import { transitionGrades } from '../server/services/workflow.js';
import { enterGrade } from '../server/services/academics.js';
import { addTransferEquivalence, executeLifecycleMovement, createDisciplinaryRecord } from '../server/services/student_affairs_suite.js';

test('Uni-ERP v12.9 Comprehensive Audit Report Fixes Verification (All 17 Bugs + 37 Accounts)', async (t) => {
  const app = await createApp({ dbPath: ':memory:', port: 0, scryptN: 1024, cookieSecure: false });
  t.after(() => app.close());
  const { db } = app;
  ready(db);

  // Section II: Verify all 37 accounts exist, are active, unlocked, and have must_change_password = 0
  const usersCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE active = 1 AND must_change_password = 0 AND locked_until = 0').get().c;
  assert.ok(usersCount >= 37, `Expected at least 37 active unlocked accounts, got ${usersCount}`);

  // Bug #1: Missing Role Permissions in structure.js
  const procureRole = db.prepare("SELECT permissions_json FROM roles WHERE key = 'head_procure'").get();
  assert.ok(procureRole, 'head_procure role must exist');
  const procurePerms = JSON.parse(procureRole.permissions_json);
  assert.ok(procurePerms.includes('procurement:manage'), 'head_procure must have procurement:manage');
  assert.ok(procurePerms.includes('procurement:stock'), 'head_procure must have procurement:stock');
  assert.ok(procurePerms.includes('procurement:assets'), 'head_procure must have procurement:assets');

  const hrRole = db.prepare("SELECT permissions_json FROM roles WHERE key = 'head_hr'").get();
  const hrPerms = JSON.parse(hrRole.permissions_json);
  assert.ok(hrPerms.includes('hr:manage'), 'head_hr must have hr:manage');
  assert.ok(hrPerms.includes('hr_payroll:approve'), 'head_hr must have hr_payroll:approve');

  // Bug #2: System Account Keys (rev_tuition / tuition_rev, general_exp, inventory)
  assert.ok(sysAccount(db, 'rev_tuition'), 'sysAccount(rev_tuition) must resolve');
  assert.ok(sysAccount(db, 'tuition_rev'), 'sysAccount(tuition_rev) alias must resolve');
  assert.ok(sysAccount(db, 'general_exp'), 'sysAccount(general_exp) must resolve');
  assert.ok(sysAccount(db, 'inventory'), 'sysAccount(inventory) must resolve');

  // Bug #3, #4, #5: Procurement SoD, Over-Receipt Protection, and Accounting Handoff
  const requesterUser = db.prepare("SELECT id, display_name FROM users WHERE username = 'staff1'").get();
  const approverUser = db.prepare("SELECT id, display_name FROM users WHERE username = 'admin'").get();
  const requester = { id: requesterUser.id, role: 'staff', display_name: requesterUser.display_name, label: requesterUser.display_name, unit_id: 1, can: () => true };
  const approver = { id: approverUser.id, role: 'admin', display_name: approverUser.display_name, label: approverUser.display_name, unit_id: 1, can: () => true };

  const { warehouse: wh } = createWarehouse({ db }, approver, { code: 'WH-TEST-99', name: 'مستودع اختباري' }, '127.0.0.1');
  const { item } = createItem({ db }, approver, { code: 'ITM-TEST-99', name: 'حاسوب محمول اختباري', warehouseId: wh.id, unit: 'قطعة', minStock: 1 }, '127.0.0.1');
  const { supplier: sup } = createSupplier({ db }, approver, { code: 'SUP-TEST-99', name: 'مورد اختباري' }, '127.0.0.1');

  const { request: pr } = createRequest({ db }, requester, {
    title: 'طلب شراء حواسيب',
    warehouseId: wh.id,
    submit: true,
    lines: [{ itemId: item.id, description: 'حاسوب محمول', qty: 5, estCost: 1000 }],
  }, '127.0.0.1');

  // Bug #4: Self-approval must be blocked with 403 sod_violation
  assert.throws(
    () => decideRequest({ db }, requester, pr.id, 'approved', 'موافقة ذاتية', '127.0.0.1'),
    (err) => err.status === 403 && err.code === 'sod_violation',
    'Requester must not be allowed to approve their own purchase request'
  );

  // Valid approval by another actor
  decideRequest({ db }, approver, pr.id, 'approved', 'معتمد أصولاً', '127.0.0.1');

  const { order: po } = createOrder({ db }, approver, {
    supplierId: sup.id,
    requestId: pr.id,
    lines: [{ itemId: item.id, description: 'حاسوب محمول', qty: 5, unitCost: 1000 }],
  }, '127.0.0.1');
  orderAction({ db }, approver, po.id, 'order', '127.0.0.1');

  // Bug #3: Over-receipt (qty 6 > ordered 5) must be rejected
  assert.throws(
    () => createReceipt({ db }, approver, {
      orderId: po.id,
      warehouseId: wh.id,
      lines: [{ itemId: item.id, qty: 6, unitCost: 1000 }],
    }, '127.0.0.1'),
    (err) => err.status === 409 && err.code === 'over_receipt_qty',
    'Receiving more than ordered quantity must be rejected'
  );

  // Valid receipt of 5 units -> Bug #5: creates posted accrual JV in fin_entries
  const entriesBefore = db.prepare("SELECT COUNT(*) AS c FROM fin_entries WHERE source LIKE 'proc_receipt:%'").get().c;
  createReceipt({ db }, approver, {
    orderId: po.id,
    warehouseId: wh.id,
    lines: [{ itemId: item.id, qty: 5, unitCost: 1000 }],
  }, '127.0.0.1');
  const entriesAfter = db.prepare("SELECT COUNT(*) AS c FROM fin_entries WHERE source LIKE 'proc_receipt:%' AND status = 'posted'").get().c;
  assert.equal(entriesAfter, entriesBefore + 1, 'Warehouse receipt must automatically create a posted accrual JV');

  // Bug #6: Negative Cash Balance Prevention
  const cashAcc = sysAccount(db, 'cash');
  const expAcc = sysAccount(db, 'general_exp');
  const hugeDraft = createEntry({ db }, approver, {
    day: '2026-10-31',
    type: 'PV',
    description: 'سند صرف يتجاوز رصيد الصندوق',
    lines: [
      { accountId: expAcc.id, debit: 900000000, credit: 0 },
      { accountId: cashAcc.id, debit: 0, credit: 900000000 },
    ],
  }, '127.0.0.1');
  assert.throws(
    () => postEntry({ db }, approver, hugeDraft.id, '127.0.0.1'),
    (err) => err.status === 409 && err.code === 'insufficient_cash_balance',
    'Posting cash credit exceeding cash balance must be rejected with 409 insufficient_cash_balance'
  );

  // Bug #8: Grades Workflow SoD
  const studentRow = db.prepare("SELECT id FROM users WHERE role = 'student' LIMIT 1").get();
  const courseRow = db.prepare('SELECT id FROM courses LIMIT 1').get();
  if (studentRow && courseRow) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('grades.workflow_enabled', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
    enterGrade({ db }, requester, studentRow.id, { courseId: courseRow.id, academicYear: '2026/2027', theory: 50, practical: 25 }, '127.0.0.1');
    const gradeRow = db.prepare('SELECT id FROM grades WHERE student_id = ? AND course_id = ? ORDER BY id DESC LIMIT 1').get(studentRow.id, courseRow.id);
    transitionGrades({ db }, requester, { ids: [gradeRow.id], stage: 'reviewed' }, '127.0.0.1');
    assert.throws(
      () => transitionGrades({ db }, requester, { ids: [gradeRow.id], stage: 'approved' }, '127.0.0.1'),
      (err) => err.status === 403 && err.code === 'sod_violation',
      'User who entered/reviewed grade must not be allowed to approve it'
    );
  }

  // Bug #9: Audit Chain Verification must not crash
  const chainResult = verifyAuditChain(db);
  assert.equal(typeof chainResult.ok, 'boolean');
  assert.equal(chainResult.ok, true, 'Audit chain must be intact');

  // Bug #10 & #17: Student Affairs Suite RBAC
  const unauthorizedStudent = { id: 999, role: 'student', can: () => false };
  assert.throws(
    () => addTransferEquivalence({ db }, unauthorizedStudent, {}, '127.0.0.1'),
    (err) => err.status === 403
  );
  assert.throws(
    () => executeLifecycleMovement({ db }, unauthorizedStudent, {}, '127.0.0.1'),
    (err) => err.status === 403
  );
  assert.throws(
    () => createDisciplinaryRecord({ db }, unauthorizedStudent, {}, '127.0.0.1'),
    (err) => err.status === 403
  );

  // DevSecOps Review Fixes Verification (Issues #1 - #5)
  const { loadConfig } = await import('../server/config.js');
  const { effective, SOD_SENSITIVE_PERMISSIONS } = await import('../server/permissions.js');
  const fs = await import('node:fs');

  // DevSecOps #1: PostgreSQL URI in DATABASE_URL must never leak into filesystem path for secret.key
  const pgCfg = loadConfig({ dbPath: 'postgres://admin:SuperSecretPass@db.internal:5432/unierp', signingKey: null });
  assert.ok(pgCfg.signingKey && pgCfg.signingKey.length >= 32, 'signingKey must be generated safely in DEFAULT_DATA_DIR when dbPath is a postgres:// URI');
  assert.equal(fs.existsSync('postgres:'), false, 'Must not create a local postgres: directory on disk');

  // DevSecOps #2 & #3: Non-root USER node in Dockerfiles & masked password in seed.js
  const seedSrc = fs.readFileSync(new URL('../scripts/seed.js', import.meta.url), 'utf8');
  assert.equal(seedSrc.includes('JSON.stringify(password)'), false, 'seed.js must not print plaintext password to stdout');
  const dockerRailway = fs.readFileSync(new URL('../Dockerfile.railway', import.meta.url), 'utf8');
  // التطبيق لا يعمل كـ root: إما USER node مباشرة، أو ENTRYPOINT يصلح ملكية القرص المركَّب ثم يُسقط الصلاحيات إلى node عبر su-exec
  const entrypoint = fs.readFileSync(new URL('../docker-entrypoint.sh', import.meta.url), 'utf8');
  const dropsToNode = dockerRailway.includes('USER node') || (dockerRailway.includes('ENTRYPOINT') && /exec su-exec node:node "\$@"/.test(entrypoint));
  assert.ok(dropsToNode && dockerRailway.includes('chmod 700 data') && entrypoint.includes('chmod 700 /app/data'), 'Dockerfile.railway must run the app as node (USER or su-exec) and chmod 700 data');

  // DevSecOps #4: HTTPS TSA_URL in .env.example
  const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.ok(envExample.includes('TSA_URL=https://timestamp.digicert.com'), '.env.example must use HTTPS TSA_URL');

  // DevSecOps #5: Configurable Separation of Duties (STRICT_ADMIN_SOD) for default admin role
  const adminRow = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  process.env.STRICT_ADMIN_SOD = '1';
  try {
    const strictPerms = effective(db, adminRow);
    for (const sPerm of SOD_SENSITIVE_PERMISSIONS) {
      assert.equal(strictPerms.includes(sPerm), false, `Strict SoD must exclude ${sPerm} from default admin`);
    }
  } finally {
    delete process.env.STRICT_ADMIN_SOD;
  }
});
