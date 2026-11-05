import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { ensureCoreAccounts } from '../server/services/bootstrap.js';

async function startServer() {
  const app = await createApp({ dbPath: ':memory:', port: 0, scryptN: 1024, cookieSecure: false });
  await ensureCoreAccounts(app, 'Test-Only-Pass-1!');
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  return { app, base: `http://127.0.0.1:${port}` };
}

test('Uni-ERP v12 — Phases 1 to 4 Complete Integration Suite', async (t) => {
  const { app, base } = await startServer();
  t.after(() => app.close());

  // 1. Login as admin and verify token + cookie
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Test-Only-Pass-1!' }),
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.equal(loginData.token, undefined, 'الجلسة في الكوكي وحدها');
  const headers = { 'Content-Type': 'application/json', Cookie: loginRes.headers.get('set-cookie').split(';')[0] };

  // 2. Phase 1 (5.12 LMS & Digital Library)
  const lmsRes = await fetch(`${base}/api/lms/overview`, { headers });
  assert.equal(lmsRes.status, 200);
  const lms = await lmsRes.json();
  assert.equal(lms.lectures.length, 0, 'لا محاضرات مزروعة');
  assert.equal(lms.books.length, 0, 'لا كتب مزروعة');

  const addLec = await fetch(`${base}/api/lms/lectures`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ course_code: 'CS-301', course_name: 'أمن الشبكات', title: 'تحليل الحزم Wireshark', instructor: 'د. سامر خوري', duration_min: 55 }),
  });
  assert.equal(addLec.status, 201);

  // 3. Phase 1 (5.13 Research & Postgrad)
  const resOverview = await fetch(`${base}/api/research/overview`, { headers });
  assert.equal(resOverview.status, 200);
  const research = await resOverview.json();
  assert.equal(research.projects.length, 0);
  assert.equal(research.theses.length, 0);

  // 4. Phase 1 (5.14 Alumni & Career)
  const almRes = await fetch(`${base}/api/alumni/overview`, { headers });
  assert.equal(almRes.status, 200);
  const alumni = await almRes.json();
  assert.equal(alumni.alumni.length, 0);
  assert.equal(alumni.jobs.length, 0);

  // 5. Phase 1 (5.15 QA & Accreditation)
  const qaRes = await fetch(`${base}/api/qa/overview`, { headers });
  assert.equal(qaRes.status, 200);
  const qa = await qaRes.json();
  assert.equal(qa.kpis.length, 0);
  assert.equal(qa.accreditations.length, 0);

  // 6. Phase 2 (5.5-5.8 Expansions)
  const expRes = await fetch(`${base}/api/expansions/overview`, { headers });
  assert.equal(expRes.status, 200);
  const exp = await expRes.json();
  assert.equal(exp.exams.length, 0);
  const life = await (await fetch(`${base}/api/student-life/overview`, { headers })).json();
  assert.equal(life.dormRooms.length, 150, 'هيكلية السكن: 3 مبانٍ في كل منها 50 غرفة');
  assert.equal(exp.biometrics.length, 0);

  // 7. Phase 3 (Scalability & DevOps)
  const devRes = await fetch(`${base}/api/devops/overview`, { headers });
  assert.equal(devRes.status, 200);
  const devops = await devRes.json();
  assert.ok(devops.metrics.nodeVersion);
  assert.ok(devops.metrics.tablesCount >= 30);
  assert.equal(typeof devops.analytics.delivery.successRate, 'number', 'شاشة البنية التحتية تقرأ هذا الحقل');

  const ddlRes = await fetch(`${base}/api/devops/postgres-ddl`, { headers });
  assert.equal(ddlRes.status, 200);
  const ddlData = await ddlRes.json();
  assert.ok(ddlData.ddl.includes('PostgreSQL 16'));

  // 8. Phase 4 (AI-Powered University)
  const aiRes = await fetch(`${base}/api/ai/overview`, { headers });
  assert.equal(aiRes.status, 200);
  const ai = await aiRes.json();
  assert.equal(ai.warnings.length, 0);

  const askRes = await fetch(`${base}/api/ai/advisor/ask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question: 'ما هي متطلبات التخرج ونسبة الغياب المسموحة؟' }),
  });
  assert.equal(askRes.status, 201);
  const askData = await askRes.json();
  assert.ok(askData.answer.length > 10);

  const triageRes = await fetch(`${base}/api/ai/triage/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source_type: 'complaint', subject: 'اعتراض عاجل على الرسوم الدراسية', body_text: 'أرجو مراجعة القسط الفصلي' }),
  });
  assert.equal(triageRes.status, 201);
  const triage = await triageRes.json();
  assert.ok(triage.target_unit);
});
