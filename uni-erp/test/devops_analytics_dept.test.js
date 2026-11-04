import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { buildDevopsAnalytics } from '../server/services/v12_modules.js';
import { buildHrProOverview } from '../server/services/hr_integrated.js';

test('DevOps Incident Analytics & Delivery Statistics', async (t) => {
  const db = await openDb(':memory:');
  const empty = buildDevopsAnalytics(db).stats;
  assert.equal(empty.total, 0, 'لا بلاغات مزروعة');
  assert.equal(empty.avgLatencyMs, 0, 'لا زمن مخترع');
  assert.equal(empty.deliverySuccessRate, 100, 'لا بلاغات تعني لا إخفاق');
  const ins = db.prepare('INSERT INTO devops_incident_reports (report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  ins.run('INC-T-1', 'Code Studio', 'FILE_SAVE_FAILURE', 'critical', 'a.js', 'x', '{"latencyMs":40,"deliveredVia":"direct"}', '{}', 'resolved', Date.now());
  ins.run('INC-T-2', 'Code Studio', 'FILE_LOAD_FAILURE', 'error', 'b.js', 'y', '{}', '{}', 'open', Date.now());

  const analytics = buildDevopsAnalytics(db);
  assert.equal(analytics.stats.total, 2);
  assert.equal(analytics.stats.avgLatencyMs, 40, 'البلاغ بلا زمن لا يدخل المتوسط');
  assert.equal(analytics.stats.resolutionRate, 50);

  assert.ok(analytics, 'Analytics object should exist');
  assert.ok(analytics.stats, 'Stats metrics should exist');
  assert.ok(typeof analytics.stats.deliverySuccessRate === 'number');
  assert.ok(analytics.stats.deliverySuccessRate > 90, 'Delivery success rate should be high (>90%)');
  assert.ok(typeof analytics.stats.resolutionRate === 'number');
  assert.ok(Array.isArray(analytics.timeSeries), 'Time series should be an array');
  assert.equal(analytics.timeSeries.length, 7, 'Time series should cover 7 days');
  assert.ok(Array.isArray(analytics.byOperation), 'byOperation should be an array');
  assert.ok(Array.isArray(analytics.bySeverity), 'bySeverity should be an array');
  assert.ok(Array.isArray(analytics.byFile), 'byFile should be an array');
});

test('Department Isolation vs Admin Global Scope for Statistics', async (t) => {
  const db = await openDb(':memory:');

  // 1. Admin Request without department filter -> Sees ALL departments
  const adminOverview = buildHrProOverview(db, '2026-10-11', {
    user: { id: 1, role: 'admin', username: 'admin' },
  });

  assert.equal(adminOverview.userRole, 'admin');
  assert.equal(adminOverview.isScopedToDepartment, false, 'Admin must not be locked to a single department');
  assert.ok(adminOverview.allEnterpriseStats, 'Admin must receive allEnterpriseStats');
  assert.ok(adminOverview.enterpriseModules.length >= 9, 'All 9 enterprise modules must be returned');
  assert.ok(adminOverview.analytics.departmentBreakdown.length > 1, 'Admin sees all departments breakdown');

  // 2. Admin Request with specific department filter
  const adminFiltered = buildHrProOverview(db, '2026-10-11', {
    user: { id: 1, role: 'admin', username: 'admin' },
    dept: 'الشؤون الإدارية',
  });
  assert.equal(adminFiltered.activeDepartmentFilter, 'الشؤون الإدارية');
  assert.ok(adminFiltered.employees.every((e) => e.department === 'الشؤون الإدارية'), 'Filtered employees must belong to the selected department');

  // 3. Non-Admin (Customer Service / Student Affairs Staff) -> Locked to their department
  const staffOverview = buildHrProOverview(db, '2026-10-11', {
    user: { id: 2, role: 'staff', username: 'staff1' },
    myDept: 'شؤون الطلاب',
  });

  assert.equal(staffOverview.userRole, 'staff');
  assert.equal(staffOverview.isScopedToDepartment, true, 'Non-admin must be scoped to their department');
  assert.equal(staffOverview.myDepartment, 'شؤون الطلاب');
  assert.ok(staffOverview.employees.every((e) => e.department === 'شؤون الطلاب'), 'Employees must be isolated to the department');
  assert.ok(staffOverview.payroll.every((p) => p.department === 'شؤون الطلاب'), 'Payroll records must be isolated to the department');

  // 4. Non-Admin attempting to request another department via query param -> Ignored & still locked to their department
  const staffTamperOverview = buildHrProOverview(db, '2026-10-11', {
    user: { id: 2, role: 'staff', username: 'staff1' },
    myDept: 'شؤون الطلاب',
    dept: 'الشؤون الإدارية', // Tamper attempt
  });
  assert.equal(staffTamperOverview.isScopedToDepartment, true);
  assert.equal(staffTamperOverview.myDepartment, 'شؤون الطلاب');
  assert.ok(staffTamperOverview.employees.every((e) => e.department === 'شؤون الطلاب'), 'Tamper must be prevented; remains isolated');

  // 5. الأقسام تطابق الهيكل المعتمد، ولا أرقام مكتوبة في الكود
  const names = adminOverview.lookups.departments.map((d) => d.label);
  assert.ok(names.includes('شؤون الطلاب') && names.includes('كلية الأمن السيبراني'), 'من الهيكل والجهات الأكاديمية');
  for (const old of ['التسويق', 'المبيعات', 'خدمة العملاء', 'التشغيل والإنتاج']) {
    assert.ok(!names.includes(old), old);
    assert.ok(!adminOverview.allEnterpriseStats.some((m) => m.department === old), old);
  }
  const fin = adminOverview.enterpriseModules.find((m) => m.id === 'fin_dept');
  assert.equal(fin.metrics.find((x) => x.label === 'قيود اليومية المسجلة').value, 0, 'قاعدة فارغة تعرض صفراً لا رقماً مخترعاً');
});
