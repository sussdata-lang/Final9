/* فورم الاستيراد الموحد الشامل: يدمج استيراد البيانات (طلاب، مقررات، سجل قاعات، علامات) مع استيراد طلبات الإكسل (Excel) ضمن فورم موحد واحد مع فحص مسبق واعتماد فوري. */
(function () {
  const UA = window.UA, { S, api, esc, toast, can } = UA;
  const KINDS = [
    { k: 'students', perm: 'student:register', title: 'سجل الطلاب الكامل (Excel / CSV / SQL)', tpl: '/templates/students-template.xlsx', desc: 'أسماء الطلاب وبياناتهم الكاملة. يُولَّد لكل طالب اسم مستخدم بترميز الكلية (مثل CCS-2026-0001) وكلمة مرور مؤقتة تُسلَّم في ملف منفصل مرة واحدة.' },
    { k: 'courses', perm: 'course:manage', title: 'المقررات الدراسية والخطط (Excel / CSV / SQL)', tpl: '/templates/courses-template.xlsx', desc: 'مقررات الكليات والمعاهد (الجهة، السنة، الفصل، الاسم، الرمز، الساعات، المدرّس). المقرر الموجود يُحدَّث ولا يتكرر.' },
    { k: 'grades', perm: 'grade:manage', title: 'علامات الطلاب والنتائج الامتحانية (Excel / CSV / SQL)', tpl: '/templates/grades-template.xlsx', desc: 'علامات الطلاب (الرقم الجامعي، المقرر، العام الدراسي، النظري والعملي). استورد المقررات أولاً.' },
    { k: 'attendance', perm: 'attendance:manage', title: 'سجل دخول وخروج القاعات (Excel / CSV / SQL)', tpl: '/templates/attendance-template.xlsx', desc: 'عمليات دخول وخروج الطلاب من القاعات (الرقم الجامعي، النوع، المادة أو الفحص، القاعة، وقت الدخول والخروج).' },
    { k: 'reqx', perm: 'request:import', title: 'طلبات الخدمات الطلابية والداخلية (استيراد الإكسل الموحد)', tpl: '', desc: 'استيراد دفعة طلبات إلكترونية لخدمة محددة عبر قالب Excel الخاص بالخدمة، مع تطبيق الفحص الآلي وتوجيه الطلبات للوحدات المختصة.' },
  ];
  const st = { activeKind: 'students', reqService: '', services: [], catalog: null, tab: 'import', batches: null };
  const prevReset = UA.reset;
  UA.reset = () => {
    if (prevReset) prevReset();
    for (const k of Object.keys(st)) if (!['activeKind', 'reqService', 'services', 'catalog', 'tab', 'batches'].includes(k)) delete st[k];
    Object.assign(st, { activeKind: 'students', catalog: null, tab: 'import', batches: null });
  };

  const b64 = async (file) => {
    const u = new Uint8Array(await file.arrayBuffer());
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };

  UA.loaders.import = async () => {
    try {
      const r = await api('GET', '/api/services');
      st.services = r.services || [];
      if (!st.reqService && st.services.length) st.reqService = st.services[0].code;
    } catch { /* ignore */ }
    try { st.catalog = await api('GET', '/api/import-engine/catalog'); } catch { st.catalog = null; }
    if (st.tab === 'log') await loadBatches();
    if (S.importPreset) {
      st.activeKind = S.importPreset;
      S.importPreset = null;
    }
  };

  const RISK = { low: ['منخفضة', 'p-approved'], medium: ['متوسطة', 'p-review'], high: ['عالية', 'p-rejected'], critical: ['عالية جداً', 'p-rejected'] };
  const BATCH = { committed: ['محفوظة', 'p-approved'], undone: ['تم التراجع', 'p-review'], undo_blocked: ['تعذّر التراجع', 'p-rejected'], staged: ['قيد الفحص', 'p-review'] };
  const engineKind = (k) => (st.catalog ? st.catalog.kinds.find((x) => x.kind === k) : null);
  async function loadBatches() { try { st.batches = (await api('GET', '/api/import-engine/batches')).batches; } catch (e) { if (!e.status) throw e; st.batches = []; toast(e.message); } }

  // نتيجة الفحص في الأنواع الجدولية: لا شيء يُكتب قبل «حفظ»
  function renderEngineResult(K, s) {
    const r = s.res;
    if (!r) return '';
    if (r.committed) {
      return `<div class="imp-sum" style="margin-top:14px">
        <div class="stat"><small>جديد</small><b>${r.created}</b></div><div class="stat"><small>محدَّث</small><b>${r.updated}</b></div>
        <div class="stat"><small>بلا تغيير</small><b>${r.unchanged}</b></div><div class="stat"><small>متجاهل</small><b>${r.skipped}</b></div></div>
        <p class="ok-t">حُفظت الدفعة رقم ${r.batchId}. يمكنك مراجعتها في «سجل الاستيراد».</p>`;
    }
    const canSave = !!r.stagingToken && (r.errorCount === 0 || s.partial);
    return `<div class="imp-sum" style="margin-top:14px">
        <div class="stat"><small>صفوف الملف</small><b>${r.total}</b></div><div class="stat"><small>سجل جديد</small><b>${r.impact.create}</b></div>
        <div class="stat"><small>سيُحدَّث</small><b>${r.impact.update}</b></div><div class="stat"><small>بلا تغيير</small><b>${r.impact.unchanged}</b></div><div class="stat"><small>مرفوض</small><b>${r.errorCount}</b></div></div>
      <p class="hint">لم يُحفظ شيء بعد.${r.preview.length ? ` أمثلة: ${r.preview.slice(0, 3).map(esc).join('، ')}` : ''}</p>
      ${r.impactNote ? `<p class="reason"><b>أثر هذا الاستيراد:</b> ${esc(r.impactNote)}</p>` : ''}
      ${r.warnings.map((w) => `<p class="reason">${esc(w)}</p>`).join('')}
      ${r.unusedColumns.length ? `<p class="small">أعمدة لم تُستخدم: ${r.unusedColumns.map(esc).join('، ')}</p>` : ''}
      ${r.errorCount ? `<div class="tbl-wrap" style="max-height:260px;overflow:auto"><table><thead><tr><th>الصف</th><th>سبب الرفض</th></tr></thead><tbody>${r.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>${r.errorCount > r.errors.length ? `<p class="small">يُعرض أول ${r.errors.length} خطأ فقط.</p>` : ''}` : ''}
      ${r.errorCount && r.valid ? `<label class="small" style="display:block;margin-top:10px"><input type="checkbox" data-chg="imppartial"${s.partial ? ' checked' : ''}> حفظ الصالح فقط (${r.valid} صف) وتجاهل المرفوض</label>` : ''}
      ${r.confirmWord ? `<label style="display:block;margin-top:10px">للتأكيد اكتب: <b>${esc(r.confirmWord)}</b><input id="imp-confirm" autocomplete="off"></label>` : ''}
      <div class="actions">
        ${r.stagingToken ? `<button class="btn pri" data-act="impesave" data-k="${esc(K)}"${canSave && !s.busy ? '' : ' disabled'}>حفظ</button>` : ''}
        <button class="btn" data-act="impecancel" data-k="${esc(K)}"${s.busy ? ' disabled' : ''}>إلغاء</button>
      </div>`;
  }

  function renderEngineKind(K, s) {
    const info = engineKind(K), risk = RISK[info.risk] || RISK.low;
    const deps = info.deps.join('، ');
    return `<div style="margin-top:14px;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><h3 style="margin:0 0 6px;color:#054239">${esc(info.title)}</h3><span class="pill ${risk[1]}">الخطورة: ${risk[0]}</span></div>
      <p class="hint" style="margin-top:0">${esc(info.desc)}${deps ? ` يعتمد على: ${esc(deps)}.` : ''}</p>
      <div class="actions" style="margin:0 0 10px"><a class="btn sm" href="/api/import-engine/${esc(K)}/template" download>تحميل النموذج xlsx</a><a class="btn sm" href="/api/import-engine/${esc(K)}/template?format=csv" download>تحميل النموذج csv</a></div>
      <div class="inline-form">
        <label style="flex:2"><b>حدد الملف (.xlsx أو .csv أو .sql)</b><input type="file" id="imp-f-${esc(K)}" accept=".xlsx,.csv,.sql,.txt"></label>
        <button class="btn pri" data-act="impecheck" data-k="${esc(K)}"${s.busy ? ' disabled' : ''}>${s.busy ? 'جارٍ الفحص…' : 'فحص الملف'}</button>
      </div>
      ${s.name ? `<p class="small" style="margin-top:8px">الملف المحدَّد: <b>${esc(s.name)}</b></p>` : ''}
      ${renderEngineResult(K, s)}
    </div>`;
  }

  function renderBatches() {
    const list = st.batches;
    if (!list) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    if (!list.length) return '<section class="card"><div class="empty">لا توجد دفعات استيراد بعد.</div></section>';
    return `<section class="card"><h3 style="margin-top:0">سجل الاستيراد</h3><div class="tbl-wrap"><table><thead><tr><th>#</th><th>النوع</th><th>الملف</th><th>المستخدم</th><th>الوقت</th><th>جديد / محدَّث</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${list.map((b) => { const m = BATCH[b.status] || [b.status, '']; return `<tr><td>${b.id}</td><td>${esc(b.title)}</td><td class="small">${esc(b.filename)}</td><td>${esc(b.user)}</td><td class="small">${esc(UA.fmt(b.committedAt))}</td><td>${b.summary.created} / ${b.summary.updated}</td>
        <td><span class="pill ${m[1]}">${m[0]}</span>${b.blockedReason ? `<div class="small">${esc(b.blockedReason)}</div>` : ''}</td>
        <td>${b.canUndo ? `<button class="btn sm bad" data-act="impeundo" data-id="${b.id}" data-n="${b.summary.created}" data-u="${b.summary.updated + b.summary.sideUpdated}" data-rev="${b.reverses ? 1 : ''}">تراجع</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></section>`;
  }

  const savePanel = (K, s, r) => {
    const canSave = !!r.stagingToken && (r.errorCount === 0 || s.partial);
    return `${r.errorCount && r.valid ? `<label class="small" style="display:block;margin-top:10px"><input type="checkbox" data-chg="imppartial"${s.partial ? ' checked' : ''}> حفظ الصالح فقط (${r.valid} صف) وتجاهل المرفوض</label>` : ''}
      ${r.confirmWord ? `<label style="display:block;margin-top:10px">للتأكيد اكتب: <b>${esc(r.confirmWord)}</b><input id="imp-confirm" autocomplete="off"></label>` : ''}
      <div class="actions">
        ${r.stagingToken ? `<button class="btn pri" data-act="impgo" data-k="${esc(K)}"${canSave && !s.busy ? '' : ' disabled'}>حفظ</button>` : ''}
        <button class="btn" data-act="impecancel" data-k="${esc(K)}"${s.busy ? ' disabled' : ''}>إلغاء</button>
      </div>`;
  };

  function renderResult(KKey, s) {
    const r = s.res;
    if (!r) return '';
    if (KKey === 'reqx') {
      return `<div class="imp-sum" style="margin-top:14px">
        <div class="stat"><small>صفوف الملف</small><b>${r.total}</b></div>
        <div class="stat"><small>${r.committed ? 'أُنشئت' : 'صالحة للإنشاء'}</small><b>${r.committed ? r.created : r.valid}</b></div>
        <div class="stat"><small>فيها أخطاء</small><b>${r.errorCount}</b></div>
      </div>
      ${r.committed
        ? `<p class="ok-t">تم استيراد ${r.created} طلب إلكتروني بنجاح${r.rejectedAuto ? ` (${r.rejectedAuto} رُفضت تلقائياً بقواعد الفحص الآلي)` : ''}.</p>`
        : `<p class="hint">معاينة وفحص أولي فقط: لم يُحفظ أي طلب بعد.</p>`}
      ${(r.errors || []).length ? `<div class="tbl-wrap" style="max-height:240px;overflow:auto"><table><thead><tr><th>الصف</th><th>السبب</th></tr></thead><tbody>${r.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${r.committed ? '' : savePanel('reqx', s, r)}`;
    }
    const ok = r.errorCount === 0;
    return `<div class="imp-sum" style="margin-top:14px">
      <div class="stat"><small>صفوف الملف</small><b>${r.total}</b></div>
      <div class="stat"><small>${r.committed ? 'تم الاستيراد' : 'صالحة للاستيراد'}</small><b>${r.committed ? r.created + (r.updated || 0) : r.valid}</b></div>
      <div class="stat"><small>مرفوضة</small><b>${r.errorCount}</b></div>
    </div>
    ${r.committed ? `<p class="${ok ? 'ok-t' : 'reason'}">اكتمل الاستيراد بنجاح${r.updated ? ` (${r.created} جديد، ${r.updated} محدَّث)` : ''}.${r.batchId ? ` الدفعة رقم ${r.batchId} في «سجل الاستيراد».` : ''}</p>` : `<p class="hint">فحص أولي بلا حفظ: لم يُحفظ شيء بعد.${r.preview && r.preview.length ? ` أمثلة: ${r.preview.slice(0, 3).map(esc).join('، ')}…` : ''}</p>`}
    ${r.unusedColumns && r.unusedColumns.length ? `<p class="small">أعمدة لم تُستخدم: ${r.unusedColumns.map(esc).join('، ')}</p>` : ''}
    ${r.errorCount ? `<div class="tbl-wrap" style="max-height:260px;overflow:auto"><table><thead><tr><th>الصف</th><th>سبب الرفض</th></tr></thead><tbody>${r.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>${r.errorCount > r.errors.length ? `<p class="small">يُعرض أول ${r.errors.length} خطأ فقط.</p>` : ''}` : ''}
    ${r.committed && r.credentialsXlsx ? `<div class="actions"><button class="btn pri" data-act="impcred" data-k="${KKey}">تحميل ملف بيانات الدخول المولدة (يظهر مرة واحدة)</button></div><p class="small">يحوي كلمات المرور المؤقتة؛ سلّمه للطلاب بالطريقة المعتمدة ثم احذفه.</p>` : ''}
    ${r.committed ? '' : savePanel(KKey, s, r)}`;
  }

  UA.views.import = () => {
    const engine = st.catalog ? st.catalog.kinds : [];
    const ks = KINDS.filter((K) => can(K.perm));
    if (!ks.length && !engine.length) return '<section class="card"><div class="empty">لا تملك صلاحية الاستيراد.</div></section>';
    if (!ks.some((x) => x.k === st.activeKind) && !engine.some((x) => x.kind === st.activeKind)) st.activeKind = ks.length ? ks[0].k : engine[0].kind;
    const curEngine = engineKind(st.activeKind);
    const curK = ks.find((x) => x.k === st.activeKind) || ks[0] || {};
    const options = `${ks.length ? `<optgroup label="البيانات الأساسية">${ks.map((x) => `<option value="${esc(x.k)}"${x.k === st.activeKind ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}</optgroup>` : ''}
      ${Object.entries(st.catalog ? st.catalog.groups : {}).map(([g, label]) => { const items = engine.filter((x) => x.group === g); return items.length ? `<optgroup label="${esc(label)}">${items.map((x) => `<option value="${esc(x.kind)}"${x.kind === st.activeKind ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}</optgroup>` : ''; }).join('')}`;
    const tabs = `<div class="actions" style="margin:12px 0 0"><button class="btn sm${st.tab === 'import' ? ' pri' : ''}" data-act="impetab" data-t="import">استيراد ملف</button><button class="btn sm${st.tab === 'log' ? ' pri' : ''}" data-act="impetab" data-t="log">سجل الاستيراد</button></div>`;
    if (st.tab === 'log') return `<section class="card"><h2 style="margin:0">الاستيراد الموحد</h2>${tabs}</section>${renderBatches()}`;
    const s = st[curK.k] ?? (st[curK.k] = {});
    const svcs = st.services.length ? st.services : (S.services || []);
    if (!st.reqService && svcs.length) st.reqService = svcs[0].code;

    return `<section class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0">فورم الاستيراد الموحد (البيانات + استيراد الإكسل)</h2>
          <p class="hint" style="margin:4px 0 0">اختر نوع البيانات وحمّل نموذجه، ثم ارفع الملف لفحصه. لا يُكتب شيء قبل أن تضغط «حفظ».</p>${st.catalog && engine.length ? `<p class="small" style="margin:4px 0 0">ترتيب الاستيراد: ${esc(st.catalog.orderHint)}</p>` : ''}
        </div>
        <button class="btn sm" data-act="extab" data-t="export">الانتقال إلى صفحة التصدير الموحدة ←</button>
      </div>

      <div class="inline-form" style="margin-top:14px;padding:14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px">
        <label style="flex:1;min-width:160px"><b>بحث في الأنواع</b><input id="imp-kind-q" data-kindq="1" placeholder="مثال: موردون" autocomplete="off"></label>
        <label style="flex:2;min-width:260px"><b>1. اختر فئة الاستيراد في الفورم الموحد</b>
          <select id="imp-unified-kind" data-chg="impkind">${options}</select>
        </label>
        ${!curEngine && curK.k === 'reqx' ? `<label style="flex:2;min-width:240px"><b>نوع الخدمة المطلوبة (قالب Excel)</b>
          <select id="imp-req-svc" data-chg="impreqsvc">
            ${svcs.map((sv) => `<option value="${esc(sv.code)}"${sv.code === st.reqService ? ' selected' : ''}>${esc(sv.label)} (${sv.audience === 'staff' ? 'موظفون' : 'طلاب'})</option>`).join('')}
          </select>
        </label>` : ''}
        ${curEngine ? '' : `<div style="display:flex;align-items:flex-end;gap:8px">
          ${curK.k === 'reqx'
            ? `<button type="button" class="btn" data-act="impreqtpl">تحميل قالب Excel للخدمة</button>`
            : `<a class="btn" href="${curK.tpl}" download>تحميل قالب Excel المعتمد</a>`}
        </div>`}
      </div>
      ${tabs}

      ${curEngine ? renderEngineKind(st.activeKind, st[st.activeKind] ?? (st[st.activeKind] = {})) : `<div style="margin-top:14px;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff">
        <h3 style="margin:0 0 6px;color:#054239">${esc(curK.title)}</h3>
        <p class="hint" style="margin-top:0">${esc(curK.desc)}</p>
        <div class="inline-form" style="margin-top:12px">
          <label style="flex:2"><b>2. حدد الملف المراد استيراده (${curK.k === 'reqx' ? '.xlsx' : '.xlsx أو .csv أو .sql'})</b>
            <input type="file" id="imp-f-${curK.k}" accept="${curK.k === 'reqx' ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.xlsx,.csv,.sql,.txt'}">
          </label>
          <button class="btn pri" data-act="impcheck" data-k="${curK.k}"${s.busy ? ' disabled' : ''}>${s.busy ? 'جارٍ الفحص والمعالجة…' : '3. فحص الملف ومعاينة الصفوف'}</button>
        </div>
        ${s.name ? `<p class="small" style="margin-top:8px">الملف المحدَّد حالياً: <b>${esc(s.name)}</b></p>` : ''}
        ${renderResult(curK.k, s)}
      </div>`}
    </section>`;
  };

  const importUrl = (K) => {
    if (K !== 'reqx') return `/api/import/${K}`;
    const svcEl = document.getElementById('imp-req-svc');
    return `/api/services/${encodeURIComponent((svcEl && svcEl.value) || st.reqService)}/import`;
  };
  const run = async (K) => {
    const s = st[K] ?? (st[K] = {});
    const inp = document.getElementById(`imp-f-${K}`);
    const f = (inp && inp.files && inp.files[0]) || null;
    if (f) { s.file = f; s.name = f.name; s.b64 = await b64(f); }
    if (!s.b64) { toast('اختر ملفاً أولاً'); return; }
    const old = s.res && s.res.stagingToken;
    if (old) await api('POST', '/api/import-engine/cancel', { stagingToken: old }).catch(() => {});
    s.res = null; s.partial = false; s.busy = true; UA.render();
    try { s.res = await api('POST', importUrl(K), { filename: s.name, data: s.b64 }); }
    catch (e) { if (!e.status) throw e; toast(e.message); }
    finally { s.busy = false; UA.render(); }
  };
  const save = async (K) => {
    const s = st[K]; if (!s || !s.res || !s.res.stagingToken) return;
    const confirmEl = document.getElementById('imp-confirm');
    s.busy = true; UA.render();
    try {
      s.res = await api('POST', importUrl(K), { commit: true, stagingToken: s.res.stagingToken, acceptPartial: !!s.partial, confirm: confirmEl ? confirmEl.value : undefined });
      s.b64 = null; s.partial = false; st.batches = null;
      toast('تم الحفظ');
    } catch (e) { if (!e.status) throw e; toast(e.message); if (e.status === 410) s.res = null; }
    finally { s.busy = false; UA.render(); }
  };

  // البحث يصفّي خيارات القائمة مباشرة بلا إعادة رسم حتى يبقى المؤشر في الحقل
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.kindq) return;
    const v = t.value.trim(), sel = document.getElementById('imp-unified-kind');
    if (!sel) return;
    for (const o of sel.querySelectorAll('option')) o.hidden = !!v && !o.textContent.includes(v);
    for (const g of sel.querySelectorAll('optgroup')) g.hidden = ![...g.querySelectorAll('option')].some((o) => !o.hidden);
  });

  const engineFile = async (K, s) => {
    const inp = document.getElementById(`imp-f-${K}`), f = inp && inp.files && inp.files[0];
    if (f) { s.name = f.name; s.b64 = await b64(f); }
    return !!s.b64;
  };
  const cancelStaged = async (s) => {
    const token = s.res && s.res.stagingToken;
    s.res = null; s.b64 = null; s.name = ''; s.partial = false;
    if (token) await api('POST', '/api/import-engine/cancel', { stagingToken: token }).catch(() => {});
  };

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.chg === 'imppartial') {
      const s = st[st.activeKind]; if (s) { s.partial = t.checked; UA.render(); }
    } else if (t.dataset.chg === 'impkind') {
      st.activeKind = t.value;
      UA.render();
    } else if (t.dataset.chg === 'impreqsvc') {
      st.reqService = t.value;
      if (st.reqx) st.reqx.res = null;
      UA.render();
    }
  });

  Object.assign(UA.actions, {
    impetab: async (el, d) => { st.tab = d.t; if (d.t === 'log') { st.batches = null; UA.render(); await loadBatches(); } UA.render(); },
    impecheck: async (el, d) => {
      const s = st[d.k] ?? (st[d.k] = {});
      if (!await engineFile(d.k, s)) { toast('اختر ملفاً أولاً'); return; }
      const old = s.res && s.res.stagingToken;
      if (old) await api('POST', '/api/import-engine/cancel', { stagingToken: old }).catch(() => {});
      s.busy = true; s.res = null; s.partial = false; UA.render();
      try { s.res = await api('POST', `/api/import-engine/${d.k}/check`, { filename: s.name, data: s.b64 }); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
      finally { s.busy = false; UA.render(); }
    },
    impesave: async (el, d) => {
      const s = st[d.k]; if (!s || !s.res) return;
      const confirmEl = document.getElementById('imp-confirm');
      const n = s.res.impact, msg = `سيُنشأ ${n.create} سجل ويُحدَّث ${n.update}${s.partial ? ` ويُتجاهل ${s.res.errorCount} صف مرفوض` : ''}.${s.res.impactNote ? ` ${s.res.impactNote}` : ''} متابعة؟`;
      if (!window.confirm(msg)) return;
      s.busy = true; UA.render();
      try {
        s.res = await api('POST', `/api/import-engine/${d.k}/commit`, { stagingToken: s.res.stagingToken, acceptPartial: !!s.partial, confirm: confirmEl ? confirmEl.value : undefined });
        s.b64 = null; s.partial = false; st.batches = null;
        toast('تم الحفظ');
      } catch (e) { if (!e.status) throw e; toast(e.message); if (e.status === 410) s.res = null; }
      finally { s.busy = false; UA.render(); }
    },
    impecancel: async (el, d) => { const s = st[d.k]; if (s) await cancelStaged(s); UA.render(); toast('أُلغي الاستيراد، ولم يُكتب شيء'); },
    impeundo: async (el, d) => {
      if (!window.confirm(d.rev ? `سيُعكس أثر ${d.n} سجل بقيد عكسي مرحَّل، وتبقى القيود الأصلية في الدفاتر. متابعة؟` : `سيُحذف ${d.n} سجل أُنشئ وتُعاد ${d.u} سجلات إلى قيمها السابقة. متابعة؟`)) return;
      try { const r = await api('POST', `/api/import-engine/batches/${d.id}/undo`, {}); toast(`تم التراجع عن ${r.reverted} سجل`); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
      await loadBatches(); UA.render();
    },
    impcheck: (el, d) => run(d.k),
    impgo: (el, d) => { if (window.confirm('سيُحفظ الاستيراد في قاعدة البيانات. متابعة؟')) return save(d.k); },
    impreqtpl: async () => {
      const svc = st.reqService;
      if (!svc) { toast('اختر الخدمة أولاً'); return; }
      const a = document.createElement('a');
      a.href = `/api/services/${encodeURIComponent(svc)}/template.xlsx`;
      a.download = `template-${svc}.xlsx`;
      a.click();
    },
    impcred: async (el, d) => {
      const r = st[d.k] && st[d.k].res; if (!r || !r.credentialsXlsx) return;
      const bin = atob(r.credentialsXlsx), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = 'student-credentials.xlsx'; a.click();
      delete r.credentialsXlsx; setTimeout(() => { URL.revokeObjectURL(a.href); UA.render(); }, 500);
    },
  });
})();
