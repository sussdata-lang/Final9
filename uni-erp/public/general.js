/* «الإعدادات العامة» في لوحة الإدارة: تبويب لكل قسم يعرض كل ما كان ثابتاً في النظام ويسمح بتعديله،
   مع مدير تفاعلي لجميع القوائم المنسدلة لإضافة أو تعديل أو حذف أي خيار فوراً. */
(function () {
  const UA = window.UA, { api, esc, toast } = UA;
  const fresh = () => ({ tab: 'index', cfg: null, err: '', busy: false });
  const B = fresh();
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const $id = (i) => document.getElementById(i);
  const fid = (k) => 'g-' + k.replace(/\./g, '-');
  // روابط الأقسام التي تُدار من صفحاتها (دمج وحدات النظام والتحقق العام في الإدارة، والمراسلات مع الطلبات الداخلية)
  const LINKS = [
    ['الأكاديمي: الكليات والبرامج والسنوات الدراسية والفصول', 'programs', 'admin'],
    ['الخدمات ونماذج الطلبات (المدة والحقول والمرفقات)', 'services', 'admin'],
    ['اللجنة التأديبية وسجل اللجان الانضباطية والمخالفات', 'lifecycle', 'affairs'],
    ['وحدات النظام الجامعي (5.1–5.17)', 'units', 'admin'],
    ['التحقق العام والوثائق الرقمية', 'verify', 'admin'],
    ['قواعد الفحص الآلي', 'rules', 'admin'],
    ['إعداداتي الشخصية وكلمة المرور', 'mysettings', 'admin'],
    ['النسخ الاحتياطي', 'backup', 'admin'],
    ['الحسابات والأدوار والصلاحيات', null, 'access'],
    ['الديوان والمراسلات والطلبات الداخلية', null, 'corr'],
    ['شؤون الموظفين والرواتب والبصمة والتقييم', null, 'payroll'],
  ];

  async function load() { B.cfg = await api('GET', '/api/admin/general'); }
  const visibleTabs = () => (B.cfg ? B.cfg.tabs.filter((t) => t.key !== 'institution') : []);
  const tabOf = () => visibleTabs().find((t) => t.key === B.tab) || null;

  function control(it) {
    const id = fid(it.key), v = it.value;
    if (it.type === 'int') return `<span class="g-num"><input id="${id}" type="number" inputmode="numeric" min="${it.min}" max="${it.max}" value="${esc(v)}">${it.unit ? `<em>${esc(it.unit)}</em>` : ''}</span>`;
    if (it.type === 'text') return `<input id="${id}" maxlength="${it.max ?? 200}" value="${esc(v)}">`;
    if (it.type === 'select') return `<select id="${id}">${it.options.map((o) => `<option value="${esc(o.value)}"${o.value === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    if (it.type === 'bool') return `<input id="${id}" type="checkbox"${v ? ' checked' : ''}>`;
    const arr = Array.isArray(v) ? v : [];
    const chips = arr.map((opt, idx) => `<span class="chip" style="display:inline-flex;align-items:center;gap:6px;margin:2px;background:#F6F8F5;border:1px solid #A8D8BE;color:#054239;font-size:12px;padding:3px 9px;border-radius:6px">
      <span>${esc(opt)}</span>
      <button type="button" class="link" data-act="glistedit" data-k="${esc(it.key)}" data-i="${idx}" title="تعديل الخيار" style="color:#047857;font-weight:700;text-decoration:none">✎</button>
      <button type="button" class="link" data-act="glistdel" data-k="${esc(it.key)}" data-i="${idx}" title="حذف الخيار" style="color:#B3261E;font-weight:700;text-decoration:none">×</button>
    </span>`).join('');
    return `<div class="g-list-mgr" style="display:flex;flex-direction:column;gap:8px;width:100%">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input id="${id}-add" type="text" maxlength="${it.itemMax || 60}" placeholder="أضف خياراً جديداً إلى «${esc(it.label)}»..." style="flex:1;min-width:180px">
        <button type="button" class="btn sm pri" data-act="glistadd" data-k="${esc(it.key)}">+ إضافة للقائمة</button>
        <button type="button" class="btn sm" data-act="glistother" data-k="${esc(it.key)}" title="تضمين خيار (أخرى) في هذه القائمة">+ خيار «أخرى»</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px;background:#F6F8F5;border:1px dashed #DCE3DD;border-radius:8px;max-height:150px;overflow:auto">${chips || '<span class="small">لا توجد عناصر</span>'}</div>
      <details class="small"><summary style="cursor:pointer;font-weight:600;color:#054239">تحرير نصي مباشر (سطر لكل خيار — ${arr.length} خياراً حالياً)</summary>
        <textarea id="${id}" rows="${Math.min(12, Math.max(4, arr.length + 1))}" spellcheck="false" style="margin-top:6px;width:100%">${esc(arr.join('\n'))}</textarea>
      </details>
    </div>`;
  }
  function item(it) {
    const def = it.type === 'list' ? `${it.default.length} عنصراً` : it.type === 'select' ? (it.options.find((o) => o.value === it.default) || {}).label : String(it.default);
    return `<div class="g-item${it.changed ? ' chg' : ''}"><div class="g-l"><label for="${fid(it.key)}"><b>${esc(it.label)}</b> ${it.type === 'list' ? '<span class="pill p-approved" style="font-size:10px">قائمة منسدلة قابلة للتعديل</span>' : ''}</label>${it.hint ? `<span class="small">${esc(it.hint)}</span>` : ''}
      <span class="small g-def">الافتراضي: ${esc(def)}${it.unit ? ' ' + esc(it.unit) : ''}${it.customDefault ? ` <span class="pill p-review" style="font-size:10px">مخصص</span>` : ''}${it.changed ? ` · <button type="button" class="link" data-act="gres" data-k="${esc(it.key)}">إعادة إلى الافتراضي</button>` : ''}</span>
      ${it.canSetDefault ? `<span class="small g-def"><button type="button" class="link" data-act="gmkdef" data-k="${esc(it.key)}" title="القيمة المكتوبة في الحقل تصبح الافتراضية، فتعود إليها «إعادة إلى الافتراضي»">★ جعل القيمة الحالية افتراضية</button>${it.customDefault ? ` · <button type="button" class="link" data-act="gfactory" data-k="${esc(it.key)}">استعادة قيمة المصنع كافتراضي (${esc(String(it.factoryDefault))}${it.unit ? ' ' + esc(it.unit) : ''})</button>` : ''}</span>` : ''}</div>
      <div class="g-c">${control(it)}</div></div>`;
  }
  function indexTab() {
    const tabs = visibleTabs();
    const listItems = tabs.flatMap((t) => t.items.filter((i) => i.type === 'list').map((i) => ({ ...i, tabKey: t.key, tabLabel: t.label })));
    const cards = tabs.map((t) => { const n = t.items.filter((i) => i.changed).length;
      return `<button class="g-card" data-act="gtab" data-t="${t.key}"><b>${esc(t.label)}</b><span class="small">${esc(t.desc)}</span><span class="small">${t.items.length} إعداداً${n ? ` · <em class="g-badge">${n} معدَّل</em>` : ''}</span></button>`; }).join('');
    const links = LINKS.map(([l, t, v]) => `<button class="link g-link" data-act="${t ? 'gadmin' : 'view'}" data-v="${v}"${t ? ` data-t="${t}"` : ''}>${esc(l)} ←</button>`).join('');
    const quickLists = listItems.map((it) => `<div style="padding:10px 12px;border:1px solid #DCE3DD;border-radius:10px;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div><b>${esc(it.label)}</b> <span class="small">(${esc(it.tabLabel)} · ${(it.value || []).length} خياراً)</span><div class="small" style="color:#566660;margin-top:2px">${esc((it.value || []).slice(0, 6).join('، '))}${(it.value || []).length > 6 ? '…' : ''}</div></div>
      <button type="button" class="btn sm pri" data-act="gtab" data-t="${esc(it.tabKey)}">تعديل وإضافة خيارات</button>
    </div>`).join('');
    return `<section class="card"><h2>الإعدادات العامة وإدارة القوائم المنسدلة</h2><p class="hint">جميع القوائم المنسدلة وحدود النظام قابلة للتعديل والإضافة المباشرة من هنا. التغييرات تسري فوراً على كافة النماذج وتُسجَّل في سجل التدقيق.</p><div class="g-cards">${cards}</div></section>
      <section class="card" style="margin-top:16px"><h3>جميع القوائم المنسدلة في النظام (${listItems.length} قائمة قابلة للتعديل والإضافة)</h3><p class="small">يمكنك إضافة خيارات جديدة أو تعديل الخيارات الحالية أو تفعيل بند «أخرى» في أي قائمة منسدلة:</p><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:10px;margin-top:10px">${quickLists}</div></section>
      <section class="card" style="margin-top:16px"><h3>أقسام مرتبطة في الإدارة</h3><div class="g-links">${links}</div></section>`;
  }
  function sectionTab(t) {
    return `<section class="card"><h2>${esc(t.label)}</h2><p class="hint">${esc(t.desc)}</p>
      <form id="gform" class="g-form">${t.items.map(item).join('')}${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}
      <div class="actions"><button class="btn pri" type="submit"${B.busy ? ' disabled' : ''}>حفظ ${esc(t.label)}</button></div></form></section>`;
  }
  function view() {
    if (!B.cfg) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const tabs = visibleTabs();
    const bar = `<div class="gsub" role="tablist">${[['index', 'الفهرس والقوائم المنسدلة'], ...tabs.map((t) => [t.key, t.label])].map((t) => `<button class="chip" role="tab" data-act="gtab" data-t="${t[0]}" aria-pressed="${B.tab === t[0]}">${esc(t[1])}</button>`).join('')}</div>`;
    return bar + (B.tab === 'index' || !tabOf() ? indexTab() : sectionTab(tabOf()));
  }
  UA.general = { view, load };

  const collect = (t) => {
    const out = {};
    for (const it of t.items) {
      const el = $id(fid(it.key)); if (!el) continue;
      out[it.key] = it.type === 'bool' ? el.checked : it.type === 'list' ? el.value.split('\n') : el.value;
    }
    return out;
  };
  async function saveSingleList(key, nextArr) {
    try {
      const r = await api('PUT', '/api/admin/general', { values: { [key]: nextArr } });
      B.cfg = { tabs: r.tabs };
      try { UA.S.limits = (await api('GET', '/api/me')).limits || {}; } catch { /* */ }
      toast('تم تحديث القائمة المنسدلة وحفظها');
      UA.render();
    } catch (e) { toast(e.message || 'تعذّر حفظ القائمة'); }
  }
  UA.forms.gform = async () => {
    const t = tabOf(); if (!t || B.busy) return;
    B.busy = true; B.err = '';
    try { const r = await api('PUT', '/api/admin/general', { values: collect(t) }); B.cfg = { tabs: r.tabs }; try { UA.S.limits = (await api('GET', '/api/me')).limits || {}; } catch { /* */ } toast(r.changed ? `حُفظ (${r.changed} تغيير)` : 'لا تغييرات للحفظ'); }
    catch (e) { if (!e.status) throw e; B.err = e.message; }
    finally { B.busy = false; }
    UA.render();
  };
  Object.assign(UA.actions, {
    gtab: (el, d) => { B.tab = d.t; B.err = ''; UA.render(); },
    glistadd: async (el, d) => {
      const inp = $id(fid(d.k) + '-add'), ta = $id(fid(d.k));
      const v = inp ? inp.value.trim() : '';
      if (!v) { toast('اكتب الخيار الجديد أولاً'); return; }
      const cur = ta ? ta.value.split('\n').map((x) => x.trim()).filter(Boolean) : [];
      if (!cur.includes(v)) cur.push(v);
      await saveSingleList(d.k, cur);
    },
    glistother: async (el, d) => {
      const ta = $id(fid(d.k));
      const cur = ta ? ta.value.split('\n').map((x) => x.trim()).filter(Boolean) : [];
      if (!cur.includes('أخرى')) cur.push('أخرى');
      await saveSingleList(d.k, cur);
    },
    glistdel: async (el, d) => {
      const ta = $id(fid(d.k));
      const cur = ta ? ta.value.split('\n').map((x) => x.trim()).filter(Boolean) : [];
      const idx = Number(d.i);
      if (cur.length <= 1) { toast('يجب إبقاء خيار واحد على الأقل في القائمة'); return; }
      cur.splice(idx, 1);
      await saveSingleList(d.k, cur);
    },
    glistedit: async (el, d) => {
      const ta = $id(fid(d.k));
      const cur = ta ? ta.value.split('\n').map((x) => x.trim()).filter(Boolean) : [];
      const idx = Number(d.i);
      const next = await askText('تعديل الخيار', { label: 'نص الخيار في القائمة المنسدلة', value: cur[idx] || '' });
      if (!next) return;
      cur[idx] = next.trim();
      await saveSingleList(d.k, cur);
    },
    // القيمة المكتوبة في الحقل (ولو لم تُحفظ بعد) تصبح القيمة الحالية والافتراضية معاً
    gmkdef: async (el, d) => {
      const inp = $id(fid(d.k)); if (!inp) return;
      if (!confirm(`جعل «${inp.value}» القيمة الافتراضية لهذا الإعداد؟ ستعود إليها «إعادة إلى الافتراضي» بدل قيمة المصنع.`)) return;
      try { const r = await api('POST', '/api/admin/general/make-default', { values: { [d.k]: inp.value } }); B.cfg = { tabs: r.tabs }; try { UA.S.limits = (await api('GET', '/api/me')).limits || {}; } catch { /* */ } toast('حُفظت القيمة وأصبحت الافتراضية'); UA.render(); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gfactory: async (el, d) => {
      if (!confirm('إعادة القيمة الافتراضية لهذا الإعداد إلى قيمة المصنع؟ القيمة الحالية لا تتغير.')) return;
      try { const r = await api('POST', '/api/admin/general/factory-default', { keys: [d.k] }); B.cfg = { tabs: r.tabs }; toast('عاد الافتراضي إلى قيمة المصنع'); UA.render(); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gres: async (el, d) => { if (!confirm('إعادة هذا الإعداد إلى قيمته الافتراضية؟')) return; try { const r = await api('POST', '/api/admin/general/reset', { keys: [d.k] }); B.cfg = { tabs: r.tabs }; toast('أُعيد إلى الافتراضي'); UA.render(); } catch (e) { if (!e.status) throw e; toast(e.message); } },
    gadmin: async (el, d) => { if (d.v === 'affairs') { UA.S.stTab = d.t; await UA.go('affairs'); return; } UA.S.adminTab = d.t; await UA.go('admin'); if (UA.adminCfg && UA.adminCfg.tabs.some((x) => x[0] === d.t)) { await UA.adminCfg.load(d.t); UA.render(); } },
  });
})();
