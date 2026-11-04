// منظومة شؤون الموظفين المتكاملة (HR Integrated System — تدمج كافة الجداول مع الموجود حالياً دون أي تعارض)
import { HttpError } from '../http.js';
import { audit } from '../audit.js';
import {
  calcAttendanceCommitment,
  calcAbsenceDeduction,
  calcLeaveMetrics,
  calcAdvanceMetrics,
  calcContractMetrics,
  calcEmployeePayroll,
  buildHrAlerts,
} from './hr_calculations.js';

const clean = (s, max = 250) => String(s ?? '').trim().slice(0, max);

// المرجع الزمني الافتراضي المطابق لتواريخ العقود في بيانات النظام (أكتوبر 2026)
const DEFAULT_REF_DATE = '2026-10-11';

// أقسام الجامعة مصدرها الهيكل التنظيمي المعتمد والجهات الأكاديمية، لا قائمة مستقلة
export function universityDepartments(db) {
  const units = db.prepare("SELECT name FROM org_units WHERE active = 1 AND kind IN ('department', 'college') ORDER BY id").all();
  const faculties = db.prepare('SELECT name FROM faculties WHERE active = 1 ORDER BY id').all();
  return [...new Set([...units, ...faculties].map((r) => r.name))];
}

export function getHrAlertSettingsMap(db) {
  const rows = db.prepare('SELECT * FROM hr_alert_settings ORDER BY category, key').all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return { rows, map };
}

/**
 * بناء النظرة الشاملة لمنظومة شؤون الموظفين المتكاملة (تجمع كافة الجداول والإحصائيات والتنبيهات)
 */
