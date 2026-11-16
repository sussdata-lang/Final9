import { registerHousingRoutes } from './services/housing.js';
import { IDEMPOTENT_ROUTES, withIdempotency } from './services/idempotency.js';
import { withLock } from './services/numbering.js';
import { activeCardBlock, blockCard, unblockCard } from './services/card_blocks.js';
import { startSetup, confirmSetup, disableMfa, resetUserMfa } from './services/mfa.js';
import { stageFiles, removeStaged } from './services/staging.js';

// أبطأ الاستعلامات على مستوى القاعدة كلها، إن فعّل مدير القاعدة pg_stat_statements
function readPgStatements(db) {
  try {
    const rows = db.prepare('SELECT query, calls, ROUND(total_exec_time)::bigint AS "totalMs", ROUND(mean_exec_time::numeric, 1) AS "avgMs" FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) ORDER BY total_exec_time DESC LIMIT 20').all();
    return { enabled: true, rows: rows.map((r) => ({ ...r, query: String(r.query).replace(/\s+/g, ' ').slice(0, 240) })) };
  } catch { return { enabled: false, rows: [] }; }
}

// عمليات «افحص ثم اكتب» على السجل نفسه: تُسلسل عبر كل عمليات الخادم
const byId = (name) => (c) => `${name}:${c.params.id}`;
const ROUTE_LOCKS = {
  'POST /api/enterprise/self-enroll': (c) => (c.body?.section_id ? `section:${Number(c.body.section_id)}` : `enroll:${c.user?.id}`),
  'POST /api/enterprise/self-enroll/:id/drop': byId('enrollment'),
  'POST /api/requests/:id/approve': byId('request'), 'POST /api/requests/:id/reject': byId('request'), 'POST /api/requests/:id/forward': byId('request'),
  'POST /api/lms/quizzes/:id/start': (c) => `quiz:${c.params.id}:${c.user?.id}`, 'POST /api/lms/quizzes/:id/submit': (c) => `quiz:${c.params.id}:${c.user?.id}`,
  'POST /api/housing/allocations': () => 'housing', 'POST /api/housing/handouts': () => 'housing',
  'POST /api/corr/:id/send': byId('corr'), 'POST /api/corr/:id/approve': byId('corr'), 'POST /api/corr/:id/reject': byId('corr'), 'POST /api/corr/:id/cancel': byId('corr'),
  'POST /api/finance/invoices/:id/pay': () => 'billing', 'POST /api/finance/invoices/:id/issue': () => 'billing', 'POST /api/finance/invoices/:id/cancel': () => 'billing',
  'POST /api/finance/student-invoices/:id/pay': () => 'billing', 'POST /api/finance/payments': () => 'billing', 'POST /api/finance/charges/:id/void': () => 'billing', 'POST /api/finance/payments/:id/void': () => 'billing', 'POST /api/finance/discounts': () => 'billing',
  'POST /api/finance/journal/:id/post': byId('entry'), 'POST /api/finance/journal/:id/reverse': byId('entry'), 'POST /api/finance/payroll-entry': () => 'payroll',
  'POST /api/enterprise/installments/:id/pay': byId('installment'),
  'POST /api/council-items/:id/decide': byId('council_item'), 'POST /api/council-items/:id/recuse': byId('council_item'), 'POST /api/council-meetings/:id/attendance': byId('council_meeting'),
  'POST /api/council-meetings/:id/close': byId('council_meeting'), 'POST /api/council-meetings/:id/schedule': byId('council_meeting'), 'POST /api/council-tasks/:id/done': byId('council_task'),
  'POST /api/grades/results/lock': () => 'grade_lock', 'PUT /api/courses/:id/components': byId('course_components'),
  'POST /api/facilities/bookings': () => 'room_booking', 'POST /api/facilities/bookings/:id/decide': () => 'room_booking',
  'POST /api/procurement/rfqs/:id/award': byId('rfq'), 'POST /api/procurement/rfqs/:id/quotes': byId('rfq'),
  'POST /api/finance/budgets/transfer': () => 'budget', 'POST /api/procurement/orders/:id/order': () => 'budget',
  'POST /api/finance/invoices/:id/match': () => 'billing', 'POST /api/finance/invoices/:id/override': () => 'billing',
  'POST /api/lms/loans': () => 'library', 'POST /api/lms/loans/:id/return': () => 'library',
  'POST /api/expansions/appeals/:id/decide': byId('appeal'),
  'POST /api/attendance/scan': (c) => `hall:${c.body?.code ?? c.body?.studentNo ?? ''}`,
  'POST /api/student-affairs-suite/lifecycle': (c) => `lifecycle:${c.body?.studentId}`,
  'POST /api/student-affairs-suite/lifecycle/:id/decide': byId('movement'),
  'POST /api/procurement/receipts': () => 'stock', 'POST /api/procurement/issues': () => 'stock', 'POST /api/procurement/items/:id/adjust': () => 'stock',
};
// الرد يُرسل بعد إنهاء المعاملة، فلا يقرأ العميل بيانات لم تُحفظ بعد
function lockedHandler(db, keyOf, handler) {
  return (c) => {
    const send = c.json, held = [];
    c.json = (...a) => { held.push(a); };
    let out;
    try { out = withLock(db, keyOf(c), () => handler(c)); }
    finally { c.json = send; }
    for (const a of held) send.apply(c, a);
    return out;
  };
}
import { log } from './lib/logger.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router, HttpError, sendRaw, sendStream, getHttpTelemetry, slowestRoutes, getWafStats, unbanIp, SECURITY_HEADERS as SEC } from './http.js';
import { tx, getDbPerfStats, slowestQueries, DB_POOL_MAX } from './db.js';
import { getCacheTelemetry, getServicesSnapshot, getCachedUnitByCode, getOrgUnitsSnapshot, cacheGetOrSet } from './cache.js';
import { registerFinance } from './services/finance/routes.js';
import { registerProcurement } from './services/procurement/routes.js';
import { registerV12Modules } from './services/v12_modules.js';
import { registerHrIntegratedRoutes } from './services/hr_integrated.js';
import { registerEnterpriseSuiteRoutes } from './services/enterprise_suite.js';
import { registerStudentAffairsSuiteRoutes } from './services/student_affairs_suite.js';
import { registerStudentRegulationRoutes } from './services/student_regulations.js';
import { registerCouncilRoutes } from './services/councils.js';
import { registerTeachingRoutes } from './services/teaching.js';
import { registerRecruitmentRoutes } from './services/recruitment.js';
import { registerFacilitiesRoutes } from './services/facilities.js';
import { registerGradingRoutes } from './services/grading.js';
import { globalSearch } from './services/global_search.js';
import { registerSecurityCenterRoutes } from './services/security_center.js';
import { registerConsentRoutes } from './services/consent.js';
import { registerWarehouseRoutes } from './services/warehouse.js';
import { registerContainmentRoutes } from './services/security_containment.js';
import { registerWalletRoutes } from './services/wallet.js';
import { DATA_CLASSIFICATION, SENSITIVITY } from './lib/data_classification.js';
import { registerQuotationRoutes } from './services/procurement/quotations.js';
import { login, logout, publicUser, changePassword, getSessionCacheStats, invalidateSessionCache } from './services/auth.js';
import { listStaff, listStaffLight, staffDetail, createUser, updateUser, setUserActive, resetUserPassword, deleteUser } from './services/useradmin.js';
import { getTranscriptTemplate, setTranscriptTemplate, getSite, saveSite, universityName } from './services/site.js';
import { listServices, createService, updateService } from './services/catalog.js';
import { updateHold, deleteHold, createRule, updateRule, deleteRule } from './services/admindata.js';
import { RULE_KINDS } from './services/rules.js';
import { buildTemplate, exportRequests } from './services/requestsxl.js';
import { createDoc, updateDoc, sendDoc, getDoc, listDocs, decideDoc, commentDoc, cancelDoc, readCorrFile, listNotifs, readNotifs, listPeople } from './services/correspondence.js';
import { corrPdf } from './services/corrpdf.js';
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from './services/corrTemplates.js';
import { deskSummary } from './services/desk.js';
import { listSettings, saveSettings, resetSettings, publicLimits } from './services/settings.js';
import { punch, myAttendance, dayReport, exportMonth, listBalances, setEntitlement, getHrSettings, saveHrSettings } from './services/staffatt.js';
import { IMPORT_PERM } from './services/importer.js';
import { cardOptions, cardStudents, listCardBatches, createCardBatch, cardBatchDetail, cardBatchXlsx, markCardReceived, undoCardReceived, cardCertificates } from './services/cards.js';
import { stagedImport, stagedRequestsImport } from './services/import_staged.js';
import { importCatalog, checkImport, commitImport, cancelImport, listBatches, undoBatch, importTemplate } from './services/import_engine.js';
import { addStudentFile, listStudentFiles, deleteStudentFile, streamStudentFile } from './services/studentfiles.js';
import { studentFileView, saveStudentFileMeta } from './services/student_file.js';
import { registerStudentGroupRoutes } from './services/student_groups.js';
import { registerLmsAssignmentRoutes } from './services/lms_assignments.js';
import { registerLmsSubmissionRoutes } from './services/lms_assignment_submissions.js';
import { registerUserNotificationRoutes } from './services/lms_assignment_notify.js';
import { devSwitchEnabled, isLocalRequest, devAccounts, prepareDevAccount } from './services/dev_accounts.js';
import { createBackup, backupInfo, backupPath, deleteBackup, verifyBackup } from './services/backup.js';
import { vapidKeys, subscribe as pushSubscribe, unsubscribe as pushUnsubscribe, subscriptionCount, notify, notifyNews, notifyGrade, notifyRequest, notifyComplaint } from './services/push.js';
import { scan as hallScan, addManual as hallAdd, updateLog as hallUpdate, deleteLog as hallDelete, listLogs, openLogs, findStudent } from './services/attendance.js';
import { listFaculty, createFaculty, updateFaculty as updateMember, toggleFaculty as toggleMember, deleteFaculty as deleteMember } from './services/faculty.js';
import { addUpload, addLink, deleteMedia, streamMedia } from './services/media.js';
import { analytics, filterOptions } from './services/analytics.js';
import { buildReportXlsx, buildReportDocx } from './services/reports.js';
import { documentPdf } from './services/docpdf.js';
import { issueEnrollmentCertificate, certFor, certSummary, readCertPdf, verifyEnrollment, verifyByHash, publicBase } from './services/enrollcert.js';
import { qrSvg } from './qr.js';
import { overview, createRole, updateRole, deleteRole, createUnit, updateUnit, deleteUnit, createLink, deleteLink, linkedTargets, matrixXlsx } from './services/access.js';
import { registrationOptions, registerStudent, listStudents, listStudentsTable, getStudent, updateStudent, resetStudentPassword, myProfile, updateOwnContact, listPrograms, addProgram, toggleProgram, listFaculties, addFaculty, toggleFaculty, updateFaculty, deleteFaculty, updateProgram, deleteProgram, deleteStudent, assertStudentInScope } from './services/students.js';
import { listCourses, listGradesTable, createCourse, toggleCourse, updateCourse, deleteCourse, myGrades, gradesFor, enterGrade, gradeSheet, saveGradeSheet, deleteGrade, listNews, createNews, updateNews, deleteNews, createComplaint, listComplaints, respondComplaint, deleteComplaint } from './services/academics.js';
import { transitionGrades, gradeHistory, workflowOn, setWorkflow, myCourseGrades } from './services/workflow.js';
import { getSlots, setSlots, addSlot, detectScheduleConflicts, studentTimetable, DAYS } from './services/schedule.js';
import { getUnifiedStudentRecord } from './services/record360.js';
import { expandFields, requesterKind, createRequest, listRequests, getRequest, decide, forwardRequest, stats, readAttachment } from './services/requests.js';
import { getDocument, verifyPublic } from './services/documents.js';
import { exportOptions, preview as exportPreview, renderExport } from './services/dataexport.js';
import { audit, verifyAuditChain } from './audit.js';
import { encryptField, decryptField } from './lib/data_crypto.js';
import { recentLogs } from './lib/logger.js';

