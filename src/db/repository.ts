import { desc } from 'drizzle-orm';
import { db } from './index.ts';
import { devopsIncidents, studioChangelog } from './schema.ts';

export interface StudioChangelogRecord {
  id: string;
  version: string;
  title: string;
  description: string;
  category: 'feature' | 'improvement' | 'fix' | 'code_save';
  filePath?: string;
  author: string;
  timestamp: number;
  sizeBytes?: number;
}

function classifyTableDomain(tableName: string): string {
  if (tableName.startsWith('hr_')) return 'شؤون الموظفين والرواتب (HR & Payroll)';
  if (tableName.startsWith('fin_') || tableName.startsWith('proc_')) return 'المالية والمحاسبة والمشتريات (Finance & Procurement)';
  if (tableName.startsWith('stu_') || tableName.startsWith('student_') || tableName === 'programs' || tableName === 'grades' || tableName === 'requests') {
    return 'شؤون الطلاب والقبول والتسجيل (Student Affairs & Academics)';
  }
  if (tableName.startsWith('lms_') || tableName.startsWith('exam_') || tableName.startsWith('ent_')) {
    return 'التعليم الإلكتروني والاختبارات والتطوير المؤسسي (LMS & Enterprise)';
  }
  if (tableName.startsWith('med_') || tableName.startsWith('hosp_')) return 'المستشفى الجامعي والعيادات (University Hospital)';
  if (tableName.startsWith('lib_')) return 'المكتبة المركزية والمستودع الرقمي (Library)';
  if (tableName.startsWith('dorm_') || tableName.startsWith('housing_')) return 'السكن الجامعي والإعاشة (Dormitories)';
  if (tableName.startsWith('devops_') || tableName.startsWith('sec_') || tableName === 'users' || tableName === 'sessions' || tableName === 'org_units') {
    return 'النواة الأمنية والهيكل التنظيمي وDevOps (Core RBAC & DevOps)';
  }
  return 'الوحدات التخصصية والخدمية الجامعية (Specialized University Modules)';
}

