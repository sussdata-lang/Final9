// المعادلات الصرفة لمنظومة شؤون الموظفين المتكاملة (مفصولة للاختبار المباشر via node:test)

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * معادلة الحضور والانصراف:
 * =IF(I3>=0.95;"ممتاز";IF(I3>=0.85;"جيد";"يحتاج متابعة"))
 */
export function calcAttendanceCommitment(actualDays, lateDays, workDaysMonth = 26, excellentPct = 95, goodPct = 85) {
  const wDays = Math.max(1, Number(workDaysMonth) || 26);
  const aDays = Math.max(0, Math.min(wDays, Number(actualDays) || 0));
  const lDays = Math.max(0, Math.min(aDays, Number(lateDays) || 0));
  const fullDays = Math.max(0, aDays - lDays);
  const commitmentRate = Math.min(100, Math.round((aDays / wDays) * 100));
  let evaluationNote = 'يحتاج متابعة';
  if (commitmentRate >= Number(excellentPct)) evaluationNote = 'ممتاز';
  else if (commitmentRate >= Number(goodPct)) evaluationNote = 'جيد';
  return {
    workDaysMonth: wDays,
    actualDays: aDays,
    lateDays: lDays,
    fullDays,
    commitmentRate,
    evaluationNote,
  };
}

/**
 * معادلة الغياب والخصم:
 * خصم اليوم = الراتب الأساسي / 30
 * إجمالي خصم الغياب = عدد أيام الغياب * خصم اليوم (=E4*F4)
 * الملاحظات: 0 -> لا يوجد غياب، >= حد المراجعة -> مراجعة إدارية، غير ذلك -> مقبول
 */
export function calcAbsenceDeduction(baseSalary, absenceDays, reason = 'تأخير متكرر', dayDivisor = 30, reviewThreshold = 3) {
  const divisor = Math.max(1, Number(dayDivisor) || 30);
  const days = Math.max(0, Number(absenceDays) || 0);
  const dailyRate = round2((Number(baseSalary) || 0) / divisor);
  const isOfficialMission = String(reason).includes('مأمورية');
  const totalDeduction = isOfficialMission ? 0 : round2(days * dailyRate);
  let statusNote = 'مقبول';
  if (days === 0) statusNote = 'لا يوجد غياب';
  else if (days >= Number(reviewThreshold)) statusNote = 'مراجعة إدارية';
  return {
    absenceDays: days,
    dailyRate,
    totalDeduction,
    statusNote,
  };
}

/**
 * معادلة الإجازات والرصيد السنوي وخصم الإجازة بدون راتب:
 * المتبقي من السنوية = الرصيد السنوي - مجموع أيام الإجازات السنوية/الاعتيادية
 * خصم إجازة بدون راتب = أيام الإجازة بدون راتب * (الراتب الأساسي / 30)
 */
export function calcLeaveMetrics(leaveTypeAr, days, baseSalary, annualQuota = 21, usedAnnualDays = 0, dayDivisor = 30) {
  const d = Math.max(0, Number(days) || 0);
  const quota = Math.max(0, Number(annualQuota) || 21);
  const divisor = Math.max(1, Number(dayDivisor) || 30);
  const isAnnual = ['سنوية', 'اعتيادي', 'إجازة سنوية', 'annual'].includes(String(leaveTypeAr).trim());
  const isUnpaid = ['بدون راتب', 'إجازة بدون راتب', 'unpaid'].includes(String(leaveTypeAr).trim());
  const dailyRate = (Number(baseSalary) || 0) / divisor;
  const unpaidDeduction = isUnpaid ? round2(d * dailyRate) : 0;
  const totalUsedAnnual = Number(usedAnnualDays) + (isAnnual ? d : 0);
  const remainingAnnual = Math.max(0, quota - totalUsedAnnual);
  return {
    days: d,
    annualQuota: quota,
    remainingAnnual,
    unpaidDeduction,
    isAnnual,
    isUnpaid,
  };
}

/**
 * معادلة إدارة السلف والأقساط:
 * قسط الشهر = قيمة السلفة / عدد الأقساط (0 إذا كانت مدفوعة)
 * المتبقي = قيمة السلفة - (قسط الشهر * الأقساط المسددة)
 */
export function calcAdvanceMetrics(amount, installmentsCount, paidInstallments = 0, status = 'مستحقة') {
  const val = Math.max(0, Number(amount) || 0);
  const count = Math.max(1, Number(installmentsCount) || 1);
  const paid = Math.max(0, Math.min(count, Number(paidInstallments) || 0));
  const isPaid = status === 'مدفوعة' || paid >= count || val === 0;
  const rawInstallment = round2(val / count);
  const monthlyInstallment = isPaid ? 0 : rawInstallment;
  const remainingAmount = isPaid ? 0 : Math.max(0, round2(val - rawInstallment * paid));
  const effectiveStatus = isPaid ? 'مدفوعة' : (status || 'مستحقة');
  return {
    amount: val,
    installmentsCount: count,
    paidInstallments: isPaid ? count : paid,
    monthlyInstallment,
    remainingAmount,
    status: effectiveStatus,
  };
}

