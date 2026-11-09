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

  const U = UA.uxState;
  const { ensureExamCoursesLoaded, syncExamDomToState, generateExamSchedulePdf } = UA.examBuilder;
  const { getCardLogs, loadCardLogs, formatCardLogTime } = UA.cardLogs;
  async function recordCardEvent(eventType, status, reason) {
    const stList = (S.stList && S.stList.students) || [];
    const st = S.stSel || stList[0];
    if (!st) { toast('لا يوجد طالب محدد.'); return null; }
    const locEl = document.getElementById('card-sim-loc');
    const methodEl = document.getElementById('card-sim-method');
    const locationCode = locEl.value;
    const locationName = locEl.options[locEl.selectedIndex].text.replace(/^[^\s]+\s*/, '');
    await api('POST', `/api/students/${st.id}/card-activity`, { method: methodEl.value, eventType, locationName, locationCode, status, reason });
    await loadCardLogs(st.id);
    return locationName;
  }

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

        <div style="border:2px solid #054239;border-radius:14px;overflow:hidden;background:#10211D;box-shadow:0 10px 30px rgba(5,66,57,0.14)">
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
            <div style="font-size:13px;color:#A8D8BE">الرقم الجامعي: <b class="mono" style="color:#C9A24B;letter-spacing:1px">${esc(st.studentNo)}</b></div>
            <div style="font-size:12.5px;color:#A8D8BE;margin-top:2px">${esc((st.program && st.program.name) || (typeof st.program === 'string' ? st.program : ''))}${st.levelLabel ? ` · ${esc(st.levelLabel)}` : ''}</div>
            <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
              ${st.statusLabel ? `<span style="background:rgba(27,127,75,.25);color:#a7f3d0;padding:3px 8px;border-radius:6px;font-size:11px">${esc(st.statusLabel)}</span>` : ''}
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
        <h2 style="margin-top:18px">التحقق بخطوتين</h2>
        <p class="small">${m.mfaEnabled ? 'مفعّل على هذا الحساب.' : 'غير مفعّل. يضيف رمزًا من هاتفك عند كل دخول.'}</p>
        <div class="actions">${m.mfaEnabled ? '<button class="btn" type="button" data-act="mfaoff">تعطيل</button>' : '<button class="btn pri" type="button" data-act="mfastart">تفعيل</button>'}</div>
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

  UA.renderArchifyDiagramsBlock = renderArchifyDiagramsBlock;

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
          <p class="hint" style="margin:4px 0 0">سجل الأجهزة. الربط الفعلي والمزامنة يُفعَّلان بعد تحديد نوع الجهاز المستخدم.</p>
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
      <td>${UA.rowPrintBtn('تقييم أداء موظف', 'شؤون الموظفين', 'الموظف|المقيّم|مدير شؤون الموظفين')}</td>
    </tr>`).join('');

    return `<section class="card">
      <h2>تقييم الموظفين ومؤشرات الأداء الوظيفي (KPIs — شؤون الموظفين)</h2>
      <p class="hint" style="margin-top:0">تم نقل ودمج قسم تقييم الموظفين ضمن شؤون الموظفين لربطه مباشرةً بالحوافز والترقيات وسجل الالتزام والدوام.</p>
      <form id="hr-appraisal-form" class="inline-form" style="padding:14px;background:#F6F8F5;border:1px solid #DCE3DD;border-radius:12px">
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
      <div class="tbl-wrap"><table><thead><tr><th>الموظف</th><th>القسم</th><th>الدورة</th><th>الالتزام</th><th>الجودة</th><th>التعاون</th><th>المعدل العام</th><th>التوصية</th><th>المقيّم</th><th>طباعة</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="hint">لا توجد تقييمات مسجلة.</td></tr>'}</tbody></table></div>
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
      ['att_leaves', 'الحضور والإجازات'],
      ['biometrics', 'البصمة وأجهزة الحضور الحيوي'],
      ['appraisals', 'تقييم الموظفين والأداء الوظيفي (KPIs)'],
      ['enterprise_hr', 'التطوير المؤسسي للموارد البشرية والعبء التدريسي'],
    ] : [['att_leaves', 'الحضور والإجازات']];
    const topBar = `<div class="sub-tabs no-print" role="tablist" style="margin-bottom:14px">
      ${sections.map((s) => `<button class="chip" role="tab" data-act="hrunified" data-t="${s[0]}" aria-pressed="${U.hrSection === s[0]}">${esc(s[1])}</button>`).join('')}
    </div>`;

    if (U.hrSection === 'att_leaves') {
      return topBar + `<section class="card" style="margin-bottom:14px;background:#F6F8F5;border-color:#A8D8BE">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div><b>وحدة الحضور والإجازات (شؤون الموظفين)</b><div class="small">تم دمج واجهات الحضور والانصراف وطلبات الإجازات وأرصدتها ضمن تبويب واحد متكامل تحت شؤون الموظفين.</div></div>
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
            wrap.innerHTML = `<input type="text" class="ua-other-custom-inp" placeholder="اكتب البيان المخصص لخيار (أخرى) هنا..." style="flex:1;border:1.5px solid #054239;background:#F6F8F5;padding:6px 10px;border-radius:8px;font-size:12.5px">`;
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
    if (view === 'academics') return { subAct: 'actab', subVal: S.acTab || 'courses', subLabel: 'المقررات والعلامات' };
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
    const cell = pick || tds.find((td) => td.textContent.trim());   // صف أرقام وتواريخ كسجل التدقيق
    return cell && !cell.querySelector('a, button, input, select, textarea') ? cell : null;
  }
  // الوسم لكل صف لا لكل جدول: الشاشات غير المتزامنة تعيد رسم الصفوف، والصف الذي فيه حقول إدخال جزء من نموذج
  let previewTimer = 0;
  new MutationObserver(() => { clearTimeout(previewTimer); previewTimer = setTimeout(enhanceTablesWithQuickPreview, 120); }).observe(document.documentElement, { childList: true, subtree: true });
  function enhanceTablesWithQuickPreview() {
    document.querySelectorAll('.sx-page table').forEach((tbl) => {
      if (tbl.id === 'exm-master-table' || tbl.closest('.modal, dialog, form, #printroot')) return;
      const ths = [...tbl.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (ths.length < 3) return;
      tbl.querySelectorAll('tbody tr').forEach((tr) => {
        if (tr.dataset.sxPreview) return;
        tr.dataset.sxPreview = '1';
        const tds = [...tr.querySelectorAll('td')];
        if (tds.length < 3 || tr.dataset.act || tr.querySelector('.sx-primary-cell, input, select, textarea')) return;
        const primary = primaryCell(tds);
        if (!primary) return;
        tr.classList.add('sx-row-click');
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
        // النقر في أي مكان من الصف عدا أزراره وروابطه، وتحديد النص لا يفتح التفاصيل
        tr.addEventListener('click', (ev) => {
          if (ev.target.closest('a, button, input, select, textarea, label, [data-act]') || String(window.getSelection?.() || '')) return;
          openPreview(ev);
        });
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
      { cat: 'شؤون الطلاب', title: '⚖️ شؤون الطلاب · اللجنة التأديبية والمخالفات', view: 'affairs', act: 'sttab', val: 'lifecycle' },
      { cat: 'شؤون الطلاب', title: '🎁 شؤون الطلاب · المنح والإعفاءات', view: 'affairs', act: 'sttab', val: 'scholarships' },
      { cat: 'شؤون الطلاب', title: '🎟️ شؤون الطلاب · مكتب خدمة الطالب والدور', view: 'affairs', act: 'sttab', val: 'desk_queue' },
      { cat: 'التقارير', title: '📈 الإحصاءات والتقارير', view: 'dashboard' },
      { cat: 'الشؤون الأكاديمية', title: '👨‍🏫 الشؤون الأكاديمية · أعضاء هيئة التدريس', view: 'academics', act: 'acadtab', val: 'members' },
      { cat: 'الشؤون الأكاديمية', title: '🚪 سجل القاعات', view: 'attendance' },
      { cat: 'الشؤون الأكاديمية', title: '📅 الامتحانات والتقييم', view: 'expansions' },
      { cat: 'الشؤون الطلابية', title: '🏠 السكن الجامعي', view: 'student_life' },
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
      { cat: 'الشؤون الأكاديمية', title: '🗓️ الامتحانات · جدولة جماعية وملف PDF', view: 'expansions' },
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
      .sx-page .tbl-wrap table thead th, .sx-page table.sx-table thead th { position: sticky; top: 0 !important; z-index: 2; background: var(--surface2, #F6F8F5); box-shadow: 0 1px 0 var(--line); }
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
    if (t.id === 'exm-type' || t.id === 'exm-year' || t.id === 'exm-sem') {
      syncExamDomToState();
      UA.examBuilder.applySavedExams();
      UA.examBuilder.refreshExamBuilder();
    }
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
      try { const r = await api('POST', '/api/expansions/biometrics/sync'); await loadHrExtras(); toast(r.message); }
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
        toast('حُدّثت مؤشرات الأداء');
        UA.render();
      } catch (e) { toast(e.message); }
    },
    hcrunbench: async () => {
      if (U.hcBenchRunning) return;
      U.hcBenchRunning = true;
      UA.render();
      try {
        const res = await api('POST', '/api/v12/high-concurrency/benchmark', {});
        U.hcBenchmarkResult = res.benchmark;
        U.hcTelemetry = await api('GET', '/api/v12/high-concurrency/telemetry');
        const errors = res.benchmark.stages.reduce((a, s) => a + s.errors, 0);
        toast(errors ? `اكتمل الاختبار وفيه ${errors} طلباً فاشلاً` : 'اكتمل الاختبار الحي بنجاح');
      } catch (e) {
        toast(e.message || 'تعذر تنفيذ الاختبار');
      } finally {
        U.hcBenchRunning = false;
        UA.render();
      }
    },
    acadtab: async (el, d) => {
      U.acadTab = (d && (d.t || d.s)) || 'courses';
      // هذان التبويبان يرسمهما staff.js حسب حالته هو، فلا يكفي تغيير U.acadTab وإلا ظهر التبويب السابق
      if ((U.acadTab === 'courses' || U.acadTab === 'grades') && UA.actions.actab) { await UA.actions.actab(el, { t: U.acadTab }); return; }
      // التبويب كان يبقى على «جارٍ التحميل» لأن قائمة الأعضاء لا تُحمَّل إلا عبر المسار القديم
      if (U.acadTab === 'members' && UA.loadFacultyMembers) await UA.loadFacultyMembers();
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
    simcardcheckin: async () => {
      const where = await recordCardEvent('check_in', 'granted', 'تسجيل يدوي');
      if (where) toast(`سُجل دخول في ${where}`);
    },
    simcardcheckout: async () => {
      const where = await recordCardEvent('check_out', 'granted', 'تسجيل يدوي');
      if (where) toast(`سُجل خروج من ${where}`);
    },
    simcarddenied: async () => {
      const where = await recordCardEvent('denied', 'denied', 'تسجيل يدوي لمحاولة مرفوضة');
      if (where) toast(`سُجلت محاولة مرفوضة في ${where}`);
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
                <h4 style="margin:4px 0 0;color:#566660;font-size:14px">سجل نشاط وحركات التحقق من البطاقة الجامعية الذكية (NFC / Barcode)</h4>
              </div>
              <div style="text-align:left;font-size:12px;color:#566660">
                <div>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SY')}</div>
                <div>الرقم الجامعي: <b>${esc(st.studentNo)}</b></div>
                <div>الطالب: <b>${esc(st.name)}</b></div>
              </div>
            </div>
            ${tblEl.innerHTML}
            <div style="margin-top:24px;display:flex;justify-content:space-between;border-top:1px dashed #DCE3DD;padding-top:16px;font-size:12px">
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
    exmautodates: () => {
      syncExamDomToState();
      const start = new Date(U.examSchedule.startDate || Date.now() + 86400000);
      const halls = ((S.limits && S.limits.dropdowns && S.limits.dropdowns.halls) || []);
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
        row.hall = halls[idx % halls.length] || '';
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
      if (!selected.length) { toast('حدّد مقرراً واحداً على الأقل.'); return; }
      const E = U.examSchedule;
      const items = selected.map((c) => {
        const r = E.rows[c.id] || {}, start = r.time || '09:00';
        return { course_code: c.code, course_name: c.name, program_name: c.program || c.programName || c.faculty || '', exam_date: r.date || E.startDate, start_time: start, end_time: endOf(start, r.duration || 120), hall_name: r.hall || '', capacity: Number(r.capacity) || 0, proctor_name: r.proctor || c.instructor || 'لجنة المراقبة', group_id: r.groupId || null };
      });
      try {
        const out = await api('POST', '/api/expansions/exams/bulk', { exam_type: E.examType, academic_year: E.academicYear, semester: E.semester, items });
        await UA.examBuilder.loadSavedExams();
        UA.render();
        toast(`حُفظ الجدول: ${out.created} جديد و${out.updated} محدّث.${out.warnings.length ? ' تنبيه: ' + out.warnings[0] + (out.warnings.length > 1 ? ` و${out.warnings.length - 1} تنبيهات أخرى.` : '') : ''}`);
      } catch (e) { if (!e.status) throw e; toast(e.message); }
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
      if (d && d.t) U.acadTab = d.t;
      await origActab(el, d);
    };
  }
})();