const need = (ctx, perm) => { if (!ctx.user.can(perm)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
const needAny = (ctx, ...perms) => { if (!perms.some((p) => ctx.user.can(p))) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };

export async function buildRouter(deps) {
  const { db, cfg, limiter } = deps;
  const r = new Router();
  // حساب نطاقه كلية لا يصل إلى طالب من خارجها في أي مسار على ملف الطالب
  const addRoute = r.add.bind(r);
  r.add = (method, pattern, rawHandler, opts, inner = ROUTE_LOCKS[`${method} ${pattern}`] ? lockedHandler(db, ROUTE_LOCKS[`${method} ${pattern}`], rawHandler) : rawHandler, handler = IDEMPOTENT_ROUTES.has(`${method} ${pattern}`) ? withIdempotency(db, inner) : inner) => addRoute(method, pattern, pattern.startsWith('/api/students/:id') ? (c) => { assertStudentInScope(deps, c.user, c.params.id); return handler(c); } : handler, opts);
  const cookie = (token, maxAge) => `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;

  // ---- الهوية ----
  r.add('POST', '/api/auth/login', async (c) => {
    const out = await login(deps, { username: c.body.username, password: c.body.password, code: c.body.code, ip: c.ip, ua: c.req.headers['user-agent'] });
    c.json(200, { user: out.user }, { 'Set-Cookie': cookie(out.token, out.maxAge) });
  }, { auth: false });
  registerStudentGroupRoutes(r, deps);
  registerLmsAssignmentRoutes(r, deps);
  registerLmsSubmissionRoutes(r, deps);
  registerUserNotificationRoutes(r, deps);
  registerHousingRoutes(r, deps, { need, needAny });
  // تبديل الحساب للتجربة المحلية: لا يُسجَّل إلا مع DEMO_MODE=1 وخادم مربوط بعنوان محلي.
  // لا تضعه تحت /api/dev/: جدار الحماية يعدّ /dev/ مسار اختراق ويحظر العنوان.
  if (devSwitchEnabled(cfg.host)) {
    const onlyLocal = (c) => { if (!isLocalRequest(c.ip, c.req.headers.host)) throw new HttpError(404, 'غير موجود.', 'not_found'); };
    r.add('GET', '/api/local-accounts', (c) => { onlyLocal(c); c.json(200, { accounts: devAccounts(deps) }); }, { auth: false });
    r.add('POST', '/api/local-switch', async (c) => {
      onlyLocal(c);
      const { username, password } = await prepareDevAccount(deps, c.body?.key);
      const out = await login(deps, { username, password, ip: c.ip, ua: c.req.headers['user-agent'] });
      c.json(200, { user: out.user }, { 'Set-Cookie': cookie(out.token, out.maxAge) });
    }, { auth: false });
  }
  r.add('POST', '/api/auth/mfa/setup', (c) => c.json(200, startSetup(deps, c.user)), { allowMustChange: true });
  r.add('POST', '/api/auth/mfa/confirm', (c) => c.json(200, confirmSetup(deps, c.user, c.body?.code, c.ip)), { allowMustChange: true });
  r.add('POST', '/api/auth/mfa/disable', async (c) => c.json(200, await disableMfa(deps, c.user, c.body, c.ip)));
  r.add('POST', '/api/admin/users/:id/mfa-reset', (c) => { need(c, 'user:manage'); c.json(200, resetUserMfa(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/auth/logout', (c) => { logout(deps, c.cookies.sid, c.user, c.ip); c.json(200, { ok: true }, { 'Set-Cookie': cookie('', 0) }); }, { allowMustChange: true });
  r.add('POST', '/api/auth/change-password', async (c) => { await changePassword(deps, c.user, c.cookies.sid, c.body, c.ip); c.json(200, { ok: true }); }, { allowMustChange: true });
  // بلا جلسة يعيد user:null بحالة 200 (لا ضجيج 401 في المتصفح عند أول فتح)
  r.add('GET', '/api/health', (c) => { db.prepare('SELECT 1').get(); c.json(200, { ok: true }); }, { auth: false });   // فحص صحة للاستضافة
  r.add('GET', '/api/me', (c) => c.json(200, { user: c.user ? publicUser(db, c.user) : null, university: universityName(db, cfg), site: getSite(deps), limits: publicLimits(db), transcriptTemplate: getTranscriptTemplate(db) }), { auth: false });
  r.add('PUT', '/api/transcript-template', (c) => { if (!c.user.can('program:manage') && !c.user.can('request:decide')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); c.json(200, { transcriptTemplate: setTranscriptTemplate(deps, c.user, c.body?.template, c.ip) }); });

  // ===== WAF Console =====
  r.add('GET', '/api/admin/waf/stats', (c) => { need(c, 'settings:manage'); c.json(200, getWafStats()); });
  r.add('POST', '/api/admin/waf/unban', (c) => { need(c, 'settings:manage'); const { ip } = c.body; if (!ip) throw new HttpError(400, 'ip مطلوب.', 'bad_request'); unbanIp(ip); c.json(200, { ok: true, ip }); });

  r.add('GET', '/api/admin/general', (c) => { need(c, 'settings:manage'); c.json(200, listSettings(db)); });
  r.add('PUT', '/api/admin/general', (c) => { need(c, 'settings:manage'); c.json(200, saveSettings(deps, c.user, c.body, c.ip)); });
  r.add('POST', '/api/admin/general/reset', (c) => { need(c, 'settings:manage'); c.json(200, resetSettings(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/me/desk', async (c) => { if (c.user.role === 'student') throw new HttpError(403, 'خاص بالعاملين.', 'forbidden'); c.json(200, { desk: await deskSummary(deps, c.user) }); });
  r.add('GET', '/api/me/profile', (c) => { need(c, 'profile:read_own'); c.json(200, { profile: myProfile(deps, c.user) }); });

  r.add('PUT', '/api/me/profile', (c) => { need(c, 'profile:update_own'); c.json(200, { profile: updateOwnContact(deps, c.user, c.body, c.ip) }); });

  // ---- تطبيق الطالب: المواد والعلامات والأخبار والشكاوى ----
  r.add('GET', '/api/courses', (c) => {
    if (!['course:read_own', 'course:manage', 'grade:manage', 'grade:approve', 'grade:approve_own'].some((p) => c.user.can(p))) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listCourses(deps, c.user, c.query));
  });
  r.add('POST', '/api/courses', (c) => { need(c, 'course:manage'); c.json(201, createCourse(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/courses/:id', (c) => { need(c, 'course:manage'); c.json(200, updateCourse(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/courses/:id', (c) => { need(c, 'course:manage'); deleteCourse(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/courses/:id/toggle', (c) => { need(c, 'course:manage'); toggleCourse(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/grades', (c) => {                               // جدول العلامات الكامل (بحث/ترتيب/صفحات)
    if (!c.user.can('grade:manage') && !c.user.can('student:read')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listGradesTable(deps, c.query));
  });
  r.add('GET', '/api/me/grades', (c) => { need(c, 'grade:read_own'); c.json(200, myGrades(deps, c.user, c.query)); });
  r.add('GET', '/api/students/:id/grades', (c) => { need(c, 'student:read'); getStudent(deps, c.params.id); c.json(200, gradesFor(db, Number(c.params.id), null)); });
  r.add('POST', '/api/students/:id/grades', (c) => {
    need(c, 'grade:manage'); const out = enterGrade(deps, c.user, c.params.id, c.body, c.ip);
    if (!workflowOn(db)) notifyGrade(deps, Number(c.params.id), db.prepare('SELECT name FROM courses WHERE id = ?').get(Number(c.body?.courseId))?.name);
    c.json(200, out);
  });
  r.add('GET', '/api/search', async (c) => { if (!c.user || c.user.role === 'student') throw new HttpError(403, 'البحث الشامل للموظفين.', 'forbidden'); c.json(200, await globalSearch(deps, c.user, c.query?.q)); });
  r.add('GET', '/api/courses/:id/grade-sheet', (c) => { need(c, 'grade:manage'); c.json(200, gradeSheet(deps, c.params.id, c.query?.year)); });
  r.add('POST', '/api/courses/:id/grade-sheet', (c) => {
    need(c, 'grade:manage'); const out = saveGradeSheet(deps, c.user, c.params.id, c.body, c.ip);
    if (!workflowOn(db)) { const name = db.prepare('SELECT name FROM courses WHERE id = ?').get(Number(c.params.id))?.name; for (const id of out.savedIds) notifyGrade(deps, id, name); }
    c.json(200, { saved: out.saved, errors: out.errors });
  });
  r.add('DELETE', '/api/students/:id/grades/:gid',(c) => { need(c, 'grade:manage'); c.json(200, deleteGrade(deps, c.user, c.params.id, c.params.gid, c.ip, c.query.justification)); });
  // ---- مراحل اعتماد العلامات، جدول المحاضرات، السجل الموحّد ----
  r.add('GET', '/api/faculty/my-grades', (c) => { need(c, 'grade:approve_own'); c.json(200, myCourseGrades(deps, c.user)); });
  r.add('POST', '/api/grades/workflow', async (c) => {
    if (!c.user.can('grade:approve_own') && !c.user.can('grade:approve')) need(c, 'grade:manage');   // صلاحية المقرر نفسه تُفحص داخل transitionGrades
    const out = await deps.heavy.run('gradeWorkflow', c, [c.body, c.ip], { writes: true });
    for (const a of out.approvedNow) notifyGrade(deps, a.studentId, a.course);
    c.json(200, { updated: out.updated, skipped: out.skipped, stage: out.stage });
  });
  r.add('GET', '/api/grades/:id/history', (c) => { need(c, 'grade:manage'); c.json(200, { history: gradeHistory(db, c.params.id) }); });
  r.add('POST', '/api/grades/workflow-setting', (c) => { need(c, 'grade:approve'); c.json(200, setWorkflow(deps, c.user, !!c.body?.enabled, c.ip)); });
  r.add('GET', '/api/courses/:id/schedule', (c) => { need(c, 'course:manage'); c.json(200, { slots: getSlots(db, c.params.id), days: DAYS }); });
  r.add('PUT', '/api/courses/:id/schedule', (c) => { need(c, 'course:manage'); c.json(200, setSlots(deps, c.user, c.params.id, c.body?.slots, c.ip)); });
  r.add('POST', '/api/courses/:id/schedule/slots', (c) => { needAny(c, 'course:manage', 'attendance:manage'); c.json(201, addSlot(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('GET', '/api/me/timetable', (c) => { c.json(200, { slots: c.user.role === 'student' ? studentTimetable(db, c.user.id) : [] }); });
  r.add('GET', '/api/students/:id/schedule-conflicts', (c) => {
    if (!c.user.can('student:read') && c.params.id !== String(c.user.id)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, detectScheduleConflicts(db, c.params.id));
  });
  r.add('GET', '/api/students/:id/unified-record', (c) => { need(c, 'student:read'); c.json(200, getUnifiedStudentRecord(deps, c.params.id)); });
  r.add('GET', '/api/news', async (c) => c.json(200, { news: await listNews(deps) }));
  r.add('POST', '/api/news', (c) => { need(c, 'news:manage'); const out = createNews(deps, c.user, c.body, c.ip); notifyNews(deps, String(c.body?.title ?? 'خبر جديد')); c.json(201, out); });
  r.add('PUT', '/api/news/:id', (c) => { need(c, 'news:manage'); c.json(200, updateNews(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/news/:id', (c) => { need(c, 'news:manage'); deleteNews(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  // وسائط الأخبار: رفع مباشر (جسم خام، النوع من البايتات)، رابط، حذف، وبثّ الملف مع Range
  r.add('POST', '/api/news/:id/media', async (c) => { need(c, 'news:manage'); c.json(201, await addUpload(deps, c.user, c.params.id, c.body, c.query.caption, c.ip)); }, { upload: true, maxBody: 51 * 1024 * 1024 });
  r.add('POST', '/api/news/:id/links', (c) => { need(c, 'news:manage'); c.json(201, addLink(deps, c.user, c.params.id, c.body.url, c.body.caption, c.ip)); });
  r.add('DELETE', '/api/news/media/:id', (c) => { need(c, 'news:manage'); deleteMedia(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/media/:id', (c) => { streamMedia(deps, c.req, c.res, c.params.id, SEC); });
  r.add('POST', '/api/complaints', (c) => { need(c, 'complaint:create'); c.json(201, createComplaint(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/complaints', (c) => {
    if (!c.user.can('complaint:create') && !c.user.can('complaint:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listComplaints(deps, c.user, c.query));
  });
  r.add('DELETE', '/api/complaints/:id', (c) => { need(c, 'complaint:manage'); deleteComplaint(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/complaints/:id/respond', (c) => { need(c, 'complaint:manage'); const out = respondComplaint(deps, c.user, c.params.id, c.body, c.ip); notifyComplaint(deps, c.params.id); c.json(200, out); });

  // ---- تسجيل الطلاب (شؤون الطلاب) ----
  r.add('GET', '/api/registration/options', (c) => { need(c, 'student:register'); c.json(200, registrationOptions(db, c.user.can('program:manage'))); });
  r.add('POST', '/api/students', async (c) => { need(c, 'student:register'); c.json(201, await registerStudent(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/students', (c) => { needAny(c, 'student:read', 'student:lookup'); c.json(200, listStudents(deps, c.query, { user: c.user, lookupOnly: !c.user.can('student:read') })); });
  r.add('POST', '/api/attendance/scan', (c) => { need(c, 'attendance:manage'); c.json(200, hallScan(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/attendance', (c) => { need(c, 'attendance:manage'); c.json(200, listLogs(deps, c.query)); });
  r.add('GET', '/api/attendance/open', (c) => { need(c, 'attendance:manage'); c.json(200, { logs: openLogs(deps) }); });
  r.add('POST', '/api/attendance', (c) => { need(c, 'attendance:manage'); c.json(201, { log: hallAdd(deps, c.user, c.body, c.ip) }); });
  r.add('PUT', '/api/attendance/:id', (c) => { need(c, 'attendance:manage'); c.json(200, { log: hallUpdate(deps, c.user, c.params.id, c.body, c.ip) }); });
  r.add('DELETE', '/api/attendance/:id', (c) => { need(c, 'attendance:manage'); hallDelete(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/push/key', (c) => c.json(200, { key: vapidKeys(deps).pub, subscribed: subscriptionCount(db, c.user.id) }));
  r.add('POST', '/api/push/subscribe', (c) => c.json(200, pushSubscribe(deps, c.user, c.body)));
  r.add('POST', '/api/push/unsubscribe', (c) => c.json(200, pushUnsubscribe(deps, c.user, c.body?.endpoint)));
  r.add('POST', '/api/push/test', (c) => { notify(deps, [c.user.id], { title: 'تنبيه تجريبي', body: 'التنبيهات تعمل على هذا الجهاز.', url: '/', tag: 'test' }); c.json(200, { ok: true }); });
  r.add('GET', '/api/admin/backups', (c) => { need(c, 'backup:manage'); c.json(200, backupInfo(deps)); });
  r.add('POST', '/api/admin/backups', async (c) => { need(c, 'backup:manage'); c.json(201, { backup: await createBackup(deps, { reason: 'manual', actor: c.user, ip: c.ip }) }); });
  r.add('GET', '/api/admin/backups/:name', (c) => {
    need(c, 'backup:manage'); const f = backupPath(cfg, c.params.name);
    audit(db, c.user, 'تنزيل نسخة احتياطية', c.params.name, c.ip);
    // بثّ الملف بدل قراءته كاملاً في الذاكرة (قد تكبر النسخ مع المرفقات)
    const size = fs.statSync(f).size;
    sendStream(c.res, 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Content-Disposition': `attachment; filename="${c.params.name}"` }, fs.createReadStream(f));
  });
  r.add('POST', '/api/admin/backups/:name/verify', async (c) => { need(c, 'backup:manage'); c.json(200, await deps.heavy.run('verifyBackup', c, [c.params.name, c.ip], { writes: true })); });
  r.add('DELETE', '/api/admin/backups/:name', (c) => { need(c, 'backup:manage'); deleteBackup(deps, c.user, c.params.name, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/students-table', (c) => { need(c, 'student:read'); c.json(200, listStudentsTable(deps, c.query, { user: c.user })); });
  r.add('GET', '/api/students/:id/files', (c) => { need(c, 'student:read'); getStudent(deps, c.params.id); c.json(200, { files: listStudentFiles(db, c.params.id) }); });
  r.add('POST', '/api/students/:id/files', (c) => {
    if (!c.user.can('student:register') && !c.user.can('student:update')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(201, { file: addStudentFile(deps, c.user, c.params.id, c.query.kind, c.query.name, c.body, c.ip) });
  }, { raw: true, maxBody: 9 * 1024 * 1024 });
  r.add('GET', '/api/student-files/:fid', (c) => { streamStudentFile(deps, c.user, c.res, c.params.fid, SEC); });
  r.add('DELETE', '/api/student-files/:fid', (c) => {
    if (!c.user.can('student:register') && !c.user.can('student:update')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    deleteStudentFile(deps, c.user, c.params.fid, c.ip); c.json(200, { ok: true });
  });
  r.add('GET', '/api/students/:id', (c) => {
    need(c, 'student:read');
    const s = getStudent(deps, c.params.id);
    audit(db, c.user, 'عرض ملف طالب', s.studentNo, c.ip);   // الملف يحوي بيانات شخصية: القراءة نفسها تُدقَّق
    const ce = certFor(db, s.id), url = ce && `${publicBase(cfg)}/?verify=${ce.code}`;
    c.json(200, { student: s, certificate: ce ? { ...certSummary(ce), url, qrSvg: qrSvg(url) } : null });
  });
  r.add('GET', '/api/students/:id/main-info', (c) => { need(c, 'student:read'); c.json(200, studentFileView(deps, c.user, c.params.id, c.ip)); });
  r.add('PUT', '/api/students/:id/main-info', (c) => { need(c, 'student:update'); c.json(200, saveStudentFileMeta(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('PUT', '/api/students/:id', (c) => { need(c, 'student:update'); c.json(200, { student: updateStudent(deps, c.user, c.params.id, c.body, c.ip) }); });
  r.add('DELETE', '/api/students/:id', (c) => { need(c, 'student:delete'); deleteStudent(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/students/:id/reset-password', async (c) => { need(c, 'student:reset_password'); c.json(200, await resetStudentPassword(deps, c.user, c.params.id, c.ip)); });
  r.add('GET', '/api/programs', (c) => { if (!c.user.can('grade:approve_own')) need(c, 'student:read'); c.json(200, cacheGetOrSet(db, 'catalog', 'programs:list', () => ({ programs: listPrograms(db) }), 120_000)); });
  // ---- سجل نشاط البطاقة الجامعية الرقمية (NFC / Barcode Activity & Gate Pass Logs) ----
  r.add('GET', '/api/students/:id/card-activity', (c) => {
    need(c, 'student:read');
    const sid = Number(c.params.id);
    const limit = Number(c.query.limit) || 100;
    try {
      const rows = db.prepare('SELECT * FROM sa_card_activity_logs WHERE student_id = ? ORDER BY created_at DESC LIMIT ?').all(sid, limit);
      c.json(200, { logs: rows, count: rows.length, block: activeCardBlock(db, sid) });
    } catch {
      c.json(200, { logs: [], count: 0, block: null });
    }
  });
  r.add('POST', '/api/students/:id/card/block', (c) => { if (!c.user) throw new HttpError(401, 'سجّل الدخول أولاً.', 'unauthorized'); c.json(200, blockCard(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('POST', '/api/students/:id/card/unblock', (c) => { need(c, 'student:update'); c.json(200, unblockCard(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('POST', '/api/students/:id/card-activity', (c) => {
    if (!c.user.can('attendance:manage') && !c.user.can('student:update')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    const sid = Number(c.params.id);
    const b = c.body || {};
    const s = getStudent(deps, sid);
    const method = b.method === 'barcode' ? 'barcode' : 'nfc';
    const eventType = ['check_in', 'check_out', 'denied'].includes(b.eventType) ? b.eventType : null;
    const locName = String(b.locationName ?? '').trim().slice(0, 120);
    const locCode = String(b.locationCode ?? '').trim().slice(0, 40);
    if (!eventType || !locName || !locCode) throw new HttpError(400, 'نوع الحركة والموقع مطلوبان.', 'validation');
    const terminalId = String(b.terminalId ?? '').trim().slice(0, 40) || 'MANUAL';
    // البطاقة الموقوفة تُرفض مهما أرسل الجهاز، ويبقى أثر المحاولة في السجل
    const blocked = activeCardBlock(db, sid);
    const status = blocked || b.status === 'denied' ? 'denied' : 'granted';
    const reason = blocked ? `بطاقة موقوفة: ${blocked.reasonLabel}` : (b.reason || (status === 'granted' ? 'تصريح دخول نظامي ساري المفعول' : 'محاولة دخول غير مصرحة'));
    const now = Date.now();
    // بصمة للسجل نفسه، وليست توقيعاً من البطاقة ولا قيمة يرسلها العميل
    const pkiHash = 'sha256:' + crypto.createHash('sha256').update(`${sid}|${eventType}|${locCode}|${method}|${terminalId}|${status}|${now}`).digest('hex').slice(0, 32);
    try {
      db.prepare(`
        INSERT INTO sa_card_activity_logs 
        (student_id, student_no, student_name, event_type, location_name, location_code, method, terminal_id, status, reason, pki_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sid, s.studentNo, s.name, eventType, locName, locCode, method, terminalId, status, reason, pkiHash, now);
      audit(db, c.user, `تحقق بطاقة (${method})`, `${eventType} - ${locName} - ${s.studentNo}`, c.ip);
      c.json(201, { ok: true, log: { student_id: sid, student_no: s.studentNo, student_name: s.name, event_type: eventType, location_name: locName, location_code: locCode, method, terminal_id: terminalId, status, reason, pki_hash: pkiHash, created_at: now } });
    } catch (err) {
      log.error('card activity', err);
      c.json(500, { error: 'internal', message: 'خطأ داخلي في الخادم.' });
    }
  });
  // استيراد من Excel/CSV/SQL: commit=false فحص بلا كتابة، commit=true اعتماد
  // الاستيراد الجدولي: كل نوع يفرض صلاحيته داخل المحرك
  r.add('GET', '/api/import-engine/catalog', (c) => c.json(200, importCatalog(c.user)));
  r.add('GET', '/api/import-engine/batches', (c) => c.json(200, listBatches(deps, c.user)));
  r.add('POST', '/api/import-engine/batches/:id/undo', async (c) => c.json(200, await deps.heavy.run('undoBatch', c, [c.params.id, c.ip], { writes: true })));
  r.add('POST', '/api/import-engine/cancel', (c) => c.json(200, cancelImport(deps, c.user, c.body?.stagingToken)));
  r.add('POST', '/api/import-engine/:kind/check', async (c) => c.json(200, await deps.heavy.run('checkImport', c, [c.params.kind, c.body ?? {}, c.ip])), { maxBody: 15 * 1024 * 1024 });
  r.add('POST', '/api/import-engine/:kind/commit', async (c) => c.json(200, await deps.heavy.run('commitImport', c, [c.params.kind, c.body ?? {}, c.ip], { writes: true })));
  r.add('GET', '/api/import-engine/:kind/template', (c) => {
    const t = importTemplate(deps, c.user, c.params.kind, c.query.format === 'csv' ? 'csv' : 'xlsx');
    c.res.writeHead(200, { 'Content-Type': t.type, 'Content-Disposition': `attachment; filename="${t.filename}"`, 'Cache-Control': 'no-store' });
    c.res.end(t.body);
  });
  r.add('POST', '/api/import/:kind', async (c) => { const k = c.params.kind; need(c, IMPORT_PERM[k] ?? 'role:manage'); c.json(200, await deps.heavy.run('stagedImport', c, [k, c.body ?? {}, c.ip], { writes: true })); }, { maxBody: 15 * 1024 * 1024 });
  const XL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  // تصدير البطاقات دفعة واحدة وجدول استلامها
  r.add('GET', '/api/cards/options', (c) => { need(c, 'student:read'); c.json(200, cardOptions(db)); });
  r.add('GET', '/api/cards/students', (c) => { need(c, 'student:read'); c.json(200, cardStudents(deps, c.query)); });
  r.add('POST', '/api/cards/certificates', async (c) => { need(c, 'student:read'); need(c, 'student:reset_password'); c.json(200, await cardCertificates(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/cards/batches', (c) => { need(c, 'student:read'); c.json(200, { batches: listCardBatches(deps) }); });
  r.add('POST', '/api/cards/batches', async (c) => { need(c, 'student:update'); c.json(201, await deps.heavy.run('createCardBatch', c, [c.body, c.ip], { writes: true })); });
  r.add('GET', '/api/cards/batches/:id', (c) => { need(c, 'student:read'); c.json(200, cardBatchDetail(deps, c.params.id)); });
  r.add('GET', '/api/cards/batches/:id/export.xlsx', async (c) => { need(c, 'student:read'); const file = await deps.heavy.run('cardBatchXlsx', c, [c.params.id]); sendRaw(c.res, 200, { 'Content-Type': XL, 'Content-Disposition': 'attachment; filename="card-handover.xlsx"' }, file); });
  r.add('POST', '/api/cards/handovers/:id/receive', (c) => { need(c, 'student:update'); c.json(200, markCardReceived(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('POST', '/api/cards/handovers/:id/undo', (c) => { need(c, 'student:update'); c.json(200, undoCardReceived(deps, c.user, c.params.id, c.ip)); });
  r.add('GET', '/api/services/:code/template.xlsx', (c) => { sendRaw(c.res, 200, { 'Content-Type': XL, 'Content-Disposition': `attachment; filename="form-${String(c.params.code).replace(/[^a-z0-9_]/gi, '')}.xlsx"` }, buildTemplate(db, c.params.code)); });
  r.add('GET', '/api/requests/export.xlsx', async (c) => { const file = await deps.heavy.run('exportRequests', c, [{ ...c.query, ip: c.ip }]); sendRaw(c.res, 200, { 'Content-Type': XL, 'Content-Disposition': 'attachment; filename="requests.xlsx"' }, file); });
  r.add('POST', '/api/services/:code/import', async (c) => { need(c, 'request:import'); c.json(200, await deps.heavy.run('stagedRequestsImport', c, [c.params.code, c.body ?? {}, c.ip], { writes: true })); }, { maxBody: 8 * 1024 * 1024 });
  // ---- حضور الموظفين والإجازات ----
  r.add('POST', '/api/hr/attendance/punch', (c) => { need(c, 'staffatt:self'); c.json(200, punch(deps, c.user)); });
  r.add('GET', '/api/hr/settings', (c) => { need(c, 'staffatt:manage'); c.json(200, { settings: getHrSettings(db) }); });
  r.add('PUT', '/api/hr/settings', (c) => { need(c, 'staffatt:manage'); c.json(200, saveHrSettings(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/hr/attendance/me', (c) => { need(c, 'staffatt:self'); c.json(200, myAttendance(deps, c.user)); });
  r.add('GET', '/api/hr/attendance/export.xlsx', (c) => { need(c, 'staffatt:manage'); sendRaw(c.res, 200, { 'Content-Type': XL, 'Content-Disposition': 'attachment; filename="staff-attendance.xlsx"' }, exportMonth(deps, c.user, c.query, c.ip)); });
  r.add('GET', '/api/hr/attendance', (c) => { need(c, 'staffatt:manage'); c.json(200, dayReport(deps, c.query)); });
  r.add('GET', '/api/hr/leaves', (c) => { need(c, 'staffatt:manage'); c.json(200, listBalances(deps, c.query)); });
  r.add('PUT', '/api/hr/leave/entitlement', (c) => { need(c, 'staffatt:manage'); c.json(200, setEntitlement(deps, c.user, c.body, c.ip)); });
  // ---- المراسلات الداخلية ----
  const corr = (c) => { if (!c.user.can('corr:use') && !c.user.can('corr:read_all')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
  r.add('GET', '/api/corr/people', (c) => { need(c, 'corr:use'); c.json(200, { people: listPeople(deps, c.user) }); });
  r.add('GET', '/api/corr/templates', (c) => { need(c, 'corr:use'); c.json(200, { templates: listTemplates(deps, c.user, c.query) }); });
  r.add('POST', '/api/corr/templates', (c) => { need(c, 'corr:templates'); c.json(201, createTemplate(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/corr/templates/:code', (c) => { need(c, 'corr:templates'); c.json(200, updateTemplate(deps, c.user, c.params.code, c.body, c.ip)); });
  r.add('DELETE', '/api/corr/templates/:code', (c) => { need(c, 'corr:templates'); c.json(200, deleteTemplate(deps, c.user, c.params.code, c.ip)); });
  r.add('GET', '/api/corr/notifications', (c) => { corr(c); c.json(200, listNotifs(deps, c.user)); });
  r.add('POST', '/api/corr/notifications/read', (c) => { corr(c); c.json(200, readNotifs(deps, c.user, c.body)); });
  r.add('GET', '/api/corr/files/:id', async (c) => { corr(c); const a = await readCorrFile(deps, c.user, c.params.id); sendRaw(c.res, 200, { 'Content-Type': a.mime, 'Content-Disposition': `${c.query.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}` }, a.buf); });
  r.add('GET', '/api/corr', async (c) => { corr(c); c.json(200, { docs: await listDocs(deps, c.user, c.query) }); });
  r.add('POST', '/api/corr', async (c) => { need(c, 'corr:use'); const staged = await stageFiles(deps.cfg, c.body?.files); try { c.json(201, { doc: createDoc(deps, c.user, c.body, c.ip) }); } finally { await removeStaged(staged); } }, { maxBody: 11 * 1024 * 1024 });
  r.add('GET', '/api/corr/:id', (c) => { corr(c); c.json(200, { doc: getDoc(deps, c.user, c.params.id) }); });
  r.add('PUT', '/api/corr/:id', async (c) => { need(c, 'corr:use'); const staged = await stageFiles(deps.cfg, c.body?.files); try { c.json(200, { doc: updateDoc(deps, c.user, c.params.id, c.body, c.ip) }); } finally { await removeStaged(staged); } }, { maxBody: 11 * 1024 * 1024 });
  r.add('GET', '/api/corr/:id/pdf', (c) => { corr(c); const o = corrPdf(deps, c.user, c.params.id); sendRaw(c.res, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${o.filename}"` }, o.pdf); });
  r.add('POST', '/api/corr/:id/send', (c) => { need(c, 'corr:use'); c.json(200, { doc: sendDoc(deps, c.user, c.params.id, c.ip) }); });
  r.add('POST', '/api/corr/:id/approve', (c) => { need(c, 'corr:use'); c.json(200, { doc: decideDoc(deps, c.user, c.params.id, 'approve', c.body?.note, c.ip) }); });
  r.add('POST', '/api/corr/:id/reject', (c) => { need(c, 'corr:use'); c.json(200, { doc: decideDoc(deps, c.user, c.params.id, 'reject', c.body?.note, c.ip) }); });
  r.add('POST', '/api/corr/:id/comment', (c) => { need(c, 'corr:use'); c.json(200, { doc: commentDoc(deps, c.user, c.params.id, c.body?.text, c.ip) }); });
  r.add('POST', '/api/corr/:id/cancel', (c) => { need(c, 'corr:use'); c.json(200, { doc: cancelDoc(deps, c.user, c.params.id, c.ip) }); });
  r.add('GET', '/api/faculties', (c) => { need(c, 'student:read'); c.json(200, cacheGetOrSet(db, 'catalog', 'faculties:list', () => ({ faculties: listFaculties(db) }), 120_000)); });
  r.add('POST', '/api/admin/faculties', (c) => { need(c, 'program:manage'); c.json(201, addFaculty(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/faculties/:id', (c) => { need(c, 'program:manage'); updateFaculty(deps, c.user, c.params.id, c.body, c.ip); c.json(200, { ok: true }); });
  r.add('DELETE', '/api/admin/faculties/:id', (c) => { need(c, 'program:manage'); deleteFaculty(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/faculties/:id/toggle', (c) => { need(c, 'program:manage'); toggleFaculty(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/programs', (c) => { need(c, 'program:manage'); c.json(201, addProgram(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/programs/:id', (c) => { need(c, 'program:manage'); updateProgram(deps, c.user, c.params.id, c.body, c.ip); c.json(200, { ok: true }); });
  r.add('DELETE', '/api/admin/programs/:id', (c) => { need(c, 'program:manage'); deleteProgram(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/programs/:id/toggle', (c) => { need(c, 'program:manage'); toggleProgram(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });

  // ---- أعضاء هيئة التدريس (وحدة 5.6): السجل والعبء التدريسي ----
  r.add('GET', '/api/faculty', (c) => {
    if (!c.user.can('faculty:manage') && !c.user.can('course:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listFaculty(deps, c.query));
  });
  r.add('POST', '/api/faculty', (c) => { need(c, 'faculty:manage'); c.json(201, createFaculty(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/faculty/:id', (c) => { need(c, 'faculty:manage'); c.json(200, updateMember(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('POST', '/api/faculty/:id/toggle', (c) => { need(c, 'faculty:manage'); c.json(200, toggleMember(deps, c.user, c.params.id, !!c.body.enabled, c.ip)); });
  r.add('DELETE', '/api/faculty/:id', (c) => { need(c, 'faculty:manage'); deleteMember(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });

  // ---- الموارد البشرية والرواتب (وحدة 5.7) ----

  // ---- الخدمات والطلبات ----
  r.add('GET', '/api/services', (c) => {
    const kind = c.user ? requesterKind(c.user) : 'student';
    const includeAll = c.query.all === '1' && c.user?.can('request:import');
    const snap = getServicesSnapshot(db);
    const rows = snap.list.filter((s) => s.enabled && (includeAll || s.audience === 'both' || s.audience === kind));
    c.json(200, {
      services: rows.map((s) => {
        const u = s.unit_code ? getCachedUnitByCode(db, s.unit_code) : null;
        return {
          code: s.code,
          label: s.label,
          description: s.description,
          slaHours: s.sla_hours,
          requiresAttachment: !!s.requires_attachment,
          fields: expandFields(db, c.user?.id ?? 0, s.fields_json),
          unit: u ? { code: s.unit_code, name: u.name } : null,
          audience: s.audience,
          category: s.category,
          instructions: s.instructions,
          attachments: JSON.parse(s.attachments_json),
          maxAttachments: s.max_attachments,
        };
      }),
    });
  });
  r.add('POST', '/api/requests', async (c) => { need(c, requesterKind(c.user) === 'student' ? 'request:create' : 'request:create_internal'); const staged = await stageFiles(deps.cfg, c.body?.attachments ?? c.body?.attachment); try { c.json(201, { request: withLock(db, `newreq:${c.user.id}:${c.body?.service}`, () => createRequest(deps, c.user, c.body, c.ip)) }); } finally { await removeStaged(staged); } }, { maxBody: 11 * 1024 * 1024 });
  r.add('GET', '/api/requests', async (c) => {
    if (!c.user.can('request:read_own') && !c.user.can('request:read_all') && !c.user.can('request:read_unit') && !c.user.can('request:create_internal')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, { requests: await listRequests(deps, c.user, c.query) });
  });
  r.add('GET', '/api/requests/:id', (c) => c.json(200, { request: getRequest(deps, c.user, c.params.id) }));
  r.add('POST', '/api/requests/:id/approve', (c) => { need(c, 'request:decide'); const out = decide(deps, c.user, c.params.id, 'approve', null, c.ip); notifyRequest(deps, c.params.id); c.json(200, { request: out }); });
  r.add('POST', '/api/requests/:id/reject', (c) => { need(c, 'request:decide'); const out = decide(deps, c.user, c.params.id, 'reject', c.body.reason, c.ip); notifyRequest(deps, c.params.id); c.json(200, { request: out }); });
  r.add('POST', '/api/requests/:id/forward', (c) => { need(c, 'request:forward'); c.json(200, { request: forwardRequest(deps, c.user, c.params.id, c.body, c.ip) }); });
  // الوحدات التي يستطيع المستخدم الإحالة إليها (حسب ارتباط وحدته)
  r.add('GET', '/api/units/targets', (c) => {
    need(c, 'request:forward');
    const targets = c.user.unit_id ? linkedTargets(db, c.user.unit_id)
      : (c.user.role === 'admin' && !c.user.role_key ? getOrgUnitsSnapshot(db).units.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name })) : []);
    c.json(200, { targets });
  });
  r.add('GET', '/api/attachments/:id', async (c) => {
    const a = await readAttachment(deps, c.user, c.params.id);
    sendRaw(c.res, 200, { 'Content-Type': a.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}` }, a.buf);
  });
  // ---- لوحة الإحصاءات والتصدير ----
  r.add('GET', '/api/analytics', async (c) => { need(c, 'stats:read'); c.json(200, await deps.heavy.run('analytics', c, [c.query])); });
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  r.add('GET', '/api/analytics/export.xlsx', async (c) => {
    need(c, 'stats:read');
    const file = await deps.heavy.run('analyticsXlsx', c, [c.query]);
    sendRaw(c.res, 200, { 'Content-Type': XLSX_MIME, 'Content-Disposition': 'attachment; filename="statistics-report.xlsx"' }, file);
  });
  r.add('POST', '/api/analytics/export.docx', async (c) => {
    need(c, 'stats:read');
    const file = await deps.heavy.run('analyticsDocx', c, [c.body]);
    sendRaw(c.res, 200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="statistics-report.docx"' }, file);
  }, { maxBody: 14 * 1024 * 1024 });
  r.add('GET', '/api/stats', async (c) => { need(c, 'stats:read'); c.json(200, { stats: await stats(deps) }); });

  // ---- تصدير البيانات (طلاب، مواد، علامات...) ----
  r.add('GET', '/api/export/options', (c) => { need(c, 'data:export'); c.json(200, exportOptions(db)); });
  r.add('GET', '/api/export/preview', async (c) => { need(c, 'data:export'); c.json(200, await deps.heavy.run('exportPreview', c, [String(c.query.dataset ?? ''), c.query])); });
  r.add('GET', '/api/export/file', async (c) => {
    need(c, 'data:export');
    const out = await deps.heavy.run('exportFile', c, [{ dataset: String(c.query.dataset ?? ''), format: String(c.query.format ?? ''), layout: c.query.layout }, c.query]);
    audit(db, c.user, `تصدير بيانات (${c.query.dataset}، ${c.query.format}، ${out.total} صفاً)`, out.name.slice(0, 80), c.ip);
    sendRaw(c.res, 200, { 'Content-Type': out.mime, 'Content-Disposition': `attachment; filename="${out.name}"` }, out.buf);
  });

  // ---- الوثائق والتحقق ----
  r.add('GET', '/api/documents/:code', (c) => c.json(200, { document: getDocument(deps, c.user, c.params.code) }));
  r.add('GET', '/api/documents/:code/pdf', (c) => {
    const { pdf, filename } = documentPdf(deps, c.user, c.params.code, c.query.template);       // يتحقق من حق الوصول ثم يوقّع الملف
    audit(db, c.user, 'تنزيل وثيقة بصيغة PDF', c.params.code.slice(0, 20), c.ip);
    sendRaw(c.res, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` }, pdf);
  });
  r.add('GET', '/api/documents/:code/qr.svg', (c) => {
    getDocument(deps, c.user, c.params.code);            // يتحقق من حق الوصول
    const base = cfg.publicUrl ?? `http://${c.req.headers.host}`;
    sendRaw(c.res, 200, { 'Content-Type': 'image/svg+xml' }, qrSvg(`${base}/?verify=${c.params.code.toUpperCase()}`));
  });
  r.add('GET', '/api/verify/:code', (c) => {
    if (!limiter.check(`verify:${c.ip}`, 30, 60_000)) throw new HttpError(429, 'محاولات تحقق كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
    const res = verifyEnrollment(deps, c.params.code) ?? verifyPublic(deps, c.params.code);      // SC-… شهادة تسجيل، UV-… وثيقة طلب
    audit(db, { label: 'جهة خارجية', role: 'public' }, `تحقق من وثيقة: ${res.valid ? 'صحيحة' : res.reason}`, c.params.code.slice(0, 20), c.ip);
    c.json(200, res);
  }, { auth: false });
  // التحقق ببصمة الملف: يحسب المتصفح SHA-256 للملف ولا يرفعه
  r.add('GET', '/api/verify-hash/:sha', (c) => {
    if (!limiter.check(`verify:${c.ip}`, 30, 60_000)) throw new HttpError(429, 'محاولات تحقق كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
    let res = verifyByHash(deps, c.params.sha);
    if (res.reason === 'not_found') {                      // ملف PDF لوثيقة طلب؟
      const h = db.prepare('SELECT code FROM document_pdfs WHERE pdf_sha256 = ?').get(String(c.params.sha).trim().toLowerCase());
      if (h) res = verifyPublic(deps, h.code);
    }
    audit(db, { label: 'جهة خارجية', role: 'public' }, `تحقق ببصمة ملف: ${res.valid ? 'صحيحة' : res.reason}`, String(c.params.sha).slice(0, 16), c.ip);
    c.json(200, res);
  }, { auth: false });
  // شهادة التسجيل الموقَّعة: تُصدَر عند الطلب إن لم تكن قد صدرت بعد (مثلاً طلاب قدامى)
  const sendCert = async (c, studentId, studentNo) => {
    const activeHold = db.prepare('SELECT hold_type, note FROM student_holds WHERE student_id = ? AND cleared_at IS NULL AND (active IS NULL OR active = 1) LIMIT 1').get(Number(studentId));
    if (activeHold) {
      throw new HttpError(403, `لا يمكن إصدار أو تنزيل شهادة التسجيل لوجود إيقاف أو ذمة فعالة على الطالب (${decryptField(cfg, activeHold.note) || activeHold.hold_type || 'مانع فعال'}).`, 'student_hold_active');
    }
    const prof = db.prepare('SELECT status FROM student_profiles WHERE user_id = ?').get(Number(studentId));
    if (prof && ['withdrawn', 'suspended', 'dismissed'].includes(prof.status)) {
      throw new HttpError(403, `لا يمكن إصدار شهادة قيد لطالب غير مقيّد حالياً (الحالة: ${prof.status}).`, 'student_inactive_status');
    }
    const row = await issueEnrollmentCertificate(deps, studentId);
    audit(db, c.user, 'تنزيل شهادة تسجيل موقَّعة', studentNo, c.ip);
    sendRaw(c.res, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="enrollment-${studentNo}.pdf"` }, readCertPdf(cfg, row));
  };
  r.add('GET', '/api/me/certificate', (c) => { need(c, 'profile:read_own'); c.json(200, { certificate: certSummary(certFor(db, c.user.id)) }); });
  r.add('GET', '/api/me/certificate.pdf', async (c) => { need(c, 'profile:read_own'); await sendCert(c, c.user.id, c.user.student_no); });
  r.add('GET', '/api/students/:id/certificate.pdf', async (c) => {
    need(c, 'student:read'); const s = getStudent(deps, c.params.id); await sendCert(c, s.id, s.studentNo);
  });

  // ---- التدقيق ----
  r.add('GET', '/api/audit', (c) => {
    need(c, 'audit:read');
    const limit = Math.min(Number(c.query.limit) || 50, 500);
    c.json(200, { entries: db.prepare('SELECT id, at, actor_label AS actor, role, action, ref, ip FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) });
  });
  r.add('GET', '/api/admin/logs', (c) => { need(c, 'audit:read'); c.json(200, { entries: recentLogs({ level: c.query.level, limit: c.query.limit }) }); });
  r.add('GET', '/api/audit/verify', async (c) => { need(c, 'audit:read'); c.json(200, await deps.heavy.run('verifyAudit', c)); });

  // ---- الإدارة ----
  r.add('GET', '/api/admin/users', (c) => { need(c, 'user:manage'); c.json(200, { users: listStaff(db) }); });
  r.add('GET', '/api/admin/users/:id/access', (c) => { need(c, 'user:manage'); c.json(200, { user: staffDetail(db, c.params.id) }); });
  r.add('POST', '/api/admin/users', async (c) => { need(c, 'user:manage'); c.json(201, await createUser(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/users/:id', (c) => { need(c, 'user:manage'); c.json(200, updateUser(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/admin/users/:id', (c) => { need(c, 'user:manage'); c.json(200, deleteUser(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/admin/users/:id/active', (c) => { need(c, 'user:manage'); c.json(200, setUserActive(deps, c.user, c.params.id, !!c.body.active, c.ip)); });
  r.add('POST', '/api/admin/users/:id/reset-password', async (c) => { need(c, 'user:manage'); c.json(200, await resetUserPassword(deps, c.user, c.params.id, c.ip)); });

  // ---- الأدوار والوحدات وروابطها ----
  r.add('GET', '/api/admin/access', (c) => {
    if (!c.user.can('user:manage') && !c.user.can('role:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, { ...overview(db), users: listStaffLight(db), canManageRoles: c.user.can('role:manage'), canManageUsers: c.user.can('user:manage') });
  });
  r.add('GET', '/api/admin/access/matrix.xlsx', (c) => {
    if (!c.user.can('user:manage') && !c.user.can('role:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    sendRaw(c.res, 200, { 'Content-Type': XL, 'Content-Disposition': 'attachment; filename="permissions-matrix.xlsx"' }, matrixXlsx(db));
  });
  r.add('POST', '/api/admin/roles', (c) => { need(c, 'role:manage'); c.json(201, createRole(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/roles/:key', (c) => { need(c, 'role:manage'); c.json(200, updateRole(deps, c.user, c.params.key, c.body, c.ip)); });
  r.add('DELETE', '/api/admin/roles/:key', (c) => { need(c, 'role:manage'); c.json(200, deleteRole(deps, c.user, c.params.key, c.ip)); });
  r.add('POST', '/api/admin/units', (c) => { need(c, 'role:manage'); c.json(201, createUnit(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/units/:id', (c) => { need(c, 'role:manage'); c.json(200, updateUnit(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/admin/units/:id', (c) => { need(c, 'role:manage'); c.json(200, deleteUnit(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/admin/links', (c) => { need(c, 'role:manage'); c.json(201, createLink(deps, c.user, c.body, c.ip)); });
  r.add('DELETE', '/api/admin/links/:id', (c) => { need(c, 'role:manage'); c.json(200, deleteLink(deps, c.user, c.params.id, c.ip)); });
  r.add('GET', '/api/admin/holds', (c) => {
    need(c, 'holds:manage');
    const holds = db.prepare(`SELECT h.id, h.hold_type AS holdType, h.note, h.active, h.created_at AS createdAt, u.display_name AS student, u.student_no AS studentNo
                                     FROM student_holds h JOIN users u ON u.id = h.student_id ORDER BY h.id DESC LIMIT 200`).all()
      .map((h) => ({ ...h, note: decryptField(cfg, h.note) }));
    c.json(200, { holds });
  });
  r.add('POST', '/api/admin/holds', (c) => {
    need(c, 'holds:manage');
    const s = db.prepare("SELECT id FROM users WHERE student_no = ? COLLATE NOCASE AND role = 'student'").get(String(c.body.studentNo ?? '').trim());
    if (!s) throw new HttpError(404, 'لا يوجد طالب بهذا الرقم الجامعي.', 'not_found');
    if (!['financial', 'disciplinary', 'library'].includes(c.body.holdType)) throw new HttpError(400, 'نوع الذمة غير صالح.', 'validation');
    const note = String(c.body.note ?? '').slice(0, 200);
    // ملاحظة المانع الانضباطي نص شخصي حساس فتُحفظ مشفَّرة؛ غيرها (مالية أو مكتبة) يبقى صريحاً كما يحتاجه الاستيراد الجماعي
    const res = db.prepare('INSERT INTO student_holds (student_id, hold_type, note, created_by, created_at) VALUES (?,?,?,?,?)')
      .run(s.id, c.body.holdType, c.body.holdType === 'disciplinary' ? encryptField(cfg, note) : note, c.user.id, Date.now());
    audit(db, c.user, `تسجيل ذمة (${c.body.holdType})`, c.body.studentNo, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });
  r.add('PUT', '/api/admin/holds/:id', (c) => { need(c, 'holds:manage'); updateHold(deps, c.user, c.params.id, c.body, c.ip); c.json(200, { ok: true }); });
  r.add('DELETE', '/api/admin/holds/:id', (c) => { need(c, 'holds:manage'); deleteHold(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/holds/:id/clear', (c) => {
    need(c, 'holds:manage');
    const res = db.prepare('UPDATE student_holds SET active = 0, cleared_at = ? WHERE id = ? AND active = 1').run(Date.now(), Number(c.params.id));
    if (!res.changes) throw new HttpError(404, 'الذمة غير موجودة أو مسددة مسبقاً.', 'not_found');
    audit(db, c.user, 'تسوية ذمة', c.params.id, c.ip);
    c.json(200, { ok: true });
  });
  r.add('GET', '/api/admin/rules/kinds', (c) => { need(c, 'rules:manage'); c.json(200, { kinds: RULE_KINDS }); });
  r.add('POST', '/api/admin/rules', (c) => { need(c, 'rules:manage'); c.json(201, createRule(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/admin/rules', (c) => {
    need(c, 'rules:manage');
    c.json(200, { rules: db.prepare('SELECT id, service_code AS service, kind, params_json AS params, message, enabled FROM rules ORDER BY id').all() });
  });
  r.add('POST', '/api/admin/rules/:id/toggle', (c) => {
    need(c, 'rules:manage');
    const res = db.prepare('UPDATE rules SET enabled = ? WHERE id = ?').run(c.body.enabled ? 1 : 0, Number(c.params.id));
    if (!res.changes) throw new HttpError(404, 'القاعدة غير موجودة.', 'not_found');
    audit(db, c.user, `${c.body.enabled ? 'تفعيل' : 'تعطيل'} قاعدة`, c.params.id, c.ip);
    c.json(200, { ok: true });
  });
  // محرر الخدمات وهوية الموقع (كانا شاشتين غير مربوطتين)
  r.add('GET', '/api/admin/services', (c) => { need(c, 'rules:manage'); c.json(200, { services: listServices(deps), units: db.prepare('SELECT code, name FROM org_units WHERE active = 1 ORDER BY id').all() }); });
  r.add('POST', '/api/admin/services', (c) => { need(c, 'rules:manage'); c.json(200, createService(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/services/:code', (c) => { need(c, 'rules:manage'); c.json(200, updateService(deps, c.user, c.params.code, c.body, c.ip)); });
  r.add('GET', '/api/admin/settings', (c) => { need(c, 'rules:manage'); c.json(200, { site: getSite(deps) }); });
  r.add('PUT', '/api/admin/settings', (c) => { need(c, 'rules:manage'); c.json(200, { site: saveSite(deps, c.user, c.body, c.ip) }); });
  r.add('PUT', '/api/admin/rules/:id', (c) => { need(c, 'rules:manage'); updateRule(deps, c.user, c.params.id, c.body, c.ip); c.json(200, { ok: true }); });
  r.add('DELETE', '/api/admin/rules/:id', (c) => { need(c, 'rules:manage'); deleteRule(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });

  // وحدة المالية والمحاسبة
  await registerFinance(r, deps, {});
  // وحدة المشتريات والمخازن والأصول
  await registerProcurement(r, deps);
  // وحدات الإصدار 12 الشامل (5.12-5.15، توسعات 5.5-5.8، البنية التحتية، والذكاء الاصطناعي)
  await registerV12Modules(r, deps);
  // منظومة شؤون الموظفين المتكاملة (HR Integrated System)
  registerHrIntegratedRoutes(r, deps);
  // حزمة التطوير المؤسسي الشاملة (Enterprise Suite - 15 Features)
  registerEnterpriseSuiteRoutes(r, deps);
  // منظومة شؤون الطلاب المتكاملة المطورة (Student Affairs Suite: 1, 2, 3, 5, 6)
  registerStudentAffairsSuiteRoutes(r, deps);
  registerStudentRegulationRoutes(r, deps);
  registerCouncilRoutes(r, deps);
  registerTeachingRoutes(r, deps);
  registerRecruitmentRoutes(r, deps);
  registerFacilitiesRoutes(r, deps);
  registerGradingRoutes(r, deps);
  registerSecurityCenterRoutes(r, deps);
  registerConsentRoutes(r, deps);
  registerWarehouseRoutes(r, deps);
  registerContainmentRoutes(r, deps);
  registerWalletRoutes(r, deps);
  r.add('GET', '/api/privacy/classification', (c) => {
    if (!(c.user.role === 'admin' || c.user.can('audit:read'))) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, { items: DATA_CLASSIFICATION, sensitivity: SENSITIVITY });
  });
  registerQuotationRoutes(r, deps);

  // ---- محرك الأداء الفائق والضغط العالي (10,000+ مستخدم متزامن + 10+ مراسلات/إضافات مالية بالثانية) ----
  r.add('GET', '/api/v12/high-concurrency/telemetry', (c) => {
    needAny(c, 'audit:read', 'devops:manage', 'settings:manage', 'backup:manage');
    const dbStats = getDbPerfStats(db);
    const sessionStats = getSessionCacheStats();
    const httpStats = getHttpTelemetry();
    const cacheTelemetry = getCacheTelemetry(db);
    c.json(200, {
      ok: true,
      database: {
        indexes: Number(db.prepare("SELECT COUNT(*) AS c FROM pg_indexes WHERE schemaname = 'public'").get().c),
        openConnections: Number(db.prepare('SELECT COUNT(*) AS c FROM pg_stat_activity WHERE datname = current_database()').get().c),
        poolMax: DB_POOL_MAX,
      },
      dbStats,
      sessionStats,
      httpStats,
      cacheTelemetry,
      slowQueries: slowestQueries(20),
      slowRoutes: slowestRoutes(20),
      pgStatements: readPgStatements(db),
      uptimeSec: Math.round(process.uptime()),
      timestamp: Date.now(),
    });
  });

  // الاختبار يرسل طلبات حقيقية تُحسب على حد المعدل للعنوان المحلي، فلا يُكرَّر قبل انقضاء نافذة الحد
  let lastBenchmarkAt = 0;
  r.add('POST', '/api/v12/high-concurrency/benchmark', async (c) => {
    needAny(c, 'devops:manage', 'settings:manage');
    const wait = 90_000 - (Date.now() - lastBenchmarkAt);
    if (wait > 0) throw new HttpError(429, `شغّلت الاختبار قبل قليل؛ أعد المحاولة بعد ${Math.ceil(wait / 1000)} ثانية.`, 'rate_limited');
    lastBenchmarkAt = Date.now();
    const benchmark = await deps.heavy.run('liveBenchmark', c, [{ port: c.req.socket.localPort, token: c.cookies.sid }]);
    c.json(200, { ok: true, benchmark });
  });

  return r;
}