/**
 * معادلة عقود الموظفين والتجديد:
 * مدة العقد بالأيام = تاريخ النهاية - تاريخ البداية
 * الأيام المتبقية = تاريخ النهاية - تاريخ المرجع
 * تنبيه التجديد: < 0 -> «منتهي»، <= أيام التنبيه -> «يحتاج تجديد»، غير ذلك -> «ساري»
 * حالة العقد: < 0 -> «منتهي»، <= أيام التنبيه -> «ينتهي قريبا»، غير ذلك -> «ساري»
 */
export function calcContractMetrics(startDate, endDate, refDateStr = '2026-10-11', warningDays = 60, criticalDays = 15) {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const refMs = Date.parse(`${refDateStr}T00:00:00Z`);
  const durationDays = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.round((endMs - startMs) / 86400000) : 0;
  const remainingDays = Number.isFinite(endMs) && Number.isFinite(refMs) ? Math.round((endMs - refMs) / 86400000) : 0;

  let renewalAlert = 'ساري';
  let contractStatus = 'ساري';
  let severity = 'ok';

  if (remainingDays < 0) {
    renewalAlert = 'منتهي';
    contractStatus = 'منتهي';
    severity = 'expired';
  } else if (remainingDays <= Number(warningDays)) {
    renewalAlert = 'يحتاج تجديد';
    contractStatus = 'ينتهي قريبا';
    severity = remainingDays <= Number(criticalDays) ? 'critical' : 'warning';
  }

  return {
    durationDays,
    remainingDays,
    renewalAlert,
    contractStatus,
    severity,
  };
}

/**
 * معادلة الرواتب والحسابات الشاملة (مطابقة لشاشة «الرواتب والحسابات»):
 * إجمالي الاستحقاقات = الراتب الأساسي + بدل سكن + بدل انتقال
 * إجمالي الخصومات = خصم الغياب + خصم الإجازة بدون راتب + قسط السلفة + تأمينات + ضرائب
 * صافي الراتب = إجمالي الاستحقاقات - إجمالي الخصومات
 */
export function calcEmployeePayroll(emp, empAbsences = [], empLeaves = [], empAdvances = []) {
  const baseSalary = round2(emp.salary_base ?? emp.salary ?? 0);
  const housingAllowance = round2(emp.housing_allowance ?? 0);
  const transportAllowance = round2(emp.transport_allowance ?? 0);
  const grossEarnings = round2(baseSalary + housingAllowance + transportAllowance);

  const absenceDays = empAbsences.reduce((s, a) => s + (Number(a.absence_days) || 0), 0);
  const absenceDeduction = round2(empAbsences.reduce((s, a) => s + (Number(a.total_deduction) || 0), 0));

  const unpaidLeaveDeduction = round2(
    empLeaves
      .filter((l) => l.status !== 'rejected' && l.status !== 'cancelled')
      .reduce((s, l) => s + (Number(l.unpaid_deduction) || 0), 0)
  );

  const advanceInstallment = round2(
    empAdvances
      .filter((a) => a.status !== 'مدفوعة' && Number(a.remaining_amount) > 0)
      .reduce((s, a) => s + (Number(a.monthly_installment) || 0), 0)
  );

  const insurance = round2(emp.insurance_amount ?? 0);
  const taxes = round2(emp.tax_amount ?? 0);

  const totalDeductions = round2(absenceDeduction + unpaidLeaveDeduction + advanceInstallment + insurance + taxes);
  const netSalary = round2(grossEarnings - totalDeductions);

  return {
    employeeId: emp.id,
    employeeNo: emp.employeeNo,
    name: emp.name,
    department: emp.department_name || emp.unitName || 'الموارد البشرية',
    position: emp.position || 'اداري',
    baseSalary,
    housingAllowance,
    transportAllowance,
    grossEarnings,
    absenceDays,
    absenceDeduction,
    unpaidLeaveDeduction,
    advanceInstallment,
    insurance,
    taxes,
    totalDeductions,
    netSalary,
  };
}

/**
 * محرك التنبيهات الذكية لشؤون الموظفين (عقود، التزام حضور، غياب، سلف، إجازات، فترة اختبار)
 */