export function buildHrProOverview(db, refDateStr = DEFAULT_REF_DATE, options = {}) {
  const { rows: settingRows, map: settings } = getHrAlertSettingsMap(db);
  const warningDays = Number(settings.contract_expiry_warning_days ?? 60);
  const criticalDays = Number(settings.contract_expiry_critical_days ?? 15);
  const excellentPct = Number(settings.attendance_excellent_pct ?? 95);
  const goodPct = Number(settings.attendance_good_pct ?? 85);
  const workDaysMonth = Number(settings.standard_month_work_days ?? 26);
  const dayDivisor = Number(settings.salary_day_divisor ?? 30);
  const defaultLeaveQuota = Number(settings.default_annual_leave_days ?? 21);

  // 1) الموظفون
  const rawEmps = db.prepare(`
    SELECT e.*, u.name AS unitName
    FROM hr_employees e
    LEFT JOIN org_units u ON u.id = e.unit_id
    ORDER BY (CASE WHEN e.employeeNo ~ '^[0-9]{1,15}$' THEN e.employeeNo::bigint ELSE 0 END) ASC, e.employeeNo ASC, e.id ASC
  `).all();

  // 2) الإجازات
  const rawLeaves = db.prepare(`
    SELECT l.*, e.name AS employeeName, e.employeeNo, e.position, e.salary_base, e.annual_leave_quota
    FROM hr_leaves l
    JOIN hr_employees e ON e.id = l.employee_id
    ORDER BY l.id ASC
  `).all();

  // حساب المستهلك السنوي لكل موظف
  const usedAnnualByEmp = new Map();
  for (const l of rawLeaves) {
    const typeAr = l.leave_type_ar || (l.leave_type === 'annual' ? 'سنوية' : l.leave_type === 'sick' ? 'مرضية' : l.leave_type === 'unpaid' ? 'بدون راتب' : l.leave_type === 'maternity' ? 'أمومة' : 'عارضة');
    if (l.status !== 'rejected' && l.status !== 'cancelled' && ['سنوية', 'اعتيادي'].includes(typeAr)) {
      usedAnnualByEmp.set(l.employee_id, (usedAnnualByEmp.get(l.employee_id) || 0) + (Number(l.days) || 0));
    }
  }

  const leaves = rawLeaves.map((l) => {
    const typeAr = l.leave_type_ar || (l.leave_type === 'annual' ? 'سنوية' : l.leave_type === 'sick' ? 'مرضية' : l.leave_type === 'unpaid' ? 'بدون راتب' : l.leave_type === 'maternity' ? 'أمومة' : 'عارضة');
    const quota = Number(l.annual_leave_quota || defaultLeaveQuota);
    const usedAnnual = usedAnnualByEmp.get(l.employee_id) || 0;
    const remainingAnnual = Math.max(0, quota - usedAnnual);
    const unpaidDeduction = l.unpaid_deduction > 0
      ? Number(l.unpaid_deduction)
      : (typeAr === 'بدون راتب' ? Math.round(((Number(l.salary_base) || 0) / dayDivisor) * (Number(l.days) || 0) * 100) / 100 : 0);
    return {
      id: l.id,
      employeeId: l.employee_id,
      employeeNo: l.employeeNo,
      employeeName: l.employeeName,
      position: l.position || 'اداري',
      leaveType: l.leave_type,
      leaveTypeAr: typeAr,
      days: Number(l.days) || 0,
      annualQuota: quota,
      remainingAnnual,
      unpaidDeduction,
      startDate: l.start_date,
      endDate: l.end_date,
      status: l.status,
      reason: l.reason || '',
    };
  });

  // 3) الموظفون مع الرصيد المتبقي للإجازات
  const employees = rawEmps.map((e) => {
    const quota = Number(e.annual_leave_quota || defaultLeaveQuota);
    const used = usedAnnualByEmp.get(e.id) || 0;
    return {
      id: e.id,
      employeeNo: e.employeeNo,
      name: e.name,
      personalId: e.personalId,
      department: e.department_name || e.unitName || 'الموارد البشرية',
      unitId: e.unit_id,
      position: e.position || 'اداري',
      phone: e.phone || '',
      email: e.email || '',
      hireDate: e.hireDate,
      status: e.status,
      statusAr: e.emp_status_label || (e.status === 'active' ? 'نشط' : e.status === 'on_leave' ? 'في إجازة' : 'انتهاء عقد'),
      contractTypeAr: e.contract_type_label || 'عقد مفتوح',
      baseSalary: Number(e.salary_base) || 0,
      housingAllowance: Number(e.housing_allowance) || 0,
      transportAllowance: Number(e.transport_allowance) || 0,
      insuranceAmount: Number(e.insurance_amount) || 0,
      taxAmount: Number(e.tax_amount) || 0,
      annualLeaveQuota: quota,
      usedAnnualLeave: used,
      remainingAnnualLeave: Math.max(0, quota - used),
    };
  });

  // 4) الحضور والانصراف الشهري
  const rawAtt = db.prepare(`
    SELECT a.*, e.name AS employeeName, e.employeeNo, e.position, e.department_name, u.name AS unitName
    FROM hr_monthly_attendance a
    JOIN hr_employees e ON e.id = a.employee_id
    LEFT JOIN org_units u ON u.id = e.unit_id
    ORDER BY (CASE WHEN e.employeeNo ~ '^[0-9]{1,15}$' THEN e.employeeNo::bigint ELSE 0 END) ASC, e.employeeNo ASC, a.id ASC
  `).all();

  const attendance = rawAtt.map((a) => {
    const calc = calcAttendanceCommitment(a.actual_days, a.late_days, a.work_days_month || workDaysMonth, excellentPct, goodPct);
    return {
      id: a.id,
      employeeId: a.employee_id,
      employeeNo: a.employeeNo,
      employeeName: a.employeeName,
      department: a.department_name || a.unitName || 'الموارد البشرية',
      position: a.position || 'اداري',
      month: a.month,
      actualDays: calc.actualDays,
      lateDays: calc.lateDays,
      lateHours: Number(a.late_hours) || 0,
      fullDays: calc.fullDays,
      workDaysMonth: calc.workDaysMonth,
      commitmentRate: calc.commitmentRate,
      evaluationNote: calc.evaluationNote,
    };
  });

  // 5) الغياب والخصومات
  const rawAbs = db.prepare(`
    SELECT ab.*, e.name AS employeeName, e.employeeNo, e.department_name, e.salary_base, u.name AS unitName
    FROM hr_absences ab
    JOIN hr_employees e ON e.id = ab.employee_id
    LEFT JOIN org_units u ON u.id = e.unit_id
    ORDER BY (CASE WHEN e.employeeNo ~ '^[0-9]{1,15}$' THEN e.employeeNo::bigint ELSE 0 END) ASC, e.employeeNo ASC, ab.id ASC
  `).all();

  const absences = rawAbs.map((ab) => {
    const calc = calcAbsenceDeduction(ab.salary_base, ab.absence_days, ab.reason, dayDivisor, Number(settings.absence_review_threshold_days ?? 3));
    return {
      id: ab.id,
      employeeId: ab.employee_id,
      employeeNo: ab.employeeNo,
      employeeName: ab.employeeName,
      department: ab.department_name || ab.unitName || 'الموارد البشرية',
      reason: ab.reason,
      absenceDays: calc.absenceDays,
      dailyRate: ab.daily_rate > 0 ? Number(ab.daily_rate) : calc.dailyRate,
      totalDeduction: Number(ab.total_deduction) || 0,
      month: ab.month || 'يونيو',
      statusNote: calc.statusNote,
    };
  });

  // 6) إدارة السلف
  const rawAdv = db.prepare(`
    SELECT ad.*, e.name AS employeeName, e.employeeNo, e.department_name
    FROM hr_advances ad
    JOIN hr_employees e ON e.id = ad.employee_id
    ORDER BY ad.advance_code ASC, ad.id ASC
  `).all();

  const advances = rawAdv.map((ad) => ({
    id: ad.id,
    advanceCode: ad.advance_code,
    employeeId: ad.employee_id,
    employeeNo: ad.employeeNo,
    employeeName: ad.employeeName,
    department: ad.department_name || 'الموارد البشرية',
    advanceDate: ad.advance_date,
    amount: Number(ad.amount) || 0,
    installmentsCount: Number(ad.installments_count) || 1,
    paidInstallments: Number(ad.paid_installments) || 0,
    monthlyInstallment: Number(ad.monthly_installment) || 0,
    remainingAmount: Number(ad.remaining_amount) || 0,
    status: ad.status,
    notes: ad.notes || '',
  }));

  // 7) عقود الموظفين والتجديد
  const rawContracts = db.prepare(`
    SELECT c.*, e.name AS employeeName, e.employeeNo, e.position, e.department_name
    FROM hr_contracts c
    JOIN hr_employees e ON e.id = c.employee_id
    ORDER BY (CASE WHEN e.employeeNo ~ '^[0-9]{1,15}$' THEN e.employeeNo::bigint ELSE 0 END) ASC, e.employeeNo ASC, c.id ASC
  `).all();

  const contracts = rawContracts.map((c) => {
    const m = calcContractMetrics(c.start_date, c.end_date, refDateStr, warningDays, criticalDays);
    return {
      id: c.id,
      employeeId: c.employee_id,
      employeeNo: c.employeeNo,
      employeeName: c.employeeName,
      position: c.position || 'اداري',
      department: c.department_name || 'الموارد البشرية',
      contractType: c.contract_type,
      contractTypeAr: c.contract_type_ar || 'دوام كامل',
      startDate: c.start_date,
      endDate: c.end_date,
      salary: Number(c.salary) || 0,
      durationDays: m.durationDays,
      remainingDays: m.remainingDays,
      renewalAlert: m.renewalAlert,
      contractStatus: m.contractStatus,
      severity: m.severity,
    };
  });

  // 8) جدول الرواتب والحسابات الشامل (يربط الموظفين + البدلات + الغياب + الإجازات بدون راتب + السلف + التأمينات والضرائب)
  const payroll = rawEmps.map((emp) => {
    const empAbs = rawAbs.filter((a) => a.employee_id === emp.id);
    const empLvs = leaves.filter((l) => l.employeeId === emp.id).map((l) => ({ status: l.status, unpaid_deduction: l.unpaidDeduction }));
    const empAdvs = rawAdv.filter((ad) => ad.employee_id === emp.id);
    return calcEmployeePayroll(emp, empAbs, empLvs, empAdvs);
  });

  // 9) القوائم المرجعية (برمجة السيستم)
  const rawLookups = db.prepare('SELECT * FROM hr_system_lookups WHERE active = 1 ORDER BY category, sort_order, id').all();
  const lookups = {
    departments: [],
    positions: [],
    emp_statuses: [],
    contract_types: [],
    leave_types: [],
    absence_reasons: [],
    advance_statuses: [],
    contract_statuses: [],
  };
  for (const lk of rawLookups) {
    if (!lookups[lk.category]) lookups[lk.category] = [];
    lookups[lk.category].push({ id: lk.id, label: lk.label, sortOrder: lk.sort_order });
  }

  lookups.departments = universityDepartments(db).map((label, i) => ({ label, sortOrder: i + 1 }));

  // 10) تحديد صلاحيات العرض حسب القسم (الأدمن يمتلك كافة الإحصائيات، والموظف يرى إحصائيات قسمه فقط)
  const deptNames = [...lookups.departments.map((d) => d.label)];
  for (const e of employees) {
    if (!deptNames.includes(e.department)) deptNames.push(e.department);
  }

  const user = options.user || null;
  const isAdmin = !user || user.role === 'admin';

  // تحديد القسم الذي ينتمي إليه المستخدم غير الأدمن
  let assignedDepartment = 'كافة الأقسام والوحدات';
  if (!isAdmin) {
    if (options.myDept && deptNames.includes(options.myDept)) {
      assignedDepartment = options.myDept;
    } else {
      const matchedEmp = employees.find(
        (e) =>
          (user.email && e.email && e.email.toLowerCase() === String(user.email).toLowerCase()) ||
          (user.display_name && e.name && user.display_name.includes(e.name))
      );
      if (matchedEmp) {
        assignedDepartment = matchedEmp.department;
      } else {
        // حساب بلا ملف موظف: قسمه هو وحدته في الهيكل التنظيمي
        const unit = user.unit_id ? db.prepare('SELECT name FROM org_units WHERE id = ?').get(user.unit_id) : null;
        assignedDepartment = unit?.name || deptNames[0] || 'الموارد البشرية';
      }
    }
  }

  // للأدمن: يمكنه استعراض كافة الأقسام ('all') أو تصفية أي قسم محدد
  // لغير الأدمن: يتم حصر الإحصائيات تلقائياً في القسم الذي ينتمي إليه فقط
  const requestedDept = clean(options.dept || 'all', 80);
  const effectiveDept = isAdmin
    ? (requestedDept && requestedDept !== 'all' && deptNames.includes(requestedDept) ? requestedDept : 'all')
    : assignedDepartment;

  // حساب التفصيل الشامل لكل قسم (قبل التصفية لعرضه للأدمن، أو مخصص لقسم الموظف)
  const buildDeptStats = (dept) => {
    const deptEmps = employees.filter((e) => e.department === dept);
    const deptActive = deptEmps.filter((e) => e.status === 'active').length;
    const deptProbation = deptEmps.filter((e) => e.statusAr === 'تحت الاختبار').length;
    const deptPayroll = payroll.filter((p) => p.department === dept);
    const deptAtt = attendance.filter((a) => a.department === dept);
    const deptAbs = absences.filter((ab) => ab.department === dept);
    const deptEmpIds = new Set(deptEmps.map((e) => e.id));
    const deptLeaves = leaves.filter((l) => deptEmpIds.has(l.employeeId));
    const deptAdvs = advances.filter((ad) => ad.department === dept || deptEmpIds.has(ad.employeeId));
    const deptCts = contracts.filter((c) => c.department === dept || deptEmpIds.has(c.employeeId));

    const baseSal = Math.round(deptPayroll.reduce((s, p) => s + p.baseSalary, 0));
    const grossSal = Math.round(deptPayroll.reduce((s, p) => s + p.grossEarnings, 0));
    const netSal = Math.round(deptPayroll.reduce((s, p) => s + p.netSalary, 0));
    const allowances = Math.round(deptPayroll.reduce((s, p) => s + p.housingAllowance + p.transportAllowance, 0));
    const deductions = Math.round(deptPayroll.reduce((s, p) => s + p.totalDeductions, 0));
    const avgComm = deptAtt.length ? Math.round(deptAtt.reduce((s, a) => s + a.commitmentRate, 0) / deptAtt.length) : 100;
    const absDays = deptAbs.reduce((s, a) => s + a.absenceDays, 0);
    const absDed = Math.round(deptAbs.reduce((s, a) => s + a.totalDeduction, 0));
    const lvDays = deptLeaves.reduce((s, l) => s + l.days, 0);
    const advTotal = Math.round(deptAdvs.reduce((s, a) => s + a.amount, 0));
    const advRem = Math.round(deptAdvs.reduce((s, a) => s + a.remainingAmount, 0));
    const ctValid = deptCts.filter((c) => c.renewalAlert === 'ساري').length;
    const ctExpiring = deptCts.filter((c) => c.renewalAlert === 'يحتاج تجديد').length;
    const ctExpired = deptCts.filter((c) => c.remainingDays < 0).length;

    return {
      department: dept,
      count: deptEmps.length,
      activeCount: deptActive,
      probationCount: deptProbation,
      baseSalaries: baseSal,
      totalAllowances: allowances,
      totalDeductions: deductions,
      totalSalaries: grossSal,
      netSalaries: netSal,
      avgCommitment: avgComm,
      absenceDays: absDays,
      absenceDeduction: absDed,
      leaveDays: lvDays,
      advancesTotal: advTotal,
      advancesRemaining: advRem,
      contractsValid: ctValid,
      contractsExpiring: ctExpiring,
      contractsExpired: ctExpired,
    };
  };

  const allDepartmentsBreakdown = deptNames.map(buildDeptStats);
  const visibleDepartments = effectiveDept === 'all'
    ? allDepartmentsBreakdown
    : allDepartmentsBreakdown.filter((d) => d.department === effectiveDept);

  // تصفية السجلات وفق نطاق القسم الفعال
  const scopedEmployees = effectiveDept === 'all' ? employees : employees.filter((e) => e.department === effectiveDept);
  const scopedEmpIds = new Set(scopedEmployees.map((e) => e.id));
  const scopedAttendance = effectiveDept === 'all' ? attendance : attendance.filter((a) => a.department === effectiveDept || scopedEmpIds.has(a.employeeId));
  const scopedAbsences = effectiveDept === 'all' ? absences : absences.filter((ab) => ab.department === effectiveDept || scopedEmpIds.has(ab.employeeId));
  const scopedLeaves = effectiveDept === 'all' ? leaves : leaves.filter((l) => scopedEmpIds.has(l.employeeId));
  const scopedPayroll = effectiveDept === 'all' ? payroll : payroll.filter((p) => p.department === effectiveDept || scopedEmpIds.has(p.employeeId));
  const scopedAdvances = effectiveDept === 'all' ? advances : advances.filter((ad) => ad.department === effectiveDept || scopedEmpIds.has(ad.employeeId));
  const scopedContracts = effectiveDept === 'all' ? contracts : contracts.filter((c) => c.department === effectiveDept || scopedEmpIds.has(c.employeeId));

  // مؤشرات الأداء المحسوبة حسب نطاق الصلاحية/القسم
  const totalEmployees = scopedEmployees.length;
  const activeEmployees = scopedEmployees.filter((e) => e.status === 'active').length;
  const avgCommitment = scopedAttendance.length
    ? Math.round(scopedAttendance.reduce((s, a) => s + a.commitmentRate, 0) / scopedAttendance.length)
    : 100;
  const totalGrossPayroll = Math.round(scopedPayroll.reduce((s, p) => s + p.grossEarnings, 0) * 100) / 100;
  const totalNetPayroll = Math.round(scopedPayroll.reduce((s, p) => s + p.netSalary, 0) * 100) / 100;
  const totalBasePayroll = Math.round(scopedPayroll.reduce((s, p) => s + p.baseSalary, 0) * 100) / 100;
  const totalAllowancesPayroll = Math.round(scopedPayroll.reduce((s, p) => s + p.housingAllowance + p.transportAllowance, 0) * 100) / 100;
  const totalDeductionsPayroll = Math.round(scopedPayroll.reduce((s, p) => s + p.totalDeductions, 0) * 100) / 100;
  const totalAdvances = Math.round(scopedAdvances.reduce((s, a) => s + a.amount, 0) * 100) / 100;
  const totalRemainingAdvances = Math.round(scopedAdvances.reduce((s, a) => s + a.remainingAmount, 0) * 100) / 100;
  const totalAbsenceDays = scopedAbsences.reduce((s, a) => s + a.absenceDays, 0);
  const totalLeaveDays = scopedLeaves.reduce((s, l) => s + l.days, 0);
  const expiredContractsCount = scopedContracts.filter((c) => c.remainingDays < 0).length;
  const expiringSoonContractsCount = scopedContracts.filter((c) => c.renewalAlert === 'يحتاج تجديد').length;
  const validContractsCount = scopedContracts.filter((c) => c.renewalAlert === 'ساري').length;
  const avgSalary = totalEmployees ? Math.round(totalBasePayroll / totalEmployees) : 0;

  // توزيع الإجازات حسب النوع (مخطط دائري)
  const leaveByTypeMap = new Map([
    ['سنوية', 0],
    ['مرضية', 0],
    ['عارضة', 0],
    ['بدون راتب', 0],
    ['أمومة', 0],
    ['حج وعمرة', 0],
  ]);
  for (const l of scopedLeaves) {
    const key = l.leaveTypeAr === 'اعتيادي' ? 'سنوية' : l.leaveTypeAr;
    leaveByTypeMap.set(key, (leaveByTypeMap.get(key) || 0) + l.days);
  }
  const leaveDistribution = [...leaveByTypeMap.entries()].map(([type, days]) => ({
    type,
    days,
    percentage: totalLeaveDays ? Math.round((days / totalLeaveDays) * 100) : 0,
  }));

  // إحصائيات كافة الأقسام والوحدات في المنظومة الجامعية (Enterprise Cross-Department Statistics)
  const safeVal = (sql) => {
    try {
      const r = db.prepare(sql).get();
      return r ? Number(Object.values(r)[0] ?? 0) : 0;
    } catch {
      return 0;
    }
  };

  const allEnterpriseStats = [
    {
      id: 'hr_dept',
      department: 'الموارد البشرية',
      title: 'شؤون الموظفين والرواتب والعقود',
      icon: '👥',
      color: '#054239',
      metrics: [
        { label: 'إجمالي الموظفين', value: employees.length, unit: 'موظف' },
        { label: 'مسير الاستحقاقات الشهري', value: Math.round(payroll.reduce((s, p) => s + p.grossEarnings, 0)), unit: 'ل.س' },
        { label: 'العقود السارية / المنتهية', value: `${contracts.filter((c) => c.renewalAlert === 'ساري').length} / ${contracts.filter((c) => c.remainingDays < 0).length}`, unit: 'عقد' },
        { label: 'أيام الإجازات والغياب', value: `${leaves.reduce((s, l) => s + l.days, 0)} / ${absences.reduce((s, a) => s + a.absenceDays, 0)}`, unit: 'يوم' },
      ],
    },
    {
      id: 'fin_dept',
      department: 'المالية والحسابات',
      title: 'الشؤون المالية والمحاسبة العامة',
      icon: '💰',
      color: '#1e4e68',
      metrics: [
        { label: 'الحسابات المحاسبية النشطة', value: safeVal('SELECT COUNT(*) FROM fin_accounts WHERE active = 1'), unit: 'حساب' },
        { label: 'قيود اليومية المسجلة', value: safeVal('SELECT COUNT(*) FROM fin_entries'), unit: 'قيد' },
        { label: 'المطالبات والرسوم الطلابية', value: safeVal('SELECT COUNT(*) FROM fin_charges'), unit: 'مطالبة' },
        { label: 'السلف المالية النشطة', value: advances.length, unit: 'سلفة' },
      ],
    },
    {
      id: 'it_devops',
      department: 'تقنية المعلومات والأمن السيبراني',
      title: 'تقنية المعلومات والبنية التحتية',
      icon: '🖥️',
      color: '#7c3aed',
      metrics: [
        { label: 'بلاغات الأخطاء', value: safeVal('SELECT COUNT(*) FROM devops_incident_reports'), unit: 'بلاغ' },
        { label: 'البلاغات المعالجة', value: safeVal("SELECT COUNT(*) FROM devops_incident_reports WHERE status = 'resolved'"), unit: 'معالج' },
        { label: 'سجلات التدقيق الأمني', value: safeVal('SELECT COUNT(*) FROM audit_log'), unit: 'سجل' },
        { label: 'أجهزة البصمة', value: safeVal('SELECT COUNT(*) FROM hr_biometric_devices'), unit: 'جهاز' },
      ],
    },
    {
      id: 'admin_corr',
      department: 'الشؤون الإدارية',
      title: 'الشؤون الإدارية والديوان والمراسلات',
      icon: '🏛️',
      color: '#b45309',
      metrics: [
        { label: 'الكتب والمراسلات الرسمية', value: safeVal('SELECT COUNT(*) FROM corr_docs'), unit: 'كتاب' },
        { label: 'الطلبات الداخلية للموظفين', value: safeVal("SELECT COUNT(*) FROM requests r JOIN users u ON u.id = r.student_id WHERE u.role <> 'student'"), unit: 'طلب' },
        { label: 'تقييمات الأداء السنوية', value: safeVal('SELECT COUNT(*) FROM hr_appraisals'), unit: 'تقييم' },
        { label: 'الأخبار والتعاميم', value: safeVal('SELECT COUNT(*) FROM news'), unit: 'تعميم' },
      ],
    },
    {
      id: 'student_affairs',
      department: 'شؤون الطلاب',
      title: 'شؤون الطلاب والقبول',
      icon: '🎓',
      color: '#0284c7',
      metrics: [
        { label: 'الطلاب المقيدون بالجامعة', value: safeVal('SELECT COUNT(*) FROM student_profiles'), unit: 'طالب' },
        { label: 'الطلبات والمعاملات الطلابية', value: safeVal("SELECT COUNT(*) FROM requests r JOIN users u ON u.id = r.student_id WHERE u.role = 'student'"), unit: 'معاملة' },
        { label: 'الوثائق الرسمية الموقعة', value: safeVal('SELECT COUNT(*) FROM documents'), unit: 'وثيقة' },
        { label: 'المنح وتسكين السكن', value: `${safeVal('SELECT COUNT(*) FROM scholarships')} / ${safeVal('SELECT COUNT(*) FROM dorm_allocations')}`, unit: 'مستفيد' },
        { label: 'الأنشطة الطلابية', value: safeVal('SELECT COUNT(*) FROM student_activities'), unit: 'نشاط' },
      ],
    },
    {
      id: 'proc_dept',
      department: 'المشتريات والمخازن',
      title: 'المشتريات والتوريد',
      icon: '🛒',
      color: '#0d9488',
      metrics: [
        { label: 'طلبات الشراء', value: safeVal('SELECT COUNT(*) FROM proc_requests'), unit: 'طلب' },
        { label: 'أوامر الشراء والتوريد', value: safeVal('SELECT COUNT(*) FROM proc_orders'), unit: 'أمر' },
        { label: 'الموردون المعتمدون', value: safeVal('SELECT COUNT(*) FROM proc_suppliers'), unit: 'مورد' },
      ],
    },
    {
      id: 'wh_dept',
      department: 'المشتريات والمخازن',
      title: 'المخازن والمستودعات والأصول الثابتة',
      icon: '📦',
      color: '#4f46e5',
      metrics: [
        { label: 'الأصناف المخزنية المسجلة', value: safeVal('SELECT COUNT(*) FROM proc_items'), unit: 'صنف' },
        { label: 'المستودعات النشطة', value: safeVal('SELECT COUNT(*) FROM proc_warehouses WHERE active = 1'), unit: 'مستودع' },
        { label: 'حركات الاستلام / الصرف', value: `${safeVal('SELECT COUNT(*) FROM proc_receipts')} / ${safeVal('SELECT COUNT(*) FROM proc_issues')}`, unit: 'حركة' },
        { label: 'الأصول الثابتة والعهد', value: safeVal('SELECT COUNT(*) FROM proc_assets'), unit: 'أصل' },
      ],
    },
    {
      id: 'academic',
      department: 'الشؤون الأكاديمية',
      title: 'الشؤون الأكاديمية',
      icon: '📚',
      color: '#16a34a',
      metrics: [
        { label: 'الكليات / البرامج', value: `${safeVal('SELECT COUNT(*) FROM faculties WHERE active = 1')} / ${safeVal('SELECT COUNT(*) FROM programs WHERE active = 1')}`, unit: 'جهة/برنامج' },
        { label: 'المقررات الفعالة', value: safeVal('SELECT COUNT(*) FROM courses WHERE active = 1'), unit: 'مقرر' },
        { label: 'أعضاء الهيئة التدريسية', value: safeVal('SELECT COUNT(*) FROM faculty_members'), unit: 'عضو' },
      ],
    },
    {
      id: 'quality',
      department: 'الجودة والتخطيط',
      title: 'الجودة والاعتماد',
      icon: '⚙️',
      color: '#ca8a04',
      metrics: [
        { label: 'مؤشرات الجودة (KPIs)', value: safeVal('SELECT COUNT(*) FROM qa_kpis'), unit: 'مؤشر' },
        { label: 'استبيانات التقييم', value: safeVal('SELECT COUNT(*) FROM qa_surveys'), unit: 'استبيان' },
        { label: 'ملفات الاعتماد', value: safeVal('SELECT COUNT(*) FROM qa_accreditations'), unit: 'ملف' },
      ],
    },
    {
      id: 'alumni',
      department: 'الخريجون والتوظيف',
      title: 'الخريجون والتوظيف',
      icon: '🌐',
      color: '#db2777',
      metrics: [
        { label: 'الخريجون الموثقون', value: safeVal('SELECT COUNT(*) FROM alumni_records'), unit: 'خريج' },
        { label: 'فرص التوظيف والتدريب', value: safeVal('SELECT COUNT(*) FROM career_jobs'), unit: 'فرصة' },
        { label: 'طلبات التوظيف', value: safeVal('SELECT COUNT(*) FROM career_applications'), unit: 'طلب' },
      ],
    },
    {
      id: 'research',
      department: 'البحث العلمي والدراسات العليا',
      title: 'البحث العلمي والدراسات العليا',
      icon: '🔬',
      color: '#0891b2',
      metrics: [
        { label: 'المشاريع البحثية', value: safeVal('SELECT COUNT(*) FROM research_projects'), unit: 'بحث' },
        { label: 'رسائل الدراسات العليا', value: safeVal('SELECT COUNT(*) FROM postgrad_theses'), unit: 'رسالة' },
      ],
    },
  ];

  const scopedEnterpriseModules = effectiveDept === 'all'
    ? allEnterpriseStats
    : allEnterpriseStats.filter((m) => m.department === effectiveDept);

  // 11) التنبيهات الذكية النشطة (مفلترة حسب القسم للموظف أو شاملة للأدمن)
  const alerts = buildHrAlerts({
    employees: scopedEmployees,
    contracts: scopedContracts,
    attendance: scopedAttendance,
    absences: scopedAbsences,
    advances: scopedAdvances,
    leaves: scopedLeaves,
    settings,
  });

  return {
    userRole: user?.role || 'admin',
    myDepartment: assignedDepartment,
    isScopedToDepartment: !isAdmin,
    activeDepartmentFilter: effectiveDept,
    allDepartmentNames: deptNames,
    enterpriseModules: scopedEnterpriseModules,
    allEnterpriseStats,
    accessScope: {
      isAdmin,
      canViewAllDepartments: isAdmin,
      role: user?.role || 'admin',
      userName: user?.display_name || user?.label || 'مدير النظام',
      assignedDepartment,
      activeDepartmentFilter: effectiveDept,
      availableDepartments: isAdmin ? ['all', ...deptNames] : [assignedDepartment],
      allDepartmentNames: deptNames,
    },
    kpis: {
      totalEmployees,
      activeEmployees,
      avgCommitment,
      totalGrossPayroll,
      totalNetPayroll,
      totalBasePayroll,
      totalAllowancesPayroll,
      totalDeductionsPayroll,
      totalAdvances,
      totalRemainingAdvances,
      totalAbsenceDays,
      totalLeaveDays,
      expiredContractsCount,
      expiringSoonContractsCount,
      validContractsCount,
      avgSalary,
      alertsCount: alerts.length,
    },
    employees: scopedEmployees,
    attendance: scopedAttendance,
    absences: scopedAbsences,
    leaves: scopedLeaves,
    payroll: scopedPayroll,
    advances: scopedAdvances,
    contracts: scopedContracts,
    analytics: {
      leaveDistribution,
      departmentBreakdown: visibleDepartments,
      allDepartmentsBreakdown: isAdmin ? allDepartmentsBreakdown : visibleDepartments,
      enterpriseModules: scopedEnterpriseModules,
      allEnterpriseModules: isAdmin ? allEnterpriseStats : scopedEnterpriseModules,
      contractBreakdown: [
        { label: 'ساري', count: validContractsCount, color: '#0E6655' },
        { label: 'ينتهي قريباً (يحتاج تجديد)', count: expiringSoonContractsCount, color: '#D5B65D' },
        { label: 'منتهي', count: expiredContractsCount, color: '#B3261E' },
      ],
      commitmentBreakdown: [
        { label: 'ممتاز (≥ ' + excellentPct + '%)', count: scopedAttendance.filter((a) => a.evaluationNote === 'ممتاز').length, color: '#0E6655' },
        { label: 'جيد (' + goodPct + '%–' + (excellentPct - 1) + '%)', count: scopedAttendance.filter((a) => a.evaluationNote === 'جيد').length, color: '#356C8A' },
        { label: 'يحتاج متابعة (< ' + goodPct + '%)', count: scopedAttendance.filter((a) => a.evaluationNote === 'يحتاج متابعة').length, color: '#B3261E' },
      ],
    },
    alerts,
    lookups,
    settings: settingRows,
    settingsMap: settings,
    units: db.prepare("SELECT id, name FROM org_units WHERE active = 1 AND kind != 'university' ORDER BY name").all(),
  };
}

