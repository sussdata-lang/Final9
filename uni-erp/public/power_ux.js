/* power_ux.js — وضع الاستخدام المكثّف للجداول ولوحة المفاتيح (يعمل على كل الجداول دون تعديل الشاشات):
   1) تثبيت عمود «الإجراءات» أثناء التمرير الأفقي داخل .tbl-wrap (ترويسة الجدول مثبّتة أصلاً بالـCSS).
   2) أشرطة تقدّم مدمجة لخلايا النسب (حضور/غياب/تحصيل/نجاح/إنجاز…) وبطاقات KPI، ومؤشر SLA للطلبات (UA.slaCell) بالأخضر/البرتقالي/الأحمر.
      ألوان الغياب تتبع إعداد «الحد الأقصى للغياب قبل الحرمان» (limits.maxAbsence): تنبيه من نصفه، وحرج فوقه.
   3) اختصارات: Alt+N إنشاء جديد في القسم الحالي، Alt+S حفظ النموذج المفتوح، Esc إغلاق النافذة أو إلغاء التحديد أو العودة للقائمة،
      ? دليل الاختصارات. (Ctrl+K للبحث الشامل في shell.js)
   4) تحديد متعدد في كل الجداول: مربع لكل صف داخل الخلية الأولى (فلا تتغير فهارس الأعمدة على فلتر الأعمدة)، «تحديد الكل» في الترويسة
      يشمل الصفوف الظاهرة بعد الفلترة، Shift لتحديد نطاق، Ctrl+A داخل الجدول، وشريط عائم (عدد، تحديد الكل، عكس، إلغاء، نسخ، تصدير CSV).
      الوحدات تقرأ التحديد بـ UA.selection.rows(table) وتستمع للحدث ps:selection.
   استثناء جدول: data-sel="off" (التحديد) أو data-psm="off" (المؤشرات). */
