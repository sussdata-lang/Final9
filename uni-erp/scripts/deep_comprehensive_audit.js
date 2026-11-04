import fs from 'node:fs';
import path from 'node:path';
import { openDb, tx } from '../server/db.js';
import { loadConfig } from '../server/config.js';
import { hashPassword } from '../server/security.js';
import { login, publicUser } from '../server/services/auth.js';
import { seedPassword } from '../server/services/bootstrap.js';
import { createDoc, sendDoc, getDoc, listDocs, decideDoc, commentDoc } from '../server/services/correspondence.js';
import { createRequest, decide, forwardRequest, listRequests, getRequest } from '../server/services/requests.js';
import * as Fin from '../server/services/finance/core.js';
import * as Proc from '../server/services/procurement/core.js';
import * as Hr from '../server/services/hr.js';
import * as Acad from '../server/services/academics.js';
import * as Stu from '../server/services/students.js';
import * as StaffAtt from '../server/services/staffatt.js';
import { verifyAuditChain } from '../server/audit.js';
import { getSlots, setSlots, detectScheduleConflicts } from '../server/services/schedule.js';
import { issueEnrollmentCertificate, verifyByHash } from '../server/services/enrollcert.js';
import { getUnifiedStudentRecord } from '../server/services/record360.js';
import { transitionGrades } from '../server/services/workflow.js';