export function buildHrAlerts({ employees = [], contracts = [], attendance = [], absences = [], advances = [], leaves = [], settings = {} }) {
  const alerts = [];
  const enableContract = String(settings.enable_contract_alerts ?? '1') !== '0';
  const enableAtt = String(settings.enable_attendance_alerts ?? '1') !== '0';
  const enableAdv = String(settings.enable_advance_alerts ?? '1') !== '0';
  const enableLeave = String(settings.enable_leave_alerts ?? '1') !== '0';
  const lowLeaveDays = Number(settings.low_leave_balance_alert_days ?? 3);

  if (enableContract) {
    for (const c of contracts) {
      if (c.remainingDays < 0) {
        alerts.push({
          id: `ct-exp-${c.id}`,
          type: 'contract_expired',
          severity: 'critical',
          categoryLabel: 'انتهاء عقد',
          employeeId: c.employeeId,
          employeeName: c.employeeName,
          employeeNo: c.employeeNo,
          title: `عقد منتهي منذ ${Math.abs(c.remainingDays)} يوماً — ${c.employeeName}`,
          detail: `نوع العقد: ${c.contractTypeAr} | تاريخ النهاية: ${c.endDate}`,
          actionTab: 'contract',
          contractId: c.id,
        });
      } else if (c.renewalAlert === 'يحتاج تجديد') {
        alerts.push({
          id: `ct-warn-${c.id}`,
          type: 'contract_expiring',
          severity: c.severity === 'critical' ? 'critical' : 'warning',
          categoryLabel: 'يحتاج تجديد عقد',
          employeeId: c.employeeId,
          employeeName: c.employeeName,
          employeeNo: c.employeeNo,
          title: `عقد ينتهي خلال ${c.remainingDays} يوماً — ${c.employeeName}`,
          detail: `نوع العقد: ${c.contractTypeAr} | تاريخ النهاية: ${c.endDate}`,
          actionTab: 'contract',
          contractId: c.id,
        });
      }
    }
  }

  if (enableAtt) {
    for (const a of attendance) {
      if (a.evaluationNote === 'يحتاج متابعة') {
        alerts.push({
          id: `att-low-${a.id}`,
          type: 'attendance_low',
          severity: 'warning',
          categoryLabel: 'التزام الحضور',
          employeeId: a.employeeId,
          employeeName: a.employeeName,
          employeeNo: a.employeeNo,
          title: `نسبة التزام منخفضة (${a.commitmentRate}%) — ${a.employeeName}`,
          detail: `أيام العمل الفعلية: ${a.actualDays} من ${a.workDaysMonth} | تأخير: ${a.lateHours} ساعة`,
          actionTab: 'att',
        });
      }
    }
    for (const ab of absences) {
      if (ab.statusNote === 'مراجعة إدارية') {
        alerts.push({
          id: `abs-rev-${ab.id}`,
          type: 'absence_review',
          severity: 'critical',
          categoryLabel: 'مراجعة غياب إدارية',
          employeeId: ab.employeeId,
          employeeName: ab.employeeName,
          employeeNo: ab.employeeNo,
          title: `تجاوز حد الغياب (${ab.absenceDays} أيام) — ${ab.employeeName}`,
          detail: `السبب: ${ab.reason} | الشهر: ${ab.month}`,
          actionTab: 'abs',
        });
      }
    }
  }

  if (enableAdv) {
    for (const adv of advances) {
      if (adv.status === 'مستحقة' && adv.remainingAmount > 0) {
        alerts.push({
          id: `adv-due-${adv.id}`,
          type: 'advance_due',
          severity: 'info',
          categoryLabel: 'قسط سلفة مستحق',
          employeeId: adv.employeeId,
          employeeName: adv.employeeName,
          employeeNo: adv.employeeNo,
          title: `سلفة مستحقة (${adv.advanceCode}) — ${adv.employeeName}`,
          detail: `قسط الشهر: ${adv.monthlyInstallment} | المتبقي: ${adv.remainingAmount}`,
          actionTab: 'adv',
          advanceId: adv.id,
        });
      }
    }
  }

  if (enableLeave) {
    for (const emp of employees) {
      if (emp.remainingAnnualLeave !== undefined && emp.remainingAnnualLeave <= lowLeaveDays) {
        alerts.push({
          id: `lv-low-${emp.id}`,
          type: 'leave_low',
          severity: 'warning',
          categoryLabel: 'رصيد إجازات منخفض',
          employeeId: emp.id,
          employeeName: emp.name,
          employeeNo: emp.employeeNo,
          title: `انخفاض رصيد الإجازة السنوية (${emp.remainingAnnualLeave} يوم متبقٍ) — ${emp.name}`,
          detail: `الرصيد السنوي: ${emp.annualLeaveQuota} يوم`,
          actionTab: 'leave',
        });
      }
    }
  }

  return alerts;
}
