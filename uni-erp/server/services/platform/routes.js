// مسارات طبقة المنصة: النقاش والأنشطة والموافقات والأتمتة والتقارير المحورية.
import { sendRaw } from '../../http.js';
import { recordThread, postToRecord, setFollow, createActivity, completeActivity, cancelActivity, updateActivity, listActivities, hubSummary, searchPeople, setPushDeps } from './records.js';
import { listTypes, saveType, submitApproval, decideApproval, cancelApproval, listApprovals, getApproval, countTodo, approvalCatalog, unifiedInbox, decideFromInbox } from './approvals.js';
import './sources.js';   // سلاسل الوحدات (المشتريات، المراسلات، حركات القيد) في الصندوق الموحّد
import { automationOverview, saveRule, deleteRule, runNow } from './automation.js';
import { pivotCatalog, runPivot, pivotXlsx } from './pivot.js';

const XL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function registerPlatformRoutes(r, deps) {
  const { db } = deps;
  setPushDeps(deps);
  r.add('GET', '/api/hub/summary', (c) => c.json(200, { ...hubSummary(db, c.user), approvalsTodo: countTodo(db, c.user) }));
  r.add('GET', '/api/hub/people', (c) => c.json(200, { people: searchPeople(db, c.user, c.query.q) }));

  r.add('GET', '/api/records/:model/:id/thread', (c) => c.json(200, recordThread(db, c.user, c.params.model, c.params.id)));
  r.add('POST', '/api/records/:model/:id/messages', (c) => c.json(201, postToRecord(db, c.user, c.params.model, c.params.id, c.body, c.ip)));
  r.add('POST', '/api/records/:model/:id/follow', (c) => c.json(200, setFollow(db, c.user, c.params.model, c.params.id, !!c.body?.follow)));

  r.add('GET', '/api/activities', (c) => c.json(200, { activities: listActivities(db, c.user, { box: c.query.box, status: c.query.status || 'open' }) }));
  r.add('POST', '/api/activities', (c) => c.json(201, createActivity(db, c.user, c.body, c.ip)));
  r.add('PUT', '/api/activities/:id', (c) => c.json(200, updateActivity(db, c.user, c.params.id, c.body, c.ip)));
  r.add('POST', '/api/activities/:id/done', (c) => c.json(200, completeActivity(db, c.user, c.params.id, c.body, c.ip)));
  r.add('POST', '/api/activities/:id/cancel', (c) => c.json(200, cancelActivity(db, c.user, c.params.id, c.body, c.ip)));

  r.add('GET', '/api/approval-types', (c) => c.json(200, { types: listTypes(db, c.user, { all: c.query.all === '1' }), catalog: approvalCatalog() }));
  r.add('POST', '/api/approval-types', (c) => c.json(201, saveType(db, c.user, null, c.body, c.ip)));
  r.add('PUT', '/api/approval-types/:id', (c) => c.json(200, saveType(db, c.user, c.params.id, c.body, c.ip)));
  r.add('GET', '/api/approvals/inbox', (c) => c.json(200, { items: unifiedInbox(db, c.user) }));
  r.add('POST', '/api/approvals/inbox/:source/:id/decide', (c) => c.json(200, decideFromInbox(deps, c.user, c.params.source, c.params.id, c.body, c.ip)));
  r.add('GET', '/api/approvals', (c) => c.json(200, { approvals: listApprovals(db, c.user, { box: c.query.box, status: c.query.status }) }));
  r.add('POST', '/api/approvals', (c) => c.json(201, submitApproval(db, c.user, c.body, c.ip)));
  r.add('GET', '/api/approvals/:id', (c) => c.json(200, getApproval(db, c.user, c.params.id)));
  r.add('POST', '/api/approvals/:id/decide', (c) => c.json(200, decideApproval(db, c.user, c.params.id, c.body, c.ip)));
  r.add('POST', '/api/approvals/:id/cancel', (c) => c.json(200, cancelApproval(db, c.user, c.params.id, c.body, c.ip)));

  r.add('GET', '/api/automation', (c) => c.json(200, automationOverview(db, c.user)));
  r.add('POST', '/api/automation/rules', (c) => c.json(201, saveRule(db, c.user, null, c.body, c.ip)));
  r.add('PUT', '/api/automation/rules/:id', (c) => c.json(200, saveRule(db, c.user, c.params.id, c.body, c.ip)));
  r.add('DELETE', '/api/automation/rules/:id', (c) => c.json(200, deleteRule(db, c.user, c.params.id, c.ip)));
  r.add('POST', '/api/automation/run', (c) => c.json(200, runNow(db, c.user, c.ip)));

  r.add('GET', '/api/reports/pivot/datasets', (c) => c.json(200, { datasets: pivotCatalog(c.user) }));
  r.add('GET', '/api/reports/pivot', (c) => c.json(200, runPivot(db, c.user, c.query)));
  r.add('GET', '/api/reports/pivot.xlsx', (c) => {
    const { file } = pivotXlsx(db, c.user, c.query);
    sendRaw(c.res, 200, { 'Content-Type': XL, 'Content-Disposition': 'attachment; filename="pivot.xlsx"' }, file);
  });
}
