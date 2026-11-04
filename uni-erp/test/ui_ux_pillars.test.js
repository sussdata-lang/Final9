import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

let app, base;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ui-'));
  app = await createApp({ dbPath: path.join(dir, 'ui.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  if (app) await app.close();
});

test('شاشات الوحدات الموسعة تُركَّب: تغليفها يبقي المعامل الذي يميّزها به render، وإلا عرضت [object Promise]', async () => {
  const js = await (await fetch(base + '/v12_views.js')).text();
  assert.ok(js.includes('UA.views[key] = function (el, ...rest)'));
  assert.ok(!js.includes('UA.views[key] = function (...args)'));
  assert.ok((await (await fetch(base + '/app.js')).text()).includes('v.length >= 1 && UA.views[S.view]'), 'render يعتمد على عدد المعاملات');
});

test('لا سجلات مكتوبة في الواجهة: الأسماء والأرقام النموذجية لا تعود بديلاً عن البيانات', async () => {
  for (const file of ['ux_restructure.js', 'enterprise_suite.js', 'attendance.js', 'backup.js', 'v12_views.js']) {
    const js = await (await fetch(`${base}/${file}`)).text();
    for (const fake of ['DEFAULT_UNI_COURSES', 'getInitialCardLogs', 'SNAP-20261030', 'curGpa: 88.4', 'projectedGpa: 90.1', 'value="أحمد محمد العلي"', 'value="CYB-2026-0001"', 'hitRatio || 98.4', "'pg-cluster.uni.internal'", 'logs.length + 300', 'new_mark: Number(btn.dataset.old) + 5']) assert.ok(!js.includes(fake), `${file}: ${fake}`);
  }
});

test('1. شريط الأدوات: طي القائمة فقط + الانتقال السريع (Ctrl+`) بلا تكبير/تباين/كثافة/تبويبات مفتوحة', async () => {
  const shellRes = await fetch(base + '/shell.js');
  assert.equal(shellRes.status, 200);
  const shellJs = await shellRes.text();
  assert.ok(shellJs.includes('sx-a11y-bar'), 'يجب أن يتضمن shell.js شريط أدوات سهولة الوصول sx-a11y-bar');
  assert.ok(shellJs.includes('sxtoggleside'), 'يجب أن يتضمن shell.js زر طي القائمة الجانبية');
  for (const gone of ['sxdensity', 'sxcontrast', 'sxfont']) assert.ok(!shellJs.includes(gone), `أُزيل ${gone} من shell.js (طلب المالك: إبقاء طي القائمة فقط)`);
  assert.ok(shellJs.includes("e.code === 'Backquote'"), 'الانتقال السريع على Ctrl+` (مفتاح حرف ذ)');
  assert.ok(shellJs.includes('renderWorkspaceTabsBar'), 'يجب أن يستدعي shell.js شريط التبويبات المفتوحة والمثبتة');
});

test('2. ملف ux_restructure.js يحتوي على نافذة البحث الشامل Command Palette ودرج المعاينة السريعة والحفظ التلقائي للمسودات', async () => {
  const uxRes = await fetch(base + '/ux_restructure.js');
  assert.equal(uxRes.status, 200);
  const uxJs = await uxRes.text();
  assert.ok(uxJs.includes('UA.openCommandPalette'), 'يجب أن يوفر ux_restructure.js دالة فتح نافذة الأوامر Ctrl+K');
  assert.ok(uxJs.includes('enhanceSubTabsBadgesAndShortcuts'), 'يجب أن يعزز التبويبات الفرعية بشارات الأعداد واختصارات Alt+1..9');
  assert.ok(uxJs.includes('enhanceTablesWithQuickPreview'), 'يجب أن يوفر درج المعاينة السريعة للجداول Slide-Over Preview');
  assert.ok(uxJs.includes('enhanceFormsWithAutoSaveDrafts'), 'يجب أن يوفر الحفظ التلقائي لمسودات النماذج Auto-Save Drafts');
});

test('3. ملف style.css يحتوي على تنسيقات التبويبات الفرعية وطي القائمة والبحث الشامل', async () => {
  const cssRes = await fetch(base + '/style.css');
  assert.equal(cssRes.status, 200);
  const css = await cssRes.text();
  assert.ok(css.includes('.sx-ws-bar'), 'يجب أن يتضمن style.css تنسيق شريط التبويبات المفتوحة');
  assert.ok(css.includes('body.sx-collapsed'), 'يجب أن يتضمن style.css تنسيق طي القائمة الجانبية');
  assert.ok(!css.includes('body.sx-density-compact') && !css.includes('body.sx-high-contrast'), 'أُزيل تنسيق الكثافة والتباين العالي');
  assert.ok(css.includes('.sx-cmd-overlay'), 'يجب أن يتضمن style.css تنسيق نافذة البحث الشامل Ctrl+K');
  assert.ok(css.includes('.sx-slideover'), 'يجب أن يتضمن style.css تنسيق درج المعاينة السريعة');
});

test('4. إصلاح التنقلات والتصميم: تنظيف وسوم HTML في القائمة الجانبية ومنع التكرار وحلقات setTimeout في الديوان وشؤون الموظفين', async () => {
  const [shellRes, uxRes] = await Promise.all([
    fetch(base + '/shell.js'),
    fetch(base + '/ux_corr.js'),
  ]);
  const shellJs = await shellRes.text();
  const uxJs = await uxRes.text();

  assert.ok(shellJs.includes('replace(/<[^>]+>/g'), 'يجب أن ينظف shell.js وسوم HTML الداخلية من عناصر التبويبات الفرعية في القائمة الجانبية');
  assert.ok(uxJs.includes('getCleanCorrHtml'), 'يجب أن يزيل ux_restructure.js الترويسات والتبويبات المكررة في الديوان والمراسلات');
  assert.ok(uxJs.includes('getCleanInternalHtml'), 'يجب أن يزيل ux_restructure.js الترويسات المكررة في الطلبات الداخلية');

  const fnStart = uxJs.indexOf('function renderUnifiedCorrespondenceHub()');
  const fnEnd = uxJs.indexOf('UA.views.corr = renderUnifiedCorrespondenceHub');
  const fnBody = uxJs.slice(fnStart, fnEnd);
  assert.ok(!fnBody.includes('setTimeout('), 'يجب ألا تحتوي دالة عرض الديوان على setTimeout لمنع حلقات إعادة الرسم اللانهائية');
  assert.ok(!fnBody.includes('background:rgba(255,255,255,.1);color:#fff'), 'يجب ألا تحتوي تبويبات الديوان على نص أبيض فوق خلفية بيضاء');
});

test('5. إصلاح ظهور تبويب التطوير المؤسسي للموارد البشرية والعبء التدريسي وبقية أقسام التطوير المؤسسي المدمجة', async () => {
  const [esRes, uxRes] = await Promise.all([
    fetch(base + '/enterprise_suite.js'),
    fetch(base + '/ux_restructure.js'),
  ]);
  assert.equal(esRes.status, 200);
  assert.equal(uxRes.status, 200);
  const esJs = await esRes.text();
  const uxJs = await uxRes.text();

  assert.ok(esJs.includes('UA.renderEnterpriseSection'), 'يجب أن يوفر enterprise_suite.js دالة UA.renderEnterpriseSection لعرض أقسام التطوير المؤسسي مباشرة');
  assert.ok(esJs.includes('ensureEnterpriseDataLoaded'), 'يجب أن يجلب enterprise_suite.js بيانات التطوير المؤسسي تلقائياً عند فتح التبويب');
  assert.ok(uxJs.includes("UA.renderEnterpriseSection('hr_finance')"), 'يجب أن يعرض تبويب التطوير المؤسسي للموارد البشرية قسم hr_finance مباشرة');

  const mountFnStart = uxJs.indexOf('function mountSplitEnterpriseBlocks()');
  const mountFnEnd = uxJs.indexOf('UA.renderWorkspaceTabsBar', mountFnStart);
  const mountFnBody = uxJs.slice(mountFnStart, mountFnEnd);
  assert.ok(!mountFnBody.includes('UA.actions.estab('), 'يجب ألا تستدعي mountSplitEnterpriseBlocks الإجراء estab لمنع حلقات إعادة الرسم اللانهائية');
});

test('5-ب. تبويب «أعمالي»: يُحمَّل بعد ux_restructure حتى يغلّف خطافها ويتصل باللوحة الرئيسية', async () => {
  const [wsRes, uxRes, htmlRes] = await Promise.all([fetch(base + '/workspace.js'), fetch(base + '/ux_restructure.js'), fetch(base + '/')]);
  assert.equal(wsRes.status, 200);
  const ws = await wsRes.text(), ux = await uxRes.text(), html = await htmlRes.text();
  assert.ok(ws.includes('UA.workspaceView'), 'يوفّر عرض التبويب');
  assert.ok(ws.includes('UA.gate.allowed'), 'التبويبات الفرعية تمر بالبوابة حتى لا يظهر ما لا يملكه الحساب');
  assert.ok(ux.includes('UA.workspaceView()'), 'اللوحة الرئيسية تعرضه');
  assert.ok(html.indexOf('/ux_restructure.js') < html.indexOf('/workspace.js'), 'ترتيب التحميل');
});

test('6. تكامل محرك المخططات الهندسية التفاعلية Archify (Architecture, Tree, Workflow, ERD)', async () => {
  const paths = [
    '/archify/architecture.html',
    '/archify/tree.html',
    '/archify/workflow.html',
    '/archify/erd.html',
    '/archify/uni-erp.architecture.json',
  ];
  const pw = 'Archify#Pass12345';
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, active, must_change_password, created_at) VALUES ('archify_staff', 'x', ?, 'staff', 1, 0, ?)").run(await hashPassword(pw, 1024), Date.now());
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'archify_staff', password: pw }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  for (const p of paths) {
    assert.equal((await fetch(base + p)).status, 404, `المخطط ${p} لا يُفتح دون جلسة`);
    const res = await fetch(base + p, { headers: { Cookie } });
    assert.equal(res.status, 200, `يجب أن يتوفر ملف المخطط التفاعلي ${p}`);
  }
  const uxRes = await fetch(base + '/ux_restructure.js');
  const uxJs = await uxRes.text();
  assert.ok(uxJs.includes('archify-diagram-frame'), 'يجب أن يتضمن دليل الإرشادات عارض مخططات Archify التفاعلية');
});