export async function getStudioChangelogs(seedDefaults: StudioChangelogRecord[]): Promise<StudioChangelogRecord[]> {
  try {
    let rows = await db
      .select()
      .from(studioChangelog)
      .orderBy(desc(studioChangelog.timestampMs));

    if (rows.length === 0 && seedDefaults.length > 0) {
      for (const item of seedDefaults) {
        await db
          .insert(studioChangelog)
          .values({
            entryCode: item.id,
            version: item.version,
            title: item.title,
            description: item.description,
            category: item.category,
            filePath: item.filePath ?? null,
            author: item.author,
            sizeBytes: item.sizeBytes ?? null,
            timestampMs: item.timestamp,
          })
          .onConflictDoUpdate({
            target: studioChangelog.entryCode,
            set: {
              title: item.title,
              description: item.description,
            },
          });
      }
      rows = await db
        .select()
        .from(studioChangelog)
        .orderBy(desc(studioChangelog.timestampMs));
    }

    return rows.map((r) => ({
      id: r.entryCode,
      version: r.version,
      title: r.title,
      description: r.description,
      category: (r.category as StudioChangelogRecord['category']) || 'improvement',
      filePath: r.filePath || undefined,
      author: r.author,
      timestamp: Number(r.timestampMs),
      sizeBytes: r.sizeBytes ?? undefined,
    }));
  } catch (error) {
    console.error('Database query failed in getStudioChangelogs:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function saveStudioChangelogEntry(
  entry: StudioChangelogRecord,
  userId?: number
): Promise<StudioChangelogRecord> {
  try {
    await db
      .insert(studioChangelog)
      .values({
        entryCode: entry.id,
        version: entry.version,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        filePath: entry.filePath ?? null,
        author: entry.author,
        sizeBytes: entry.sizeBytes ?? null,
        userId: userId ?? null,
        timestampMs: entry.timestamp,
      })
      .onConflictDoUpdate({
        target: studioChangelog.entryCode,
        set: {
          version: entry.version,
          title: entry.title,
          description: entry.description,
          category: entry.category,
          filePath: entry.filePath ?? null,
          author: entry.author,
          sizeBytes: entry.sizeBytes ?? null,
          timestampMs: entry.timestamp,
        },
      });

    return entry;
  } catch (error) {
    console.error('Database query failed in saveStudioChangelogEntry:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function logDevopsIncidentToPostgres(incident: {
  reportCode: string;
  source: string;
  eventType: string;
  severity: string;
  filePath?: string;
  errorMessage: string;
  errorDetails?: string;
  clientContext?: string;
  status: string;
  createdAtMs: number;
}) {
  try {
    const result = await db
      .insert(devopsIncidents)
      .values({
        reportCode: incident.reportCode,
        source: incident.source,
        eventType: incident.eventType,
        severity: incident.severity,
        filePath: incident.filePath ?? null,
        errorMessage: incident.errorMessage,
        errorDetails: incident.errorDetails ?? null,
        clientContext: incident.clientContext ?? null,
        status: incident.status,
        createdAtMs: incident.createdAtMs,
      })
      .onConflictDoUpdate({
        target: devopsIncidents.reportCode,
        set: {
          status: incident.status,
          errorMessage: incident.errorMessage,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in logDevopsIncidentToPostgres:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

/**
 * تدقيق الارتباطات المرجعية: يقرأ مباشرةً من قاعدة PostgreSQL التي يعمل عليها uni-erp
 * (لا نسخة وسيطة ولا مزامنة). erpDb = واجهة uni-erp (prepare().all/get).
 */
export async function getPostgresRelationalAudit(erpDb: any) {
  try {
    const all = (sql: string, ...p: any[]): any[] => erpDb.prepare(sql).all(...p);
    const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

    // 1) سجل الجداول والأعمدة والمفاتيح الأجنبية من كتالوج PostgreSQL
    const tableRows = all(
      "SELECT table_name AS tablename FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    );
    const colRows = all(
      "SELECT table_name AS tablename, column_name AS colname, data_type AS coltype, is_nullable AS nullable FROM information_schema.columns WHERE table_schema = 'public'"
    );
    const fkRows = all(
      `SELECT c.conrelid::regclass::text AS tablename, a.attname AS fromcolumn, c.confrelid::regclass::text AS totable,
              af.attname AS tocolumn, c.confdeltype AS ondelete
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = ANY (c.confkey)
       WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`
    );
    const delRule: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
    const colsByTable = new Map<string, number>();
    for (const c of colRows) colsByTable.set(String(c.tablename), (colsByTable.get(String(c.tablename)) || 0) + 1);
    const fksByTable = new Map<string, any[]>();
    for (const f of fkRows) {
      const k = String(f.tablename);
      if (!fksByTable.has(k)) fksByTable.set(k, []);
      fksByTable.get(k)!.push({ fromColumn: f.fromcolumn, toTable: f.totable, toColumn: f.tocolumn, onDelete: delRule[String(f.ondelete)] || 'NO ACTION' });
    }

    const registryRows = tableRows
      .map((t) => String(t.tablename))
      .filter((name) => /^[a-zA-Z0-9_]+$/.test(name))
      .map((tableName) => {
        let rowCount = 0;
        try { rowCount = num(erpDb.prepare(`SELECT COUNT(*) AS c FROM "${tableName}"`).get()?.c); } catch {}
        const fks = fksByTable.get(tableName) || [];
        return {
          tableName,
          domainCategory: classifyTableDomain(tableName),
          rowCount,
          columnCount: colsByTable.get(tableName) || 0,
          foreignKeyCount: fks.length,
          foreignKeys: fks,
        };
      });

    // 2) الكيانات الأساسية للربط المتقاطع
    const orgUnits = all('SELECT id, name, kind, parent_id FROM org_units ORDER BY id');
    const programs = all('SELECT id, faculty, name, degree, years, active FROM programs ORDER BY id');
    const accounts = all('SELECT id, username, display_name, role, student_no, program, unit_id, active FROM users ORDER BY id');
    const profiles = all('SELECT user_id, first_name, father_name, last_name, national_id, program_id, study_level, status, hs_score FROM student_profiles');
    const requestsRows = all('SELECT id, student_id FROM requests');
    const hrEmployees = all(
      `SELECT id, employeeNo, name, department_name, position, unit_id, salary_base, housing_allowance, transport_allowance,
              contract_type_label, emp_status_label FROM hr_employees ORDER BY id`
    );
    const hrContracts = all('SELECT id, employee_id FROM hr_contracts');
    const hrAttendance = all('SELECT employee_id, commitment_rate FROM hr_monthly_attendance ORDER BY id');
    const hrAdvances = all('SELECT employee_id, remaining_amount FROM hr_advances');
    const finAccountsCount = num(erpDb.prepare('SELECT COUNT(*) AS c FROM fin_accounts').get()?.c);
    const finEntriesCount = num(erpDb.prepare('SELECT COUNT(*) AS c FROM fin_entries').get()?.c);

    const unitById = new Map(orgUnits.map((u) => [num(u.id), u]));
    const unitByName = new Map(orgUnits.map((u) => [String(u.name).trim(), u]));
    const programById = new Map(programs.map((p) => [num(p.id), p]));
    const programByName = new Map(programs.map((p) => [String(p.name).trim(), p]));
    const accountById = new Map(accounts.map((a) => [num(a.id), a]));
    const accountProgramId = (a: any) => (a.program ? programByName.get(String(a.program).trim())?.id ?? null : null);

    const linkedPrograms = programs.map((p) => {
      const unit = unitByName.get(String(p.faculty).trim());
      return {
        id: p.id,
        name: p.name,
        faculty: p.faculty,
        degree: p.degree,
        years: p.years,
        orgUnitName: unit?.name || 'رئاسة الجامعة',
        studentsCount: profiles.filter((sp) => num(sp.program_id) === num(p.id)).length,
        accountsCount: accounts.filter((a) => accountProgramId(a) === p.id).length,
      };
    });

    const linkedStudents = profiles.map((sp) => {
      const acc = accountById.get(num(sp.user_id));
      const prog = programById.get(num(sp.program_id));
      return {
        userId: sp.user_id,
        username: acc?.username || '',
        studentNo: acc?.student_no || acc?.username || '',
        fullName: `${sp.first_name} ${sp.father_name} ${sp.last_name}`,
        nationalId: sp.national_id,
        programName: prog?.name || acc?.program || 'غير محدد',
        facultyName: prog?.faculty || 'غير محدد',
        studyLevel: sp.study_level,
        status: sp.status,
        hsScore: sp.hs_score,
        requestsCount: requestsRows.filter((r) => num(r.student_id) === num(sp.user_id)).length,
      };
    });

    const linkedEmployees = hrEmployees.map((emp) => {
      const unit = emp.unit_id ? unitById.get(num(emp.unit_id)) : undefined;
      const empAdv = hrAdvances.filter((ad) => num(ad.employee_id) === num(emp.id));
      const empAtt = hrAttendance.filter((a) => num(a.employee_id) === num(emp.id));
      return {
        id: emp.id,
        employeeNo: emp.employeeNo,
        name: emp.name,
        departmentName: emp.department_name,
        position: emp.position || 'إداري',
        orgUnitName: unit?.name || emp.department_name,
        salaryBase: num(emp.salary_base),
        totalAllowances: num(emp.housing_allowance) + num(emp.transport_allowance),
        contractTypeLabel: emp.contract_type_label,
        empStatusLabel: emp.emp_status_label,
        contractsCount: hrContracts.filter((c) => num(c.employee_id) === num(emp.id)).length,
        attendanceRecordsCount: empAtt.length,
        commitmentRate: empAtt[0] ? num(empAtt[0].commitment_rate, 100) : 100,
        activeAdvancesCount: empAdv.length,
        remainingAdvanceAmount: empAdv.reduce((sum, item) => sum + num(item.remaining_amount), 0),
      };
    });

    const domainBreakdownMap = new Map<string, { domain: string; tablesCount: number; totalRows: number; totalColumns: number; totalForeignKeys: number }>();
    let totalForeignKeys = 0;
    let totalRows = 0;
    for (const r of registryRows) {
      totalForeignKeys += r.foreignKeyCount;
      totalRows += r.rowCount;
      const e = domainBreakdownMap.get(r.domainCategory) || { domain: r.domainCategory, tablesCount: 0, totalRows: 0, totalColumns: 0, totalForeignKeys: 0 };
      e.tablesCount += 1;
      e.totalRows += r.rowCount;
      e.totalColumns += r.columnCount;
      e.totalForeignKeys += r.foreignKeyCount;
      domainBreakdownMap.set(r.domainCategory, e);
    }

    return {
      summary: {
        totalTablesRegistered: registryRows.length,
        totalRowsAcrossTables: totalRows,
        totalForeignKeysVerified: totalForeignKeys,
        postgresCoreTablesCount: registryRows.length,
        orgUnitsCount: orgUnits.length,
        programsCount: programs.length,
        accountsCount: accounts.length,
        studentProfilesCount: profiles.length,
        studentRequestsCount: requestsRows.length,
        hrEmployeesCount: hrEmployees.length,
        hrContractsCount: hrContracts.length,
        hrAttendanceCount: hrAttendance.length,
        hrAdvancesCount: hrAdvances.length,
        finAccountsCount,
        finEntriesCount,
      },
      domainBreakdown: Array.from(domainBreakdownMap.values()).sort((a, b) => b.tablesCount - a.tablesCount),
      linkedPrograms,
      linkedStudents,
      linkedEmployees,
      tablesRegistry: registryRows.sort((a, b) => b.foreignKeyCount - a.foreignKeyCount || b.rowCount - a.rowCount),
    };
  } catch (error) {
    console.error('Database query failed in getPostgresRelationalAudit:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}
