import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcAttendanceCommitment,
  calcAbsenceDeduction,
  calcLeaveMetrics,
  calcAdvanceMetrics,
  calcContractMetrics,
  calcEmployeePayroll,
} from '../server/services/hr_calculations.js';
import { createApp } from '../server/app.js';
import { ensureCoreAccounts } from '../server/services/bootstrap.js';

test('معادلات منظومة شؤون الموظفين المتكاملة (Pure Logic Unit Tests)', () => {
  // 1) معادلة الحضور والانصراف: =IF(I3>=0.95;"ممتاز";IF(I3>=0.85;"جيد";"يحتاج متابعة"))
  const att1 = calcAttendanceCommitment(26, 2, 26, 95, 85);
  assert.equal(att1.fullDays, 24);
  assert.equal(att1.commitmentRate, 100);
  assert.equal(att1.evaluationNote, 'ممتاز');

  const att2 = calcAttendanceCommitment(20, 1, 26, 95, 85);
  assert.equal(att2.fullDays, 19);
  assert.equal(att2.commitmentRate, 77);
  assert.equal(att2.evaluationNote, 'يحتاج متابعة');

  const att3 = calcAttendanceCommitment(24, 5, 26, 95, 85);
  assert.equal(att3.fullDays, 19);
  assert.equal(att3.commitmentRate, 92);
  assert.equal(att3.evaluationNote, 'جيد');

  // 2) معادلة الغياب والخصم: =E4*F4
  const abs0 = calcAbsenceDeduction(5950, 0, 'تأخير متكرر', 30, 3);
  assert.equal(abs0.dailyRate, 198.33);
  assert.equal(abs0.totalDeduction, 0);
  assert.equal(abs0.statusNote, 'لا يوجد غياب');

  const absReview = calcAbsenceDeduction(5950, 4, 'تأخير متكرر', 30, 3);
  assert.equal(absReview.statusNote, 'مراجعة إدارية');
  assert.equal(absReview.totalDeduction, 793.32);

  // 3) معادلة الإجازات وخصم الإجازة بدون راتب
  const lvUnpaid = calcLeaveMetrics('بدون راتب', 3, 5950, 21, 0, 30);
  assert.equal(lvUnpaid.unpaidDeduction, 595);
  assert.equal(lvUnpaid.remainingAnnual, 21);

  const lvAnnual = calcLeaveMetrics('سنوية', 8, 5950, 21, 0, 30);
  assert.equal(lvAnnual.unpaidDeduction, 0);
  assert.equal(lvAnnual.remainingAnnual, 13);

  // 4) معادلة إدارة السلف والأقساط (a101: 1000 / 3 = 333.33, المتبقي = 666.67)
  const adv1 = calcAdvanceMetrics(1000, 3, 1, 'مجدولة');
  assert.equal(adv1.monthlyInstallment, 333.33);
  assert.equal(adv1.remainingAmount, 666.67);

  const advPaid = calcAdvanceMetrics(500, 6, 6, 'مدفوعة');
  assert.equal(advPaid.monthlyInstallment, 0);
  assert.equal(advPaid.remainingAmount, 0);
  assert.equal(advPaid.status, 'مدفوعة');

  // 5) معادلة عقود الموظفين والتجديد (مطابقة للصورة 5 عند تاريخ 2026-10-11)
  const ct1 = calcContractMetrics('2021-04-08', '2026-07-17', '2026-10-11', 60, 15);
  assert.equal(ct1.durationDays, 1926);
  assert.equal(ct1.remainingDays, -86);
  assert.equal(ct1.renewalAlert, 'منتهي');
  assert.equal(ct1.contractStatus, 'منتهي');

  const ct2 = calcContractMetrics('2022-07-15', '2026-11-22', '2026-10-11', 60, 15);
  assert.equal(ct2.durationDays, 1591);
  assert.equal(ct2.remainingDays, 42);
  assert.equal(ct2.renewalAlert, 'يحتاج تجديد');
  assert.equal(ct2.contractStatus, 'ينتهي قريبا');

  const ct3 = calcContractMetrics('2023-10-22', '2026-12-24', '2026-10-11', 60, 15);
  assert.equal(ct3.durationDays, 1159);
  assert.equal(ct3.remainingDays, 74);
  assert.equal(ct3.renewalAlert, 'ساري');
  assert.equal(ct3.contractStatus, 'ساري');

  // 6) معادلة الرواتب والحسابات للموظف الأول أحمد كامل (مطابقة للصورة 3)
  const pay1 = calcEmployeePayroll(
    {
      id: 1,
      employeeNo: '1',
      name: 'أحمد كامل',
      salary_base: 5950,
      housing_allowance: 1071,
      transport_allowance: 575,
      insurance_amount: 654,
      tax_amount: 476,
    },
    [{ absence_days: 0, total_deduction: 0 }],
    [{ status: 'approved', unpaid_deduction: 595 }],
    [{ status: 'مجدولة', remaining_amount: 666.67, monthly_installment: 333.33 }]
  );
  assert.equal(pay1.grossEarnings, 7596);
  assert.equal(pay1.totalDeductions, 2058.33);
  assert.equal(pay1.netSalary, 5537.67);
});

