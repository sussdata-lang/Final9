// خيط العمليات الثقيلة: يشغّل دوال الخدمات نفسها باتصال مستقل. انظر heavy.js.
import { parentPort, workerData } from 'node:worker_threads';
import { connectDb } from './db.js';
import { flushAllCaches } from './cache.js';
import { sessionUser, invalidateSessionCache } from './services/auth.js';
import { checkImport, commitImport, undoBatch } from './services/import_engine.js';
import { stagedImport, stagedRequestsImport } from './services/import_staged.js';
import { suiteOverviewFor, executeAdmissionsSorting } from './services/student_affairs_suite.js';
import { createCardBatch, cardBatchXlsx } from './services/cards.js';
import { transitionGrades } from './services/workflow.js';
import { verifyBackup } from './services/backup.js';
import { verifyAuditChain, setAuditKey } from './audit.js';
import { analytics, filterOptions } from './services/analytics.js';
import { buildReportXlsx, buildReportDocx } from './services/reports.js';
import { exportRequests } from './services/requestsxl.js';
import { preview as exportPreview, renderExport } from './services/dataexport.js';
import { runLiveBenchmark } from './services/live_benchmark.js';

const db = connectDb(workerData.pgUrl);
const deps = { db, cfg: workerData.cfg };
setAuditKey(workerData.cfg?.auditKey);

const JOBS = {
  checkImport: (actor, ...a) => checkImport(deps, actor, ...a),
  commitImport: (actor, ...a) => commitImport(deps, actor, ...a),
  undoBatch: (actor, ...a) => undoBatch(deps, actor, ...a),
  stagedImport: (actor, ...a) => stagedImport(deps, actor, ...a),
  stagedRequestsImport: (actor, ...a) => stagedRequestsImport(deps, actor, ...a),
  suiteOverview: (actor, q) => suiteOverviewFor(deps, actor, q),
  analytics: (_actor, q) => ({ options: filterOptions(db), ...analytics(db, q, new Date()) }),
  analyticsXlsx: (_actor, q) => buildReportXlsx(db, q),
  exportRequests: (actor, q) => exportRequests(deps, actor, q),
  exportPreview: (_actor, dataset, q) => exportPreview(db, dataset, q),
  exportFile: (_actor, opts, q) => renderExport(db, opts, q),
  analyticsDocx: (_actor, body) => buildReportDocx(db, body),
  admissionsSort: (actor, ip) => executeAdmissionsSorting(deps, actor, ip),
  createCardBatch: (actor, body, ip) => createCardBatch(deps, actor, body, ip),
  cardBatchXlsx: (_actor, id) => cardBatchXlsx(deps, id),
  gradeWorkflow: (actor, body, ip) => transitionGrades(deps, actor, body, ip),
  verifyBackup: (actor, name, ip) => verifyBackup(deps, actor, name, ip),
  verifyAudit: () => verifyAuditChain(db),
  liveBenchmark: (actor, opts) => runLiveBenchmark(deps, actor, opts),
};

parentPort.on('message', async ({ id, name, token, args }) => {
  db.auditSink = [];
  try {
    // ذاكرة هذا الخيط لا تعرف ما غيّره الخيط الرئيسي من إعدادات وأدوار
    flushAllCaches(db); invalidateSessionCache();
    const actor = token ? sessionUser(db, token) : null;
    const result = await JOBS[name](actor, ...args);
    parentPort.postMessage({ id, result, audits: db.auditSink });
  } catch (e) {
    try { db.prepare('ROLLBACK').run(); } catch { /* لا معاملة مفتوحة */ }
    // ما كُتب قبل فشل المعاملة أُلغي، فلا تُسجَّل بنود تدقيقه
    parentPort.postMessage({ id, audits: [], error: { status: e.status, code: e.code, field: e.field, message: e.status ? e.message : String(e.message).split('\n')[0] } });
  }
});
