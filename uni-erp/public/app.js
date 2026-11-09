'use strict';
window.UA = window.UA || {};
Object.assign(window.UA, {
  views: window.UA.views || {},
  actions: window.UA.actions || {},
  loaders: window.UA.loaders || {},
  forms: window.UA.forms || {},
  reset: window.UA.reset || function () {},
  studentShell: window.UA.studentShell || (() => ''),
  mq: window.UA.mq || window.matchMedia('(max-width: 820px)'),
  isMobile() { return this.mq.matches; },
  icon: (n, s, x) => (window.suIcon ? window.suIcon(n, s, x) : ''),
});
(function () {
  const UA = window.UA;
  /* ---------- أدوات ---------- */
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => { try { return new Date(t).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return new Date(t).toISOString(); } };
  const dur = (ms) => { const m = Math.round(ms / 60000); if (m < 60) return m + ' دقيقة'; const h = m / 60; return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' ساعة'; };
  const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
  function toast(m) { const t = $('#toast'); t.firstChild.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2600); }

  const apiGetCache = new Map();
  const inflightGets = new Map();
  const API_CACHE_TTL_MS = 12000;

  function clearApiCache() {
    apiGetCache.clear();
    inflightGets.clear();
  }

  // عمليات المال: مفتاح واحد لكل عملية، يبقى عند انقطاع الشبكة فلا تتكرر عند إعادة الإرسال
  const MONEY_POST = /^\/api\/(finance\/(journal|vouchers|invoices(\/\d+\/pay)?|charges|discounts|payments|payroll-entry|student-invoices(\/\d+\/pay)?)|enterprise\/(installments\/\d+\/pay|payslips\/issue)|student-affairs-suite\/scholarships)$/;
  const moneyKeys = new Map();
  const moneyKeyFor = (id) => { if (!moneyKeys.has(id)) moneyKeys.set(id, crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')); return moneyKeys.get(id); };

  async function api(method, url, body) {
    const m = String(method || 'GET').toUpperCase();
    const isCacheableGet = m === 'GET' && !url.startsWith('/api/verify') && !url.includes('/audit/verify') && !url.includes('high-concurrency');

    if (m !== 'GET') {
      apiGetCache.clear();
    } else if (isCacheableGet) {
      const hit = apiGetCache.get(url);
      if (hit && hit.exp > Date.now()) {
        return hit.data;
      }
      if (inflightGets.has(url)) {
        return inflightGets.get(url);
      }
    }

    try { sessionStorage.removeItem('uni_sid'); } catch { /* غير متاح */ }   // بقايا نسخة سابقة كانت تحفظ الرمز هنا
    const runFetch = (async () => {
      const headers = body ? { 'Content-Type': 'application/json' } : {};
      const moneyId = m === 'POST' && MONEY_POST.test(url) ? `${url}|${JSON.stringify(body ?? null)}` : null;
      if (moneyId) headers['Idempotency-Key'] = moneyKeyFor(moneyId);
      const res = await fetch(url, { method: m, credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await res.json(); } catch { /* ليس JSON */ }
      // وصل الرد: تُنسى العملية بعد مهلة الضغطة المزدوجة، أو فورًا إن رُفضت
      if (moneyId) { if (res.ok) setTimeout(() => moneyKeys.delete(moneyId), 5000); else moneyKeys.delete(moneyId); }
      if (res.ok && url === '/api/auth/login') {
        clearApiCache();
      }
      if (res.ok && url === '/api/auth/logout') {
        clearApiCache();
      }
      if (!res.ok) {
        const e = new Error((j && j.message) || 'حدث خطأ غير متوقع.'); e.status = res.status; e.code = j && j.error;
        if (res.status === 401 && url !== '/api/auth/login' && url !== '/api/me') { clearApiCache(); S.me = null; render(); }
        throw e;
      }
      if (isCacheableGet && j) {
        if (apiGetCache.size > 200) {
          const oldest = apiGetCache.keys().next().value;
          if (oldest) apiGetCache.delete(oldest);
        }
        apiGetCache.set(url, { data: j, exp: Date.now() + API_CACHE_TTL_MS });
      }
      return j;
    })();

    if (isCacheableGet) {
      inflightGets.set(url, runFetch);
      try {
        return await runFetch;
      } finally {
        inflightGets.delete(url);
      }
    }
    return runFetch;
  }

  // رفع ملف خام (صور/فيديو الأخبار): النوع يُحدَّد في الخادم من البايتات لا من الامتداد
  async function upload(url, file) {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    let j = null; try { j = await res.json(); } catch { /* */ }
    if (!res.ok) { const e = new Error((j && j.message) || 'فشل رفع الملف.'); e.status = res.status; throw e; }
    return j;
  }
  // عرض وسائط الخبر: صورة، فيديو مباشر/مرفوع، أو تضمين يوتيوب/فيميو (روابط https معتمدة فقط من الخادم)
  function mediaHtml(list, { compact = false } = {}) {
    if (!list || !list.length) return '';
    return `<div class="news-media${compact ? ' compact' : ''}">${list.map((m) => {
      const cap = m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : '';
      if (m.source === 'embed') return `<figure><div class="vid"><iframe src="${esc(m.src)}" title="${esc(m.caption || 'فيديو')}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe></div>${cap}</figure>`;
      if (m.kind === 'video') return `<figure><video src="${esc(m.src)}" controls preload="metadata" playsinline></video>${cap}</figure>`;
      return `<figure><img src="${esc(m.src)}" alt="${esc(m.caption || 'صورة الخبر')}" loading="lazy" referrerpolicy="no-referrer">${cap}</figure>`;
    }).join('')}</div>`;
  }

  /* ---------- الحالة ---------- */
  const S = { uni: 'الجامعة السورية للعلوم الأمنية', me: null, services: [], view: null, requests: [], stats: null, sel: null, filter: 'all', rej: null, svc: null, files: {},
    vtext: '', vres: null, adminTab: 'general', admin: {}, audit: null, chain: null, err: '',
    reg: null, stTab: 'requests', stList: { q: '', program: '', status: '', students: [], total: 0 }, stSel: null, stEdit: null, cred: null, fieldErr: null, profile: null, programs: [] };
  const can = (p) => !!S.me && S.me.permissions.includes(p);
  const ROLE_LABEL = { student: 'طالب', staff: 'موظف', admin: 'مدير النظام', auditor: 'مدقق' };

  function viewsFor(role) {
    const tr = (s) => (window.UA && window.UA.i18n ? window.UA.i18n.tr(s) : s);
    if (role === 'student') {
      const studentList = [
        ['home', tr('اللوحة الرئيسية')],
        ['guide', tr('دليل المواد والخطة')],
        ['grades', tr('علاماتي والسجل الأكاديمي')],
        ['fees', tr('كشف الرسوم')],
        ['lms', tr('التعلم الإلكتروني')],
        ['expansions', tr('الامتحانات والتظلمات')],
        ['student_life', tr('السكن الجامعي')],
        ['alumni', tr('الخريجون والتوظيف')],
        ['ai', tr('المرشد الذكي AI')],
        ['news', tr('الأخبار والإعلانات')],
        ['tx', tr('معاملاتي وبراءة الذمة')],
        ['guidelines', tr('دليل الطالب')],
      ];
      // شاشات الطالب يتحكم بها المدير من الإعدادات ← «بوابة الطالب»؛ الرئيسية والإرشادات ثابتتان
      const okSet = S.me && Array.isArray(S.me.allowedViews) && S.me.allowedViews.length ? new Set(S.me.allowedViews) : null;
      return okSet ? studentList.filter((x) => x[0] === 'home' || x[0] === 'guidelines' || okSet.has(x[0])) : studentList;
    }
    // قوائم العاملين الموحدة بعد إعادة الهيكلة ودمج الواجهات المتشابهة
    const v = [['overview', tr('اللوحة الرئيسية')]];
    // 1) الطلاب والطلبات (تضم ميزات التطوير المؤسسي الخاصة بالطلاب + اللجان الانضباطية الموحدة)
    const hasAffairs = can('request:read_all') || can('request:read_unit') || can('student:read') || can('student:register') ||
      can('sa_admissions:view') || can('sa_advising:view') || can('sa_lifecycle:view') || can('sa_scholarships:view') || can('sa_desk:view');
    if (hasAffairs) {
      v.push(['affairs', can('student:read') || can('student:register') || can('sa_admissions:view') || can('sa_advising:view') || can('sa_scholarships:view') ? tr('شؤون الطلاب') : can('request:read_all') ? tr('الطلبات') : tr('الطلبات المحالة لقسمي')]);
    }
    // 2) الأكاديمي والامتحانات (تضم المقررات والعلامات وميزات التطوير الأكاديمي)
    if (can('course:manage') || can('grade:manage') || can('grade:approve') || can('grade:approve_own') || can('faculty:manage')) v.push(['academics', tr('المواد والعلامات')]);
    if (can('attendance:manage')) v.push(['attendance', tr('سجل القاعات')]);
    v.push(['expansions', tr('الامتحانات والتقييم')]);
    v.push(['student_life', tr('السكن الجامعي')]);
    // 2-ب) الوحدات المتقدمة (5.12–5.15)
    v.push(['lms', tr('التعلم الإلكتروني')]);
    v.push(['labtools', tr('أدوات تجريبية')]);
    v.push(['research', tr('البحث والدراسات العليا')]);
    v.push(['alumni', tr('الخريجون والتوظيف')]);
    v.push(['qa', tr('الجودة والاعتماد المؤسسي')]);
    // 3) شؤون الموظفين الموحدة (تدمج الموظفين والرواتب + الحضور والإجازات + البصمة + تقييم الموظفين)
    if (can('staffatt:self') || can('staffatt:manage') || can('hr:manage') || can('hr_emp:view') || can('hr_payroll:view') || can('hr_contracts:view')) {
      v.push(['payroll', tr('شؤون الموظفين')]);
    }
    // 4) الديوان والمراسلات والطلبات الداخلية (مدمجة في واجهة موحدة)
    if (can('corr:use') || can('corr:read_all') || can('corr:templates') || can('request:create_internal')) {
      v.push(['corr', tr('الديوان والمراسلات والطلبات الداخلية')]);
    }
    // 5) التقارير والبيانات والذكاء الاصطناعي
    if (['stats:read', 'hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr_emp:delete', 'hr:manage', 'hr_payroll:approve', 'staffatt:manage', 'audit:read', 'devops:manage', 'settings:manage', 'backup:manage'].some(can)) v.push(['dashboard', tr('الإحصاءات والتقارير')]);
    if (can('student:register') || can('course:manage') || can('grade:manage') || can('data:export') || can('request:import') || ['import:academic', 'import:procurement', 'import:finance', 'import:hr', 'import:student_fin', 'import:misc'].some(can)) v.push(['exchange', tr('الاستيراد والتصدير')]);
    if (can('news:manage') || can('complaint:manage')) v.push(['comms', tr('الأخبار والشكاوى')]);
    v.push(['ai', tr('الذكاء الاصطناعي الجامعي')]);
    // 6) المشتريات والمالية
    if (can('procurement:read') || can('procurement:request') || can('procurement:manage') || can('procurement:stock') || can('procurement:assets')) v.push(['procurement', ['procurement:read', 'procurement:manage', 'procurement:stock', 'procurement:assets'].some(can) ? tr('المشتريات والمخازن') : tr('طلبات الشراء')]);
    if (can('finance:read') || can('finance:entry') || can('finance:fees') || can('finance:post') || can('finance:setup')) v.push(['finance', tr('المالية والمحاسبة')]);
    // 7) الإدارة المركزية وآليات المراقبة والتدقيق (تضم وحدات النظام والتحقق العام وإعداداتي)
    v.push(['admin', ['settings:manage', 'rules:manage', 'program:manage', 'backup:manage'].some(can) ? tr('لوحة الإدارة المركزية') : tr('إعداداتي والتحقق')]);
    if (can('user:manage') || can('role:manage')) v.push(['access', tr('الحسابات والصلاحيات')]);
    v.push(['audit', tr('آليات المراقبة والتدقيق')]);
    v.push(['guidelines', tr('دليل الإرشادات التفاعلي الشامل')]);

    // المصدر الوحيد للحقيقة: allowedViews المحسوبة في الخادم من الصلاحيات الفعلية (أو من تخصيص المدير)،
    // فأي شاشة لا يملك الحساب صلاحية عرضها تُخفى بالكامل، سواء كان وضع الحساب «دور» أو «مخصّص»
    const fullList = [...v];
    if (S.me && Array.isArray(S.me.allowedViews) && S.me.allowedViews.length > 0) {
      const allowedSet = new Set(S.me.allowedViews);
      return fullList.filter((item) => allowedSet.has(item[0]) || item[0] === 'overview' || item[0] === 'guidelines' || item[0] === 'admin');
    }
    return fullList;
  }

  /* ---------- مكوّنات ---------- */
  const pill = (r) => { const m = { review: ['p-review', 'قيد المراجعة'], approved: ['p-approved', 'معتمد'], rejected: ['p-rejected', 'مرفوض'] }[r.status]; return `<span class="pill ${m[0]}">${m[1]}</span>`; };
  function steps(r) {
    const auto = r.rejectedBy === 'auto';
    const s = [['تقديم الطلب', 'done'], ['الفحص الآلي', auto ? 'fail' : 'done'], ['مراجعة الموظف', auto ? '' : (r.status === 'review' ? 'cur' : 'done')], ['القرار', r.status === 'approved' ? 'done' : (r.status === 'rejected' ? 'fail' : '')]];
    return '<ol class="steps">' + s.map((x) => `<li class="${x[1]}">${x[0]}</li>`).join('') + '</ol>';
  }
  function detailsText(r) {
    const svc = S.services.find((s) => s.code === r.service.code);
    const parts = (svc ? svc.fields : []).filter((f) => r.details[f.name] !== undefined).map((f) => `${f.label}: ${r.details[f.name]}`);
    if (r.attachment) parts.push(`المرفق: ${r.attachment.name}`);
    return parts.join(' · ');
  }
  const events = (r) => '<ul class="events">' + r.events.map((e) => `<li>${fmt(e.at)} · ${esc(e.actor)}: ${esc(e.text)}</li>`).join('') + '</ul>';

  /* ---------- الشاشات ---------- */
  function loginView() {
    return `<form class="login card" id="loginform"><div class="login-hero"><img class="crest" src="/brand/crest.svg" alt="شعار ${esc(S.uni)}"><h1>نظام إدارة وأتمتة البيانات في الجامعة السورية للعلوم الأمنية</h1><div class="hint">${esc(S.uni)} · قسم شؤون الطلاب</div></div>
      ${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}
      <label>اسم المستخدم<input id="lg-u" autocomplete="username" required></label>
      <label>كلمة المرور<input id="lg-p" type="password" autocomplete="current-password" required></label>
      <button class="btn pri" type="submit">دخول</button>
      <div class="actions" style="margin:0 22px 22px"><button class="btn sm" type="button" data-act="goverify">التحقق من وثيقة (بدون دخول)</button></div></form>`;
  }
  const siteFoot = () => `<footer class="site-foot"><div class="wrap"><div class="f-brand"><img class="crest sm" src="/brand/crest.svg" alt=""><div><b>${esc(S.uni)}</b><span class="gold">وزارة الداخلية · دمشق</span></div></div><div>جميع الحقوق محفوظة للجامعة السورية للعلوم الأمنية © 2026</div></div></footer>`;
  function header() {
    const tabs = viewsFor(S.me?.role ?? 'public').map((t) => `<button class="tab" role="tab" data-act="view" data-v="${t[0]}" aria-selected="${S.view === t[0]}">${UA.icon(t[0], 18)}<span>${t[1]}</span></button>`).join('');
    const who = S.me ? `<div class="who"><span><b>${esc(S.me.name)}</b> · ${esc(S.me.roleLabel || ROLE_LABEL[S.me.role])}${S.me.unit ? ` · ${esc(S.me.unit.name)}` : ''}</span><button class="btn sm" data-act="logout">خروج</button></div>`
      : '<div class="who"><button class="btn sm" data-act="tologin">تسجيل الدخول</button></div>';
    return `<header class="top"><div class="wrap"><div class="brand"><img class="crest" src="/brand/crest.svg" alt="" width="40" height="48"><div class="t"><b>نظام إدارة وأتمتة البيانات في الجامعة السورية للعلوم الأمنية</b><span>${esc(S.uni)} · قسم شؤون الطلاب</span></div></div>
      <div class="tabs" role="tablist">${tabs}</div>${who}</div></header><div class="wrap" style="padding-top:16px">`;
  }

  function editCard(a) {
    const e = S.edit; if (!e) return '';
    if (e.type === 'fac') {
      const f = (a.faculties || []).find((x) => x.id === e.id); if (!f) return '';
      const KINDS = { college: 'كلية', institute: 'معهد', center: 'مركز' };
      return `<section class="card" id="editcard"><h2>تعديل جهة: ${esc(f.name)}</h2><div class="inline-form">
        <label>الاسم بالعربية<input id="ed-name" maxlength="80" value="${esc(f.name)}"></label>
        <label>الاسم بالإنكليزية<input id="ed-en" maxlength="100" dir="ltr" value="${esc(f.nameEn)}"></label>
        <label>الرمز<input id="ed-code" maxlength="8" dir="ltr" value="${esc(f.code)}"${f.students ? ' disabled' : ''}></label>
        <label>النوع<select id="ed-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <button class="btn pri" data-act="facsave" data-id="${f.id}">حفظ</button><button class="btn" data-act="editcancel">إلغاء</button></div>
        ${f.students ? '<p class="small">الرمز مقفل لأن في هذه الجهة طلاباً صدرت أرقامهم الجامعية به.</p>' : ''}</section>`;
    }
    const p = (a.programs || []).find((x) => x.id === e.id); if (!p) return '';
    return `<section class="card" id="editcard"><h2>تعديل برنامج: ${esc(p.name)} <span class="small">(${esc(p.faculty)})</span></h2><div class="inline-form">
      <label>اسم البرنامج<input id="ed-name" maxlength="80" value="${esc(p.name)}"></label>
      <label>الدرجة<input id="ed-deg" maxlength="30" value="${esc(p.degree)}"></label>
      <label>المدة (سنوات)<input id="ed-years" type="number" min="1" max="4" value="${p.years}"></label>
      <button class="btn pri" data-act="progsave" data-id="${p.id}">حفظ</button><button class="btn" data-act="editcancel">إلغاء</button></div></section>`;
  }
  function affairsView() {
    const st = S.stats;
    const stats = st ? `<div class="stats"><div class="stat"><small>قيد المراجعة</small><b>${st.review}</b></div><div class="stat"><small>معتمدة</small><b>${st.approved}</b></div><div class="stat"><small>مرفوضة</small><b>${st.rejected}</b></div><div class="stat"><small>متوسط زمن الاعتماد</small><b style="font-size:20px">${st.avgApprovalMs ? dur(st.avgApprovalMs) : '-'}</b></div></div>
      ${st.slaBreaches ? `<p class="reason" style="margin-top:12px">${st.slaBreaches} طلب تجاوز مدة الخدمة المعتمدة (SLA).</p>` : ''}` : '';
    const kpiExtra = UA.studentAffairsSuite ? UA.studentAffairsSuite.kpiStrip() : '';

    // التقسيم: القبول، السجل الطلابي، الحركات والقرارات، الإرشاد، الرعاية والمنح، الخدمات والوثائق
    const tabs = [];
    if (['sa_admissions:view', 'sa_admissions:write', 'sa_admissions:approve', 'student:register'].some(can)) tabs.push(['admissions', 'القبول والمفاضلة']);
    if (can('student:read')) tabs.push(['list', 'سجل الطلاب (360°)']);
    if (can('student:register')) tabs.push(['new', 'تسجيل طالب جديد']);
    tabs.push(
      ['groups', 'فئات الطلاب'],
      ['lifecycle', 'حركات القيد والانضباط'],
      ['advising', 'الخطة والإرشاد والإنذار'],
      ['scholarships', 'المنح والإعفاءات'],
      ['requests', can('request:decide') ? 'سجل الطلبات والتتبع الحي' : 'الطلبات'],
      ['digital_card', 'البطاقة الجامعية'],
      ['desk_queue', 'مكتب خدمة الطالب والدور']
    );
    const cur = S.stTab === 'edit' ? 'list' : S.stTab;
    const bar = `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="sttab" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}${t[0] === 'requests' && st && st.review ? ` <span class="badge-n">${st.review}</span>` : ''}</button>`).join('')}</div>`;
    const suiteTabs = ['admissions', 'advising', 'lifecycle', 'scholarships', 'desk_queue', 'digital_card', 'disciplinary'];
    let bodyHtml = '';
    if (cur === 'groups' && UA.renderStudentGroups) {
      bodyHtml = UA.renderStudentGroups();
    } else if (cur === 'digital_card' && UA.renderDigitalCardSection) {
      bodyHtml = UA.renderDigitalCardSection();
    } else if (cur === 'lifecycle' && UA.studentAffairsSuite) {
      bodyHtml = UA.studentAffairsSuite.renderTab('lifecycle') + (UA.renderDisciplinarySection ? UA.renderDisciplinarySection() : '');
    } else if (suiteTabs.includes(cur) && UA.studentAffairsSuite) {
      bodyHtml = UA.studentAffairsSuite.renderTab(cur);
    } else if (S.stTab === 'requests' || !tabs.some((t) => t[0] === cur)) {
      bodyHtml = requestsBody();   // مكتب الخدمة والدور له تبويبه المستقل (6)؛ لا نكرّره أسفل سجل الطلبات
    } else {
      bodyHtml = studentsView();
    }
    // الأرقام تخص الطلبات: تظهر في تبويبها فقط، وصف المؤشرات يُخفى على الجوال كي يصل المحتوى مباشرة
    const head = (S.stTab === 'requests' || !tabs.some((t) => t[0] === cur)) ? `${stats}<div class="aff-kpi">${kpiExtra}</div>` : '';
    return `${head}<div style="margin-top:16px">${bar}</div>${bodyHtml}`;
  }

  function requestsBody() {
    const canDecide = can('request:decide');
    const fl = [['all', 'الكل'], ['review', 'قيد المراجعة'], ['approved', 'معتمدة'], ['rejected', 'مرفوضة']];
    const list = S.requests.filter((r) => S.filter === 'all' || r.status === S.filter);
    const sel = S.requests.find((r) => r.id === S.sel);
    const rows = list.map((r) => `<tr class="row" tabindex="0" data-act="sel" data-id="${r.id}" aria-selected="${S.sel === r.id}"><td>${esc(r.service.label)}${r.unit ? `<div class="small">عند: ${esc(r.unit.name)}</div>` : ''}</td><td>${esc(r.student.name)}</td><td>${pill(r)}${UA.flow && UA.flow.isPending(r.id) ? ' <span class="small ux-pending-tag">بانتظار مهلة التراجع</span>' : ''}</td><td class="hint" style="white-space:nowrap">${fmt(r.createdAt)}</td></tr>`).join('');
    const fresh = sel && S.drawerFor !== sel.id;
    S.drawerFor = sel ? sel.id : null;
    return `<div><section class="card"><h2>سجل الطلبات</h2><p class="hint" style="margin-top:0">اختر طلباً لعرض تفاصيله وإجراءاته في اللوحة الجانبية.</p><div class="chips">${fl.map((f) => `<button class="chip" data-act="flt" data-f="${f[0]}" aria-pressed="${S.filter === f[0]}">${f[1]}</button>`).join('')}</div>
      <div class="tbl-wrap"><table><thead><tr><th>الخدمة</th><th>الطالب</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">لا طلبات في هذا التصنيف.</td></tr>'}</tbody></table></div></section>
      ${sel ? `<aside class="ux-drawer no-print" aria-label="تفاصيل الطلب"${fresh ? ' data-fresh="1"' : ''}><header><h2 tabindex="-1">تفاصيل الطلب</h2><span style="display:flex;gap:6px"><button type="button" class="btn sm" data-act="reqprint" data-id="${sel.id}">طباعة النموذج</button><button type="button" class="btn sm" data-act="reqclose" aria-label="إغلاق تفاصيل الطلب">إغلاق</button></span></header><div class="ux-drawer-body">${staffDetail(sel, canDecide)}</div></aside>` : ''}</div>`;
  }
  function staffDetail(r, canDecide) {
    const auto = r.rejectedBy === 'auto';
    let act = '';
    if (r.status === 'review' && canDecide && UA.flow && UA.flow.isPending(r.id)) {
      act = `<div class="ux-pending" role="status">${UA.flow.pendingAction(r.id) === 'approve' ? 'سيُعتمد الطلب خلال ثوانٍ.' : 'سيُرفض الطلب خلال ثوانٍ.'} <button class="btn sm" data-act="requndo" data-id="${r.id}">تراجع</button></div>`;
    } else if (r.status === 'review' && canDecide) {
      act = `<div class="actions"><button class="btn ok" data-act="approve" data-id="${r.id}">اعتماد وإصدار الوثيقة</button><button class="btn bad" data-act="rejform" data-id="${r.id}">رفض</button></div>` +
        (S.rej === r.id ? `<div class="form" style="margin-top:12px"><label>سبب الرفض (يظهر للطالب)<textarea id="rej-text" rows="2" maxlength="300"></textarea></label><div class="actions" style="margin:0"><button class="btn bad" data-act="reject" data-id="${r.id}">تأكيد الرفض</button></div></div>` : '');
    } else if (r.document) act = `<div class="actions"><button class="btn pri" data-act="doc" data-c="${esc(r.document.code)}">عرض الوثيقة</button><span class="hint" style="align-self:center">رمز التحقق: <span class="mono">${esc(r.document.code)}</span></span></div>`;
    if (r.status === 'review' && can('request:forward') && (S.targets || []).length) {
      const opts = S.targets.filter((t) => !r.unit || t.id !== r.unit.id);
      if (opts.length) act += `<div class="form fwd-box" style="margin-top:12px"><b>إحالة الطلب إلى وحدة مرتبطة</b><label>الوحدة<select id="fw-unit">${opts.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
        <label>ملاحظة للجهة المستلمة (اختياري)<input id="fw-note" maxlength="300"></label><div class="actions" style="margin:0"><button class="btn" data-act="fwd" data-id="${r.id}">إحالة</button></div></div>`;
    }
    else if (r.status === 'rejected') act = `<div class="reason" style="margin-top:8px">سبب الرفض: ${esc(r.rejectReason)}</div>`;
    const att = r.attachment ? `<dt>المرفق</dt><dd><a href="/api/attachments/${r.attachment.id}">${esc(r.attachment.name)}</a> <span class="small">(${Math.round(r.attachment.size / 1024)} ك.ب)</span></dd>` : '';
    return `<dl class="kv"><dt>الطلب</dt><dd>${esc(r.service.label)} <span class="no">${esc(r.no)}</span></dd><dt>الطالب</dt><dd>${esc(r.student.name)} · ${esc(r.student.studentNo)}${can('student:read') && r.student.id ? ` <button class="link" data-act="openstud" data-id="${r.student.id}">فتح ملف الطالب</button>` : ''}</dd><dt>التفاصيل</dt><dd>${esc(detailsText(r))}</dd><dt>الحالة</dt><dd>${pill(r)}</dd><dt>الجهة الحالية</dt><dd>${r.unit ? esc(r.unit.name) : '<span class="hint">غير محال</span>'}</dd>${r.decidedAt ? `<dt>زمن المعالجة</dt><dd>${dur(r.decidedAt - r.createdAt)}</dd>` : ''}${att}</dl>
      <b style="display:block;margin-top:12px;font-size:14px">مراحل الطلب</b>${(UA.steps || steps)(r)}
      <b style="display:block;margin-top:12px;font-size:14px">الفحص الآلي</b><ul class="checks"><li class="${auto ? 'x' : ''}">${auto ? esc(r.rejectReason) : 'اجتاز كل القواعد المفعَّلة'}</li></ul>${act}<div style="margin-top:12px">${events(r)}</div>`;
  }

  function adminView() {
    const tabs = [
      ['general', 'الإعدادات العامة والقوائم المنسدلة', can('settings:manage') && !!UA.general],
      ['mysettings', 'إعداداتي الشخصية', true],
      ['rules', 'قواعد الفحص الآلي', can('rules:manage')],
      ['programs', 'الكليات والبرامج', can('program:manage')],
      ['units', 'وحدات النظام (5.1–5.17)', true],
      ['verify', 'التحقق العام والوثائق الرقمية', true],
      ['backup', 'النسخ الاحتياطي المشفر (AES-256-GCM)', can('backup:manage')],
      ...(can('rules:manage') && UA.adminCfg ? UA.adminCfg.tabs.map((x) => [x[0], x[1], true]) : []),
    ].filter((t) => t[2]);
    if (!tabs.some((t) => t[0] === S.adminTab)) S.adminTab = tabs[0] ? tabs[0][0] : 'general';
    const bar = `<div class="sub-tabs">${tabs.map((t) => `<button class="chip" data-act="atab" data-t="${t[0]}" aria-pressed="${S.adminTab === t[0]}">${t[1]}</button>`).join('')}</div>`;
    const a = S.admin;
    if (S.adminTab === 'general') return bar + UA.general.view();
    if (S.adminTab === 'mysettings') return bar + (UA.renderMySettingsInAdmin ? UA.renderMySettingsInAdmin() : '<section class="card"><p class="hint">إعداداتي الشخصية</p></section>');
    if (S.adminTab === 'units') return bar + (UA.views.units ? UA.views.units() : '');
    if (S.adminTab === 'verify') return bar + verifyView();
    if (S.adminTab === 'backup') return bar + UA.backupView();
    if (UA.adminCfg && UA.adminCfg.tabs.some((x) => x[0] === S.adminTab)) return bar + UA.adminCfg.view(S.adminTab);
    if (S.adminTab === 'rules') {
      return bar + (UA.rulesAdminView ? UA.rulesAdminView(a.rules) : '');
    }
    const KIND = { college: 'كلية', institute: 'معهد', center: 'مركز' };
    const facs = a.faculties || [];
    return bar + editCard(a) + `<section class="card"><h2>الكليات والمعاهد والمراكز</h2><p class="hint">الرمز اللاتيني (الأحرف الأولى من الاسم الإنكليزي) يبدأ به اسم المستخدم والرقم الجامعي للطلاب الجدد، مثل <span class="mono" dir="ltr">CSS-2026-0001</span>. الطلاب الحاليون يحتفظون بأرقامهم.</p>
      <div class="tbl-wrap"><table><thead><tr><th>الجهة</th><th>الاسم الإنكليزي</th><th>الرمز</th><th>البرامج</th><th>الطلاب</th><th></th></tr></thead><tbody>${facs.map((f) => `<tr><td>${esc(f.name)} <span class="small">(${KIND[f.kind]})</span></td><td dir="ltr" style="text-align:right">${esc(f.nameEn)}</td><td class="mono">${esc(f.code)}</td><td>${f.programs}</td><td>${f.students}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-act="factoggle" data-id="${f.id}" data-on="${f.active ? 0 : 1}">${f.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm" data-act="facedit" data-id="${f.id}">تعديل</button> <button class="btn sm bad" data-act="facdel" data-id="${f.id}">حذف</button></td></tr>`).join('')}</tbody></table></div></section>
      <section class="card" style="margin-top:16px"><h2>إضافة جهة</h2><div class="inline-form"><label>الاسم بالعربية<input id="fc-name" maxlength="80"></label><label>الاسم بالإنكليزية<input id="fc-en" maxlength="100" dir="ltr" placeholder="College of ..."></label>
        <label>الرمز (اختياري)<input id="fc-code" maxlength="8" dir="ltr" placeholder="يُولَّد تلقائياً"></label><label>النوع<select id="fc-kind"><option value="college">كلية</option><option value="institute">معهد</option><option value="center">مركز</option></select></label><button class="btn pri" data-act="addfac">إضافة</button></div>
        <p class="small">تُنشأ للجهة الجديدة برنامج أساسي يحمل اسمها، ويمكن إضافة برامج أخرى تحتها.</p></section>
      <section class="card" style="margin-top:16px"><h2>برنامج أكاديمي جديد</h2><div class="inline-form"><label>الكلية / المعهد<select id="pg-fac">${facs.filter((f) => f.active).map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label><label>البرنامج<input id="pg-name" maxlength="80"></label><label>الدرجة<input id="pg-deg" value="بكالوريوس" maxlength="30"></label>
        <label>المدة (سنوات)<input id="pg-years" type="number" min="1" max="4" value="4"></label><button class="btn pri" data-act="addprog">إضافة</button></div><p class="small">البرامج المعطَّلة تختفي من نموذج التسجيل، ويبقى الطلاب المسجَّلون فيها.</p></section>
      <section class="card" style="margin-top:16px"><h2>البرامج</h2><div class="tbl-wrap"><table><thead><tr><th>الجهة</th><th>البرنامج</th><th>المدة</th><th>الطلاب</th><th></th></tr></thead><tbody>${(a.programs || []).map((p) => `<tr${p.active ? '' : ' style="opacity:.55"'}><td>${esc(p.faculty)}${p.facultyCode ? ` <span class="mono small">${esc(p.facultyCode)}</span>` : ''}</td><td>${p.faculty === p.name ? esc(p.degree) : `${esc(p.degree)} ${esc(p.name)}`}</td><td>${p.years}</td><td>${p.students}</td><td style="white-space:nowrap"><button class="btn sm" data-act="progtoggle" data-id="${p.id}" data-on="${p.active ? 0 : 1}">${p.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm" data-act="progedit" data-id="${p.id}">تعديل</button> <button class="btn sm bad" data-act="progdel" data-id="${p.id}">حذف</button></td></tr>`).join('')}</tbody></table></div></section>`;
  }


  /* ---------- تغيير كلمة المرور الإلزامي ---------- */
  function mustChangeView() {
    return `<form class="login card" id="pwform"><h1>تغيير كلمة المرور</h1><div class="hint">سُجِّل دخولك بكلمة مرور مؤقتة. اختر كلمة مرور خاصة بك للمتابعة.</div>
      ${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}
      <label>كلمة المرور المؤقتة المعطى سابقا<input id="pw-cur" type="password" autocomplete="current-password" required></label>
      <label>كلمة المرور الجديدة<input id="pw-new" type="password" autocomplete="new-password" required minlength="10"></label>
      <label>تأكيد كلمة المرور الجديدة<input id="pw-new2" type="password" autocomplete="new-password" required minlength="10"></label>
      <div class="small">10 أحرف على الأقل، وتحوي حروفاً وأرقاماً.</div>
      <button class="btn pri" type="submit">حفظ ومتابعة</button><button class="btn sm" type="button" data-act="logout">خروج</button></form>`;
  }

  // إعداد التحقق بخطوتين، للإلزام عند الدخول ومن «إعداداتي»
  function mfaSetupView() {
    const m = S.mfaFlow || {};
    if (m.codes) return `<section class="login card"><h1>احفظ رموز الاسترداد</h1><p class="hint">كل رمز يصلح مرة واحدة إن فقدت هاتفك، ولن تظهر مرة أخرى.</p><div class="mono" dir="ltr" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:12px 0">${m.codes.map((c) => `<span>${esc(c)}</span>`).join('')}</div><button class="btn pri" type="button" data-act="mfadone">حفظتها، متابعة</button></section>`;
    if (!m.qr) return `<section class="login card"><h1>التحقق بخطوتين</h1><p class="hint">هذا الحساب يتطلب رمزًا من تطبيق مصادقة على هاتفك، مثل Google Authenticator أو Microsoft Authenticator.</p><button class="btn pri" type="button" data-act="mfastart">بدء الإعداد</button> <button class="btn sm" type="button" data-act="logout">خروج</button></section>`;
    return `<form class="login card" id="mfaform"><h1>امسح الرمز بالتطبيق</h1><div class="mfa-qr">${m.qr}</div><p class="small">أو أدخل هذا المفتاح يدويًا: <span class="mono" dir="ltr">${esc(m.secret)}</span></p>${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}<label>الرمز المكوّن من 6 أرقام<input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required dir="ltr"></label><button class="btn pri" type="submit">تأكيد</button></form>`;
  }
  UA.mfaSetupView = mfaSetupView;

  /* ---------- تسجيل الطلاب ---------- */
  const STATUS_CLS = { active: 'p-approved', suspended: 'p-review', withdrawn: 'p-rejected', transferred: 'p-rejected', graduated: 'p-review' };
  const spill = (st, label) => `<span class="pill ${STATUS_CLS[st] || ''}">${esc(label)}</span>`;
  const today = () => new Date().toISOString().slice(0, 10);

  function fieldHtml(f, v) {
    const id = 'sf-' + f.name, req = f.required ? ' required' : '', inv = S.fieldErr === f.name ? ' aria-invalid="true"' : '';
    const val0 = v === undefined || v === null ? (f.default ?? '') : v;
    let ctl;
    if (f.type === 'select' || f.type === 'program') {
      ctl = `<select id="${id}"${req}${inv}>${f.required && f.type === 'program' ? '<option value="">— اختر —</option>' : (f.required ? '' : '<option value="">—</option>')}${f.options.map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(val0) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
    } else if (f.type === 'longtext') ctl = `<textarea id="${id}" rows="2" maxlength="${f.max}"${inv}>${esc(val0)}</textarea>`;
    else if (f.type === 'date') ctl = `<input id="${id}" type="date" max="${today()}" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'int') ctl = `<input id="${id}" type="number" inputmode="numeric" min="${f.min}" max="${f.max}" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'num') ctl = `<input id="${id}" type="number" inputmode="decimal" min="0" max="${f.max}" step="any" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'tel') ctl = `<input id="${id}" type="tel" inputmode="tel" dir="ltr" pattern="\\+?[0-9][0-9 \\-]{6,19}" value="${esc(val0)}" placeholder="09xxxxxxxx"${req}${inv}>`;
    else if (f.type === 'email') ctl = `<input id="${id}" type="email" dir="ltr" maxlength="120" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'nid') ctl = `<input id="${id}" dir="ltr" inputmode="numeric" maxlength="20" pattern="[0-9A-Za-z ]{6,20}" autocomplete="off" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'latin') ctl = `<input id="${id}" dir="ltr" maxlength="${f.max}" value="${esc(val0)}"${req}${inv}>`;
    else ctl = `<input id="${id}" type="text" maxlength="${f.max ?? 100}" value="${esc(val0)}"${req}${inv}>`;
    return `<label class="${f.wide ? 'wide' : ''}"><span>${esc(f.label)}${f.required ? ' <i class="req-m" aria-hidden="true">*</i>' : ''}</span>${ctl}${f.hint ? `<span class="small">${esc(f.hint)}</span>` : ''}</label>`;
  }
  /* مرفقات الطالب: الثبوتيات الشخصية، الصورة الشخصية، مرفقات أخرى (تُرفع بعد حفظ الملف) */
  const ATT = [['identity', 'الثبوتيات الشخصية', 'idcard', 'هوية أو جواز أو دفتر عائلة أو شهادة الثانوية (صور أو PDF، حتى 5 ملفات، 8 ميغابايت للملف).', true],
    ['photo', 'الصورة الشخصية', 'photo', 'صورة واضحة بخلفية سادة (jpg أو png أو webp، حتى 3 ميغابايت). تحلّ الجديدة محل القديمة.', false],
    ['other', 'مرفقات أخرى', 'clip', 'أي وثائق داعمة أخرى (صور أو PDF، حتى 10 ملفات).', true]];
  const fsize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب');
  function filesList(files, kind, canDel) {
    const l = (files || []).filter((f) => f.kind === kind);
    return l.length ? `<ul class="att-list">${l.map((f) => `<li>${f.mime.startsWith('image/') ? `<a href="${f.url}" target="_blank" rel="noopener"><img class="att-th" alt="" src="${f.url}"></a>` : ''}<a href="${f.url}" target="_blank" rel="noopener">${esc(f.name)}</a> <span class="small">${fsize(f.size)}</span>${canDel ? ` <button type="button" class="btn sm bad" data-act="stfdel" data-id="${f.id}">حذف</button>` : ''}</li>`).join('')}</ul>` : '';
  }
  function attachmentsSection(n, edit) {
    const rows = ATT.map(([k, title, ic, hint, multi]) => `<div class="att"><span class="att-ic" aria-hidden="true">${UA.icon(ic, 30)}</span><div class="att-b"><b>${title}</b><span class="small">${hint}</span>
      ${edit ? filesList(S.stFiles, k, true) : ''}${k === 'photo' ? '<button type="button" class="btn sm" data-act="formcam" style="margin-inline-end:8px">تصوير بالكاميرا</button><span class="small" id="formcam-msg"></span> ' : ''}<input type="file" id="att-${k}"${multi ? ' multiple' : ''} accept="${k === 'photo' ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,image/gif,application/pdf'}"></div></div>`).join('');
    return `<fieldset class="sec"><legend><span class="n">${n}</span>المرفقات</legend><div class="att-grid">${rows}</div><p class="small" style="margin:8px 0 0">المرفقات اختيارية، وتُرفع بعد حفظ بيانات الطالب. يمكن إضافتها أو حذفها لاحقاً من «تعديل».</p></fieldset>`;
  }
  async function uploadAttachments(studentId) {
    const fails = []; let n = 0;
    for (const [k] of ATT) {
      const inp = document.getElementById('att-' + k); if (!inp || !inp.files) continue;
      for (const f of inp.files) { try { await upload(`/api/students/${studentId}/files?kind=${k}&name=${encodeURIComponent(f.name)}`, f); n++; } catch (e) { if (!e.status) throw e; fails.push(`${f.name}: ${e.message}`); } }
    }
    return { n, fails };
  }
  /* بيانات إضافية: أي عدد من أزواج (عنوان، قيمة) تُضاف عند الحاجة */
  const xfRow = (l = '', v = '') => `<div class="xf-row"><input class="xf-l" maxlength="40" placeholder="العنوان (مثال: الهواية)" value="${esc(l)}" aria-label="عنوان البيان"><input class="xf-v" maxlength="300" placeholder="القيمة" value="${esc(v)}" aria-label="قيمة البيان"><button type="button" class="btn sm bad" data-act="xfdel" aria-label="حذف البيان">حذف</button></div>`;
  function extraSection(n, list) {
    return `<fieldset class="sec"><legend><span class="n">${n}</span>بيانات إضافية (اختيارية)</legend><p class="small" style="margin-top:0">أضف أي بيان آخر تحتاجه عن الطالب: اكتب عنواناً وقيمة، ويمكنك إضافة أكثر من بيان.</p>
      <div id="xf-list">${(list || []).map((x) => xfRow(x.label, x.value)).join('')}</div><button type="button" class="btn sm" data-act="xfadd">+ إضافة بيان</button></fieldset>`;
  }
  function studentForm(values, edit) {
    const secs = S.reg.sections.map((sec, i) => `<fieldset class="sec"><legend><span class="n">${i + 1}</span>${esc(sec.title)}</legend><div class="fgrid">${sec.fields.filter((f) => edit || !f.editOnly).map((f) => fieldHtml(f, values[f.name])).join('')}</div></fieldset>`).join('');
    const exSec = extraSection(S.reg.sections.length + 1, edit ? (S.stEdit && S.stEdit.extra) : S.newExtra);
    const attSec = attachmentsSection(S.reg.sections.length + 2, edit);
    return `<form id="regform" class="regform" novalidate-off>${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}${secs}${exSec}${attSec}
      <div class="actions sticky-actions"><button class="btn pri" type="submit">${edit ? 'حفظ التعديلات' : 'تسجيل الطالب'}</button><button class="btn" type="button" data-act="${edit ? 'stcancel' : 'stclear'}">${edit ? 'إلغاء' : 'تفريغ النموذج'}</button>
      <span class="small" style="align-self:center">الحقول المعلَّمة بـ <i class="req-m">*</i> إلزامية. يُولَّد الرقم الجامعي وكلمة المرور المؤقتة تلقائياً.</span></div></form>`;
  }
  function credCard() {
    const c = S.cred; if (!c) return '';
    const att = c.att && (c.att.n || c.att.fails.length) ? `<p class="hint">رُفع ${c.att.n} مرفق${c.att.fails.length ? ` — تعذّر رفع: ${esc(c.att.fails.join(' | '))} (أضِفها من «تعديل»)` : ''}.</p>` : '';
    const st = c.student || { name: c.name, studentNo: c.username };
    return `<section class="card cred" id="credwrap"><h2>تم تسجيل الطالب</h2><p class="hint" style="margin-top:0">سلِّم هذه البطاقة للطالب الآن: فيها بيانات القيد والباركود واسم المستخدم وكلمة المرور المؤقتة.</p>${att}
      ${UA.idCard(st, { cred: c, files: c.files, cert: c.cert })}
      <div class="actions no-print" style="margin-top:14px;justify-content:center"><button class="btn pri" data-act="credprint">طباعة البطاقة</button><button class="btn" data-act="credcopy">نسخ البيانات</button><button class="btn" data-act="credopen">فتح ملف الطالب</button><button class="btn" data-act="crednew">تسجيل طالب آخر</button></div></section>`;
  }
  function studentsView() {
    if (!S.reg) return '<div class="empty">جارٍ التحميل…</div>';
    const bar = '';
    if (S.stTab === 'new') return bar + (S.cred ? credCard() : `<section class="card"><h2>تسجيل طالب جديد</h2>${studentForm(S.newVals || {}, false)}</section>`);
    if (S.stTab === 'edit' && S.stEdit) return bar + `<section class="card"><h2>تعديل ملف: ${esc(S.stEdit.name)} <span class="mono small">${esc(S.stEdit.studentNo)}</span></h2>${studentForm(S.stEdit.profile, true)}</section>`;
    if (UA.studentsTable) return bar + UA.studentsTable.view(studentDetail);
    const L = S.stList, progOpts = S.reg.sections.flatMap((x) => x.fields).find((f) => f.name === 'program_id').options;
    const rows = L.students.map((st) => `<tr class="row" tabindex="0" data-act="stsel" data-id="${st.id}" aria-selected="${S.stSel && S.stSel.id === st.id}"><td class="mono">${esc(st.studentNo)}</td><td>${esc(st.name)}</td><td class="hint">${esc(st.program.label || st.program.name)} · ${esc(st.levelLabel)}</td><td>${spill(st.status, st.statusLabel)}</td></tr>`).join('');
    return bar + `<div class="grid2"><section class="card"><h2>سجل الطلاب <span class="small">(${L.total})</span></h2>
      <form class="inline-form" id="stsearch"><label>بحث<input id="st-q" value="${esc(L.q)}" placeholder="اسم، رقم جامعي، رقم وطني، هاتف" maxlength="60"></label>
        <label>البرنامج<select id="st-prog"><option value="">الكل</option>${progOpts.map((o) => `<option value="${o.v}"${String(o.v) === String(L.program) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>
        <label>الحالة<select id="st-status"><option value="">الكل</option>${Object.entries(S.reg.statuses).map(([k, v]) => `<option value="${k}"${k === L.status ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <button class="btn pri" type="submit">بحث</button></form>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>الرقم</th><th>الاسم</th><th>البرنامج</th><th>الحالة</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">لا طلاب مسجَّلون بعد. ابدأ بـ «تسجيل طالب جديد».</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>ملف الطالب</h2>${S.stSel ? studentDetail(S.stSel) : '<div class="empty">اختر طالباً من السجل لعرض ملفه.</div>'}</section></div>`;
  }
  const kvrow = (k, v) => (v === null || v === undefined || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`);
  function profileKv(st) {
    const p = st.profile, F = Object.fromEntries(S.reg ? S.reg.sections.flatMap((x) => x.fields).map((f) => [f.name, f]) : []);
    const lab = (n) => (F[n] ? F[n].label : n);
    return S.profSections.map((sec) => `<h3 class="sec-h">${esc(sec.title)}</h3><dl class="kv">${sec.fields.map((f) => {
      if (f.name === 'status') return kvrow(lab('status'), st.statusLabel);
      if (f.name === 'program_id') return kvrow('الكلية والبرنامج', st.program.label);
      if (f.name === 'study_level') return kvrow(lab('study_level'), st.levelLabel);
      return kvrow(lab(f.name), p[f.name]);
    }).join('')}</dl>`).join('');
  }
  function relatedRequests(st) {
    const rs = (S.requests || []).filter((r) => r.student && r.student.studentNo === st.studentNo);
    if (!rs.length) return '';
    return `<h3 class="sec-h">طلبات الطالب</h3><ul class="mini-list">${rs.map((r) => `<li><button class="link" data-act="reqopen" data-id="${r.id}">${esc(r.service.label)} · <span class="mono">${esc(r.no)}</span></button> ${pill(r)}</li>`).join('')}</ul>`;
  }
  function attDetail() {
    const f = S.stFiles || []; if (!f.length) return '<h3 class="sec-h">المرفقات</h3><p class="small">لا مرفقات.</p>';
    return '<h3 class="sec-h">المرفقات</h3>' + ATT.map(([k, t]) => { const l = filesList(f, k, false); return l ? `<b class="small">${t}</b>${l}` : ''; }).join('');
  }
  function studentDetail(st) {
    return `<div class="me st-top">${UA.photoBox ? UA.photoBox(st) : `<div class="avatar">${esc(st.name[0])}</div>`}<div><b>${esc(st.name)}</b><small class="mono">${esc(st.studentNo)}</small></div></div>
      <div style="margin:8px 0">${spill(st.status, st.statusLabel)} ${st.activeHolds ? `<span class="pill p-rejected">${st.activeHolds} عقوبة قائمة</span>` : ''}</div>
      <div class="actions no-print"><button class="btn pri sm" data-act="stedit">تعديل</button><button class="btn sm" data-act="stpw">إعادة تعيين كلمة المرور</button><button class="btn sm" data-act="stcert">شهادة التسجيل الموقَّعة (PDF)</button>${can('student:delete') ? '<button class="btn sm bad" data-act="stdel">حذف الطالب</button>' : ''}</div>${S.stCert ? `<p class="small">رمز التحقق <span class="mono" dir="ltr">${esc(S.stCert.code)}</span> · ${S.stCert.tsaStatus === 'rfc3161' ? 'ختم زمني موثوق' : S.stCert.tsaStatus === 'failed' ? 'تعذّر الختم الموثوق' : 'ختم زمني محلي'} · بصمة <span class="mono" dir="ltr">${esc(S.stCert.pdfSha256.slice(0, 16))}…</span>${S.stCert.selfSigned ? ' · شهادة ذاتية' : ''}</p>` : ''}
      ${st.extra && st.extra.length ? `<dl class="kv" style="margin-top:10px">${st.extra.map((x) => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join('')}</dl>` : ''}
      ${relatedRequests(st)}${profileKv(st)}${attDetail()}<p class="small">سُجِّل ${fmt(st.createdAt)} · آخر تعديل ${fmt(st.updatedAt)}</p>`;
  }
  function logsView() {
    const LV = { error: ['p-rejected', 'خطأ'], warn: ['p-review', 'تحذير'], info: ['p-approved', 'معلومة'] };
    return `<section class="card"><h2>سجل النظام (آخر ${(S.logs || []).length} حدثاً منذ تشغيل الخادم)</h2><p class="hint" style="margin-top:0">أخطاء الخادم وتحذيراته وأحداثه المهمة. الملفات الكاملة تُحفظ يومياً في مجلد <span class="mono">data/logs</span> (14 يوماً).</p>
      <div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>المستوى</th><th>الحدث</th><th>التفاصيل</th></tr></thead><tbody>${(S.logs || []).map((l) => `<tr><td class="small">${fmt(l.t)}</td><td><span class="pill ${(LV[l.level] || LV.info)[0]}">${(LV[l.level] || LV.info)[1]}</span></td><td>${esc(l.msg)}</td><td>${l.meta ? `<details><summary class="small">عرض</summary><pre class="mono small" dir="ltr" style="white-space:pre-wrap;margin:6px 0 0">${esc(l.meta.stack || l.meta.detail || JSON.stringify(l.meta))}</pre></details>` : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">لا أحداث مسجَّلة.</td></tr>'}</tbody></table></div></section>`;
  }
  function auditView() {
    const c = S.chain, tab = S.auditTab === 'logs' ? 'logs' : 'audit';
    const bar = `<div class="sub-tabs no-print" role="tablist">${[['audit', 'سجل التدقيق'], ['logs', 'سجل النظام']].map((t) => `<button class="chip" role="tab" data-act="audtab" data-t="${t[0]}" aria-pressed="${tab === t[0]}">${t[1]}</button>`).join('')}</div>`;
    if (tab === 'logs') return bar + logsView();
    return bar + `<section class="card"><h2>سجل التدقيق (إضافة فقط)</h2><div class="actions" style="margin-top:0"><button class="btn pri sm" data-act="chain">تحقق من سلامة السلسلة</button>
      ${c ? `<span class="${c.ok ? 'ok-t' : 'bad-t'}" style="align-self:center">${c.ok ? `السلسلة سليمة (${c.checked} سجلاً)` : `كُسرت السلسلة عند السجل ${c.brokenAtId}`}</span>` : ''}</div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>الوقت</th><th>المنفِّذ</th><th>الإجراء</th><th>المرجع</th><th>IP</th></tr></thead><tbody>${(S.audit || []).map((a) => `<tr><td>${a.id}</td><td style="white-space:nowrap">${fmt(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.ref)}</td><td class="mono">${esc(a.ip ?? '')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function verifyView() {
    const r = S.vres; let res = '';
    if (r) {
      if (r.valid && r.kind === 'enrollment') {
        const sg = r.signature, ts = sg.timestamp, tsTxt = ts.status === 'rfc3161' ? `ختم زمني موثوق (RFC 3161) بتاريخ ${fmt(ts.time)}${ts.embedded && ts.imprintOk ? ' — مطابق لبصمة التوقيع' : ''}` : ts.status === 'failed' ? 'تعذّر الحصول على ختم زمني موثوق وقت الإصدار؛ يُعتمد وقت الخادم' : 'وقت التوقيع من خادم الجامعة (دون جهة ختم خارجية)';
        res = `<div class="result good"><h3>الشهادة صحيحة وموقَّعة رقمياً</h3><dl class="kv"><dt>النوع</dt><dd>${esc(r.service)}</dd><dt>الطالب</dt><dd>${esc(r.student)}</dd><dt>الكلية / المعهد</dt><dd>${esc(r.faculty)}</dd><dt>وقت التوقيع</dt><dd>${fmt(sg.signingTime ? new Date(sg.signingTime).getTime() : r.issuedAt)}</dd>
          <dt>بصمة الملف SHA-256</dt><dd class="mono" dir="ltr">${esc(r.hashPrefix)}…</dd><dt>الموقِّع (X.509)</dt><dd dir="ltr" style="text-align:right">${esc(sg.signer)}</dd><dt>الختم الزمني</dt><dd>${esc(tsTxt)}</dd></dl>
          <p class="hint" style="margin-bottom:0">أُعيد فحص الملف المحفوظ لدى الجامعة: بصمته وتوقيعه سليمان.${sg.selfSigned ? ' <b>تنبيه:</b> شهادة التوقيع ذاتية الإصدار ولم تصدر عن جهة اعتماد علنية، لذا قد تعرضها قارئات PDF «موقِّع غير معروف» رغم سلامة البصمة.' : ''}</p></div>`;
      } else if (r.valid) res = `<div class="result good"><h3>الوثيقة صحيحة وصادرة عن الجامعة</h3><dl class="kv"><dt>النوع</dt><dd>${esc(r.service)}</dd><dt>الطالب</dt><dd>${esc(r.student)}</dd><dt>تاريخ الإصدار</dt><dd>${fmt(r.issuedAt)}</dd><dt>بصمة الوثيقة</dt><dd class="mono">${esc(r.hashPrefix)}…</dd></dl><p class="hint" style="margin-bottom:0">أُعيد حساب البصمة والتوقيع من سجل الجامعة وطابقا المخزَّنين وقت الإصدار.</p></div>`;
      else if (r.reason === 'tampered') res = '<div class="result badr"><h3>تحذير: بيانات الوثيقة لا تطابق السجل</h3>فشل التحقق من البصمة أو التوقيع، فقد تكون الوثيقة عُدِّلت.</div>';
      else if (r.reason === 'malformed') res = '<div class="result badr"><h3>صيغة الرمز غير صحيحة</h3>الصيغة المتوقعة: UV-XXXX-XXXX</div>';
      else res = '<div class="result badr"><h3>الوثيقة غير موجودة</h3>لا توجد وثيقة بهذا الرمز في سجلات الجامعة.</div>';
    }
    return `<div class="verify"><section class="card"><h2>التحقق من وثيقة صادرة</h2><p class="hint" style="margin-top:0">امسح رمز QR على الوثيقة أو اكتب الرمز المطبوع أسفلها. لا تُعرض بيانات الطالب الكاملة.</p>
      <form class="vform" id="vform"><input id="vcode" type="text" placeholder="UV-XXXX-XXXX" autocomplete="off" value="${esc(S.vtext)}" aria-label="رمز التحقق"><button class="btn pri" type="submit">تحقق</button></form>
      <div class="vfile"><label class="hint">أو افحص ملف PDF نفسه: يُحسب SHA-256 على جهازك ولا يُرفع الملف<input type="file" id="vfile" accept="application/pdf,.pdf"></label></div></section>${res}</div>`;
  }

  function docHtml(d) {
    const p = d.payload, st = p.student, who = `<b>${esc(st.name)}</b> (الرقم الجامعي ${esc(st.studentNo)})`;
    let body = '';
    if (p.service.code === 'attendance') body = `<p>تشهد ${esc(p.university)} بأن الطالب/ـة ${who} مقيَّد/ـة في برنامج «${esc(st.program)}»، وهو/هي على رأس دراسته/ا حتى تاريخ إصدار هذه الإفادة.</p><p>أُعطيت هذه الإفادة بناءً على طلبه/ا لتقديمها إلى: ${esc(p.details.purpose)}.</p>`;
    if (p.service.code === 'transcript' && UA.transcript) return UA.transcript.render(d, S.trTpl || S.trDefault || 'classic');
    if (p.service.code === 'transcript') body = `<p>كشف علامات الطالب/ـة ${who}:</p><table><thead><tr><th>المقرر</th><th>الفصل</th><th>الساعات</th><th>العلامة</th></tr></thead><tbody>${p.transcript.grades.map((g) => `<tr><td>${esc(g.course)}</td><td>${esc(g.term)}</td><td>${g.hours}</td><td>${g.mark}</td></tr>`).join('')}</tbody></table><p style="margin-bottom:0">المعدل المرجَّح: ${p.transcript.average ?? '-'} من 100.</p>`;
    if (p.service.code === 'excellence_year') body = `<p>تشهد ${esc(p.university)} بأنه تقرر قبول تسجيل الطالب/ـة ${who}، المقيَّد/ـة في برنامج «${esc(st.program)}»، في سنة الامتياز للعام الدراسي ${esc(p.details.academic_year)}.</p>${p.details.notes ? `<p>ملاحظات: ${esc(p.details.notes)}</p>` : ''}`;
    if (p.service.code === 'excuse') body = `<p>بعد مراجعة المرفقات والتحقق من استيفائها للمدة النظامية، تقرر قبول العذر المقدَّم من الطالب/ـة ${who} عن امتحان مقرر «${esc(p.details.course)}» بتاريخ ${esc(p.details.exam_date)} (السبب: ${esc(p.details.reason)})، وتحديد موعد امتحان بديل.</p>`;
    if (!body) body = `<p>وثيقة صادرة عن قسم شؤون الطلاب للطالب/ـة ${who}، برنامج «${esc(st.program)}».</p>${(p.fields || []).filter((f) => p.details && p.details[f.name] !== undefined && p.details[f.name] !== '').map((f) => `<p><b>${esc(f.label)}:</b> ${esc(p.details[f.name])}</p>`).join('')}`;
    return `<div class="doc">${UA.letterheadSync ? UA.letterheadSync({ university: p.university }) : `<div class="doc-head"><img class="crest" src="/brand/crest.svg" alt=""><h2>${esc(p.university)}</h2></div>`}<div class="sub">قسم شؤون الطلاب · ${esc(p.service.label)}</div><hr>${body}
      <div class="doc-foot"><div><span class="stamp">موقّعة رقمياً</span><div style="margin-top:8px">رقم الطلب: <span class="mono">${esc(p.requestNo)}</span></div><div>تاريخ الإصدار: ${fmt(p.issuedAt)}</div><div>رمز التحقق: <span class="mono">${esc(d.code)}</span></div><div>البصمة: <span class="mono">${esc(d.hash.slice(0, 20))}…</span></div></div><div class="qr"><img alt="رمز QR للتحقق" src="/api/documents/${encodeURIComponent(d.code)}/qr.svg"></div></div></div>`;
  }

  function showDoc() {
    const doc = S.docCur, tr = doc.payload.service.code === 'transcript' && UA.transcript, cur = S.trTpl || S.trDefault || 'classic';
    const sw = tr ? `<div class="tr-sw no-print">${UA.transcript.templates.map((t) => `<button class="chip${t.id === cur ? ' on' : ''}" data-act="trtpl" data-t="${t.id}" title="${esc(t.desc)}">${esc(t.name)}${t.id === S.trDefault ? ' ✓' : ''}</button>`).join('')}${can('program:manage') && cur !== S.trDefault ? '<button class="btn" data-act="trdef">اعتماد كنموذج افتراضي</button>' : ''}</div>` : '';
    $('#layer').innerHTML = `<div class="overlay" dir="rtl" data-act="close"><div class="sheet${tr ? ' sheet-tr' : ''}"><div class="sheet-bar no-print"><button class="btn" data-act="close">إغلاق</button><span><button class="btn" data-act="docpdf" data-c="${esc(doc.code)}">حفظ كملف PDF</button> <button class="btn" data-act="docprint">طباعة</button> <button class="btn pri" data-act="copy" data-c="${esc(doc.code)}">نسخ رمز التحقق</button></span></div>${sw}${docHtml(doc)}</div></div>`;
  }

  /* ---------- العرض والأحداث (مع حفظ موضع التمرير والتركيز التلقائي) ---------- */
  const BUILTIN = { affairs: affairsView, admin: adminView, audit: auditView };
  function captureScrollAndFocus() {
    const side = document.querySelector('.sx-side');
    const nav = document.querySelector('.sx-nav');
    const main = document.querySelector('.sx-main');
    const ae = document.activeElement;
    const focusInfo = ae && ae.id && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')
      ? { id: ae.id, val: ae.value, start: ae.selectionStart, end: ae.selectionEnd }
      : null;
    return {
      winY: window.scrollY || 0,
      winX: window.scrollX || 0,
      sideTop: side ? side.scrollTop : 0,
      navTop: nav ? nav.scrollTop : 0,
      mainTop: main ? main.scrollTop : 0,
      drawerTop: document.querySelector('.ux-drawer-body')?.scrollTop || 0,
      focusInfo,
    };
  }
  function restoreScrollAndFocus(snap) {
    if (!snap) return;
    const apply = () => {
      const side = document.querySelector('.sx-side');
      const nav = document.querySelector('.sx-nav');
      const main = document.querySelector('.sx-main');
      if (side && snap.sideTop) side.scrollTop = snap.sideTop;
      if (nav && snap.navTop) nav.scrollTop = snap.navTop;
      if (main && snap.mainTop) main.scrollTop = snap.mainTop;
      const drawer = document.querySelector('.ux-drawer-body');
      if (drawer && snap.drawerTop) drawer.scrollTop = snap.drawerTop;
      if (snap.winY || snap.winX) window.scrollTo(snap.winX, snap.winY);
      if (snap.focusInfo && snap.focusInfo.id) {
        const el = document.getElementById(snap.focusInfo.id);
        if (el) {
          el.focus({ preventScroll: true });
          try {
            if (typeof snap.focusInfo.start === 'number') {
              el.setSelectionRange(snap.focusInfo.start, snap.focusInfo.end ?? snap.focusInfo.start);
            }
          } catch { /* ignore */ }
        }
      }
      if (UA.afterRenderEnhance) UA.afterRenderEnhance();
    };
    apply();
    requestAnimationFrame(apply);
  }
  function render() {
    const snap = captureScrollAndFocus();
    const app = $('#app');
    if (UA.i18n) UA.i18n.applyLang(UA.i18n.getLang());
    document.body.classList.remove('sx-on', 'sx-drawer', 'sx-grouped');
    document.body.classList.remove('is-m');
    if (!S.me && S.view !== 'verify') {
      app.innerHTML = loginView() + siteFoot();
      if (UA.i18n) UA.i18n.translateDom(app);
      restoreScrollAndFocus(snap);
      return;
    }
    if (S.me && S.me.mustChange) {
      app.innerHTML = mustChangeView();
      if (UA.i18n) UA.i18n.translateDom(app);
      restoreScrollAndFocus(snap);
      return;
    }
    if (S.me && S.me.mfaSetup) {
      app.innerHTML = mfaSetupView();
      if (UA.i18n) UA.i18n.translateDom(app);
      restoreScrollAndFocus(snap);
      return;
    }
    if (S.me && !viewReady(S.view)) { ensureView(S.view).then(render, (e) => toast(e.message)); return; }
    const v = S.view === 'verify' ? verifyView : (UA.views[S.view] || BUILTIN[S.view] || (() => ''));
    if (typeof v === 'function' && v.length >= 1 && UA.views[S.view]) {
      const shellOpts = S.me && S.me.role === 'student'
        ? { views: viewsFor('student'), act: 'snav', active: S.view, label: (viewsFor('student').find((x) => x[0] === S.view) || [])[1] || '', root: 'بوابة خدمات الطلاب', search: false, student: true }
        : {};
      app.innerHTML = UA.shell ? UA.shell('<div id="ua-view-mount"></div>', shellOpts) : header() + '<main><div id="ua-view-mount"></div></main></div>' + siteFoot();
      const mount = app.querySelector('#ua-view-mount') || app;
      UA.views[S.view](mount, S.me);
      if (UA.i18n) UA.i18n.translateDom(app);
      restoreScrollAndFocus(snap);
      return;
    }
    if (S.me && S.me.role === 'student') {
      app.innerHTML = UA.studentShell();
      if (UA.i18n) UA.i18n.translateDom(app);
      restoreScrollAndFocus(snap);
      return;
    }
    app.innerHTML = UA.shell ? UA.shell(v()) : header() + '<main>' + v() + '</main></div>' + siteFoot();
    if (UA.i18n) UA.i18n.translateDom(app);
    restoreScrollAndFocus(snap);
  }
  /* ---------- ملفات الأقسام الكبيرة تُحمَّل عند فتحها ---------- */
  const LAZY = { exchange: ['import.js', 'export.js'], import: ['import.js'], export: ['export.js'], finance: ['finance.js'], procurement: ['procurement.js'], access: ['access.js'], guidelines: ['guidelines.js'], lms: ['v12_views.js', 'quiz_builder.js', 'lms_assignments.js', 'lms_assignments_student.js'], research: ['v12_views.js'], alumni: ['v12_views.js'], qa: ['v12_views.js'], expansions: ['v12_views.js'], student_life: ['v12_views.js', 'housing.js'], labtools: ['v12_views.js', 'quiz_builder.js', 'housing.js'], ai: ['v12_views.js'], audit: ['v12_views.js'] };
  const ASSET_V = (document.currentScript && document.currentScript.src.split('?')[1]) || '';
  const scripts = new Map();
  function loadScript(file) {
    if (!scripts.has(file)) {
      scripts.set(file, new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = `/${file}?${ASSET_V}`; el.async = false;
        el.onload = () => { el.dataset.done = '1'; resolve(); };
        el.onerror = () => { scripts.delete(file); reject(new Error('تعذّر تحميل القسم؛ تحقق من الاتصال وأعد المحاولة.')); };
        document.head.appendChild(el);
      }));
    }
    return scripts.get(file);
  }
  const lazyFiles = (view) => (S.me && S.me.role === 'student' && view === 'guidelines' ? [] : LAZY[view] || []);
  const ensureView = (view) => Promise.all(lazyFiles(view).map(loadScript));
  const viewReady = (view) => lazyFiles(view).every((f) => document.querySelector(`script[src^="/${f}?"][data-done]`));
  async function loadFor(view) {
    if (!S.me) return;
    try {
      await ensureView(view);
      if (UA.loaders[view]) await UA.loaders[view]();
      else if (view === 'affairs') {
        const [r, st] = await Promise.all([
          api('GET', '/api/requests'),
          can('stats:read') ? api('GET', '/api/stats') : Promise.resolve(null),
          UA.loadStudentAffairsSuite ? UA.loadStudentAffairsSuite() : Promise.resolve(null),
        ]);
        S.requests = r.requests; S.stats = st && st.stats;
        S.targets = can('request:forward') ? (await api('GET', '/api/units/targets')).targets : [];
        if (can('student:register') && !S.reg) { S.reg = await api('GET', '/api/registration/options'); S.profSections = S.reg.sections; }
        if (can('student:read')) await loadStudents();
      } else if (view === 'admin') {
        const g = (perm, url, key) => (can(perm) ? api('GET', url).then((x) => x[key]) : Promise.resolve([]));
        const [holds, rules, pg, fc] = await Promise.all([g('holds:manage', '/api/admin/holds', 'holds'), g('rules:manage', '/api/admin/rules', 'rules'), g('program:manage', '/api/programs', 'programs'), g('program:manage', '/api/faculties', 'faculties')]);
        S.admin = { holds, rules, programs: pg, faculties: fc, backup: can('backup:manage') ? await api('GET', '/api/admin/backups') : null };
        if (can('settings:manage') && UA.general) await UA.general.load();
      } else if (view === 'audit') { S.audit = (await api('GET', '/api/audit?limit=500')).entries; S.logs = (await api('GET', '/api/admin/logs?limit=300')).entries; }
    } catch (e) { if (e.status !== 401) toast(e.message); }
  }
  async function loadStudents() {
    if (UA.studentsTable) { await UA.studentsTable.load(); return; }
    const L = S.stList, p = new URLSearchParams();
    if (L.q) p.set('q', L.q); if (L.program) p.set('program', L.program); if (L.status) p.set('status', L.status);
    const r = await api('GET', '/api/students?' + p);
    L.students = r.students; L.total = r.total;
  }
  function collect(secs, edit) {
    const o = {};
    secs.forEach((sec) => sec.fields.forEach((f) => { if (f.editOnly && !edit) return; const e = document.getElementById('sf-' + f.name); if (e) o[f.name] = e.value; }));
    o.extra = [...document.querySelectorAll('#xf-list .xf-row')].map((r) => ({ label: r.querySelector('.xf-l').value, value: r.querySelector('.xf-v').value }));
    return o;
  }
  function showErr(e) {
    S.err = e.message; S.fieldErr = e.field || null;
    return e;
  }
  async function go(view) {
    if (view === 'import' || view === 'export') { S.exTab = view; view = 'exchange'; }
    if (view === 'desk' && S.me && S.me.role !== 'student') { S.mainDashTab = 'unified'; view = 'overview'; }
    if (view === 'hr') { S.hrUnifiedTab = 'att'; view = 'payroll'; }
    if (view === 'devops') { S.auditTab = 'devops'; view = 'audit'; }
    if (view === 'units') { S.adminTab = 'units'; view = 'admin'; }
    if (view === 'verify' && S.me) { S.adminTab = 'verify'; view = 'admin'; }
    if (view === 'internal') { S.corrUnifiedTab = 'internal_requests'; view = 'corr'; }
    if (view === 'enterprise') {
      if (S.me && S.me.role === 'student') view = 'home';
      else view = 'affairs';
    }
    S.view = view;
    await loadFor(view);
    render();
  }
  async function afterLogin(user) {
    S.me = user; S.err = '';
    if (user.mustChange) { render(); return; }
    // الطالب يبدأ بها؛ وغيره لا يحتاجها في أول رسم
    const servicesReq = api('GET', '/api/services').then((r) => { S.services = r.services; });
    S.services = S.services || [];
    if (user.role === 'student') await servicesReq; else servicesReq.catch(() => {});
    await go(viewsFor(user.role)[0][0]);
  }
  async function doVerify(code) {
    S.vtext = (code ?? '').trim().toUpperCase();
    if (!S.vtext) { S.vres = null; return; }
    try { S.vres = await api('GET', '/api/verify/' + encodeURIComponent(S.vtext)); } catch (e) { S.vres = null; toast(e.message); }
  }
  const readFile = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(f); });
  async function guard(fn) { try { await fn(); } catch (e) { toast(e.message); } }

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (UA.forms[e.target.id]) { await guard(() => UA.forms[e.target.id](e.target)); return; }
    if (e.target.id === 'loginform') {
      await guard(async () => {
        const creds = { username: val('lg-u'), password: val('lg-p') };
        try { const r = await api('POST', '/api/auth/login', creds); await afterLogin(r.user); }
        catch (err) {
          if (!err.status) throw err;
          if (err.code !== 'mfa_required') { S.err = err.message; render(); return; }
          // كلمة المرور صحيحة: يبقى رمز تطبيق المصادقة
          for (;;) {
            const code = await askText('التحقق بخطوتين', { label: 'الرمز من تطبيق المصادقة أو رمز استرداد', submit: 'دخول', dir: 'ltr' });
            if (!code) return;
            try { const r = await api('POST', '/api/auth/login', { ...creds, code }); await afterLogin(r.user); return; }
            catch (e2) { if (!e2.status) throw e2; S.err = e2.message; if (e2.code !== 'mfa_invalid') { render(); return; } toast(e2.message); }
          }
        }
      });
    } else if (e.target.id === 'mfaform') {
      await guard(async () => {
        try { const r = await api('POST', '/api/auth/mfa/confirm', { code: val('mfa-code') }); S.err = ''; S.mfaFlow = { codes: r.recoveryCodes }; S.me.mfaEnabled = true; render(); }
        catch (err) { if (err.status) { S.err = err.message; render(); } else throw err; }
      });
    } else if (e.target.id === 'pwform') {
      const cur = val('pw-cur'), nw = val('pw-new');
      if (nw !== val('pw-new2')) { S.err = 'تأكيد كلمة المرور غير مطابق.'; render(); return; }
      try { await api('POST', '/api/auth/change-password', { current: cur, next: nw }); S.err = ''; S.me.mustChange = false; await afterLogin(S.me); toast('تم تغيير كلمة المرور'); }
      catch (err) { S.err = err.message; render(); }
    } else if (e.target.id === 'stsearch') {
      Object.assign(S.stList, { q: val('st-q').trim(), program: val('st-prog'), status: val('st-status') }); await guard(async () => { await loadStudents(); S.stSel = null; render(); });
    } else if (e.target.id === 'regform') {
      const edit = S.stTab === 'edit';
      await guard(async () => {
        const body = collect(S.reg.sections, edit);
        try {
          if (edit) {
            const r = await api('PUT', '/api/students/' + S.stEdit.id, body);
            const up = await uploadAttachments(S.stEdit.id); if (up.fails.length) toast('تعذّر رفع: ' + up.fails.join(' | '));
            S.stSel = r.student; S.stTab = 'list'; S.stEdit = null; S.err = ''; S.fieldErr = null; await loadStudents(); render(); toast('حُفظت التعديلات');
          } else {
            const r = await api('POST', '/api/students', body);
            const up = await uploadAttachments(r.student.id);
            S.cred = { ...r.credentials, name: r.student.name, id: r.student.id, att: up, student: r.student, files: [], cert: null };
            try {
              S.cred.files = (await api('GET', `/api/students/${r.student.id}/files`)).files;
              for (let k = 0; k < 6; k++) { const full = await api('GET', `/api/students/${r.student.id}`); S.cred.student = full.student; S.cred.cert = full.certificate; if (full.certificate) break; await new Promise((ok) => setTimeout(ok, 500)); }   // الشهادة تُصدَر في الخلفية
            } catch { /* اختياري */ } S.newVals = {}; S.newExtra = []; S.err = ''; S.fieldErr = null; render(); window.scrollTo(0, 0);
          }
        } catch (err) {
          if (!err.status) throw err;
          S.newVals = edit ? S.newVals : body; if (edit) { S.stEdit.profile = { ...S.stEdit.profile, ...body }; S.stEdit.extra = body.extra; } else S.newExtra = body.extra;
          showErr(err); render();
          const el = err.field && document.getElementById('sf-' + err.field); if (el) el.focus(); else window.scrollTo(0, 0);
        }
      });
    } else if (e.target.id === 'vform') { await doVerify(val('vcode')); render(); }
  });

  document.addEventListener('click', async (e) => {
    // النقر على قائمة منسدلة أو حقل كتابة لا يطلق إجراءً: إجراءاتها تعمل عند التغيير، وإعادة الرسم هنا كانت تغلق القائمة فور فتحها
    if (e.target.closest('select, textarea, input:not([type=checkbox],[type=radio],[type=button],[type=submit],[type=file])')) return;
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, d = el.dataset;
    if (a === 'close') { if ((el.classList.contains('overlay') && e.target.closest('.sheet')) || (el.classList.contains('m-drawer-bd') && e.target.closest('.m-drawer'))) return; $('#layer').innerHTML = ''; return; }
    await guard(async () => {
      if (UA.actions[a]) await UA.actions[a](el, d, e);
      else if (a === 'view') await go(d.v);
      else if (a === 'tologin') { S.view = null; render(); }
      else if (a === 'goverify') { S.view = 'verify'; render(); }
      else if (a === 'logout') { if (UA.flow) await UA.flow.flush(); await api('POST', '/api/auth/logout', {}); $('#layer').innerHTML = ''; UA.reset(); Object.assign(S, { me: null, view: null, requests: [], sel: null, reg: null, profile: null, stTab: 'requests', stSel: null, stEdit: null, cred: null }); render(); }
      else if (a === 'sel') { S.sel = Number(d.id); S.rej = null; render(); }
      else if (a === 'flt') { S.filter = d.f; render(); }
      else if (a === 'approve') { UA.flow.decide(d.id, 'approve'); }
      else if (a === 'rejform') { S.rej = Number(d.id); render(); }
      else if (a === 'reject') { const reason = val('rej-text'); if (reason.trim().length < 3 || reason.length > 300) { toast('سبب الرفض مطلوب (3-300 حرفاً) ويظهر للطالب.'); return; } S.rej = null; UA.flow.decide(d.id, 'reject', reason); }
      else if (a === 'doc') { S.docCur = (await api('GET', '/api/documents/' + encodeURIComponent(d.c))).document; S.trTpl = null; showDoc(); }
      else if (a === 'trtpl') { S.trTpl = d.t; showDoc(); }
      else if (a === 'trdef') { await api('PUT', '/api/transcript-template', { template: S.trTpl || S.trDefault }); S.trDefault = S.trTpl || S.trDefault; showDoc(); toast('اعتُمد هذا النموذج لكل كشوف العلامات'); }
      else if (a === 'docpdf') {                                   // حفظ الوثيقة المعتمدة كملف PDF موقَّع رقمياً
        const tpl = S.docCur && S.docCur.code === d.c && S.docCur.payload.service.code === 'transcript' ? '?template=' + encodeURIComponent(S.trTpl || S.trDefault || 'classic') : '';
        const res = await fetch('/api/documents/' + encodeURIComponent(d.c) + '/pdf' + tpl, { credentials: 'same-origin' });
        if (!res.ok) { toast('تعذّر تحميل ملف الوثيقة.'); return; }
        const al = document.createElement('a'); al.href = URL.createObjectURL(await res.blob()); al.download = `${d.c}.pdf`; al.click();
        setTimeout(() => URL.revokeObjectURL(al.href), 4000); toast('تم حفظ الوثيقة كملف PDF');
      }
      else if (a === 'docprint' && UA.printSheet) { await UA.printSheet(el.closest('.sheet')); }
      else if (a === 'docprint') { document.body.classList.add('print-doc'); window.addEventListener('afterprint', () => document.body.classList.remove('print-doc'), { once: true }); window.print(); }
      else if (a === 'print') { // يطبع النافذة أو البطاقة التي فيها الزر وحدها، أو ما يلي شريط الأدوات إذا كان الزر فيه (data-print-next)
        const box = el.closest('.modal, .card');
        const target = box && 'printNext' in d ? box.nextElementSibling : box;
        // المستند الرسمي: ورقة A4 بترويسة الجامعة والقسم والتاريخ وخانات التوقيع (print_doc.js)
        if (target && UA.printElement) {
          const titleFrom = 'printNext' in d ? box : null;
          const t = titleFrom && titleFrom.querySelector('h1, h2, h3');
          await UA.printElement(target, { ...(t ? { title: t.textContent.replace(/[\u{1F300}-\u{1FAFF}☀-➿️]/gu, '').replace(/\s+/g, ' ').trim() } : {}), metaFrom: titleFrom });
          return;
        }
        if (target) { target.classList.add('print-target'); document.body.classList.add('print-area'); window.addEventListener('afterprint', () => { target.classList.remove('print-target'); document.body.classList.remove('print-area'); }, { once: true }); }
        window.print();
      }
      else if (a === 'copy') { try { await navigator.clipboard.writeText(d.c); toast('تم نسخ الرمز'); } catch { toast('الرمز: ' + d.c); } }
      else if (a === 'atab') { S.adminTab = d.t; S.edit = null; if (d.t === 'general' && UA.general) await UA.general.load(); if (UA.adminCfg && UA.adminCfg.tabs.some((x) => x[0] === d.t)) await UA.adminCfg.load(d.t); render(); }
      else if (a === 'mfastart') { S.mfaFlow = await api('POST', '/api/auth/mfa/setup', {}); S.err = ''; S.me.mfaSetup = true; render(); }
      else if (a === 'mfadone') { S.mfaFlow = null; S.me.mfaSetup = false; await afterLogin(S.me); }
      else if (a === 'mfaoff') {
        const v = await askForm({ title: 'تعطيل التحقق بخطوتين', submit: 'تعطيل', fields: [{ name: 'password', label: 'كلمة المرور', type: 'password', required: true }, { name: 'code', label: 'الرمز من التطبيق', required: true, dir: 'ltr' }] });
        if (v) { await api('POST', '/api/auth/mfa/disable', v); S.me.mfaEnabled = false; render(); toast('عُطّل التحقق بخطوتين'); }
      }
      else if (a === 'addhold') { await api('POST', '/api/admin/holds', { studentNo: val('h-no'), holdType: val('h-type'), note: val('h-note') }); await loadFor('admin'); render(); toast('سُجّلت العقوبة'); }
      else if (a === 'clearhold') { await api('POST', `/api/admin/holds/${d.id}/clear`, {}); await loadFor('admin'); render(); toast('تمت التسوية'); }
      else if (a === 'rule') { await api('POST', `/api/admin/rules/${d.id}/toggle`, { enabled: d.on === '1' }); await loadFor('admin'); render(); }
      else if (a === 'edithold') {
        const h = S.admin.holds.find((x) => x.id === Number(d.id)); if (!h) return;
        const v = await askForm({ title: 'تعديل العقوبة', fields: [
          { name: 'holdType', label: 'النوع', type: 'select', value: h.holdType, options: [{ value: 'disciplinary', label: 'تأديبية / مسلكية' }, { value: 'financial', label: 'مالية' }, { value: 'library', label: 'مكتبة' }] },
          { name: 'note', label: 'الملاحظة', type: 'textarea', value: h.note || '' },
        ] });
        if (!v) return;
        await api('PUT', `/api/admin/holds/${d.id}`, v); await loadFor('admin'); render(); toast('حُفظ تعديل العقوبة');
      }
      else if (a === 'delhold') { if (!confirm('حذف سجل هذه العقوبة نهائياً؟ (للتسوية دون حذف استخدم «تسوية»)')) return; await api('DELETE', `/api/admin/holds/${d.id}`); await loadFor('admin'); render(); toast('حُذفت العقوبة'); }
      else if (a === 'delrule') { if (!confirm('حذف هذه القاعدة نهائياً؟ لن يُطبَّق هذا الفحص على الطلبات بعد الآن (للإيقاف المؤقت استخدم «تعطيل»).')) return; await api('DELETE', `/api/admin/rules/${d.id}`); await loadFor('admin'); render(); toast('حُذفت القاعدة'); }
      else if (a === 'facedit' || a === 'progedit') {
        S.edit = { type: a === 'facedit' ? 'fac' : 'prog', id: Number(d.id) }; render();
        const c = document.getElementById('editcard'); if (c) c.scrollIntoView({ block: 'center' });
      }
      else if (a === 'editcancel') { S.edit = null; render(); }
      else if (a === 'facsave') {
        const f = S.admin.faculties.find((x) => x.id === Number(d.id)); if (!f) return;
        await api('PUT', `/api/admin/faculties/${d.id}`, { name: val('ed-name'), nameEn: val('ed-en'), code: f.students ? f.code : val('ed-code'), kind: val('ed-kind') });
        S.edit = null; S.reg = null; await loadFor('admin'); render(); toast('حُفظ تعديل الجهة');
      }
      else if (a === 'progsave') {
        await api('PUT', `/api/admin/programs/${d.id}`, { name: val('ed-name'), degree: val('ed-deg'), years: Number(val('ed-years')) });
        S.edit = null; S.reg = null; await loadFor('admin'); render(); toast('حُفظ تعديل البرنامج');
      }
      else if (a === 'facdel') {
        const f = S.admin.faculties.find((x) => x.id === Number(d.id));
        if (!f || !confirm(`حذف الجهة «${f.name}» نهائياً؟ (لا يُقبل الحذف إن كان فيها طلاب)`)) return;
        await api('DELETE', `/api/admin/faculties/${d.id}`); S.reg = null; await loadFor('admin'); render(); toast('حُذفت الجهة');
      }
      else if (a === 'progdel') { const p = S.admin.programs.find((x) => x.id === Number(d.id)); if (!p || !confirm(`حذف البرنامج «${p.name}» نهائياً؟ (لا يُقبل الحذف إن كان فيه طلاب أو مقررات)`)) return; await api('DELETE', `/api/admin/programs/${d.id}`); S.reg = null; await loadFor('admin'); render(); toast('حُذف البرنامج'); }
      else if (a === 'stdel') {
        const st = S.stSel; if (!st || !confirm(`حذف الطالب «${st.name}» (${st.studentNo}) وكل علاماته وذممه وشكاواه نهائياً؟ لا يمكن التراجع.`)) return;
        await api('DELETE', '/api/students/' + st.id); S.stSel = null; S.stCert = null; await loadFor('affairs'); render(); toast('حُذف الطالب');
      }
      else if (a === 'sttab') {
        S.stTab = d.t; S.err = ''; S.fieldErr = null; S.stEdit = null;
        if (d.t === 'list') await loadStudents();
        if (d.t === 'lifecycle' && can('holds:manage')) { try { S.admin = { ...(S.admin || {}), holds: (await api('GET', '/api/admin/holds')).holds }; } catch (e) { if (!e.status) throw e; } }
        if (UA.loadStudentAffairsSuite && ['admissions', 'advising', 'lifecycle', 'scholarships', 'desk_queue', 'requests'].includes(d.t)) {
          await UA.loadStudentAffairsSuite();
        }
        render();
      }
      else if (a === 'stsel') { const r = await api('GET', '/api/students/' + d.id); S.stSel = r.student; S.stCert = r.certificate; S.stFiles = (await api('GET', `/api/students/${d.id}/files`)).files; render(); }
      else if (a === 'stcert') {
        const res = await fetch(`/api/students/${S.stSel.id}/certificate.pdf`, { credentials: 'same-origin' });
        if (!res.ok) { let m = 'تعذّر إصدار الشهادة.'; try { m = (await res.json()).message || m; } catch { /* */ } toast(m); return; }
        const al = document.createElement('a'); al.href = URL.createObjectURL(await res.blob()); al.download = `enrollment-${S.stSel.studentNo}.pdf`; al.click(); setTimeout(() => URL.revokeObjectURL(al.href), 4000);
        S.stCert = (await api('GET', '/api/students/' + S.stSel.id)).certificate; render();
      }
      else if (a === 'stfdel') { if (!confirm('حذف هذا المرفق نهائياً؟')) return; await api('DELETE', '/api/student-files/' + d.id); S.stFiles = (await api('GET', `/api/students/${(S.stEdit || S.stSel).id}/files`)).files; render(); toast('حُذف المرفق'); }
      else if (a === 'stedit') { S.stEdit = S.stSel; S.stTab = 'edit'; S.err = ''; S.fieldErr = null; render(); window.scrollTo(0, 0); }
      else if (a === 'stcancel') { S.stTab = 'list'; S.stEdit = null; S.err = ''; S.fieldErr = null; render(); }
      else if (a === 'stclear') { S.newVals = {}; S.newExtra = []; S.err = ''; S.fieldErr = null; render(); }
      else if (a === 'stpw') {
        if (!confirm('سيُنشأ كلمة مرور مؤقتة جديدة وتُنهى جلسات الطالب الحالية. متابعة؟')) return;
        const r = await api('POST', `/api/students/${S.stSel.id}/reset-password`, {});
        S.cred = { ...r.credentials, name: S.stSel.name, id: S.stSel.id, student: S.stSel, files: S.stFiles || [], cert: S.stCert || null }; S.stTab = 'new'; render();
      }
      else if (a === 'xfadd') { const l = document.getElementById('xf-list'); if (l && l.children.length < 20) { l.insertAdjacentHTML('beforeend', xfRow()); l.lastElementChild.querySelector('.xf-l').focus(); } }
      else if (a === 'xfdel') { const r = el.closest('.xf-row'); if (r) r.remove(); }
      else if (a === 'credcopy') { try { await navigator.clipboard.writeText(`${S.cred.username}\n${S.cred.tempPassword}`); toast('تم النسخ'); } catch { toast('تعذّر النسخ؛ انسخ يدوياً'); } }
      else if (a === 'credopen') { const id = S.cred.id; S.cred = null; S.stTab = 'list'; S.stSel = (await api('GET', '/api/students/' + id)).student; await loadStudents(); render(); }
      else if (a === 'crednew') { S.cred = null; S.newVals = {}; S.newExtra = []; render(); }
      else if (a === 'addfac') { const r = await api('POST', '/api/admin/faculties', { name: val('fc-name'), nameEn: val('fc-en'), code: val('fc-code'), kind: val('fc-kind') }); S.reg = null; await loadFor('admin'); render(); toast('أُضيفت الجهة، رمزها ' + r.code); }
      else if (a === 'factoggle') { await api('POST', `/api/admin/faculties/${d.id}/toggle`, { enabled: d.on === '1' }); S.reg = null; await loadFor('admin'); render(); }
      else if (a === 'fwd') { await api('POST', `/api/requests/${d.id}/forward`, { unitId: Number(val('fw-unit')), note: val('fw-note') }); await loadFor('affairs'); render(); toast('أُحيل الطلب'); }
      else if (a === 'addprog') { await api('POST', '/api/admin/programs', { facultyId: Number(val('pg-fac')), name: val('pg-name'), degree: val('pg-deg'), years: Number(val('pg-years')) }); S.reg = null; await loadFor('admin'); render(); toast('أُضيف البرنامج'); }
      else if (a === 'progtoggle') { await api('POST', `/api/admin/programs/${d.id}/toggle`, { enabled: d.on === '1' }); S.reg = null; await loadFor('admin'); render(); }
      else if (a === 'reqopen') { S.stTab = 'requests'; S.sel = Number(d.id); S.rej = null; render(); window.scrollTo(0, 0); }
      else if (a === 'openstud') { S.stSel = (await api('GET', '/api/students/' + d.id)).student; S.stFiles = (await api('GET', `/api/students/${d.id}/files`)).files; S.stTab = 'list'; render(); window.scrollTo(0, 0); }
      else if (a === 'audtab') { S.auditTab = d.t; if (d.t === 'logs') S.logs = (await api('GET', '/api/admin/logs?limit=300')).entries; render(); }
      else if (a === 'chain') { S.chain = await api('GET', '/api/audit/verify'); render(); }
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#layer').innerHTML = '';
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.row')) { e.preventDefault(); e.target.click(); }
  });

  /* ---------- الإقلاع ---------- */
  UA.start = async function start() {
    const params = new URLSearchParams(location.search), code = params.get('verify');
    try { const r = await api('GET', '/api/me'); S.uni = /[\u0600-\u06FF]/.test(r.university || '') ? r.university : 'الجامعة السورية للعلوم الأمنية'; S.site = r.site || {}; S.trDefault = r.transcriptTemplate || 'classic'; S.limits = r.limits || {}; if (r.user) await afterLogin(r.user); } catch { S.me = null; }
    if (code) { S.view = 'verify'; await doVerify(code); history.replaceState(null, '', location.pathname); }
    render();
  };
  document.addEventListener('change', async (e) => {
    if (!e.target || e.target.id !== 'vfile' || !e.target.files[0]) return;
    try {
      const h = await crypto.subtle.digest('SHA-256', await e.target.files[0].arrayBuffer()), hex = [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
      S.vres = await api('GET', '/api/verify-hash/' + hex); S.vtext = ''; render();
      if (!S.vres.valid && S.vres.reason === 'not_found') toast('لا توجد شهادة بهذه البصمة؛ الملف مختلف عن النسخة الأصلية أو ليس من إصدار الجامعة');
    } catch (err) { if (!err.status) throw err; toast(err.message); }
  });
  // التبديل التلقائي بين عرض الحاسوب والجوال عند تغيّر عرض النافذة (تدوير الجهاز أو تغيير حجم النافذة)
  try { UA.mq.addEventListener('change', () => { if (S.me) { $('#layer').innerHTML = ''; render(); } }); } catch { /* متصفح قديم */ }

  Object.assign(UA, { ensureView, spill, relatedRequests, header, siteFoot, upload, mediaHtml, viewsFor, S, api, esc, fmt, dur, $, val, toast, render, guard, go, loadFor, can, pill, steps, detailsText, events, docHtml, verifyView, readFile, afterLogin, ROLE_LABEL });
})();