test('التكامل الشامل لواجهات /api/hr-pro/* وعدم التعارض مع /api/admin/hr/*', async (t) => {
  const app = await createApp({ dbPath: ':memory:', port: 0, scryptN: 1024, cookieSecure: false });
  await ensureCoreAccounts(app, '1572690');
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '1572690' }),
  });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  const headers = { 'Content-Type': 'application/json', 'X-Session-Token': token };

  // 0) لا حد أدنى لعدد الموظفين: قاعدة جديدة فارغة تعمل دون أخطاء ودون بيانات تجريبية
  const ov0 = await (await fetch(`${base}/api/hr-pro/overview?refDate=2026-10-11`, { headers })).json();
  assert.equal(ov0.employees.length, 0);
  assert.equal(ov0.contracts.length, 0);

  // 1) إنشاء موظفين بعقود عبر الـ API (منتهٍ، قريب الانتهاء، بعيد) ثم جلب النظرة الشاملة
  const mk = async (employeeNo, name, contractEndDate) => {
    const r = await fetch(`${base}/api/hr-pro/employees`, { method: 'POST', headers, body: JSON.stringify({ employeeNo, name, baseSalary: 5000, hireDate: '2025-01-01', contractEndDate }) });
    assert.ok(r.status === 200 || r.status === 201, `إنشاء الموظف ${name}`);
  };
  await mk('T1', 'موظف منتهي العقد', '2026-07-17');
  await mk('T2', 'موظف عقده قريب الانتهاء', '2026-11-22');
  await mk('T3', 'موظف عقده بعيد', '2026-12-24');
  const ovRes = await fetch(`${base}/api/hr-pro/overview?refDate=2026-10-11`, { headers });
  assert.equal(ovRes.status, 200);
  const ov = await ovRes.json();
  assert.equal(ov.employees.length, 3);
  assert.equal(ov.payroll.length, 3);
  assert.ok(ov.payroll[0].grossEarnings > 0 && ov.payroll[0].totalDeductions > 0);
  assert.equal(ov.contracts.length, 3);
  const byDays = (d) => ov.contracts.find((c) => c.remainingDays === d);
  assert.ok(byDays(-86) && byDays(42) && byDays(74), 'الأيام المتبقية للعقود الثلاثة');
  assert.ok(ov.alerts.length >= 1, 'يجب توليد تنبيهات العقود');

  // 2) التأكد من توافق جدول hr_employees مع الواجهة القديمة /api/admin/hr/employees دون أي تعارض
  const legacyRes = await fetch(`${base}/api/admin/hr/employees`, { headers });
  assert.equal(legacyRes.status, 200);
  const legacyData = await legacyRes.json();
  assert.equal(legacyData.employees.length, 3);

  // 3) تجديد عقد منتهي والتحقق من تحوله إلى «ساري»
  const ctId = byDays(-86).id;
  const renewRes = await fetch(`${base}/api/hr-pro/contracts/${ctId}/renew`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contractTypeAr: 'دوام كامل', salary: 6200, startDate: '2026-10-11', endDate: '2027-10-11' }),
  });
  assert.equal(renewRes.status, 200);
  const renewData = await renewRes.json();
  assert.equal(renewData.renewalAlert, 'ساري');
  assert.equal(renewData.remainingDays, 365);

  // 4) تعديل إعدادات التنبيهات (مثلاً رفع فترة تنبيه انتهاء العقد إلى 90 يوماً)
  const setRes = await fetch(`${base}/api/hr-pro/settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ contract_expiry_warning_days: '90' }),
  });
  assert.equal(setRes.status, 200);
  const ovAfter = await (await fetch(`${base}/api/hr-pro/overview?refDate=2026-10-11`, { headers })).json();
  // العقد المتبقي له 74 يوماً يصبح «يحتاج تجديد» عندما تصبح فترة التنبيه 90 يوماً!
  assert.equal(ovAfter.contracts.find((c) => c.remainingDays === 74).renewalAlert, 'يحتاج تجديد');
});