async function runDeepAudit() {
  console.log('=== STARTING DEEP SYSTEM-WIDE MULTI-ROLE OPERATIONAL AUDIT ===\n');
  const cfg = loadConfig();
  const db = await openDb(cfg.dbPath);
  const deps = { db, cfg, limiter: { check: () => true, hits: new Map() } };

  const findings = [];
  const testResults = [];

  function recordTest(area, scenario, status, notes) {
    testResults.push({ area, scenario, status, notes });
    console.log(`[${status}] [${area}] ${scenario}: ${notes}`);
  }

  function recordFinding(title, severity, location, scenario, remediation) {
    findings.push({ title, severity, location, scenario, remediation });
    console.log(`\n🚨 FOUND DEFECT [${severity}]: ${title} at ${location}\n`);
  }

  // -------------------------------------------------------------
  // TEST 1: ALL 37 ACCOUNTS AUTHENTICATION & DESK VALIDATION
  // -------------------------------------------------------------
  console.log('--- TEST 1: AUTHENTICATION ACROSS ALL 37 USERS ---');
  const allUsers = db.prepare('SELECT id, username, display_name, role, role_key, unit_id, active FROM users').all();
  let authSuccess = 0;
  for (const u of allUsers) {
    try {
      const res = await login(deps, { username: u.username, password: seedPassword(), ip: '127.0.0.1' });
      if (res && res.token && res.user) {
        authSuccess++;
      } else {
        recordTest('Auth', `Login ${u.username}`, 'FAIL', 'Login returned invalid payload');
      }
    } catch (e) {
      recordTest('Auth', `Login ${u.username}`, 'FAIL', e.message);
    }
  }
  recordTest('Auth', 'All 37 Users Login', authSuccess === allUsers.length ? 'PASS' : 'WARN', `${authSuccess}/${allUsers.length} logged in successfully with active session tokens.`);

  // -------------------------------------------------------------
  // TEST 2: CORRESPONDENCE MODULE (المراسلات) & EDGE CASES
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: CORRESPONDENCE LIFECYCLE & EDGE CASES ---');
  const adminActor = { id: 1, role: 'admin', unit_id: null, can: () => true };
  const academicActor = { id: 4, username: 'academic', role: 'staff', role_key: 'head_academic', unit_id: 4, can: (p) => ['corr:use', 'request:read_unit', 'request:decide', 'request:forward'].includes(p) };
  const deanActor = { id: 2, username: 'auditor1', role: 'auditor', unit_id: 1, can: () => true };

  // 2.1 Sequential & Parallel Document Creation
  let testCorrId = null;
  try {
    const doc = createDoc(deps, academicActor, {
      title: 'طلب اعتماد تحديث الخطة الدراسية لقسم الأمن السيبراني',
      subject: 'تحديث المناهج والمعامل التخصصية لعام 2026',
      body: 'نرفع لسيادتكم مقترح تحديث المناهج لتشمل مواد الحوسبة السحابية المتقدمة وتقنيات التشفير الكمومي.',
      mode: 'sequential',
      priority: 'high',
      approvers: [1, 2] // Admin then Dean
    }, '127.0.0.1');
    testCorrId = doc.id;
    recordTest('Correspondence', 'Create Sequential Doc', 'PASS', `Created doc ID ${doc.id} with Outgoing No: ${doc.no}`);
  } catch (e) {
    recordTest('Correspondence', 'Create Sequential Doc', 'FAIL', e.message);
  }

  // 2.2 Out-of-Order Approval Edge Case
  if (testCorrId) {
    try {
      // Actor 2 attempts to approve BEFORE Actor 1 approves in sequential mode
      const actor2 = { id: 2, role: 'staff', can: () => true };
      decideDoc(deps, actor2, testCorrId, { decision: 'approved', comment: 'موافقة مبكرة' }, '127.0.0.1');
      // If it allowed approval out of order, that's a sequential logic bug!
      recordFinding(
        'Sequential Approval Order Bypass in Correspondence',
        'High',
        'uni-erp/server/services/correspondence.js (decideDoc)',
        'In sequential mode (mode="sequential"), a downstream approver was able to approve document before upstream approver, breaking the defined approval chain.',
        'Validate in decideDoc that current actor step index matches the active pending step when mode === "sequential".'
      );
      recordTest('Correspondence', 'Sequential Enforcement', 'FAIL', 'Downstream approver approved out of turn.');
    } catch (e) {
      recordTest('Correspondence', 'Sequential Enforcement', 'PASS', `Blocked out-of-order approval: ${e.message}`);
    }
  }

  // 2.3 Post-Decision State Mutation
  if (testCorrId) {
    try {
      // Admin approves
      decideDoc(deps, adminActor, testCorrId, { decision: 'approved', comment: 'معتمد نظامياً' }, '127.0.0.1');
      // Now attempt to reject or cancel an already approved document
      try {
        decideDoc(deps, adminActor, testCorrId, { decision: 'rejected', comment: 'تراجع بعد الاعتماد' }, '127.0.0.1');
        recordFinding(
          'Double Decision / State Override on Finalized Correspondence',
          'Medium',
          'uni-erp/server/services/correspondence.js',
          'System allowed an approver to re-submit decision on an already finalized document without reopening.',
          'Add status check to prevent decision if doc.status is already approved/rejected.'
        );
      } catch (errDecideAgain) {
        recordTest('Correspondence', 'Idempotent Final State', 'PASS', `Prevented re-deciding finalized doc: ${errDecideAgain.message}`);
      }
    } catch (e) {
      recordTest('Correspondence', 'Admin Approval', 'FAIL', e.message);
    }
  }

  // -------------------------------------------------------------
  // TEST 3: STUDENT REQUESTS & WORKFLOW ESCALATIONS
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: STUDENT REQUESTS & SERVICE WORKFLOWS ---');
  let testReqId = null;
  const studentActor = { id: 37, username: 'CYB-2026-0001', role: 'student', can: (p) => p === 'profile:read_own' || p === 'request:create' };
  try {
    const sType = db.prepare('SELECT id, key, name, unit_id FROM service_types LIMIT 1').get();
    const req = createRequest(deps, studentActor, {
      serviceTypeId: sType.id,
      notes: 'طلب كشف علامات رسمي مصدق لتقديمه لجهة الابتعاث',
      fields: { copies: 2, language: 'عربي' }
    }, '127.0.0.1');
    testReqId = req.id;
    recordTest('Requests', 'Student Create Request', 'PASS', `Created request #${req.id} for service ${sType.name}`);
  } catch (e) {
    recordTest('Requests', 'Student Create Request', 'FAIL', e.message);
  }

  // 3.1 Unauthorized Unit Cross-Decision
  if (testReqId) {
    try {
      const libraryActor = { id: 10, username: 'library', role: 'staff', role_key: 'head_library', unit_id: 10, can: (p) => ['request:read_unit', 'request:decide'].includes(p) };
      // Library attempts to decide on a Student Affairs request
      decide(deps, libraryActor, testReqId, { action: 'approve', notes: 'موافقة من المكتبة' }, '127.0.0.1');
      recordFinding(
        'Cross-Unit Unauthorized Request Decision',
        'High',
        'uni-erp/server/services/requests.js (decide)',
        'An officer from Library (unit_id: 10) was able to approve a student document request assigned to Student Affairs (unit_id: 1), violating unit separation.',
        'Enforce that actor.unit_id === request.unit_id unless actor has system-wide request:decide_all permission or role is admin.'
      );
      recordTest('Requests', 'Unit Scope Isolation', 'FAIL', 'Cross-unit approval succeeded without authorization.');
    } catch (e) {
      recordTest('Requests', 'Unit Scope Isolation', 'PASS', `Blocked cross-unit decision: ${e.message}`);
    }
  }

  // -------------------------------------------------------------
  // TEST 4: FINANCE & ACCOUNTING INTEGRATION
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: FINANCIAL INTEGRITY & CONTROLS ---');
  // 4.1 Unbalanced Journal Entry (Double Entry Invariant)
  try {
    const yearRow = db.prepare('SELECT id FROM fin_years ORDER BY id LIMIT 1').get();
    const unbEntry = Fin.createEntry(db, {
      year_id: yearRow.id,
      type: 'JV',
      entry_day: '2026-10-30',
      description: 'قيد محاسبي غير متوازن لاختبار الرقابة المالية',
      lines: [
        { account_id: 1, debit: 500000, credit: 0, description: 'مدين' },
        { account_id: 2, debit: 0, credit: 300000, description: 'دائن غير مطابق' }
      ]
    }, adminActor);
    
    // Now try to post an unbalanced entry
    try {
      Fin.postEntry(db, unbEntry.id, adminActor);
      recordFinding(
        'Posting Unbalanced Journal Entry (Double-Entry Bookkeeping Violation)',
        'Critical',
        'uni-erp/server/services/finance/core.js (postEntry)',
        'The system allowed posting a Journal Entry where total debits (500,000) != total credits (300,000), violating core double-entry accounting integrity.',
        'Assert Math.abs(sumDebit - sumCredit) < 0.001 inside postEntry before updating status to posted.'
      );
      recordTest('Finance', 'Double Entry Balance Check', 'FAIL', 'Unbalanced JV was posted.');
    } catch (postErr) {
      recordTest('Finance', 'Double Entry Balance Check', 'PASS', `Blocked unbalanced posting: ${postErr.message}`);
    }
  } catch (e) {
    recordTest('Finance', 'Create Entry', 'PASS', `Entry creation rejected or validated: ${e.message}`);
  }

  // 4.2 Invoice with Zero or Negative Amount
  try {
    const inv = Fin.createInvoice(db, {
      student_id: 37,
      term: 'خريف 2026',
      total_amount: -50000,
      due_date: '2026-11-30',
      items: [{ fee_type: 'tuition', amount: -50000, note: 'رسوم سالبة' }]
    }, adminActor);
    recordFinding(
      'Negative Amount Invoice Allowed',
      'High',
      'uni-erp/server/services/finance/core.js (createInvoice)',
      'The system accepted invoice creation with negative total_amount (-50,000), allowing illicit credit generation on student ledger.',
      'Validate that total_amount > 0 and each item amount > 0 in createInvoice.'
    );
    recordTest('Finance', 'Negative Invoice Check', 'FAIL', 'Negative invoice was created.');
  } catch (e) {
    recordTest('Finance', 'Negative Invoice Check', 'PASS', `Blocked negative invoice: ${e.message}`);
  }

  // -------------------------------------------------------------
  // TEST 5: PROCUREMENT, WAREHOUSING & ASSETS
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: PROCUREMENT & ASSET MANAGEMENT ---');
  // 5.1 Warehouse Negative Stock Issue
  try {
    const item = db.prepare('SELECT id, name, qty_on_hand FROM proc_items LIMIT 1').get();
    if (item) {
      const hugeQty = (item.qty_on_hand || 0) + 1000;
      const issue = Proc.createIssue(db, {
        warehouse_id: 1,
        dept_id: 4,
        issued_to: 'د. علي الأحمد',
        items: [{ item_id: item.id, qty: hugeQty, note: 'صرف فوق الرصيد' }]
      }, adminActor);
      recordFinding(
        'Negative Warehouse Inventory Allowed (Stock Over-Issuance)',
        'High',
        'uni-erp/server/services/procurement/core.js (createIssue)',
        `Issued ${hugeQty} units of ${item.name} when only ${item.qty_on_hand} were in stock, driving physical warehouse inventory negative.`,
        'Verify qty <= qty_on_hand for all items prior to executing warehouse issuance.'
      );
      recordTest('Procurement', 'Inventory Stock Level Check', 'FAIL', 'Over-issuance allowed.');
    }
  } catch (e) {
    recordTest('Procurement', 'Inventory Stock Level Check', 'PASS', `Blocked over-issuance: ${e.message}`);
  }

  // 5.2 Asset Transfer to Inactive / Non-existent Employee
  try {
    const asset = db.prepare('SELECT id, name FROM proc_assets LIMIT 1').get();
    if (asset) {
      Proc.moveAsset(db, asset.id, {
        to_dept_id: 4,
        to_holder: 'مجهول الهوية 99999',
        reason: 'نقل عهدة لموظف غير مسجل'
      }, adminActor);
      recordTest('Procurement', 'Asset Movement', 'PASS', 'Asset moved and logged.');
    }
  } catch (e) {
    recordTest('Procurement', 'Asset Movement', 'WARN', e.message);
  }

  // -------------------------------------------------------------
  // TEST 6: HUMAN RESOURCES, ATTENDANCE & PAYROLL
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: HUMAN RESOURCES & PAYROLL ---');
  // 6.1 Duplicate Active Employee Contract
  try {
    const emp = db.prepare('SELECT id, full_name FROM hr_employees LIMIT 1').get();
    if (emp) {
      Hr.createContract(db, {
        employee_id: emp.id,
        contract_type: 'full_time',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        basic_salary: 1500000,
        status: 'active'
      }, adminActor);
      // Attempt to create a 2nd active contract overlapping the same period
      Hr.createContract(db, {
        employee_id: emp.id,
        contract_type: 'part_time',
        start_date: '2026-02-01',
        end_date: '2026-11-30',
        basic_salary: 800000,
        status: 'active'
      }, adminActor);
      recordFinding(
        'Overlapping Active HR Contracts for Single Employee',
        'Medium',
        'uni-erp/server/services/hr.js (createContract)',
        'System allowed creating multiple simultaneous active contracts with basic salaries for the same employee without expiring or terminating the previous one.',
        'When creating or activating a contract, verify no conflicting active contract exists or auto-close previous active contract.'
      );
      recordTest('HR', 'Contract Overlap Check', 'FAIL', 'Allowed overlapping active contracts.');
    }
  } catch (e) {
    recordTest('HR', 'Contract Overlap Check', 'PASS', `Handled contract creation: ${e.message}`);
  }

  // 6.2 Negative Basic Salary in Payroll Slip
  try {
    const emp = db.prepare('SELECT id FROM hr_employees LIMIT 1').get();
    if (emp) {
      Hr.createSalaryRecord(db, {
        employee_id: emp.id,
        month: '2026-10',
        basic_salary: -100000,
        allowances: 0,
        deductions: 50000
      }, adminActor);
      recordFinding(
        'Negative Basic Salary Accepted in HR Payroll',
        'High',
        'uni-erp/server/services/hr.js (createSalaryRecord)',
        'Allowed negative basic_salary (-100,000), which corrupted net salary calculations and tax withholding.',
        'Validate basic_salary >= 0 and net_salary >= 0.'
      );
      recordTest('HR', 'Salary Sanity Check', 'FAIL', 'Negative salary allowed.');
    }
  } catch (e) {
    recordTest('HR', 'Salary Sanity Check', 'PASS', `Blocked negative salary: ${e.message}`);
  }

  // -------------------------------------------------------------
  // TEST 7: ACADEMICS, GRADES & SCHEDULE CONFLICTS
  // -------------------------------------------------------------
  console.log('\n--- TEST 7: ACADEMICS & GRADE CONTROLS ---');
  // 7.1 Grade Mark Beyond Max Limit (e.g. 150 / 100)
  try {
    Acad.enterGrade(deps, adminActor, 37, {
      courseId: 1,
      term: 'خريف 2026',
      mark: 150,
      hours: 3
    }, '127.0.0.1');
    recordFinding(
      'Grade Mark Allowed Beyond Valid Scale (Mark > 100 or < 0)',
      'High',
      'uni-erp/server/services/academics.js (enterGrade)',
      'Accepted grade mark of 150, breaking GPA calculations, honor roll listings, and academic transcript integrity.',
      'Validate 0 <= mark <= 100 in enterGrade.'
    );
    recordTest('Academics', 'Grade Scale Boundary Check', 'FAIL', 'Mark > 100 was accepted.');
  } catch (e) {
    recordTest('Academics', 'Grade Scale Boundary Check', 'PASS', `Blocked out-of-scale grade: ${e.message}`);
  }

  // 7.2 Classroom Double-Booking (Schedule Conflict Detection)
  try {
    const conflict = detectScheduleConflicts(db, 37);
    recordTest('Academics', 'Schedule Conflict Algorithm', 'PASS', `Ran conflict detection algorithm: ${JSON.stringify(conflict.conflicts?.length || 0)} conflicts found.`);
  } catch (e) {
    recordTest('Academics', 'Schedule Conflict Algorithm', 'FAIL', e.message);
  }

  // -------------------------------------------------------------
  // TEST 8: STUDENT HOLDS & RESTRICTIONS (المانع والذمة)
  // -------------------------------------------------------------
  console.log('\n--- TEST 8: STUDENT HOLDS & PRIVILEGE ENFORCEMENT ---');
  try {
    // 8.1 Place financial hold on student 37
    db.prepare("INSERT INTO student_holds (student_id, kind, reason, placed_by, placed_at) VALUES (37, 'financial', 'ذمة مالية مستحقة', 1, ?)").run(Date.now());
    
    // Check if certificate issuance is blocked
    try {
      const cert = issueEnrollmentCertificate(deps, studentActor, 37, 'إثبات قيد للجهات الرسمية', '127.0.0.1');
      recordFinding(
        'Student Hold Bypass in Enrollment Certificate Issuance',
        'Critical',
        'uni-erp/server/services/enrollcert.js (issueEnrollmentCertificate)',
        'Student with active financial hold was able to issue official verified enrollment certificate with QR code.',
        'Query student_holds table and abort with 403 if active hold exists.'
      );
      recordTest('Student Affairs', 'Hold Restriction Enforcement', 'FAIL', 'Certificate issued despite active hold.');
    } catch (holdErr) {
      recordTest('Student Affairs', 'Hold Restriction Enforcement', 'PASS', `Blocked certificate issuance due to hold: ${holdErr.message}`);
    } finally {
      // Remove test hold
      db.prepare("DELETE FROM student_holds WHERE student_id = 37 AND reason = 'ذمة مالية مستحقة'").run();
    }
  } catch (e) {
    recordTest('Student Affairs', 'Hold Test Setup', 'WARN', e.message);
  }

  // -------------------------------------------------------------
  // TEST 9: AUDIT LOG HASH CHAIN VERIFICATION (SHA-256)
  // -------------------------------------------------------------
  console.log('\n--- TEST 9: CRYPTOGRAPHIC AUDIT LOG INTEGRITY ---');
  try {
    const auditRes = verifyAuditChain(db);
    recordTest('Audit Log', 'SHA-256 Chain Verification', auditRes.valid ? 'PASS' : 'FAIL', `Verified ${auditRes.count || 0} audit log entries with status: ${auditRes.valid ? 'Tamper-free' : 'Chain broken'}`);
  } catch (e) {
    recordTest('Audit Log', 'SHA-256 Chain Verification', 'FAIL', e.message);
  }

  console.log('\n=== AUDIT SUMMARY ===');
  console.log(`Total Scenarios Tested: ${testResults.length}`);
  console.log(`Passed: ${testResults.filter(r => r.status === 'PASS').length}`);
  console.log(`Failed / Defect Discovered: ${testResults.filter(r => r.status === 'FAIL').length}`);
  console.log(`New Concrete Vulnerabilities Discovered: ${findings.length}`);

  return { testResults, findings, allUsers };
}

runDeepAudit().catch(console.error);
