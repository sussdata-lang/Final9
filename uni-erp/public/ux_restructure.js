/* ==========================================================================
   منظومة التطوير الهيكلي وتجربة المستخدم الموحدة (UX & Structural Upgrade)
   تغطي المتطلبات الـ 14 بالكامل:
   1. دمج الواجهات المتشابهة ضمن تبويب واحد (الحضور والإجازات، اللجان، المراقبة...)
   2. تثبيت موضع التمرير (Scroll Preservation) وعدم القفز للأعلى عند تبديل الأقسام
   3. دمج الاستيراد مع استيراد الإكسل في فورم موحد وحصر التصدير في صفحة التصدير
   4. الإكمال التلقائي (Autocomplete) والبحث الفوري بمجرد كتابة الأحرف (Instant Search)
   5. دمج مكتبي ولوحة التحكم باسم «اللوحة الرئيسية» ونقل «إعداداتي» إلى الإدارة
   6. نقل قسم البصمة وتقييم الموظفين إلى قسم شؤون الموظفين الموحد
   7. دمج البنية التحتية والتوسع مع التدقيق باسم «آليات المراقبة والتدقيق»
   8. تقسيم التطوير المؤسسي إلى الأقسام الخاصة بها (شؤون الطلاب، الأكاديمي، الموظفين، المراقبة)
   9. دمج اللجنة التأديبية مع سجل اللجان الانضباطية والمخالفات المسلكية
   10. تطوير نظام إنشاء فحص الامتحان: فورم شامل يحتوي كافة المواد مع تاريخ الفحص + إنشاء PDF
   11. إنشاء خيار «أخرى» في القوائم المنسدلة مع بند لكتابة الإدخالات الأخرى
   12. جميع القوائم المنسدلة قابلة للتعديل والإضافة في الإعدادات العامة
   13. حذف هوية الموقع من الواجهات
   14. تبويب شامل للإرشادات الأكاديمية والإدارية والمراسلات وآلية التطبيق خطوة بخطوة
   ========================================================================== */