(function () {
  'use strict';
  const UA = (window.UA = window.UA || {});
  const SKIP = '.trp, .sheet-tr, .doc, .a4-body, .kv, .bc-card, .sx-prev, .no-sel, [data-no-sel]';
  const txt = (el) => String(el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.');
  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]');
  const toast = (m) => { try { if (typeof UA.toast === 'function') UA.toast(m); } catch { /* لا شيء */ } };
  const headCells = (t) => [...(t.tHead && t.tHead.rows[0] ? t.tHead.rows[0].cells : [])];
  // أعمدة متسقة: صف ترويسة واحد بلا خلايا مدموجة؛ وإلا نكتفي بالتحديد
  const flatHead = (t, hs) => t.tHead.rows.length === 1 && hs.every((c) => c.colSpan === 1);
  const dataRows = (t, n) => [...t.tBodies].flatMap((b) => [...b.rows]).filter((r) => !r.classList.contains('tf-none') && !r.querySelector(':scope > td.empty') && !(n > 1 && r.cells.length === 1));

  /* ================= 1) تثبيت عمود الإجراءات ================= */
  const ACT_RE = /^(ال)?إجراء(ات)?(\s|$)|^عمليات|^خيارات|^تحكم/;
  const CTL = 'button, a.btn, a.link, select';
  const hasCtl = (c) => !!c && !!c.querySelector(CTL);
  // خلية أزرار فقط: كل نصها من أزرارها (مثل «قسيمة» في مسير الرواتب)
  const ctlOnly = (c) => hasCtl(c) && txt(c).replace(/\s/g, '') === [...c.querySelectorAll(CTL)].map(txt).join('').replace(/\s/g, '');
  function actionsCol(t, hs, rows) {
    const last = hs.length - 1;
    for (let i = last; i >= 0; i--) {
      const h = txt(hs[i]);
      if (ACT_RE.test(h)) return i;
      if (i !== last || !rows.length) continue;
      if (!h && rows.filter((r) => hasCtl(r.cells[i])).length * 2 >= rows.length) return i;
      if (rows.filter((r) => ctlOnly(r.cells[i])).length >= rows.length * 0.8) return i;
    }
    return -1;
  }
  function markActions(t, hs, rows) {
    const wrap = t.closest('.tbl-wrap');
    if (!wrap) return;
    if (t._psAct === undefined) t._psAct = actionsCol(t, hs, rows);
    const i = t._psAct;
    if (i < 0 || !wrap.clientWidth) return;
    // لا نثبّت عموداً عريضاً (أزرار كثيرة) يحجب نصف الجدول الظاهر أو أكثر على الشاشات الضيقة
    const pin = hs[i].offsetWidth <= wrap.clientWidth * 0.45;
    hs[i].classList.toggle('ps-act', pin);
    for (const r of rows) if (r.cells.length === hs.length && r.cells[i]) r.cells[i].classList.toggle('ps-act', pin);
    wrap.classList.toggle('ps-ovf', pin && wrap.scrollWidth > wrap.clientWidth + 1);
  }

  /* ================= 2) المؤشرات البصرية ================= */
  const RATE_RE = /نسبة|حضور|غياب|تحصيل|نجاح|التزام|إنجاز|دوام|تأخير|إشغال|اكتمال|%|٪/;
  const NO_RATE = /حسم|خصم|ضريب|زيادة|علاو|بدل|فائدة|مبلغ|عمولة/;
  const PCT_RE = /^(-?\d+(?:\.\d+)?)\s*[%٪]$/;
  const maxAbs = () => Number(UA.S && UA.S.limits && UA.S.limits.maxAbsence) || 15;
  const kindOf = (label) => (/غياب|تأخير|رسوب|تسرب/.test(label) ? 'abs' : /حضور|دوام|التزام/.test(label) ? 'att' : 'good');
  function tone(kind, v) {
    const max = maxAbs();
    if (kind === 'abs') return v > max ? 'bad' : v >= max / 2 ? 'warn' : 'ok';
    if (kind === 'att') { const a = 100 - v; return a > max ? 'bad' : a >= max / 2 ? 'warn' : 'ok'; }
    return v >= 85 ? 'ok' : v >= 60 ? 'warn' : 'bad';
  }
  const TONE_LABEL = { ok: 'ضمن الحد', warn: 'تنبيه', bad: 'حرج' };
  const meter = (v, tn, extra = '') => `<span class="ps-meter${extra}" data-tone="${tn}" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span>`;
  const pctOf = (el) => { const m = PCT_RE.exec(latin(txt(el))); return m ? Number(m[1]) : null; };

  function meters(t, hs, rows) {
    if (t.dataset.psm === 'off' || !flatHead(t, hs)) return;
    hs.forEach((h, i) => {
      const label = txt(h);
      if (!RATE_RE.test(label) || NO_RATE.test(label)) return;
      const kind = kindOf(label);
      for (const r of rows) {
        const c = r.cells[i];
        if (!c || c.dataset.psm || r.cells.length !== hs.length) continue;
        c.dataset.psm = '1';
        // خلية لها شريطها الخاص (كالتزام الموظفين بعتبات الموارد البشرية): لا نضيف شريطاً ثانياً بعتبات مختلفة
        if (c.querySelector('progress, meter, [style*="width"]')) continue;
        const v = pctOf(c);
        if (v === null) continue;
        const tn = tone(kind, v);
        c.classList.add('ps-mcell');
        c.title = c.title || `${label}: ${v}% — ${TONE_LABEL[tn]}`;
        c.insertAdjacentHTML('beforeend', meter(v, tn));
      }
    });
  }
  function kpiMeters(root) {
    for (const k of root.querySelectorAll('.kpi:not([data-psm]), .es-kpi:not([data-psm]), .stat:not([data-psm])')) {
      k.dataset.psm = '1';
      const num = k.querySelector('.k-num, b, strong'), label = txt(k.querySelector('.k-lbl, small'));
      const v = num ? pctOf(num) : null;
      if (v === null || !RATE_RE.test(label) || NO_RATE.test(label)) continue;
      k.insertAdjacentHTML('beforeend', meter(v, tone(kindOf(label), v), ' ps-kpi'));
    }
  }

  // مؤشر SLA لطلب: المستهلك من مهلة الخدمة (أخضر < 75٪، برتقالي حتى انتهاء المهلة، أحمر بعدها)
  const span = (ms) => { const h = ms / 3600000; return h < 1 ? `${Math.max(1, Math.round(ms / 60000))} د` : h < 48 ? `${Math.round(h)} س` : `${Math.round(h / 24)} يوم`; };
  UA.slaCell = function slaCell(r) {
    const h = Number(r && r.service && (r.service.sla_hours ?? r.service.slaHours));
    if (!h || !r.createdAt) return '<span class="small">—</span>';
    const done = !!r.decidedAt, end = done ? r.decidedAt : r.status === 'review' ? Date.now() : null;
    if (!end) return '<span class="small">—</span>';
    const lim = h * 3600000, used = Math.max(0, end - r.createdAt), ratio = used / lim;
    const tn = ratio >= 1 ? 'bad' : ratio >= 0.75 ? 'warn' : 'ok';
    const label = done ? (ratio >= 1 ? `أُنجز متأخراً ${span(used - lim)}` : 'أُنجز ضمن المهلة') : ratio >= 1 ? `متأخر ${span(used - lim)}` : `متبقٍ ${span(lim - used)}`;
    return `<span class="ps-sla" data-tone="${tn}" title="مهلة الخدمة ${h} ساعة · المستهلك ${Math.round(ratio * 100)}%"><span class="ps-sla-t">${label}</span>${meter(ratio * 100, tn)}</span>`;
  };

  /* ================= 4) التحديد المتعدد ================= */
  const store = new Map();                    // مفتاح الجدول ← مجموعة مفاتيح الصفوف المحددة (تبقى بعد إعادة الرسم)
  let active = null, shiftDown = false;
  const viewKey = () => (UA.S && UA.S.view) || txt(document.querySelector('.tab[aria-selected=true], .nav [aria-current=page], .sx-nav [aria-current=page]'));
  const tableKey = (t, hs) => (t.id || hs.map(txt).join('|')) + '#' + viewKey();
  function rowKey(r) {
    if (r.dataset.id) return 'i' + r.dataset.id;
    const d = r.querySelector('[data-id]');
    if (d) return 'd' + d.dataset.id + ':' + (d.dataset.act || '');
    return 't' + txt(r).slice(0, 160);
  }
  const CHK = (all) => `<label class="ps-chk${all ? ' ps-all' : ''} no-print" title="${all ? 'تحديد الكل / إلغاء التحديد (Shift للنطاق)' : 'تحديد الصف (Shift للنطاق)'}"><input type="checkbox" class="ps-cb" aria-label="${all ? 'تحديد كل الصفوف الظاهرة' : 'تحديد الصف'}"></label>`;

  function selEligible(t, hs, rows) {
    if (t.dataset.sel === 'off' || !hs.length) return false;
    if (t.tHead.querySelector('input[type=checkbox]:not(.ps-cb)') || rows.some((r) => r.cells[0] && r.cells[0].querySelector('input[type=checkbox]:not(.ps-cb)'))) { t.dataset.sel = 'off'; return false; }
    return rows.length > 0;
  }
  function setupSel(t, hs, rows) {
    if (!t._ps) {
      if (!selEligible(t, hs, rows)) return;
      const key = tableKey(t, hs);
      if (!store.has(key)) store.set(key, new Set());
      t._ps = { key, last: -1, n: -1 };
      hs[0].classList.add('ps-c0');
      hs[0].insertAdjacentHTML('afterbegin', CHK(true));
    }
    for (const r of rows) {
      const c = r.cells[0];
      if (!c || c.querySelector(':scope > .ps-chk')) continue;
      r._psk = rowKey(r);
      c.classList.add('ps-c0');
      c.insertAdjacentHTML('afterbegin', CHK(false));
    }
    sync(t);
  }
  function sync(t) {
    const st = t._ps;
    if (!st) return;
    const set = store.get(st.key), rows = dataRows(t, headCells(t).length);
    const present = new Set(rows.map((r) => r._psk));
    for (const k of set) if (!present.has(k)) set.delete(k);
    let n = 0, vis = 0, visSel = 0;
    for (const r of rows) {
      const on = set.has(r._psk), cb = r.cells[0] && r.cells[0].querySelector(':scope > .ps-chk > input');
      if (cb && cb.checked !== on) cb.checked = on;
      r.classList.toggle('ps-sel', on);
      if (on) n++;
      if (!r.hidden) { vis++; if (on) visSel++; }
    }
    const all = t.tHead && t.tHead.querySelector('.ps-all input');
    if (all) { all.checked = vis > 0 && visSel === vis; all.indeterminate = visSel > 0 && visSel < vis; }
    if (n !== st.n) { st.n = n; t.dispatchEvent(new CustomEvent('ps:selection', { bubbles: true, detail: { count: n } })); }
    if (n && (!active || !active.isConnected)) active = t;    // أُعيد رسم الجدول النشط: ننقل المرجع للنسخة الجديدة
    if (t === active) paintBar();
  }
  function setRows(t, rows, on) { const set = store.get(t._ps.key); for (const r of rows) { if (on) set.add(r._psk); else set.delete(r._psk); } }
  const selRows = (t) => (t && t._ps ? dataRows(t, headCells(t).length).filter((r) => store.get(t._ps.key).has(r._psk)) : []);
  function selectAll(t) { setRows(t, dataRows(t, headCells(t).length).filter((r) => !r.hidden), true); active = t; sync(t); }
  function clearSel(t) { if (!t || !t._ps) return; store.get(t._ps.key).clear(); sync(t); }

  // Shift+نقر لتحديد نطاق لا يحدد نصوص الصفحة
  document.addEventListener('mousedown', (e) => { if (e.shiftKey && e.target && e.target.closest && e.target.closest('.ps-chk')) e.preventDefault(); }, true);
  // النقر على المربع لا يصل لمعالج الصف (فتح التفاصيل) ولا لمعالجات data-act العامة
  document.addEventListener('click', (e) => {
    const lab = e.target && e.target.closest && e.target.closest('.ps-chk');
    if (!lab) return;
    shiftDown = e.shiftKey;
    e.stopPropagation();
  }, true);
  document.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb || !cb.classList || !cb.classList.contains('ps-cb')) return;
    e.stopPropagation();
    const t = cb.closest('table'), st = t && t._ps;
    if (!st) return;
    active = t;
    const rows = dataRows(t, headCells(t).length);
    if (cb.closest('.ps-all')) { setRows(t, rows.filter((r) => !r.hidden), cb.checked); st.last = -1; }
    else {
      const r = cb.closest('tr'), i = rows.indexOf(r);
      if (shiftDown && st.last >= 0 && i >= 0) { const [a, b] = i < st.last ? [i, st.last] : [st.last, i]; setRows(t, rows.slice(a, b + 1).filter((x) => !x.hidden), cb.checked); }
      else setRows(t, [r], cb.checked);
      st.last = i;
    }
    shiftDown = false;
    sync(t);
  }, true);

  /* الشريط العائم للتحديد */
  let bar = null;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'ps-float no-print';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'الصفوف المحددة');
    bar.hidden = true;
    bar.innerHTML = `<span class="ps-n" aria-live="polite"></span>
      <button type="button" class="btn sm" data-ps="all">تحديد الكل</button><button type="button" class="btn sm" data-ps="invert">عكس التحديد</button><button type="button" class="btn sm" data-ps="none">إلغاء التحديد <kbd>Esc</kbd></button>
      <span class="ps-sep" aria-hidden="true"></span><button type="button" class="btn sm" data-ps="copy">نسخ</button><button type="button" class="btn sm pri" data-ps="csv">تصدير CSV</button>`;
    bar.addEventListener('click', (e) => {
      const x = e.target.closest('[data-psx]');
      if (x) { e.stopPropagation(); const g = bar._groups && bar._groups[Number(x.dataset.psx)]; if (g) runBulk(g); return; }
      const b = e.target.closest('[data-ps]');
      e.stopPropagation();
      if (!b || !active || !active.isConnected) return;
      const t = active, a = b.dataset.ps;
      if (a === 'all') selectAll(t);
      else if (a === 'none') clearSel(t);
      else if (a === 'invert') { const set = store.get(t._ps.key); for (const r of dataRows(t, headCells(t).length)) if (!r.hidden) { if (set.has(r._psk)) set.delete(r._psk); else set.add(r._psk); } sync(t); }
      else if (a === 'copy') copySel(t);
      else if (a === 'csv') csvSel(t);
    });
    document.body.appendChild(bar);
    return bar;
  }
  /* إجراءات جماعية مطابقة للجدول المعروض: تُشتق من أزرار الصفوف المحددة نفسها (اعتماد العلامة، مراجعة، تفعيل…)
     فلا تُكتب لكل جدول على حدة. الأفعال المسموح بتعميمها قائمة صريحة؛ التعديل والحذف والتفاصيل لا تُعمَّم أبداً.
     والإجراء الذي يحتاج مدخلات (مثل تجديد العقد) يسجّل معالجه في UA.bulkActs[data-act] = { label, run(items) }. */
  const BULK_VERBS = /^(اعتماد|مراجعة|تجديد|تفعيل|تعطيل|إيقاف|قبول|ترحيل|إرسال|تسليم|استلام|إغلاق الإنذار|إعادة فتح|صرف|تسوية)/;
  UA.bulkActs = UA.bulkActs || {};
  const labelOf = (b) => txt(b).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  function bulkGroups(t) {
    const groups = new Map();
    for (const r of selRows(t)) {
      const seen = new Set();
      for (const b of r.querySelectorAll('button[data-act]:not(.ps-cb):not([disabled])')) {
        if (b.classList.contains('bad') || b.classList.contains('dan')) continue;
        const custom = UA.bulkActs[b.dataset.act], label = custom ? custom.label : labelOf(b);
        if (!custom && !BULK_VERBS.test(labelOf(b))) continue;
        const data = { ...b.dataset }, key = `${b.dataset.act}|${label}|${data.stage ?? ''}|${data.on ?? ''}|${data.d ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!groups.has(key)) groups.set(key, { key, act: b.dataset.act, label, custom, items: [] });
        groups.get(key).items.push(data);
      }
    }
    return [...groups.values()];
  }
  // تنتظر الإجراءات المتتالية انتهاء طلب الكتابة السابق فعلاً، لا مهلة ثابتة (الاعتماد يمر بعامل خلفي وقد يطول)
  let inflight = 0;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const mut = String((init && init.method) || (input && input.method) || 'GET').toUpperCase() !== 'GET';
    if (!mut) return nativeFetch(input, init);
    inflight++;
    return nativeFetch(input, init).finally(() => { inflight--; });
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  async function idle(max = 20000) { const t = Date.now(); await pause(150); while (inflight > 0 && Date.now() - t < max) await pause(80); await pause(250); }
  const fireRow = (data) => { const b = document.createElement('button'); b.hidden = true; Object.assign(b.dataset, data); document.body.appendChild(b); b.click(); b.remove(); };
  async function runBulk(g) {
    const n = g.items.length;
    if (!window.confirm(`تنفيذ «${g.label}» على ${n} صفاً محدداً؟`)) return;
    let done = n;
    if (g.custom) done = (await g.custom.run(g.items)) ?? n;
    else {
      const native = window.confirm;
      window.confirm = () => true;           // تأكيدنا أعلاه يغني عن تأكيد كل صف على حدة
      try { for (const d of g.items) { fireRow(d); await idle(); } } finally { window.confirm = native; }
      toast(`أُطلق «${g.label}» على ${n} صفاً؛ ما رفضته قواعد النظام (كفصل المهام) لم يتغير ويظهر سبب رفضه في رسالته`);
    }
    if (active && active.isConnected) clearSel(active);
    return done;
  }
  function paintBulk(t) {
    bar.querySelectorAll('.ps-x').forEach((e) => e.remove());
    const groups = bulkGroups(t);
    bar._groups = groups;
    const anchor = bar.querySelector('[data-ps=copy]');
    groups.forEach((g, i) => anchor.insertAdjacentHTML('beforebegin', `<button type="button" class="btn sm ok ps-x" data-psx="${i}">${esc(g.label)} (${g.items.length})</button>`));
    if (groups.length) anchor.insertAdjacentHTML('beforebegin', '<span class="ps-sep ps-x" aria-hidden="true"></span>');
  }
  function paintBar() {
    const t = active, n = t && t.isConnected && t._ps ? selRows(t).length : 0;
    if (!n) { if (bar) bar.hidden = true; return; }
    ensureBar();
    const total = dataRows(t, headCells(t).length).length;
    bar.querySelector('.ps-n').innerHTML = `<b>${n}</b> محدد من ${total}`;
    paintBulk(t);
    bar.querySelector('[data-ps=all]').hidden = n === total;
    bar.hidden = false;
    // يتوسط منطقة المحتوى لا النافذة كلها (القائمة الجانبية تغطي جزءاً منها)
    const box = (t.closest('.card, section') || t).getBoundingClientRect();
    bar.style.setProperty('--ps-cx', Math.round(box.left + box.width / 2) + 'px');
  }
  // نص الخلية للتصدير: بلا عناصر الزينة (أسهم الترتيب، حرف الصورة الرمزية، الأزرار، المؤشرات) وبفاصل «·» بين الأسطر
  function cellText(c) {
    const x = c.cloneNode(true);
    x.querySelectorAll('.ps-chk, .ps-meter, .arr, .tf-dd, .no-print, svg, [aria-hidden="true"]').forEach((e) => e.remove());
    x.querySelectorAll('i[class]').forEach((e) => { if (txt(e).length <= 2 && txt(x) !== txt(e)) e.remove(); });
    x.querySelectorAll('div, p, li, br').forEach((e) => e.before(' · '));
    return txt(x).replace(/[↕⇅⇕↑↓▲▼]/g, '').replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, '').replace(/(\s*·\s*){2,}/g, ' · ').trim();
  }
  // الأعمدة المصدَّرة: كل الأعمدة إلا عمود الإجراءات والأعمدة بلا عنوان
  function grid(t) {
    const hs = headCells(t), keep = hs.map((h, i) => i !== t._psAct && !!txt(h));
    const head = hs.map(cellText).filter((_, i) => keep[i]);
    const body = selRows(t).map((r) => [...r.cells].map(cellText).filter((_, i) => keep[i]));
    return [head, ...body];
  }
  async function copySel(t) {
    const tsv = grid(t).map((r) => r.join('\t')).join('\n');
    try { await navigator.clipboard.writeText(tsv); toast(`نُسخ ${selRows(t).length} صف — الصقها في Excel مباشرة`); } catch { toast('تعذّر النسخ؛ استخدم تصدير CSV'); }
  }
  function csvSel(t) {
    const q = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = '﻿' + grid(t).map((r) => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `selection-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  UA.selection = { rows: selRows, keys: (t) => (t && t._ps ? [...store.get(t._ps.key)] : []), clear: clearSel, selectAll, active: () => active };

  /* ================= المسح الدوري للجداول ================= */
  let queued = false;
  function scan() {
    queued = false;
    for (const t of document.querySelectorAll('#app table, #layer table')) {
      if (!t.tHead || !t.tBodies.length || t.closest(SKIP)) continue;
      const hs = headCells(t);
      if (!hs.length) continue;
      const rows = dataRows(t, hs.length);
      markActions(t, hs, rows);
      meters(t, hs, rows);
      setupSel(t, hs, rows);
    }
    const app = document.getElementById('app');
    if (app) kpiMeters(app);
    if (active && !active.isConnected) { active = null; paintBar(); }
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  const mine = (n) => n.nodeType === 3 || (n.nodeType === 1 && /(^|\s)(ps-|tf-)/.test(n.className || ''));
  new MutationObserver((ms) => { if (ms.some((m) => ![...m.addedNodes, ...m.removedNodes].every(mine))) queue(); }).observe(document.documentElement, { childList: true, subtree: true });
  // الفلترة تُخفي صفوفاً دون تغيير البنية: نحدّث حالة «تحديد الكل» بعدها
  const resync = () => requestAnimationFrame(() => { for (const t of document.querySelectorAll('#app table, #layer table')) if (t._ps) sync(t); });
  document.addEventListener('input', (e) => { if (e.target && e.target.closest && e.target.closest('.tf-bar, .tf-pop')) resync(); });
  document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('.tf-bar, .tf-pop')) resync(); });
  window.addEventListener('resize', queue);
  queue();

  /* ================= 3) اختصارات لوحة المفاتيح ================= */
  const MODAL = '.modal-back, .modal-bg, .overlay, .m-full, .m-drawer-bd, .sx-slideover-overlay, [role="dialog"][aria-modal="true"]';
  const BACKDROP = '.modal-back, .modal-bg, .overlay, .m-drawer-bd, .sx-slideover-overlay';
  // عناصر تعالج Esc بنفسها (نافذة الأوامر، قائمة فلتر العمود، قائمة الاختيار المنسدلة، نافذة السؤال)
  const SELF_ESC = '#sx-cmd-palette:not([hidden]), #cmd-palette:not([hidden]), .tf-pop, dialog[open], .ua-combo-list';
  function topModal() {
    const list = [...document.querySelectorAll(MODAL)].filter(visible);
    const m = list[list.length - 1];
    return m ? m.closest(BACKDROP) || m : null;
  }
  const btns = (root) => [...root.querySelectorAll('button, a.btn, input[type=submit], [role=button]')].filter((b) => visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
  const label = (b) => txt(b) || b.value || b.getAttribute('aria-label') || b.title || '';

  function closeBtn(root) {
    const list = btns(root);
    return list.find((b) => b !== root && /close|cancel|dismiss/i.test(b.dataset.act || ''))
      || list.find((b) => /^(إغلاق|إلغاء|×|✕|✖|رجوع)$/.test(label(b)) || /إغلاق/.test(b.getAttribute('aria-label') || ''))
      || list.find((b) => b.classList.contains('m-back'));
  }
  const PAGE_SKIP = '.sx-side, .sx-nav, .sx-top, .top, nav, .sub-tabs, #ws-tabs-bar, .tf-bar, .ps-float, .pager, tbody, .ux-dev-switch';
  function backBtn() {
    const app = document.getElementById('app');
    if (!app) return null;
    return btns(app).find((b) => !b.closest(PAGE_SKIP) && (/(^|-)back$|^back/i.test(b.dataset.act || '') || /^[→←‹›«»\s]*(رجوع|عودة|العودة|الرجوع)/.test(label(b))));
  }

  // العودة بعد Alt+N: نحفظ عنصر التنقل النشط قبل الإنشاء (بخصائص data-*) ونعيد النقر عليه عند Esc ما لم يتنقل المستخدم بنفسه
  const NAV_CUR = ['[data-sx="sub"][aria-current="true"]', '.sub-tabs [aria-pressed="true"]', '.sub-tabs .chip.on', '[aria-current="page"]'];
  const NAV_CLICK = '[data-sx], [data-act="view"], .sub-tabs button, .sx-nav button, .sx-sub-list button';
  let returnTo = null;
  const curNav = () => { for (const s of NAV_CUR) { const el = [...document.querySelectorAll(s)].find(visible); if (el && Object.keys(el.dataset).length) return { tag: el.tagName, data: { ...el.dataset } }; } return null; };
  const findNav = (d) => [...document.querySelectorAll(d.tag)].find((e) => { const k = Object.keys(e.dataset); return k.length === Object.keys(d.data).length && k.every((x) => e.dataset[x] === d.data[x]); });
  document.addEventListener('click', (e) => { if (e.isTrusted && e.target && e.target.closest && e.target.closest(NAV_CLICK)) returnTo = null; }, true);

  const NEW_RE =/^[+＋➕]|(^|\s)(جديد|جديدة)(\s|$)|^(إضافة|أضف|إنشاء)(\s|$)/;
  const NEW_NO = /خروج|حذف|إلغاء|بحث|فلتر|تصدير|طباعة|استيراد/;
  function newBtn() {
    const app = document.getElementById('app');
    if (!app) return null;
    let best = null, score = -1;
    for (const b of btns(app)) {
      if (b.closest(PAGE_SKIP)) continue;
      const l = label(b), act = b.dataset.act || '';
      if (NEW_NO.test(l)) continue;
      const byAct = /(^|[-_])(new|add|create)|(new|create)$/i.test(act) && !/(del|remove|cancel)/i.test(act);
      if (!byAct && !NEW_RE.test(l)) continue;
      const s = (byAct ? 3 : 0) + (/^[+＋➕]/.test(l) ? 2 : 0) + (b.classList.contains('pri') ? 1 : 0);
      if (s > score) { score = s; best = b; }
    }
    return best;
  }

  const SAVE_RE = /^[💾✅✔️\s]*(حفظ|اعتماد|تأكيد|إرسال|تقديم|إنشاء|إضافة|تسجيل|تحديث|نشر|إصدار)/;
  const SAVE_NO = /إلغاء|إغلاق|حذف|رفض|خروج|طباعة|تصدير|رجوع|بحث/;
  function saveBtn() {
    let scope = topModal();
    const ae = document.activeElement;
    if (!scope && ae && ae !== document.body) scope = ae.closest('form, .form, .modal, .ux-drawer, .card, section');
    if (!scope) scope = [...document.querySelectorAll('#app form, #app .form, .ux-drawer')].find(visible) || null;
    if (!scope) return null;
    let best = null, score = -1;
    for (const b of btns(scope)) {
      const l = label(b);
      if (SAVE_NO.test(l) || !SAVE_RE.test(l)) continue;
      const s = (/^[💾\s]*حفظ/.test(l) ? 3 : 0) + (b.classList.contains('pri') ? 2 : 0) + (b.type === 'submit' && b.form ? 1 : 0);
      if (s > score) { score = s; best = b; }
    }
    return best;
  }
  function press(b) {
    const ae = document.activeElement, sig = { act: b.dataset.act, id: b.dataset.id, l: label(b) };
    // نُنهي التحرير أولاً ليصل حدث change لمعالجات النموذج، ثم نضغط الزر (أو نظيره إن أُعيد الرسم)
    if (ae && ae.matches && ae.matches('input, textarea, select') && ae !== b) ae.blur();
    setTimeout(() => {
      const again = b.isConnected ? b : btns(document).find((x) => x.dataset.act === sig.act && x.dataset.id === sig.id && label(x) === sig.l);
      if (again) { again.focus({ preventScroll: true }); again.click(); }
    }, 0);
  }

  function onEsc(e) {
    if ([...document.querySelectorAll(SELF_ESC)].some(visible) || (e.target && e.target.closest && e.target.closest('.tf-bar, .tf-pop'))) return;
    const m = topModal();
    if (m) {
      if (m.closest('#layer')) return;            // app.js يُفرغ #layer بنفسه
      const b = closeBtn(m);
      if (b) b.click();
      else if (m.dataset.act) m.click();          // الخلفية نفسها تُغلق عند النقر عليها
      else return;
      returnTo = null;                            // الإنشاء كان في نافذة؛ أُغلقت فلا شاشة نعود منها
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (document.querySelector('.ux-drawer')) return;   // ux_flow يغلق لوحة التفاصيل
    if (active && active.isConnected && selRows(active).length) { clearSel(active); e.preventDefault(); return; }
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches('input, textarea, select') && ae.closest('#app')) { ae.blur(); return; }
    const b = backBtn();
    if (b) { e.preventDefault(); returnTo = null; b.click(); return; }
    if (returnTo) {
      const el = findNav(returnTo);
      returnTo = null;
      if (el && visible(el)) { e.preventDefault(); el.click(); }
    }
  }

  let help = null;
  function toggleHelp() {
    if (help) { help.remove(); help = null; return; }
    help = document.createElement('div');
    help.className = 'ps-help no-print';
    help.setAttribute('role', 'dialog');
    help.setAttribute('aria-modal', 'true');
    help.setAttribute('aria-label', 'اختصارات لوحة المفاتيح');
    const rows = [['Ctrl', 'K', 'البحث الشامل والانتقال لأي مكان'], ['Alt', 'N', 'إنشاء عنصر جديد في القسم الحالي'], ['Alt', 'S', 'حفظ النموذج المفتوح'], ['', 'Esc', 'إغلاق النافذة / إلغاء التحديد / العودة للقائمة'],
      ['Shift', 'نقر', 'تحديد نطاق من الصفوف'], ['Ctrl', 'A', 'تحديد كل صفوف الجدول (والتركيز داخله)'], ['Alt', '1…9', 'التبويبات الفرعية'], ['', '?', 'هذا الدليل']];
    help.innerHTML = `<div class="ps-help-box"><header><h2>اختصارات لوحة المفاتيح</h2><button type="button" class="btn sm" data-ps-help-close aria-label="إغلاق">إغلاق</button></header>
      <dl>${rows.map(([m, k, d]) => `<dt>${m ? `<kbd>${m}</kbd>+` : ''}<kbd>${k}</kbd></dt><dd>${d}</dd>`).join('')}</dl></div>`;
    help.addEventListener('click', (e) => { if (e.target === help || e.target.closest('[data-ps-help-close]')) toggleHelp(); });
    document.body.appendChild(help);
    help.querySelector('[data-ps-help-close]').focus();
  }

  const typing = (el) => !!el && el.matches && (el.matches('input:not([type=checkbox]):not([type=radio]), textarea, select') || el.isContentEditable);
  window.addEventListener('keydown', (e) => {
    if (e.isComposing || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      if (help) { e.preventDefault(); e.stopPropagation(); toggleHelp(); return; }
      onEsc(e);
      return;
    }
    const alt = e.altKey && !e.ctrlKey && !e.metaKey;
    // نقرأ code لا key: في اللوحة العربية N وS تعطيان «ى» و«س»
    if (alt && e.code === 'KeyN') {
      e.preventDefault();
      if (topModal()) { toast('أغلق النافذة المفتوحة أولاً (Esc)'); return; }
      const b = newBtn();
      if (b) { returnTo = curNav(); press(b); } else toast('لا يوجد إجراء إنشاء في هذا القسم');
      return;
    }
    if (alt && e.code === 'KeyS') {
      e.preventDefault();
      const b = saveBtn();
      if (b) press(b); else toast('لا يوجد نموذج مفتوح للحفظ');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyA' && !typing(e.target)) {
      const t = (e.target.closest && e.target.closest('table')) || (active && active.isConnected ? active : null);
      if (t && t._ps) { e.preventDefault(); selectAll(t); }
      return;
    }
    if ((e.key === '?' || e.key === '؟') && !e.ctrlKey && !e.altKey && !e.metaKey && !typing(e.target)) { e.preventDefault(); toggleHelp(); }
  }, true);
})();
