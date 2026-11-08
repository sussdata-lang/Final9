/* انسيابية الواجهة، إضافة فوق الموجود ولا تحذف شيئاً منه:
   - التبويبات في سطر واحد قابل للتمرير مع مؤشر ذهبي ينزلق بينها.
   - تبديل التبويب يبقي شريط التبويبات في موضعه على الشاشة بدل القفز.
   - نص «جارٍ التحميل» يُعرض هيكلاً مؤقتاً، ويبقى النص لقارئ الشاشة، مع شريط تقدم عند التنقل.
   - قرار الطلب يُرسل بعد مهلة تراجع قصيرة: لا تراجع عن إصدار الوثيقة في الخادم، فالتراجع يسبق الإرسال. */
(function () {
  const UA = window.UA, { S, api, esc, toast } = UA;
  const EXTRA_TAB_ACTS = ['hrtab', 'crfilter', 'actab', 'admtab', 'audtab'];
  const LOADING_TEXTS = new Set(['جارٍ التحميل…', 'جارٍ التحميل...', 'Loading…', 'Loading...']);
  const UNDO_MS = 6000;

  const tabActs = () => {
    if (tabActs.set) return tabActs.set;
    const set = new Set(EXTRA_TAB_ACTS);
    const cat = (UA.gate && UA.gate.TABS) || {};
    for (const list of Object.values(cat)) for (const t of list) set.add(t[0]);
    if (UA.gate) tabActs.set = set;
    return set;
  };

  /* ---------- سطر التبويبات والمؤشر ---------- */
  const lastMarker = new Map(), lastScroll = new Map();
  const ACTIVE = '[aria-pressed="true"],[aria-selected="true"],[aria-current="true"],.on,.active,.btn.pri';
  const keyOf = (bar) => { const t = bar.querySelector(':scope > [data-act]'); return t ? t.dataset.act : bar.classList.contains('v12-tabs') ? 'v12-tabs' : ''; };

  function tabBars() {
    const main = document.querySelector('.sx-main');
    if (!main) return [];
    const bars = new Set(main.querySelectorAll('.sub-tabs, .sx-tabs, .v12-tabs, [role="tablist"]'));
    const acts = tabActs();
    for (const el of main.querySelectorAll('[data-act]')) {
      if (!acts.has(el.dataset.act)) continue;
      const p = el.parentElement;
      if (p && !bars.has(p) && p.children.length >= 3 && [...p.children].filter((c) => c.dataset && acts.has(c.dataset.act)).length >= 3 && (p.classList.contains('ux-tabline') || getComputedStyle(p).display === 'flex')) bars.add(p);
    }
    return [...bars].filter((b) => !b.closest('table, .wk-subs') && b.querySelectorAll(':scope > button, :scope > a').length >= 2);
  }
  function fadeState(bar) {
    const max = bar.scrollWidth - bar.clientWidth;
    if (max <= 1) { delete bar.dataset.fade; return; }
    const pos = Math.abs(bar.scrollLeft);   // المتصفحات تعطي قيمة سالبة في الاتجاه من اليمين
    const atStart = pos <= 1, atEnd = pos >= max - 1;
    bar.dataset.fade = atStart ? 'end' : atEnd ? 'start' : 'both';
  }
  function placeMarker(bar) {
    const key = keyOf(bar);
    let m = bar.querySelector(':scope > .ux-tab-marker');
    const active = bar.querySelector(`:scope > ${ACTIVE.split(',').join(', :scope > ')}`);
    if (!active) { if (m) m.hidden = true; return; }
    if (!m) { m = document.createElement('i'); m.className = 'ux-tab-marker'; m.setAttribute('aria-hidden', 'true'); bar.appendChild(m); }
    m.hidden = false;
    const next = { x: active.offsetLeft, w: active.offsetWidth }, prev = lastMarker.get(key);
    if (prev && (m.dataset.x === undefined) && (prev.x !== next.x || prev.w !== next.w)) {
      m.style.transition = 'none';
      m.style.transform = `translateX(${prev.x}px) scaleX(${prev.w})`;
      m.getBoundingClientRect();
      m.style.transition = '';
    }
    if (m.dataset.x !== String(next.x) || m.dataset.w !== String(next.w)) {
      m.style.transform = `translateX(${next.x}px) scaleX(${next.w})`;
      m.dataset.x = next.x; m.dataset.w = next.w;
    }
    lastMarker.set(key, next);
  }
  function revealActive(bar) {
    const active = bar.querySelector(`:scope > ${ACTIVE.split(',').join(', :scope > ')}`);
    if (!active) return;
    const b = bar.getBoundingClientRect(), a = active.getBoundingClientRect();
    if (a.left < b.left + 8) bar.scrollLeft -= b.left + 8 - a.left;
    else if (a.right > b.right - 8) bar.scrollLeft += a.right - b.right + 8;
  }
  function decorate() {
    for (const bar of tabBars()) {
      const key = keyOf(bar);
      if (!bar.classList.contains('ux-tabline')) {
        bar.classList.add('ux-tabline');
        if (lastScroll.has(key)) bar.scrollLeft = lastScroll.get(key);
        bar.addEventListener('scroll', () => { lastScroll.set(key, bar.scrollLeft); fadeState(bar); }, { passive: true });
        revealActive(bar);
      }
      placeMarker(bar);
      fadeState(bar);
    }
  }

  /* ---------- تبويبات القسم في القائمة الجانبية لكل الأقسام ---------- */
  // تُنسخ من شريط الصفحة نفسه فتشمل كل ما يراه الحساب، والضغط عليها يضغط زر الشريط فيبقى مسار كل تبويب كما هو.
  // الشريط يبقى في الصفحة ويُخفى على الشاشات الكبيرة فقط، ويعود عند طي القائمة وعلى الهاتف.
  let primary = null;
  const tabLabel = (b) => { const c = b.cloneNode(true); c.querySelectorAll('kbd, .badge-n, .ux-tab-marker').forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  function mirrorTabs() {
    const nav = document.querySelector('.sx-nav'), cur = nav && nav.querySelector(':scope > button[aria-current="page"]');
    if (!cur || !UA.gate) return;
    const acts = new Set((UA.gate.TABS[S.view] || []).map((t) => t[0]));
    const isV12 = [...acts].some((a) => a.startsWith('v12:'));
    primary = tabBars().find((b) => (isV12 ? keyOf(b) === 'v12-tabs' : acts.has(keyOf(b)))) || null;
    const native = [...nav.querySelectorAll('.sx-sub-list')].find((l) => !l.classList.contains('ux-mirror'));
    if (native) { if (primary) primary.classList.add('ux-in-side'); return; }
    let list = nav.querySelector('.ux-mirror');
    if (!primary) { if (list) list.remove(); return; }
    primary.classList.add('ux-in-side');
    const tabs = [...primary.querySelectorAll(':scope > button, :scope > a')];
    const shown = (b) => !b.hidden && getComputedStyle(b).display !== 'none' && (!b.dataset.act || !b.dataset.t || UA.gate.allowed(b.dataset.act, b.dataset.t, S.me));   // ما حجبته بوابة الصلاحيات لا يُنسخ
    const sig = S.view + tabs.map((b) => (shown(b) ? tabLabel(b) : '') + (b.matches(ACTIVE) ? '*' : '')).join('|');
    if (list && list.dataset.sig === sig && list.previousElementSibling === cur) return;
    if (list) list.remove();
    list = document.createElement('div');
    list.className = 'sx-sub-list ux-mirror';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', cur.textContent.trim());
    list.dataset.sig = sig;
    list.innerHTML = tabs.map((b, i) => { if (!shown(b)) return ''; const badge = b.querySelector('.badge-n'); const lbl = tabLabel(b), sx = UA.sx || {}; return `<button type="button" data-ux-sub="${i}"${b.matches(ACTIVE) ? ' aria-current="true"' : ''}>${sx.subIcon ? sx.subIcon(b.dataset.t || b.dataset.s || '', lbl) : ''}<span>${esc(sx.subLabel ? sx.subLabel(lbl) : lbl)}</span>${badge ? `<small>${esc(badge.textContent)}</small>` : ''}</button>`; }).join('');
    cur.after(list);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-ux-sub]');
    if (!b || !primary) return;
    const tab = primary.querySelectorAll(':scope > button, :scope > a')[Number(b.dataset.uxSub)];
    if (!tab) return;
    pageIn = true;
    tab.click();
    window.scrollTo(0, 0);
  });

  /* ---------- سلاسة التنقل: استجابة فورية عند الضغط، ثم يدخل المحتوى الجديد بتلاشٍ قصير ---------- */
  let pageIn = false, lastPageView = null, leaveTimer = 0;
  function leavePage() {
    const page = document.querySelector('.sx-page');
    if (page) page.classList.add('ux-leaving');
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { const p = document.querySelector('.sx-page'); if (p) p.classList.remove('ux-leaving'); }, 4000);
  }
  function enterPage() {
    const page = document.querySelector('.sx-page');
    if (!page) return;
    if (pageIn || lastPageView !== S.view) { page.classList.add('ux-page-in'); pageIn = false; lastPageView = S.view; }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.sx-nav [data-act="view"], .sx-nav [data-sx="sub"], .sx-nav .sx-sub-list [data-act]');
    if (!b) return;
    if (b.dataset.act === 'view' && b.dataset.v !== S.view) {
      const nav = b.closest('.sx-nav');
      nav.querySelectorAll(':scope > button[aria-current="page"]').forEach((x) => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'page');
      queue();
    }
    pageIn = true;
    leavePage();
  }, true);
  // بيانات أثقل الشاشات تُجلب عند مرور المؤشر فوق القائمة، فتفتح الشاشة من الذاكرة المؤقتة عند الضغط
  const WARM = { overview: ['/api/analytics', '/api/stats', '/api/requests', '/api/me/desk'], affairs: ['/api/requests', '/api/stats'] };
  const warmedAt = new Map();
  document.addEventListener('pointerover', (e) => {
    const b = e.target.closest && e.target.closest('.sx-nav [data-act="view"]');
    const urls = b && WARM[b.dataset.v];
    if (!urls || b.dataset.v === S.view || Date.now() - (warmedAt.get(b.dataset.v) || 0) < 10000) return;
    warmedAt.set(b.dataset.v, Date.now());
    for (const u of urls) api('GET', u).catch(() => {});
  }, { passive: true });

  /* ---------- تثبيت موضع الشاشة عند تبديل التبويب ---------- */
  let anchor = null;
  function holdAnchor() {
    if (!anchor) return;
    if (Date.now() > anchor.expires) { releaseAnchor(); return; }
    const bar = tabBars().find((b) => keyOf(b) === anchor.key);
    if (!bar || bar === anchor.el) return;   // ما زالت الشاشة القديمة ظاهرة حتى ينتهي التحميل
    if (!anchor.settled) {
      anchor.settled = Date.now() + 260;
      anchor.expires = anchor.settled;
      let n = bar.nextElementSibling;
      while (n) { n.classList.add('ux-tab-in'); n = n.nextElementSibling; }
    }
    const delta = bar.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
    requestAnimationFrame(holdAnchor);
  }
  function releaseAnchor() {
    const main = document.querySelector('.sx-main');
    if (main) main.style.minHeight = '';
    anchor = null;
  }

  /* ---------- الهيكل المؤقت ---------- */
  function paintSkeletons() {
    for (const el of document.querySelectorAll('.sx-main .empty, .sx-main p.hint, #layer .empty, #layer p.hint')) {
      if (el.dataset.uxSkel || el.children.length || !LOADING_TEXTS.has(el.textContent.trim())) continue;
      el.dataset.uxSkel = '1';
      const text = el.textContent.trim();
      el.setAttribute('aria-busy', 'true');
      el.classList.add('ux-skel');
      el.innerHTML = `<span class="ux-sr">${esc(text)}</span><i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i>`;
    }
  }

  /* ---------- شريط التقدم عند التنقل ---------- */
  let busyTimer = 0, busyEnd = 0;
  const clearBusy = () => { clearTimeout(busyTimer); clearTimeout(busyEnd); document.body.classList.remove('ux-busy'); };
  function markBusy() {
    clearBusy();
    busyTimer = setTimeout(() => {
      document.body.classList.add('ux-busy');
      busyEnd = setTimeout(clearBusy, 5000);
    }, 120);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act, bar = el.closest('.ux-tabline');
    if (a === 'view' || tabActs().has(a)) markBusy();
    if (!bar || !window.scrollY) return;
    const main = document.querySelector('.sx-main');
    if (main) main.style.minHeight = `${main.offsetHeight}px`;   // المحتوى الأقصر لا يدفع الصفحة إلى الأعلى
    anchor = { key: keyOf(bar), el: bar, top: bar.getBoundingClientRect().top, expires: Date.now() + 4000 };
    requestAnimationFrame(holdAnchor);
  }, true);

  /* ---------- الطلب في اللوحة الجانبية ---------- */
  // تُنقل إلى حاوية تحت body: بعض حاويات الصفحة تصير مرجعاً للتموضع الثابت فتبتعد اللوحة عن حافة الشاشة
  function mountDrawer() {
    let host = document.getElementById('ux-drawer-host');
    if (!host) { host = document.createElement('div'); host.id = 'ux-drawer-host'; document.body.appendChild(host); }
    const next = document.querySelector('#app .ux-drawer');
    if (next) host.replaceChildren(next);   // الخطاف يعمل مرتين لكل رسم: غياب لوحة جديدة لا يعني إغلاق القائمة
    else if (!S.drawerFor || S.view !== 'affairs' || S.stTab !== 'requests') host.replaceChildren();
    const d = host.querySelector('.ux-drawer[data-fresh="1"]');
    if (d) { const h = d.querySelector('h2'); if (h) h.focus({ preventScroll: true }); setTimeout(() => d.removeAttribute('data-fresh'), 300); }
  }
  function closeDetail() {
    const id = S.sel;
    S.sel = null; S.rej = null;
    UA.render();
    const row = id && document.querySelector(`tr.row[data-id="${id}"]`);
    if (row) row.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('.ux-drawer') && !document.querySelector('#layer > *')) { closeDetail(); return; }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr.row[data-act]')) e.target.click();
  });

  /* ---------- مهلة التراجع قبل إرسال القرار ---------- */
  const pending = new Map();
  const sessionHeaders = () => ({ 'Content-Type': 'application/json' });
  const decisionBody = (p) => (p.action === 'reject' ? { reason: p.reason } : {});
  function undoToast(id, label) {
    const host = document.getElementById('ux-undo-host') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'ux-undo-host', className: 'ux-undo-host' });
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    const t = document.createElement('div');
    t.className = 'ux-undo';
    t.dataset.id = id;
    t.style.setProperty('--ux-undo-ms', `${UNDO_MS}ms`);
    t.innerHTML = `<span>${esc(label)}</span><button type="button" class="btn sm" data-act="requndo" data-id="${esc(id)}">تراجع</button><i aria-hidden="true"></i>`;
    host.appendChild(t);
  }
  const dropToast = (id) => { const t = document.querySelector(`.ux-undo[data-id="${id}"]`); if (t) t.remove(); };
  async function commit(id) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    dropToast(id);
    try {
      await api('POST', `/api/requests/${id}/${p.action}`, decisionBody(p));
      toast(p.action === 'approve' ? 'تم الاعتماد وإصدار الوثيقة' : 'تم رفض الطلب');
    } catch (err) {
      toast(err.message);
    }
    if (S.view === 'affairs') { await UA.loadFor('affairs'); UA.render(); }
  }
  UA.flow = {
    isPending: (id) => pending.has(String(id)),
    pendingAction: (id) => (pending.get(String(id)) || {}).action,
    decide(idRaw, action, reason) {
      const id = String(idRaw);
      if (pending.has(id)) return;
      pending.set(id, { action, reason, timer: setTimeout(() => commit(id), UNDO_MS) });
      undoToast(id, action === 'approve' ? 'سيُعتمد الطلب وتصدر الوثيقة خلال ثوانٍ' : 'سيُرفض الطلب خلال ثوانٍ');
      UA.render();
    },
    undo(idRaw) {
      const id = String(idRaw), p = pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(id);
      dropToast(id);
      toast('أُلغي القرار، ولم يُرسل شيء');
      UA.render();
    },
    // قبل الخروج من الحساب تُرسل القرارات المعلقة، فالموظف لم يتراجع عنها
    flush: () => Promise.all([...pending.keys()].map(commit)),
    closeDetail,
  };
  Object.assign(UA.actions, {
    requndo: (el, d) => UA.flow.undo(d.id),
    reqclose: () => closeDetail(),
  });
  // إغلاق الصفحة أثناء المهلة: يُرسل القرار لأن الموظف لم يتراجع عنه
  window.addEventListener('pagehide', () => {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      try { fetch(`/api/requests/${id}/${p.action}`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: sessionHeaders(), body: JSON.stringify(decisionBody(p)) }); } catch { /* لا بديل عند الإغلاق */ }
    }
    pending.clear();
  });

  /* ---------- التشغيل بعد كل رسم وعند ظهور محتوى لاحق ---------- */
  const prevAfter = UA.afterRenderEnhance;
  let queued = false;
  const pass = () => { queued = false; decorate(); mirrorTabs(); paintSkeletons(); };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(pass); } };
  UA.afterRenderEnhance = function () {
    if (prevAfter) prevAfter();
    clearBusy();
    clearTimeout(leaveTimer);
    decorate();
    mirrorTabs();
    enterPage();
    queue();
    if (anchor) holdAnchor();
    mountDrawer();
  };
  const start = () => {
    new MutationObserver((list) => {
      if (list.every((m) => [...m.addedNodes].every((n) => n.classList && n.classList.contains('ux-tab-marker')))) return;
      queue();
      if (anchor) requestAnimationFrame(holdAnchor);
    }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
    window.addEventListener('resize', queue);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
    queue();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
