/* بوابة التبويبات: أي تبويب (رئيسي أو فرعي) لا يملك الحساب صلاحية عرضه يُخفى بالكامل بدل أن يظهر ثم يفشل بـ403.
   - التبويبات الرئيسية: تتبع allowedViews القادمة من الخادم (انظر viewsFor في app.js).
   - التبويبات الفرعية: السجل TABS أدناه (فعل التبويب، معرّفه، تسميته، صلاحيات «أي منها يكفي»)، ومنه يُبنى تبويب «أعمالي» وشاشة تخصيص الحساب.
   ويخفي المدير ما يشاء لكل حساب (hiddenTabs). لإضافة تبويب أضف سطراً في TABS فقط. المدير يرى كل شيء. الحماية الفعلية تبقى في الخادم؛ هذه طبقة عرض. */
(function () {
  'use strict';
  const FIN_READ = ['finance:read'];
  const HR_ANY = ['hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr:manage', 'hr_payroll:approve', 'staffatt:manage'];
  const HR_FULL = ['hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr_emp:delete', 'hr:manage', 'hr_payroll:approve', 'staffatt:manage'];
  const IMPORT_ANY = ['student:register', 'course:manage', 'grade:manage', 'request:import', 'import:academic', 'import:procurement', 'import:finance', 'import:hr', 'import:student_fin', 'import:misc'];
  const LMS_READ = ['course:manage', 'lms_lib:write', 'lms_lib:edit', 'lms_lib:approve', 'lms_lib:view', 'academic:read'];
  const EXAMS_READ = ['exams_housing:write', 'exams_housing:edit', 'exams_housing:approve', 'exams_housing:view', 'academic:read'];
  const HOUSING = ['sa_housing:view', 'sa_housing:manage'];
  const RESEARCH = ['research_grad:view', 'research_grad:write', 'research_grad:edit', 'research_grad:approve', 'faculty:manage'];
  const ALUMNI = ['alumni_career:view', 'alumni_career:write', 'alumni_career:edit'];
  const QA = ['qa_inst:view', 'qa_inst:edit', 'qa_inst:approve'];
  const AI_READ = ['enterprise_ai:use', 'academic:read', 'sa_advising:view', 'sa_advising:edit'];
  // شاشات v12 مفتوحة للطالب ببياناته هو، عدا ما يخص الموظفين
  const STUDENT_HIDDEN = new Set(['v12:ai:triage', 'v12:expansions:faculty']);
  const TABS = {
    overview: [['maindashtab', 'unified', 'اللوحة الرئيسية'], ['maindashtab', 'work', 'أعمالي'], ['maindashtab', 'myprofile', 'ملفي']],
    affairs: [['sttab', 'renewal', 'تجديد القيد السنوي', ['student:read']], ['sttab', 'promotion', 'الترفيع السنوي', ['student:update']], ['sttab', 'appeals', 'التظلمات الانضباطية', ['sa_discipline:view', 'sa_lifecycle:final']], ['sttab', 'exhaustion', 'استنفاد سنوات الدراسة', ['student:read', 'sa_advising:view']], ['sttab', 'admissions', 'القبول والمفاضلة', ['sa_admissions:view', 'sa_admissions:write', 'sa_admissions:approve', 'student:register']], ['sttab', 'requests', 'الطلبات', ['request:read_all', 'request:read_unit']], ['sttab', 'list', 'سجل الطلاب', ['student:read']], ['sttab', 'new', 'تسجيل طالب جديد', ['student:register']], ['sttab', 'groups', 'فئات الطلاب', ['student:update', 'course:manage', 'attendance:manage', 'grade:manage', 'grade:approve', 'exams_housing:view', 'exams_housing:write', 'exams_housing:edit', 'exams_housing:approve', 'audit:read']], ['sttab', 'digital_card', 'البطاقة الجامعية', ['student:register', 'student:update']],
      ['sttab', 'advising', 'الخطة والإرشاد', ['sa_advising:view', 'sa_advising:edit', 'faculty:manage']], ['sttab', 'lifecycle', 'حركات القيد والانضباط', ['sa_lifecycle:view', 'sa_lifecycle:dean', 'sa_lifecycle:final', 'student:update', 'finance:fees', 'lms_lib:approve']],
      ['sttab', 'scholarships', 'المنح والإعفاءات', ['sa_scholarships:view', 'sa_scholarships:write', 'sa_scholarships:approve', 'finance:fees']], ['sttab', 'desk_queue', 'مكتب خدمة الطالب', ['sa_desk:view', 'sa_scholarships:write', 'student:update', 'request:read_all']]],
    corr: [['corrunified', 'in', 'الوارد'], ['corrunified', 'out', 'الصادر'], ['corrunified', 'pending_all', 'بانتظار توقيعي'], ['corrunified', 'internal_requests', 'الطلبات الداخلية'], ['corrunified', 'internal_new', 'طلب داخلي جديد', ['request:create_internal']], ['corrunified', 'new_corr', 'كتاب رسمي جديد', ['corr:use']], ['corrunified', 'tpl', 'قوالب المراسلات', ['corr:templates']], ['corrunified', 'notifs', 'تنبيهات الاعتماد']],
    academics: [['acadtab', 'my_grades', 'علامات موادي', ['grade:approve_own']], ['acadtab', 'courses', 'دليل المواد'], ['acadtab', 'grades', 'جدول العلامات', ['grade:manage', 'grade:approve', 'academic:read']], ['acadtab', 'gpa_sim', 'محاكي المعدل'], ['acadtab', 'members', 'أعضاء هيئة التدريس', ['faculty:manage']], ['acadtab', 'sections', 'الشعب والتسجيل', ['course:manage']]],
    expansions: [['v12:expansions', 'exams', 'جداول الامتحانات والتظلمات', EXAMS_READ.concat('grade:manage', 'grade:approve', 'course:manage')], ['v12:expansions', 'faculty', 'الترقيات العلمية', ['faculty:manage', ...HR_ANY]]],
    student_life: [['hstab', 'rooms', 'المباني والغرف', HOUSING], ['hstab', 'residents', 'الطلاب في السكن', HOUSING], ['hstab', 'supplies', 'المواد والاحتياجات', HOUSING]],
    labtools: [['labtab', 'office', 'حجوزات الساعات المكتبية والإرشاد', HOUSING.concat('faculty:manage')], ['labtab', 'library', 'المكتبة الرقمية والإعارة', LMS_READ], ['labtab', 'activities', 'الأندية والأنشطة الطلابية', HOUSING]],
    lms: [['v12:lms', 'lectures', 'المحاضرات والمحتوى الرقمي', LMS_READ], ['v12:lms', 'quizzes', 'بنك الأسئلة والاختبارات', LMS_READ.concat('sa_quiz:write', 'sa_quiz:approve')], ['v12:lms', 'assignments', 'الاختبارات والتكليفات', ['lms_lib:write', 'lms_lib:approve']]],
    research: [['v12:research', 'projects', 'المشاريع والأبحاث', RESEARCH], ['v12:research', 'theses', 'رسائل الدراسات العليا', RESEARCH]],
    alumni: [['v12:alumni', 'alumni', 'سجل الخريجين', ALUMNI], ['v12:alumni', 'jobs', 'معرض الوظائف والتدريب', ALUMNI]],
    qa: [['v12:qa', 'kpis', 'مؤشرات الأداء', QA], ['v12:qa', 'surveys', 'تقييم المقررات والتدريس', QA], ['v12:qa', 'acc', 'ملفات الاعتماد', QA]],
    ai: [['v12:ai', 'early', 'الإنذار الأكاديمي المبكر', AI_READ], ['v12:ai', 'advisor', 'المرشد الأكاديمي الذكي', AI_READ], ['v12:ai', 'triage', 'التصنيف الآلي للمراسلات', ['enterprise_ai:use', 'corr:use', 'complaint:manage']]],
    payroll: [['hrunified', 'payroll', 'الملفات والعقود والرواتب', HR_FULL], ['hrunified', 'att_leaves', 'الحضور والإجازات'], ['hrunified', 'biometrics', 'البصمة', HR_FULL], ['hrunified', 'appraisals', 'تقييم الأداء', HR_FULL], ['hrunified', 'enterprise_hr', 'العبء التدريسي', HR_FULL]],
    finance: [['fin-tab', 'overview', 'المركز المالي'], ['fin-tab', 'coa', 'شجرة الحسابات'], ['fin-tab', 'journal', 'قيود اليومية'], ['fin-tab', 'treasury', 'الخزينة والسندات'], ['fin-tab', 'reports', 'القوائم الختامية'], ['fin-tab', 'student_fees', 'الرسوم والأقساط'], ['fin-tab', 'payroll_fin', 'تكامل الرواتب']],
    procurement: [['proc-tab', 'overview', 'لوحة الإمداد'], ['proc-tab', 'stock', 'المستودعات والأصناف'], ['proc-tab', 'cycle', 'دورة الشراء'], ['proc-tab', 'movements', 'الحركة المخزنية'], ['proc-tab', 'assets', 'الأصول والعهد'], ['proc-tab', 'suppliers', 'الموردون']],
    dashboard: [['dtab', 'stats', 'الإحصاءات الأكاديمية', ['stats:read']], ['dtab', 'departments', 'الأقسام والموارد', HR_FULL], ['dtab', 'devops', 'أخطاء DevOps', ['audit:read', 'devops:manage', 'settings:manage', 'backup:manage']]],
    exchange: [['extab', 'import', 'الاستيراد', IMPORT_ANY], ['extab', 'export', 'التصدير', ['data:export']]],
    admin: [['atab', 'general', 'الإعدادات والقوائم', ['settings:manage']], ['atab', 'mysettings', 'إعداداتي'], ['atab', 'rules', 'قواعد الفحص الآلي', ['rules:manage']], ['atab', 'programs', 'الكليات والبرامج', ['program:manage']], ['atab', 'units', 'وحدات النظام'], ['atab', 'verify', 'التحقق من الوثائق'], ['atab', 'backup', 'النسخ الاحتياطي', ['backup:manage']]],
    audit: [['audtab2', 'chain', 'سجل التدقيق'], ['audtab2', 'hc_perf', 'الأداء والضغط العالي'], ['audtab2', 'logs', 'سجل أحداث النظام'], ['audtab2', 'devops', 'البنية التحتية'], ['audtab2', 'exec_offline', 'المراقبة المؤسسية'], ['audtab2', 'archify', 'خرائط المعمارية']],
    guidelines: [['guidetab', 'depts', 'الأقسام والطلبات'], ['guidetab', 'hierarchy', 'الهيكل التنظيمي'], ['guidetab', 'lifecycle', 'دورة حياة الطلبات']],
  };
  const REG = {
    'fin-tab': {
      overview: FIN_READ, reports: FIN_READ,
      coa: ['finance:read', 'finance:setup'],
      journal: ['finance:read', 'finance:entry', 'finance:post'],
      treasury: ['finance:read', 'finance:entry'],
      student_fees: ['finance:fees', 'finance:read'],
      payroll_fin: ['finance:read', 'finance:post'],
    },
    'proc-tab': {
      overview: ['procurement:read'],
      stock: ['procurement:read', 'procurement:manage', 'procurement:stock'],
      cycle: ['procurement:read', 'procurement:manage', 'procurement:request'],
      movements: ['procurement:read', 'procurement:stock'],
      assets: ['procurement:read', 'procurement:assets'],
      suppliers: ['procurement:read', 'procurement:manage'],
    },
    hrtab: {   // hub متاح دائماً لمن يملك الشاشة
      emp: HR_ANY, abs: HR_ANY, sal: HR_ANY, adv: HR_ANY, contract: HR_ANY, analytics: HR_ANY.concat('stats:read'),
      leave: HR_ANY.concat('staffatt:self'), att: HR_ANY.concat('staffatt:self'),
      config: ['hr:manage', 'staffatt:manage'],
    },
  };
  // ما لم يُسجَّل أعلاه يأخذ صلاحياته من TABS
  for (const tabs of Object.values(TABS)) for (const [act, tab, , need] of tabs) if (need && !(REG[act] && REG[act][tab])) (REG[act] ??= {})[tab] = need;
  const ACTS = [...new Set([...Object.keys(REG), ...Object.values(TABS).flat().map((x) => x[0])])].filter((a) => !a.startsWith('v12:'));

  const permsOf = (me) => new Set((me && me.permissions) || []);
  function allowed(act, tab, me) {
    if (!me) return true;                       // غير مسجَّل: لا شيء نخفيه (شاشة الدخول)
    if (me.role === 'admin') return true;
    if ((me.hiddenTabs || []).includes(`${act}:${tab}`)) return false;
    // الطالب يرى في شاشات v12 بياناته هو، وتحددها الخوادم لا صلاحيات الموظفين
    if (me.role === 'student' && act.startsWith('v12:')) return !STUDENT_HIDDEN.has(`${act}:${tab}`);
    const need = REG[act] && REG[act][tab];
    if (!need) return true;                     // تبويب غير مسجَّل في السجل ← يبقى ظاهراً
    const p = permsOf(me);
    return need.some((k) => p.has(k));
  }

  // شاشات v12 ترسم تبويباتها بعد جلب بياناتها، فتُخفى بقاعدة CSS لا بالمرور عليها
  function applyV12(view, me) {
    let style = document.getElementById('v12-tab-gate');
    if (!style) { style = document.createElement('style'); style.id = 'v12-tab-gate'; document.head.appendChild(style); }
    const hide = (TABS[view] || []).filter(([a, t]) => a.startsWith('v12:') && !allowed(a, t, me)).map(([, t]) => `.v12-tab[data-t="${t}"]`);
    const css = hide.length ? `${hide.join(',')}{display:none!important}` : '';
    if (style.textContent !== css) style.textContent = css;
  }
  // أول تبويب مسموح عند فتح شاشة v12، حتى لا تفتح على تبويب مخفي
  function firstTab(view, fallback) {
    const me = window.UA && window.UA.S && window.UA.S.me, tabs = TABS[view] || [];
    const first = tabs.find(([a, t]) => allowed(a, t, me));
    return first ? first[1] : fallback;
  }

  let guard = 0;
  function apply(root) {
    const UA = window.UA, me = UA && UA.S && UA.S.me;
    if (!me) return;
    root = root || document;
    applyV12(UA.S.view, me);
    const hiddenPressed = new Set();
    for (const act of ACTS) {
      root.querySelectorAll(`[data-act="${act}"][data-t]`).forEach((btn) => {
        const ok = allowed(act, btn.dataset.t, me);
        if (ok) { if (btn.dataset.gated) { btn.hidden = false; btn.style.removeProperty('display'); delete btn.dataset.gated; } return; }
        btn.hidden = true; btn.style.display = 'none'; btn.dataset.gated = '1';
        if (btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('on')) hiddenPressed.add(act);
      });
    }
    // إن كان التبويب الحالي محجوباً ننتقل لأول تبويب مسموح (مرة واحدة لكل رسم لتفادي الحلقات)
    if (hiddenPressed.size && Date.now() - guard > 800) {
      for (const act of hiddenPressed) {
        const first = [...root.querySelectorAll(`[data-act="${act}"][data-t]`)].find((b) => !b.hidden && b.closest('.sub-tabs'));
        if (first) { guard = Date.now(); first.click(); break; }
      }
    }
  }

  window.UA = window.UA || {};
  window.UA.gate = { REG, TABS, allowed, apply, firstTab };

  // إجراءات يرفضها الخادم لمن لا يملك صلاحيتها: تُخفى بدل أن يضغطها فيتلقى خطأ
  const HOLDS = ['holds:manage'], NEWS = ['news:manage'], ADMIT = ['sa_admissions:approve'];
  const DESK = ['sa_scholarships:write', 'sa_scholarships:approve', 'request:decide', 'student:update'];
  const ACT_PERMS = {
    addhold: HOLDS, clearhold: HOLDS, edithold: HOLDS, delhold: HOLDS, 'sa-clear-hold': HOLDS,
    'sa-q-status': DESK, uxdesknext: DESK, xhrcsv: ['staffatt:manage'],
    newsedit: NEWS, newsdel: NEWS, nmdel: NEWS, nmlink: NEWS, nmup: NEWS,
    'sa-run-sort': ADMIT, 'sa-enroll-app': ADMIT, 'sa-save-plan': ADMIT, 'sa-revoke-sch': ['finance:fees', 'sa_scholarships:approve'], 'sa-add-eq': ['course:manage', 'sa_admissions:approve'], 'sa-resolve-adv': ['sa_advising:edit'], 'sa-eq-decide': ['course:manage', 'sa_admissions:approve'],
  };
  function gateActions() {
    const can = window.UA.can;
    for (const [act, perms] of Object.entries(ACT_PERMS)) {
      if (perms.some((p) => can(p))) continue;
      document.querySelectorAll(`#app [data-act="${act}"]`).forEach((el) => el.classList.add('ua-noperm'));
    }
    if (!can('news:manage')) document.getElementById('newsadd')?.closest('section')?.classList.add('ua-noperm');
    if (!HOLDS.some((p) => can(p))) document.getElementById('h-no')?.closest('.inline-form')?.classList.add('ua-noperm');
  }

  let queued = false;
  const watch = () => {
    if (typeof MutationObserver !== 'function' || typeof document.getElementById !== 'function') return;
    const app = document.getElementById('app');
    if (!app || app.__gateWatch) return;
    app.__gateWatch = true;
    new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { if (window.UA.S?.me) gateActions(); } catch { /* لا يكسر العرض */ } }); }).observe(app, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  // التركيب على خطاف ما بعد الرسم (يُستدعى بعد كل render)
  const hook = () => {
    const prev = window.UA.afterRenderEnhance;
    if (prev && prev.__gated) return;
    const wrapped = function () { if (prev) prev.apply(this, arguments); try { apply(); gateActions(); } catch { /* العرض لا ينكسر بسبب البوابة */ } };
    wrapped.__gated = true;
    window.UA.afterRenderEnhance = wrapped;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
  window.addEventListener('load', hook);
})();