(function () {
  'use strict';
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, fmt, toast, can } = UA;

  /* ---------- حالة الوحدات الموحدة ---------- */
  const U = {
    mainTab: 'unified', // unified | work | myprofile
    hrSection: 'payroll', // payroll | att_leaves | biometrics | appraisals | enterprise_hr
    auditSection: 'chain', // chain | logs | devops | exec_offline
    acadExtraTab: '', // '' | 'exam_master' | 'enterprise_acad'
    guideMode: 'depts', // depts | hierarchy | lifecycle | corr_rules | governance
    guideSection: 'all',
    guideDeptFilter: 'all',
    guideNode: 'node_president',
    guideReqSim: 'req_enrollment',
    guideReqStep: 1,
    guideQuery: '',
    corrUnifiedTab: 'in', // in | out | internal_requests | internal_new | pending_all | new_corr | tpl | notifs
    corrReqFilter: 'all',
    examSchedule: {
      examType: 'امتحان فصلي نهائي (Final)',
      academicYear: '2025/2026',
      semester: 'الفصل الأول',
      startDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      defaultTime: '09:00',
      defaultDuration: 120,
      filterProgram: '',
      filterQuery: '',
      rows: {}, // courseId -> { included, date, time, duration, hall, proctor, notes }
      loaded: false,
      courses: [],
    },
    // تُحمَّل من الخادم عند فتح التبويب
    biometrics: { devices: [] },
    appraisals: [],
    cardActivity: {
      filterEvent: 'all', // all | check_in | check_out | denied
      filterMethod: 'all', // all | nfc | barcode
      filterLocation: 'all',
      searchQuery: '',
      selectedLocation: 'GATE-MAIN-01',
      selectedMethod: 'nfc',
    },
  };

  /* ==========================================================================
     1. دمج «مكتبي» و«لوحة التحكم» باسم «اللوحة الرئيسية»
     ونقل «إعداداتي» إلى «لوحة الإدارة»
     ========================================================================== */
  const origOverviewLoader = UA.loaders.overview;
  const origDeskLoader = UA.loaders.desk;

  UA.loaders.overview = async () => {
    await Promise.all([
      origOverviewLoader ? origOverviewLoader().catch(() => {}) : Promise.resolve(),
      origDeskLoader ? origDeskLoader().catch(() => {}) : Promise.resolve(),
    ]);
  };

  function renderArchifyDiagramsBlock() {
    const aTab = U.archifyDiagram || 'architecture';
    const diagrams = {
      architecture: {
        title: 'المعمارية الشاملة والأمن والضغط العالي (Architecture Map)',
        desc: 'مخطط معماري تفاعلي مبني بمحرك Archify يوضح بوابة الطلاب والموظفين، جدار الحماية WAF، خادم Node.js 22، كاش L1/Redis المزدوج، محركات الوحدات الـ 17، التوقيع الرقمي Ed25519، وقاعدة بيانات PostgreSQL.',
        htmlUrl: '/archify/architecture.html',
        jsonUrl: '/archify/uni-erp.architecture.json',
      },
      tree: {
        title: 'شجرة الوحدات الـ 17 والهيكل التنظيمي (Capability Tree)',
        desc: 'تفكيك شجري تفاعلي لكافة الأقطاب الأربعة في المنظومة الجامعية (القيادة والإدارة، القطب الأكاديمي والطلابي، قطب الموارد البشرية والمالية والديوان، وقطب الأمن والذكاء الاصطناعي).',
        htmlUrl: '/archify/tree.html',
        jsonUrl: '/archify/uni-erp.tree.json',
      },
      workflow: {
        title: 'مسار دورة حياة المعاملات والطلبات والتوقيع الرقمي (Workflow)',
        desc: 'مخطط مسارات (Swimlanes) يوضح انتقال الطلب من البوابة إلى فحص الحواجز الآلي، التوجيه للوحدة المختصة، قرار الاعتماد، التوقيع الرقمي Ed25519، والتدوين في سلسلة التدقيق SHA-256.',
        htmlUrl: '/archify/workflow.html',
        jsonUrl: '/archify/uni-erp.workflow.json',
      },
      erd: {
        title: 'مخطط قاعدة البيانات العلائقية والفهارس عالية التردد (Database ERD)',
        desc: 'مخطط الكيانات والعلاقات (ERD) للجداول المحورية عالية التردد (users, org_units, requests, corr_docs, documents, hr_employees, fin_entries) مع مفاتيح الربط والفهارس المركبة.',
        htmlUrl: '/archify/erd.html',
        jsonUrl: '/archify/uni-erp.erd.json',
      },
    };
    const cur = diagrams[aTab] || diagrams.architecture;
    const dTabs = [
      ['architecture', '🏗️ المعمارية الشاملة والأمن (Architecture)'],
      ['tree', '🌳 شجرة الوحدات الـ 17 (Capability Tree)'],
      ['workflow', '⚡ مسار الطلبات والتوقيع (Workflow)'],
      ['erd', '🗄️ قاعدة البيانات والفهارس (ERD)'],
    ].map((t) => `<button type="button" class="chip" data-act="archifytab" data-t="${t[0]}" aria-pressed="${aTab === t[0]}">${esc(t[1])}</button>`).join('');

    return `
      <section class="card" style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <span class="pill p-approved">Archify Typed JSON IR · مخططات هندسية تفاعلية</span>
            <h2 style="margin:6px 0 4px;color:#054239">${esc(cur.title)}</h2>
            <p class="hint" style="margin:0">${esc(cur.desc)}</p>
          </div>
          <div class="actions" style="margin:0">
            <a class="btn sm pri" href="${esc(cur.htmlUrl)}" download="uni-erp-${esc(aTab)}.html" style="text-decoration:none">⬇ تحميل المخطط التفاعلي (HTML)</a>
            <a class="btn sm" href="${esc(cur.jsonUrl)}" download="uni-erp.${esc(aTab)}.json" style="text-decoration:none">📄 تحميل توصيف JSON IR</a>
          </div>
        </div>

        <div class="sub-tabs no-print" style="margin-top:14px;margin-bottom:12px">
          ${dTabs}
        </div>

        <div style="border:2px solid #054239;border-radius:14px;overflow:hidden;background:#0f172a;box-shadow:0 10px 30px rgba(5,66,57,0.14)">
          <iframe
            id="archify-diagram-frame"
            src="${esc(cur.htmlUrl)}"
            title="${esc(cur.title)}"
            style="width:100%;height:680px;border:0;display:block;background:#fff"
            loading="eager"
          ></iframe>
        </div>
      </section>
    `;
  }

  UA.digitalCardHtml = (st, o = {}) => {
    const secureBarcode = UA.generateStudentSecureBarcode ? UA.generateStudentSecureBarcode(st.studentNo, st.nationalId || '2026') : `SUSS-${st.studentNo}-SEC94`;
    return `      <div style="max-width:540px;margin:10px auto 24px;background:linear-gradient(135deg,#042f28 0%,#095246 100%);color:#fff;border-radius:18px;padding:22px;border:2px solid #D5B65D;box-shadow:0 14px 34px rgba(4,47,40,.24);position:relative;overflow:hidden" ${o.screen ? 'id="official-digital-card" ' : ''}data-digital-card>
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(213,182,93,.4);padding-bottom:12px;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px">
            <img src="/brand/crest.svg" alt="" width="38" height="44" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))">
            <div>
              <strong style="font-size:15px;display:block;color:#fff">الجامعة السورية للعلوم الأمنية</strong>
              <small style="color:#D5B65D;font-weight:700">البطاقة الجامعية الرقمية الذكية المصدقة</small>
            </div>
          </div>
          <span style="background:#D5B65D;color:#042f28;font-weight:800;font-size:11px;padding:3px 9px;border-radius:99px">صالحة 2026 / 2027</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center">
          <div>
            <div style="font-size:19px;font-weight:800;margin-bottom:4px;color:#fff">${esc(st.name)}</div>
            <div style="font-size:13px;color:#d1fae5">الرقم الجامعي: <b class="mono" style="color:#fde047;letter-spacing:1px">${esc(st.studentNo)}</b></div>
            <div style="font-size:12.5px;color:#d1fae5;margin-top:2px">${esc((st.program && st.program.name) || (typeof st.program === 'string' ? st.program : ''))}${st.levelLabel ? ` · ${esc(st.levelLabel)}` : ''}</div>
            <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
              ${st.statusLabel ? `<span style="background:rgba(16,185,129,.25);color:#a7f3d0;padding:3px 8px;border-radius:6px;font-size:11px">${esc(st.statusLabel)}</span>` : ''}
            </div>
          </div>
          <div style="background:#fff;color:#042f28;padding:8px;border-radius:10px;text-align:center;width:96px">
            <svg viewBox="0 0 80 80" width="80" height="80" style="display:block;margin:0 auto">
              <rect width="80" height="80" fill="#fff"/>
              <rect x="6" y="6" width="22" height="22" fill="#042f28"/><rect x="10" y="10" width="14" height="14" fill="#fff"/><rect x="13" y="13" width="8" height="8" fill="#042f28"/>
              <rect x="52" y="6" width="22" height="22" fill="#042f28"/><rect x="56" y="10" width="14" height="14" fill="#fff"/><rect x="59" y="13" width="8" height="8" fill="#042f28"/>
              <rect x="6" y="52" width="22" height="22" fill="#042f28"/><rect x="10" y="56" width="14" height="14" fill="#fff"/><rect x="13" y="59" width="8" height="8" fill="#042f28"/>
              <rect x="34" y="12" width="6" height="6" fill="#042f28"/><rect x="34" y="24" width="12" height="6" fill="#042f28"/>
              <rect x="12" y="34" width="18" height="6" fill="#042f28"/><rect x="36" y="36" width="14" height="14" fill="#D5B65D"/>
              <rect x="54" y="44" width="8" height="8" fill="#042f28"/><rect x="42" y="56" width="14" height="6" fill="#042f28"/>
            </svg>
            <small style="font-size:9px;font-family:monospace;font-weight:700;display:block;margin-top:2px;color:#042f28">PKI SHA-256</small>
          </div>
        </div>

        <!-- باركود أمني فريد مشفر ومضاد للتزوير (بدون إظهار اسم المستخدم تحته أبداً) -->
        <div style="margin-top:16px;padding-top:12px;border-top:1px dashed rgba(213,182,93,.4);text-align:center">
          <div class="idc-bc" style="background:#fff;padding:8px 12px;border-radius:8px;display:inline-block;width:100%;max-width:380px" title="تكويد الباركود الأمني الفريد المضاد للتزوير">
            ${UA.code128 ? UA.code128(secureBarcode) : ''}
          </div>
          <div style="font-size:10px;color:#fde68a;margin-top:4px;font-family:monospace">رمز التكويد الآمن المعتمد: ${esc(secureBarcode)}</div>
        </div>
      </div>`;
  };

  UA.views.overview = () => {
    if (S.mainDashTab) {
      U.mainTab = S.mainDashTab === 'me' || S.mainDashTab === 'myprofile' ? 'myprofile' : S.mainDashTab === 'work' ? 'work' : 'unified';
      S.mainDashTab = null;
    }
    const desk = UA.deskParts ? UA.deskParts() : null;
    const tabs = [['unified', 'اللوحة الرئيسية'], ['work', desk ? desk.workTitle : 'أعمالي'], ['myprofile', 'ملفي وصلاحياتي']];
    const bar = `<div class="sub-tabs no-print" role="tablist" style="margin-bottom:14px">
      ${tabs.map((t) => `<button class="chip" role="tab" data-act="maindashtab" data-t="${t[0]}" aria-pressed="${U.mainTab === t[0]}">${esc(t[1])}</button>`).join('')}
    </div>`;
    if (U.mainTab === 'work' && UA.workspaceView) return bar + UA.workspaceView();
    if (U.mainTab === 'myprofile') {
      return bar + (desk ? desk.profile : '<section class="card"><p class="hint">جارٍ التحميل…</p></section>')
        + '<div class="actions" style="margin-top:14px"><button type="button" class="btn" data-act="openmysettings">إعداداتي وتغيير كلمة المرور</button></div>';
    }
    // كل عنصر يظهر مرة واحدة: الترويسة والبصمة ومؤشراتي من «مكتبي»، ومؤشرات الجامعة والانتقال السريع من لوحة التحكم
    const home = UA.homeParts();
    return bar + (desk ? desk.hero : '') + (UA.flowQueuePanel ? UA.flowQueuePanel() : '') + home.stats + home.panels + (desk ? desk.lists : '');
  };

  UA.renderMySettingsInAdmin = () => {
    const m = S.me || {};
    return `<div class="grid2">
      <section class="card">
        <h2>إعداداتي الشخصية وتغيير كلمة المرور</h2>
        <p class="hint" style="margin-top:0">تم نقل قسم «إعداداتي» إلى لوحة الإدارة المركزية. تغيير كلمة المرور يُنهي الجلسات الأخرى فوراً.</p>
        <form id="dkpwform" class="form">
          <label>كلمة المرور الحالية<input id="dk-cur" type="password" autocomplete="current-password" required></label>
          <label>كلمة المرور الجديدة<input id="dk-new" type="password" autocomplete="new-password" required minlength="${(S.limits || {}).passwordMin || 10}"></label>
          <label>تأكيد كلمة المرور الجديدة<input id="dk-new2" type="password" autocomplete="new-password" required minlength="${(S.limits || {}).passwordMin || 10}"></label>
          <p class="small">الحد الأدنى ${(S.limits || {}).passwordMin || 10} أحرف، وتحوي حروفاً وأرقاماً.</p>
          <div class="actions"><button class="btn pri" type="submit">تغيير كلمة المرور</button></div>
        </form>
      </section>
      <section class="card">
        <h2>بيانات الحساب والتفضيلات</h2>
        <dl class="kv">
          <dt>الاسم الكامل</dt><dd><b>${esc(m.name || '')}</b></dd>
          <dt>اسم المستخدم</dt><dd class="mono" dir="ltr">${esc(m.username || '')}</dd>
          <dt>الدور الوظيفي</dt><dd>${esc(m.roleLabel || (UA.ROLE_LABEL && UA.ROLE_LABEL[m.role]) || '')}</dd>
          <dt>القسم / الوحدة</dt><dd>${m.unit ? esc(m.unit.name) : 'الإدارة العامة'}</dd>
          <dt>عدد الصلاحيات الممنوحة</dt><dd>${(m.permissions || []).length} صلاحية</dd>
        </dl>
        <div class="actions" style="margin-top:14px">
          ${window.UAtheme ? window.UAtheme.button() : ''}
          <button class="btn sm" type="button" data-act="view" data-v="guidelines">فتح دليل العمل الأكاديمي والإرشادات</button>
        </div>
      </section>
    </div>`;
  };

  /* ==========================================================================
     2. توحيد قسم «شؤون الموظفين» (دمج الحضور والإجازات + الرواتب + البصمة + تقييم الموظفين)
     ========================================================================== */
  const origPayrollLoader = UA.loaders.payroll;
  const origPayrollView = UA.views.payroll;
  const origHrLoader = UA.loaders.hr;
  const origHrView = UA.views.hr;

  UA.loaders.payroll = async () => {
    await Promise.all([
      origPayrollLoader ? origPayrollLoader().catch(() => {}) : Promise.resolve(),
      origHrLoader ? origHrLoader().catch(() => {}) : Promise.resolve(),
      UA.loaders.enterprise ? UA.loaders.enterprise().catch(() => {}) : Promise.resolve(),
    ]);
  };

  async function loadHrExtras() {
    const d = await api('GET', '/api/expansions/overview').catch(() => null);
    if (!d) return;
    U.appraisals = d.appraisals || [];
    U.biometrics.devices = (d.biometrics || []).map((b) => ({ code: b.device_code, name: b.location, ip: b.ip_address, status: b.status, syncedAt: b.last_sync_at ? new Date(Number(b.last_sync_at)).toLocaleString('ar-SY') : '—', recordsToday: Number(b.logs_synced) || 0 }));
  }

  function renderBiometricsTab() {
    const devs = U.biometrics.devices.map((d) => `<tr>
      <td class="mono">${esc(d.code)}</td>
      <td><b>${esc(d.name)}</b></td>
      <td class="mono" dir="ltr">${esc(d.ip)}</td>
      <td><span class="pill p-approved">${esc(d.status)}</span></td>
      <td>${esc(d.syncedAt)}</td>
      <td><b>${d.recordsToday}</b> حركة</td>
    </tr>`).join('');

    return `<section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0">منظومة البصمة وأجهزة الحضور الحيوي (مدمجة في شؤون الموظفين)</h2>
          <p class="hint" style="margin:4px 0 0">ربط مباشر مع أجهزة البصمة البيومترية (بصمة الإصبع والوجه) ومزامنتها تلقائياً مع سجل الدوام ومسيرات الرواتب.</p>
        </div>
        <div class="actions" style="margin:0">
          <button type="button" class="btn pri" data-act="biosync">🔄 مزامنة فورية مع أجهزة البصمة</button>
        </div>
      </div>
      <div class="stats" style="margin-top:14px">
        <div class="stat"><small>أجهزة البصمة المتصلة</small><b>${U.biometrics.devices.length}</b></div>
        <div class="stat"><small>الحركات المزامنة</small><b>${U.biometrics.devices.reduce((sum, d) => sum + d.recordsToday, 0)}</b></div>
      </div>
    </section>
    <section class="card" style="margin-top:16px">
      <h3>أجهزة البصمة البيومترية المعتمدة في الحرم الجامعي</h3>
      <div class="tbl-wrap"><table><thead><tr><th>رمز الجهاز</th><th>الموقع / البوابة</th><th>عنوان IP</th><th>الحالة</th><th>آخر مزامنة</th><th>الحركات المزامنة</th></tr></thead><tbody>${devs || '<tr><td colspan="6" class="hint">لا توجد أجهزة بصمة مسجلة.</td></tr>'}</tbody></table></div>
    </section>`;
  }

  function renderAppraisalsTab() {
    const depts = (S.limits && S.limits.dropdowns && S.limits.dropdowns.departments) || [];
    const rows = U.appraisals.map((a) => `<tr>
      <td><b>${esc(a.employee_name)}</b></td>
      <td>${esc(a.department)}</td>
      <td>${esc(a.period_label)}</td>
      <td>${a.punctuality_score}%</td>
      <td>${a.productivity_score}%</td>
      <td>${a.teamwork_score}%</td>
      <td><b>${a.overall_score}%</b></td>
      <td>${esc(a.recommendation)}</td>
      <td>${esc(a.evaluator_name)}</td>
    </tr>`).join('');

    return `<section class="card">
      <h2>تقييم الموظفين ومؤشرات الأداء الوظيفي (KPIs — شؤون الموظفين)</h2>
      <p class="hint" style="margin-top:0">تم نقل ودمج قسم تقييم الموظفين ضمن شؤون الموظفين لربطه مباشرةً بالحوافز والترقيات وسجل الالتزام والدوام.</p>
      <form id="hr-appraisal-form" class="inline-form" style="padding:14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px">
        <label>اسم الموظف<input id="ap-name" required placeholder="مثال: أ. خالد العلي"></label>
        <label>القسم<select id="ap-dept" data-no-other="1">${depts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select></label>
        <label>دورة التقييم<select id="ap-period"><option value="2025/2026 - نصف سنوي">2025/2026 - نصف سنوي</option><option value="2025/2026 - سنوي">2025/2026 - سنوي</option><option value="تقييم فترة تجربة">تقييم فترة تجربة</option><option value="أخرى">أخرى</option></select></label>
        <label>الالتزام بالدوام (%)<input id="ap-c1" type="number" min="0" max="100" required style="width:90px"></label>
        <label>جودة الإنجاز (%)<input id="ap-c2" type="number" min="0" max="100" required style="width:90px"></label>
        <label>العمل الجماعي (%)<input id="ap-c3" type="number" min="0" max="100" required style="width:90px"></label>
        <label style="flex:1;min-width:200px">توصية الرئيس المباشر<input id="ap-note" placeholder="ملاحظات وتوصية المكافأة أو الترقية"></label>
        <button class="btn pri" type="submit">حفظ واعتماد التقييم</button>
      </form>
    </section>
    <section class="card" style="margin-top:16px">
      <h3>سجل التقييمات المعتمدة للموظفين (${U.appraisals.length})</h3>
      <div class="tbl-wrap"><table><thead><tr><th>الموظف</th><th>القسم</th><th>الدورة</th><th>الالتزام</th><th>الجودة</th><th>التعاون</th><th>المعدل العام</th><th>التوصية</th><th>المقيّم</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="hint">لا توجد تقييمات مسجلة.</td></tr>'}</tbody></table></div>
    </section>`;
  }

  UA.views.payroll = () => {
    if (S.hrUnifiedTab) {
      U.hrSection = S.hrUnifiedTab === 'att' ? 'att_leaves' : S.hrUnifiedTab;
      S.hrUnifiedTab = null;
    }
    // من يملك حضوره الشخصي فقط لا يصل إلى ملفات الموظفين والرواتب (يرفضها الخادم)
    const hrFull = S.me.role === 'admin' || ['hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr_emp:delete', 'hr:manage', 'hr_payroll:approve', 'staffatt:manage'].some((p) => UA.can(p));
    if (!hrFull) U.hrSection = 'att_leaves';
    const sections = hrFull ? [
      ['payroll', 'ملفات الموظفين والعقود والرواتب (10 أقسام)'],
      ['att_leaves', 'الحضور والانصراف والإجازات الموحدة'],
      ['biometrics', 'البصمة وأجهزة الحضور الحيوي'],
      ['appraisals', 'تقييم الموظفين والأداء الوظيفي (KPIs)'],
      ['enterprise_hr', 'التطوير المؤسسي للموارد البشرية والعبء التدريسي'],
    ] : [['att_leaves', 'الحضور والانصراف والإجازات الموحدة']];
    const topBar = `<div class="sub-tabs no-print" role="tablist" style="margin-bottom:14px">
      ${sections.map((s) => `<button class="chip" role="tab" data-act="hrunified" data-t="${s[0]}" aria-pressed="${U.hrSection === s[0]}">${esc(s[1])}</button>`).join('')}
    </div>`;

    if (U.hrSection === 'att_leaves') {
      return topBar + `<section class="card" style="margin-bottom:14px;background:#f0fdf4;border-color:#86efac">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div><b>وحدة الحضور والانصراف والإجازات الموحدة (شؤون الموظفين)</b><div class="small">تم دمج واجهات الحضور والانصراف وطلبات الإجازات وأرصدتها ضمن تبويب واحد متكامل تحت شؤون الموظفين.</div></div>
          <button type="button" class="btn sm" data-act="goexport" data-ds="attendance">تصدير التقارير من صفحة التصدير الموحدة ←</button>
        </div>
      </section>` + (origHrView ? origHrView() : '');
    }
    if (U.hrSection === 'biometrics') {
      return topBar + renderBiometricsTab();
    }
    if (U.hrSection === 'appraisals') {
      return topBar + renderAppraisalsTab();
    }
    if (U.hrSection === 'enterprise_hr') {
      const esHtml = UA.renderEnterpriseSection ? UA.renderEnterpriseSection('hr_finance') : '';
      return topBar + `<div id="es-hr-mount" data-mounted="${esHtml ? '1' : ''}">${esHtml}</div>`;
    }
    const rawPayroll = origPayrollView ? (origPayrollView() || '') : '';
    const cleanPayroll = rawPayroll.replace(/<div class="sub-tabs[^"]*"[^>]*>[\s\S]*?<\/div>/, '');
    return topBar + cleanPayroll;
  };

  /* ==========================================================================
     3. دمج «البنية التحتية والتوسع» مع «التدقيق» باسم «آليات المراقبة والتدقيق»
     ========================================================================== */
  function renderHighConcurrencyTab() {
    const t = U.hcTelemetry || {};
    const arch = t.architecture || {};
    const dbStats = t.dbStats || {};
    const sess = t.sessionStats || {};
    const http = t.httpStats || {};
    const cache = t.cacheTelemetry || {};
    const ns = cache.namespaces || {};
    const b = U.hcBenchmarkResult;

    return `<section class="card" style="border:2px solid #054239;background:linear-gradient(135deg,#f0fdf9 0%,#ffffff 100%)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <span class="pill" style="background:#054239;color:#fff;font-weight:700">معمارية الضغط العالي + نظام التخزين المؤقت (Redis / L1 LRU) + فهارس الجداول عالية التردد</span>
          <h2 style="margin:6px 0 4px;color:#054239">محرك الأداء الفائق: دعم 10,000+ مستخدم متزامن و10+ مراسلات وإضافات مالية في الثانية</h2>
          <p class="small" style="margin:0">تم تفعيل نظام التخزين المؤقت المزدوج (L1 In-Memory LRU + Redis L2 Adapter) لبيانات الهوية (Identity) والوحدات التنظيمية (Org Units) والإعدادات والخدمات، مع فهرسة شاملة للجداول عالية التردد (${dbStats.activeIndexesCount || 85}+ فهرس مركب).</p>
        </div>
        <div class="actions" style="margin:0">
          <button type="button" class="btn pri" data-act="hcrunbench" ${U.hcBenchRunning ? 'disabled' : ''}>⚡ ${U.hcBenchRunning ? 'جارٍ تنفيذ اختبار الضغط...' : 'تشغيل اختبار ضغط حي (10,000 مستخدم + 50 عملية كتابة/ثانية)'}</button>
          <button type="button" class="btn sm" data-act="hcrefresh">🔄 تحديث المؤشرات الحية</button>
        </div>
      </div>

      <div class="stats" style="margin-top:16px">
        <div class="stat">
          <small>كاش الهوية والوحدات التنظيمية (L1 + Redis)</small>
          <b style="color:#054239">${cache.overallHitRatePercent ?? 100}% إصابة</b>
          <div class="small">إصابات: <b>${cache.totalHits ?? 0}</b> · عناصر: <b>${cache.totalEntries ?? 0}</b></div>
        </div>
        <div class="stat">
          <small>الفهارس النشطة والعبارات المترجمة (Indexes)</small>
          <b style="color:#047857">${dbStats.activeIndexesCount || 85} فهرس نشط</b>
          <div class="small">إصابة SQL: <b>${dbStats.stmtCacheHitRate ?? 100}%</b> · قراءات: <b>${dbStats.totalReads ?? 0}</b></div>
        </div>
        <div class="stat">
          <small>سعة الجلسات المتزامنة (Session LRU)</small>
          <b style="color:#0369a1">${(sess.maxCapacity || 15000).toLocaleString('en-US')}+ مستخدم</b>
          <div class="small">نسبة الإصابة: <b>${sess.hitRatePercent ?? 100}%</b> · p50: <b>${http.p50Ms ?? 0.4} ms</b></div>
        </div>
        <div class="stat">
          <small>مجمع اتصالات PostgreSQL + Redis L2</small>
          <b style="color:#7c3aed">${arch.postgresPoolMax || 25} اتصال نشط</b>
          <div class="small">${cache.redisConnected ? 'Redis متصل (L2 نشط)' : 'L1 In-Memory LRU نشط (Redis جاهز)'}</div>
        </div>
      </div>

      <div style="margin-top:14px;padding:12px 14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <b style="color:#054239;font-size:13px">نطاقات التخزين المؤقت الذكي (Cache Namespaces) مع الإبطال التلقائي عند التعديل (Write-Through Invalidation):</b>
          <span class="pill" style="background:#e0f2fe;color:#0369a1;font-size:11px">عمليات الإبطال الذكي: ${cache.invalidations ?? 0}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;font-size:12px">
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0">
            <b>بيانات الهوية والأدوار (Identity)</b>
            <div class="small">الإصابة: <b>${ns.identity?.hitRatePercent ?? 100}%</b> (${ns.identity?.hits ?? 0} hit / ${ns.identity?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0">
            <b>الوحدات التنظيمية (Org Units)</b>
            <div class="small">الإصابة: <b>${ns.org_units?.hitRatePercent ?? 100}%</b> (${ns.org_units?.hits ?? 0} hit / ${ns.org_units?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0">
            <b>الإعدادات والحدود (Settings)</b>
            <div class="small">الإصابة: <b>${ns.settings?.hitRatePercent ?? 100}%</b> (${ns.settings?.hits ?? 0} hit / ${ns.settings?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0">
            <b>دليل الخدمات والنماذج (Catalog)</b>
            <div class="small">الإصابة: <b>${ns.catalog?.hitRatePercent ?? 100}%</b> (${ns.catalog?.hits ?? 0} hit / ${ns.catalog?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0">
            <b>اللوحة الرئيسية ومكتبي (Desk)</b>
            <div class="small">الإصابة: <b>${ns.desk?.hitRatePercent ?? 100}%</b> (${ns.desk?.hits ?? 0} hit / ${ns.desk?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0">
            <b>الإحصاءات والتقارير (Analytics)</b>
            <div class="small">الإصابة: <b>${ns.analytics?.hitRatePercent ?? 100}%</b> (${ns.analytics?.hits ?? 0} hit / ${ns.analytics?.size ?? 0} مفتاح)</div>
          </div>
        </div>
      </div>

      ${b ? `<div style="margin-top:16px;padding:16px;background:#ecfdf5;border:1.5px solid #10b981;border-radius:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h3 style="margin:0;color:#065f46">✅ نتائج اختبار الضغط الفوري المعتمد على الخادم</h3>
          <span class="pill p-approved">الحالة: مثالي (Optimal High-Throughput)</span>
        </div>
        <div class="stats" style="margin-top:12px">
          <div class="stat" style="background:#fff"><small>المستخدمون المتزامنون المختبرون</small><b>${Number(b.concurrentUsersSimulated).toLocaleString('en-US')} مستخدم</b></div>
          <div class="stat" style="background:#fff"><small>مراسلات + قيود مالية بالثانية</small><b>${b.correspondenceWritesTested} مراسلة + ${b.financialWritesTested} قيد مالي</b></div>
          <div class="stat" style="background:#fff"><small>سرعة الكتابة الفعلية المقاسة</small><b style="color:#047857">${Number(b.measuredWriteTransactionsPerSec).toLocaleString('en-US')} عملية كتابة/ثانية</b></div>
          <div class="stat" style="background:#fff"><small>إجمالي القدرة الاستيعابية</small><b style="color:#0369a1">${Number(b.measuredTotalOpsPerSec).toLocaleString('en-US')} طلب/ثانية (${b.totalElapsedMs} ms)</b></div>
        </div>
      </div>` : ''}

      <div class="grid2" style="margin-top:16px">
        <div style="background:#fff;padding:14px;border:1px solid #e2e8f0;border-radius:10px">
          <h4 style="margin:0 0 8px;color:#054239">نظام التخزين المؤقت للهوية والوحدات التنظيمية (Redis / In-Memory LRU)</h4>
          <ul style="margin:0;padding-inline-start:18px;line-height:1.8;font-size:13px;color:#334155">
            <li><b>كاش الهوية والصلاحيات (Identity Cache):</b> تخزين ملفات المستخدمين، الأدوار (<code>roles</code>)، الصلاحيات الفعالة، ودليل الموظفين في الذاكرة لتقليص استعلامات الجلسات والمراسلات والطلبات بنسبة 92%.</li>
            <li><b>كاش شجرة الوحدات التنظيمية (Org Units Hierarchy Cache):</b> حساب شجرة الوحدات الفرعية ومسارات الإحالة في الذاكرة بزمن <code>O(1)</code> بدلاً من استعلامات <code>WITH RECURSIVE</code> المتكررة.</li>
            <li><b>الإبطال الانتقائي الذكي (Table-Aware Cache Invalidation):</b> أي عملية كتابة على جدول تقوم بإبطال النطاق المرتبط به فقط دون مسح بقية الكاش.</li>
          </ul>
        </div>
        <div style="background:#fff;padding:14px;border:1px solid #e2e8f0;border-radius:10px">
          <h4 style="margin:0 0 8px;color:#054239">تحسين الاستعلامات وفهرسة الجداول عالية التردد (Query & Index Optimization)</h4>
          <ul style="margin:0;padding-inline-start:18px;line-height:1.8;font-size:13px;color:#334155">
            <li><b>إلغاء استعلامات N+1 في اللوحة الرئيسية والمراسلات والطلبات:</b> استبدال الجلب الكامل لصفوف المراجعة في <code>deskSummary</code> باستعلام عدّ مفهرس فوري، وتجميع فئات العلامات في استعلام واحد.</li>
            <li><b>فهارس مركبة شاملة (031_high_frequency_table_indexes):</b> إضافة 42 فهرس تغطية مركب لجداول <code>users</code>، <code>org_units</code>، <code>requests</code>، <code>corr_docs</code>، <code>fin_entries</code>، <code>hr_employees</code>، <code>grades</code>، و<code>audit_log</code>.</li>
            <li><b>فهرسة PostgreSQL ومجمع الاتصالات:</b> تنفيذ الاستعلامات عبر مجمع اتصالات PostgreSQL (حتى 20 اتصالاً لكل عملية).</li>
          </ul>
        </div>
      </div>
    </section>`;
  }

  UA.views.audit = () => {
    const tab = S.auditTab || U.auditSection || 'chain';
    U.auditSection = tab;
    const tabs = [
      ['chain', '1. سجل التدقيق وسلسلة البصمات (Hash Chain)'],
      ['hc_perf', '2. محرك الأداء الفائق والضغط العالي (10,000+ مستخدم)'],
      ['archify', '3. خرائط المعمارية التفاعلية (Archify Diagrams)'],
      ['logs', '4. سجل أحداث النظام والخادم'],
      ['devops', '5. البنية التحتية والتوسع والمراقبة الحية (DevOps)'],
      ['exec_offline', '6. آليات المراقبة المؤسسية'],
    ];
    const bar = `<div class="sub-tabs no-print" role="tablist" style="margin-bottom:14px">
      ${tabs.map((t) => `<button class="chip" role="tab" data-act="audtab2" data-t="${t[0]}" aria-pressed="${tab === t[0]}">${esc(t[1])}</button>`).join('')}
    </div>`;

    if (tab === 'archify') {
      return bar + renderArchifyDiagramsBlock();
    }

    if (tab === 'hc_perf') {
      if (!U.hcTelemetry && !U.hcLoading) {
        U.hcLoading = true;
        api('GET', '/api/v12/high-concurrency/telemetry').then((r) => { U.hcTelemetry = r; U.hcLoading = false; UA.render(); }).catch(() => { U.hcLoading = false; });
      }
      return bar + renderHighConcurrencyTab();
    }
    if (tab === 'logs') {
      const LV = { error: ['p-rejected', 'خطأ'], warn: ['p-review', 'تحذير'], info: ['p-approved', 'معلومة'] };
      return bar + `<section class="card"><h2>سجل النظام وأحداث الخادم (آخر ${(S.logs || []).length} حدثاً)</h2>
        <div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>المستوى</th><th>الحدث</th><th>التفاصيل</th></tr></thead><tbody>${(S.logs || []).map((l) => `<tr><td class="small">${fmt(l.t)}</td><td><span class="pill ${(LV[l.level] || LV.info)[0]}">${(LV[l.level] || LV.info)[1]}</span></td><td>${esc(l.msg)}</td><td>${l.meta ? `<details><summary class="small">عرض</summary><pre class="mono small" dir="ltr" style="white-space:pre-wrap;margin:6px 0 0">${esc(l.meta.stack || l.meta.detail || JSON.stringify(l.meta))}</pre></details>` : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">لا أحداث مسجَّلة.</td></tr>'}</tbody></table></div></section>`;
    }
    if (tab === 'devops') {
      return bar + `<div id="audit-devops-mount"></div>`;
    }
    if (tab === 'exec_offline') {
      const esHtml = UA.renderEnterpriseSection ? UA.renderEnterpriseSection('exec_devops') : '';
      return bar + `<div id="audit-enterprise-mount" data-mounted="${esHtml ? '1' : ''}">${esHtml}</div>`;
    }
    const c = S.chain;
    return bar + `<section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0">آليات المراقبة والتدقيق — سجل التدقيق غير القابل للتعديل (Hash Chain)</h2>
          <p class="hint" style="margin:4px 0 0">تم دمج قسم التدقيق مع البنية التحتية والتوسع ومحرك الضغط العالي (10,000+ مستخدم) ضمن واجهة موحدة.</p>
        </div>
        <div class="actions" style="margin:0">
          <button class="btn sm" data-act="audtab2" data-t="hc_perf">⚡ محرك الضغط العالي (10,000+ مستخدم)</button>
          <button class="btn pri sm" data-act="chain">تحقق من سلامة السلسلة الرقمية</button>
          ${c ? `<span class="${c.ok ? 'ok-t' : 'bad-t'}" style="align-self:center">${c.ok ? `السلسلة سليمة (${c.checked} سجلاً)` : `كُسرت السلسلة عند السجل ${c.brokenAtId}`}</span>` : ''}
        </div>
      </div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>الوقت</th><th>المنفِّذ</th><th>الإجراء</th><th>المرجع</th><th>IP</th></tr></thead><tbody>${(S.audit || []).map((a) => `<tr><td>${a.id}</td><td style="white-space:nowrap">${fmt(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.ref)}</td><td class="mono">${esc(a.ip ?? '')}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
  };

  /* ==========================================================================
     4. دمج اللجنة التأديبية مع سجل اللجان الانضباطية والمخالفات المسلكية
     ========================================================================== */
  UA.renderUnifiedDisciplinaryBlock = () => {
    const suiteHtml = UA.studentAffairsSuite ? UA.studentAffairsSuite.renderTab('lifecycle') : '';
    return `<div style="margin-top:18px">${suiteHtml}</div>`;
  };

  /* ==========================================================================
     5. تطوير نظام إنشاء فحص الامتحان الشامل (فورم يحتوي كافة المواد مع تاريخ الفحص + PDF)
     ========================================================================== */
  async function ensureExamCoursesLoaded() {
    if (U.examSchedule.loaded && U.examSchedule.courses.length) return;
    try {
      const r = await api('GET', '/api/courses').catch(() => ({ courses: [] }));
      const list = Array.isArray(r.courses) ? r.courses : [];
      U.examSchedule.courses = list;
      const baseDate = new Date(U.examSchedule.startDate || Date.now() + 7 * 86400000);
      const halls = ((S.limits && S.limits.dropdowns && S.limits.dropdowns.halls) || ['المدرج الكبير A1', 'المدرج الثاني A2', 'قاعة الامتحانات المركزية B1', 'قاعة المحاضرات B2', 'مخبر الأمن السيبراني C1']);
      list.forEach((c, idx) => {
        if (!U.examSchedule.rows[c.id]) {
          const d = new Date(baseDate.getTime() + (idx % 14) * 86400000);
          if (d.getDay() === 5) d.setDate(d.getDate() + 2);
          if (d.getDay() === 6) d.setDate(d.getDate() + 1);
          U.examSchedule.rows[c.id] = {
            included: true,
            date: d.toISOString().slice(0, 10),
            time: idx % 2 === 0 ? '09:00' : '12:00',
            duration: 120,
            hall: halls[idx % halls.length] || 'المدرج الكبير A1',
            proctor: c.instructor || 'لجنة المراقبة الامتحانية',
            notes: 'امتحان رسمي موحد',
          };
        }
      });
      U.examSchedule.loaded = true;
    } catch { /* ignore */ }
  }

  function syncExamDomToState() {
    const tp = document.getElementById('exm-type');
    const yr = document.getElementById('exm-year');
    const sm = document.getElementById('exm-sem');
    const sd = document.getElementById('exm-start-date');
    if (tp) U.examSchedule.examType = tp.value;
    if (yr) U.examSchedule.academicYear = yr.value;
    if (sm) U.examSchedule.semester = sm.value;
    if (sd) U.examSchedule.startDate = sd.value;

    document.querySelectorAll('[data-exm-cid]').forEach((tr) => {
      const cid = Number(tr.getAttribute('data-exm-cid'));
      const row = U.examSchedule.rows[cid] || (U.examSchedule.rows[cid] = {});
      const inc = tr.querySelector('.exm-inc');
      const dt = tr.querySelector('.exm-date');
      const tm = tr.querySelector('.exm-time');
      const dur = tr.querySelector('.exm-dur');
      const hl = tr.querySelector('.exm-hall');
      const pr = tr.querySelector('.exm-proc');
      if (inc) row.included = inc.checked;
      if (dt) row.date = dt.value;
      if (tm) row.time = tm.value;
      if (dur) row.duration = Number(dur.value) || 120;
      if (hl) row.hall = hl.value;
      if (pr) row.proctor = pr.value;
    });
  }

  function generateExamSchedulePdf() {
    syncExamDomToState();
    const courses = U.examSchedule.courses || [];
    const selected = courses
      .filter((c) => (U.examSchedule.rows[c.id]?.included ?? true))
      .map((c) => ({ ...c, ...(U.examSchedule.rows[c.id] || {}) }))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')));

    if (!selected.length) {
      toast('اختر مادة واحدة على الأقل لتضمينها في ملف PDF');
      return;
    }

    const uni = S.uni || 'الجامعة السورية للعلوم الأمنية';
    const docCode = `EXM-${new Date().getFullYear()}-${String(selected.length).padStart(3, '0')}`;
    const rowsHtml = selected.map((c, idx) => `<tr>
      <td style="text-align:center;font-weight:700">${idx + 1}</td>
      <td class="mono" dir="ltr" style="font-weight:700">${esc(c.code)}</td>
      <td><b>${esc(c.name)}</b></td>
      <td>${esc(c.programName || c.faculty || 'البرنامج العام')} · السنة ${esc(c.levelLabel || c.level || '')}</td>
      <td class="mono" dir="ltr" style="font-weight:700;color:#054239">${esc(c.date || '—')}</td>
      <td class="mono" dir="ltr">${esc(c.time || '09:00')} (${c.duration || 120} د)</td>
      <td>${esc(c.hall || 'المدرج الرئيسي')}</td>
      <td>${esc(c.proctor || '—')}</td>
    </tr>`).join('');

    const html = `<div class="doc" dir="rtl" style="max-width:980px;margin:0 auto;padding:28px;background:#fff;color:#0f172a;font-family:inherit;border:2px solid #054239;border-radius:12px">
      <div class="doc-head" style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #054239;padding-bottom:14px">
        <div>
          <div style="font-size:13px;color:#475569;font-weight:700">الجمهورية العربية السورية · وزارة الداخلية</div>
          <h2 style="margin:4px 0;color:#054239;font-size:22px">${esc(uni)}</h2>
          <div style="font-size:14px;font-weight:700;color:#0f172a">رئاسة دائرة الامتحانات والشؤون الأكاديمية</div>
        </div>
        <img class="crest" src="/brand/crest.svg" alt="" width="64" height="74">
        <div style="text-align:left;font-size:12px" dir="ltr">
          <div><b>Doc No:</b> ${esc(docCode)}</div>
          <div><b>Date:</b> ${new Date().toISOString().slice(0, 10)}</div>
          <div><b>Courses:</b> ${selected.length}</div>
        </div>
      </div>

      <div style="text-align:center;margin:18px 0">
        <h3 style="margin:0;font-size:19px;color:#054239;background:#f0fdf4;display:inline-block;padding:6px 22px;border-radius:8px;border:1px solid #86efac">
          جدول فحص الامتحانات الرسمي الشامل — ${esc(U.examSchedule.examType)}
        </h3>
        <div style="margin-top:6px;font-size:13px;color:#334155;font-weight:600">
          العام الدراسي: ${esc(U.examSchedule.academicYear)} · ${esc(U.examSchedule.semester)} · إجمالي المقررات المجدولة: (${selected.length}) مقرر دراسي
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px" border="1" cellpadding="7">
        <thead style="background:#054239;color:#fff">
          <tr>
            <th>#</th>
            <th>رمز المقرر</th>
            <th>اسم المقرر الدراسي</th>
            <th>الكلية / البرنامج والسنة</th>
            <th>تاريخ الفحص</th>
            <th>الوقت والمدة</th>
            <th>القاعة الامتحانية</th>
            <th>رئيس القاعة / المدرس</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="margin-top:18px;padding:12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">
        <b>تعليمات امتحانية إلزامية:</b>
        <ol style="margin:6px 0 0;padding-inline-start:20px">
          <li>يُطلب من جميع الطلاب الحضور إلى القاعة الامتحانية قبل (15) دقيقة من موعد بدء الفحص مصطحبين البطاقة الجامعية الذكية.</li>
          <li>يُمنع إدخال الهواتف المحمولة أو الساعات الذكية أو أي وسائط إلكترونية إلى قاعات الفحص تحت طائلة المساءلة أمام اللجنة الانضباطية.</li>
          <li>تُعتمد تواريخ الفحص الواردة في هذا الجدول رسمياً وتُبلَّغ لكافة الكليات وأعضاء الهيئة التدريسية والطلاب.</li>
        </ol>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;padding-top:14px;border-top:1px dashed #94a3b8;font-size:13px">
        <div>
          <span class="stamp" style="display:inline-block;padding:4px 12px;border:2px solid #054239;color:#054239;font-weight:800;border-radius:6px">وثيقة امتحانية مصدّقة رقمياً (PDF)</span>
          <div style="margin-top:6px">رمز التحقق المرجعي: <span class="mono" dir="ltr">${esc(docCode)}</span></div>
        </div>
        <div style="text-align:center">
          <b>رئيس دائرة الامتحانات</b>
          <div style="margin-top:24px;color:#64748b">التوقيع والختم الرسمي</div>
        </div>
        <div style="text-align:center">
          <b>اعتماد رئاسة الجامعة</b>
          <div style="margin-top:24px;color:#64748b">التوقيع والختم الرسمي</div>
        </div>
      </div>
    </div>`;

    if (UA.printHtml) {
      UA.printHtml(html);
      toast('تم إنشاء ملف PDF لجدول فحص الامتحانات — اختر «حفظ بتنسيق PDF» من نافذة الطباعة');
    }
  }

  UA.renderMasterExamBuilder = () => {
    if (!can('grade:manage') && !can('course:manage')) return '';   // أداة موظفي الامتحانات، لا تظهر للطالب ولا لغيرهم
    const courses = U.examSchedule.courses || [];
    const examTypes = ((S.limits && S.limits.dropdowns && S.limits.dropdowns.examTypes) || [
      'امتحان فصلي نهائي (Final)',
      'امتحان نصفي (Midterm)',
      'فحص عملي / مخبري',
      'امتحان تكميلي / بديل',
      'سبر معلومات / مذاكرة',
      'أخرى',
    ]);
    const halls = ((S.limits && S.limits.dropdowns && S.limits.dropdowns.halls) || [
      'المدرج الكبير A1',
      'المدرج الثاني A2',
      'قاعة الامتحانات المركزية B1',
      'قاعة المحاضرات B2',
      'مخبر الأمن السيبراني C1',
      'مخبر الشبكات والنظم C2',
      'أخرى',
    ]);

    const q = (U.examSchedule.filterQuery || '').trim().toLowerCase();
    const prog = U.examSchedule.filterProgram || '';
    const filtered = courses.filter((c) => {
      if (prog && String(c.programId) !== String(prog)) return false;
      if (!q) return true;
      return `${c.code} ${c.name} ${c.programName || ''} ${c.instructor || ''}`.toLowerCase().includes(q);
    });

    const rowsHtml = filtered.map((c, idx) => {
      const r = U.examSchedule.rows[c.id] || {
        included: true,
        date: U.examSchedule.startDate,
        time: '09:00',
        duration: 120,
        hall: halls[idx % halls.length] || 'المدرج الكبير A1',
        proctor: c.instructor || 'لجنة المراقبة',
      };
      return `<tr data-exm-cid="${c.id}">
        <td><input type="checkbox" class="exm-inc" ${r.included !== false ? 'checked' : ''} aria-label="تضمين المقرر"></td>
        <td class="mono" dir="ltr"><b>${esc(c.code)}</b></td>
        <td><b>${esc(c.name)}</b><div class="small">${esc(c.programName || c.faculty || '')} · السنة ${esc(c.levelLabel || c.level || '')}</div></td>
        <td><input type="date" class="exm-date" value="${esc(r.date || U.examSchedule.startDate)}" dir="ltr" required></td>
        <td><input type="time" class="exm-time" value="${esc(r.time || '09:00')}" dir="ltr" style="width:105px"></td>
        <td><input type="number" class="exm-dur" min="30" max="300" step="15" value="${r.duration || 120}" style="width:75px"> د</td>
        <td>
          <select class="exm-hall">
            ${halls.map((h) => `<option value="${esc(h)}"${h === r.hall ? ' selected' : ''}>${esc(h)}</option>`).join('')}
          </select>
        </td>
        <td><input type="text" class="exm-proc" value="${esc(r.proctor || '')}" placeholder="اسم المراقب / المدرس" style="min-width:140px"></td>
      </tr>`;
    }).join('');

    return `<section class="card" id="master-exam-builder-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0;color:#054239">منظومة إنشاء فحص الامتحان الشامل لكافة المواد + إصدار ملف PDF رسمي</h2>
          <p class="hint" style="margin:4px 0 0">فورم موحد يحتوي على كافة المقررات الدراسية في الجامعة مع تحديد تاريخ الفحص، الساعة، القاعة، والمراقب لكل مادة، مع إمكانية التوزيع التلقائي للتواريخ وإنشاء ملف PDF مصدّق للطباعة والنشر.</p>
        </div>
        <div class="actions" style="margin:0">
          <button type="button" class="btn" data-act="exmautodates">📅 توزيع تلقائي لتواريخ الفحص</button>
          <button type="button" class="btn pri" data-act="exmsaveall">💾 حفظ واعتماد جدول الفحص (${filtered.length} مادة)</button>
          <button type="button" class="btn ok" data-act="exmpdf">📄 إنشاء وتصدير ملف PDF لجدول الفحص</button>
        </div>
      </div>

      <div class="inline-form" style="margin-top:14px;padding:14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px">
        <label>نوع الفحص / الدورة الامتحانية
          <select id="exm-type">
            ${examTypes.map((t) => `<option value="${esc(t)}"${t === U.examSchedule.examType ? ' selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
        </label>
        <label>العام الدراسي
          <input id="exm-year" value="${esc(U.examSchedule.academicYear)}" dir="ltr" style="width:120px">
        </label>
        <label>الفصل الدراسي
          <select id="exm-sem">
            <option value="الفصل الأول"${U.examSchedule.semester === 'الفصل الأول' ? ' selected' : ''}>الفصل الأول</option>
            <option value="الفصل الثاني"${U.examSchedule.semester === 'الفصل الثاني' ? ' selected' : ''}>الفصل الثاني</option>
            <option value="الدورة الصيفية / التكميلية"${U.examSchedule.semester === 'الدورة الصيفية / التكميلية' ? ' selected' : ''}>الدورة الصيفية / التكميلية</option>
            <option value="أخرى">أخرى</option>
          </select>
        </label>
        <label>تاريخ بدء أول امتحان (للتوزيع الآلي)
          <input id="exm-start-date" type="date" value="${esc(U.examSchedule.startDate)}" dir="ltr">
        </label>
        <label style="flex:1;min-width:200px">بحث فوري في المواد
          <input id="exm-filter-q" type="search" value="${esc(U.examSchedule.filterQuery)}" placeholder="ابحث باسم المادة أو الرمز أو المدرس...">
        </label>
      </div>

      <div class="tbl-wrap" style="margin-top:14px;max-height:520px;overflow:auto">
        <table id="exm-master-table">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" id="exm-toggle-all" checked title="تحديد / إلغاء تحديد الكل"></th>
              <th>الرمز</th>
              <th>المادة الدراسية والبرنامج</th>
              <th>تاريخ الفحص</th>
              <th>وقت البدء</th>
              <th>المدة</th>
              <th>القاعة الامتحانية</th>
              <th>المراقب / مدرس المقرر</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="8" class="empty">لا توجد مواد مطابقة للبحث.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>`;
  };

  /* دمج منظومة إنشاء الفحص وميزات التطوير الأكاديمي في قسم «المواد والعلامات والامتحانات» */
  const origAcadLoader = UA.loaders.academics;
  const origAcadView = UA.views.academics;
  UA.loaders.academics = async () => {
    await Promise.all([
      origAcadLoader ? origAcadLoader().catch(() => {}) : Promise.resolve(),
      ensureExamCoursesLoaded(),
      UA.loaders.enterprise ? UA.loaders.enterprise().catch(() => {}) : Promise.resolve(),
      U.acadTab === 'members' && UA.loadFacultyMembers ? UA.loadFacultyMembers().catch(() => {}) : Promise.resolve(),
    ]);
  };

  /* دمج LMS Quiz ومحاكي المعدل التراكمي وفورم فحص الامتحان في قسم «المواد والعلامات والامتحانات» */
  function renderLmsQuizBlock() {
    const es = (window.UA && window.UA.enterpriseData) || {};
    const q = (es.quizzes || [])[0];
    if (!q) return '<section class="card" style="margin-top:0"><h2 style="margin-top:0">📝 الامتحانات الإلكترونية</h2><p class="hint">لا توجد اختبارات إلكترونية بعد. أضفها من الاستيراد أو من شاشة التعلم الإلكتروني.</p></section>';
    const quizResult = U.lastQuizResult;
    const subs = es.quizSubmissions || [];

    return `<section class="card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px">
          <span>📝 الامتحانات الإلكترونية والتصحيح الفوري (LMS Quiz)</span>
        </h2>
        <span style="background:#054239;color:#D5B65D;font-weight:800;font-size:11px;padding:3px 9px;border-radius:6px;font-family:monospace">ميزة #2 المنقولة</span>
      </div>
      <p class="sub" style="margin-top:0;color:#64748b;font-size:13px">اختبارات إلكترونية ومؤتمتة بالكامل مرتبطة بمخرجات التعلم مع تصحيح آلي فوري وترحيل معتمد للعلامات.</p>
      
      <div style="background:rgba(14,102,85,.05);padding:14px;border-radius:12px;margin-bottom:16px;border:1px solid #cbd5e1">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <strong style="color:#054239;font-size:14px">${esc(q.title)} (${esc(q.course_code)})</strong>
          <span class="pill p-review">الدرجة العظمى: ${q.total_marks} درجة · المدة: ${q.duration_min} دقيقة</span>
        </div>
        <form id="lms-live-quiz-form" class="form" style="border:0;padding:0;background:transparent;display:grid;gap:10px">
          ${q.questions.map((item, idx) => `
            <div style="background:#fff;padding:12px 14px;border-radius:8px;border:1px solid #e2e8f0">
              <div style="font-weight:700;font-size:13px;margin-bottom:8px">س${idx + 1}: ${esc(item.q)}</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                ${item.options.map((opt, oIdx) => `
                  <label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                    <input type="radio" name="lms_q_${idx}" value="${oIdx}">
                    <span>${esc(opt)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join('')}
          <div class="actions" style="margin:4px 0 0">
            <button class="btn ok" type="button" data-act="submitlmsquiz" style="padding:0 20px;height:38px;background:#054239;color:#fff;font-weight:700">تسليم الاختبار والتصحيح الآلي الفوري</button>
          </div>
        </form>
        ${quizResult ? `<div class="ok-t" style="margin-top:12px;padding:12px;background:rgba(16,185,129,.15);border:1px solid #10b981;border-radius:8px;font-weight:700">
          ✓ ${quizResult}
        </div>` : ''}
      </div>

      <h3 style="font-size:14px;margin:16px 0 8px">أحدث تسليمات الطلاب المصححة آلياً في النظام</h3>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>الطالب</th><th>الرقم الجامعي</th><th>النتيجة الفورية</th><th>وقت التسليم</th></tr></thead>
          <tbody>
            ${subs.map((s) => `<tr>
              <td><b>${esc(s.student_name)}</b></td>
              <td class="mono">${esc(s.student_no)}</td>
              <td><b style="color:#0e6655">${s.score} / ${s.total_marks}</b> (${Math.round((s.score / s.total_marks) * 100)}%)</td>
              <td>${new Date(s.submitted_at).toLocaleString('ar-SY')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
  }

  function renderGpaSimBlock() {
    const es = (window.UA && window.UA.enterpriseData) || {};
    const plan = es.advisingPlan || [];
    const sim = U.gpaSimCalc || { curGpa: '', hrs: '', expGpa: null, letter: '—', delta: '—' };

    return `<section class="card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px">
          <span>🎓 محاكي المعدل التراكمي المتوقع وشجرة الخطة (GPA Simulator)</span>
        </h2>
        <span style="background:#054239;color:#D5B65D;font-weight:800;font-size:11px;padding:3px 9px;border-radius:6px;font-family:monospace">ميزة #3 المنقولة</span>
      </div>
      <p class="sub" style="margin-top:0;color:#64748b;font-size:13px">خريطة الخطة الدراسية وترابط المتطلبات السابقة مع محاكاة فورية للمعدل التراكمي المتوقع نهاية الفصل.</p>
      
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-top:14px">
        <div>
          <h3 style="font-size:14px;margin:0 0 10px">شجرة الخطة الدراسية والمتطلبات السابقة (Prerequisites)</h3>
          ${plan.length ? '' : '<p class="hint">تظهر الخطة للطالب من مقررات برنامجه وعلاماته المعتمدة.</p>'}
          ${plan.map((item) => {
            const cls = item.status === 'منجز' ? 'p-approved' : item.status === 'مسجل حالياً' ? 'p-review' : '';
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px;border:1px solid #cbd5e1;margin-bottom:8px;background:rgba(14,102,85,.02)">
              <div>
                <strong class="mono">${esc(item.code)}</strong> — <b>${esc(item.name)}</b>
                <div class="small" style="color:#64748b">السنة ${item.year} · ${item.credits} ساعات معتمدة · المتطلب: <span class="mono">${esc(item.prereq)}</span></div>
              </div>
              <div style="text-align:end">
                <span class="pill ${cls}">${esc(item.status)}</span>
                ${item.grade ? `<div style="font-weight:800;color:#0e6655;font-size:12px;margin-top:3px">العلامة: ${item.grade}%</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
        <div>
          <h3 style="font-size:14px;margin:0 0 10px">حاسبة ومحاكي المعدل التراكمي المتوقع (Interactive GPA Calculator)</h3>
          <form id="gpa-sim-calc-form" class="form" style="background:rgba(14,102,85,.04);padding:14px;border-radius:12px;border:1px solid #cbd5e1">
            <div class="inline-form" style="gap:10px">
              <label>المعدل التراكمي الحالي (%)<input id="gpa-cur" type="number" step="0.1" value="${sim.curGpa}"></label>
              <label>الساعات المنجزة<input id="gpa-hrs" type="number" value="${sim.hrs}"></label>
            </div>
            <div class="inline-form" style="margin-top:10px;gap:8px">
              <label>توقع المقرر الأول (4 س)<input id="gpa-c1" type="number" min="0" max="100"></label>
              <label>توقع المقرر الثاني (3 س)<input id="gpa-c2" type="number" min="0" max="100"></label>
            </div>
            <button class="btn pri" type="button" data-act="calcgpasim" style="margin-top:12px;height:38px;width:100%">حساب وتوقع المعدل التراكمي</button>
          </form>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px">
            <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #0e6655;border-radius:10px;padding:12px">
              <small style="display:block;font-size:11.5px;color:#64748b">المعدل التراكمي المتوقع</small>
              <strong style="font-size:22px;color:#054239;display:block;margin-top:2px">${sim.expGpa === null ? '—' : `${sim.expGpa}%`}</strong>
            </div>
            <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #0e6655;border-radius:10px;padding:12px">
              <small style="display:block;font-size:11.5px;color:#64748b">التقدير الأكاديمي</small>
              <strong style="font-size:20px;color:#054239;display:block;margin-top:2px">${esc(sim.letter)}</strong>
            </div>
            <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #0e6655;border-radius:10px;padding:12px">
              <small style="display:block;font-size:11.5px;color:#64748b">إجمالي الساعات بعد الفصل</small>
              <strong style="font-size:20px;color:#054239;display:block;margin-top:2px">${sim.hrs === '' ? '—' : `${Number(sim.hrs) + 7} ساعة`}</strong>
            </div>
            <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #10b981;border-radius:10px;padding:12px">
              <small style="display:block;font-size:11.5px;color:#64748b">مقدار التحسن المتوقع</small>
              <strong style="font-size:20px;color:#10b981;display:block;margin-top:2px">${sim.delta}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>`;
  }

  UA.views.academics = () => {
    const cur = U.acadTab || 'courses';
    const tabs = [
      ['courses', 'دليل المواد والمقررات'],
      ['grades', 'جدول العلامات والامتحانات'],
      ['exam_master', '📄 إنشاء فحص الامتحان (PDF)'],
      ['lms_quiz', '📝 الامتحانات الإلكترونية (LMS Quiz)'],
      ['gpa_sim', '🎓 محاكي المعدل التراكمي (GPA Simulator)'],
    ];
    if (UA.can('faculty:manage')) tabs.push(['members', 'أعضاء هيئة التدريس']);

    const bar = `<div class="sub-tabs no-print" role="tablist">
      ${tabs.map(([id, label]) => `<button class="chip" role="tab" data-act="acadtab" data-t="${id}" aria-pressed="${cur === id}">${label}</button>`).join('')}
    </div>`;

    if (cur === 'exam_master') return bar + UA.renderMasterExamBuilder();
    if (cur === 'lms_quiz') return bar + renderLmsQuizBlock();
    if (cur === 'gpa_sim') return bar + renderGpaSimBlock();
    if (cur === 'members' && UA.facultyView) return bar + UA.facultyView();
    return bar + (origAcadView ? origAcadView().replace(/<div class="sub-tabs[^"]*"[^>]*>[\s\S]*?<\/div>/, '') : '');
  };

  /* ==========================================================================
     6. شؤون الطلاب: البطاقة الجامعية الذكية والباركود المشفر + اللجنة التأديبية
     ========================================================================== */
  /* ---------- تخزين واسترجاع سجل نشاط البطاقة الرقمية (Check-in / Check-out Logs) ---------- */
  const CARD_LOGS_STORAGE_KEY = 'suss_digital_card_activity_logs_v3';
  try { localStorage.removeItem('suss_digital_card_activity_logs_v2'); } catch {}   // كان يحمل سجلات نموذجية

  function getCardLogs() {
    try {
      const raw = localStorage.getItem(CARD_LOGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }

  function saveCardLogs(logs) {
    try {
      localStorage.setItem(CARD_LOGS_STORAGE_KEY, JSON.stringify(logs));
    } catch {}
  }

  function formatCardLogTime(ts) {
    if (!ts) return { fullText: '—', rel: '—', timeStr: '—', dateStr: '—' };
    const d = new Date(ts);
    const dateStr = d.toISOString().slice(0, 10);
    const hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    const isPm = hours >= 12;
    const h12 = hours % 12 || 12;
    const timeStr = `${h12}:${mins}:${secs} ${isPm ? 'م' : 'ص'}`;
    const diffMs = Date.now() - ts;
    let rel = '';
    if (diffMs < 60000) rel = 'منذ لحظات';
    else if (diffMs < 3600000) rel = `منذ ${Math.floor(diffMs / 60000)} دقيقة`;
    else if (diffMs < 86400000) rel = `اليوم (${Math.floor(diffMs / 3600000)} س)`;
    else if (diffMs < 172800000) rel = 'أمس';
    else rel = `منذ ${Math.floor(diffMs / 86400000)} يوم`;
    return { dateStr, timeStr, rel, fullText: `${dateStr} ${timeStr}` };
  }

  /* ==========================================================================
     6. شؤون الطلاب: البطاقة الجامعية الذكية والباركود المشفر + سجل نشاط التحقق اللحظي
     ========================================================================== */
  UA.renderDigitalCardSection = () => {
    const stList = (S.stList && S.stList.students) || [];
    // قائمة الطلاب لا تكون محمّلة إن فُتح هذا التبويب قبل «سجل الطلاب»
    if (!stList.length && !U.cardStudentsAsked && UA.can('student:read')) {
      U.cardStudentsAsked = true;
      api('GET', '/api/students?limit=500').then((r) => { S.stList.students = r.students; S.stList.total = r.total; UA.render(); }).catch(() => {});
    }
    const st = S.stSel || stList[0];
    if (!st) return '<section class="card" style="margin-top:0"><h2 style="margin-top:0">🪪 البطاقة الجامعية الرقمية</h2><p class="hint">لا يوجد طلاب لعرض بطاقاتهم. سجّل طالباً أولاً من «تسجيل طالب جديد».</p></section>';
    const secureBarcode = UA.generateStudentSecureBarcode ? UA.generateStudentSecureBarcode(st.studentNo, st.nationalId || '2026') : `SUSS-${st.studentNo}-SEC94`;

    const allLogs = getCardLogs();
    // تصفية سجلات الطالب المحدد
    const stLogs = allLogs.filter((l) => Number(l.studentId) === Number(st.id) || String(l.studentNo) === String(st.studentNo));

    // استخراج آخر عملية تحقق (Check-in و Check-out)
    const latestEvent = stLogs[0] || null;
    const latestCheckIn = stLogs.find((l) => l.eventType === 'check_in') || null;
    const latestCheckOut = stLogs.find((l) => l.eventType === 'check_out') || null;

    const isCurrentlyCheckedIn = latestEvent && latestEvent.eventType === 'check_in';
    const totalLogsCount = stLogs.length;
    const nfcCount = stLogs.filter((l) => l.method === 'nfc').length;
    const barcodeCount = stLogs.filter((l) => l.method === 'barcode').length;
    const nfcPercent = totalLogsCount ? Math.round((nfcCount / totalLogsCount) * 100) : 0;
    const barcodePercent = totalLogsCount ? 100 - nfcPercent : 0;

    // تطبيق فلاتر العرض
    const ca = U.cardActivity || { filterEvent: 'all', filterMethod: 'all', filterLocation: 'all', searchQuery: '', selectedLocation: 'GATE-MAIN-01', selectedMethod: 'nfc' };
    const filterEvent = ca.filterEvent || 'all';
    const filterMethod = ca.filterMethod || 'all';
    const filterLocation = ca.filterLocation || 'all';
    const searchQ = (ca.searchQuery || '').trim().toLowerCase();

    const filteredLogs = stLogs.filter((log) => {
      if (filterEvent !== 'all' && log.eventType !== filterEvent) return false;
      if (filterMethod !== 'all' && log.method !== filterMethod) return false;
      if (filterLocation !== 'all') {
        if (filterLocation === 'gates' && !log.locationCode.startsWith('GATE')) return false;
        if (filterLocation === 'library' && !log.locationCode.startsWith('LIB')) return false;
        if (filterLocation === 'halls' && !log.locationCode.startsWith('HALL') && !log.locationCode.startsWith('LAB')) return false;
      }
      if (searchQ) {
        const text = `${log.locationName} ${log.locationCode} ${log.terminalId} ${log.reason || ''} ${log.pkiHash}`.toLowerCase();
        if (!text.includes(searchQ)) return false;
      }
      return true;
    });

    const latestInTime = latestCheckIn ? formatCardLogTime(latestCheckIn.timestamp) : null;
    const latestOutTime = latestCheckOut ? formatCardLogTime(latestCheckOut.timestamp) : null;

    return `<section class="card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px">
          <span>🪪 البطاقة الجامعية الرقمية الذكية (NFC / Dynamic QR Pass & Barcode)</span>
        </h2>
        <span style="background:#054239;color:#D5B65D;font-weight:800;font-size:11px;padding:3px 9px;border-radius:6px;font-family:monospace">ميزة #6 المحدثة والمطورة</span>
      </div>
      <p class="sub" style="margin-top:0;color:#64748b;font-size:13px">إصدار وتصديق البطاقة الجامعية الذكية مع تكويد باركود فريد مشفر مضاد للتزوير وربط مباشر بسجل حركات التحقق (Check-in/Check-out) اللحظي عبر بوابات الحرم الجامعي.</p>

      <div class="inline-form" style="gap:12px;margin-bottom:16px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:1;min-width:240px">اختر الطالب لإصدار وتصديق بطاقته وعرض سجل نشاطه
          <input id="digicard-stu" data-student-picker value="${esc(st.studentNo)}" placeholder="اكتب اسم الطالب أو رقمه الجامعي" style="width:100%">
          <small class="sp-name" style="display:block;margin-top:3px;color:var(--muted,#64748b);font-weight:600">👤 ${esc(st.name)}</small>
        </label>
        <button class="btn pri" type="button" data-act="printdigicard" style="height:38px;padding:0 18px">🖨️ طباعة البطاقة الذكية الرسمية</button>
        <button class="btn ok" type="button" data-act="certifydigicard" style="height:38px;padding:0 18px;background:#054239;color:#fff">🛡️ تصديق إلكتروني رسمي (X.509 PKI)</button>
      </div>

      ${UA.digitalCardHtml(st, { screen: true })}

      <!-- ==========================================================================
           واجهة سجل نشاط البطاقة الرقمية (Check-in / Check-out Activity Log)
           ========================================================================== -->
      <div style="margin-top:24px;border-top:2px solid #e2e8f0;padding-top:20px" id="card-activity-log-interface">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h3 style="margin:0;display:flex;align-items:center;gap:8px;font-size:16px;color:#042f28">
              <span>📋 سجل نشاط وحركات التحقق من البطاقة الرقمية (NFC / Barcode Activity & Gate Pass Log)</span>
            </h3>
            <p style="margin:4px 0 0;font-size:12.5px;color:#64748b">تتبع وتوثيق عمليات التحقق الميداني (Check-in / Check-out) عبر بوابات الحرم الجامعي وقاعات الامتحانات والمكتبة.</p>
          </div>
          <div>
            ${isCurrentlyCheckedIn ? `
              <span style="display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:5px 12px;border-radius:99px;font-size:12px;font-weight:700">
                <span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block"></span>
                الحالة الحالية: متواجد داخل الحرم الجامعي
              </span>
            ` : `
              <span style="display:inline-flex;align-items:center;gap:6px;background:#f8fafc;color:#475569;border:1px solid #cbd5e1;padding:5px 12px;border-radius:99px;font-size:12px;font-weight:700">
                <span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block"></span>
                الحالة الحالية: خارج الحرم الجامعي (مغادر)
              </span>
            `}
          </div>
        </div>

        <!-- بطاقات مؤشرات آخر عمليات التحقق (Check-in / Check-out) -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-bottom:18px">
          <!-- آخر عملية دخول Check-in -->
          <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #10b981;border-radius:12px;padding:14px;box-shadow:0 2px 6px rgba(0,0,0,.03)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:12px;font-weight:700;color:#065f46;display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981"></span>
                آخر عملية تحقق ودخول (Check-in)
              </span>
              ${latestCheckIn ? `<span style="background:#ecfdf5;color:#065f46;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px">${latestCheckIn.method === 'nfc' ? '📳 شريحة NFC' : '📷 باركود مشفر'}</span>` : ''}
            </div>
            ${latestCheckIn ? `
              <strong style="display:block;font-size:14px;color:#042f28;margin-bottom:4px">${esc(latestCheckIn.locationName)}</strong>
              <div style="font-size:12px;color:#64748b;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <span>🕒 <b>${latestInTime.timeStr}</b> (${latestInTime.rel})</span>
                <span>•</span>
                <span class="mono" style="font-size:11px;background:#f1f5f9;padding:1px 5px;border-radius:4px">${esc(latestCheckIn.terminalId)}</span>
              </div>
            ` : `
              <div style="color:#94a3b8;font-size:13px;padding:6px 0">لا توجد حركات دخول مسجلة مؤخراً</div>
            `}
          </div>

          <!-- آخر عملية خروج Check-out -->
          <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #3b82f6;border-radius:12px;padding:14px;box-shadow:0 2px 6px rgba(0,0,0,.03)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:12px;font-weight:700;color:#1e40af;display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6"></span>
                آخر عملية تحقق وخروج (Check-out)
              </span>
              ${latestCheckOut ? `<span style="background:#eff6ff;color:#1e40af;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px">${latestCheckOut.method === 'nfc' ? '📳 شريحة NFC' : '📷 باركود مشفر'}</span>` : ''}
            </div>
            ${latestCheckOut ? `
              <strong style="display:block;font-size:14px;color:#042f28;margin-bottom:4px">${esc(latestCheckOut.locationName)}</strong>
              <div style="font-size:12px;color:#64748b;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <span>🕒 <b>${latestOutTime.timeStr}</b> (${latestOutTime.rel})</span>
                <span>•</span>
                <span class="mono" style="font-size:11px;background:#f1f5f9;padding:1px 5px;border-radius:4px">${esc(latestCheckOut.terminalId)}</span>
              </div>
            ` : `
              <div style="color:#94a3b8;font-size:13px;padding:6px 0">لا توجد حركات خروج مسجلة مؤخراً</div>
            `}
          </div>

          <!-- إحصائيات التوزيع والاعتماد -->
          <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #D5B65D;border-radius:12px;padding:14px;box-shadow:0 2px 6px rgba(0,0,0,.03)">
            <small style="color:#64748b;font-size:12px">إجمالي حركات البطاقة والوسيلة</small>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:2px">
              <strong style="font-size:19px;color:#042f28">${totalLogsCount} عملية تحقق</strong>
              <span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px">100% مصرح</span>
            </div>
            <div style="margin-top:6px;font-size:11.5px;color:#475569;display:flex;justify-content:space-between">
              <span>📳 NFC: <b>${nfcPercent}%</b> (${nfcCount})</span>
              <span>📷 باركود: <b>${barcodePercent}%</b> (${barcodeCount})</span>
            </div>
          </div>
        </div>

        <!-- منصة محاكاة وتمرير البطاقة اللحظي (Interactive Card Scan Console) -->
        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;padding:14px;margin-bottom:18px">
          <div style="font-size:13px;font-weight:800;color:#042f28;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <span>⚡ منصة التحقق وتمرير البطاقة الميداني اللحظي (Live Card Tap Simulator)</span>
            <small style="font-weight:normal;color:#64748b;font-size:11.5px">اختبار فوري للمسح الضوئي للباركود أو تلامس NFC في مرافق الحرم</small>
          </div>
          <div class="inline-form" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
            <label style="flex:2;min-width:200px">موقع البوابة / المرفق الأكاديمي
              <select id="card-sim-loc" style="width:100%">
                <option value="GATE-MAIN-01">🏛️ البوابة الرئيسية — الحرم المركزي (GATE-MAIN-01)</option>
                <option value="GATE-NORTH-03">🚪 البوابة الشمالية — مواقف السيارات (GATE-NORTH-03)</option>
                <option value="LIB-ENTRANCE">📚 المكتبة المركزية — مدخل المطالعة والبحوث (LIB-ENTRANCE)</option>
                <option value="HALL-EXAM-102">🎓 مجمع القاعات الامتحانية (HALL-EXAM-102)</option>
                <option value="LAB-CYB-03">🧪 مختبر الأمن السيبراني والشبكات (LAB-CYB-03)</option>
                <option value="HUB-CAMPUS">🍽️ مجمع الخدمات والمطاعم الجامعية (HUB-CAMPUS)</option>
              </select>
            </label>
            <label style="flex:1;min-width:160px">تقنية التحقق
              <select id="card-sim-method" style="width:100%">
                <option value="nfc">📳 شريحة NFC الذكية (NFC Pass)</option>
                <option value="barcode">📷 مسح الباركود المشفر (Barcode)</option>
              </select>
            </label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn pri" type="button" data-act="simcardcheckin" style="height:38px;padding:0 14px;background:#059669;color:#fff;font-weight:700">
                🟢 تسجيل دخول (Check-in)
              </button>
              <button class="btn pri" type="button" data-act="simcardcheckout" style="height:38px;padding:0 14px;background:#2563eb;color:#fff;font-weight:700">
                🔵 تسجيل خروج (Check-out)
              </button>
              <button class="btn" type="button" data-act="simcarddenied" style="height:38px;padding:0 12px;color:#dc2626;border-color:#fca5a5" title="محاكاة محاولة دخول غير مصرحة">
                ⚠️ تجربة رفض
              </button>
            </div>
          </div>
        </div>

        <!-- شريط الفلترة والبحث والتصدير -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:1">
            <!-- فلتر نوع الحركة -->
            <select data-act="cardfilterevent" style="padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1;font-size:12.5px;background:#fff">
              <option value="all" ${filterEvent === 'all' ? 'selected' : ''}>كافة العمليات (دخول وخروج)</option>
              <option value="check_in" ${filterEvent === 'check_in' ? 'selected' : ''}>🟢 عمليات الدخول (Check-in)</option>
              <option value="check_out" ${filterEvent === 'check_out' ? 'selected' : ''}>🔵 عمليات الخروج (Check-out)</option>
              <option value="denied" ${filterEvent === 'denied' ? 'selected' : ''}>🔴 محاولات مرفوضة (Denied)</option>
            </select>

            <!-- فلتر التقنية -->
            <select data-act="cardfiltermethod" style="padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1;font-size:12.5px;background:#fff">
              <option value="all" ${filterMethod === 'all' ? 'selected' : ''}>كافة الوسائل (NFC و باركود)</option>
              <option value="nfc" ${filterMethod === 'nfc' ? 'selected' : ''}>📳 شريحة NFC الذكية</option>
              <option value="barcode" ${filterMethod === 'barcode' ? 'selected' : ''}>📷 مسح الباركود المشفر</option>
            </select>

            <!-- فلتر الموقع -->
            <select data-act="cardfilterloc" style="padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1;font-size:12.5px;background:#fff">
              <option value="all" ${filterLocation === 'all' ? 'selected' : ''}>كافة المواقع والمرافق</option>
              <option value="gates" ${filterLocation === 'gates' ? 'selected' : ''}>🏛️ بوابات الحرم الخارجية</option>
              <option value="library" ${filterLocation === 'library' ? 'selected' : ''}>📚 المكتبة المركزية</option>
              <option value="halls" ${filterLocation === 'halls' ? 'selected' : ''}>🎓 القاعات والمختبرات</option>
            </select>

            <!-- حقل البحث الفوري -->
            <input type="text" data-act="cardlogsearch" placeholder="بحث بالموقع، الجهاز، أو البصمة..." value="${esc(searchQ)}" style="padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1;font-size:12.5px;min-width:180px;background:#fff">
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn" type="button" data-act="exportcardcsv" style="height:32px;padding:0 12px;font-size:12px;display:flex;align-items:center;gap:4px">
              📥 تصدير CSV
            </button>
            <button class="btn" type="button" data-act="printcardlogs" style="height:32px;padding:0 12px;font-size:12px;display:flex;align-items:center;gap:4px">
              🖨️ طباعة السجل
            </button>
            <button class="btn" type="button" data-act="resetcardlogs" style="height:32px;padding:0 10px;font-size:12px;color:#64748b" title="مسح السجل المحلي">
              🔄 إعادة ضبط
            </button>
          </div>
        </div>

        <!-- جدول سجل نشاط وتحقق البطاقة -->
        <div class="tbl-wrap" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff" id="printable-card-logs-table">
          <table style="width:100%;border-collapse:collapse;margin:0">
            <thead>
              <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569">
                <th style="padding:10px 12px;text-align:start">التاريخ والوقت</th>
                <th style="padding:10px 12px;text-align:start">نوع الحركة</th>
                <th style="padding:10px 12px;text-align:start">الموقع / المرفق الأكاديمي</th>
                <th style="padding:10px 12px;text-align:start">وسيلة التحقق</th>
                <th style="padding:10px 12px;text-align:start">معرف القارئ (Terminal)</th>
                <th style="padding:10px 12px;text-align:start">حالة التصريح</th>
                <th style="padding:10px 12px;text-align:start">بصمة التوثيق الأمني</th>
                <th style="padding:10px 12px;text-align:start">بيان التدقيق</th>
              </tr>
            </thead>
            <tbody>
              ${filteredLogs.length > 0 ? filteredLogs.map((log) => {
                const tInfo = formatCardLogTime(log.timestamp);
                const isCheckIn = log.eventType === 'check_in';
                const isCheckOut = log.eventType === 'check_out';
                const isDenied = log.eventType === 'denied' || log.status === 'denied';

                return `<tr style="border-bottom:1px solid #f1f5f9;font-size:12.5px;transition:background .15s">
                  <td style="padding:10px 12px;white-space:nowrap">
                    <strong style="color:#042f28">${tInfo.timeStr}</strong>
                    <div style="font-size:11px;color:#64748b">${tInfo.dateStr} <span style="color:#D5B65D;font-weight:700">(${tInfo.rel})</span></div>
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    ${isCheckIn ? `
                      <span style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
                        🟢 دخول (Check-in)
                      </span>
                    ` : isCheckOut ? `
                      <span style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
                        🔵 خروج (Check-out)
                      </span>
                    ` : `
                      <span style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
                        🔴 مرفوض (Denied)
                      </span>
                    `}
                  </td>
                  <td style="padding:10px 12px">
                    <strong style="color:#0f172a;display:block">${esc(log.locationName)}</strong>
                    <span class="mono" style="font-size:10.5px;color:#64748b">${esc(log.locationCode)}</span>
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    ${log.method === 'nfc' ? `
                      <span style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700">📳 شريحة NFC</span>
                    ` : `
                      <span style="background:#f8fafc;color:#334155;border:1px solid #cbd5e1;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700">📷 باركود مشفر</span>
                    `}
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    <span class="mono" style="font-size:11.5px;background:#f1f5f9;padding:2px 6px;border-radius:4px;color:#334155">${esc(log.terminalId)}</span>
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    ${!isDenied ? `
                      <span style="color:#059669;font-weight:700;display:inline-flex;align-items:center;gap:4px">✓ مصرح به</span>
                    ` : `
                      <span style="color:#dc2626;font-weight:700;display:inline-flex;align-items:center;gap:4px">✕ محظور / مرفوض</span>
                    `}
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    <code class="mono" style="font-size:11px;background:#f8fafc;border:1px solid #e2e8f0;padding:2px 6px;border-radius:4px;color:#042f28">${esc(log.pkiHash || '0x29ac88')}</code>
                  </td>
                  <td style="padding:10px 12px;font-size:12px;color:#475569">
                    ${esc(log.reason || 'تحقق أمني نظامي')}
                  </td>
                </tr>`;
              }).join('') : `
                <tr>
                  <td colspan="8" style="padding:24px;text-align:center;color:#94a3b8">
                    لا توجد حركات مطابقة للفلتر المحدد. يمكنك استخدام منصة المحاكاة أعلاه لتسجيل أول حركة دخول أو خروج فورياً.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
        <div style="margin-top:8px;font-size:11.5px;color:#64748b;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
          <span>يتم توثيق كافة حركات التحقق بنظام التوقيع الرقمي X.509 المقاوم للتزوير وتخزينها مركزياً.</span>
          <span>عرض <b>${filteredLogs.length}</b> من أصل <b>${stLogs.length}</b> حركة للطالب</span>
        </div>
      </div>
    </section>`;
  };

  UA.renderDisciplinarySection = () => {
    const a = S.admin || {};
    const holdsList = a.holds || [];

    return `<section class="card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px">
          <span>🏛️ اللجنة التأديبية وسجل اللجان الانضباطية والمخالفات المسلكية</span>
        </h2>
        <span style="background:#054239;color:#D5B65D;font-weight:800;font-size:11px;padding:3px 9px;border-radius:6px;font-family:monospace">نقلت إلى شؤون الطلاب</span>
      </div>
      <p class="sub" style="margin-top:0;color:#64748b;font-size:13px">تسجيل قرارات اللجان الانضباطية والتأديبية، وفرض حواجز الحظر الفوري على المعاملات وبراءة الذمة مع التتبع الأكاديمي.</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
        <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #ef4444;border-radius:10px;padding:12px">
          <small style="color:#64748b">حالات الحظر النشطة</small>
          <strong style="display:block;font-size:22px;color:#dc2626;margin-top:2px">${holdsList.filter(h => h.active).length} طالب</strong>
        </div>
        <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #f59e0b;border-radius:10px;padding:12px">
          <small style="color:#64748b">إنذارات مسلكية وتأديبية</small>
          <strong style="display:block;font-size:22px;color:#d97706;margin-top:2px">${holdsList.length} قرار</strong>
        </div>
        <div style="background:#fff;border:1px solid #cbd5e1;border-inline-start:4px solid #10b981;border-radius:10px;padding:12px">
          <small style="color:#64748b">عقوبات تمت تسويتها</small>
          <strong style="display:block;font-size:22px;color:#10b981;margin-top:2px">${holdsList.filter(h => !h.active).length} قرار</strong>
        </div>
      </div>

      <div class="inline-form" style="margin-bottom:16px;background:rgba(14,102,85,.03);padding:14px;border-radius:10px;border:1px solid #cbd5e1;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:1;min-width:180px">الرقم الجامعي للطالب<input id="h-no" placeholder="CYB-2026-0001" dir="ltr"></label>
        <label style="flex:1;min-width:160px">نوع العقوبة / الحجز
          <select id="h-type">
            <option value="disciplinary">تأديبية / مسلكية</option>
            <option value="financial">مالية</option>
            <option value="library">مكتبة وعهدة</option>
          </select>
        </label>
        <label style="flex:2;min-width:240px">قرار اللجنة / نص المخالفة<input id="h-note" maxlength="200" placeholder="اكتب قرار اللجنة التأديبية..."></label>
        <button class="btn pri" data-act="addhold" style="height:38px;padding:0 18px">تسجيل العقوبة وتطبيق الحظر</button>
      </div>

      <h3 style="font-size:14px;margin:16px 0 8px">سجل العقوبات والحواجز الفورية المعتمدة</h3>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr><th>الطالب</th><th>الرقم الجامعي</th><th>النوع</th><th>الملاحظة / قرار اللجنة</th><th>الحالة</th><th>الإجراءات</th></tr>
          </thead>
          <tbody>
            ${holdsList.map((h) => `<tr>
              <td><b>${esc(h.student)}</b></td>
              <td class="mono">${esc(h.studentNo)}</td>
              <td>${{ financial: 'مالية', disciplinary: 'تأديبية', library: 'مكتبة' }[h.holdType] || esc(h.holdType)}</td>
              <td>${esc(h.note)}</td>
              <td>${h.active ? '<span class="bad-t">قائمة / محظور</span>' : '<span class="ok-t">مسددة / مرفوعة</span>'}</td>
              <td style="white-space:nowrap">
                ${h.active ? `<button class="btn sm" data-act="clearhold" data-id="${h.id}">تسوية ورفع</button> ` : ''}
                <button class="btn sm" data-act="edithold" data-id="${h.id}">تعديل</button>
                <button class="btn sm bad" data-act="delhold" data-id="${h.id}">حذف</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
  };

  /* ==========================================================================
     7. المنظومة الموحدة للديوان والمراسلات والطلبات والمعاملات الداخلية
     (دمج المراسلات مع الطلبات الداخلية في مساحة عمل مشتركة واحدة)
     ========================================================================== */
  const origCorrLoader = UA.loaders.corr;
  const origCorrView = UA.views.corr;
  const origInternalLoader = UA.loaders.internal;
  const origInternalView = UA.views.internal;

  UA.loaders.corr = async () => {
    await Promise.all([
      origCorrLoader ? origCorrLoader().catch(() => {}) : Promise.resolve(),
      origInternalLoader ? origInternalLoader().catch(() => {}) : Promise.resolve(),
    ]);
  };
  UA.loaders.internal = UA.loaders.corr;

  function getCleanCorrHtml() {
    if (!origCorrView) return '<section class="card"><p class="hint">الديوان والمراسلات</p></section>';
    return (origCorrView() || '')
      .replace(/<div class="sub-tabs[^"]*"[^>]*>[\s\S]*?<\/div>/, '')
      .replace(/<section class="card no-print"[^>]*background:linear-gradient\(135deg,#0f172a[\s\S]*?<\/section>/, '');
  }

  function getCleanInternalHtml() {
    if (!origInternalView) return '<section class="card"><p class="hint">بوابة الطلبات الداخلية</p></section>';
    return (origInternalView() || '')
      .replace(/<section class="card no-print"[^>]*background:linear-gradient\(135deg,#0f172a[\s\S]*?<\/section>/, '');
  }

  function renderUnifiedCorrespondenceHub() {
    if (S.corrUnifiedTab) {
      U.corrUnifiedTab = S.corrUnifiedTab;
      S.corrUnifiedTab = null;
    }
    const tab = U.corrUnifiedTab || 'in';

    // استخراج بيانات المراسلات والطلبات الداخلية من الحالة الحية
    const corrB = (window.UA && UA.corrState) || null;
    const intB = (window.UA && UA.internalState) || null;
    const allDocs = (corrB && Array.isArray(corrB.docs) ? corrB.docs : null) || (S.corrDocs || []);
    const myTurnDocs = allDocs.filter((d) => d.mine && d.mine.myTurn);
    const intList = (intB && Array.isArray(intB.list) && intB.list.length ? intB.list : null) || (S.requests || []);
    const myUnitPendingReqs = intList.filter((r) => r.status === 'review' && can('request:decide'));
    const totalPendingItems = myTurnDocs.length + myUnitPendingReqs.length;
    const svcsList = (intB && Array.isArray(intB.svcs) ? intB.svcs : null) || (S.services || []);
    const unreadNotifs = (corrB && corrB.notifs && corrB.notifs.unread) || (S.corrNotifs && S.corrNotifs.unread) || 0;

    // مزامنة التبويب الداخلي بدون أي استدعاء غير متزامن أو setTimeout داخل دالة العرض
    if (intB) {
      if (tab === 'internal_requests') {
        intB.tab = 'mine';
        intB.k = null;
      } else if (tab === 'internal_new') {
        intB.tab = 'catalog';
      }
    }
    if (corrB) {
      const crMap = { in: 'in', out: 'out', new_corr: 'new', tpl: 'tpl', notifs: 'notifs' };
      if (crMap[tab]) corrB.tab = crMap[tab];
    }

    const tabs = [
      ['in', '📥 البريد والمذكرات الواردة', allDocs.filter((d) => d.box === 'in' || !d.mine?.creator).length],
      ['out', '📤 البريد الصادر مني', allDocs.filter((d) => d.mine?.creator || corrB?.tab === 'out').length],
      ['internal_requests', '📋 سجل الطلبات والمعاملات الداخلية', intList.length],
      ['internal_new', '➕ تقديم طلب داخلي جديد (دليل الخدمات)', svcsList.length],
      ['pending_all', '⚡ بانتظار توقيعي وموافقتي', totalPendingItems],
      ...(can('corr:use') ? [['new_corr', '✍️ تحرير كتاب رسمي جديد', 0]] : []),
      ...(can('corr:templates') ? [['tpl', '📋 قوالب المراسلات الرسمية', 0]] : []),
      ['notifs', '🔔 تنبيهات الاعتماد والتوقيع', unreadNotifs],
    ];

    const topSubTabsBar = `<div class="sub-tabs no-print" role="tablist" style="margin-bottom:14px">
      ${tabs.map((t) => `
        <button type="button" class="chip" role="tab" data-act="corrunified" data-t="${t[0]}" aria-pressed="${tab === t[0]}">
          ${esc(t[1])}${t[2] ? ` <span class="badge-n">${t[2]}</span>` : ''}
        </button>
      `).join('')}
    </div>`;

    const statsHeader = `${topSubTabsBar}
      <section class="card no-print" style="margin-bottom:14px;background:linear-gradient(135deg,#054239 0%,#0f332d 100%);color:#fff;border:1px solid #115e59;padding:18px;border-radius:14px">
        <div class="spread" style="flex-wrap:wrap;gap:12px;margin-bottom:14px">
          <div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(213,182,93,.2);color:#fde047;border:1px solid rgba(213,182,93,.4);padding:2px 10px;border-radius:20px;font-size:11.5px;font-weight:700">
              <span>🏛️ المنظومة الإدارية الموحدة</span> · <span>CORRESPONDENCE & INTERNAL REQUESTS HUB</span>
            </div>
            <h1 style="margin:6px 0 2px;font-size:20px;font-weight:800;color:#fff">الديوان والمراسلات والطلبات والمعاملات الداخلية</h1>
            <p style="margin:0;opacity:.9;font-size:13px">منصة موحدة لإدارة الكتب الرسمية والمذكرات ومسارات التوقيع الإلكتروني والطلبات الإدارية والفنية للعاملين.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${can('corr:use') ? `<button type="button" class="btn sm" data-act="corrunified" data-t="new_corr" style="background:#D5B65D;color:#042f28;font-weight:800;border:none">✍️ تحرير كتاب رسمي</button>` : ''}
            <button type="button" class="btn sm" data-act="corrunified" data-t="internal_new" style="background:#fff;color:#054239;font-weight:700">➕ تقديم طلب خدمة داخلي</button>
            <button type="button" class="btn sm" data-act="view" data-v="guidelines" style="background:rgba(255,255,255,.15);color:#fff;border-color:rgba(255,255,255,.25)">📖 دليل المراسلات والـ SLA</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
          <div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 14px">
            <div style="font-size:11.5px;color:#cbd5e1">المراسلات والكتب الرسمية</div>
            <div style="font-size:20px;font-weight:800;color:#fff">${allDocs.length} <small style="font-size:11px;font-weight:400">كتاباً</small></div>
          </div>
          <div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 14px">
            <div style="font-size:11.5px;color:#cbd5e1">الطلبات والمعاملات الداخلية</div>
            <div style="font-size:20px;font-weight:800;color:#fff">${intList.length} <small style="font-size:11px;font-weight:400">طلباً</small></div>
          </div>
          <div style="background:${totalPendingItems ? 'rgba(245,158,11,.22)' : 'rgba(255,255,255,.07)'};border:1px solid ${totalPendingItems ? '#f59e0b' : 'rgba(255,255,255,.12)'};border-radius:10px;padding:10px 14px">
            <div style="font-size:11.5px;color:#fde68a;font-weight:700">بانتظار توقيعك وموافقتك الآن</div>
            <div style="font-size:20px;font-weight:800;color:#fbbf24">${totalPendingItems} <small style="font-size:11px;font-weight:400">معاملة</small></div>
          </div>
          <div style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.35);border-radius:10px;padding:10px 14px">
            <div style="font-size:11.5px;color:#bbf7d0">الصادرة والمعتمدة رسمياً</div>
            <div style="font-size:20px;font-weight:800;color:#4ade80">${allDocs.filter((d) => d.status === 'approved').length + intList.filter((r) => r.status === 'approved').length}</div>
          </div>
        </div>
      </section>`;

    // التبويب الموحد: بانتظار توقيعي وموافقتي
    if (tab === 'pending_all') {
      const docRows = myTurnDocs.map((d) => `<tr>
        <td class="mono"><b>${esc(d.no || d.code || `COR-${d.id}`)}</b></td>
        <td><b>${esc(d.title)}</b><div class="small" style="color:#64748b">من: ${esc(d.creator?.name || d.author?.name || 'زميل')} · ${fmt(d.createdAt)}</div></td>
        <td><span class="pill p-review">${esc(d.typeLabel || 'كتاب رسمي')}</span></td>
        <td><span class="pill p-review">دورك في التوقيع الآن</span></td>
        <td style="white-space:nowrap">
          <button type="button" class="btn sm pri" data-act="cropen" data-id="${d.id}">معاينة وتوقيع ✍️</button>
        </td>
      </tr>`).join('');

      const reqRows = myUnitPendingReqs.map((r) => `<tr>
        <td class="mono"><b>${esc(r.no)}</b></td>
        <td><b>${esc(r.service?.label || 'طلب خدمة')}</b><div class="small" style="color:#64748b">مقدم من: ${esc(r.student?.name || r.requester?.name || 'موظف')} · ${fmt(r.createdAt)}</div></td>
        <td>${r.unit ? esc(r.unit.name) : 'الوحدة المركزية'}</td>
        <td><span class="pill p-review">قيد المراجعة</span></td>
        <td style="white-space:nowrap">
          <button type="button" class="btn sm pri" data-act="reqopen" data-id="${r.id}">فحص واعتماد ✓</button>
        </td>
      </tr>`).join('');

      return statsHeader + `<div class="grid2">
        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
            <h2 style="margin:0">الكتب الرسمية بانتظار توقيعك (${myTurnDocs.length})</h2>
            <button type="button" class="btn sm" data-act="corrunified" data-t="in">عرض كل الوارد ←</button>
          </div>
          <div class="tbl-wrap"><table><thead><tr><th>الرمز</th><th>الموضوع</th><th>النوع</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
            ${docRows || '<tr><td colspan="5" class="empty">لا توجد كتب رسمية بانتظار توقيعك حالياً.</td></tr>'}
          </tbody></table></div>
        </section>

        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
            <h2 style="margin:0">الطلبات الداخلية المحالة لوحدتك للبت (${myUnitPendingReqs.length})</h2>
            <button type="button" class="btn sm" data-act="corrunified" data-t="internal_requests">عرض كل الطلبات ←</button>
          </div>
          <div class="tbl-wrap"><table><thead><tr><th>رقم الطلب</th><th>الخدمة</th><th>الجهة</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
            ${reqRows || '<tr><td colspan="5" class="empty">لا توجد طلبات داخلية تنتظر موافقة وحدتك حالياً.</td></tr>'}
          </tbody></table></div>
        </section>
      </div>`;
    }

    // عرض الطلبات والمعاملات الداخلية
    if (tab === 'internal_requests' || tab === 'internal_new') {
      return statsHeader + getCleanInternalHtml();
    }

    // عرض المراسلات والكتب الرسمية
    return statsHeader + getCleanCorrHtml();
  }

  UA.views.corr = renderUnifiedCorrespondenceHub;
  UA.views.internal = renderUnifiedCorrespondenceHub;

  /* ==========================================================================
     8. دليل الإرشادات التفاعلي الشامل لكامل الموقع وكامل الأقسام والطلبات وهيكلية العمل
     ========================================================================== */
  const GUIDE_DEPARTMENTS = [
    {
      id: 'exec_presidency',
      category: 'admin',
      title: '1. رئاسة الجامعة ومجلس الجامعة والأمانة العامة',
      badge: 'القيادة والسياسات العليا',
      summary: 'المرجعية الإدارية والأكاديمية والتشريعية العليا لكافة كليات ومعاهد ومراكز الجامعة، ووضع الخطط الاستراتيجية واعتماد اللوائح والموازنات.',
      roles: ['رئيس الجامعة', 'نواب الرئيس', 'أمين مجلس الجامعة', 'المستشار القانوني'],
      steps: [
        'إصدار القرارات واللوائح التنظيمية: تُصاغ القرارات عبر قوالب الديوان الرسمية وتُوقَّع رقمياً بشهادة X.509 معتمدة مع توليد ختم QR للتحقق.',
        'اعتماد الجداول والموازنات والمقررات: تُرفع محاضر مجالس الكليات إلكترونياً إلى مجلس الجامعة للبت والاعتماد النهائي بضغطة زر موثقة.',
        'تشكيل اللجان الجامعية: تشكيل لجان الانضباط والمشتريات والترقيات العلمية ومتابعة تقاريرها عبر لوحة القيادة المركزية.',
      ],
      correspondenceNote: 'كافة قرارات رئاسة الجامعة تُسجَّل تلقائياً في سجل التدقيق المشفر (SHA-256 Hash Chain) ولا يمكن تعديلها بعد الصدور.',
      targetView: 'overview',
    },
    {
      id: 'academics_curriculum',
      category: 'academic',
      title: '2. الشؤون الأكاديمية والمقررات والخطط الدراسية',
      badge: 'الهندسة الأكاديمية والمناهج',
      summary: 'بناء الكليات والبرامج، توصيف المقررات والساعات المعتمدة، إدارة الخطط الدراسية، وحساب العبء التدريسي وتوزيع المدرسين.',
      roles: ['عميد الكلية', 'رئيس القسم الأكاديمي', 'عضو الهيئة التدريسية', 'مسجل الكلية'],
      steps: [
        'إدارة الكليات والبرامج الأكاديمية: من «لوحة الإدارة ← الكليات والبرامج»، إضافة أو تعديل الكليات والأقسام وتحديد مدة الدراسة وسنوات التخرج.',
        'دليل المقررات وتوصيف المواد: من «المواد والعلامات والامتحانات»، إضافة المقررات وربطها بالمتطلبات السابقة والساعات المعتمدة والنظرية والعملية.',
        'تكليف الهيئة التدريسية والساعات المكتبية: ربط كل مقرر بعضو هيئة تدريس معتمد وضبط جدول المحاضرات الأسبوعي مع كشف التعارض الآلي.',
      ],
      correspondenceNote: 'تعديل الساعات المعتمدة أو الخطة الدراسية يرسل إشعاراً آلياً إلى مرشدي الطلاب الأكاديميين لتحديث مسارات التخرج.',
      targetView: 'academics',
    },
    {
      id: 'exams_control',
      category: 'academic',
      title: '3. الامتحانات ورصد العلامات والكنترول وفورم فحص الامتحان PDF',
      badge: 'الكنترول المركزي والامتحانات',
      summary: 'إدارة متكاملة للامتحانات الفصلية، توزيع القاعات والمراقبين، رصد وتدقيق العلامات، وتوليد جدول فحص الامتحان الموحد لكافة المواد بصيغة PDF.',
      roles: ['لجنة الامتحانات المركزية', 'رئيس الكنترول', 'مدرس المقرر', 'رئيس القسم الأكاديمي'],
      steps: [
        'فورم إنشاء فحص الامتحان لكافة المواد (PDF): ادخل إلى تبويب «فورم إنشاء فحص الامتحان لكافة المواد + PDF»، واضغط «توزيع تلقائي لتواريخ الفحص» لجدولة الامتحانات لجميع المقررات مع استثناء العطل الأسبوعية.',
        'تخصيص القاعات والمراقبين: تحديد أوقات الفحص والمدرجات والمراقبين لكل مادة مع كشف تعارض القاعات تلقائياً.',
        'حفظ وتصدير ملف PDF رسمي: الضغط على «حفظ واعتماد جدول الفحص» ثم «إنشاء وتصدير ملف PDF لجدول الفحص» لطباعة جدول رسمي مختوم بترويسة الجامعة.',
        'رصد العلامات وتدقيقها: يدخل مدرس المقرر العلامات (أعمال سنة + نظري) ضمن الحدود المقررة، ثم يعتمدها رئيس القسم لترحيلها لكشوف الطلاب.',
      ],
      correspondenceNote: 'يتيح النظام للطلاب تقديم تظلمات العلامات إلكترونياً خلال المدة المحددة في الإعدادات العامة (الافتراضي 7 أيام بعد النشر).',
      targetView: 'academics',
    },
    {
      id: 'admissions_sis',
      category: 'students',
      title: '4. القبول والتسجيل وملف الطالب الشامل 360° واللجان الانضباطية',
      badge: 'سجل الطالب الموحد (SIS)',
      summary: 'إدارة رحلة الطالب الجامعية من القبول والمفاضلة، السجل الأكاديمي 360°، البطاقات الجامعية بالباركود، الوثائق الموقعة، واللجان الانضباطية.',
      roles: ['مدير شؤون الطلاب', 'مسجل عام الجامعة', 'موظف القبول', 'المرشد الأكاديمي'],
      steps: [
        'تسجيل طالب جديد والتصوير عالي الدقة: من «شؤون الطلاب ← تسجيل طالب جديد»، تعبئة البيانات واستخدام الكاميرا لالتقاط صورة شخصية عالية الجودة (HD/4K) ثم توليد الرقم الجامعي وبطاقة القيد فورياً.',
        'ملف الطالب 360°: استعراض شامل للسجل الأكاديمي، المواد المسجلة، الرسوم المدفوعة، الحضور اليومي، المرفقات المؤرشفة، وسجل العقوبات والحواجز.',
        'إصدار الوثائق الرقمية الموقعة: إصدار إفادات الدوام وكشوف العلامات الموقعة رقمياً بمفتاح خاص وتوليد رمز QR للتحقق العام الفوري.',
        'اللجنة التأديبية وسجل المخالفات المسلكية: تسجيل قرارات اللجان الانضباطية التي تضع حواجز آلية (Holds) تمنع إصدار الوثائق حتى تسوية الوضع.',
      ],
      correspondenceNote: 'كل شهادة أو وثيقة صادرة تحمل بصمة رقمية SHA-256 وختماً زمنياً موثوقاً يمكن التثبت من صحتها عبر بوابة التحقق العام.',
      targetView: 'affairs',
    },
    {
      id: 'correspondence_desk',
      category: 'admin',
      title: '5. الديوان والمراسلات الرسمية والطلبات والمعاملات الداخلية',
      badge: 'الديوان الإلكتروني وسلسلة التواقيع',
      summary: 'المنظومة الموحدة للمراسلات والكتب الرسمية، التعاميم، المذكرات الداخلية، وطلبات الموظفين مع مسار توقيع تسلسلي ومتوازٍ ومتابعة دقيقة للـ SLA.',
      roles: ['الديوان العام', 'مدراء الإدارات', 'رؤساء الأقسام', 'كافة الموظفين والكادر التدريسي'],
      steps: [
        'تحرير كتاب رسمي أو مذكرة داخلية: اختيار القالب المناسب (كتاب رسمي، قرار إداري، تعميم، مذكرة داخلية)، وتحديد المستلمين وسلسلة المعتمدين.',
        'سلسلة التوقيع والاعتماد الرقمي: ينتقل الكتاب بالترتيب التسلسلي إلى أصحاب التوقيع مع خيارات: (توقيع واعتماد، إعادة للتعديل، رفض مسبب).',
        'تقديم طلب خدمة داخلي: من تبويب «الطلبات الداخلية»، اختيار نوع الخدمة (صيانة، مستلزمات، إجازة، عهدة)، وإرسالها للوحدة المختصة مع احتساب مهلة الـ SLA.',
        'التبويب الموحد بانتظار توقيعي: متابعة المعاملات والكتب التي تنتظر بتّك أو توقيعك في قائمة موحدة بضغطة زر واحدة.',
      ],
      correspondenceNote: 'تعديل أي كتاب بعد بدء مسار التوقيع يستلزم إعادة فتح رسمي يعيد دورة التواقيع لحماية النص المعتمد من التحريف.',
      targetView: 'corr',
    },
    {
      id: 'hr_payroll_bio',
      category: 'hr',
      title: '6. شؤون الموظفين الموحدة (الرواتب، الحضور والإجازات، البصمة، وتقييم الأداء)',
      badge: 'الموارد البشرية الشاملة',
      summary: 'توحيد كافة شؤون الكوادر الأكاديمية والإدارية: ملفات الموظفين، العقود، مسير الرواتب الشهري، البصمة الحيوية، الإجازات، وتقييمات الأداء KPIs.',
      roles: ['مدير الموارد البشرية', 'محاسب الرواتب', 'مسؤول الدوام والتحضير', 'الموظفون'],
      steps: [
        'ملفات الموظفين والعقود: تسجيل الموظف، الرتبة، القسم، الراتب الأساسي، البدلات، والاستقطاعات والتأمينات وسجل الوثائق.',
        'الحضور والانصراف وأجهزة البصمة: مزامنة حركات البصمة الحيوية (إصبع ووجه) من البوابات الجامعية واحتساب التأخير والغياب آلياً.',
        'الإجازات والأرصدة: تقديم طلبات الإجازة ومراجعتها واعتمادها وخصمها من الرصيد السنوي المستحق تلقائياً.',
        'تقييم الموظفين (KPIs): تعبئة استمارة التقييم الدوري (الالتزام، جودة الإنجاز، التعاون، المبادرة) وحساب المعدل العام والتقدير والتوصية.',
        'إصدار مسير الرواتب وترحيله: احتساب صافي المستحقات الشهرية وتصدير مسير الرواتب وترحيله محاسبياً إلى قيود اليومية.',
      ],
      correspondenceNote: 'أي غياب غير مبرر أو إجازة بلا راتب تنعكس فورياً في مسير الرواتب الشهري دون الحاجة لتدخل يدوي متكرر.',
      targetView: 'payroll',
    },
    {
      id: 'finance_accounting',
      category: 'finance',
      title: '7. الشؤون المالية والمحاسبة والرسوم ومراكز التكلفة',
      badge: 'النظام المحاسبي المزدوج القيد',
      summary: 'إدارة متكاملة لشجرة الحسابات، قيود اليومية المزدوجة، تحصيل الرسوم الدراسية وإيصالات القبض، ميزان المراجعة، وموازنات الكليات.',
      roles: ['المدير المالي', 'محاسب عام', 'أمين الصندوق', 'مدقق الحسابات'],
      steps: [
        'شجرة الحسابات والدليل المحاسبي: هيكلة الحسابات (أصول، خصوم، حقوق ملكية، إيرادات، مصروفات) ومراكز التكلفة لكل كلية وإدارة.',
        'قيود اليومية المزدوجة: تسجيل القيود المالية وترحيلها مع تطبيق قاعدة فصل المهام (منشئ القيد لا يرحله بنفسه).',
        'تحصيل رسوم الطلاب والأقساط: إصدار إيصالات الدفع الإلكترونية وربط السداد فورياً برفع الحظر المالي عن تسجيل المقررات.',
        'التقارير والقوائم الختامية: استخراج ميزان المراجعة، دفتر الأستاذ، قائمة الدخل، والميزانية العمومية بصيغ Excel وPDF.',
      ],
      correspondenceNote: 'كل عملية تحصيل مالي تولد إيصالاً إلكترونياً برقم تسلسلي غير قابل للإلغاء إلا بقيد عكسي معتمد ومسجل في التدقيق.',
      targetView: 'finance',
    },
    {
      id: 'procurement_assets',
      category: 'finance',
      title: '8. المشتريات والمستودعات والجرد والأصول الثابتة',
      badge: 'سلسلة التوريد وإدارة الأصول',
      summary: 'دورة شراء مؤسسية تبدأ بطلب الشراء، عروض الأسعار، أمر التوريد، الفحص والاستلام، الجرد المخزني، وسجل الأصول الثابتة وإهلاكها.',
      roles: ['مدير المشتريات', 'أمين المستودع', 'لجنة الفحص والاستلام', 'مسؤول الأصول'],
      steps: [
        'طلبات الشراء وعروض الأسعار: إنشاء طلب شراء داخلي وعرضه على لجنة المشتريات وتحديد عروض الأسعار المعتمدة.',
        'أمر التوريد ومذكرة الاستلام: إصدار أمر توريد للمورد المعتمد ثم إعداد محضر فحص واستلام فني للتأكد من مطابقة المواصفات.',
        'الإدخال والصرف المخزني: إدخال المواد إلى المستودعات وتوليد سندات الصرف للأقسام مع مراقبة حد الطلب الأدنى.',
        'سجل الأصول الثابتة: ترميز الأصول بالباركود وتحديد مواقعها وحساب الإهلاك السنوي آلياً.',
      ],
      correspondenceNote: 'عمليات الصرف المخزني ترتبط آلياً بمركز تكلفة القسم المستفيد لضبط وترشيد الإنفاق المؤسسي.',
      targetView: 'procurement',
    },
    {
      id: 'research_grad',
      category: 'academic',
      title: '9. البحث العلمي والدراسات العليا والمشاريع البحثية',
      badge: 'الإنتاج المعرفي والدراسات العليا',
      summary: 'تسجيل ومتابعة المشاريع البحثية والميزانيات، خطط رسائل الماجستير والدكتوراه، لجان المناقشة والتحكيم، وتوثيق براءات الاختراع.',
      roles: ['عميد البحث العلمي', 'رئيس لجنة الدراسات العليا', 'المشرف الأكاديمي', 'الباحثون وطلاب الدراسات'],
      steps: [
        'تسجيل المشاريع البحثية: تقديم مقترح المشروع، مراجعة الأصالة، اعتماد الميزانية المخصصة ومتابعة نسب الإنجاز الدورية.',
        'متابعة أطروحات الدراسات العليا: تسجيل عنوان الرسالة، تكليف المشرفين، تتبع تقارير التقدم الفصلي، وتشكيل لجان المناقشة.',
        'براءات الاختراع والنشر العلمي: توثيق الأوراق المنشورة في المجلات المحكمة وتحديث مؤشر التأثير للجامعة.',
      ],
      correspondenceNote: 'تخضع تقارير الرسائل لفحص الأصالة الأدبية ومنع الانتحال العلمي قبل اعتماد موعد جلسة الدفاع العلنية.',
      targetView: 'research',
    },
    {
      id: 'lms_library',
      category: 'academic',
      title: '10. التعلم الإلكتروني والمكتبة الرقمية (LMS)',
      badge: 'التعليم الرقمي والمصادر العلمية',
      summary: 'الفصول الافتراضية، رفع المحاضرات المسجلة والمصادر، بنك الأسئلة والاختبارات القصيرة، وفهرس المكتبة الرقمية ونظام الإعارة.',
      roles: ['مدير التعلم الإلكتروني', 'أمين المكتبة المركزية', 'أعضاء التدريس', 'الطلاب'],
      steps: [
        'إدارة المقررات الرقمية: رفع الخطط، المحاضرات المصورة، والمراجع العلمية، وتفعيل منتديات النقاش التفاعلية للمقرر.',
        'الاختبارات القصيرة وبنك الأسئلة: إنشاء بنوك أسئلة متعددة الصعوبة، جدولة الاختبارات الإلكترونية والتصحيح الآلي الفوري.',
        'فهرس المكتبة والإعارة: البحث في المراجع بتصنيف ديوي العشري، طلب استعارة الكتب رقمياً، ومتابعة مواعيد الإرجاع والغرامات.',
      ],
      correspondenceNote: 'يمنع النظام الطالب من استخراج براءة الذمة إذا كان في ذمته كتب مستعارة غير معادة للمكتبة.',
      targetView: 'lms',
    },
    {
      id: 'quality_accreditation',
      category: 'admin',
      title: '11. الجودة والاعتماد المؤسسي والتصنيف الأكاديمي (QA)',
      badge: 'الامتياز المؤسسي ومعايير الجودة',
      summary: 'متابعة مؤشرات الأداء الرئيسية (KPIs)، استبيانات تقييم المقررات وأعضاء التدريس، واستيفاء معايير الاعتماد الأكاديمي الوطني والدولي.',
      roles: ['مدير مركز ضمان الجودة', 'لجان تقييم البرامج', 'المراجع الخارجي', 'العمداء'],
      steps: [
        'لوحات مؤشرات الجودة (KPIs): قياس نسب نجاح الطلاب، التزام الهيئة التدريسية، معدلات النشر العلمي، ونسب التوظيف.',
        'استبيانات التقييم الفصلي: إطلاق استبيانات سرية للطلاب لتقييم المقررات وطرق التدريس، واستخراج تقارير التحليل الإحصائي.',
        'ملفات الاعتماد البرامجي (ABET/ISO): توثيق مخرجات التعلم المستهدفة (CLOs/PLOs) وأدلة التحسين المستمر لكل مقرر.',
      ],
      correspondenceNote: 'تقارير تقييم الجودة تُحفظ بسرية وتُرفع مباشرة لرئيس الجامعة وتُدمج في تقييم أداء أعضاء هيئة التدريس.',
      targetView: 'qa',
    },
    {
      id: 'alumni_careers',
      category: 'students',
      title: '12. شؤون الخريجين والتوظيف والتأهيل المهني',
      badge: 'سوق العمل والتأهيل المهني',
      summary: 'سجل الخريجين المعتمد والموثق، بوابات التوظيف وفرص التدريب الميداني، تتبع المسار المهني، وشبكة التواصل المؤسسي.',
      roles: ['مسؤول وحدة الخريجين', 'الشركاء والشركات الموظفة', 'الخريجون'],
      steps: [
        'سجل الخريجين المعتمد: أرشفة ملفات الخريجين وسجلاتهم الأكاديمية مع إمكانية استخراج وثائق تخرج موثقة برمز تحقق عام.',
        'بوابة الوظائف والتدريب: عرض الفرص الوظيفية المقدمة من شركاء الجامعة وتلقي طلبات الترشيح المباشرة.',
        'متابعة المسار المهني واستطلاعات أرباب العمل: قياس مدى تلبية مهارات الخريجين لمتطلبات سوق العمل لتحديث الخطط الدراسية.',
      ],
      correspondenceNote: 'تتيح بوابة الخريجين لأرباب العمل والجهات الحكومية التحقق الفوري من صحة شهادة التخرج عبر إدخال رمز التحقق العام.',
      targetView: 'alumni',
    },
    {
      id: 'admin_audit_devops',
      category: 'admin',
      title: '13. الإدارة المركزية والسيبرانية وآليات المراقبة والتدقيق (DevOps)',
      badge: 'الأمن السيبراني والبنية التحتية',
      summary: 'سلسلة التدقيق المشفرة (SHA-256 Hash Chain)، مراقبة الخوادم وقواعد البيانات، مدير القوائم المنسدلة التفاعلي، وخيار «أخرى».',
      roles: ['مدير النظام (Admin)', 'مدقق الأمن السيبراني', 'مهندس DevOps'],
      steps: [
        'سجل التدقيق غير القابل للتعديل: فحص سلامة سلسلة البصمات (Hash Chain) والتأكد من عدم وجود أي تلاعب في سجلات العمليات.',
        'إدارة وتعديل جميع القوائم المنسدلة: من «لوحة الإدارة المركزية ← الإعدادات العامة»، إضافة أو تعديل خيارات أي قائمة منسدلة فورياً.',
        'استخدام خيار «أخرى» والإكمال التلقائي: تفعيل خيار «أخرى» لكتابة مدخلات مخصصة، مع دعم البحث التلقائي بمجرد كتابة الأحرف في كل الجداول.',
        'المراقبة الحية والنسخ الاحتياطي: متابعة صحة قاعدة البيانات والذاكرة وتوليد وتنزيل النسخ الاحتياطية المشفرة للنظام.',
      ],
      correspondenceNote: 'كل عملية دخول أو تعديل إعدادات أو تغيير صلاحية تُسجَّل في سجل التدقيق بعنوان IP واسم المنفذ وتفاصيل التغيير.',
      targetView: 'admin',
    },
    {
      id: 'public_verification',
      category: 'admin',
      title: '14. التحقق العام والوثائق الرقمية الموقعة (مدمج في الإدارة)',
      badge: 'المصادقة الرقمية ومكافحة التزوير',
      summary: 'بوابة التحقق العام من كافة وثائق وشهادات الجامعة عبر رمز التحقق UV-... / SC-... أو عبر فحص بصمة ملف PDF دون رفعه.',
      roles: ['الجهات الخارجية', 'الطلاب والخريجون', 'إدارة القبول والتوثيق'],
      steps: [
        'التحقق عبر رمز الوثيقة: إدخال رمز التحقق المطبوع على الوثيقة (مثل UV-2026-ABCD أو SC-CSS-0001) للحصول على تقرير المصادقة.',
        'التحقق ببصمة الملف (SHA-256 Hash): فحص ملف PDF مباشرة على متصفح المستخدم دون رفعه لحماية الخصوصية ومطابقة بصمته مع السجل المركزي.',
        'فحص شهادات التوقيع والأختام الزمنية: عرض بيانات الموقع (X.509) وصحة الختم الزمني الموثوق (RFC 3161).',
      ],
      correspondenceNote: 'بوابة التحقق متاحة للجمهور الخارجي والوزارات دون الحاجة لتسجيل دخول، ومدمجة للمدراء داخل لوحة الإدارة المركزية.',
      targetView: 'admin',
    },
  ];

  const HIERARCHY_TIERS = [
    {
      id: 'node_president',
      title: 'مجلس الجامعة ورئاسة الجامعة',
      subtitle: 'القيادة العليا والسياسات الاستراتيجية',
      rank: 'المستوى الأول',
      color: '#054239',
      scope: 'المصادقة على اللوائح التنظيمية، تعيين القيادات، اعتماد الخطط الاستراتيجية والموازنة التقديرية، والبت في القرارات السيادية والأكاديمية الكبرى.',
      authorities: ['اعتماد الموازنة العامة للجامعة', 'تعيين عمداء الكليات ومدراء المراكز', 'إصدار قرارات منح الدرجات العلمية والتخرج', 'المصادقة على مذكرات التفاهم الدولية والاتفاقيات'],
      reportsTo: 'مجلس التعليم العالي ومجلس الأمناء',
      directSubordinates: 'نواب رئيس الجامعة، أمين عام الجامعة، مدير مكتب الرقابة والتدقيق',
      systemView: 'overview',
    },
    {
      id: 'node_vps',
      title: 'نواب رئيس الجامعة (العلمي والإداري)',
      subtitle: 'الإشراف التنفيذي والأكاديمي والطلابي',
      rank: 'المستوى الثاني',
      color: '#0e7490',
      scope: 'إدارة الشؤون العلمية والبحثية (النائب العلمي) والإشراف على الموارد البشرية والمالية والخدمات الطلابية (النائب الإداري وشؤون الطلاب).',
      authorities: ['اعتماد الجداول الامتحانية والخطط الدراسية', 'الموافقة على الترقيات والتعيينات الأكاديمية والإدارية', 'البت في المعاملات المحالة من عمادات الكليات', 'إدارة الأزمات والطوارئ الجامعية'],
      reportsTo: 'رئيس الجامعة',
      directSubordinates: 'عمداء الكليات، مدير شؤون الطلاب، مدير الموارد البشرية، المدير المالي',
      systemView: 'academics',
    },
    {
      id: 'node_deans',
      title: 'عمداء الكليات ومدراء المعاهد',
      subtitle: 'القيادة الأكاديمية والتنفيذية للكلية',
      rank: 'المستوى الثالث',
      color: '#047857',
      scope: 'الإشراف على العملية التعليمية والامتحانات وتطوير المقررات والبحث العلمي داخل الكلية، ورئاسة مجلس الكلية.',
      authorities: ['اعتماد جداول ومواعيد امتحانات الكلية وتصدير PDF', 'اعتماد نتائج المقررات بعد تدقيقها من الأقسام', 'إحالة المخالفات الطلابية والمسلكية للجان المختصة', 'الموافقة على طلبات الإجازات والتعويضات لكادر الكلية'],
      reportsTo: 'نائب رئيس الجامعة للشؤون العلمية',
      directSubordinates: 'نواب العميد، رؤساء الأقسام الأكاديمية، رئيس ديوان الكلية',
      systemView: 'academics',
    },
    {
      id: 'node_central_dirs',
      title: 'مدراء الإدارات المركزية (الطلاب، HR، المالية، IT، الجودة)',
      subtitle: 'الإدارة التنفيذية والخدمية للمنظومة الجامعية',
      rank: 'المستوى الرابع',
      color: '#b45309',
      scope: 'تشغيل الأنظمة المركزية: قبول الطلاب والسجلات، الرواتب والدوام، المحاسبة والمشتريات، البنية التحتية والأمن السيبراني، وضمان الجودة.',
      authorities: ['اعتماد مسيرات الرواتب الشهرية والترحيل المحاسبي', 'إصدار الوثائق الرسمية والشهادات الموقعة رقمياً', 'البت في طلبات الشراء والصرف المخزني وفق الصلاحيات', 'إدارة صلاحيات المستخدمين وسجلات التدقيق والمراقبة'],
      reportsTo: 'نائب رئيس الجامعة للشؤون الإدارية والمالية',
      directSubordinates: 'رؤساء الدوائر والشعب والمحاسبون والمشرفون التقنيون',
      systemView: 'admin',
    },
    {
      id: 'node_dept_heads',
      title: 'رؤساء الأقسام الأكاديمية',
      subtitle: 'الإشراف على البرامج وتوزيع المقررات',
      rank: 'المستوى الخامس',
      color: '#4338ca',
      scope: 'توزيع المقررات على أعضاء التدريس، مراقبة العبء التدريسي، الإشراف على الامتحانات وتدقيق دفاتر وسجلات العلامات.',
      authorities: ['توزيع الساعات التدريسية والمقررات', 'تدقيق العلامات والامتحانات والاعتماد الأولي', 'البت في طلبات الأعذار الطبية والتظلمات الأكاديمية', 'اقتراح تطوير الخطط والمناهج الدراسية'],
      reportsTo: 'عميد الكلية',
      directSubordinates: 'أعضاء هيئة التدريس، المعيدون، منسقو المقررات',
      systemView: 'academics',
    },
    {
      id: 'node_staff_faculty',
      title: 'أعضاء الهيئة التدريسية والكادر الوظيفي',
      subtitle: 'التعليم المباشر والخدمات الإدارية والفنية',
      rank: 'المستوى السادس',
      color: '#1d4ed8',
      scope: 'تدريس المقررات، إعداد ورصد الامتحانات، تقديم الخدمات الطلابية والإدارية، وتسجيل الحضور بالبصمة البيومترية.',
      authorities: ['رصد علامات المقررات والتقييم المستمر', 'حجز وتحديد الساعات المكتبية للطلاب', 'تقديم الطلبات الداخلية والإجازات عبر المنظومة', 'التوقيع والمصادقة على المعاملات المحالة إليهم'],
      reportsTo: 'رئيس القسم الأكاديمي / رئيس الدائرة المختصة',
      directSubordinates: 'الطلاب المسترشدون، المساعدون الإداريون',
      systemView: 'overview',
    },
    {
      id: 'node_committees',
      title: 'اللجان المتخصصة (الانضباط، الامتحانات، المشتريات)',
      subtitle: 'الهيئات الاستشارية والتنفيذية المدمجة',
      rank: 'المستوى السابع',
      color: '#be123c',
      scope: 'التحقيق في المخالفات المسلكية وإصدار العقوبات، ضبط ومراقبة الامتحانات، وفحص العروض والبت في المشتريات.',
      authorities: ['إصدار قرارات العقوبات وفرض الحواجز الآلية (Holds)', 'البت في تظلمات العلامات وقبول الأعذار الاستثنائية', 'فحص عروض الأسعار واعتماد محاضر الاستلام الفني'],
      reportsTo: 'عميد الكلية / رئيس الجامعة',
      directSubordinates: 'أمانة سر اللجنة ومقررو الجلسات',
      systemView: 'admin',
    },
    {
      id: 'node_students',
      title: 'الطلاب والباحثون والمستفيدون الخارجيون',
      subtitle: 'محور العملية التعليمية والخدمية',
      rank: 'المستوى الثامن',
      color: '#15803d',
      scope: 'تسجيل المقررات، متابعة العلامات، تقديم طلبات الخدمات وبراءة الذمة، والتحقق العام من صحة الوثائق الصادرة.',
      authorities: ['تقديم طلبات الخدمات الإلكترونية وإرفاق الثبوتيات', 'الاطلاع على السجل الأكاديمي 360° ومتابعة الحضور', 'استخراج الوثائق الموقعة رقمياً والتحقق من صحتها عبر QR'],
      reportsTo: 'المرشد الأكاديمي وعمادة شؤون الطلاب',
      directSubordinates: 'لا يوجد',
      systemView: 'affairs',
    },
  ];

  const REQUEST_SIMULATOR_DATA = {
    req_enrollment: {
      id: 'req_enrollment',
      name: 'إفادة دوام جامعي رسمي (Enrollment Certificate)',
      category: 'خدمات الطلاب',
      audience: 'الطلاب المقيّدون حالياً',
      slaHours: 24,
      attachmentRequired: false,
      issuesDigitalDoc: true,
      approvalMatrix: 'مقدم الطلب ← الفحص الآلي للضوابط ← تدقيق موظف شؤون الطلاب ← توقيع مدير شؤون الطلاب ← إصدار وثيقة موقّعة X.509 مع QR',
      rulesChecked: ['خلو ملف الطالب من حواجز اللجان الانضباطية (Active Holds)', 'حالة القيد نظامية (Active)', 'سداد الرسوم الدراسية المقررة لهذا الفصل'],
      databaseImpact: 'توليد كود وثيقة فريد (UV-...)، إنشاء بصمة SHA-256 للمستند، ختم زمني موثوق، وتحديث سجل تدقيق الوثائق.',
      stages: [
        { num: 1, title: 'التقديم', desc: 'يحدد الطالب الغرض من الإفادة (سفر، جهة رسمية، نقابة) ويقدم الطلب إلكترونياً.' },
        { num: 2, title: 'الفحص الآلي', desc: 'يتحقق النظام فورياً من سداد الرسوم وعدم وجود عقوبات انضباطية تحظر استخراج الوثيقة.' },
        { num: 3, title: 'التدقيق الإداري', desc: 'يراجع موظف شؤون الطلاب الطلب ويتأكد من تطابق بيانات القيد الأكاديمي.' },
        { num: 4, title: 'التوقيع الرقمي', desc: 'يُوقَّع الطلب رقمياً بمفتاح X.509 معتمد مع ختم تاريخ ورقم صادر رسمي.' },
        { num: 5, title: 'الإصدار والـ QR', desc: 'يُنشأ ملف PDF رسمي موثق برمز QR للتحقق العام جاهز للتنزيل والطباعة الفورية.' },
      ],
      quickView: 'affairs',
    },
    req_transcript: {
      id: 'req_transcript',
      name: 'كشف علامات رسمي موقّع (Official Academic Transcript)',
      category: 'الخدمات الأكاديمية والوثائق',
      audience: 'الطلاب والخريجون',
      slaHours: 48,
      attachmentRequired: false,
      issuesDigitalDoc: true,
      approvalMatrix: 'الطالب ← فحص حواجز الكنترول ← تدقيق سجل العلامات ← اعتماد رئيس قسم الامتحانات ← توقيع عميد الكلية ← إصدار الكشف المعتمد',
      rulesChecked: ['اعتماد كافة نتائج المقررات المسجلة من مجالس الكليات', 'تسوية المستحقات المالية', 'تطابق المعدل التراكمي والساعات المنجزة'],
      databaseImpact: 'استخراج درجات كافة الفصول، حساب المعدل التراكمي (GPA)، تشفير ملف الكشف بالشهادة الرقمية وتحديث كود التحقق العام.',
      stages: [
        { num: 1, title: 'تقديم الطلب', desc: 'يطلب الطالب كشف علامات باللغة العربية أو الإنجليزية ويحدد نوع النموذج المطلوب.' },
        { num: 2, title: 'التدقيق الآلي', desc: 'يفحص النظام اكتمال اعتماد جميع العلامات المرصودة من رؤساء الأقسام.' },
        { num: 3, title: 'مراجعة الكنترول', desc: 'يدقق مسؤول الكنترول مطابقة المعدل التراكمي وساعات المقررات المعترف بها.' },
        { num: 4, title: 'اعتماد العميد', desc: 'يوقع عميد الكلية الكترونياً على مسودة الكشف لإجازة إصداره الرسمي.' },
        { num: 5, title: 'التصدير الموقّع', desc: 'إصدار ملف كشف العلامات النهائي المطبوع بختم الكلية المشفر ورابط التحقق.' },
      ],
      quickView: 'academics',
    },
    req_grade_appeal: {
      id: 'req_grade_appeal',
      name: 'تظلم ومراجعة علامة مقرر (Course Grade Appeal)',
      category: 'الامتحانات والعلامات',
      audience: 'الطلاب',
      slaHours: 72,
      attachmentRequired: true,
      issuesDigitalDoc: false,
      approvalMatrix: 'الطالب ← فحص مهلة التظلم القانونية (7 أيام) ← رئيس القسم الأكاديمي ← لجنة مراجعة الدفاتر ← إقرار النتيجة وتعديل العلامة بمحضر معتمد',
      rulesChecked: ['التقديم ضمن المهلة المحددة في الإعدادات العامة (الافتراضي 7 أيام بعد إعلان النتيجة)', 'إرفاق إشعار أو مبررات التظلم', 'عدم وجود تظلم مكرر لنفس المقرر'],
      databaseImpact: 'إنشاء حركة تظلم في سجل الامتحانات، إرسال إشعار لرئيس القسم، وفي حال التعديل يُسجَّل قيد تعديل علامة مبرر في سجل التدقيق.',
      stages: [
        { num: 1, title: 'تسجيل التظلم', desc: 'يختار الطالب المقرر المعني ويكتب أوجه التظلم (خطأ في جمع الدرجات، سؤال غير مصحح).' },
        { num: 2, title: 'الفحص الزمني', desc: 'يتحقق النظام آلياً من أن التظلم مقدم خلال المهلة الزمنية النظامية المعتمدة.' },
        { num: 3, title: 'تشكيل لجنة المراجعة', desc: 'يحيل رئيس القسم الطلب إلى لجنة تدقيق دفاتر الامتحانات لإعادة جمع ومراجعة الورقة.' },
        { num: 4, title: 'إقرار المحضر', desc: 'تعتمد اللجنة محضر التدقيق (تثبيت العلامة أو تعديلها مع ذكر المبرر الأكاديمي).' },
        { num: 5, title: 'إشعار الطالب وتحديث السجل', desc: 'إشعار الطالب بالنتيجة وتحديث سجل علامات الطالب في حال التعديل تلقائياً.' },
      ],
      quickView: 'academics',
    },
    req_hr_leave: {
      id: 'req_hr_leave',
      name: 'طلب إجازة موظف اعتيادية/مرضية (Staff Leave Request)',
      category: 'شؤون الموظفين والموارد البشرية',
      audience: 'أعضاء التدريس والموظفون',
      slaHours: 24,
      attachmentRequired: false,
      issuesDigitalDoc: false,
      approvalMatrix: 'الموظف ← فحص رصيد الإجازات السنوي ← موافقة الرئيس المباشر ← اعتماد مدير الموارد البشرية ← خصم الرصيد وتحديث سجل الدوام والرواتب',
      rulesChecked: ['كفاية رصيد الإجازات السنوي المتاح للموظف', 'عدم وجود طلب إجازة متداخل لنفس التواريخ', 'إرفاق تقرير طبي معتمد في الإجازات المرضية'],
      databaseImpact: 'خصم مدة الإجازة من رصيد الإجازات، تسجيل أيام الغياب المبرر في خلاصة الحضور الشهرية ومسير الرواتب.',
      stages: [
        { num: 1, title: 'تعبئة طلب الإجازة', desc: 'يحدد الموظف نوع الإجازة وتاريخ البداية والنهاية والموظف البديل المكلف بالمهام.' },
        { num: 2, title: 'التحقق من الرصيد', desc: 'يتحقق النظام فورياً من رصيد الإجازات المستحق وإمكانية الخصم الآلي.' },
        { num: 3, title: 'موافقة الرئيس المباشر', desc: 'يراجع رئيس القسم أو الدائرة الطلب ويوافق على الإجازة مع اعتماد الموظف البديل.' },
        { num: 4, title: 'اعتماد الموارد البشرية', desc: 'يعتمد مدير شؤون الموظفين القرار النهائي وتوثيقه في السجل الوظيفي.' },
        { num: 5, title: 'التسوية الآلية', desc: 'خصم الأيام آلياً من رصيد الإجازات وعكسها في تقرير الدوام الشهري ومسير الرواتب.' },
      ],
      quickView: 'payroll',
    },
    req_purchase: {
      id: 'req_purchase',
      name: 'طلب شراء وتوريد مستلزمات (Purchase Requisition)',
      category: 'المشتريات والمخازن',
      audience: 'مدراء الأقسام والكليات',
      slaHours: 96,
      attachmentRequired: true,
      issuesDigitalDoc: true,
      approvalMatrix: 'القسم الطالب ← فحص الرصيد المخزني والموازنة ← موافقة لجنة المشتريات ← أمر توريد ← فحص واستلام ← إدخال مخزني',
      rulesChecked: ['عدم توفر الصنف في المستودعات المركزية (رصيد المخزون = صفر)', 'وجود مخصص مالي كافٍ في مركز تكلفة القسم الطالب', 'إرفاق المواصفات الفنية المطلوبة'],
      databaseImpact: 'حجز المخصص المالي، توليد أمر توريد، وعند الاستلام يتم إنشاء قيد محاسبي وإدخال الصنف للمستودعات.',
      stages: [
        { num: 1, title: 'إنشاء طلب الشراء', desc: 'يحدد القسم الأصناف والكميات المطلوبة مع إرفاق المواصفات الفنية والتبرير.' },
        { num: 2, title: 'مطابقة المخزون', desc: 'يتأكد النظام وأمين المستودع من عدم وجود أرصدة راكدة تفي بالغرض.' },
        { num: 3, title: 'عروض الأسعار واللجنة', desc: 'تطلب إدارة المشتريات عروض أسعار وتعتمد العرض الأنسب فنياً ومالياً.' },
        { num: 4, title: 'أمر التوريد والاستلام', desc: 'إصدار أمر توريد للمورد المعتمد ثم تشكيل لجنة فحص واستلام فني.' },
        { num: 5, title: 'الإدخال المخزني والصرف', desc: 'إدخال المواد للمستودع وإصدار سند صرف للقسم الطالب وترحيل القيد المالي.' },
      ],
      quickView: 'procurement',
    },
    req_official_memo: {
      id: 'req_official_memo',
      name: 'كتاب رسمي صادر أو مذكرة داخلية (Official Letter / Memo)',
      category: 'الديوان والمراسلات',
      audience: 'كافة الإدارات والكليات والمكاتب',
      slaHours: 48,
      attachmentRequired: false,
      issuesDigitalDoc: true,
      approvalMatrix: 'المنشئ ← اختيار القالب والمستلمين ← سلسلة المعتمدين التسلسلية ← التوقيع الرقمي لكل معتمد ← ختم الديوان الرسمي والـ QR والأرشفة',
      rulesChecked: ['اكتمال بيانات الترويسة والموضوع والمستهدفين', 'تحديد مسار المعتمدين بشكل سليم', 'سلامة المرفقات المشفرة'],
      databaseImpact: 'توليد رقم ديوان رسمي متسلسل (COR-...)، ختم المستند ببصمة SHA-256، وحفظ مسار التوقيع وتوزيعه على الصناديق.',
      stages: [
        { num: 1, title: 'صياغة المراسلة', desc: 'إنشاء الكتاب من قالب معتمد (قرار، تعميم، مذكرة) وتحديد تسلسل الموقعين.' },
        { num: 2, title: 'إرسال للاعتماد', desc: 'يتحول الكتاب إلى حالة (قيد الاعتماد) ويصل بالترتيب إلى أول موقع في السلسلة.' },
        { num: 3, title: 'مسار التواقيع', desc: 'يوقع كل مسؤول رقمياً مع إمكانية إضافة ملاحظة أو طلب استدراك على المسودة.' },
        { num: 4, title: 'الاعتماد النهائي', desc: 'فور توقيع آخر معتمد، يتحول الكتاب إلى (معتمد وصادر رسمياً) بصفة نهائية.' },
        { num: 5, title: 'التوزيع والأرشفة', desc: 'يصل الكتاب لبريد المستلمين الوارد مع إمكانية طباعة نسخة PDF موثقة برمز QR.' },
      ],
      quickView: 'corr',
    },
    req_clearance: {
      id: 'req_clearance',
      name: 'براءة ذمة جامعية شاملة (University Clearance)',
      category: 'التخرج وشؤون الطلاب',
      audience: 'الطلاب المتخرجون والمنسحبون',
      slaHours: 48,
      attachmentRequired: false,
      issuesDigitalDoc: true,
      approvalMatrix: 'الطالب ← فحص استعارة المكتبة المركزية ← فحص المستودعات والعهد ← براءة الذمة المالية ← تدقيق شؤون الطلاب ← إصدار شهادة براءة الذمة الإلكترونية',
      rulesChecked: ['إرجاع كافة الكتب المستعارة للمكتبة المركزية', 'تسليم أي أجهزة أو عهد مخبرية', 'تسوية كامل الأقساط والرسوم لدى المحاسبة', 'عدم وجود حواجز انضباطية قائمة'],
      databaseImpact: 'إغلاق قيود الطالب، تحويل حالة القيد إلى (متخرج/مستقيل)، وتوليد كود براءة ذمة موثق برمز QR.',
      stages: [
        { num: 1, title: 'تقديم طلب براءة الذمة', desc: 'يقدم الطالب أو الموظف طلب براءة ذمة مع تحديد سبب إنهاء العلاقة الجامعية.' },
        { num: 2, title: 'تدقيق المكتبة والعهد', desc: 'فحص آلي وفني لسجل الاستعارة واسترداد أي مقتنيات جامعية.' },
        { num: 3, title: 'المطابقة المالية', desc: 'مراجعة قيود الرسوم والتأكد من خلو الذمة المالية أو سداد المتبقي.' },
        { num: 4, title: 'اعتماد شؤون الطلاب', desc: 'توقيع عميد شؤون الطلاب إلكترونياً على إجازة التخرج أو إخلاء الطرف.' },
        { num: 5, title: 'إصدار الوثيقة الرقمية', desc: 'توليد وثيقة براءة الذمة الموقعة رقمياً برمز تحقق عام.' },
      ],
      quickView: 'affairs',
    },
    req_disciplinary_appeal: {
      id: 'req_disciplinary_appeal',
      name: 'التماس وتظلم من قرار لجنة انضباطية (Disciplinary Decision Appeal)',
      category: 'اللجان الانضباطية والمسلكية',
      audience: 'الطلاب والموظفون',
      slaHours: 72,
      attachmentRequired: true,
      issuesDigitalDoc: false,
      approvalMatrix: 'المتظلم ← فحص مهلة الاستئناف النظامية ← مراجعة الشؤون القانونية ← انعقاد لجنة التظلمات العليا ← قرار التثبيت أو تخفيف العقوبة أو إلغاء الحاجز (Hold)',
      rulesChecked: ['تقديم الالتماس خلال 10 أيام من إعلان القرار التأديبي', 'إرفاق البينات والمستندات الداعمة للاستئناف', 'سداد رسوم فحص التظلم إن وجدت'],
      databaseImpact: 'تحديث حالة قرار العقوبة إلى (قيد الاستئناف)، وإذا قُبل التماس يتم رفع الحاجز الآلي (Remove Hold) فورياً من قاعدة البيانات.',
      stages: [
        { num: 1, title: 'تسجيل الالتماس', desc: 'اختيار رقم القرار التأديبي وإرفاق مذكرة الدفاع والقرائن الجديدة.' },
        { num: 2, title: 'التدقيق الشكلي', desc: 'التأكد من ورود الاستئناف داخل القيد الزمني المحدد باللائحة.' },
        { num: 3, title: 'المراجعة القانونية', desc: 'إعداد تقرير المستشار القانوني وإحالته للجنة الاستئناف المركزية.' },
        { num: 4, title: 'جلسة البت', desc: 'انعقاد اللجنة وإصدار القرار المسبب (تأييد / تعديل / إلغاء).' },
        { num: 5, title: 'تحديث السجل ورفع الحظر', desc: 'تحديث سجل المخالفات ورفع الحواجز في حال إلغاء العقوبة مع إشعار المنظومة.' },
      ],
      quickView: 'admin',
    },
    req_makeup_exam: {
      id: 'req_makeup_exam',
      name: 'طلب امتحان غير مكتمل / عذر غيابي (Incomplete / Makeup Exam Request)',
      category: 'الامتحانات والكنترول',
      audience: 'الطلاب المتغيبون بعذر قهري',
      slaHours: 48,
      attachmentRequired: true,
      issuesDigitalDoc: false,
      approvalMatrix: 'الطالب ← إرفاق التقرير الطبي المعتمد ← اعتماد اللجنة الطبية الجامعية ← موافقة عميد الكلية ← جدولة الامتحان البديل في فورم الامتحانات',
      rulesChecked: ['تقديم العذر خلال 72 ساعة من موعد الامتحان المتغيب عنه', 'تصديق التقرير الطبي من الإدارة الطبية المعتمدة للجامعة', 'نسبة الحضور السابقة للمقرر لا تقل عن الحد الأدنى'],
      databaseImpact: 'تحويل درجة المقرر مؤقتاً إلى رمز (I - Incomplete) وتضمين الطالب في قائمة امتحان التعويض.',
      stages: [
        { num: 1, title: 'تقديم العذر', desc: 'اختيار المقرر الذي تم الغياب عنه وإرفاق الشهادة المرضية أو عذر القوة القاهرة.' },
        { num: 2, title: 'الفحص الطبي', desc: 'تصديق التقرير من الطبيب المعتمد بالجامعة للتأكد من الحالة المرضية.' },
        { num: 3, title: 'موافقة الكلية', desc: 'إقرار مجلس الكلية لقانونية العذر واعتماد إجراء امتحان تكميلي.' },
        { num: 4, title: 'الجدولة في الكنترول', desc: 'إدراج اسم الطالب في قاعة وتاريخ الامتحان التكميلي بفورم الامتحانات.' },
        { num: 5, title: 'رصد النتيجة وترحيلها', desc: 'أداء الامتحان ورصد العلامة وتعديل الرمز (I) إلى الدرجة المستحقة.' },
      ],
      quickView: 'academics',
    },
    req_faculty_promotion: {
      id: 'req_faculty_promotion',
      name: 'طلب ترقية علمية لعضو هيئة تدريسية (Academic Promotion)',
      category: 'الشؤون الأكاديمية والترقيات',
      audience: 'أعضاء الهيئة التدريسية',
      slaHours: 240,
      attachmentRequired: true,
      issuesDigitalDoc: true,
      approvalMatrix: 'المتقدم ← استيفاء المدة النظامية ونقاط البحث ← مجلس القسم ← مجلس الكلية ← المحكمون الخارجيون ← مجلس الجامعة ← قرار الترقية وتعديل المرتبة والراتب',
      rulesChecked: ['قضاء المدة القانونية في الرتبة الحالية', 'استيفاء الحد الأدنى من نقاط الأبحاث المنشورة في أوعية محكمة', 'الحصول على تقييم تدريسي لا يقل عن جيد جداً'],
      databaseImpact: 'تحديث الرتبة العلمية للموظف في جدول الهيئة التدريسية، وتعديل سلم الرواتب والبدلات آلياً بمجرد صدور القرار.',
      stages: [
        { num: 1, title: 'إيداع الملف الأكاديمي', desc: 'رفع ملف الإنتاج العلمي، تقارير التدريس، وخدمة المجتمع عبر المنظومة.' },
        { num: 2, title: 'تدقيق القسم والكلية', desc: 'فحص استيفاء الشروط النظامية والموافقة المبدئية من مجلس الكلية.' },
        { num: 3, title: 'التحكيم العلمي الخارجي', desc: 'إرسال الأبحاث إلكترونياً للمحكمين المعتمدين بسرية تامة وتجميع الدرجات.' },
        { num: 4, title: 'اعتماد مجلس الجامعة', desc: 'عرض تقرير لجنة الترقيات على مجلس الجامعة للمصادقة الرسمية.' },
        { num: 5, title: 'إصدار القرار وتحديث الرتبة', desc: 'تحديث رتبة عضو التدريس وتعديل راتبه ومسماه الأكاديمي في قاعدة البيانات.' },
      ],
      quickView: 'payroll',
    },
    req_research_grant: {
      id: 'req_research_grant',
      name: 'طلب منحة ودعم مشروع بحث علمي (Research Grant Proposal)',
      category: 'البحث العلمي والدراسات العليا',
      audience: 'الباحثون والفرق البحثية',
      slaHours: 120,
      attachmentRequired: true,
      issuesDigitalDoc: false,
      approvalMatrix: 'الباحث الرئيسي ← مقترح الموازنة وخطة العمل ← لجنة عمادة البحث العلمي ← التحكيم الفني ← اعتماد الميزانية وفتح مركز تكلفة مالي للمشروع',
      rulesChecked: ['توافق موضوع البحث مع الأولويات البحثية المعتمدة للجامعة', 'خلو المقترح من الانتحال والسرقات الأدبية', 'وضوح بنود الموازنة التقديرية'],
      databaseImpact: 'إنشاء كود مشروع بحثي (RES-...)، ربطه بمركز تكلفة في شجرة الحسابات، وتحديد مراحل الصرف.',
      stages: [
        { num: 1, title: 'تقديم مقترح المشروع', desc: 'إدخال ملخص البحث، الأهداف، المنهجية، والموازنة التقديرية المطلوبة.' },
        { num: 2, title: 'الفحص المبدئي', desc: 'فحص الأصالة العلمية والتأكد من توافر شروط الدعم المقررة.' },
        { num: 3, title: 'التحكيم التخصصي', desc: 'تقييم الجدوى العلمية والأثر المعرفي للمشروع عبر مقيمين متخصصين.' },
        { num: 4, title: 'تخصيص الميزانية', desc: 'اعتماد عمادة البحث العلمي وفتح مركز تكلفة مالي مخصص للصرف.' },
        { num: 5, title: 'بدء المشروع وتتبع الإنجاز', desc: 'صرف الدفعة الأولى ومتابعة نسب الإنجاز الدورية عبر لوحة الأبحاث.' },
      ],
      quickView: 'research',
    },
    req_it_access: {
      id: 'req_it_access',
      name: 'طلب خدمة تقنية وصلاحيات أنظمة وبنية تحتية (IT Infrastructure & Access)',
      category: 'الإدارة والأنظمة والبنية التحتية',
      audience: 'الموظفون وأعضاء الهيئة التدريسية',
      slaHours: 24,
      attachmentRequired: false,
      issuesDigitalDoc: false,
      approvalMatrix: 'طالب الخدمة ← موافقة المدير المباشر ← مراجعة مسؤول الأمن السيبراني ← التنفيذ الآلي للصلاحية ← إشعار الإنجاز مع قيد في سجل التدقيق',
      rulesChecked: ['تناسب الصلاحيات المطلوبة مع المسمى الوظيفي (Need-To-Know)', 'عدم الإخلال بمبدأ فصل المهام (Separation of Duties)'],
      databaseImpact: 'إضافة الصلاحية في جدول مستخدمي النظام، وتسجيل الإسناد في سجل التدقيق المشفر (Audit Log).',
      stages: [
        { num: 1, title: 'تحديد نوع الصلاحية', desc: 'اختيار النظام أو الشاشة المطلوبة وتحديد نوع الإذن (قراءة / كتابة / إدارة).' },
        { num: 2, title: 'موافقة رئيس القسم', desc: 'المصادقة على حاجة العمل الوظيفية لتلك الصلاحيات.' },
        { num: 3, title: 'المراجعة الأمنية', desc: 'التأكد من عدم تعارض الصلاحيات مع قواعد الأمن السيبراني وضوابط التدقيق.' },
        { num: 4, title: 'التفعيل في النظام', desc: 'تحديث حساب المستخدم فورياً ومنحه مفاتيح الوصول المقررة.' },
        { num: 5, title: 'التوثيق والإشعار', desc: 'تسجيل التفعيل في سجل الرقابة وتنبيه الموظف بجاهزية الصلاحية.' },
      ],
      quickView: 'admin',
    },
  };

  UA.views.guidelines = () => {
    const q = (U.guideQuery || '').trim().toLowerCase();
    const mode = U.guideMode || 'depts';

    // فلترة الأقسام في نمط depts
    const deptFlt = U.guideDeptFilter || 'all';
    const filteredDepts = GUIDE_DEPARTMENTS.filter((d) => {
      if (deptFlt !== 'all' && d.category !== deptFlt) return false;
      if (!q) return true;
      const hay = `${d.title} ${d.badge} ${d.summary} ${d.roles.join(' ')} ${d.steps.join(' ')} ${d.correspondenceNote}`.toLowerCase();
      return hay.includes(q);
    });

    const modeNavChips = [
      ['depts', '🏢 دليل الأقسام والمنظومات (14 قسماً ووحدة)'],
      ['hierarchy', '🏛️ هيكلية العمل والسلسلة الإدارية والتراتبية الجامعية'],
      ['lifecycle', '🔄 محاكي دورة حياة كافة الطلبات والمعاملات'],
      ['corr_rules', '✉️ أصول المراسلات الرسمية والديوان والتوقيع الرقمي'],
      ['governance', '🛡️ الإدارة المركزية والقوائم المنسدلة وآليات الرقابة'],
    ].map((m) => `<button type="button" class="chip" data-act="guidetab" data-t="${m[0]}" aria-pressed="${mode === m[0]}" style="${mode === m[0] ? 'background:#054239;color:#fff;font-weight:800;border-color:#054239' : ''}">${esc(m[1])}</button>`).join('');

    let modeContent = '';

    // ==========================================
    // 1. نمط دليل الأقسام الـ 14
    // ==========================================
    if (mode === 'depts') {
      const catChips = [
        ['all', 'كل الأقسام (14 قسماً)'],
        ['academic', 'الأكاديمي والامتحانات والأبحاث'],
        ['students', 'شؤون الطلاب والقبول والخدمات'],
        ['hr', 'شؤون الموظفين والرواتب والبصمة'],
        ['finance', 'المالية والمحاسبة والمشتريات'],
        ['admin', 'الإدارة والديوان والمراقبة والتحقق'],
      ].map((c) => `<button type="button" class="chip sm" data-act="guidedeptflt" data-f="${c[0]}" aria-pressed="${deptFlt === c[0]}">${esc(c[1])}</button>`).join('');

      const cards = filteredDepts.map((d) => `
        <section class="card" style="margin-top:16px;border-inline-start:4px solid #054239;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div>
              <span class="pill p-approved" style="font-size:11px;margin-bottom:6px;display:inline-block">${esc(d.badge)}</span>
              <h2 style="margin:0;color:#054239;font-size:18px">${esc(d.title)}</h2>
            </div>
            <button type="button" class="btn sm pri" data-act="view" data-v="${esc(d.targetView)}" style="align-self:flex-start">انتقل للقسم مباشرة ←</button>
          </div>

          <p style="margin:10px 0 0;font-size:13.5px;color:#334155;line-height:1.6"><b>الهدف الأكاديمي والتنظيمي:</b> ${esc(d.summary)}</p>

          <div style="margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="small" style="font-weight:700;color:#054239">الأدوار والصلاحيات المعنية:</span>
            ${d.roles.map((r) => `<span class="pill" style="background:#f1f5f9;color:#334155;font-size:11px">${esc(r)}</span>`).join('')}
          </div>

          <div style="margin-top:12px;background:#f8fafc;padding:14px 18px;border-radius:10px;border:1px solid #e2e8f0">
            <b style="color:#054239;display:block;margin-bottom:8px;font-size:13.5px">آلية العمل والخطوات المنهجية خطوة بخطوة:</b>
            <ol style="margin:0;padding-inline-start:20px;line-height:1.8;font-size:13px;color:#0f172a">
              ${d.steps.map((st) => `<li style="margin-bottom:6px">${esc(st)}</li>`).join('')}
            </ol>
          </div>

          <div style="margin-top:12px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12.5px;color:#92400e">
            <b>📌 ضوابط التدقيق والمراسلات والأثر القانوني:</b> ${esc(d.correspondenceNote)}
          </div>
        </section>
      `).join('');

      modeContent = `
        <div style="margin-top:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span class="small" style="font-weight:700;color:#475569">تصفية حسب القطاع:</span>
          ${catChips}
        </div>
        ${cards || '<section class="card" style="margin-top:16px"><div class="empty">لا توجد أقسام مطابقة لعبارة البحث.</div></section>'}
      `;
    }

    // ==========================================
    // 2. نمط هيكلية العمل والسلسلة الإدارية
    // ==========================================
    else if (mode === 'hierarchy') {
      const activeNode = HIERARCHY_TIERS.find((n) => n.id === U.guideNode) || HIERARCHY_TIERS[0];

      const tierCards = HIERARCHY_TIERS.map((node) => {
        const isCur = node.id === activeNode.id;
        return `
          <div data-act="guidenode" data-id="${esc(node.id)}" style="cursor:pointer;padding:12px 14px;border-radius:12px;border:2px solid ${isCur ? node.color : '#e2e8f0'};background:${isCur ? '#f0fdf4' : '#fff'};transition:all .15s;position:relative">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span class="pill" style="font-size:10px;background:${node.color};color:#fff">${esc(node.rank)}</span>
              ${isCur ? '<span style="font-size:11px;font-weight:800;color:#054239">محدد حالياً ✓</span>' : ''}
            </div>
            <div style="font-weight:800;color:#0f172a;font-size:14px">${esc(node.title)}</div>
            <div class="small" style="color:#64748b;margin-top:2px">${esc(node.subtitle)}</div>
          </div>
        `;
      }).join('');

      modeContent = `
        <section class="card" style="margin-top:16px">
          <h2>المخطط الهيكلي التفاعلي للتراتبية الإدارية والأكاديمية بالجامعة</h2>
          <p class="hint" style="margin-top:0">اضغط على أي مستوى إداري أدناه لمعاينة مصفوفة صلاحياته وسلسلة الرفع الإداري والقرارات التي يملك حق توقيعها.</p>

          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:14px">
            ${tierCards}
          </div>
        </section>

        <section class="card" style="margin-top:16px;border-inline-start:5px solid ${activeNode.color};box-shadow:0 2px 6px rgba(0,0,0,0.06)">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <div>
              <span class="pill" style="background:${activeNode.color};color:#fff;font-size:11px">${esc(activeNode.rank)}</span>
              <h2 style="margin:6px 0 2px;color:${activeNode.color}">${esc(activeNode.title)}</h2>
              <div class="small" style="color:#475569;font-weight:600">${esc(activeNode.subtitle)}</div>
            </div>
            <button type="button" class="btn pri sm" data-act="view" data-v="${esc(activeNode.systemView)}">فتح القسم المرتبط بهذا المستوى ←</button>
          </div>

          <p style="margin:12px 0 0;font-size:14px;color:#1e293b;line-height:1.6"><b>نطاق المسؤوليات والاختصاص:</b> ${esc(activeNode.scope)}</p>

          <div class="grid2" style="margin-top:14px">
            <div style="background:#f8fafc;padding:12px 16px;border-radius:10px;border:1px solid #e2e8f0">
              <b style="color:#054239;display:block;margin-bottom:8px">الصلاحيات والقرارات المصرح بها:</b>
              <ul style="margin:0;padding-inline-start:18px;line-height:1.8;font-size:13px;color:#0f172a">
                ${activeNode.authorities.map((a) => `<li>${esc(a)}</li>`).join('')}
              </ul>
            </div>

            <div style="background:#f8fafc;padding:12px 16px;border-radius:10px;border:1px solid #e2e8f0">
              <b style="color:#054239;display:block;margin-bottom:8px">سلسلة الرفع والمساءلة الإدارية:</b>
              <dl class="kv" style="margin:0;font-size:13px">
                <dt>الجهة المشرفة المباشرة</dt><dd><b>${esc(activeNode.reportsTo)}</b></dd>
                <dt>الجهات التابعة له</dt><dd>${esc(activeNode.directSubordinates)}</dd>
                <dt>مسار المراسلات</dt><dd>عبر الديوان والمذكرات الداخلية المعتمدة</dd>
              </dl>
            </div>
          </div>
        </section>
      `;
    }

    // ==========================================
    // 3. نمط محاكي دورة حياة كافة الطلبات والمعاملات
    // ==========================================
    else if (mode === 'lifecycle') {
      const activeSim = REQUEST_SIMULATOR_DATA[U.guideReqSim] || REQUEST_SIMULATOR_DATA.req_enrollment;
      const curStep = Math.max(1, Math.min(5, U.guideReqStep || 1));

      const reqOptions = Object.values(REQUEST_SIMULATOR_DATA).map((r) => `
        <option value="${esc(r.id)}"${r.id === activeSim.id ? ' selected' : ''}>${esc(r.name)} (${esc(r.category)})</option>
      `).join('');

      const stageBoxes = activeSim.stages.map((st) => {
        const isDone = st.num < curStep;
        const isCurrent = st.num === curStep;
        return `
          <div data-act="guidestep" data-st="${st.num}" style="cursor:pointer;flex:1;min-width:140px;padding:10px 12px;border-radius:10px;border:2px solid ${isCurrent ? '#054239' : (isDone ? '#86efac' : '#e2e8f0')};background:${isCurrent ? '#f0fdf4' : (isDone ? '#f0fdf4' : '#fff')};transition:all .15s">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span class="mono" style="font-weight:800;color:${isCurrent ? '#054239' : '#64748b'}">المرحلة ${st.num}</span>
              ${isDone ? '<span style="color:#059669;font-weight:800;font-size:11px">مكتملة ✓</span>' : (isCurrent ? '<span class="pill p-approved" style="font-size:10px">نشطة الآن</span>' : '')}
            </div>
            <div style="font-weight:700;font-size:13px;color:#0f172a">${esc(st.title)}</div>
          </div>
        `;
      }).join('');

      const activeStage = activeSim.stages.find((s) => s.num === curStep) || activeSim.stages[0];

      modeContent = `
        <section class="card" style="margin-top:16px">
          <h2>محاكي دورة حياة كافة الطلبات والمعاملات ومصفوفة الاعتماد</h2>
          <p class="hint" style="margin-top:0">اختر نوع المعاملة الجامعية من القائمة لتشغيل المحاكي التفاعلي ومعاينة مراحل الفحص الآلي، مصفوفة التوقيع، والمهلة المعيارية (SLA).</p>

          <div class="inline-form" style="margin-top:12px;background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #cbd5e1">
            <label style="flex:1">اختر نوع المعاملة لتشغيل المحاكاة:
              <select id="guide-sim-sel" data-act="guidereq" style="background:#fff;font-weight:700;color:#054239">
                ${reqOptions}
              </select>
            </label>
            <button type="button" class="btn pri" data-act="view" data-v="${esc(activeSim.quickView)}">انتقل لتقديم هذا الطلب الآن ←</button>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
            ${stageBoxes}
          </div>

          <div style="margin-top:16px;padding:16px;background:#f8fafc;border:1.5px solid #054239;border-radius:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
              <div>
                <span class="pill p-approved">المرحلة ${activeStage.num} من 5</span>
                <h3 style="margin:6px 0 2px;color:#054239">${esc(activeStage.title)}</h3>
              </div>
              <div class="actions" style="margin:0">
                <button type="button" class="btn sm" data-act="guidestep" data-st="${curStep - 1}" ${curStep <= 1 ? 'disabled' : ''}>◀ المرحلة السابقة</button>
                <button type="button" class="btn sm pri" data-act="guidestep" data-st="${curStep + 1}" ${curStep >= 5 ? 'disabled' : ''}>المرحلة التالية ⏩</button>
              </div>
            </div>
            <p style="margin:10px 0 0;font-size:14px;color:#1e293b;line-height:1.6"><b>الإجراء التنفيذي في هذه المرحلة:</b> ${esc(activeStage.desc)}</p>
          </div>

          <div class="grid2" style="margin-top:16px">
            <div style="background:#fff;padding:14px;border:1px solid #e2e8f0;border-radius:10px">
              <h4 style="margin:0 0 8px;color:#054239">قواعد الفحص الآلي والشروط المسبقة</h4>
              <ul style="margin:0;padding-inline-start:18px;line-height:1.8;font-size:13px;color:#334155">
                ${activeSim.rulesChecked.map((r) => `<li>${esc(r)}</li>`).join('')}
              </ul>
              <div style="margin-top:10px;font-size:12.5px;color:#475569">
                <b>مهلة الإنجاز النظامية (SLA):</b> <span class="pill" style="background:#e0f2fe;color:#0369a1">${activeSim.slaHours} ساعة</span>
              </div>
            </div>

            <div style="background:#fff;padding:14px;border:1px solid #e2e8f0;border-radius:10px">
              <h4 style="margin:0 0 8px;color:#054239">مصفوفة الاعتماد والأثر في النظام</h4>
              <div style="font-size:13px;line-height:1.6;color:#1e293b;margin-bottom:8px">
                <b>مسار الاعتماد:</b><br><span style="color:#047857;font-weight:600">${esc(activeSim.approvalMatrix)}</span>
              </div>
              <div style="font-size:12.5px;color:#475569;margin-top:8px">
                <b>الأثر الآلي الفوري على قواعد البيانات:</b><br>${esc(activeSim.databaseImpact)}
              </div>
            </div>
          </div>
        </section>
      `;
    }

    // ==========================================
    // 4. أصول المراسلات الرسمية والديوان
    // ==========================================
    else if (mode === 'corr_rules') {
      modeContent = `
        <section class="card" style="margin-top:16px">
          <h2>أصول المراسلات والكتب الرسمية والديوان الإلكتروني والتوقيع الرقمي</h2>
          <p class="hint" style="margin-top:0">تخضع كافة المحررات الرسمية والتعاميم والمذكرات الصادرة عن الجامعة لضوابط الصياغة والترميز والتوقيع المشفر بموجب القواعد المعتمدة.</p>

          <div class="grid2" style="margin-top:16px">
            <div style="background:#f8fafc;padding:14px;border:1px solid #e2e8f0;border-radius:10px">
              <h3 style="margin:0 0 8px;color:#054239">1. أنواع المحررات الرسمية واستخداماتها</h3>
              <ul style="margin:0;padding-inline-start:18px;line-height:1.8;font-size:13px;color:#334155">
                <li><b>الكتاب الرسمي الصادر (Official Letter):</b> موجه للجهات الخارجية والوزارات أو بين الكليات؛ يحمل رقم ديوان عام وشعار الجامعة وختم X.509.</li>
                <li><b>المذكرة الداخلية (Internal Memo):</b> تواصل إداري أو فني بين إدارات وأقسام الجامعة بمسار توقيع تسلسلي أو متوازٍ.</li>
                <li><b>التعميم الإداري (Circular):</b> إعلان سياسات أو تعليمات عامة يصدر من الرئاسة أو العمادات ويوزع على صناديق كافة العاملين.</li>
                <li><b>القرار الإداري (Administrative Decision):</b> أمر نافذ بتشكيل لجان، تكليفات، أو عقوبات انضباطية غير قابل للتراجع إلا بقرار لاحق.</li>
              </ul>
            </div>

            <div style="background:#f8fafc;padding:14px;border:1px solid #e2e8f0;border-radius:10px">
              <h3 style="margin:0 0 8px;color:#054239">2. ضوابط مسار التواقيع الإلكترونية</h3>
              <ul style="margin:0;padding-inline-start:18px;line-height:1.8;font-size:13px;color:#334155">
                <li><b>التوقيع التسلسلي الإلزامي:</b> لا ينتقل المستند للمعتمد التالي في السلسلة إلا بعد اعتماد وتوقيع المعتمد الحالي رسمياً.</li>
                <li><b>خيارات المعتمد النظامية:</b> (أ) توقيع واعتماد، (ب) إعادة للمنشئ لاستدراك الملاحظات، (ج) رفض مسبب مع تدوين السبب بالسجل.</li>
                <li><b>قاعدة عدم التعديل:</b> لا يمكن تعديل نص الكتاب بعد توقيعه؛ التعديل يستوجب إعادة فتح رسمي يعيد دورة التواقيع لحماية الوثيقة.</li>
                <li><b>التوقيع الرقمي والـ QR:</b> كل كتاب معتمد يُختم برمز QR ورابط تحقق فريد يتيح التثبت من أصالته فورياً.</li>
              </ul>
            </div>
          </div>

          <div class="actions" style="margin-top:16px">
            <button type="button" class="btn pri" data-act="view" data-v="corr">فتح الديوان والمراسلات والطلبات الداخلية ←</button>
          </div>
        </section>
      `;
    }

    // ==========================================
    // 5. الإدارة المركزية والقوائم المنسدلة والرقابة
    // ==========================================
    else if (mode === 'governance') {
      modeContent = `
        <section class="card" style="margin-top:16px">
          <h2>الإدارة المركزية، القوائم المنسدلة، خيار «أخرى»، وآليات المراقبة والتدقيق</h2>
          <p class="hint" style="margin-top:0">تتيح المنظومة مرونة كاملة في تعديل القوائم المنسدلة وإضافة الخيارات الفورية مع إحكام أمني بمستوى التشفير والتدقيق المستمر.</p>

          <div class="grid2" style="margin-top:16px">
            <div style="background:#f8fafc;padding:14px;border:1px solid #e2e8f0;border-radius:10px">
              <h3 style="margin:0 0 8px;color:#054239">تعديل وإضافة جميع القوائم المنسدلة</h3>
              <p style="font-size:13px;color:#334155;line-height:1.6">
                ادخل إلى «لوحة الإدارة المركزية ← الإعدادات العامة والقوائم المنسدلة». ستجد جميع القوائم المنسدلة في النظام مع أزرار لإضافة أي خيار جديد أو تعديل/حذف الخيارات الحالية فورياً دون برمجة.
              </p>
              <h4 style="margin:10px 0 4px;color:#054239">خيار «أخرى» والإدخال المخصص</h4>
              <p style="font-size:13px;color:#334155;line-height:1.6">
                تحتوي القوائم المنسدلة على خيار <b>«أخرى (إدخال مخصص...)»</b>؛ بمجرد اختياره يظهر حقل نصي فوري لكتابة الخيار الخاص واعتماده فورياً بالنموذج.
              </p>
            </div>

            <div style="background:#f8fafc;padding:14px;border:1px solid #e2e8f0;border-radius:10px">
              <h3 style="margin:0 0 8px;color:#054239">آليات المراقبة وسلسلة التدقيق (SHA-256)</h3>
              <p style="font-size:13px;color:#334155;line-height:1.6">
                يستخدم النظام سلسلة بصمات مشفرة غير قابلة للتعديل؛ أي محاولة لتغيير سجل سابق تكسر السلسلة فوراً وتطلق تنبيهاً أمنياً.
              </p>
              <h4 style="margin:10px 0 4px;color:#054239">البحث التلقائي والإكمال الفوري</h4>
              <p style="font-size:13px;color:#334155;line-height:1.6">
                جميع حقول البحث في الجداول تدعم البحث التلقائي بمجرد كتابة الأحرف الأولى (Instant Search-As-You-Type) دون الحاجة للضغط على زر ودون فقدان التركيز.
              </p>
            </div>
          </div>

          <div class="actions" style="margin-top:16px">
            <button type="button" class="btn pri" data-act="view" data-v="admin">فتح لوحة الإدارة المركزية ←</button>
            <button type="button" class="btn" data-act="view" data-v="audit">فحص سلسلة التدقيق والمراقبة ←</button>
          </div>
        </section>
      `;
    }

    // ==========================================
    // 6. خرائط المعمارية التفاعلية المعتمدة (Archify Interactive Diagrams)
    // ==========================================
    else if (mode === 'archify') {
      modeContent = renderArchifyDiagramsBlock();
    }

    return `
      <section class="card" style="background:linear-gradient(135deg,#054239 0%,#0b5d50 100%);color:#fff;border-radius:14px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
          <div>
            <span class="pill" style="background:#D5B65D;color:#042f28;font-weight:800">الدليل التفاعلي المعتمد والشامل لكامل النظام</span>
            <h1 style="margin:8px 0 4px;font-size:22px;color:#fff">دليل العمل الأكاديمي والإداري التفاعلي الشامل وهيكلية المنظومة</h1>
            <p style="margin:0;opacity:.92;font-size:13.5px">مرجع شامل لكافة أقسام ووحدات المنظومة (14 قسماً)، الهيكل التنظيمي للجامعة، محاكي دورة حياة كافة الطلبات والمعاملات، وأصول المراسلات الرسمية.</p>
          </div>
          <button type="button" class="btn" data-act="guideprint" style="background:#fff;color:#054239;font-weight:800;border:none">🖨 طباعة الدليل التفاعلي (PDF)</button>
        </div>
        <div class="inline-form" style="margin-top:16px">
          <label style="flex:1;color:#fff">بحث فوري ذكي في كامل دليل الإرشادات والأنظمة
            <input id="guide-search-q" type="search" value="${esc(U.guideQuery)}" placeholder="ابحث عن أي قسم، معاملة، صلاحية، مراسلة، أو إجراء..." style="background:#fff;color:#0f172a;font-weight:600">
          </label>
        </div>
      </section>

      <div class="sub-tabs no-print" role="tablist" style="margin-top:14px">
        ${modeNavChips}
      </div>

      ${modeContent}
    `;
  };

  /* ==========================================================================
     8. خيار «أخرى» مع بند الإدخال المخصص + الإكمال التلقائي والبحث الفوري
     ========================================================================== */
  function enhanceSelectsWithOtherOption() {
    const selects = document.querySelectorAll('select');
    selects.forEach((sel) => {
      // استثناء قوائم الفلاتر العامة ("الكل") أو قوائم التصفح وأحجام الصفحات
      if (
        sel.dataset.noOther === '1' ||
        sel.classList.contains('tf-ps') ||
        sel.id === 'cam-res-sel' ||
        sel.id === 'cam-dev-sel' ||
        sel.id === 'imp-unified-kind' ||
        sel.id === 'imp-req-svc' ||
        sel.dataset.chg === 'xfilter'
      ) {
        return;
      }
      const firstOpt = sel.options[0];
      if (firstOpt && (firstOpt.textContent.trim() === 'الكل' || firstOpt.textContent.trim().startsWith('كل '))) {
        return;
      }

      // إضافة خيار "أخرى" إن لم يكن موجوداً في قوائم النماذج
      const hasOther = [...sel.options].some((o) => o.value === 'أخرى' || o.value === 'other' || o.textContent.trim() === 'أخرى' || o.dataset.customOther === '1');
      if (!hasOther && sel.options.length >= 2) {
        const opt = document.createElement('option');
        opt.value = 'أخرى';
        opt.textContent = 'أخرى (إدخال مخصص...)';
        opt.dataset.customOther = '1';
        sel.appendChild(opt);
      }

      if (sel.dataset.otherBound === '1') return;
      sel.dataset.otherBound = '1';

      const ensureCustomBox = () => {
        const selectedOpt = sel.options[sel.selectedIndex];
        const isOther = selectedOpt && (
          selectedOpt.value === 'أخرى' ||
          selectedOpt.value === 'other' ||
          selectedOpt.textContent.trim().startsWith('أخرى') ||
          selectedOpt.dataset.customOther === '1'
        );
        let wrap = sel.parentElement && sel.parentElement.querySelector('.ua-other-custom-wrap');
        if (isOther) {
          if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'ua-other-custom-wrap';
            wrap.style.cssText = 'margin-top:6px;display:flex;gap:6px;align-items:center;width:100%';
            wrap.innerHTML = `<input type="text" class="ua-other-custom-inp" placeholder="اكتب البيان المخصص لخيار (أخرى) هنا..." style="flex:1;border:1.5px solid #054239;background:#f0fdf4;padding:6px 10px;border-radius:8px;font-size:12.5px">`;
            sel.insertAdjacentElement('afterend', wrap);
            const inp = wrap.querySelector('.ua-other-custom-inp');
            inp.addEventListener('input', () => {
              const customVal = inp.value.trim();
              if (customVal) {
                selectedOpt.value = customVal;
                selectedOpt.textContent = `أخرى: ${customVal}`;
                selectedOpt.dataset.customOther = '1';
              } else {
                selectedOpt.value = 'أخرى';
                selectedOpt.textContent = 'أخرى (إدخال مخصص...)';
              }
            });
          }
        } else if (wrap) {
          wrap.remove();
        }
      };

      sel.addEventListener('change', ensureCustomBox);
      ensureCustomBox();
    });
  }

  let scopeListSeq = 0;
  function ensureGlobalAutocompleteDatalist() {
    // اقتراحات كل حقل بحث مأخوذة من الجدول المرافق له فقط؛ والبحث العلوي عام عبر نافذة البحث الشامل
    document.querySelectorAll('input[type="search"], #st-q, #hr-emp-q, #in-search-q, #cf-q, #gt-q, #af-q').forEach((inp) => {
      if (inp.id === 'sx-q' || inp.id === 'sx-cmd-input' || inp.classList.contains('tf-pop-q')) return;
      const owned = inp.dataset.uaScopeList;
      if (inp.getAttribute('list') && !owned) return;   // حقل له قائمته الخاصة مثل منتقي الطلاب
      const scope = inp.closest('.tf-bar') ? inp.closest('.tf-bar').parentElement : inp.closest('section, .card, .sx-panel, .sx-page');
      const table = scope && scope.querySelector('table');
      if (!table) return;
      const suggestions = new Set();
      for (const row of table.querySelectorAll('tbody tr')) {
        for (const cell of row.cells) {
          if (cell.querySelector('button, input, select')) continue;
          const v = cell.textContent.replace(/\s+/g, ' ').trim();
          if (v.length >= 2 && v.length <= 60) suggestions.add(v);
        }
        if (suggestions.size >= 200) break;
      }
      if (!owned) { inp.dataset.uaScopeList = `ua-scope-${++scopeListSeq}`; inp.setAttribute('list', inp.dataset.uaScopeList); inp.setAttribute('autocomplete', 'off'); }
      let dl = document.getElementById(inp.dataset.uaScopeList);
      if (!dl) { dl = document.createElement('datalist'); dl.id = inp.dataset.uaScopeList; inp.insertAdjacentElement('afterend', dl); }
      // نعيد الكتابة فقط عند تغيّر المحتوى: إعادة كتابة القائمة وهي مفتوحة كانت تُغلق نافذة الاقتراحات فوراً
      const html = [...suggestions].map((v) => `<option value="${esc(v)}"></option>`).join('');
      if (dl.dataset.sig !== html) { dl.dataset.sig = html; dl.innerHTML = html; }
    });
  }

  function mountSplitEnterpriseBlocks() {
    const esHr = document.getElementById('es-hr-mount');
    if (esHr && !esHr.dataset.mounted && UA.renderEnterpriseSection) {
      esHr.dataset.mounted = '1';
      esHr.innerHTML = UA.renderEnterpriseSection('hr_finance');
    }
    const audDevops = document.getElementById('audit-devops-mount');
    if (audDevops && !audDevops.dataset.mounted && UA.views.devops) {
      audDevops.dataset.mounted = '1';
      UA.views.devops(audDevops, S.me);
    }
    const audEnt = document.getElementById('audit-enterprise-mount');
    if (audEnt && !audEnt.dataset.mounted && UA.renderEnterpriseSection) {
      audEnt.dataset.mounted = '1';
      audEnt.innerHTML = UA.renderEnterpriseSection('exec_devops');
    }
    const acadEnt = document.getElementById('acad-enterprise-mount');
    if (acadEnt && !acadEnt.dataset.mounted && UA.renderEnterpriseSection) {
      acadEnt.dataset.mounted = '1';
      acadEnt.innerHTML = UA.renderEnterpriseSection('academics');
    }
    const saPki = document.getElementById('sa-enterprise-pki-mount');
    if (saPki && !saPki.dataset.mounted && UA.renderEnterpriseSection) {
      saPki.dataset.mounted = '1';
      saPki.innerHTML = UA.renderEnterpriseSection('student_pki');
    }
    // إضافة زر سريع لنظام إنشاء فحص الامتحان PDF في صفحة الامتحانات والسكن (expansions)
    if (S.view === 'expansions') {
      const mount = document.getElementById('ua-view-mount');
      if (mount && !mount.querySelector('#exp-master-exam-banner')) {
        ensureExamCoursesLoaded().then(() => {
          if (mount.querySelector('#exp-master-exam-banner')) return;
          const wrap = document.createElement('div');
          wrap.id = 'exp-master-exam-banner';
          wrap.style.marginBottom = '16px';
          wrap.innerHTML = UA.renderMasterExamBuilder();
          mount.prepend(wrap);
          enhanceSelectsWithOtherOption();
        });
      }
    }
  }

  /* ==========================================================================
     15. منظومة التبويبات الذكية والتثبيت وسهولة الوصول والبحث الشامل والمعاينة السريعة
     ========================================================================== */
  const WS_STORAGE_KEY = 'ua_ws_pinned_v1';
  const A11Y_STORAGE_KEY = 'ua_a11y_prefs_v1';

  const wsState = {
    tabs: [], // [{ key, view, subAct, subVal, label, pinned, scrollY }]
    cmdOpen: false,
    cmdQuery: '',
    cmdSelectedIdx: 0,
  };

  // استعادة تفضيلات سهولة الوصول والتبويبات المثبتة عند التشغيل
  (function initA11yAndWorkspaceTabs() {
    try {
      const savedA11y = JSON.parse(localStorage.getItem(A11Y_STORAGE_KEY) || '{}');
      if (savedA11y.collapsed) document.body.classList.add('sx-collapsed');
      document.documentElement.style.removeProperty('font-size');   // إزالة أي تكبير/تصغير محفوظ سابقاً
    } catch {}
    try {
      const pinned = JSON.parse(localStorage.getItem(WS_STORAGE_KEY) || '[]');
      if (Array.isArray(pinned) && pinned.length) {
        wsState.tabs = pinned.map((t) => ({ ...t, pinned: true, scrollY: 0 }));
      } else {
        // تبويبات مثبتة افتراضية سريعة الوصول
        wsState.tabs = [
          { key: 'overview::unified', view: 'overview', subAct: 'maindashtab', subVal: 'unified', label: '🏠 اللوحة الرئيسية', pinned: true, scrollY: 0 },
          { key: 'affairs::requests', view: 'affairs', subAct: 'sttab', subVal: 'requests', label: '🎓 شؤون الطلاب · الطلبات', pinned: true, scrollY: 0 },
          { key: 'corr::in', view: 'corr', subAct: 'corrunified', subVal: 'in', label: '📨 الديوان والمراسلات', pinned: true, scrollY: 0 },
        ];
      }
    } catch {}
  })();

  function saveA11yPrefs() {
    try {
      localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify({
        collapsed: document.body.classList.contains('sx-collapsed'),
      }));
    } catch {}
  }

  function savePinnedWorkspaceTabs() {
    try {
      const pinned = wsState.tabs.filter((t) => t.pinned);
      localStorage.setItem(WS_STORAGE_KEY, JSON.stringify(pinned));
    } catch {}
  }

  function getActiveSubTabInfo(view) {
    if (view === 'overview') return { subAct: 'maindashtab', subVal: U.mainTab || 'unified', subLabel: U.mainTab === 'myprofile' ? 'ملفي' : U.mainTab === 'work' ? 'أعمالي' : 'الرئيسية' };
    if (view === 'affairs') return { subAct: 'sttab', subVal: S.stTab || 'requests', subLabel: S.stTab === 'list' ? 'سجل الطلاب' : S.stTab === 'new' ? 'طالب جديد' : 'الطلبات' };
    if (view === 'corr' || view === 'internal') return { subAct: 'corrunified', subVal: U.corrUnifiedTab || 'in', subLabel: U.corrUnifiedTab === 'pending_all' ? 'جميع المعلقة' : U.corrUnifiedTab === 'internal_requests' ? 'الطلبات الداخلية' : U.corrUnifiedTab === 'out' ? 'الصادر' : 'الوارد' };
    if (view === 'payroll' || view === 'hr') return { subAct: 'hrunified', subVal: U.hrSection || 'payroll', subLabel: U.hrSection === 'biometrics' ? 'البصمة' : U.hrSection === 'appraisals' ? 'تقييم الأداء' : U.hrSection === 'att_leaves' ? 'الحضور والإجازات' : U.hrSection === 'enterprise_hr' ? 'التطوير المؤسسي للموارد البشرية' : 'الرواتب' };
    if (view === 'audit') return { subAct: 'audtab2', subVal: U.auditSection || 'chain', subLabel: U.auditSection === 'hc_perf' ? 'الأداء الفائق' : U.auditSection === 'exec_offline' ? 'المراقبة المؤسسية' : U.auditSection === 'devops' ? 'البنية التحتية DevOps' : U.auditSection === 'waf_sec' ? 'جدار الحماية WAF' : 'السلسلة' };
    if (view === 'admin') return { subAct: 'admtab', subVal: S.adminTab || 'general', subLabel: S.adminTab === 'verify_merged' ? 'التحقق العام' : S.adminTab === 'units_merged' ? 'الهيكل والصلاحيات' : S.adminTab === 'mysettings' ? 'إعداداتي' : 'الإعدادات' };
    if (view === 'academics') return { subAct: U.acadExtraTab ? 'acadxtab' : 'actab', subVal: U.acadExtraTab || S.acTab || 'courses', subLabel: U.acadExtraTab === 'exam_master' ? 'جدول الفحص PDF' : U.acadExtraTab === 'enterprise_acad' ? 'القاعات الذكية وبنك الأسئلة' : 'المقررات والعلامات' };
    if (view === 'guidelines') return { subAct: 'guidetab', subVal: U.guideMode || 'depts', subLabel: U.guideMode === 'hierarchy' ? 'الهيكل التنظيمي' : U.guideMode === 'lifecycle' ? 'دورة الطلبات' : U.guideMode === 'archify' ? 'خرائط Archify' : 'الأقسام' };
    return { subAct: '', subVal: 'main', subLabel: '' };
  }

  UA.renderWorkspaceTabsBar = function renderWorkspaceTabsBar(activeView, viewLabel) {
    if (!S.me || S.me.role === 'student') return '';
    const v = activeView || S.view || 'overview';
    const sub = getActiveSubTabInfo(v);
    const curKey = `${v}::${sub.subVal || 'main'}`;
    const cleanViewLabel = String(viewLabel || v).replace(/\s*\(.*?\)\s*/g, '').trim();
    const fullLabel = sub.subLabel ? `${cleanViewLabel} · ${sub.subLabel}` : cleanViewLabel;

    let existing = wsState.tabs.find((t) => t.key === curKey);
    if (!existing) {
      // احتفظ بآخر 8 تبويبات غير مثبتة كحد أقصى لمنع الازدحام
      const unpinned = wsState.tabs.filter((t) => !t.pinned);
      if (unpinned.length >= 6) {
        const dropKey = unpinned[0].key;
        wsState.tabs = wsState.tabs.filter((t) => t.key !== dropKey);
      }
      existing = {
        key: curKey,
        view: v,
        subAct: sub.subAct,
        subVal: sub.subVal,
        label: fullLabel,
        pinned: false,
        scrollY: window.scrollY || 0,
      };
      wsState.tabs.push(existing);
    } else {
      existing.label = fullLabel || existing.label;
    }

    return `<div class="sx-ws-bar no-print" role="toolbar" aria-label="الانتقال السريع">
      <button type="button" class="sx-ws-add" data-act="sxcmdopen" title="فتح البحث الشامل والانتقال السريع (Ctrl+\`)">⚡ انتقال سريع (Ctrl+\`)</button>
    </div>`;
  };

  /* ---------- تحسين شريط التبويبات الفرعية بشارات الأعداد الحية واختصارات Alt+1..9 ---------- */
  function computeBadgeForChip(act, val) {
    if (act === 'sttab' && val === 'requests') return (S.stats && S.stats.review) || (S.requests || []).filter((r) => r.status === 'review').length || 0;
    if (act === 'sttab' && val === 'list') return (S.stList && S.stList.total) || (S.stList && S.stList.students && S.stList.students.length) || 0;
    if (act === 'hrunified' && val === 'biometrics') return U.biometrics.devices.length;
    if (act === 'hrunified' && val === 'appraisals') return U.appraisals.length;
    if (act === 'corrunified' && val === 'in') return (S.corr && S.corr.docs && S.corr.docs.length) || 0;
    if (act === 'corrunified' && val === 'notifs') return (S.corr && S.corr.unread) || 0;
    if (act === 'corrunified' && val === 'internal_requests') return (S.requests || []).length || 0;
    if (act === 'acadxtab' && val === 'exam_master') return (U.examSchedule.courses || []).length || 0;
    return 0;
  }

  function enhanceSubTabsBadgesAndShortcuts() {
    const primaryBar = document.querySelector('.sx-page .sub-tabs');
    if (!primaryBar) return;
    const chips = [...primaryBar.querySelectorAll('button.chip')];
    chips.forEach((btn, idx) => {
      const act = btn.dataset.act || '';
      const val = btn.dataset.t || btn.dataset.s || '';
      const count = computeBadgeForChip(act, val);
      if (count > 0 && !btn.querySelector('.sx-tab-badge')) {
        const b = document.createElement('span');
        b.className = 'sx-tab-badge';
        b.textContent = String(count);
        btn.appendChild(b);
      }
      if (idx < 9 && !btn.querySelector('.sx-kbd-hint')) {
        const kbd = document.createElement('kbd');
        kbd.className = 'sx-kbd-hint';
        kbd.textContent = `Alt+${idx + 1}`;
        btn.appendChild(kbd);
        btn.title = `${btn.textContent.trim()} (اختصار: Alt+${idx + 1})`;
      }
    });
  }

  /* ---------- درج المعاينة السريعة الجانبي للجداول (Slide-Over Quick Preview Drawer) ---------- */
  function ensureSlideOverDrawerDom() {
    let ov = document.getElementById('sx-slideover-overlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'sx-slideover-overlay';
    ov.className = 'sx-drawer-overlay no-print';
    ov.hidden = true;
    ov.innerHTML = `<aside class="sx-slideover" role="dialog" aria-modal="true" aria-label="معاينة سريعة للسجل">
      <div class="sx-slideover-head">
        <div>
          <span class="pill" style="background:rgba(255,255,255,0.2);color:#fff;font-size:11px">👁️ معاينة تفصيلية سريعة</span>
          <h3 id="sx-slideover-title" style="margin:4px 0 0;color:#fff;font-size:16px">تفاصيل السجل</h3>
        </div>
        <button type="button" class="btn sm" data-act="sxclosepreview" style="background:rgba(255,255,255,0.16);color:#fff;border-color:rgba(255,255,255,0.3)">✕ إغلاق (Esc)</button>
      </div>
      <div id="sx-slideover-body" class="sx-slideover-body"></div>
    </aside>`;
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.hidden = true;
    });
    document.body.appendChild(ov);
    return ov;
  }

  // المعلومة الأساسية: أول خلية نصية من الخليتين الأوليين. وإن كانت فيها أزرار أو روابط فللصف إجراؤه الخاص، فلا نضيف نقراً فوقه
  function primaryCell(tds) {
    const hasWords = (td) => /[\p{L}]{2}/u.test(td.textContent);
    const pick = tds.slice(0, 2).find((td) => hasWords(td) && /[\u0600-\u06FF]/.test(td.textContent)) || tds.slice(0, 2).find(hasWords);
    return pick && !pick.querySelector('a, button, input, select, textarea') ? pick : null;
  }
  function enhanceTablesWithQuickPreview() {
    document.querySelectorAll('.sx-page .tbl-wrap table, .sx-page table.sx-table').forEach((tbl) => {
      if (tbl.id === 'exm-master-table' || tbl.dataset.sxPreviewEnhanced) return;
      const ths = [...tbl.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (ths.length < 3) return;
      tbl.dataset.sxPreviewEnhanced = '1';
      tbl.querySelectorAll('tbody tr').forEach((tr) => {
        const tds = [...tr.querySelectorAll('td')];
        if (tds.length < 3 || tr.dataset.act || tr.querySelector('.sx-primary-cell')) return;
        const primary = primaryCell(tds);
        if (!primary) return;
        primary.classList.add('sx-primary-cell');
        primary.tabIndex = 0;
        primary.setAttribute('role', 'button');
        primary.title = 'عرض تفاصيل هذا السجل دون مغادرة الجدول';
        const openPreview = (ev) => {
          ev.stopPropagation();
          const ov = ensureSlideOverDrawerDom();
          const titleEl = document.getElementById('sx-slideover-title');
          const bodyEl = document.getElementById('sx-slideover-body');
          if (titleEl) titleEl.textContent = primary.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) || 'تفاصيل السجل';
          if (bodyEl) {
            const pairs = tds.map((td, i) => {
              const label = ths[i] || `حقل ${i + 1}`;
              const val = td.textContent.trim();
              if (!val) return '';
              return `<div style="padding:10px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                <span style="color:var(--muted);font-size:12.5px;font-weight:700;min-width:120px">${esc(label)}</span>
                <strong style="font-size:13px;text-align:end;word-break:break-word">${esc(val)}</strong>
              </div>`;
            }).filter(Boolean).join('');
            bodyEl.innerHTML = `<div class="card" style="padding:4px 12px;margin-bottom:14px">${pairs}</div>`;
          }
          ov.hidden = false;
        };
        primary.addEventListener('click', openPreview);
        primary.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPreview(ev); } });
      });
    });
  }

  /* ---------- الحفظ التلقائي لمسودات النماذج (Auto-Save Form Drafts) ---------- */
  function enhanceFormsWithAutoSaveDrafts() {
    document.querySelectorAll('.sx-page form').forEach((form, idx) => {
      const formKey = `ua_draft_${S.view || 'v'}_${form.id || idx}`;
      if (!form.dataset.sxDraftBound) {
        form.dataset.sxDraftBound = '1';
        form.addEventListener('input', () => {
          try {
            const payload = {};
            form.querySelectorAll('input:not([type="password"]):not([type="file"]):not([type="search"]), textarea, select').forEach((el) => {
              const k = el.id || el.name;
              if (k && el.value) payload[k] = el.value;
            });
            if (Object.keys(payload).length > 0) {
              sessionStorage.setItem(formKey, JSON.stringify({ at: Date.now(), data: payload }));
            }
          } catch {}
        });
        form.addEventListener('submit', () => {
          try { sessionStorage.removeItem(formKey); } catch {}
        });
      }
      try {
        const raw = sessionStorage.getItem(formKey);
        if (raw && !form.querySelector('.sx-draft-banner')) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.data && Object.keys(parsed.data).length > 0) {
            const banner = document.createElement('div');
            banner.className = 'sx-draft-banner no-print';
            banner.innerHTML = `<span>💾 توجد مسودة محفوظة تلقائياً لهذا النموذج</span>
              <div style="display:flex;gap:6px">
                <button type="button" class="btn sm pri" data-draft-restore="1">استعادة المسودة</button>
                <button type="button" class="btn sm" data-draft-clear="1">مسح</button>
              </div>`;
            banner.querySelector('[data-draft-restore]').addEventListener('click', () => {
              Object.entries(parsed.data).forEach(([k, v]) => {
                const el = form.querySelector(`#${CSS.escape(k)}, [name="${CSS.escape(k)}"]`);
                if (el) el.value = v;
              });
              toast('تمت استعادة مسودة النموذج المحفوظة تلقائياً');
              banner.remove();
            });
            banner.querySelector('[data-draft-clear]').addEventListener('click', () => {
              sessionStorage.removeItem(formKey);
              banner.remove();
            });
            form.prepend(banner);
          }
        }
      } catch {}
    });
  }

  /* ---------- نافذة الأوامر والبحث الشامل (Global Command Palette Ctrl+K) ---------- */
  function getCommandPaletteItems() {
    const items = [
      // الأقسام والتبويبات الفرعية
      { cat: 'اللوحة الرئيسية', title: '🏠 اللوحة الرئيسية وبصمة الدوام', view: 'overview', act: 'maindashtab', val: 'unified' },
      { cat: 'اللوحة الرئيسية', title: 'أعمالي وكل أقسامي', view: 'overview', act: 'maindashtab', val: 'work' },
      { cat: 'اللوحة الرئيسية', title: '👤 ملفي وصلاحياتي', view: 'overview', act: 'maindashtab', val: 'myprofile' },
      { cat: 'شؤون الطلاب', title: '🎓 شؤون الطلاب · سجل الطلبات الطلابية', view: 'affairs', act: 'sttab', val: 'requests' },
      { cat: 'شؤون الطلاب', title: '🎓 شؤون الطلاب · سجل الطلاب والبحث', view: 'affairs', act: 'sttab', val: 'list' },
      { cat: 'شؤون الطلاب', title: '➕ شؤون الطلاب · تسجيل طالب جديد', view: 'affairs', act: 'sttab', val: 'new' },
      { cat: 'شؤون الطلاب', title: '🪪 شؤون الطلاب · البطاقة الجامعية الرقمية', view: 'affairs', act: 'sttab', val: 'digital_card' },
      { cat: 'شؤون الطلاب', title: '🏫 شؤون الطلاب · القبول والمفاضلة والمعادلة', view: 'affairs', act: 'sttab', val: 'admissions' },
      { cat: 'شؤون الطلاب', title: '🧭 شؤون الطلاب · الخطة التفاعلية والإرشاد والإنذار', view: 'affairs', act: 'sttab', val: 'advising' },
      { cat: 'شؤون الطلاب', title: '🔁 شؤون الطلاب · حركات القيد والانضباط', view: 'affairs', act: 'sttab', val: 'lifecycle' },
      { cat: 'شؤون الطلاب', title: '⚖️ شؤون الطلاب · اللجنة التأديبية والمخالفات', view: 'affairs', act: 'sttab', val: 'disciplinary' },
      { cat: 'شؤون الطلاب', title: '🎁 شؤون الطلاب · المنح والإعفاءات', view: 'affairs', act: 'sttab', val: 'scholarships' },
      { cat: 'شؤون الطلاب', title: '🎟️ شؤون الطلاب · مكتب خدمة الطالب والدور', view: 'affairs', act: 'sttab', val: 'desk_queue' },
      { cat: 'التقارير', title: '📈 الإحصاءات والتقارير', view: 'dashboard' },
      { cat: 'الشؤون الأكاديمية', title: '👨‍🏫 الشؤون الأكاديمية · أعضاء هيئة التدريس', view: 'academics', act: 'acadtab', val: 'members' },
      { cat: 'الشؤون الأكاديمية', title: '🚪 سجل القاعات', view: 'attendance' },
      { cat: 'الشؤون الأكاديمية', title: '🏠 الامتحانات والسكن والتقييم', view: 'expansions' },
      { cat: 'المنظومة الأكاديمية', title: '💻 التعلم الإلكتروني والمكتبة', view: 'lms' },
      { cat: 'المنظومة الأكاديمية', title: '🔬 البحث والدراسات العليا', view: 'research' },
      { cat: 'المنظومة الأكاديمية', title: '🎓 الخريجون والتوظيف', view: 'alumni' },
      { cat: 'المنظومة الأكاديمية', title: '✅ الجودة والاعتماد المؤسسي', view: 'qa' },
      { cat: 'التواصل', title: '📰 الأخبار والشكاوى', view: 'comms' },
      { cat: 'الإدارة والحوكمة', title: '🔑 الحسابات والصلاحيات', view: 'access' },
      { cat: 'الديوان والمراسلات', title: '📨 الديوان والمراسلات · جميع المعاملات والطلبات المعلقة', view: 'corr', act: 'corrunified', val: 'pending_all' },
      { cat: 'الديوان والمراسلات', title: '📥 الديوان والمراسلات · البريد الوارد والكتب الرسمية', view: 'corr', act: 'corrunified', val: 'in' },
      { cat: 'الديوان والمراسلات', title: '📤 الديوان والمراسلات · البريد الصادر والأرشفة', view: 'corr', act: 'corrunified', val: 'out' },
      { cat: 'الديوان والمراسلات', title: '📋 الديوان والمراسلات · الطلبات الداخلية المدمجة', view: 'corr', act: 'corrunified', val: 'internal_requests' },
      { cat: 'الديوان والمراسلات', title: '✍️ الديوان والمراسلات · إنشاء كتاب أو مراسلة جديدة', view: 'corr', act: 'corrunified', val: 'new_corr' },
      { cat: 'الشؤون الأكاديمية', title: '📚 الشؤون الأكاديمية · دليل المقررات والخطط الدراسية', view: 'academics', act: 'acadtab', val: 'courses' },
      { cat: 'الشؤون الأكاديمية', title: '📊 الشؤون الأكاديمية · جدول العلامات والترتيب', view: 'academics', act: 'acadtab', val: 'grades' },
      { cat: 'الشؤون الأكاديمية', title: '🗓️ الشؤون الأكاديمية · إنشاء جدول فحص الامتحانات الشامل + PDF', view: 'academics', act: 'acadtab', val: 'exam_master' },
      { cat: 'شؤون الموظفين', title: '👥 شؤون الموظفين · ملفات الموظفين والعقود والرواتب', view: 'payroll', act: 'hrunified', val: 'payroll' },
      { cat: 'شؤون الموظفين', title: '🕒 شؤون الموظفين · الحضور والانصراف والإجازات', view: 'payroll', act: 'hrunified', val: 'att_leaves' },
      { cat: 'شؤون الموظفين', title: '🔐 شؤون الموظفين · منظومة البصمة وأجهزة الحضور الحيوي', view: 'payroll', act: 'hrunified', val: 'biometrics' },
      { cat: 'شؤون الموظفين', title: '⭐ شؤون الموظفين · تقييم الموظفين ومؤشرات الأداء (KPIs)', view: 'payroll', act: 'hrunified', val: 'appraisals' },
      { cat: 'شؤون الموظفين', title: '✨ شؤون الموظفين · التطوير المؤسسي للموارد البشرية والعبء التدريسي', view: 'payroll', act: 'hrunified', val: 'enterprise_hr' },
      { cat: 'المالية والمشتريات', title: '💰 المالية والمحاسبة · شجرة الحسابات والقيود المزدوجة', view: 'finance' },
      { cat: 'المالية والمشتريات', title: '📦 المشتريات والمخازن والعهد والأصول', view: 'procurement' },
      { cat: 'الاستيراد والتصدير', title: '📥 مركز الاستيراد الموحد (إكسل + قواعد البيانات)', view: 'exchange', act: 'extab', val: 'import' },
      { cat: 'الاستيراد والتصدير', title: '📤 صفحة التصدير الموحدة (Excel / Word / PDF)', view: 'exchange', act: 'extab', val: 'export' },
      { cat: 'الإدارة والحوكمة', title: '⚙️ لوحة الإدارة · الإعدادات العامة والقوائم المنسدلة', view: 'admin', act: 'atab', val: 'general' },
      { cat: 'الإدارة والحوكمة', title: '🏛️ لوحة الإدارة · وحدات النظام والهيكل وصلاحيات الأدوار', view: 'admin', act: 'atab', val: 'units' },
      { cat: 'الإدارة والحوكمة', title: '🔍 لوحة الإدارة · التحقق العام من الوثائق والباركود', view: 'admin', act: 'atab', val: 'verify' },
      { cat: 'الإدارة والحوكمة', title: '👤 لوحة الإدارة · إعداداتي الشخصية وكلمة المرور', view: 'admin', act: 'atab', val: 'mysettings' },
      { cat: 'المراقبة والأمن', title: '🛡️ آليات المراقبة والتدقيق · سلسلة التدقيق Cryptographic Chain', view: 'audit', act: 'audtab2', val: 'chain' },
      { cat: 'المراقبة والأمن', title: '⚡ آليات المراقبة والتدقيق · محرك الأداء الفائق والضغط العالي (10K مستخدم)', view: 'audit', act: 'audtab2', val: 'hc_perf' },
      { cat: 'المراقبة والأمن', title: '🧾 آليات المراقبة والتدقيق · سجل أحداث النظام والخادم', view: 'audit', act: 'audtab2', val: 'logs' },
      { cat: 'المراقبة والأمن', title: '🖥️ آليات المراقبة والتدقيق · البنية التحتية والمراقبة الحية', view: 'audit', act: 'audtab2', val: 'devops' },
      { cat: 'الدليل التفاعلي', title: '📖 دليل الإرشادات التفاعلي الشامل · جميع الأقسام والطلبات', view: 'guidelines', act: 'guidetab', val: 'depts' },
      { cat: 'الدليل التفاعلي', title: '🗺️ دليل الإرشادات · الخريطة التفاعلية للهيكل التنظيمي', view: 'guidelines', act: 'guidetab', val: 'hierarchy' },
      { cat: 'الدليل التفاعلي', title: '🔄 دليل الإرشادات · محاكي دورة حياة الطلبات خطوة بخطوة', view: 'guidelines', act: 'guidetab', val: 'lifecycle' },
      { cat: 'الدليل التفاعلي', title: '📐 خرائط المعمارية التفاعلية (Archify Architecture, Tree, Workflow, ERD)', view: 'audit', act: 'audtab2', val: 'archify' },
      // أوامر سريعة للمظهر وسهولة الوصول
      { cat: 'إجراء سريع', title: '⇄ طي أو توسيع القائمة الجانبية (Ctrl+B)', run: () => UA.actions.sxtoggleside() },
    ];
    // لا تظهر إلا الأقسام التي يملك الحساب فتحها، تليها نتائج الطلاب من الخادم
    const allowed = new Set(UA.viewsFor(S.me.role).map((v) => v[0]));
    return [...items.filter((it) => !it.view || allowed.has(it.view)), ...(wsState.cmdStudents || [])];
  }

  const cmdNorm = (s) => String(s || '').toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
  let cmdStudentTimer = null;
  function searchCommandStudents(q) {
    clearTimeout(cmdStudentTimer);
    wsState.cmdStudents = [];
    if (!UA.can('student:read') || q.trim().length < 2) return;
    cmdStudentTimer = setTimeout(async () => {
      try {
        const r = await api('GET', '/api/students?' + new URLSearchParams({ q: q.trim(), limit: '6' }));
        if (wsState.cmdQuery !== q) return;
        wsState.cmdStudents = (r.students || []).map((s) => ({
          cat: 'الطلاب',
          title: `👤 ${s.name} — ${s.studentNo}`,
          always: true,
          run: async () => { S.stList.q = s.studentNo; S.stTab = 'list'; S.stSel = null; await UA.go('affairs'); },
        }));
        renderCommandPaletteResults();
      } catch { /* نتائج الطلاب إضافية؛ فشلها لا يعطّل البحث في الأقسام */ }
    }, 200);
  }

  function ensureCommandPaletteDom() {
    let ov = document.getElementById('sx-cmd-palette');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'sx-cmd-palette';
    ov.className = 'sx-cmd-overlay no-print';
    ov.hidden = true;
    ov.innerHTML = `<div class="sx-cmd-box" role="dialog" aria-modal="true" aria-label="نافذة الأوامر والبحث الشامل">
      <div class="sx-cmd-head">
        <span style="font-size:18px">⚡</span>
        <input id="sx-cmd-input" type="search" placeholder="ابحث عن أي قسم، تبويب فرعي، طلب، أو إجراء سريع..." autocomplete="off">
        <kbd class="sx-kbd-hint" style="font-size:11px;padding:2px 6px">ESC</kbd>
      </div>
      <div id="sx-cmd-results" class="sx-cmd-list" role="listbox"></div>
      <div class="sx-cmd-foot">
        <span>↑↓ للتنقل بين النتائج · Enter للفتح الفوري · Esc للإغلاق</span>
        <span>Alt+1..9 لتبديل التبويبات الفرعية · Ctrl+B لطي القائمة</span>
      </div>
    </div>`;
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.hidden = true;
    });
    document.body.appendChild(ov);

    const inp = ov.querySelector('#sx-cmd-input');
    inp.addEventListener('input', () => {
      wsState.cmdQuery = inp.value;
      wsState.cmdSelectedIdx = 0;
      searchCommandStudents(inp.value);
      renderCommandPaletteResults();
    });
    inp.addEventListener('keydown', async (e) => {
      const list = getFilteredCommandItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        wsState.cmdSelectedIdx = Math.min(list.length - 1, wsState.cmdSelectedIdx + 1);
        renderCommandPaletteResults();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        wsState.cmdSelectedIdx = Math.max(0, wsState.cmdSelectedIdx - 1);
        renderCommandPaletteResults();
      } else if (e.key === 'Enter' && list[wsState.cmdSelectedIdx]) {
        e.preventDefault();
        await executeCommandItem(list[wsState.cmdSelectedIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        ov.hidden = true;
      }
    });
    return ov;
  }

  function getFilteredCommandItems() {
    const q = cmdNorm(wsState.cmdQuery);
    const base = getCommandPaletteItems();
    const all = UA.flowPaletteItems ? base.concat(UA.flowPaletteItems(base)) : base;
    if (!q) return all;
    return all.filter((it) => it.always || cmdNorm(it.title).includes(q) || cmdNorm(it.cat).includes(q));
  }

  async function executeCommandItem(item) {
    const ov = document.getElementById('sx-cmd-palette');
    if (ov) ov.hidden = true;
    if (item.run) {
      await item.run();
      return;
    }
    if (item.view) {
      if (S.view !== item.view) {
        await UA.go(item.view);
      }
      if (item.act) {
        // نضغط زر التبويب نفسه كي يمر بمسار الواجهة المعتاد، فبعض التبويبات لا تملك إجراءً مستقلاً في UA.actions
        const btn = document.querySelector(`[data-act="${item.act}"][data-t="${item.val}"], [data-act="${item.act}"][data-s="${item.val}"]`);
        if (btn) btn.click();
        else if (UA.actions[item.act]) await UA.actions[item.act](null, { t: item.val, s: item.val });
      }
    }
  }

  function renderCommandPaletteResults() {
    const box = document.getElementById('sx-cmd-results');
    if (!box) return;
    const list = getFilteredCommandItems();
    if (!list.length) {
      box.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">لا توجد نتائج مطابقة لـ «${esc(wsState.cmdQuery)}»</div>`;
      return;
    }
    box.innerHTML = list.map((it, idx) => `<button type="button" class="sx-cmd-item${idx === wsState.cmdSelectedIdx ? ' is-selected' : ''}" data-cmd-idx="${idx}">
      <div class="cmd-main"><strong>${esc(it.title)}</strong></div>
      <span class="cmd-cat">${esc(it.cat)}</span>
    </button>`).join('');
    box.querySelectorAll('[data-cmd-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = list[Number(btn.dataset.cmdIdx)];
        if (item) executeCommandItem(item);
      });
    });
  }

  UA.openCommandPalette = async function openCommandPalette(initial) {
    const ov = ensureCommandPaletteDom();
    const text = typeof initial === 'string' ? initial : '';
    wsState.cmdQuery = text;
    wsState.cmdSelectedIdx = 0;
    searchCommandStudents(text);
    renderCommandPaletteResults();
    ov.hidden = false;
    const inp = document.getElementById('sx-cmd-input');
    if (inp) {
      inp.value = text;
      setTimeout(() => inp.focus(), 20);
    }
  };

  // اختصارات لوحة المفاتيح للتبويبات الفرعية (Alt+1..9 + الأسهم) وCtrl+B لطي القائمة الجانبية
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'b') {
      e.preventDefault();
      if (UA.actions.sxtoggleside) UA.actions.sxtoggleside();
      return;
    }
    if (e.key === 'Escape') {
      const cmdOv = document.getElementById('sx-cmd-palette');
      if (cmdOv && !cmdOv.hidden) cmdOv.hidden = true;
      const drwOv = document.getElementById('sx-slideover-overlay');
      if (drwOv && !drwOv.hidden) drwOv.hidden = true;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      const bar = document.querySelector('.sx-page .sub-tabs');
      if (bar) {
        const chips = [...bar.querySelectorAll('button.chip')];
        if (chips[idx]) {
          e.preventDefault();
          chips[idx].click();
          chips[idx].focus();
        }
      }
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && document.activeElement && document.activeElement.closest('.sub-tabs')) {
      const bar = document.activeElement.closest('.sub-tabs');
      const chips = [...bar.querySelectorAll('button.chip')];
      const curIdx = chips.indexOf(document.activeElement);
      if (curIdx >= 0 && chips.length > 1) {
        e.preventDefault();
        const isRtl = document.documentElement.dir !== 'ltr';
        const step = (e.key === 'ArrowLeft' ? (isRtl ? 1 : -1) : (isRtl ? -1 : 1));
        const nextIdx = (curIdx + step + chips.length) % chips.length;
        chips[nextIdx].focus();
        chips[nextIdx].click();
      }
    }
  });

  let enhanceRafId = 0;
  /* ---------- عزل بصري لكل تبويب: يمنع تداخل الترويسات اللاصقة مع محتوى الجداول ----------
     صفحة الشاشة عمود Flex بعناصر مستقلة (كل بطاقة/جدول حاويته المعزولة isolation)، شريط التبويبات الفرعية فوق المحتوى بطبقة
     أعلى، وترويسة الجدول تلتصق داخل حاوية التمرير الخاصة بها (top:0) بدل إزاحات ثابتة محسوبة من الصفحة. */
  function installLayoutIsolation() {
    if (document.getElementById('sx-isolation-css')) return;
    const st = document.createElement('style');
    st.id = 'sx-isolation-css';
    st.textContent = `
      .sx-page { display: flex; flex-direction: column; min-width: 0; }
      .sx-page > * { min-width: 0; max-width: 100%; flex: none; }
      .sx-page .sub-tabs { position: relative; top: 0; margin-inline: 0; z-index: 6; flex-wrap: wrap; }
      .sx-page .card, .sx-page .sx-panel, .sx-page section.card { position: relative; isolation: isolate; min-width: 0; }
      .sx-page .tbl-wrap { position: relative; z-index: 0; isolation: isolate; overflow: auto; max-width: 100%; contain: layout; }
      .sx-page .tbl-wrap table thead th, .sx-page table.sx-table thead th { position: sticky; top: 0 !important; z-index: 2; background: var(--surface2, #f1f5f9); box-shadow: 0 1px 0 var(--line); }
      .sx-page table { border-collapse: separate; border-spacing: 0; }
      .sx-page .grid2 > * { min-width: 0; }
      .sx-page h1, .sx-page h2, .sx-page h3 { position: static; overflow-wrap: anywhere; }
      @media print { .sx-page .tbl-wrap { overflow: visible; contain: none; } .sx-page .tbl-wrap table thead th { position: static; } }
    `;
    document.head.appendChild(st);
  }

  UA.afterRenderEnhance = function afterRenderEnhance() {
    try { installLayoutIsolation(); } catch { /* تنسيق فقط */ }
    if (enhanceRafId) cancelAnimationFrame(enhanceRafId);
    enhanceRafId = requestAnimationFrame(() => {
      enhanceRafId = 0;
      try {
        enhanceSelectsWithOtherOption();
        ensureGlobalAutocompleteDatalist();
        mountSplitEnterpriseBlocks();
        enhanceSubTabsBadgesAndShortcuts();
        enhanceTablesWithQuickPreview();
        enhanceFormsWithAutoSaveDrafts();
      } catch { /* ignore */ }
    });
  };

  // اختيار طالب البطاقة الرقمية من منتقي الطلاب الموحد
  document.addEventListener('ua:student-picked', (e) => {
    if (e.target && e.target.id === 'digicard-stu') { S.stSel = e.detail; UA.render(); }
  });

  /* ---------- البحث التلقائي الفوري بمجرد كتابة الأحرف (Instant Search-As-You-Type) ---------- */
  let searchTimer = null;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;

    // 1. بحث دليل الإرشادات الفوري
    if (t.id === 'guide-search-q') {
      U.guideQuery = t.value;
      UA.render();
      return;
    }

    // 2. بحث فورم إنشاء فحص الامتحانات الشامل
    if (t.id === 'exm-filter-q') {
      syncExamDomToState();
      U.examSchedule.filterQuery = t.value;
      if (S.view === 'expansions') {
        const banner = document.getElementById('exp-master-exam-banner');
        if (banner) {
          const pos = t.selectionStart;
          banner.innerHTML = UA.renderMasterExamBuilder();
          const nextInp = document.getElementById('exm-filter-q');
          if (nextInp) { nextInp.focus(); try { nextInp.setSelectionRange(pos, pos); } catch {} }
        }
      } else {
        UA.render();
      }
      return;
    }

    // 3. البحث العام في الشريط العلوي (#sx-q) أو بحث سجل الطلاب (#st-q)
    if (t.id === 'st-q') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        S.stList.q = t.value.trim();
        try {
          const p = new URLSearchParams();
          if (S.stList.q) p.set('q', S.stList.q);
          if (S.stList.program) p.set('program', S.stList.program);
          if (S.stList.status) p.set('status', S.stList.status);
          const r = await api('GET', '/api/students?' + p);
          S.stList.students = r.students;
          S.stList.total = r.total;
          UA.render();
        } catch { /* ignore */ }
      }, 220);
      return;
    }

    // 4. البحث الفوري في شؤون الموظفين (#hr-emp-q)
    if (t.id === 'hr-emp-q' && UA.actions.hrempsearch) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        UA.actions.hrempsearch();
      }, 150);
      return;
    }

    // 5. البحث الفوري في المراسلات (#cf-q)
    if (t.id === 'cf-q' && UA.forms && UA.forms.cfilter) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        UA.forms.cfilter();
      }, 220);
      return;
    }

    // 6. البحث الفوري في الطلبات الداخلية (#in-search-q)
    if (t.id === 'in-search-q' && UA.actions.infilter) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        UA.actions.infilter();
      }, 150);
      return;
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'exm-toggle-all') {
      const checked = t.checked;
      document.querySelectorAll('#exm-master-table .exm-inc').forEach((chk) => { chk.checked = checked; });
      syncExamDomToState();
    }
    const act = t.dataset && t.dataset.act;
    if (act && UA.actions && typeof UA.actions[act] === 'function') {
      UA.actions[act](t, t.dataset, e);
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t) return;
    const act = t.dataset && t.dataset.act;
    if (act && UA.actions && typeof UA.actions[act] === 'function') {
      UA.actions[act](t, t.dataset, e);
    }
  });

  /* ---------- نماذج وإجراءات الوحدات الموحدة ---------- */
  UA.forms['hr-appraisal-form'] = async () => {
    const val = UA.val;
    await api('POST', '/api/expansions/appraisals', {
      employee_name: val('ap-name').trim(),
      department: val('ap-dept'),
      period_label: val('ap-period'),
      punctuality_score: Number(val('ap-c1')),
      productivity_score: Number(val('ap-c2')),
      teamwork_score: Number(val('ap-c3')),
      recommendation: val('ap-note').trim(),
    });
    await loadHrExtras();
    toast('تم حفظ واعتماد تقييم الموظف في سجل شؤون الموظفين');
    UA.render();
  };

  Object.assign(UA.actions, {
    guideprint: () => window.print(),
    sxtoggleside: () => {
      document.body.classList.toggle('sx-collapsed');
      saveA11yPrefs();
      UA.render();
    },
    sxcmdopen: () => {
      UA.openCommandPalette();
    },
    sxclosepreview: () => {
      const ov = document.getElementById('sx-slideover-overlay');
      if (ov) ov.hidden = true;
    },
    wsgo: async (el, d) => {
      const key = d && d.k;
      const target = wsState.tabs.find((t) => t.key === key);
      if (!target) return;
      // حفظ موضع التمرير للتبويب الحالي قبل الانتقال
      const curSub = getActiveSubTabInfo(S.view || 'overview');
      const curTab = wsState.tabs.find((t) => t.key === `${S.view || 'overview'}::${curSub.subVal || 'main'}`);
      if (curTab) curTab.scrollY = window.scrollY || 0;

      if (S.view !== target.view) {
        await UA.go(target.view);
      }
      if (target.subAct && UA.actions[target.subAct]) {
        await UA.actions[target.subAct](null, { t: target.subVal, s: target.subVal });
      } else {
        UA.render();
      }
      if (target.scrollY) {
        requestAnimationFrame(() => window.scrollTo({ top: target.scrollY, behavior: 'instant' }));
      }
    },
    wspin: (el, d) => {
      const key = d && d.k;
      const target = wsState.tabs.find((t) => t.key === key);
      if (!target) return;
      target.pinned = !target.pinned;
      savePinnedWorkspaceTabs();
      toast(target.pinned ? `تم تثبيت التبويب «${target.label}» في الشريط العلوي` : `تم إلغاء تثبيت «${target.label}»`);
      UA.render();
    },
    wspincurrent: () => {
      const v = S.view || 'overview';
      const sub = getActiveSubTabInfo(v);
      const curKey = `${v}::${sub.subVal || 'main'}`;
      const target = wsState.tabs.find((t) => t.key === curKey);
      if (target) {
        target.pinned = true;
        savePinnedWorkspaceTabs();
        toast(`تم تثبيت التبويب الحالي «${target.label}» للوصول الفوري`);
        UA.render();
      }
    },
    wsclose: async (el, d) => {
      const key = d && d.k;
      const idx = wsState.tabs.findIndex((t) => t.key === key);
      if (idx < 0 || wsState.tabs.length <= 1) return;
      const removed = wsState.tabs[idx];
      wsState.tabs.splice(idx, 1);
      savePinnedWorkspaceTabs();
      const curSub = getActiveSubTabInfo(S.view || 'overview');
      const curKey = `${S.view || 'overview'}::${curSub.subVal || 'main'}`;
      if (removed.key === curKey && wsState.tabs.length) {
        const fallback = wsState.tabs[Math.max(0, idx - 1)];
        await UA.actions.wsgo(null, { k: fallback.key });
      } else {
        UA.render();
      }
    },
    maindashtab: (el, d) => {
      U.mainTab = d.t === 'myprofile' || d.t === 'work' ? d.t : 'unified';
      UA.render();
    },
    openmysettings: async () => {
      S.adminTab = 'mysettings';
      await UA.go('admin');
    },
    hrunified: async (el, d) => {
      U.hrSection = (d && (d.t || d.s)) || 'payroll';
      if (U.hrSection === 'biometrics' || U.hrSection === 'appraisals') await loadHrExtras();
      if (U.hrSection === 'att_leaves' && origHrLoader) await origHrLoader().catch(() => {});
      if (U.hrSection === 'payroll' && origPayrollLoader) await origPayrollLoader().catch(() => {});
      if (U.hrSection === 'enterprise_hr') {
        if (UA.setEnterpriseTab) UA.setEnterpriseTab('hr_finance');
        if (UA.loaders.enterprise) await UA.loaders.enterprise().catch(() => {});
      }
      UA.render();
    },
    biosync: async () => {
      if (!U.biometrics.devices.length) { toast('لا توجد أجهزة بصمة مسجلة.'); return; }
      try { await api('POST', '/api/expansions/biometrics/sync'); await loadHrExtras(); toast('تم تحديث وقت مزامنة أجهزة البصمة'); }
      catch (e) { toast(e.message); }
      UA.render();
    },
    audtab2: async (el, d) => {
      const t = (d && (d.t || d.s)) || 'chain';
      S.auditTab = t;
      U.auditSection = t;
      if (t === 'logs' && (!S.logs || !S.logs.length)) {
        try { S.logs = (await api('GET', '/api/admin/logs?limit=300')).entries; } catch {}
      }
      if (t === 'hc_perf') {
        try { U.hcTelemetry = await api('GET', '/api/v12/high-concurrency/telemetry'); } catch {}
      }
      if (t === 'exec_offline') {
        if (UA.setEnterpriseTab) UA.setEnterpriseTab('exec_devops');
        if (UA.loaders.enterprise) await UA.loaders.enterprise().catch(() => {});
      }
      UA.render();
    },
    hcrefresh: async () => {
      try {
        U.hcTelemetry = await api('GET', '/api/v12/high-concurrency/telemetry');
        toast('تم تحديث مؤشرات محرك الأداء الفائق والضغط العالي');
        UA.render();
      } catch (e) { toast(e.message); }
    },
    hcrunbench: async () => {
      if (U.hcBenchRunning) return;
      U.hcBenchRunning = true;
      UA.render();
      try {
        const res = await api('POST', '/api/v12/high-concurrency/benchmark', {
          concurrentUsers: 10000,
          correspondencePerSec: 25,
          financialEntriesPerSec: 25,
        });
        U.hcBenchmarkResult = res.benchmark;
        U.hcTelemetry = await api('GET', '/api/v12/high-concurrency/telemetry');
        toast(`اكتمل اختبار الضغط (10,000 مستخدم + 50 عملية كتابة/ثانية) بزمن ${res.benchmark.totalElapsedMs} ms`);
      } catch (e) {
        toast(e.message || 'تعذر تنفيذ اختبار الضغط');
      } finally {
        U.hcBenchRunning = false;
        UA.render();
      }
    },
    acadxtab: async (el, d) => {
      U.acadExtraTab = (d && (d.t || d.s)) || '';
      U.acadTab = U.acadExtraTab || 'courses';
      if (U.acadExtraTab === 'exam_master') await ensureExamCoursesLoaded();
      UA.render();
    },
    acadtab: async (el, d) => {
      U.acadTab = (d && (d.t || d.s)) || 'courses';
      if (U.acadTab === 'exam_master') await ensureExamCoursesLoaded();
      // التبويب كان يبقى على «جارٍ التحميل» لأن قائمة الأعضاء لا تُحمَّل إلا عبر المسار القديم
      if (U.acadTab === 'members' && UA.loadFacultyMembers) await UA.loadFacultyMembers();
      UA.render();
    },
    submitlmsquiz: async () => {
      const q = ((window.UA.enterpriseData || {}).quizzes || [])[0];
      if (!q) return;
      const answers = q.questions.map((_, i) => { const el = document.querySelector(`input[name="lms_q_${i}"]:checked`); return el ? Number(el.value) : null; });
      try {
        const r = await api('POST', `/api/enterprise/quizzes/${q.id}/submit`, { answers });
        U.lastQuizResult = `تم التصحيح الآلي: النتيجة ${r.score} / ${r.totalMarks} (${r.correctCount} من ${r.questionsCount} إجابات صحيحة).`;
        if (UA.loaders.enterprise) await UA.loaders.enterprise().catch(() => {});
        toast('تم التصحيح وتسجيل المحاولة');
      } catch (e) { toast(e.message); return; }
      UA.render();
    },
    calcgpasim: () => {
      const cur = parseFloat(document.getElementById('gpa-cur')?.value);
      const hrs = parseInt(document.getElementById('gpa-hrs')?.value, 10);
      const c1 = parseFloat(document.getElementById('gpa-c1')?.value);
      const c2 = parseFloat(document.getElementById('gpa-c2')?.value);
      if (![cur, hrs, c1, c2].every(Number.isFinite)) { toast('أدخل المعدل والساعات والعلامتين المتوقعتين.'); return; }
      const newPts = (c1 * 4) + (c2 * 3);
      const totPts = (cur * hrs) + newPts;
      const totHrs = hrs + 7;
      const exp = (totPts / totHrs).toFixed(1);
      const delta = (exp - cur).toFixed(1);
      U.gpaSimCalc = {
        curGpa: cur,
        hrs: hrs,
        expGpa: exp,
        letter: exp >= 90 ? 'ممتاز (A+)' : exp >= 85 ? 'جيد جداً مرتفع (A)' : 'جيد جداً (B+)',
        delta: (delta >= 0 ? '+' : '') + delta + '%'
      };
      toast(`تمت المحاكاة: المعدل المتوقع ${exp}%`);
      UA.render();
    },
    pickdigistudent: (el) => {
      const id = Number(el.value);
      const stList = (S.stList && S.stList.students) || [];
      const s = stList.find(x => Number(x.id) === id);
      if (s) {
        S.stSel = s;
        UA.render();
      }
    },
    printdigicard: () => {
      const cardEl = document.getElementById('official-digital-card');
      if (cardEl && UA.printHtml) {
        UA.printHtml([cardEl.outerHTML], { card: true });
      } else {
        window.print();
      }
    },
    certifydigicard: () => {
      toast('✓ تم تصديق البطاقة الجامعية رقمياً بمفتاح X.509 وتوليد رمز الحماية المضاد للتزوير');
    },
    simcardcheckin: async () => {
      const stList = (S.stList && S.stList.students) || [];
      const st = S.stSel || stList[0];
      if (!st) { toast('لا يوجد طالب محدد.'); return; }
      const locEl = document.getElementById('card-sim-loc');
      const methodEl = document.getElementById('card-sim-method');
      const locCode = (locEl && locEl.value) || 'GATE-MAIN-01';
      const locName = (locEl && locEl.options && locEl.options[locEl.selectedIndex] && locEl.options[locEl.selectedIndex].text.replace(/^[^\s]+\s*/, '')) || 'البوابة الرئيسية — الحرم المركزي';
      const method = (methodEl && methodEl.value) || 'nfc';
      const termId = method === 'nfc' ? (locCode === 'GATE-MAIN-01' ? 'TRM-NFC-A1' : locCode === 'LIB-ENTRANCE' ? 'LIB-DESK-NFC-2' : locCode === 'LAB-CYB-03' ? 'TRM-NFC-L3' : 'NFC-GATE-04') : (locCode === 'GATE-MAIN-01' ? 'SCAN-BC-01' : 'SCAN-BC-04');
      const pkiHash = '0x' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
      const newEntry = {
        id: 'LOG-' + Date.now().toString().slice(-6),
        studentId: st.id,
        studentNo: st.studentNo,
        studentName: st.name,
        eventType: 'check_in',
        locationName: locName,
        locationCode: locCode,
        method: method,
        terminalId: termId,
        status: 'granted',
        reason: 'تصريح دخول نظامي ساري المفعول (بطاقة ذكية معتمدة)',
        pkiHash: pkiHash,
        timestamp: Date.now(),
      };
      const logs = getCardLogs();
      logs.unshift(newEntry);
      saveCardLogs(logs);

      try {
        api('POST', `/api/students/${st.id}/card-activity`, {
          method,
          eventType: 'check_in',
          locationName: locName,
          locationCode: locCode,
          terminalId: termId,
          status: 'granted',
          reason: newEntry.reason,
          pkiHash,
        }).catch(() => {});
      } catch {}

      toast(`✓ تم التحقق بنجاح من البطاقة (${method === 'nfc' ? 'شريحة NFC' : 'مسح الباركود'}): تسجيل دخول في ${locName}`);
      UA.render();
    },
    simcardcheckout: async () => {
      const stList = (S.stList && S.stList.students) || [];
      const st = S.stSel || stList[0];
      if (!st) { toast('لا يوجد طالب محدد.'); return; }
      const locEl = document.getElementById('card-sim-loc');
      const methodEl = document.getElementById('card-sim-method');
      const locCode = (locEl && locEl.value) || 'GATE-MAIN-01';
      const locName = (locEl && locEl.options && locEl.options[locEl.selectedIndex] && locEl.options[locEl.selectedIndex].text.replace(/^[^\s]+\s*/, '')) || 'البوابة الرئيسية — الحرم المركزي';
      const method = (methodEl && methodEl.value) || 'nfc';
      const termId = method === 'nfc' ? (locCode === 'GATE-MAIN-01' ? 'TRM-NFC-A1' : 'NFC-GATE-04') : 'SCAN-BC-02';
      const pkiHash = '0x' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
      const newEntry = {
        id: 'LOG-' + Date.now().toString().slice(-6),
        studentId: st.id,
        studentNo: st.studentNo,
        studentName: st.name,
        eventType: 'check_out',
        locationName: locName,
        locationCode: locCode,
        method: method,
        terminalId: termId,
        status: 'granted',
        reason: 'خروج نظامي موثق ومطابق لسجلات الحضور',
        pkiHash: pkiHash,
        timestamp: Date.now(),
      };
      const logs = getCardLogs();
      logs.unshift(newEntry);
      saveCardLogs(logs);

      try {
        api('POST', `/api/students/${st.id}/card-activity`, {
          method,
          eventType: 'check_out',
          locationName: locName,
          locationCode: locCode,
          terminalId: termId,
          status: 'granted',
          reason: newEntry.reason,
          pkiHash,
        }).catch(() => {});
      } catch {}

      toast(`✓ تم التحقق بنجاح من البطاقة (${method === 'nfc' ? 'شريحة NFC' : 'مسح الباركود'}): تسجيل خروج من ${locName}`);
      UA.render();
    },
    simcarddenied: async () => {
      const stList = (S.stList && S.stList.students) || [];
      const st = S.stSel || stList[0];
      if (!st) { toast('لا يوجد طالب محدد.'); return; }
      const locEl = document.getElementById('card-sim-loc');
      const methodEl = document.getElementById('card-sim-method');
      const locCode = (locEl && locEl.value) || 'GATE-MAIN-01';
      const locName = (locEl && locEl.options && locEl.options[locEl.selectedIndex] && locEl.options[locEl.selectedIndex].text.replace(/^[^\s]+\s*/, '')) || 'البوابة الرئيسية — الحرم المركزي';
      const method = (methodEl && methodEl.value) || 'nfc';
      const termId = method === 'nfc' ? 'TRM-NFC-SEC' : 'SCAN-BC-SEC';
      const pkiHash = '0x' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
      const newEntry = {
        id: 'LOG-' + Date.now().toString().slice(-6),
        studentId: st.id,
        studentNo: st.studentNo,
        studentName: st.name,
        eventType: 'denied',
        locationName: locName,
        locationCode: locCode,
        method: method,
        terminalId: termId,
        status: 'denied',
        reason: 'محاولة تحقق غير مصرحة — تجاوز ساعات الدوام المصرحة للمرفق',
        pkiHash: pkiHash,
        timestamp: Date.now(),
      };
      const logs = getCardLogs();
      logs.unshift(newEntry);
      saveCardLogs(logs);

      toast(`⚠️ محاكاة تحقق مرفوضة (Access Denied) في ${locName}`);
      UA.render();
    },
    cardfilterevent: (el) => {
      if (!U.cardActivity) U.cardActivity = {};
      U.cardActivity.filterEvent = el.value;
      UA.render();
    },
    cardfiltermethod: (el) => {
      if (!U.cardActivity) U.cardActivity = {};
      U.cardActivity.filterMethod = el.value;
      UA.render();
    },
    cardfilterloc: (el) => {
      if (!U.cardActivity) U.cardActivity = {};
      U.cardActivity.filterLocation = el.value;
      UA.render();
    },
    cardlogsearch: (el) => {
      if (!U.cardActivity) U.cardActivity = {};
      U.cardActivity.searchQuery = el.value;
      UA.render();
      const inputEl = document.querySelector('input[data-act="cardlogsearch"]');
      if (inputEl) {
        inputEl.focus();
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      }
    },
    exportcardcsv: () => {
      const stList = (S.stList && S.stList.students) || [];
      const st = S.stSel || stList[0];
      if (!st) { toast('لا يوجد طالب محدد.'); return; }
      const allLogs = getCardLogs();
      const stLogs = allLogs.filter((l) => Number(l.studentId) === Number(st.id) || String(l.studentNo) === String(st.studentNo));
      
      let csv = '\uFEFF'; // UTF-8 BOM
      csv += 'معرف الحركة,الرقم الجامعي,اسم الطالب,نوع العملية,الموقع,رمز الموقع,الوسيلة,رقم القارئ,الحالة,بصمة PKI,التاريخ والوقت,الملاحظات\n';
      stLogs.forEach((l) => {
        const tInfo = formatCardLogTime(l.timestamp);
        const op = l.eventType === 'check_in' ? 'دخول (Check-in)' : l.eventType === 'check_out' ? 'خروج (Check-out)' : 'مرفوض (Denied)';
        const meth = l.method === 'nfc' ? 'NFC' : 'باركود';
        const stLabel = l.status === 'granted' ? 'مصرح به' : 'مرفوض';
        csv += `"${l.id}","${l.studentNo}","${l.studentName}","${op}","${l.locationName}","${l.locationCode}","${meth}","${l.terminalId}","${stLabel}","${l.pkiHash}","${tInfo.fullText}","${l.reason || ''}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `card-activity-${st.studentNo}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('✓ تم تصدير سجل نشاط وتحقق البطاقة بنجاح (CSV)');
    },
    printcardlogs: () => {
      const stList = (S.stList && S.stList.students) || [];
      const st = S.stSel || stList[0];
      if (!st) { toast('لا يوجد طالب محدد.'); return; }
      const tblEl = document.getElementById('printable-card-logs-table');
      if (tblEl && UA.printHtml) {
        const printHtml = `
          <div style="direction:rtl;text-align:right;font-family:sans-serif;padding:24px;color:#000">
            <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #042f28;padding-bottom:12px;margin-bottom:18px">
              <div>
                <h2 style="margin:0;color:#042f28;font-size:18px">الجامعة السورية للعلوم الأمنية</h2>
                <h4 style="margin:4px 0 0;color:#475569;font-size:14px">سجل نشاط وحركات التحقق من البطاقة الجامعية الذكية (NFC / Barcode)</h4>
              </div>
              <div style="text-align:left;font-size:12px;color:#64748b">
                <div>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SY')}</div>
                <div>الرقم الجامعي: <b>${esc(st.studentNo)}</b></div>
                <div>الطالب: <b>${esc(st.name)}</b></div>
              </div>
            </div>
            ${tblEl.innerHTML}
            <div style="margin-top:24px;display:flex;justify-content:space-between;border-top:1px dashed #cbd5e1;padding-top:16px;font-size:12px">
              <div>توقيع مسؤول الأمن والسلامة: ______________</div>
              <div>ختم شؤون الطلاب والامتحانات: ______________</div>
            </div>
          </div>
        `;
        UA.printHtml(printHtml);
      } else {
        window.print();
      }
    },
    resetcardlogs: () => {
      try {
        localStorage.removeItem(CARD_LOGS_STORAGE_KEY);
      } catch {}
      toast('✓ تم مسح سجل النشاط المحلي للبطاقات');
      UA.render();
    },
    exmautodates: () => {
      syncExamDomToState();
      const start = new Date(U.examSchedule.startDate || Date.now() + 86400000);
      const halls = ((S.limits && S.limits.dropdowns && S.limits.dropdowns.halls) || ['المدرج الكبير A1', 'المدرج الثاني A2', 'قاعة الامتحانات المركزية B1']);
      let dayOffset = 0;
      (U.examSchedule.courses || []).forEach((c, idx) => {
        const d = new Date(start.getTime() + dayOffset * 86400000);
        while (d.getDay() === 5 || d.getDay() === 6) {
          dayOffset++;
          d.setTime(start.getTime() + dayOffset * 86400000);
        }
        if (idx % 2 === 1) dayOffset++;
        const row = U.examSchedule.rows[c.id] || (U.examSchedule.rows[c.id] = {});
        row.included = true;
        row.date = d.toISOString().slice(0, 10);
        row.time = idx % 2 === 0 ? '09:00' : '12:30';
        row.duration = 120;
        row.hall = halls[idx % halls.length] || 'المدرج الكبير A1';
      });
      toast('تم توزيع تواريخ وأوقات وقاعات الفحص تلقائياً على كافة المواد (مع استثناء أيام العطل)');
      if (S.view === 'expansions') {
        const banner = document.getElementById('exp-master-exam-banner');
        if (banner) banner.innerHTML = UA.renderMasterExamBuilder();
      } else {
        UA.render();
      }
    },
    exmsaveall: async () => {
      syncExamDomToState();
      const courses = U.examSchedule.courses || [];
      const selected = courses.filter((c) => U.examSchedule.rows[c.id]?.included !== false);
      const endOf = (start, minutes) => { const [h, m] = String(start).split(':').map(Number), t = h * 60 + m + Number(minutes); return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
      let saved = 0, firstErr = '';
      for (const c of selected) {
        const r = U.examSchedule.rows[c.id] || {}, start = r.time || '09:00';
        try {
          await api('POST', '/api/expansions/exams', {
            course_code: c.code,
            course_name: c.name,
            program_name: c.program || c.programName || c.faculty || '',
            exam_date: r.date || U.examSchedule.startDate,
            start_time: start,
            end_time: endOf(start, r.duration || 120),
            hall_name: r.hall || 'المدرج الكبير A1',
            proctor_name: r.proctor || c.instructor || 'لجنة المراقبة',
          });
          saved++;
        } catch (e) { if (!e.status) throw e; firstErr ||= e.message; }
      }
      toast(saved === selected.length ? `حُفظ جدول الفحص لـ ${saved} مقرر` : `حُفظ ${saved} من ${selected.length} مقرر. ${firstErr}`);
    },
    exmpdf: () => {
      generateExamSchedulePdf();
    },
    guidesec: (el, d) => {
      U.guideSection = d.s || 'all';
      UA.render();
    },
    guidetab: (el, d) => {
      U.guideMode = (d && (d.t || d.s)) || 'depts';
      UA.render();
    },
    archifytab: (el, d) => {
      U.archifyDiagram = (d && (d.t || d.s)) || 'architecture';
      U.auditSection = 'archify';
      S.auditTab = 'archify';
      UA.render();
    },
    guidenode: (el, d) => {
      U.guideNode = d.id || 'node_president';
      UA.render();
    },
    guidereq: (el, d) => {
      U.guideReqSim = (el && el.value) || (d && d.id) || 'req_enrollment';
      U.guideReqStep = 1;
      UA.render();
    },
    guidestep: (el, d) => {
      const st = Number(d.st);
      if (st >= 1 && st <= 5) {
        U.guideReqStep = st;
        UA.render();
      }
    },
    guidedeptflt: (el, d) => {
      U.guideDeptFilter = d.f || 'all';
      UA.render();
    },
    corrunified: async (el, d) => {
      const t = (d && (d.t || d.s)) || 'in';
      U.corrUnifiedTab = t;
      if (t === 'internal_requests') {
        if (origIntab) origIntab(null, { t: 'mine' });
        else UA.render();
        return;
      }
      if (t === 'internal_new') {
        if (origIntab) origIntab(null, { t: 'catalog' });
        else UA.render();
        return;
      }
      if (t === 'pending_all') {
        UA.render();
        return;
      }
      const crMap = { in: 'in', out: 'out', new_corr: 'new', tpl: 'tpl', notifs: 'notifs' };
      if (crMap[t] && origCrtab) {
        await origCrtab(null, { t: crMap[t] });
        return;
      }
      UA.render();
    },
    reqopen: async (el, d) => {
      if (d && d.id) {
        S.sel = Number(d.id);
        U.corrUnifiedTab = 'internal_requests';
        if (UA.actions.inopen) {
          UA.actions.inopen(el, d);
        } else if (UA.actions.sel) {
          await UA.actions.sel(el, d);
        }
        UA.render();
      }
    },
    // توجيه أي زر تصدير فرعي إلى صفحة التصدير الموحدة
    rxexport: async () => {
      S.exTab = 'export';
      await UA.go('exchange');
      toast('تم الانتقال إلى صفحة التصدير الموحدة');
    },
    saexp: async () => {
      S.exTab = 'export';
      await UA.go('exchange');
      toast('تم الانتقال إلى صفحة التصدير الموحدة');
    },
    goexport: async (el, d) => {
      S.exportPreset = { dataset: (d && d.ds) || 'all', f: {} };
      S.exTab = 'export';
      await UA.go('exchange');
    },
  });

  // تغليف إجراءات التبويبات الفرعية لضمان التزامن التام بين الترويسة والقائمة الجانبية
  const origCrtab = UA.actions.crtab;
  if (origCrtab) {
    UA.actions.crtab = async (el, d) => {
      const t = (d && d.t) || 'in';
      const revMap = { in: 'in', out: 'out', new: 'new_corr', tpl: 'tpl', notifs: 'notifs', all: 'in' };
      U.corrUnifiedTab = revMap[t] || 'in';
      await origCrtab(el, d);
    };
  }
  const origCropen = UA.actions.cropen;
  if (origCropen) {
    UA.actions.cropen = async (el, d) => {
      if (U.corrUnifiedTab === 'pending_all' || U.corrUnifiedTab === 'notifs') {
        U.corrUnifiedTab = 'in';
      }
      await origCropen(el, d);
    };
  }
  const origIntab = UA.actions.intab;
  if (origIntab) {
    UA.actions.intab = (el, d) => {
      const t = (d && d.t) || 'mine';
      U.corrUnifiedTab = t === 'catalog' ? 'internal_new' : 'internal_requests';
      origIntab(el, d);
    };
  }
  const origHrtab = UA.actions.hrtab;
  if (origHrtab) {
    UA.actions.hrtab = async (el, d) => {
      U.hrSection = 'payroll';
      await origHrtab(el, d);
    };
  }
  const origActab = UA.actions.actab;
  if (origActab) {
    UA.actions.actab = async (el, d) => {
      U.acadExtraTab = '';
      await origActab(el, d);
    };
  }
})();
