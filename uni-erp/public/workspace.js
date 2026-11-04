/* تبويب «أعمالي» في اللوحة الرئيسية: ما ينتظر المستخدم، وإجراءاته السريعة، وأقسامه كلها بتبويباتها الفرعية مع بحث فوري.
   المثبتة والأخيرة تفضيل شخصي على هذا الجهاز (localStorage)، والأقسام تتبع allowedViews والبوابة فلا يظهر ما لا يملكه الحساب. */
(function () {
  const UA = window.UA, { S, esc } = UA;
  const STAR = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></svg>';
  const RECENT_MAX = 5;
  const HINTS = {
    attendance: 'مسح الباركود وسجل الدخول والخروج', expansions: 'جداول الامتحانات والسكن والمنح', lms: 'المحاضرات والاختبارات والمكتبة', research: 'المشاريع البحثية والرسائل الجامعية', alumni: 'سجل الخريجين وفرص العمل', qa: 'مؤشرات الأداء والاعتماد المؤسسي', comms: 'نشر الأخبار ومعالجة الشكاوى', ai: 'الإنذار المبكر والمرشد وفرز المراسلات', access: 'حسابات الموظفين وأدوارهم وصلاحياتهم',
  };
  const IMPORT_ANY = ['student:register', 'course:manage', 'grade:manage', 'request:import', 'import:academic', 'import:procurement', 'import:finance', 'import:hr', 'import:student_fin', 'import:misc'];
  const ACTIONS = [
    ['تسجيل طالب جديد', 'affairs', 'sttab', 'new', ['student:register']],
    ['إدخال علامات', 'academics', 'acadtab', 'grades', ['grade:manage']],
    ['كتاب رسمي جديد', 'corr', 'corrunified', 'new_corr', ['corr:use']],
    ['طلب داخلي جديد', 'corr', 'corrunified', 'internal_new', ['request:create_internal']],
    ['استيراد ملف', 'exchange', 'extab', 'import', IMPORT_ANY],
    ['تصدير بيانات', 'exchange', 'extab', 'export', ['data:export']],
  ];
  const ACADEMIC_GROUP = 'الشؤون الأكاديمية';

  const state = { q: '' };
  const ico = (n, s) => UA.sx.ico(n, s);
  const allowedBy = (need) => !need || need.some((p) => UA.can(p));
  const fold = (s) => String(s ?? '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
  const groupLabel = (s) => String(s).replace(/\s*\(.*?\)\s*/g, '').trim();

  /* ---------- التفضيلات الشخصية ---------- */
  const storeKey = () => `ua_work_v1:${S.me ? S.me.id : ''}`;
  function loadPrefs() {
    try { const p = JSON.parse(localStorage.getItem(storeKey()) || '{}'); return { pins: Array.isArray(p.pins) ? p.pins : [], recent: Array.isArray(p.recent) ? p.recent : [] }; }
    catch { return { pins: [], recent: [] }; }
  }
  function savePrefs(p) { try { localStorage.setItem(storeKey(), JSON.stringify(p)); } catch { /* تفضيل لا أكثر: تعذّر الحفظ لا يعطّل الشاشة */ } }
  function remember(v, a, t) {
    const p = loadPrefs(), top = p.recent[0];
    if (top && top.v === v && (!a || top.t === t)) return;
    p.recent = [{ v, a: a || '', t: t || '' }, ...p.recent.filter((r) => !(r.v === v && (r.t || '') === (t || '')))].slice(0, RECENT_MAX);
    savePrefs(p);
  }

  /* ---------- الأقسام المتاحة لهذا الحساب ---------- */
  function catalog() {
    const nav = UA.sx.navGroup, kind = S.me && S.me.staffKind === 'faculty' ? 'faculty' : 'admin', groups = new Map();
    for (const [v, label] of UA.viewsFor(S.me.role)) {
      if (v === 'overview') continue;
      const name = groupLabel(nav[v] || 'أخرى');
      if (!groups.has(name)) groups.set(name, []);
      // سجل التبويبات واحد في البوابة؛ تبويبات v12 تُفتح من شاشتها لأن تبديلها داخلي
      const subs = ((UA.gate && UA.gate.TABS[v]) || []).filter(([a, t]) => !a.startsWith('v12:') && UA.gate.allowed(a, t, S.me)).map(([a, t, l]) => ({ a, t, l }));
      groups.get(name).push({ v, label, icon: UA.sx.navIcon[v] || 'grid', hint: HINTS[v] || '', subs });
    }
    const list = [...groups].map(([name, items]) => ({ name, items }));
    return kind === 'faculty' ? list.sort((x, y) => (y.name === ACADEMIC_GROUP) - (x.name === ACADEMIC_GROUP)) : list;
  }
  function filterCatalog(list, q) {
    const f = fold(q);
    if (!f) return list;
    const hit = (s) => fold(s).includes(f);
    return list.map((g) => ({
      name: g.name,
      items: g.items.map((it) => {
        if (hit(it.label) || hit(it.hint) || hit(g.name)) return it;
        const subs = it.subs.filter((s) => hit(s.l));
        return subs.length ? { ...it, subs, subMatch: true } : null;
      }).filter(Boolean),
    })).filter((g) => g.items.length);
  }

  /* ---------- الأجزاء ---------- */
  const openAttrs = (v, a, t) => `data-act="workopen" data-v="${esc(v)}"${a ? ` data-a="${esc(a)}" data-t="${esc(t)}"` : ''}`;

  function waitingPanel(desk) {
    const c = desk.counts || {}, rows = [];
    const add = (n, label, a, t) => { if (Number(n) > 0) rows.push(`<li><button type="button" class="wk-wait" ${openAttrs(t === 'requests' ? 'affairs' : 'corr', a, t)}><b class="wk-n">${Number(n)}</b><span>${esc(label)}</span><span class="wk-go">${ico('arrow', 16)}</span></button></li>`); };
    add(c.queue, 'بانتظار وحدتي', 'sttab', 'requests');
    add(c.corrTurn, 'مراسلات تنتظر اعتمادي', 'corrunified', 'pending_all');
    add(c.corrUnread, 'إشعارات غير مقروءة', 'corrunified', 'notifs');
    add(c.myOpen, 'طلباتي المفتوحة', 'corrunified', 'internal_requests');
    add(c.corrDrafts, 'مسودات لم تُرسل', 'corrunified', 'out');
    const body = rows.length ? `<ul class="wk-list">${rows.join('')}</ul>` : '<p class="wk-note">لا شيء ينتظرك الآن.</p>';
    return `<section class="sx-panel wk-now"><h3>ينتظرك الآن</h3>${body}</section>`;
  }

  function actionsPanel() {
    const list = ACTIONS.filter((x) => allowedBy(x[4]));
    if (!list.length) return '';
    return `<section class="sx-panel wk-do"><h3>إجراءات سريعة</h3><div class="wk-actions">${list.map(([l, v, a, t]) => `<button type="button" class="wk-act" ${openAttrs(v, a, t)}>${ico('plus', 15)}<span>${esc(l)}</span></button>`).join('')}</div></section>`;
  }

  function marksStrip(list) {
    const prefs = loadPrefs(), byView = new Map(list.flatMap((g) => g.items).map((it) => [it.v, it]));
    const chip = (it, sub) => `<button type="button" class="wk-chip" ${openAttrs(it.v, sub && sub.a, sub && sub.t)} title="${esc(sub ? `${it.label}: ${sub.l}` : it.label)}">${ico(it.icon, 15)}<span>${esc(sub ? sub.l : it.label)}</span></button>`;
    const pinned = prefs.pins.map((v) => byView.get(v)).filter(Boolean);
    const recent = prefs.recent.map((r) => {
      const it = byView.get(r.v);
      if (!it) return '';
      const sub = r.t ? it.subs.find((s) => s.t === r.t && s.a === r.a) : null;
      if (r.t && !sub) return '';
      return !sub && prefs.pins.includes(r.v) ? '' : chip(it, sub);
    }).filter(Boolean);
    return `<div class="wk-marks">
      <section><h3>المثبتة</h3>${pinned.length ? `<div class="wk-chips">${pinned.map((it) => chip(it)).join('')}</div>` : '<p class="wk-note">اضغط النجمة بجانب أي قسم ليبقى هنا.</p>'}</section>
      ${recent.length ? `<section><h3>الأخيرة</h3><div class="wk-chips">${recent.join('')}</div></section>` : ''}
    </div>`;
  }

  function groupsHtml(list) {
    const shown = filterCatalog(list, state.q);
    if (!shown.length) {
      return `<div class="wk-empty"><p>لا يوجد في أقسامك ما يطابق «${esc(state.q)}».</p><button type="button" class="btn sm" data-act="workglobal">ابحث في كل النظام</button></div>`;
    }
    const pins = loadPrefs().pins;
    return shown.map((g) => `<section class="wk-group"><h3>${esc(g.name)}</h3>${g.items.map((it) => {
      const on = pins.includes(it.v);
      const detail = it.subs.length
        ? `<div class="wk-subs">${it.subs.map((s) => `<button type="button" class="wk-sub" ${openAttrs(it.v, s.a, s.t)}>${esc(s.l)}</button>`).join('')}</div>`
        : (it.hint ? `<p class="wk-hint">${esc(it.hint)}</p>` : '');
      return `<div class="wk-item">
        <button type="button" class="wk-open" ${openAttrs(it.v)}><span class="wk-ic">${ico(it.icon, 18)}</span><span class="wk-name">${esc(it.label)}</span></button>
        <button type="button" class="wk-pin${on ? ' on' : ''}" data-act="workpin" data-v="${esc(it.v)}" aria-pressed="${on}" aria-label="${on ? 'إلغاء تثبيت' : 'تثبيت'} ${esc(it.label)}" title="${on ? 'إلغاء التثبيت' : 'تثبيت'}">${STAR}</button>
        ${detail}
      </div>`;
    }).join('')}</section>`).join('');
  }

  UA.workspaceView = () => {
    const desk = UA.deskParts ? UA.deskParts() : null;
    if (!desk) return '<section class="sx-panel"><p class="hint">جارٍ التحميل…</p></section>';
    const list = catalog();
    return `<div class="wk sdesk sd-${desk.kind}${state.q ? ' is-searching' : ''}" id="wk-root">
      <header class="wk-head">
        <div><h2>${esc(desk.workTitle)}</h2><p>${esc(desk.workHint)}</p></div>
        <label class="wk-search">${ico('search', 17)}<input id="wk-q" type="search" value="${esc(state.q)}" placeholder="ابحث في أقسامك وتبويباتها" aria-label="ابحث في أقسامك وتبويباتها" autocomplete="off"><kbd>/</kbd></label>
      </header>
      <div class="wk-top">${waitingPanel(desk)}${actionsPanel()}</div>
      ${marksStrip(list)}
      <section class="sx-panel wk-all"><div class="wk-groups" id="wk-groups">${groupsHtml(list)}</div></section>
    </div>`;
  };

  /* ---------- الفتح والبحث ---------- */
  async function openItem(v, a, t) {
    state.q = '';   // العودة إلى التبويب تبدأ بالقائمة كاملة لا بنتيجة بحث قديمة
    remember(v, a, t);
    if (S.view !== v) await UA.go(v);
    if (!a) return;
    // نضغط زر التبويب نفسه كي يمر بمسار الشاشة المعتاد، فبعض التبويبات لا تملك إجراءً مستقلاً.
    // المالية والمشتريات تجلب بياناتها ثم ترسم شريطها، فالزر قد يظهر بعد انتهاء الانتقال
    const selector = `[data-act="${a}"][data-t="${t}"]`;
    for (let i = 0; i < 60 && !document.querySelector(selector) && S.view === v; i++) await new Promise((r) => setTimeout(r, 50));
    const btn = document.querySelector(selector);
    if (btn) btn.click();
    else if (UA.actions[a]) await UA.actions[a](null, { t });
  }

  function paintGroups() {
    const root = document.getElementById('wk-root'), box = document.getElementById('wk-groups');
    if (!root || !box) return;
    root.classList.toggle('is-searching', !!state.q);
    box.innerHTML = groupsHtml(catalog());
    if (UA.i18n) UA.i18n.translateDom(box);
  }

  Object.assign(UA.actions, {
    workopen: (el, d) => openItem(d.v, d.a, d.t),
    workpin: (el, d) => {
      const p = loadPrefs();
      p.pins = p.pins.includes(d.v) ? p.pins.filter((x) => x !== d.v) : [...p.pins, d.v];
      savePrefs(p);
      UA.render();
    },
    workglobal: () => { if (UA.openCommandPalette) UA.openCommandPalette(state.q); },
  });

  document.addEventListener('input', (e) => {
    if (!e.target || e.target.id !== 'wk-q') return;
    state.q = e.target.value;
    paintGroups();
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target, inQ = t && t.id === 'wk-q';
    if (inQ && e.key === 'Escape') { t.value = ''; state.q = ''; paintGroups(); return; }
    if (inQ && e.key === 'Enter') {
      e.preventDefault();
      // إذا طابق البحث تبويباً فرعياً فهو المقصود، لا القسم الذي يحويه
      const first = filterCatalog(catalog(), state.q)[0]?.items[0];
      if (first) { const sub = first.subMatch ? first.subs[0] : null; openItem(first.v, sub?.a, sub?.t); }
      return;
    }
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const q = document.getElementById('wk-q');
    if (!q || (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]'))) return;
    e.preventDefault();
    q.focus();
  });

  // كل شاشة تُفتح من أي مكان تدخل في «الأخيرة»، فهذا الخطاف يمر عند كل رسم للهيكل
  const paintBar = UA.renderWorkspaceTabsBar;
  UA.renderWorkspaceTabsBar = function (view, label) {
    if (S.me && S.me.role !== 'student' && view && view !== 'overview') remember(view);
    return paintBar ? paintBar(view, label) : '';
  };
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); state.q = ''; };
})();
