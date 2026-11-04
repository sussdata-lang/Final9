/* نموذج أولي مستقل: لا يتصل بالخادم ولا يعدّل بيانات الموقع. كل ما يُحفظ هنا يبقى في ذاكرة الصفحة. */
(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = (s) => String(s ?? '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* غير متاح */ } } };

  /* الأيقونات مرسومة بخط واحد، ومسارها من ملف Figma، بدل الرموز التعبيرية الحالية */
  const ICONS = {
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
    students: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    library: '<path d="M4 19V5M9 19V5M14 19V5M19 19V5M2 21h20M2 3h20"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6"/><path d="M16 13h4"/>',
    box: '<path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    exchange: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l-2.8 2.8a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6h-4a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-2.8-2.8a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14v-4a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l2.8-2.8a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l2.8 2.8a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1v4a1.7 1.7 0 0 0-1.6 1Z"/>',
    audit: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5M8 17h7"/>',
    guide: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M8 7h8M8 11h6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 8 5-3 5 3-1.5-8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M6 16h5M14 10h4M14 14h4"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a4 4 0 0 0 6 0ZM19 7l-3 7a4 4 0 0 0 6 0Z"/>',
    alert: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 11h6M9 15h6"/>',
    research: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
    graduation: '<path d="m2 10 10-5 10 5-10 5L2 10Z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>',
    quality: '<path d="M12 2 9.5 8H3l5 4-2 7 6-4 6 4-2-7 5-4h-6.5L12 2Z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    spark: '<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4H8v16a2 2 0 0 1-4 0V6H2v14a2 2 0 0 0 2 2Z"/><path d="M12 8h6M12 12h6M12 16h6"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z"/><path d="m9 12 2 2 4-4"/>',
    upload: '<path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    chev: '<path d="m15 18-6-6 6-6"/>', sort: '<path d="m6 9 6 6 6-6"/>', check: '<path d="m5 12 5 5 9-10"/>', x: '<path d="m7 7 10 10M17 7 7 17"/>',
  };
  const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

  const NAV = window.PROTO_NAV;
  const ALL = NAV.flatMap((g) => g.items);

  /* بيانات توضيحية فقط */
  const SERVICES = ['مصدقة تخرج', 'كشف علامات رسمي', 'تأجيل دراسة', 'إيقاف قيد مؤقت', 'تعديل بيانات شخصية', 'بطاقة جامعية بديلة', 'تظلم على علامة'];
  const UNITS = ['مكتب شؤون الدراسة والامتحانات', 'مكتب الوثائق والشهادات', 'مكتب القبول والتسجيل'];
  const row = (no, student, sno, service, unit, age, late, status) => ({ no, student, sno, service, unit, age, late, status, reason: '', step: status === 'pending' ? 1 : 2 });
  const state = {
    view: 'dashboard', tab: 0, q: '', status: 'all', sort: { key: 'no', dir: -1 },
    requests: [
      row('REQ-1048', 'سارة عبد الرحمن الخطيب', 'CYB-2026-0142', 'مصدقة تخرج', UNITS[1], 'منذ 3 أيام', true, 'pending'),
      row('REQ-1047', 'يوسف الأحمد', 'LAW-2025-0031', 'تظلم على علامة', UNITS[0], 'منذ يومين', true, 'pending'),
      row('REQ-1046', 'لين محمد ديب', 'CYB-2026-0088', 'كشف علامات رسمي', UNITS[1], 'منذ يومين', true, 'pending'),
      row('REQ-1045', 'عمر حسان الشامي', 'SEC-2024-0207', 'تأجيل دراسة', UNITS[0], 'منذ 5 ساعات', false, 'pending'),
      row('REQ-1044', 'نور الهدى إبراهيم القاسم', 'CYB-2025-0119', 'بطاقة جامعية بديلة', UNITS[2], 'منذ 3 ساعات', false, 'pending'),
      row('REQ-1043', 'حسام الدين سليمان', 'LAW-2026-0015', 'تعديل بيانات شخصية', UNITS[2], 'أمس', false, 'approved'),
      row('REQ-1042', 'رنا خالد', 'SEC-2025-0064', 'إيقاف قيد مؤقت', UNITS[0], 'أمس', false, 'rejected'),
      row('REQ-1041', 'مازن العلي', 'CYB-2024-0173', 'كشف علامات رسمي', UNITS[1], 'قبل يومين', false, 'approved'),
      row('REQ-1040', 'هبة يوسف الحلبي', 'LAW-2024-0092', 'مصدقة تخرج', UNITS[1], 'قبل 3 أيام', false, 'approved'),
      row('REQ-1039', 'طلال سعيد', 'SEC-2026-0021', 'تأجيل دراسة', UNITS[0], 'قبل 4 أيام', false, 'approved'),
    ],
    students: [
      ['CYB-2026-0142', 'سارة عبد الرحمن الخطيب', 'الأمن السيبراني', 'السنة الثانية', 'مقيد'],
      ['LAW-2025-0031', 'يوسف الأحمد', 'القانون', 'السنة الثالثة', 'مقيد'],
      ['SEC-2024-0207', 'عمر حسان الشامي', 'العلوم الأمنية', 'السنة الرابعة', 'موقوف القيد'],
      ['CYB-2025-0119', 'نور الهدى إبراهيم القاسم', 'الأمن السيبراني', 'السنة الثالثة', 'مقيد'],
      ['LAW-2026-0015', 'حسام الدين سليمان', 'القانون', 'السنة الأولى', 'مقيد'],
    ],
  };
  const STATUS = { pending: 'قيد الاعتماد', approved: 'معتمد', rejected: 'مرفوض', draft: 'مسودة' };
  /* لون ورمز لكل نوع خدمة، ويبقى اسمها مكتوباً فلا يعتمد التمييز على اللون وحده */
  const SERVICE_LOOK = {
    'مصدقة تخرج': ['award', 'gold'], 'كشف علامات رسمي': ['file', 'teal'], 'تأجيل دراسة': ['clock', 'blue'], 'إيقاف قيد مؤقت': ['pause', 'plum'],
    'تعديل بيانات شخصية': ['user', 'blue'], 'بطاقة جامعية بديلة': ['card', 'teal'], 'تظلم على علامة': ['scale', 'rose'],
  };
  const tile = (service) => { const [ic, tone] = SERVICE_LOOK[service] || ['file', 'teal']; return `<span class="tile ${tone}">${icon(ic)}</span>`; };
  const TONES = ['teal', 'gold', 'blue', 'plum', 'rose'];
  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join(' ');
  const faceTone = (name) => TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
  const face = (name) => `<span class="face ${faceTone(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
  const pill = (s) => `<span class="status ${s}">${STATUS[s]}</span>`;
  const pendingCount = () => state.requests.filter((r) => r.status === 'pending').length;

  /* ===== القائمة ===== */
  function renderNav() {
    $('#nav').innerHTML = `<span class="nav-marker" id="nav-marker"></span>` + NAV.map((g) => `<section class="nav-group"><h2>${esc(g.group)}</h2>${g.items.map((it) => {
      const on = it.id === state.view, count = it.id === 'affairs' ? pendingCount() : 0;
      return `<div class="nav-mod${on && it.tabs ? ' open' : ''}">
        <button class="nav-item" type="button" data-go="${it.id}"${on ? ' aria-current="page"' : ''} title="${esc(it.label)}">${icon(it.icon)}<span class="lbl">${esc(it.label)}</span>${count ? `<span class="count">${count}</span>` : ''}${it.tabs ? `<svg class="i nav-chev" viewBox="0 0 24 24" aria-hidden="true">${ICONS.chev}</svg>` : ''}</button>
        ${it.tabs ? `<div class="sub-wrap"><div class="sub">${it.tabs.map((t, i) => `<button type="button" data-go="${it.id}" data-tab="${i}"${on && state.tab === i ? ' aria-current="true"' : ''}>${esc(t.label)}</button>`).join('')}</div></div>` : ''}
      </div>`;
    }).join('')}</section>`).join('');
    placeNavMarker(false);
  }
  /* مؤشر واحد ينتقل بين الأقسام بدل تبدّل الخلفية فجأة */
  let lastMarkerY = null;
  function placeNavMarker(animateFrom = true) {
    const m = $('#nav-marker'), cur = $('.nav-item[aria-current="page"]');
    if (!m || !cur) { if (m) m.style.opacity = 0; return; }
    const nav = $('#nav'), y = cur.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
    if (animateFrom && lastMarkerY !== null && lastMarkerY !== y) {
      m.style.transition = 'none'; m.style.transform = `translateY(${lastMarkerY}px)`; m.getBoundingClientRect(); m.style.transition = '';
    } else if (!animateFrom) { m.style.transition = 'none'; }
    m.style.transform = `translateY(${y}px)`;
    if (!animateFrom) { m.getBoundingClientRect(); m.style.transition = ''; }
    lastMarkerY = y;
  }

  function renderCrumbs() {
    const it = ALL.find((x) => x.id === state.view);
    const parts = ['نظام إدارة الجامعة', it.label, ...(it.tabs.length > 1 ? [it.tabs[state.tab].label] : [])];
    $('#crumbs').innerHTML = parts.map((p, i) => (i === parts.length - 1 ? `<b>${esc(p)}</b>` : `<span>${esc(p)}</span>${icon('chev')}`)).join('');
  }

  /* ===== الشاشات ===== */
  function dashboardView() {
    const late = state.requests.filter((r) => r.late && r.status === 'pending');
    const queue = state.requests.filter((r) => r.status === 'pending').slice(0, 5);
    const maxUnit = Math.max(1, ...UNITS.map((u) => state.requests.filter((r) => r.unit === u && r.status === 'pending').length));
    return `<section class="hero"><div class="hero-top"><div><h1>صباح الخير، مدير النظام</h1><p>${pendingCount()} طلبات بانتظار إجراء منك، منها ${late.length} تجاوزت المهلة.</p></div>
      <div class="head-actions"><button class="btn gold" type="button" data-new>${icon('plus')}طلب جديد</button><button class="btn ghost" type="button" data-go="affairs" data-tab="1">سجل الطلاب</button></div></div>
    <div class="band" role="group" aria-label="ملخص العمل">
      <button type="button" data-go="affairs" data-tab="0" data-filter="pending"><small>طلبات قيد الاعتماد</small><strong>${pendingCount()}</strong></button>
      <button type="button" class="late" data-go="affairs" data-tab="0" data-filter="pending"><small>${icon('alert')}تجاوزت المهلة</small><strong>${late.length}</strong></button>
      <button type="button" data-go="corr"><small>مراسلات للتوقيع</small><strong>5</strong></button>
      <button type="button" data-go="finance"><small>قيود غير مرحّلة</small><strong>14</strong></button>
    </div></section>
    <div class="columns">
      <section class="panel"><header><h2>بانتظار إجراء منك</h2><button class="btn link" type="button" data-go="affairs" data-tab="0">كل الطلبات</button></header>
        <ul class="work">${queue.map((r) => `<li><button type="button" data-open="${r.no}">${tile(r.service)}<strong>${esc(r.service)}</strong><small>${esc(r.student)} · ${esc(r.unit)}</small><span class="age${r.late ? ' late' : ''}">${esc(r.age)}</span></button></li>`).join('') || '<li class="empty"><h3>لا شيء بانتظارك</h3><p>أنجزت كل الطلبات المحالة إليك.</p></li>'}</ul>
      </section>
      <div class="stack">
        <section class="panel"><header><h2>الطلبات المعلقة حسب الجهة</h2></header>
          <ul class="meters">${UNITS.map((u) => { const n = state.requests.filter((r) => r.unit === u && r.status === 'pending').length; return `<li title="${esc(u)}: ${n}"><span>${esc(u)}</span><b>${n}</b><i><em style="width:${(n / maxUnit) * 100}%"></em></i></li>`; }).join('')}</ul>
        </section>
        <section class="panel"><header><h2>آخر العمليات</h2><button class="btn link" type="button" data-go="audit">سجل التدقيق</button></header>
          <ul class="log"><li class="ok">اعتماد طلب تعديل بيانات<small>ريم خالد · قبل 28 دقيقة</small></li><li class="info">تسجيل كتاب وارد<small>سامر العلي · قبل 45 دقيقة</small></li><li class="gold">تحديث خطة دراسية<small>خالد حمود · قبل ساعة</small></li></ul>
        </section>
      </div>
    </div>`;
  }

  function filteredRequests() {
    const q = fold(state.q), { key, dir } = state.sort;
    return state.requests
      .filter((r) => state.status === 'all' || r.status === state.status)
      .filter((r) => !q || fold(`${r.no} ${r.student} ${r.sno} ${r.service} ${r.unit}`).includes(q))
      .sort((a, b) => String(a[key]).localeCompare(String(b[key]), 'ar') * dir);
  }
  function rowsHtml(list) {
    return list.map((r) => `<tr data-open="${r.no}" tabindex="0"${state.flash === r.no ? ' class="flash"' : ''}>
      <td class="hide-sm"><span class="num">${esc(r.no)}</span></td>
      <td><div class="who">${face(r.student)}<div><strong>${esc(r.student)}</strong><small class="num" style="text-align:start">${esc(r.sno)}</small></div></div></td>
      <td><div class="svc">${tile(r.service)}<span>${esc(r.service)}</span></div></td>
      <td class="hide-sm">${esc(r.unit)}</td>
      <td class="hide-sm${r.late && r.status === 'pending' ? ' late-txt' : ''}">${esc(r.age)}</td>
      <td class="side-sm">${pill(r.status)}</td></tr>`).join('');
  }
  const skeleton = () => Array.from({ length: 5 }, () => `<tr class="skel" aria-hidden="true">${'<td><i></i></td>'.repeat(6)}</tr>`).join('');
  const sortTh = (key, label) => `<th${state.sort.key === key ? ` aria-sort="${state.sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" data-sort="${key}">${label}${state.sort.key === key ? icon('sort') : ''}</button></th>`;

  function requestsPanel() {
    const counts = (s) => (s === 'all' ? state.requests.length : state.requests.filter((r) => r.status === s).length);
    return `<div class="toolbar">
      <label class="field-search">${icon('search')}<input id="q" type="search" value="${esc(state.q)}" placeholder="ابحث باسم الطالب أو رقمه أو رقم الطلب" aria-label="بحث في الطلبات"></label>
      <div class="chips" role="group" aria-label="تصفية حسب الحالة">${[['all', 'الكل'], ['pending', 'قيد الاعتماد'], ['approved', 'معتمد'], ['rejected', 'مرفوض']].map(([k, l]) => `<button class="chip" type="button" data-status="${k}" data-tone="${k}" aria-pressed="${state.status === k}">${l}<span class="chip-n">${counts(k)}</span></button>`).join('')}</div>
      <span class="tbl-note" id="tbl-note"></span>
    </div>
    <section class="panel"><table class="tbl"><thead><tr>${sortTh('no', 'رقم الطلب')}${sortTh('student', 'الطالب')}${sortTh('service', 'الخدمة')}<th>الجهة المختصة</th><th>وقت التقديم</th>${sortTh('status', 'الحالة')}</tr></thead><tbody id="tbody"></tbody></table><div id="tbl-empty"></div></section>`;
  }
  function paintRows() {
    const list = filteredRequests(), body = $('#tbody');
    if (!body) return;
    body.innerHTML = rowsHtml(list);
    $('#tbl-note').textContent = `عرض ${list.length} من ${state.requests.length}`;
    $('#tbl-empty').innerHTML = list.length ? '' : `<div class="empty"><h3>لا طلبات مطابقة</h3><p>لا يوجد طلب يطابق البحث أو الحالة المختارة. جرّب كلمة أخرى، أو امسح التصفية.</p><button class="btn" type="button" data-clear>مسح التصفية</button></div>`;
    state.flash = null;
  }
  function studentsPanel() {
    return `<div class="toolbar"><span class="tbl-note">عرض ${state.students.length} طلاب</span></div>
    <section class="panel"><table class="tbl"><thead><tr><th>الرقم الجامعي</th><th>الاسم</th><th>البرنامج</th><th>السنة الدراسية</th><th>حالة القيد</th><th></th></tr></thead><tbody>${state.students.map((s) => `<tr><td class="hide-sm"><span class="num">${esc(s[0])}</span></td><td><div class="who">${face(s[1])}<strong>${esc(s[1])}</strong></div></td><td>${esc(s[2])}</td><td class="hide-sm">${esc(s[3])}</td><td class="side-sm"><span class="status ${s[4] === 'مقيد' ? 'approved' : 'pending'}">${esc(s[4])}</span></td><td class="hide-sm"></td></tr>`).join('')}</tbody></table></section>`;
  }
  const TONE = (v) => (/معتمد|نشط|مكتمل|مرحّل|صادر|منجز|ناجح|مقيد|مقيم|على رأس|متاح|سليم|منشور|مفتوح|مقبول|متحقق|مسددة بالكامل|جاهز|متصل|منتظم|موظف$|تم/.test(v) ? 'approved' : /مرفوض|موقوف|عاجل|حرج|متأخر|منتهي|راسب|ملغى|منقطع|منخفض|إنذار|معكوس|معطَّل|مغلق/.test(v) ? 'rejected' : /مسودة/.test(v) ? 'draft' : 'pending');
  const curTab = () => ALL.find((x) => x.id === state.view).tabs[state.tab];
  const gState = { q: '', status: 'all' };
  const hasStatus = (t) => !t.noStatus;

  /* ===== جدول عام ===== */
  function tableView(t) {
    const statuses = hasStatus(t) ? [...new Set(t.rows.map((r) => r[r.length - 1]))] : [];
    return `<div class="toolbar">
      <label class="field-search">${icon('search')}<input id="gq" type="search" value="${esc(gState.q)}" placeholder="ابحث في ${esc(t.label)}" aria-label="بحث"></label>
      ${statuses.length > 1 ? `<div class="chips" role="group" aria-label="تصفية حسب الحالة"><button class="chip" type="button" data-gstatus="all" aria-pressed="${gState.status === 'all'}">الكل<span class="chip-n">${t.rows.length}</span></button>${statuses.map((st) => `<button class="chip" type="button" data-gstatus="${esc(st)}" aria-pressed="${gState.status === st}">${esc(st)}<span class="chip-n">${t.rows.filter((r) => r[r.length - 1] === st).length}</span></button>`).join('')}</div>` : ''}
      <span class="tbl-note" id="g-note"></span>
      ${t.action ? `<button class="btn pri" type="button" data-gnew>${icon('plus')}${esc(t.action)}</button>` : ''}
    </div>
    <section class="panel"><table class="tbl"><thead><tr>${t.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody id="g-body"></tbody></table><div id="g-empty"></div></section>`;
  }
  const cellHtml = (t, r, i) => {
    const v = r[i], last = i === r.length - 1;
    if (last && hasStatus(t)) return `<span class="status ${TONE(v)}">${esc(v)}</span>`;
    if (i === 0) return t.face ? `<div class="who">${face(v)}<strong>${esc(v)}</strong></div>` : `<strong${/^[A-Z0-9-]+$/.test(v) ? ' class="num"' : ''}>${esc(v)}</strong>`;
    return /^[A-Z][A-Z0-9-]*-?\d/.test(v) ? `<span class="num">${esc(v)}</span>` : esc(v);
  };
  function paintTable() {
    const t = curTab(), body = $('#g-body'); if (!body) return;
    const q = fold(gState.q);
    const list = t.rows.map((r, i) => ({ r, i })).filter(({ r }) => (gState.status === 'all' || r[r.length - 1] === gState.status) && (!q || fold(r.join(' ')).includes(q)));
    body.innerHTML = list.map(({ r, i }) => `<tr data-grow="${i}" tabindex="0"${state.flash === i ? ' class="flash"' : ''}>${r.map((_, c) => `<td class="${c === r.length - 1 && hasStatus(t) ? 'side-sm' : c > 1 ? 'hide-sm' : ''}">${cellHtml(t, r, c)}</td>`).join('')}</tr>`).join('');
    $('#g-note').textContent = `عرض ${list.length} من ${t.rows.length}`;
    $('#g-empty').innerHTML = list.length ? '' : `<div class="empty"><h3>لا نتائج مطابقة</h3><p>جرّب كلمة أخرى أو امسح التصفية.</p><button class="btn" type="button" data-gclear>مسح التصفية</button></div>`;
    state.flash = null;
  }
  function loadTable() {
    const body = $('#g-body'); if (!body) return;
    const n = curTab().cols.length;
    body.innerHTML = Array.from({ length: 4 }, () => `<tr class="skel" aria-hidden="true">${'<td><i></i></td>'.repeat(n)}</tr>`).join('');
    clearTimeout(loadTable.t);
    loadTable.t = setTimeout(paintTable, 220);
  }
  function openRow(i) {
    const t = curTab(), r = t.rows[i], d = $('#drawer'), st = hasStatus(t) ? r[r.length - 1] : null;
    const decide = st && TONE(st) === 'pending';
    d.innerHTML = `<div class="drawer-in"><div class="dlg-head brand"><div class="grow"><h2 id="dr-title">${esc(r[0])}</h2><small>${esc(t.label)}</small></div><button class="icon-btn" type="button" data-close aria-label="إغلاق">${icon('close')}</button></div>
      <div class="dlg-body">${st ? `<div><span class="status ${TONE(st)}">${esc(st)}</span></div>` : ''}<section class="sec"><h3>التفاصيل</h3><dl class="rows" style="padding:0">${t.cols.map((c, n) => (st && n === r.length - 1 ? '' : `<div><dt>${esc(c)}</dt><dd>${esc(r[n])}</dd></div>`)).join('')}</dl></section></div>
      ${decide ? `<div class="dlg-foot"><button class="btn pri" type="button" data-gdecide="${i}" data-to="معتمد">${icon('check')}اعتماد</button><button class="btn danger" type="button" data-gdecide="${i}" data-to="مرفوض">رفض</button></div>` : ''}</div>`;
    if (!d.open) openDlg(d);
  }
  function decideRow(i, to) {
    const t = curTab(), r = t.rows[i], before = r[r.length - 1];
    r[r.length - 1] = to; state.flash = i;
    closeDlg($('#drawer')); paintGeneric();
    toast(`${to}: ${r[0]}`, () => { r[r.length - 1] = before; state.flash = i; paintGeneric(); });
  }
  const paintGeneric = () => { $('#tab-body').innerHTML = tabBody(); paintTable(); };
  function openRowForm() {
    const t = curTab(), d = $('#sheet'), cols = hasStatus(t) ? t.cols.slice(0, -1) : t.cols;
    d.innerHTML = `<form class="form" id="g-form" novalidate><div class="dlg-head brand"><div class="grow"><h2 id="sh-title">${esc(t.action)}</h2><small>${esc(t.label)}</small></div><button class="icon-btn" type="button" data-close aria-label="إغلاق">${icon('close')}</button></div>
      <div class="dlg-body"><section class="sec"><h3>التفاصيل</h3><div class="form-grid">${cols.map((c, i) => `<label class="${i === 0 && cols.length % 2 ? 'wide' : ''}">${esc(c)}${i === 0 ? ' <span class="req">*</span>' : ''}<input data-col="${i}"${i === 0 ? ' required' : ''}><span class="err"></span></label>`).join('')}</div></section>
      ${t.justify ? '<section class="sec"><h3>التبرير</h3><label>السبب<textarea></textarea></label></section>' : ''}</div>
      <div class="dlg-foot"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-close>إلغاء</button></div></form>`;
    openDlg(d); $('input', d).focus();
  }
  function saveRow(form) {
    const t = curTab(), first = $('input[required]', form);
    if (!first.value.trim()) { first.closest('label').classList.add('bad'); $('.err', first.closest('label')).textContent = 'هذا الحقل مطلوب.'; first.focus(); return; }
    const vals = $$('input[data-col]', form).map((i) => i.value.trim() || '—');
    t.rows.unshift(hasStatus(t) ? [...vals, 'قيد الاعتماد'] : vals);
    state.flash = 0; gState.status = 'all'; gState.q = '';
    closeDlg($('#sheet')); paintGeneric();
    toast('أُضيف السجل في هذه الصفحة فقط');
  }

  /* ===== بقية القوالب ===== */
  const fieldHtml = (x, i) => {
    const id = `ff${i}`, wide = x.type === 'textarea' ? ' class="wide"' : '', req = x.req !== false;
    const ctl = x.type === 'select' ? `<select id="${id}"${req ? ' required' : ''}><option value="">اختر</option>${x.opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : x.type === 'textarea' ? `<textarea id="${id}"${req ? ' required' : ''}></textarea>` : `<input id="${id}" type="${x.type}"${req ? ' required' : ''}>`;
    return `<label${wide}>${esc(x.l)}${req ? ' <span class="req">*</span>' : ''}${ctl}<span class="err"></span></label>`;
  };
  function formView(t) {
    let n = 0;
    return `<form class="form panel page-form" id="k-form" novalidate><div class="dlg-body">
      ${t.flow ? `<section class="sec"><h3>حالة الاعتماد</h3><ol class="flow">${t.flow.map((x, i) => `<li class="${i ? '' : 'cur'}">${esc(x)}</li>`).join('')}</ol></section>` : ''}
      ${t.sections.map((sec) => `<section class="sec"><h3>${esc(sec.title)}</h3><div class="form-grid">${sec.fields.map((x) => fieldHtml(x, n++)).join('')}</div></section>`).join('')}
      ${t.justify ? '<section class="sec"><h3>التبرير</h3><label>سبب الطلب <span class="req">*</span><textarea required></textarea><span class="err"></span></label></section>' : ''}
    </div><div class="dlg-foot"><button class="btn pri" type="submit">${esc(t.submit || 'حفظ')}</button><button class="btn" type="reset">مسح الحقول</button></div></form>`;
  }
  function submitKit(form) {
    let bad = null;
    $$('[required]', form).forEach((el) => { const miss = !el.value.trim(), l = el.closest('label'); l.classList.toggle('bad', miss); $('.err', l).textContent = miss ? 'هذا الحقل مطلوب.' : ''; if (miss && !bad) bad = el; });
    if (bad) { bad.focus(); return; }
    form.reset(); toast('تم الإجراء في هذه الصفحة فقط؛ النموذج لا يكتب في قاعدة البيانات');
  }
  const overviewView = (t) => `<section class="band" aria-label="ملخص">${t.stats.map(([l, v]) => `<div class="cell"><small>${esc(l)}</small><strong>${esc(v)}</strong></div>`).join('')}</section>
    <section class="panel"><header><h2>${esc(t.listTitle || 'التفاصيل')}</h2></header><dl class="rows">${t.list.map(([a, b, c]) => `<div><dt><b>${esc(a)}</b> · ${esc(b)}</dt><dd class="num">${esc(c)}</dd></div>`).join('')}</dl></section>`;
  const settingsView = (t) => t.groups.map((g) => `<section class="panel"><header><h2>${esc(g.title)}</h2></header><div class="set-list">${g.items.map(([l, type, v]) => `<div class="set-row"><span>${esc(l)}</span>${type === 'switch' ? `<label class="switch"><input type="checkbox" aria-label="${esc(l)}"${v ? ' checked' : ''}><i></i></label>` : type === 'list' ? `<div class="tags">${v.map((o) => `<span class="tag">${esc(o)}<button type="button" data-tagdel aria-label="حذف ${esc(o)}">${icon('x')}</button></span>`).join('')}<input class="tag-add" placeholder="إضافة خيار" aria-label="إضافة خيار إلى ${esc(l)}"></div>` : `<input class="set-input" value="${esc(v)}" aria-label="${esc(l)}">`}</div>`).join('')}</div></section>`).join('');
  const treeHtml = (nodes) => `<ul class="tree">${nodes.map(([n, kids]) => `<li>${kids ? `<details open><summary>${esc(n)}</summary>${treeHtml(kids)}</details>` : `<span class="leaf">${esc(n)}</span>`}</li>`).join('')}</ul>`;
  const matrixView = (t) => `<section class="panel"><div class="scroll-x"><table class="tbl matrix"><thead><tr><th>الصلاحية</th>${t.roles.map((r) => `<th>${esc(r)}</th>`).join('')}</tr></thead><tbody>${t.perms.map(([p, ...v]) => `<tr><td><strong>${esc(p)}</strong></td>${v.map((x, i) => `<td><label class="check"><input type="checkbox"${x ? ' checked' : ''} aria-label="${esc(p)}: ${esc(t.roles[i])}"><i>${icon('check')}</i></label></td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  const gpaRows = [['CS-401', 3, 78], ['CS-302', 4, 61], ['LAW-203', 3, 85]];
  const gpaView = () => `<section class="panel"><header><h2>حاسبة المعدل المتوقع</h2></header><div class="dlg-body form" id="gpa">${gpaRows.map(([c, h, m]) => `<div class="form-grid gpa-row"><label>المقرر<input value="${c}"></label><label>الساعات<input data-h type="number" min="1" max="6" value="${h}"></label><label>العلامة المتوقعة<input data-m type="number" min="0" max="100" value="${m}"></label></div>`).join('')}<p class="gpa-out">المعدل المتوقع <strong id="gpa-v"></strong></p></div></section>`;
  function paintGpa() { let a = 0, b = 0; $$('.gpa-row').forEach((r) => { const h = Number($('[data-h]', r).value) || 0, m = Number($('[data-m]', r).value) || 0; a += h * m; b += h; }); const v = $('#gpa-v'); if (v) v.textContent = b ? `${(a / b).toFixed(1)}%` : '—'; }
  const cardView = () => `<div class="columns"><section class="panel"><header><h2>تصدير البطاقات دفعة واحدة</h2></header><div class="dlg-body form"><div class="form-grid"><label>الكلية / المعهد<select><option>الكل</option><option>الأمن السيبراني</option><option>القانون</option></select></label><label>السنة الدراسية<select><option>كل السنوات</option><option>الأولى</option><option>الثانية</option></select></label></div><p class="hint">5 طلاب مطابقون</p></div><table class="tbl"><thead><tr><th>الطالب</th><th>الدفعة</th><th>الاستلام</th></tr></thead><tbody>${state.students.slice(0, 4).map((x, i) => `<tr><td><div class="who">${face(x[1])}<div><strong>${esc(x[1])}</strong><small class="num" style="text-align:start">${esc(x[0])}</small></div></div></td><td class="hide-sm">2026 / 1</td><td class="side-sm"><span class="status ${i % 2 ? 'pending' : 'approved'}">${i % 2 ? 'لم تُستلم' : 'مستلمة'}</span></td></tr>`).join('')}</tbody></table><div class="dlg-foot"><button class="btn pri" type="button" data-toast="جهّزنا البطاقات للطباعة في هذه الصفحة فقط">تصدير كل البطاقات</button><button class="btn" type="button" data-toast="حُفظت الدفعة في هذه الصفحة فقط">حفظها دفعة</button></div></section>
    <section class="id-card" aria-label="معاينة البطاقة"><div class="id-top"><img src="../uni-erp/public/brand/crest.svg" alt="" width="36" height="42"><div><strong>الجامعة السورية للعلوم الأمنية</strong><small>البطاقة الجامعية</small></div></div><div class="id-name">${esc(state.students[0][1])}</div><div class="id-no num">${esc(state.students[0][0])}</div><div class="id-meta"><span>${esc(state.students[0][2])}</span><span>${esc(state.students[0][3])}</span></div></section></div>`;
  const queueView = () => `<section class="band"><div class="cell"><small>في الانتظار</small><strong>7</strong></div><div class="cell"><small>التذكرة الحالية</small><strong class="num">A-042</strong></div><div class="cell"><small>متوسط الانتظار</small><strong>6 د</strong></div><div class="cell"><button class="btn gold" type="button" data-next>استدعاء التالي</button></div></section><section class="panel"><table class="tbl"><thead><tr><th>التذكرة</th><th>الخدمة</th><th>النافذة</th><th>الحالة</th></tr></thead><tbody id="q-body">${[['A-043', 'مصدقة', '2'], ['A-044', 'كشف علامات', '1'], ['A-045', 'بطاقة بديلة', '3']].map((r) => `<tr><td><strong class="num">${r[0]}</strong></td><td>${r[1]}</td><td class="hide-sm">${r[2]}</td><td class="side-sm"><span class="status pending">في الانتظار</span></td></tr>`).join('')}</tbody></table></section>`;
  const scanView = () => `<section class="panel"><header><h2>مسح بطاقة</h2></header><form class="dlg-body form" id="scan-form"><div class="form-grid"><label>القاعة<select><option>المدرج الكبير A1</option><option>قاعة المحاضرات B2</option><option>مخبر الأمن السيبراني C1</option></select></label><label>الرقم الجامعي أو الباركود<input id="scan-in" placeholder="امسح أو اكتب ثم Enter"></label></div></form><ul class="log" id="scan-log" style="padding-top:0"></ul></section>`;
  const importView = () => `<section class="panel"><header><h2>استيراد ملف</h2></header><div class="dlg-body form"><ol class="flow"><li class="cur">اختيار النوع والملف</li><li>الفحص والمعاينة</li><li>الحفظ</li></ol><div class="form-grid"><label>نوع البيانات<select><option>الموردون</option><option>المقررات</option><option>الموظفون</option><option>سجل الطلاب</option></select></label><label>الملف (xlsx أو csv أو sql)<input type="file" accept=".xlsx,.csv,.sql"></label></div><p class="hint">لا يُكتب شيء قبل الضغط على حفظ بعد المعاينة، ويمكن الإلغاء في أي خطوة.</p></div><div class="dlg-foot"><button class="btn pri" type="button" data-toast="الفحص الفعلي في الموقع؛ هنا شكل الشاشة فقط">فحص الملف</button></div></section>`;
  const verifyView = () => `<section class="panel"><header><h2>التحقق من وثيقة</h2></header><form class="dlg-body form" id="verify-form"><div class="form-grid"><label class="wide">رمز التحقق<input id="ver-in" class="num" placeholder="أدخل الرمز المطبوع على الوثيقة"></label></div><p class="hint" id="ver-out">ستظهر النتيجة هنا.</p></form></section>`;

  function moduleView() {
    const it = ALL.find((x) => x.id === state.view);
    const showNew = it.id === 'affairs';
    return `${it.id === 'dashboard' ? '' : `<div class="head"><div><h1>${esc(it.label)}</h1><p>${esc(it.desc || '')}</p></div>${showNew ? `<div class="head-actions"><button class="btn pri" type="button" data-new>${icon('plus')}طلب جديد</button></div>` : ''}</div>`}
    <div class="tabs-bar"><div class="tabs" role="tablist" id="tabs">${it.tabs.map((t, i) => `<button type="button" role="tab" data-tabbtn="${i}" aria-selected="${state.tab === i}" tabindex="${state.tab === i ? 0 : -1}">${esc(t.label)}${it.id === 'affairs' && i === 0 && pendingCount() ? `<b>${pendingCount()}</b>` : ''}</button>`).join('')}<span class="tab-marker" id="tab-marker"></span></div></div>
    <div id="tab-body">${tabBody()}</div>`;
  }
  function tabBody() {
    const t = curTab(), pad = (h) => `<div class="tab-pad">${h}</div>`;
    switch (t.kind) {
      case 'dashboard': return pad(dashboardView());
      case 'requests': return requestsPanel();
      case 'students': return studentsPanel();
      case 'table': return tableView(t);
      case 'form': return pad(formView(t));
      case 'overview': return pad(overviewView(t));
      case 'settings': return pad(settingsView(t));
      case 'steps': return pad(`<section class="panel"><header><h2>${esc(t.label)}</h2></header><div class="dlg-body">${stepsHtml(t.steps)}</div></section>`);
      case 'tree': return pad(`<section class="panel"><header><h2>${esc(t.label)}</h2></header><div class="dlg-body">${treeHtml(t.tree)}</div></section>`);
      case 'matrix': return pad(matrixView(t));
      case 'gpa': return pad(gpaView());
      case 'card': return pad(cardView());
      case 'queue': return pad(queueView());
      case 'scan': return pad(scanView());
      case 'import': return pad(importView());
      case 'verify': return pad(verifyView());
      default: return '';
    }
  }
  function afterBody() {
    const t = curTab();
    if (t.kind === 'requests') loadRows();
    if (t.kind === 'table') { gState.q = ''; gState.status = 'all'; loadTable(); }
    if (t.kind === 'gpa') paintGpa();
  }
  function placeTabMarker(animate = true) {
    const m = $('#tab-marker'), b = $('#tabs [aria-selected="true"]');
    if (!m || !b) return;
    if (!animate) m.style.transition = 'none';
    m.style.transform = `translateX(${b.offsetLeft}px) scaleX(${b.offsetWidth})`;
    if (!animate) { m.getBoundingClientRect(); m.style.transition = ''; }
  }
  function renderMain() {
    $('#main').innerHTML = moduleView();
    placeTabMarker(false); afterBody();
  }
  /* هيكل مؤقت بدل دوّار وسط الصفحة، والمدة هنا تمثيل لزمن تحميل حقيقي */
  function loadRows() {
    const body = $('#tbody'); if (!body) return;
    body.innerHTML = skeleton();
    $('#tbl-note').textContent = 'جارٍ التحميل…';
    clearTimeout(loadRows.t);
    loadRows.t = setTimeout(paintRows, 260);
  }
  const transition = (fn) => {
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion:reduce)').matches) document.startViewTransition(fn); else fn();
  };
  function go(view, tab = 0, filter) {
    const same = state.view === view;
    state.view = view; state.tab = tab;
    if (filter) state.status = filter;
    closeNavMobile();
    if (same) { renderNav(); selectTab(tab); return; }
    transition(() => {
      renderNav(); placeNavMarker(true); renderCrumbs(); renderMain(); window.scrollTo(0, 0);
    });
  }
  /* تبديل التبويب لا يعيد رسم الصفحة ولا يحرّك موضع التمرير */
  function selectTab(i) {
    state.tab = i;
    $$('#tabs [role="tab"]').forEach((b, n) => { b.setAttribute('aria-selected', n === i); b.tabIndex = n === i ? 0 : -1; });
    const active = $(`#tabs [data-tabbtn="${i}"]`); if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    placeTabMarker();
    gState.q = ''; gState.status = 'all';
    $('#tab-body').innerHTML = tabBody();
    afterBody();
    $$('.sub button').forEach((b) => (Number(b.dataset.tab) === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    renderCrumbs();
  }

  /* ===== فتح وإغلاق النوافذ بحركة خروج ===== */
  let opener = null;
  function openDlg(d) { opener = document.activeElement; d.classList.remove('closing'); d.showModal(); }
  function closeDlg(d) {
    if (!d.open || d.classList.contains('closing')) return;
    d.classList.add('closing');
    const done = () => { d.classList.remove('closing'); d.close(); if (opener && opener.isConnected) opener.focus(); };
    const ms = matchMedia('(prefers-reduced-motion:reduce)').matches ? 0 : 170;
    setTimeout(done, ms);
  }
  $$('dialog').forEach((d) => {
    d.addEventListener('cancel', (e) => { e.preventDefault(); closeDlg(d); });
    d.addEventListener('mousedown', (e) => { if (e.target === d) closeDlg(d); });
  });

  /* ===== تفاصيل الطلب في درج جانبي يبقي الجدول ظاهراً ===== */
  function stepsOf(r) {
    const s = [['تقديم الطلب', 'مكتمل', 'done'], ['الفحص الآلي', 'اجتاز القواعد المطبقة', 'done']];
    if (r.status === 'pending') s.push([r.unit, 'بانتظار القرار', 'cur'], ['إصدار النتيجة', 'بعد الاعتماد', '']);
    else if (r.status === 'approved') s.push([r.unit, 'اعتُمد', 'done'], ['إصدار النتيجة', 'أُرسلت للطالب', 'done']);
    else if (r.status === 'rejected') s.push([r.unit, r.reason ? `رُفض: ${r.reason}` : 'رُفض', 'fail']);
    else s.length = 0;
    return s;
  }
  const stepsHtml = (s) => `<ol class="steps">${s.map(([t, sub, c], i) => `<li class="${c}"><span class="mark">${c === 'done' ? icon('check') : c === 'fail' ? icon('x') : i + 1}</span><div><strong>${esc(t)}</strong><small>${esc(sub)}</small></div></li>`).join('')}</ol>`;
  function openDrawer(no) {
    const r = state.requests.find((x) => x.no === no); if (!r) return;
    const d = $('#drawer');
    d.innerHTML = `<div class="drawer-in">
      <div class="dlg-head brand">${tile(r.service)}<div class="grow"><h2 id="dr-title">${esc(r.service)}</h2><small><span class="num">${esc(r.no)}</span> · ${esc(r.age)}</small></div><button class="icon-btn" type="button" data-close aria-label="إغلاق">${icon('close')}</button></div>
      <div class="dlg-body">
        <div>${pill(r.status)}</div>
        <section class="sec"><h3>تفاصيل الطلب</h3><div class="who big">${face(r.student)}<div><strong>${esc(r.student)}</strong><small class="num" style="text-align:start">${esc(r.sno)}</small></div></div><dl class="rows" style="padding:0"><div><dt>الجهة المختصة</dt><dd>${esc(r.unit)}</dd></div></dl></section>
        ${r.justification ? `<section class="sec"><h3>التبرير</h3><p style="font-size:14px">${esc(r.justification)}</p></section>` : ''}
        ${stepsOf(r).length ? `<section class="sec"><h3>حالة الاعتماد</h3>${stepsHtml(stepsOf(r))}</section>` : ''}
        ${r.status === 'pending' ? `<section class="sec form" id="reject-box" hidden><label>سبب الرفض <span class="req">*</span><textarea id="reject-reason" maxlength="300" aria-describedby="reject-err"></textarea><span class="err" id="reject-err"></span></label></section>` : ''}
      </div>
      ${r.status === 'pending' ? `<div class="dlg-foot"><button class="btn pri" type="button" data-approve="${r.no}">${icon('check')}اعتماد</button><button class="btn danger" type="button" data-reject="${r.no}">رفض</button></div>` : ''}
    </div>`;
    if (!d.open) openDlg(d);
  }
  function setStatus(no, status, reason) {
    const r = state.requests.find((x) => x.no === no), before = { status: r.status, reason: r.reason };
    r.status = status; r.reason = reason ?? r.reason; state.flash = no;
    closeDlg($('#drawer'));
    refreshCounts();
    toast(status === 'approved' ? `اعتُمد الطلب ${no}` : `رُفض الطلب ${no}`, () => { Object.assign(r, before); state.flash = no; refreshCounts(); toast(`أُعيد الطلب ${no} إلى قيد الاعتماد`); });
  }
  function refreshCounts() {
    renderNav();
    if (state.view === 'dashboard' && state.tab === 0) $('#tab-body').innerHTML = tabBody();
    if (state.view === 'affairs') {
      $('#tabs [data-tabbtn="0"]').innerHTML = `الطلبات${pendingCount() ? `<b>${pendingCount()}</b>` : ''}`;
      placeTabMarker(false);
      if (curTab().kind === 'requests') { $('#tab-body').innerHTML = requestsPanel(); paintRows(); }
    }
  }

  /* ===== طلب جديد بالقالب الموحد ===== */
  function openForm() {
    const d = $('#sheet');
    d.innerHTML = `<form class="form" id="req-form" novalidate>
      <div class="dlg-head brand"><div class="grow"><h2 id="sh-title">طلب جديد</h2><small>لا يُحفظ شيء قبل الضغط على إرسال أو حفظ كمسودة.</small></div><button class="icon-btn" type="button" data-close aria-label="إغلاق">${icon('close')}</button></div>
      <div class="dlg-body">
        <section class="sec"><h3>حالة الاعتماد</h3><ol class="flow"><li class="cur">تقديم الطلب</li><li>الجهة المختصة</li><li>القرار</li></ol></section>
        <section class="sec"><h3>تفاصيل الطلب</h3><div class="form-grid">
          <label class="wide" data-f="student">الطالب <span class="req">*</span><input id="f-student" list="f-students" autocomplete="off" placeholder="اكتب الاسم أو الرقم الجامعي" required aria-describedby="e-student"><datalist id="f-students">${state.students.map((s) => `<option value="${esc(s[1])}" label="${esc(s[0])}"></option>`).join('')}</datalist><span class="err" id="e-student"></span></label>
          <label data-f="service">الخدمة <span class="req">*</span><select id="f-service" required aria-describedby="e-service"><option value="">اختر الخدمة</option>${SERVICES.map((s) => `<option>${esc(s)}</option>`).join('')}</select><span class="err" id="e-service"></span></label>
          <label>الجهة المختصة<select id="f-unit">${UNITS.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
        </div></section>
        <section class="sec"><h3>التبرير</h3><label data-f="just">سبب الطلب <span class="req">*</span><textarea id="f-just" maxlength="500" required aria-describedby="e-just"></textarea><span class="err" id="e-just"></span></label></section>
      </div>
      <div class="dlg-foot"><button class="btn pri" type="submit">إرسال للاعتماد</button><button class="btn" type="button" id="f-draft">حفظ كمسودة</button><button class="btn" type="button" data-close>إلغاء</button></div>
    </form>`;
    openDlg(d);
    $('#f-student').focus();
  }
  const MSG = { student: 'اختر الطالب حتى نعرف صاحب الطلب.', service: 'اختر الخدمة المطلوبة.', just: 'اكتب سبب الطلب؛ تقرأه الجهة المختصة قبل القرار.' };
  function validate() {
    let first = null;
    for (const k of ['student', 'service', 'just']) {
      const inp = $(`#f-${k}`), bad = !inp.value.trim(), wrap = inp.closest('label');
      wrap.classList.toggle('bad', bad);
      inp.setAttribute('aria-invalid', bad);
      $(`#e-${k}`).textContent = bad ? MSG[k] : '';
      if (bad && !first) first = inp;
    }
    if (first) first.focus();
    return !first;
  }
  function saveRequest(status) {
    const name = $('#f-student').value.trim(), s = state.students.find((x) => x[1] === name || x[0] === name);
    const no = `REQ-${1048 + state.requests.filter((r) => r.fresh).length + 1}`;
    state.requests.unshift({ no, student: s ? s[1] : name, sno: s ? s[0] : '—', service: $('#f-service').value || 'بلا خدمة', unit: $('#f-unit').value, age: 'الآن', late: false, status, justification: $('#f-just').value.trim(), fresh: true, reason: '' });
    state.flash = no;
    closeDlg($('#sheet'));
    state.status = 'all'; state.q = '';
    if (state.view === 'affairs' && state.tab === 0) refreshCounts(); else go('affairs', 0);
    toast(status === 'draft' ? `حُفظ ${no} كمسودة` : `أُرسل ${no} للاعتماد`);
  }

  /* ===== البحث الشامل ===== */
  const COMMANDS = () => [
    ...ALL.map((it) => ({ type: 'الشاشات', label: it.label, hint: '', icon: it.icon, run: () => go(it.id) })),
    ...ALL.flatMap((it) => (it.tabs || []).map((t, i) => ({ type: 'التبويبات', label: t.label, hint: it.label, icon: it.icon, run: () => go(it.id, i) }))),
    { type: 'إجراءات', label: 'طلب جديد', hint: 'نموذج', icon: 'plus', run: openForm },
    ...state.requests.map((r) => ({ type: 'الطلبات', label: `${r.no} · ${r.student}`, hint: r.service, icon: 'students', run: () => openDrawer(r.no) })),
  ];
  let palIndex = 0, palItems = [];
  function paintPalette(q) {
    const n = fold(q), all = COMMANDS().filter((c) => !n || fold(`${c.label} ${c.hint}`).includes(n)).slice(0, n ? 30 : 12);
    palItems = all; palIndex = 0;
    let last = '', html = '';
    all.forEach((c, i) => {
      if (c.type !== last) { html += `<li><h3>${esc(c.type)}</h3></li>`; last = c.type; }
      html += `<li><button type="button" data-pal="${i}" class="${i === 0 ? 'on' : ''}"><span class="tile teal">${icon(c.icon)}</span><span>${esc(c.label)}</span>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button></li>`;
    });
    $('#pal-list').innerHTML = html || `<li class="pal-empty">لا نتائج. جرّب «الطلبات» أو اسم طالب.</li>`;
  }
  function openPalette() {
    const d = $('#palette');
    d.innerHTML = `<div class="pal-in"><label class="pal-input">${icon('search')}<input id="pal-q" placeholder="اكتب اسم شاشة أو طالب أو إجراء" aria-label="بحث" autocomplete="off"><kbd>Esc</kbd></label><ul class="pal-list" id="pal-list"></ul></div>`;
    openDlg(d); paintPalette(''); $('#pal-q').focus();
  }
  function runPal(i) { const c = palItems[i]; if (!c) return; const d = $('#palette'); d.close(); c.run(); }

  /* ===== الإشعار مع إمكانية التراجع ===== */
  function toast(msg, undo) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="toast-ic">${icon('check')}</span><span>${esc(msg)}</span>${undo ? '<button class="btn link" type="button">تراجع</button>' : ''}`;
    const host = document.querySelector('dialog[open]') || $('#toasts');
    (host === $('#toasts') ? host : $('#toasts')).appendChild(t);
    if (undo) $('button', t).addEventListener('click', () => { t.remove(); undo(); });
    setTimeout(() => t.remove(), undo ? 6000 : 3200);
  }

  /* ===== الأحداث ===== */
  const closeNavMobile = () => $('#shell').classList.remove('nav-open');
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button,[data-open],[data-grow]');
    if (!e.target.closest('.pop-wrap')) hideBell();
    if (!t) return;
    const d = t.dataset;
    if (t.id === 'bell') return toggleBell();
    if (d.go) return go(d.go, Number(d.tab || 0), d.filter);
    if (d.tabbtn !== undefined) return selectTab(Number(d.tabbtn));
    if (d.open) return openDrawer(d.open);
    if (d.new !== undefined) return openForm();
    if (d.close !== undefined) return closeDlg(t.closest('dialog'));
    if (d.approve) return setStatus(d.approve, 'approved');
    if (d.reject) {
      const box = $('#reject-box'), area = $('#reject-reason');
      if (box.hidden) { box.hidden = false; area.focus(); return; }
      if (!area.value.trim()) { $('#reject-err').textContent = 'اكتب سبب الرفض؛ يظهر للطالب في طلبه.'; box.classList.add('bad'); area.focus(); return; }
      return setStatus(d.reject, 'rejected', area.value.trim());
    }
    if (d.status) { state.status = d.status; $$('.chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.status === d.status)); return loadRows(); }
    if (d.sort) { const s = state.sort; state.sort = { key: d.sort, dir: s.key === d.sort ? -s.dir : 1 }; $('#tab-body').innerHTML = requestsPanel(); return paintRows(); }
    if (d.clear !== undefined) { state.q = ''; state.status = 'all'; $('#tab-body').innerHTML = requestsPanel(); return paintRows(); }
    if (d.pal !== undefined) return runPal(Number(d.pal));
    if (d.grow !== undefined) return openRow(Number(d.grow));
    if (d.gnew !== undefined) return openRowForm();
    if (d.gdecide !== undefined) return decideRow(Number(d.gdecide), d.to);
    if (d.gstatus) { gState.status = d.gstatus; $$('[data-gstatus]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.gstatus === d.gstatus)); return loadTable(); }
    if (d.gclear !== undefined) { gState.q = ''; gState.status = 'all'; return paintGeneric(); }
    if (d.toast) return toast(d.toast);
    if (d.tagdel !== undefined) return t.closest('.tag').remove();
    if (d.next !== undefined) { const row = $('#q-body tr'); if (row) { toast(`استدعاء ${$('strong', row).textContent}`); row.remove(); } else toast('لا أحد في الانتظار'); return undefined; }
    if (t.id === 'f-draft') { if (!$('#f-student').value.trim()) { validate(); return; } return saveRequest('draft'); }
    return undefined;
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'g-form') { e.preventDefault(); return saveRow(e.target); }
    if (e.target.id === 'k-form') { e.preventDefault(); return submitKit(e.target); }
    if (e.target.id === 'scan-form') { e.preventDefault(); const i = $('#scan-in'), v = i.value.trim(); if (v) { const s0 = state.students.find((x) => x[0] === v || x[1].includes(v)); const li = document.createElement('li'); li.className = s0 ? 'ok' : 'fail'; li.innerHTML = `${esc(s0 ? s0[1] : v)}<small>${s0 ? 'سُجّل الدخول الآن' : 'لا يوجد طالب بهذا الرقم'}</small>`; $('#scan-log').prepend(li); i.value = ''; } return undefined; }
    if (e.target.id === 'verify-form') { e.preventDefault(); const v = $('#ver-in').value.trim(); $('#ver-out').textContent = v ? 'في الموقع الفعلي يُقارن الرمز بالتوقيع الرقمي للوثيقة؛ هذا النموذج لا يتحقق.' : 'أدخل الرمز أولاً.'; return undefined; }
    if (e.target.id !== 'req-form') return undefined;
    e.preventDefault();
    if (validate()) saveRequest('pending');
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') { state.q = e.target.value; paintRows(); }
    if (e.target.id === 'gq') { gState.q = e.target.value; paintTable(); }
    if (e.target.closest('#gpa')) paintGpa();
    if (e.target.id === 'pal-q') paintPalette(e.target.value);
    if (e.target.closest('#req-form') && e.target.closest('label.bad') && e.target.value.trim()) { const l = e.target.closest('label'); l.classList.remove('bad'); $('.err', l).textContent = ''; e.target.removeAttribute('aria-invalid'); }
  });
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && k === 'k') { e.preventDefault(); if (!$('#palette').open) openPalette(); return; }
    if (ctrl && k === 'b') { e.preventDefault(); toggleFold(); return; }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-open]')) openDrawer(e.target.dataset.open);
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-grow]')) openRow(Number(e.target.dataset.grow));
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('tag-add') && e.target.value.trim()) { e.preventDefault(); const sp = document.createElement('span'); sp.className = 'tag'; sp.innerHTML = `${esc(e.target.value.trim())}<button type="button" data-tagdel aria-label="حذف">${icon('x')}</button>`; e.target.before(sp); e.target.value = ''; }
    if (e.target.id === 'pal-q') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!palItems.length) return;
        palIndex = (palIndex + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % palItems.length;
        $$('[data-pal]').forEach((b) => b.classList.toggle('on', Number(b.dataset.pal) === palIndex));
        $(`[data-pal="${palIndex}"]`).scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter') { e.preventDefault(); runPal(palIndex); }
    }
    if (e.target.matches && e.target.matches('#tabs [role="tab"]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const n = $$('#tabs [role="tab"]').length, next = (state.tab + (e.key === 'ArrowLeft' ? 1 : -1) + n) % n;
      selectTab(next); $(`#tabs [data-tabbtn="${next}"]`).focus();
    }
  });

  function toggleBell() {
    const p = $('#bell-pop'), b = $('#bell');
    if (!p.hidden) return hideBell();
    p.innerHTML = `<h3>الإشعارات</h3><button type="button" data-go="affairs" data-tab="0" data-filter="pending">${state.requests.filter((r) => r.late && r.status === 'pending').length} طلبات تجاوزت المهلة<small>شؤون الطلاب</small></button><button type="button" data-go="corr">5 مراسلات تنتظر التوقيع<small>الديوان</small></button>`;
    p.hidden = false; b.setAttribute('aria-expanded', 'true');
    return undefined;
  }
  function hideBell() { const p = $('#bell-pop'); if (p.hidden) return; p.hidden = true; $('#bell').setAttribute('aria-expanded', 'false'); }

  function toggleFold() { const on = $('#shell').classList.toggle('folded'); store.set('proto-folded', on ? '1' : ''); $('#fold span').textContent = on ? 'توسيع القائمة' : 'طي القائمة'; setTimeout(() => placeNavMarker(false), 260); }
  $('#fold').addEventListener('click', toggleFold);
  $('#menu').addEventListener('click', () => $('#shell').classList.add('nav-open'));
  $('#scrim').addEventListener('click', closeNavMobile);
  $('#search').addEventListener('click', openPalette);
  $('#theme').addEventListener('click', () => {
    const root = document.documentElement, dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark'; store.set('proto-theme', root.dataset.theme);
  });
  window.addEventListener('resize', () => { placeTabMarker(false); placeNavMarker(false); });
  window.addEventListener('scroll', () => $('.top').classList.toggle('scrolled', window.scrollY > 4), { passive: true });

  if (store.get('proto-folded') === '1') { $('#shell').classList.add('folded'); $('#fold span').textContent = 'توسيع القائمة'; }
  renderNav(); renderCrumbs(); renderMain();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeTabMarker(false); placeNavMarker(false); });
})();
