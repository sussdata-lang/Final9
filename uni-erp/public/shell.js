/* الهيكل الجديد للعاملين: شريط جانبي أخضر داكن، شريط علوي (مسار، بحث، إشعارات، ملف المستخدم)،
   ولوحة التحكم الرئيسية ببطاقات إحصائية ومخططات وجدول أحدث الطلبات وإجراءات سريعة.
   التصميم مستمد من ملف Figma «تعديل تصميم الموقع»؛ والبيانات حقيقية من الخادم (لا أرقام ثابتة). */
(function () {
  const UA = window.UA, { S, api, esc, can } = UA;
  const X = { data: null };
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); X.data = null; };

  /* ---------- أيقونات التصميم ---------- */
  const ICO = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4H8v16a2 2 0 0 1-4 0V6H2v14a2 2 0 0 0 2 2Z"/><path d="M12 8h6M12 12h6M12 16h6M8 8v8"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M20 15v5H4v-5"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M20 15v5H4v-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9c.12.6.65 1.03 1.26 1.03H21v4h-.34c-.61 0-1.14.43-1.26 1Z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    arrow: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    cap: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    layers: '<path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
    out: '<path d="M15 4.5h4.5v15H15"/><path d="M10.5 8l-4 4 4 4M6.5 12h10"/>',
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 11h6M9 15h6"/>',
    library: '<path d="M4 19V5M9 19V5M14 19V5M19 19V5M2 21h20M2 3h20"/>',
    research: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
    graduation: '<path d="m2 10 10-5 10 5-10 5L2 10Z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>',
    quality: '<path d="M12 2 9.5 8H3l5 4-2 7 6-4 6 4-2-7 5-4h-6.5L12 2Z"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6"/><path d="M16 13h4"/>',
    box: '<path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    exchange: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    spark: '<path d="m12 3 1.5 4.5L18 9l-4.500 1.500L12 15l-1.500-4.500L6 9l4.500-1.500L12 3Z"/>',
    audit: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5M8 17h7"/>',
    guide: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M8 7h8M8 11h6"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  };
  const ico = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n] || ''}</svg>`;
  const NAV_ICON = { desk: 'home', overview: 'home', enterprise: 'layers', home: 'home', guide: 'guide', grades: 'bars', fees: 'wallet', tx: 'file', affairs: 'users', student_life: 'layers', labtools: 'layers', dashboard: 'bars', academics: 'book', comms: 'news', exchange: 'exchange', internal: 'file', corr: 'mail', hr: 'briefcase', payroll: 'briefcase', procurement: 'box', finance: 'wallet', settings: 'settings', units: 'layers', import: 'upload', export: 'download', attendance: 'calendar', admin: 'settings', access: 'shield', audit: 'audit', verify: 'check', lms: 'library', research: 'research', alumni: 'graduation', qa: 'quality', expansions: 'clipboard', devops: 'settings', ai: 'spark', guidelines: 'guide' };
  const PARENT = { site: 'admin', services: 'admin' };
  /* مجموعات القائمة الجانبية وترتيبها */
  const NAV_GROUP = {
    overview: 'الرئيسية', desk: 'الرئيسية',
    affairs: 'الشؤون الطلابية', student_life: 'الشؤون الطلابية',
    academics: 'الشؤون الأكاديمية', attendance: 'الشؤون الأكاديمية', expansions: 'الشؤون الأكاديمية', lms: 'الشؤون الأكاديمية', research: 'الشؤون الأكاديمية', alumni: 'الشؤون الأكاديمية', qa: 'الشؤون الأكاديمية',
    payroll: 'الإدارة والموارد', hr: 'الإدارة والموارد', corr: 'الإدارة والموارد', internal: 'الإدارة والموارد', finance: 'الإدارة والموارد', procurement: 'الإدارة والموارد',
    dashboard: 'البيانات والتقارير', exchange: 'البيانات والتقارير', ai: 'البيانات والتقارير', comms: 'البيانات والتقارير',
    admin: 'الإدارة والحوكمة', access: 'الإدارة والحوكمة', audit: 'الإدارة والحوكمة', units: 'الإدارة والحوكمة', verify: 'الإدارة والحوكمة', guidelines: 'الإدارة والحوكمة',
    labtools: 'أدوات تجريبية',
  };
  const NAV_ORDER = ['overview', 'desk', 'affairs', 'student_life', 'academics', 'attendance', 'expansions', 'lms', 'research', 'alumni', 'qa', 'payroll', 'hr', 'corr', 'internal', 'finance', 'procurement', 'dashboard', 'exchange', 'ai', 'comms', 'admin', 'access', 'audit', 'units', 'verify', 'guidelines', 'labtools'];
  const SIDE_LABEL = { corr: 'الديوان والمراسلات', guidelines: 'دليل الإرشادات التفاعلي' };
  const EXTRA_LABEL = { site: 'إعدادات الموقع', services: 'الخدمات' };

  /* ---------- أدوات ---------- */
  const nf = new Intl.NumberFormat('en-US');
  const initials = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' ') || '؟';
  const ago = (t) => {
    const m = Math.max(1, Math.round((Date.now() - t) / 60000));
    if (m < 60) return `منذ ${m} دقيقة`;
    const h = Math.round(m / 60); if (h < 24) return `منذ ${h} ساعة`;
    return `منذ ${Math.round(h / 24)} يوماً`;
  };
  const dateLong = () => { try { return new Date().toLocaleDateString('ar-SY-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return new Date().toLocaleDateString(); } };
  const pending = () => {
    if (S.stats && S.stats.review !== undefined) return S.stats.review;
    if (X.data && X.data.stats) return X.data.stats.review;
    const list = (X.data && X.data.requests) || S.requests || [];
    return list.filter((r) => r.status === 'review').length;
  };

  /* ---------- تحميل بيانات لوحة التحكم ---------- */
  UA.loaders.overview = async () => {
    const D = { analytics: null, stats: null, requests: null };
    const jobs = [];
    if (can('stats:read')) {
      jobs.push(api('GET', '/api/analytics').then((r) => { D.analytics = r; }).catch(() => {}));
      jobs.push(api('GET', '/api/stats').then((r) => { D.stats = r.stats; S.stats = r.stats; }).catch(() => {}));
    }
    if (can('request:read_all') || can('request:read_unit')) jobs.push(api('GET', '/api/requests').then((r) => { D.requests = r.requests; }).catch(() => {}));
    await Promise.all(jobs);
    X.data = D;
  };

  /* ---------- لوحة التحكم ---------- */
  const statCard = (label, value, meta, icon, color, progress) => `<article class="sx-stat"><div class="sx-ic sx-${color}">${ico(icon, 22)}</div><div class="cp"><span>${label}</span><strong>${value}</strong></div>
    <div class="mt"><span>${meta}</span>${progress === undefined ? '' : `<div><i style="width:${Math.max(0, Math.min(100, progress))}%"></i></div>`}</div></article>`;

  function weekChart(reqs) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      let label = ''; try { label = d.toLocaleDateString('ar-SY-u-nu-latn', { weekday: 'long' }); } catch { label = String(d.getDay()); }
      days.push({ from: d.getTime(), to: d.getTime() + 864e5, label, n: 0 });
    }
    reqs.forEach((r) => { const d = days.find((x) => r.createdAt >= x.from && r.createdAt < x.to); if (d) d.n++; });
    const top = Math.max(4, Math.ceil(Math.max(...days.map((d) => d.n)) / 4) * 4);
    const ys = [top, top * 0.75, top * 0.5, top * 0.25, 0].map((v) => `<span>${nf.format(Math.round(v * 10) / 10)}</span>`).join('');
    const cols = days.map((d) => `<div class="sx-col" title="${esc(d.label)}: ${d.n}"><div class="sx-track"><i style="height:${(d.n / top) * 100}%"><b>${d.n}</b></i></div><span>${esc(d.label)}</span></div>`).join('');
    return `<div class="sx-bars" role="img" aria-label="عدد الطلبات خلال آخر 7 أيام"><div class="sx-y">${ys}</div><div class="sx-plot">${cols}</div></div>`;
  }

  function donut(D, reqs, cnt) {
    const PAL = ['#0E6655', '#D5B65D', '#65A99A', '#356C8A', '#9A6D20', '#8C9A94'];
    const fac = D.analytics && D.analytics.tables.find((t) => t.id === 'byFaculty');
    let rows, total, center, title, sub;
    if (fac && fac.rows.some((r) => r[1] > 0)) {
      const all = fac.rows.filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]);
      rows = all.slice(0, 5).map((r, i) => [r[0], r[1], PAL[i]]);
      const rest = all.slice(5).reduce((s, r) => s + r[1], 0); if (rest) rows.push(['أخرى', rest, PAL[5]]);
      total = rows.reduce((s, r) => s + r[1], 0); center = 'إجمالي الطلاب'; title = 'توزيع الطلاب'; sub = 'حسب الكلية أو المعهد';
    } else {
      rows = [['قيد المراجعة', cnt.review, '#D5B65D'], ['معتمدة', cnt.approved, '#0E6655'], ['مرفوضة', cnt.rejected, '#B3261E']].filter((r) => r[1] > 0);
      total = rows.reduce((s, r) => s + r[1], 0); center = 'إجمالي الطلبات'; title = 'حالة الطلبات'; sub = 'توزيع الطلبات الظاهرة لك';
    }
    if (!total) return `<article class="sx-panel"><div class="sx-ph"><div><h2>${title}</h2><p>${sub}</p></div></div><div class="sx-empty">لا بيانات لعرضها بعد.</div></article>`;
    let acc = 0;
    const stops = rows.map((r) => { const a = acc, b = acc + (r[1] / total) * 100; acc = b; return `${r[2]} ${a}% ${b}%`; }).join(', ');
    const legend = rows.map((r) => `<div><i style="background:${r[2]}"></i><span>${esc(r[0])}</span><b>${Math.round((r[1] / total) * 100)}%</b></div>`).join('');
    return `<article class="sx-panel"><div class="sx-ph"><div><h2>${title}</h2><p>${sub}</p></div></div>
      <div class="sx-donut-w"><div class="sx-donut" style="background:conic-gradient(${stops})" role="img" aria-label="${title}"><div><strong>${nf.format(total)}</strong><span>${center}</span></div></div><div class="sx-legend">${legend}</div></div></article>`;
  }

  // أجزاء مؤشرات الجامعة؛ تركّبها اللوحة الرئيسية في ux_restructure.js مع أجزاء «مكتبي»
  UA.homeParts = function () {
    const D = X.data || { analytics: null, stats: null, requests: null };
    const reqs = (D.requests || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    const cnt = { review: 0, approved: 0, rejected: 0 };
    reqs.forEach((r) => { if (cnt[r.status] !== undefined) cnt[r.status]++; });
    const st = D.stats;
    const total = st ? st.review + st.approved + st.rejected : reqs.length;
    const review = st ? st.review : cnt.review, approved = st ? st.approved : cnt.approved, rejected = st ? st.rejected : cnt.rejected;
    const decided = approved + rejected;
    const kpi = (id) => D.analytics && D.analytics.kpis.find((k) => k.id === id);
    const cards = [];
    const hasReqData = !!(st || D.requests);
    if (kpi('students')) cards.push(statCard('الطلاب المقيَّدون', nf.format(kpi('students').value), esc(kpi('students').hint || ''), 'users', 'mint'));
    if (hasReqData) cards.push(statCard('إجمالي الطلبات', nf.format(total), `${nf.format(approved)} معتمدة · ${nf.format(rejected)} مرفوضة`, 'file', 'sand'));
    if (hasReqData) cards.push(statCard('طلبات قيد المراجعة', nf.format(review), st && st.slaBreaches ? `${nf.format(st.slaBreaches)} متأخرة عن مدة الخدمة` : 'لا طلبات متأخرة عن المدة', 'clock', 'blue', total ? (review / total) * 100 : 0));
    if (hasReqData) cards.push(statCard('نسبة الاعتماد', decided ? `${Math.round((approved / decided) * 1000) / 10}%` : '—', st && st.avgApprovalMs ? `متوسط زمن الاعتماد ${UA.dur(st.avgApprovalMs)}` : 'من الطلبات المبتوت فيها', 'check', 'lav', decided ? (approved / decided) * 100 : 0));

    const rows = reqs.slice(0, 6).map((r) => {
      const m = { review: ['amber', 'قيد المراجعة'], approved: ['green', 'معتمد'], rejected: ['red', 'مرفوض'] }[r.status] || ['amber', r.status];
      return `<tr><td><div class="sx-sc"><span>${esc(initials(r.student.name))}</span><div><strong>${esc(r.student.name)}</strong><small>${esc(r.student.studentNo || r.no)}</small></div></div></td>
        <td data-l="نوع الطلب">${esc(r.service.label)}</td><td class="sx-muted" data-l="وقت التقديم">${ago(r.createdAt)}</td><td data-l="الحالة"><span class="sx-st ${m[0]}"><i></i>${m[1]}</span></td>
        <td><button class="sx-go" data-sx="openreq" data-id="${r.id}" aria-label="عرض طلب ${esc(r.student.name)}">${ico('chevron', 17)}</button></td></tr>`;
    }).join('');
    const reqPanel = D.requests ? `<article class="sx-panel"><div class="sx-ph"><div><h2>أحدث الطلبات</h2><p>آخر المعاملات الواردة إلى النظام</p></div>
        <button class="sx-link" data-sx="go" data-v="affairs">عرض جميع الطلبات ${ico('arrow', 16)}</button></div>
      <div class="sx-tscroll">${rows ? `<table class="sx-table rsp"><thead><tr><th>الطالب</th><th>نوع الطلب</th><th>وقت التقديم</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="sx-empty">لا توجد طلبات حتى الآن.</div>'}</div></article>`
      : '';

    const views = new Set(UA.viewsFor(S.me.role).map((v) => v[0]));
    const qa = [];
    if (views.has('payroll')) qa.push(['mint', 'users', 'شؤون الموظفين والرواتب', 'ملفات العاملين، العقود، الإجازات، والرواتب', 'go', 'payroll']);
    if (views.has('finance')) qa.push(['blue', 'layers', 'المالية والمحاسبة', 'شجرة الحسابات، اليومية المزدوجة، والقوائم الختامية', 'go', 'finance']);
    if (views.has('procurement')) qa.push(['sand', 'layers', 'المشتريات والمخازن والأصول', 'طلبات الشراء، التوريد، الجرد، والأصول الثابتة', 'go', 'procurement']);
    if (views.has('corr') || views.has('internal')) qa.push(['lav', 'news', 'الديوان والمراسلات والطلبات الداخلية', 'الكتب الرسمية ومذكرات التوقيع والطلبات الداخلية الموحدة', 'go', 'corr']);
    if (can('student:register')) qa.push(['blue', 'users', 'تسجيل طالب جديد', 'إدراج طالب في السجل الأكاديمي الموحد', 'newstudent', '']);
    const quick = `<article class="sx-panel"><div class="sx-ph"><div><h2>المنظومات والوحدات الرئيسية</h2><p>انتقال سريع إلى الأنظمة المؤسسية المتكاملة</p></div><button class="sx-link" data-act="maindashtab" data-t="work">كل أقسامي ${ico('arrow', 16)}</button></div><div class="sx-quick">${qa.length ? qa.map((q) => `<button data-sx="${q[4]}" data-v="${q[5]}"><span class="sx-${q[0]}">${ico(q[1])}</span><div><strong>${q[2]}</strong><small>${q[3]}</small></div>${ico('chevron', 17)}</button>`).join('') : '<div class="sx-empty">لا إجراءات متاحة لحسابك.</div>'}</div></article>`;

    const activity = `<article class="sx-panel"><div class="sx-ph"><div><h2>نشاط الطلبات</h2><p>عدد الطلبات المستلمة خلال آخر 7 أيام</p></div></div>${weekChart(reqs)}</article>`;
    return {
      stats: cards.length ? `<section class="sx-stats" aria-label="مؤشرات الجامعة">${cards.join('')}</section>` : '',
      panels: D.requests
        ? `<section class="sx-grid-b">${reqPanel}${quick}</section><section class="sx-grid-a">${activity}${donut(D, reqs, cnt)}</section>`
        : (D.analytics ? `<section class="sx-grid-a">${donut(D, reqs, cnt)}${quick}</section>` : `<section class="sx-grid-b">${quick}</section>`),
    };
  };

  /* ---------- الهيكل ----------
     o (اختياري، تستعمله واجهة الطالب): views, act, active, label, root, search, notif {count,text,btn}, badges, help, menu */
  UA.shell = function shell(body, o = {}) {
    const tr = (s) => (window.UA && window.UA.i18n ? window.UA.i18n.tr(s) : s);
    const curLang = (window.UA && window.UA.i18n ? window.UA.i18n.getLang() : 'ar');
    const isEn = curLang === 'en';
    const curDir = isEn ? 'ltr' : 'rtl';
    const otherLangLabel = isEn ? 'العربية' : 'English';
    document.body.classList.add('sx-on');
    const views = o.views || UA.viewsFor(S.me.role);
    const act = o.act || 'view';
    const activeKey = o.active || PARENT[S.view] || S.view;
    const label = o.label || (views.find((v) => v[0] === S.view) || [])[1] || EXTRA_LABEL[S.view] || '';
    const review = o.notif ? o.notif.count : pending();
    const comp = X.data && X.data.analytics && X.data.analytics.kpis.find((k) => k.id === 'complaints');
    const badge = (k) => {
      if (o.badges) return o.badges[k] ? `<small>${o.badges[k]}</small>` : '';
      return k === 'affairs' && review ? `<small>${review}</small>` : (k === 'comms' && comp && comp.value ? `<small>${comp.value}</small>` : '');
    };
    const hasGroup = !o.views && views.some((v) => v[0] === 'affairs');
    const inGroup = hasGroup && S.view === 'affairs';
    document.body.classList.toggle('sx-grouped', !!inGroup);

    // قائمة الصفحات الرئيسية التي تمتلك تبويبات فرعية
    const HAS_SUB = { affairs: true, academics: true, attendance: true, payroll: true, export: true, admin: true, audit: true, corr: true, comms: true, access: true };
    const hasSubs = (v) => HAS_SUB[v] || (UA.gate && (UA.gate.TABS[v] || []).length > 1);

    const okTab = (act, tab) => !UA.gate || UA.gate.allowed(act, tab, S.me);
    const subs = () => {
      const t = S.stTab === 'edit' ? 'list' : S.stTab;
      const it = [['affairs', 'requests', can('request:decide') ? 'سجل الطلبات' : 'الطلبات']];
      if (can('student:read')) it.push(['affairs', 'list', 'سجل الطلاب']);
      if (can('student:register')) it.push(['affairs', 'new', 'تسجيل طالب جديد']);
      it.push(
        ['affairs', 'groups', 'فئات الطلاب'],
        ['affairs', 'digital_card', 'البطاقة الرقمية والباركود الذكي'],
        ['affairs', 'advising', '1. الخطة والإرشاد والإنذار'],
        ['affairs', 'lifecycle', '2. حركات القيد والانضباط'],
        ['affairs', 'scholarships', '3. المنح والإعفاءات المالية'],
        ['affairs', 'desk_queue', '4. مكتب خدمة الطالب والدور']
      );
      return `<div class="sx-sub-list" role="group" aria-label="شؤون الطلاب">${it.filter((x) => okTab('sttab', x[1])).map((x) => `<button data-sx="sub" data-v="${x[0]}" data-t="${x[1]}"${S.view === x[0] && t === x[1] ? ' aria-current="true"' : ''}>${esc(x[2])}</button>`).join('')}</div>`;
    };

    // تبويبات الصفحة الداخلية تظهر في القائمة الجانبية تحت عنوان الصفحة لسهولة التنقل الفوري
    let sideSub = '';
    if (!o.views && !inGroup) {
      const m = /<div class="sub-tabs[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(body);
      if (m) {
        const items = [...m[1].matchAll(/<button[^>]*data-act="([^"]+)"[^>]*data-(?:t|s)="([^"]*)"[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)];
        if (items.length) {
          sideSub = `<div class="sx-sub-list" role="group" aria-label="${esc(tr(label))}">${items.filter((x) => okTab(x[1], x[2])).map((x) => {
            const rawInner = x[4] || '';
            const bdgMatch = rawInner.match(/<span[^>]*class="[^"]*badge[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/i);
            const cleanTxt = rawInner
              .replace(/<kbd[^>]*>[\s\S]*?<\/kbd>/gi, '')
              .replace(/<span[^>]*class="[^"]*badge[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            const bdgVal = bdgMatch ? bdgMatch[1].trim() : '';
            const bdgHtml = bdgVal && bdgVal !== '0'
              ? `<small style="margin-inline-start:auto;background:rgba(213,182,93,.22);color:#fde047;padding:1px 7px;border-radius:99px;font-size:11px;font-weight:700">${esc(bdgVal)}</small>`
              : '';
            return `<button data-act="${x[1]}" data-t="${x[2]}" data-s="${x[2]}"${x[3] === 'true' ? ' aria-current="true"' : ''}><span>${esc(tr(cleanTxt))}</span>${bdgHtml}</button>`;
          }).join('')}</div>`;
        }
      }
    }

    // الشريط الداخلي صار قائمة فرعية جانبية: نزيله من الصفحة كي لا يتكرّر ولا يلتصق أعلاها فيغطي الأزرار تحته.
    // لا نزيله إلا إن ظهرت القائمة الجانبية فعلاً (الصفحة الحالية ضمن عناصر القائمة)، وإلا اختفت التبويبات دون بديل.
    const pageBody = (sideSub && views.some((v) => v[0] === activeKey)) ? body.replace(/<div class="sub-tabs[^"]*"[^>]*>[\s\S]*?<\/div>/, '') : body;

    // عناوين المجموعات تُدرج بين الأزرار داخل الشبكة نفسها
    let gLast = '';
    const orderOf = (v) => { const i = NAV_ORDER.indexOf(v); return i < 0 ? NAV_ORDER.length : i; };
    const navViews = o.views ? views : [...views].sort((a, b) => orderOf(a[0]) - orderOf(b[0]));
    const nav = navViews.map((v) => {
      // من لا يخدم الطلاب مباشرة تصله الطلبات المحالة لقسمه فقط، فلا تُعرض تحت «الشؤون الطلابية»
      const inboxOnly = v[0] === 'affairs' && !['student:read', 'student:register', 'request:read_all', 'sa_admissions:view', 'sa_advising:view', 'sa_scholarships:view'].some((p) => S.me?.permissions?.includes(p));
      const g = o.views ? '' : (NAV_GROUP[inboxOnly ? 'overview' : v[0]] || '');
      const head = g && g !== gLast ? `<div class="sx-gh" role="presentation">${esc(tr(g))}</div>` : '';
      if (g) gLast = g;
      const itemLabel = esc(tr(!o.views && SIDE_LABEL[v[0]] ? SIDE_LABEL[v[0]] : v[1]));
      const isCur = activeKey === v[0] || (hasGroup && v[0] === 'affairs' && inGroup);
      const withSub = hasSubs(v[0]);
      const caretHtml = withSub ? `<em class="sx-caret${isCur ? ' open' : ''}">${ico('chevron', 15)}</em>` : '';
      return head + `<button data-act="${act}" data-v="${v[0]}" title="${itemLabel}"${isCur ? ' aria-current="page"' : ''}>${ico(NAV_ICON[v[0]] || 'file')}<span>${itemLabel}</span>${badge(v[0])}${caretHtml}</button>${v[0] === 'affairs' && inGroup ? subs() : ''}${sideSub && activeKey === v[0] ? sideSub : ''}`;
    }).join('');
    const uni = String(S.uni || ''), cut = uni.indexOf(' للعلوم');
    const brand1 = tr(cut > 0 ? uni.slice(0, cut) : uni), brand2 = tr(cut > 0 ? uni.slice(cut + 1) : 'نظام إدارة الجامعة');
    const role = tr(S.me.roleLabel || UA.ROLE_LABEL[S.me.role] || '');
    const help = o.help || `<div class="sx-help"><i>${ico('shield', 22)}</i><strong>${tr('دليل الإرشادات التفاعلي')}</strong><p>${tr('دليل تفاعلي لكامل الأقسام والطلبات وهيكلية العمل.')}</p><button data-act="view" data-v="guidelines">${tr('فتح الدليل التفاعلي')} ${ico('arrow', 15)}</button></div>`;
    const langBtnHtml = `<button class="sx-ib" data-sx="lang" title="تبديل اللغة / Switch Language (${otherLangLabel})" aria-label="تبديل اللغة" style="width:auto;padding:0 12px;height:38px;border:1.5px solid #054239;border-radius:8px;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;background:#fff;color:#054239;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.06)">
      <span style="font-size:15px">🌐</span>
      <span>${otherLangLabel}</span>
    </button>`;
    const isCollapsed = document.body.classList.contains('sx-collapsed');
    const a11yBarHtml = `<div class="sx-a11y-bar no-print" role="toolbar" aria-label="${tr('أدوات العرض وسهولة الوصول')}">
      <button type="button" class="sx-a11y-btn" data-act="sxtoggleside" aria-pressed="${isCollapsed}" title="${tr('طي أو توسيع القائمة الجانبية (Ctrl+B)')}">⇄ <span class="sx-a11y-hide-sm">${isCollapsed ? tr('توسيع القائمة') : tr('طي القائمة')}</span></button>
    </div>`;
    const notifBody = o.notif ? `<p>${o.notif.text}</p>${o.notif.btn || ''}` : `<p>${review ? `${tr('لديك طلبات قيد المراجعة')}: ${review}` : tr('لا توجد إشعارات جديدة.')}</p>${review ? `<button data-sx="go" data-v="affairs">${tr('عرض الطلبات')}</button>` : ''}`;
    const menu = o.menu || `<button class="sx-menu-item" data-sx="lang"><span style="font-size:16px">🌐</span> ${tr('تبديل اللغة')} (${otherLangLabel})</button><button class="sx-menu-item" data-act="logout">${ico('out', 18)} ${tr('تسجيل الخروج')}</button>`;
    const search = o.search === false ? '<div class="sx-sp"></div>' : `<label class="sx-search">${ico('search', 19)}<input id="sx-q" type="search" placeholder="${can('student:read') ? tr('ابحث عن قسم أو طالب، أو اضغط Ctrl+` للبحث الشامل...') : tr('ابحث عن قسم، أو اضغط Ctrl+`...')}" autocomplete="off"><kbd data-act="sxcmdopen" style="cursor:pointer" title="${tr('فتح نافذة البحث الشامل والأوامر السريعة (Ctrl+`)')}">Ctrl K</kbd></label>`;
    const wsTabsHtml = UA.renderWorkspaceTabsBar ? UA.renderWorkspaceTabsBar(activeKey, label) : '';
    return `<div class="sx-shell" dir="${curDir}">
      <button class="sx-backdrop" data-sx="close" aria-label="${tr('إغلاق القائمة')}"></button>
      <aside class="sx-side" aria-label="${tr('القائمة الجانبية')}">
        <div class="sx-brand"><img src="/brand/crest.svg" alt="" width="42" height="48"><div><strong>${esc(brand1)}</strong><span>${esc(brand2)}</span></div><button class="sx-ib sx-close" data-sx="close" aria-label="${tr('إغلاق')}" style="color:#fff">${ico('close')}</button></div>
        ${o.views ? `<div class="sx-navlabel">${tr('القائمة الرئيسية')}</div>` : ''}
        <nav class="sx-nav" aria-label="${tr('القائمة الرئيسية')}">${nav}</nav>
        ${help}
        <div class="sx-state"><i></i> ${tr('النظام يعمل بشكل طبيعي')}</div>
      </aside>
      <div class="sx-content">
        <header class="sx-top">
          <button class="sx-ib sx-burger" data-sx="open" aria-label="${tr('فتح القائمة')}">${ico('menu')}</button>
          <div class="sx-crumbs"><span>${esc(tr(o.root || 'نظام إدارة الجامعة'))}</span>${ico('chevron', 15)}<strong>${esc(tr(label))}</strong></div>
          ${search}
          <div class="sx-actions">
            ${a11yBarHtml}
            ${langBtnHtml}
            ${window.UAtheme ? window.UAtheme.button() : ''}
            <div class="sx-wrap"><button class="sx-ib" data-sx="notif" aria-label="${tr('الإشعارات')}">${ico('bell')}${review ? '<i class="sx-dot"></i>' : ''}</button>
              <div class="sx-pop" id="sx-notif" hidden><strong>${tr('الإشعارات')}</strong>${notifBody}${UA.push ? UA.push.panel() : ''}</div></div>
            <div class="sx-sep"></div>
            <div class="sx-wrap"><button class="sx-profile" data-sx="profile" aria-label="${tr('قائمة المستخدم')}"><span class="sx-av">${esc(initials(tr(S.me.name)))}</span><span><strong>${esc(tr(S.me.name))}</strong><small>${esc(tr(role))}</small></span>${ico('chevron', 15)}</button>
              <div class="sx-pop" id="sx-menu" hidden>${menu}</div></div>
          </div>
        </header>
        ${wsTabsHtml}
        <main class="sx-main"><div class="sx-page">${pageBody}</div></main>
        <footer class="sx-foot"><span>© 2026 ${esc(tr(S.uni))}</span><span>${tr('جميع الحقوق محفوظة')}</span></footer>
      </div></div>`;
  };
  UA.sx = { ico, initials, ago, dateLong, nf, statCard, navIcon: NAV_ICON, navGroup: NAV_GROUP };

  /* ---------- الأحداث ---------- */
  const pops = () => [document.getElementById('sx-notif'), document.getElementById('sx-menu')].filter(Boolean);
  document.addEventListener('click', async (e) => {
    const t = e.target.closest && e.target.closest('[data-sx]');
    if (!t) { if (!(e.target.closest && e.target.closest('.sx-pop') && !e.target.closest('[data-act]'))) pops().forEach((p) => { p.hidden = true; }); return; }
    const a = t.dataset.sx;
    if (a === 'lang') {
      const cur = (window.UA && window.UA.i18n ? window.UA.i18n.getLang() : 'ar');
      const next = cur === 'en' ? 'ar' : 'en';
      if (window.UA && window.UA.i18n && window.UA.i18n.syncLang) {
        window.UA.i18n.syncLang(next, { source: 'erp_header_button' });
      } else if (window.UA && window.UA.i18n) {
        window.UA.i18n.setLang(next);
      }
      UA.render();
    }
    else if (a === 'open') document.body.classList.add('sx-drawer');
    else if (a === 'close') document.body.classList.remove('sx-drawer');
    else if (a === 'notif' || a === 'profile') { const mine = document.getElementById(a === 'notif' ? 'sx-notif' : 'sx-menu'); const was = mine && !mine.hidden; pops().forEach((p) => { p.hidden = true; }); if (mine) mine.hidden = was; }
    else if (a === 'sub') {
      const v = t.dataset.v, tab = t.dataset.t;
      if (v === 'affairs') { S.stTab = tab; S.err = ''; S.fieldErr = null; S.stEdit = null; if (tab === 'new') { S.cred = null; S.stSel = null; } await UA.guard(() => UA.go('affairs')); }
      else { await UA.guard(() => UA.go('academics')); if (UA.actions.actab) await UA.actions.actab(null, { t: tab }); }
      document.body.classList.remove('sx-drawer');
    }
    else if (a === 'go') { await UA.guard(() => UA.go(t.dataset.v)); }
    else if (a === 'newstudent') { S.stTab = 'new'; S.stSel = null; await UA.guard(() => UA.go('affairs')); }
    else if (a === 'openreq') { S.stTab = 'requests'; S.sel = Number(t.dataset.id); S.rej = null; S.view = 'affairs'; await UA.guard(async () => { await UA.loadFor('affairs'); UA.render(); }); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.sx-nav [data-act], .sx-sub-list [data-act], .sx-help [data-act]')) document.body.classList.remove('sx-drawer'); });
  document.addEventListener('keydown', async (e) => {
    // الانتقال السريع: Ctrl+` (مفتاح يسار الرقم 1، وهو حرف ذ في اللوحة العربية؛ لذلك نقرأ code لا key) وCtrl+K بديل احتياطي
    if (e.ctrlKey && e.code === 'Backquote' || (e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
      e.preventDefault();
      if (UA.openCommandPalette) { await UA.openCommandPalette(); return; }
      const q = document.getElementById('sx-q');
      if (q) q.focus();
    }
    if (e.key === 'Escape') { pops().forEach((p) => { p.hidden = true; }); document.body.classList.remove('sx-drawer'); }
    if (e.key === 'Enter' && e.target && e.target.id === 'sx-q') {
      e.preventDefault();
      if (UA.openCommandPalette) await UA.openCommandPalette(e.target.value);
    }
  });
  // البحث العلوي عام: الكتابة فيه تفتح نافذة البحث الشامل بالنص نفسه، ومنها الانتقال للقسم المطلوب
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t && t.id === 'sx-q' && t.value.trim() && UA.openCommandPalette) { const v = t.value; t.value = ''; UA.openCommandPalette(v); }
  });
})();