export function registerHrIntegratedRoutes(r, { db, cfg }) {
  // نظرة شاملة لمنظومة شؤون الموظفين المتكاملة والإحصائيات الشاملة حسب صلاحية القسم / الأدمن
  r.add('GET', '/api/hr-pro/overview', (c) => {
    if (!c.user) throw new HttpError(401, 'يرجى تسجيل الدخول.', 'unauthenticated');
    // staffatt:self لا يكفي: الاستجابة تحوي رواتب وعقود قسم كامل
    if (c.user.role !== 'admin' && !['hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr_emp:delete', 'hr:manage', 'hr_payroll:approve', 'staffatt:manage'].some((p) => c.user.can(p))) {
      throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    }
    const refDate = c.query?.refDate || DEFAULT_REF_DATE;
    const dept = c.query?.dept || 'all';
    // تجاوز القسم عبر الرابط يبقى لمن يدير الموارد البشرية، وإلا لانكسر عزل الأقسام
    const myDept = c.user.can('hr:manage') ? (c.query?.myDept || '') : '';
    c.json(200, buildHrProOverview(db, refDate, { user: c.user, dept, myDept }));
  });

  // 1) إضافة موظف جديد متكامل (يتزامن مع hr_employees و hr_salaries و hr_monthly_attendance)
  r.add('POST', '/api/hr-pro/employees', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const b = c.body ?? {};
    const name = clean(b.name, 100);
    const employeeNo = clean(b.employeeNo || String(Date.now()).slice(-4), 30);
    if (!name) throw new HttpError(400, 'اسم الموظف مطلوب.');
    const existing = db.prepare('SELECT id FROM hr_employees WHERE employeeNo = ?').get(employeeNo);
    if (existing) throw new HttpError(400, 'كود الموظف مسجّل مسبقاً.');

    const { map: settings } = getHrAlertSettingsMap(db);
    const baseSalary = Number(b.baseSalary ?? b.salary ?? 5000) || 0;
    const housingAllowance = b.housingAllowance !== undefined && b.housingAllowance !== ''
      ? Number(b.housingAllowance)
      : Math.round(baseSalary * (Number(settings.default_housing_pct ?? 18) / 100));
    const transportAllowance = b.transportAllowance !== undefined && b.transportAllowance !== ''
      ? Number(b.transportAllowance)
      : Number(settings.default_transport_amount ?? 575);
    const insuranceAmount = b.insuranceAmount !== undefined && b.insuranceAmount !== ''
      ? Number(b.insuranceAmount)
      : Math.round(baseSalary * (Number(settings.default_insurance_pct ?? 11) / 100));
    const taxAmount = b.taxAmount !== undefined && b.taxAmount !== ''
      ? Number(b.taxAmount)
      : Math.round(baseSalary * (Number(settings.default_tax_pct ?? 8) / 100));

    const uRow = db.prepare("SELECT id FROM org_units WHERE kind != 'university' ORDER BY id LIMIT 1").get() || { id: 1 };
    const unitId = Number(b.unitId) || uRow.id;
    const statusAr = clean(b.statusAr || 'نشط', 40);
    const statusDb = statusAr === 'في إجازة' ? 'on_leave' : (statusAr === 'استقالة' || statusAr === 'انتهاء عقد') ? 'terminated' : 'active';
    const hireDate = clean(b.hireDate || new Date().toISOString().slice(0, 10), 20);
    const personalId = clean(b.personalId || `PID-${employeeNo}-${Date.now().toString().slice(-4)}`, 40);
    const now = Date.now();

    const res = db.prepare(`
      INSERT INTO hr_employees (
        employeeNo, name, personalId, email, phone, hireDate, status, unit_id, position,
        salary_base, joinDate, housing_allowance, transport_allowance, contract_type_label,
        emp_status_label, annual_leave_quota, insurance_amount, tax_amount, department_name,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      employeeNo,
      name,
      personalId,
      clean(b.email || `${employeeNo}@suss.edu.sy`, 100),
      clean(b.phone || '0944000000', 30),
      hireDate,
      statusDb,
      unitId,
      clean(b.position || 'اداري', 80),
      baseSalary,
      hireDate,
      housingAllowance,
      transportAllowance,
      clean(b.contractTypeAr || 'عقد مفتوح', 50),
      statusAr,
      Number(b.annualLeaveQuota || settings.default_annual_leave_days || 21),
      insuranceAmount,
      taxAmount,
      clean(b.department || 'الموارد البشرية', 80),
      now,
      now
    );

    const empId = Number(res.lastInsertRowid);
    if (baseSalary > 0) {
      db.prepare('INSERT INTO hr_salaries (employee_id, amount, effective_at, created_by, created_at, ip) VALUES (?,?,?,?,?,?)')
        .run(empId, baseSalary, now, c.user.id, now, c.ip);
    }
    // إنشاء سجل حضور شهري افتراضي للموظف الجديد
    db.prepare(`
      INSERT OR IGNORE INTO hr_monthly_attendance (employee_id, month, work_days_month, actual_days, late_days, late_hours, full_days, commitment_rate, evaluation_note, updated_at)
      VALUES (?, '2026-10', 26, 26, 0, 0, 26, 100, 'ممتاز', ?)
    `).run(empId, now);

    // إنشاء عقد افتراضي إذا أُرسل تاريخ نهاية العقد
    if (b.contractEndDate) {
      const m = calcContractMetrics(hireDate, b.contractEndDate, DEFAULT_REF_DATE, 60, 15);
      db.prepare(`
        INSERT INTO hr_contracts (employee_id, contract_type, contract_type_ar, title, start_date, end_date, salary, status_ar, notes, created_by, created_at, ip)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(empId, 'fixed', clean(b.contractTypeAr || 'دوام كامل', 50), `عقد ${b.contractTypeAr || 'عمل'}`, hireDate, b.contractEndDate, baseSalary, m.contractStatus, m.renewalAlert, c.user.id, now, c.ip);
    }

    audit(db, c.user, 'إضافة موظف في منظومة شؤون الموظفين', employeeNo, c.ip);
    c.json(201, { id: empId, employeeNo });
  });

  // تعديل بيانات موظف
  r.add('PUT', '/api/hr-pro/employees/:id', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const id = Number(c.params.id);
    const emp = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(id);
    if (!emp) throw new HttpError(404, 'الموظف غير موجود.');
    const b = c.body ?? {};
    const statusAr = clean(b.statusAr || emp.emp_status_label || 'نشط', 40);
    const statusDb = statusAr === 'في إجازة' ? 'on_leave' : (statusAr === 'استقالة' || statusAr === 'انتهاء عقد') ? 'terminated' : 'active';
    const baseSalary = b.baseSalary !== undefined ? Number(b.baseSalary) : emp.salary_base;

    db.prepare(`
      UPDATE hr_employees
      SET name = ?, department_name = ?, position = ?, phone = ?, email = ?, hireDate = ?,
          status = ?, emp_status_label = ?, contract_type_label = ?, salary_base = ?,
          housing_allowance = ?, transport_allowance = ?, insurance_amount = ?, tax_amount = ?,
          annual_leave_quota = ?, updated_at = ?
      WHERE id = ?
    `).run(
      clean(b.name ?? emp.name, 100),
      clean(b.department ?? emp.department_name, 80),
      clean(b.position ?? emp.position, 80),
      clean(b.phone ?? emp.phone, 30),
      clean(b.email ?? emp.email, 100),
      clean(b.hireDate ?? emp.hireDate, 20),
      statusDb,
      statusAr,
      clean(b.contractTypeAr ?? emp.contract_type_label, 50),
      baseSalary,
      b.housingAllowance !== undefined ? Number(b.housingAllowance) : emp.housing_allowance,
      b.transportAllowance !== undefined ? Number(b.transportAllowance) : emp.transport_allowance,
      b.insuranceAmount !== undefined ? Number(b.insuranceAmount) : emp.insurance_amount,
      b.taxAmount !== undefined ? Number(b.taxAmount) : emp.tax_amount,
      b.annualLeaveQuota !== undefined ? Number(b.annualLeaveQuota) : emp.annual_leave_quota,
      Date.now(),
      id
    );
    audit(db, c.user, 'تحديث بيانات موظف (شؤون الموظفين)', emp.employeeNo, c.ip);
    c.json(200, { ok: true });
  });

  // 2) تحديث سجل الحضور والانصراف الشهري ونسبة الالتزام
  r.add('POST', '/api/hr-pro/attendance', (c) => {
    if (!c.user.can('hr:manage') && !c.user.can('staffatt:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const b = c.body ?? {};
    const employeeId = Number(b.employeeId);
    const emp = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(employeeId);
    if (!emp) throw new HttpError(404, 'الموظف غير موجود.');
    const { map: settings } = getHrAlertSettingsMap(db);
    const workDaysMonth = Number(b.workDaysMonth || settings.standard_month_work_days || 26);
    const calc = calcAttendanceCommitment(
      b.actualDays,
      b.lateDays,
      workDaysMonth,
      Number(settings.attendance_excellent_pct ?? 95),
      Number(settings.attendance_good_pct ?? 85)
    );
    const month = clean(b.month || '2026-10', 20);
    const lateHours = Number(b.lateHours) || 0;

    db.prepare(`
      INSERT INTO hr_monthly_attendance (employee_id, month, work_days_month, actual_days, late_days, late_hours, full_days, commitment_rate, evaluation_note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, month) DO UPDATE SET
        work_days_month = excluded.work_days_month,
        actual_days = excluded.actual_days,
        late_days = excluded.late_days,
        late_hours = excluded.late_hours,
        full_days = excluded.full_days,
        commitment_rate = excluded.commitment_rate,
        evaluation_note = excluded.evaluation_note,
        updated_at = excluded.updated_at
    `).run(employeeId, month, calc.workDaysMonth, calc.actualDays, calc.lateDays, lateHours, calc.fullDays, calc.commitmentRate, calc.evaluationNote, Date.now());

    audit(db, c.user, 'تحديث سجل الحضور والالتزام الشهري', `${emp.employeeNo} (${calc.commitmentRate}%)`, c.ip);
    c.json(200, { ok: true, ...calc });
  });

  // 3) تسجيل غياب واحتساب خصم الغياب آلياً
  r.add('POST', '/api/hr-pro/absences', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const b = c.body ?? {};
    const employeeId = Number(b.employeeId);
    const emp = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(employeeId);
    if (!emp) throw new HttpError(404, 'الموظف غير موجود.');
    const { map: settings } = getHrAlertSettingsMap(db);
    const reason = clean(b.reason || 'تأخير متكرر', 80);
    const calc = calcAbsenceDeduction(
      emp.salary_base,
      b.absenceDays,
      reason,
      Number(settings.salary_day_divisor ?? 30),
      Number(settings.absence_review_threshold_days ?? 3)
    );
    const month = clean(b.month || 'أكتوبر', 30);
    const res = db.prepare(`
      INSERT INTO hr_absences (employee_id, reason, absence_days, daily_rate, total_deduction, month, month_code, status_note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '2026-10', ?, ?)
    `).run(employeeId, reason, calc.absenceDays, calc.dailyRate, calc.totalDeduction, month, calc.statusNote, Date.now());

    audit(db, c.user, 'تسجيل غياب موظف', `${emp.employeeNo} (${calc.absenceDays} أيام)`, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid), ...calc });
  });

  r.add('DELETE', '/api/hr-pro/absences/:id', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    db.prepare('DELETE FROM hr_absences WHERE id = ?').run(Number(c.params.id));
    c.json(200, { ok: true });
  });

  // 4) تسجيل إجازة مع احتساب الرصيد المتبقي وخصم الإجازة بدون راتب
  r.add('POST', '/api/hr-pro/leaves', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const b = c.body ?? {};
    const employeeId = Number(b.employeeId);
    const emp = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(employeeId);
    if (!emp) throw new HttpError(404, 'الموظف غير موجود.');
    const leaveTypeAr = clean(b.leaveTypeAr || 'سنوية', 40);
    const typeMap = {
      'سنوية': 'annual',
      'اعتيادي': 'annual',
      'مرضية': 'sick',
      'بدون راتب': 'unpaid',
      'أمومة': 'maternity',
      'عارضة': 'annual',
      'منحة': 'annual',
      'حج وعمرة': 'annual',
    };
    const dbType = typeMap[leaveTypeAr] || 'annual';
    const startDate = clean(b.startDate || '2026-10-26', 20);
    const endDate = clean(b.endDate || startDate, 20);
    const days = Math.max(1, Number(b.days) || 1);
    const { map: settings } = getHrAlertSettingsMap(db);
    const m = calcLeaveMetrics(leaveTypeAr, days, emp.salary_base, emp.annual_leave_quota || 21, 0, Number(settings.salary_day_divisor ?? 30));

    const res = db.prepare(`
      INSERT INTO hr_leaves (employee_id, leave_type, leave_type_ar, status, start_date, end_date, days, unpaid_deduction, reason, notes, created_by, created_at, ip)
      VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, 'مسجلة من شؤون الموظفين', ?, ?, ?)
    `).run(employeeId, dbType, leaveTypeAr, startDate, endDate, days, m.unpaidDeduction, clean(b.reason || `إجازة ${leaveTypeAr}`, 200), c.user.id, Date.now(), c.ip);

    audit(db, c.user, 'تسجيل إجازة موظف', `${emp.employeeNo} (${leaveTypeAr} - ${days} أيام)`, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid), unpaidDeduction: m.unpaidDeduction });
  });

  // 5) إدارة السلف والأقساط الشهرية
  r.add('POST', '/api/hr-pro/advances', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const b = c.body ?? {};
    const employeeId = Number(b.employeeId);
    const emp = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(employeeId);
    if (!emp) throw new HttpError(404, 'الموظف غير موجود.');
    const countRow = db.prepare('SELECT COUNT(*) c FROM hr_advances').get().c;
    const advanceCode = clean(b.advanceCode || `a${101 + countRow + Math.floor(Math.random() * 10)}`, 20);
    const calc = calcAdvanceMetrics(b.amount, b.installmentsCount, b.paidInstallments || 0, b.status || 'مستحقة');
    const advanceDate = clean(b.advanceDate || new Date().toISOString().slice(0, 10), 20);

    const res = db.prepare(`
      INSERT INTO hr_advances (advance_code, employee_id, advance_date, amount, installments_count, paid_installments, monthly_installment, remaining_amount, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(advanceCode, employeeId, advanceDate, calc.amount, calc.installmentsCount, calc.paidInstallments, calc.monthlyInstallment, calc.remainingAmount, calc.status, clean(b.notes, 200), Date.now());

    audit(db, c.user, 'إضافة سلفة موظف', `${advanceCode} (${emp.name})`, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid), advanceCode, ...calc });
  });

  // تسديد قسط سلفة أو إغلاقها
  r.add('POST', '/api/hr-pro/advances/:id/pay', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const id = Number(c.params.id);
    const adv = db.prepare('SELECT * FROM hr_advances WHERE id = ?').get(id);
    if (!adv) throw new HttpError(404, 'السلفة غير موجودة.');
    const nextPaid = Math.min(adv.installments_count, (Number(adv.paid_installments) || 0) + 1);
    const nextStatus = nextPaid >= adv.installments_count ? 'مدفوعة' : adv.status;
    const calc = calcAdvanceMetrics(adv.amount, adv.installments_count, nextPaid, nextStatus);

    db.prepare(`
      UPDATE hr_advances
      SET paid_installments = ?, monthly_installment = ?, remaining_amount = ?, status = ?
      WHERE id = ?
    `).run(calc.paidInstallments, calc.monthlyInstallment, calc.remainingAmount, calc.status, id);

    audit(db, c.user, 'تسديد قسط سلفة', adv.advance_code, c.ip);
    c.json(200, { ok: true, ...calc });
  });

  // 6) إضافة عقد جديد أو تجديد عقد موظف
  r.add('POST', '/api/hr-pro/contracts', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const b = c.body ?? {};
    const employeeId = Number(b.employeeId);
    const emp = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(employeeId);
    if (!emp) throw new HttpError(404, 'الموظف غير موجود.');
    const contractTypeAr = clean(b.contractTypeAr || 'دوام كامل', 50);
    const startDate = clean(b.startDate || '2026-10-11', 20);
    const endDate = clean(b.endDate || '2027-10-11', 20);
    const salary = Number(b.salary || emp.salary_base || 5000);
    const { map: settings } = getHrAlertSettingsMap(db);
    const m = calcContractMetrics(startDate, endDate, DEFAULT_REF_DATE, Number(settings.contract_expiry_warning_days ?? 60), Number(settings.contract_expiry_critical_days ?? 15));

    const res = db.prepare(`
      INSERT INTO hr_contracts (employee_id, contract_type, contract_type_ar, title, start_date, end_date, salary, status_ar, notes, created_by, created_at, ip)
      VALUES (?, 'fixed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(employeeId, contractTypeAr, `عقد ${contractTypeAr}`, startDate, endDate, salary, m.contractStatus, m.renewalAlert, c.user.id, Date.now(), c.ip);

    db.prepare('UPDATE hr_employees SET contract_type_label = ?, updated_at = ? WHERE id = ?').run(contractTypeAr, Date.now(), employeeId);
    audit(db, c.user, 'إبرام عقد عمل موظف', `${emp.employeeNo} (${contractTypeAr})`, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid), ...m });
  });

  // تجديد عقد قائم
  r.add('POST', '/api/hr-pro/contracts/:id/renew', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const id = Number(c.params.id);
    const ct = db.prepare('SELECT * FROM hr_contracts WHERE id = ?').get(id);
    if (!ct) throw new HttpError(404, 'العقد غير موجود.');
    const b = c.body ?? {};
    const newStart = clean(b.startDate || '2026-10-11', 20);
    const newEnd = clean(b.endDate || '2027-10-11', 20);
    const newSalary = b.salary !== undefined ? Number(b.salary) : ct.salary;
    const contractTypeAr = clean(b.contractTypeAr || ct.contract_type_ar || 'دوام كامل', 50);
    const { map: settings } = getHrAlertSettingsMap(db);
    const m = calcContractMetrics(newStart, newEnd, DEFAULT_REF_DATE, Number(settings.contract_expiry_warning_days ?? 60), Number(settings.contract_expiry_critical_days ?? 15));

    db.prepare(`
      UPDATE hr_contracts
      SET contract_type_ar = ?, start_date = ?, end_date = ?, salary = ?, status_ar = ?, notes = ?
      WHERE id = ?
    `).run(contractTypeAr, newStart, newEnd, newSalary, m.contractStatus, m.renewalAlert, id);

    audit(db, c.user, 'تجديد عقد عمل موظف', `عقد #${id} حتى ${newEnd}`, c.ip);
    c.json(200, { ok: true, ...m });
  });

  // 7) تحديث إعدادات التنبيهات والسياسات المالية
  r.add('PUT', '/api/hr-pro/settings', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const b = c.body ?? {};
    const upd = db.prepare('UPDATE hr_alert_settings SET value = ?, updated_at = ? WHERE key = ?');
    const now = Date.now();
    for (const [k, v] of Object.entries(b)) {
      upd.run(String(v).trim(), now, k);
    }
    audit(db, c.user, 'تحديث إعدادات التنبيهات والسياسات لشؤون الموظفين', Object.keys(b).join(','), c.ip);
    c.json(200, { ok: true, settings: getHrAlertSettingsMap(db).map });
  });

  // 8) إدارة القوائم المرجعية (برمجة السيستم)
  r.add('POST', '/api/hr-pro/lookups', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    const b = c.body ?? {};
    const category = clean(b.category, 40);
    const label = clean(b.label, 80);
    if (!category || !label) throw new HttpError(400, 'الفئة والاسم مطلوبان.');
    if (category === 'departments') throw new HttpError(400, 'الأقسام تُدار من هيكل الجامعة في لوحة الإدارة ← وحدات النظام.');
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM hr_system_lookups WHERE category = ?').get(category).m;
    const res = db.prepare('INSERT OR IGNORE INTO hr_system_lookups (category, label, sort_order, active) VALUES (?, ?, ?, 1)')
      .run(category, label, maxOrder + 1);
    audit(db, c.user, 'إضافة عنصر في برمجة سيستم الموارد البشرية', `${category}: ${label}`, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid), category, label });
  });

  r.add('DELETE', '/api/hr-pro/lookups/:id', (c) => {
    if (!c.user.can('hr:manage') && c.user.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.');
    db.prepare('DELETE FROM hr_system_lookups WHERE id = ?').run(Number(c.params.id));
    c.json(200, { ok: true });
  });
}
