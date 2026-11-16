/* بوابة الطلبات الداخلية للموظفين والإدارات — نسخة مؤسسية منظمة مع دليل خدمات تفاعلي، تتبع مسار الطلب، ودفعات Excel */
(function () {
  const UA = window.UA, { S, api, esc, fmt, toast, can } = UA;
  const fresh = () => ({
    tab: 'all', // all | catalog | mine
    statusFilter: '',
    q: '',
    catFilter: '',
    list: null,
    svcs: null,
    k: null,
    vals: {},
    files: {},
    err: '',
    busy: false,
    open: null,
    ex: { code: '', res: null, busy: false, file: null, b64: null }
  });
  const B = fresh();
  UA.internalState = B;
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const $id = (i) => document.getElementById(i);
  const ST = { review: 'قيد المراجعة', approved: 'معتمد ومقبول', rejected: 'مرفوض' };
  const slotsOf = (s) => (s.attachments && s.attachments.length ? s.attachments : (s.requiresAttachment ? [{ label: 'المرفق المؤيد', required: true }] : []));
  const svc = () => (B.svcs || []).find((s) => s.code === B.k);

  function field(f, v) {
    const id = 'in-' + f.name, req = f.required ? ' required' : '', cur = v ?? '';
    let c;
    if (f.type === 'select') c = `<select id="${id}"${req}><option value="">— اختر —</option>${f.options.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') c = `<textarea id="${id}" rows="3" maxlength="1000"${req}>${esc(cur)}</textarea>`;
    else if (f.type === 'number' || f.type === 'decimal') c = `<input id="${id}" type="number" step="${f.type === 'number' ? 1 : 0.01}" min="${f.min ?? 0}" max="${f.max ?? ''}" value="${esc(cur)}"${req}>`;
    else if (f.type === 'date') c = `<input id="${id}" type="date" value="${esc(cur)}"${req}>`;
    else c = `<input id="${id}" maxlength="200" value="${esc(cur)}"${req}>`;
    return `<label>${esc(f.label)}${f.required ? ' <i class="req-m">*</i>' : ''}${f.hint ? `<span class="small" style="display:block">${esc(f.hint)}</span>` : ''}${c}</label>`;
  }

  function renderHeader() {
    const list = B.list || [];
    const rev = list.filter((r) => r.status === 'review').length;
    const app = list.filter((r) => r.status === 'approved').length;
    const rej = list.filter((r) => r.status === 'rejected').length;
    return `
      <section class="card no-print" style="margin-bottom:14px;background:linear-gradient(135deg,#10211D 0%,#134e4a 100%);color:#fff;border:1px solid #115e59;padding:16px">
        <div class="spread" style="flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <div style="font-size:11px;color:#5eead4;font-weight:700;letter-spacing:.4px">بوابة الخدمات الذاتية للعاملين · INTERNAL STAFF REQUESTS & SLA PORTAL</div>
            <div style="font-size:16px;font-weight:800;margin-top:2px">الطلبات الإدارية والفنية والمالية الداخلية الموجهة للمديريات المختصة</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn sm ${B.tab === 'all' && !B.k ? 'pri' : ''}" style="${B.tab === 'all' && !B.k ? '' : 'background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)'}" data-act="intab" data-t="all">🗂️ العرض الموحد</button>
            <button class="btn sm ${B.tab === 'catalog' || B.k ? 'pri' : ''}" style="${B.tab === 'catalog' || B.k ? '' : 'background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)'}" data-act="intab" data-t="catalog">➕ تقديم طلب داخلي</button>
            <button class="btn sm ${B.tab === 'mine' && !B.k ? 'pri' : ''}" style="${B.tab === 'mine' && !B.k ? '' : 'background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)'}" data-act="intab" data-t="mine">📋 سجل طلباتي (${list.length})</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px">
          <div style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#DCE3DD">النماذج الإدارية المتاحة</div>
            <div style="font-size:18px;font-weight:800">${(B.svcs || []).length}</div>
          </div>
          <div style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#DCE3DD">إجمالي طلباتي المقدمة</div>
            <div style="font-size:18px;font-weight:800">${list.length}</div>
          </div>
          <div style="background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.35);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#E6CB84">قيد المراجعة والبت</div>
            <div style="font-size:18px;font-weight:800;color:#C9A24B">${rev}</div>
          </div>
          <div style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.35);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#A8D8BE">تمت الموافقة عليها</div>
            <div style="font-size:18px;font-weight:800;color:#1B7F4B">${app}</div>
          </div>
          <div style="background:rgba(244,63,94,.15);border:1px solid rgba(244,63,94,.35);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#FBE0DD">مرفوضة</div>
            <div style="font-size:18px;font-weight:800;color:#B3261E">${rej}</div>
          </div>
        </div>
      </section>`;
  }

  function form() {
    const s = svc();
    if (!s) {
      const groups = {};
      for (const x of B.svcs || []) {
        const cat = x.category || (x.unit && x.unit.name) || 'خدمات إدارية عامة';
        (groups[cat] ||= []).push(x);
      }
      const groupKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ar'));

      return `<section class="card" style="margin-bottom:14px;border:2px solid #0d9488;background:linear-gradient(135deg,#F6F8F5 0%,#ffffff 100%)">
        <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div>
            <h2 style="margin:0;color:#0d9488">📑 دليل النماذج والطلبات الداخلية المعتمدة (قائمة منسدلة)</h2>
            <p class="hint" style="margin:2px 0 0">اختر النموذج من القائمة المنسدلة؛ يُوجَّه الطلب تلقائياً إلى المديرية أو القسم المختص مع احتساب مهلة الإنجاز (SLA).</p>
          </div>
        </div>

        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #DCE3DD;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
          <label style="display:block;font-weight:700;font-size:14px;margin-bottom:8px;color:#10211D">
            اختر النموذج المطلوب تعبئته من القائمة المنسدلة:
          </label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <select id="in-svc-selector" data-chg="insvcchange" style="flex:1;min-width:280px;padding:10px 12px;border:1.5px solid #0d9488;border-radius:8px;font-size:14px;font-weight:600;background:#fff">
              <option value="">-- اختر النموذج من القائمة المنسدلة (${(B.svcs || []).length} نموذج متاح) --</option>
              ${groupKeys.map((g) => `<optgroup label="📂 ${esc(g)} (${groups[g].length} نموذج)">
                ${groups[g].map((x) => `<option value="${esc(x.code)}"${B.selectedSvcCode === x.code ? ' selected' : ''}>${esc(x.label)}${x.slaHours ? ` (⏱ ${x.slaHours} س)` : ''}${x.unit ? ` — ${esc(x.unit.name)}` : ''}</option>`).join('')}
              </optgroup>`).join('')}
            </select>
            <button type="button" class="btn pri" data-act="inpickselected" style="padding:10px 20px;font-weight:700">تعبئة النموذج المختار ←</button>
          </div>
          <div id="in-svc-preview-box" style="margin-top:12px;padding:12px 14px;background:#F6F8F5;border-radius:8px;border:1px dashed #DCE3DD;font-size:13px;color:#566660">
            ${(() => {
              const curCode = B.selectedSvcCode || (B.svcs && B.svcs[0] ? B.svcs[0].code : '');
              const cur = (B.svcs || []).find((x) => x.code === curCode);
              if (!cur) return '<span>اختر نموذجاً لعرض بطاقة الإرشادات والجهة المسؤولة ومهلة الإنجاز الرسمية.</span>';
              return `<div>
                <b style="color:#10211D;font-size:14px">📋 ${esc(cur.label)}</b>
                <p style="margin:4px 0 6px">${esc(cur.description || 'نموذج طلب داخلي رسمي معتمد')}</p>
                <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px">
                  <span style="color:#0d9488;font-weight:700">🏛️ الجهة المختصة بالبت: ${esc(cur.unit ? cur.unit.name : 'المديرية المعنية')}</span>
                  ${cur.slaHours ? `<span style="color:#0A5A4D;font-weight:700">⏱ مهلة الإنجاز (SLA): ${cur.slaHours} ساعة</span>` : ''}
                  <span style="color:#566660">عدد الحقول: ${(cur.fields || []).length} حقول</span>
                </div>
              </div>`;
            })()}
          </div>
        </div>
      </section>`;
    }

    return `<section class="card" style="border:2px solid #0d9488;margin-bottom:14px">
      <div class="spread" style="margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0">📝 ${esc(s.label)}</h2>
          <p class="hint" style="margin:2px 0 0">${esc(s.description)}${s.unit ? ' — الجهة المختصة بالبت: <b>' + esc(s.unit.name) + '</b>' : ''}</p>
        </div>
        <button class="btn sm" type="button" data-act="incancel">← العودة لدليل النماذج</button>
      </div>
      ${s.instructions ? `<div class="hint" style="white-space:pre-line;background:#F6F8F5;border:1px solid #A8D8BE;padding:10px 12px;border-radius:8px;margin-bottom:10px">${esc(s.instructions)}</div>` : ''}
      ${UA.formKit.render({
        id: 'inform',
        status: 'draft',
        bare: true,
        steps: [{ label: 'تقديم الطلب', state: 'cur' }, { label: s.unit ? s.unit.name : 'الجهة المختصة' }, { label: 'القرار' }],
        sections: [
          { title: 'تفاصيل الطلب', html: s.fields.filter((f) => f.type !== 'ref').map((f) => field(f, B.vals[f.name])).join('') },
          ...(slotsOf(s).length ? [{ title: 'المرفقات', html: slotsOf(s).map((sl, i) => `<label>${esc(sl.label)}${sl.required ? ' <i class="req-m">*</i>' : ' (اختياري)'}<input id="in-file-${i}" type="file" accept=".pdf,.png,.jpg,.jpeg"${sl.required && !B.files[i] ? ' required' : ''}>${B.files[i] ? `<span class="small">${esc(B.files[i].name)}</span>` : ''}</label>`).join('') }] : []),
        ],
        actions: `${B.err ? `<div class="err" role="alert" style="width:100%">${esc(B.err)}</div>` : ''}
          <button class="btn pri" type="submit"${B.busy ? ' disabled' : ''}>📤 إرسال وتقديم الطلب</button>
          <button class="btn" type="button" data-act="incancel">إلغاء ورجوع</button>
          <a class="btn" href="/api/services/${encodeURIComponent(s.code)}/template.xlsx" download>📥 تنزيل قالب Excel لهذا النموذج</a>`,
      })}
    </section>`;
  }

  function mine() {
    const q = (B.q || '').trim().toLowerCase();
    const filtered = (B.list || []).filter((r) => {
      if (B.statusFilter && r.status !== B.statusFilter) return false;
      if (!q) return true;
      return String(r.no || '').toLowerCase().includes(q) ||
             String(r.service?.label || '').toLowerCase().includes(q) ||
             String(r.unit?.name || '').toLowerCase().includes(q);
    });

    const rows = filtered.map((r) => `
      <tr>
        <td class="mono"><b>${esc(r.no)}</b></td>
        <td><b>${esc(r.service.label)}</b></td>
        <td>${esc(r.unit ? r.unit.name : '—')}</td>
        <td><span class="pill p-${r.status}">${ST[r.status] || r.status}</span>${r.escalationLevel ? ` <span class="pill p-rejected">مصعّد ${r.escalationLevel}</span>` : ''}</td>
        <td>${fmt(r.createdAt)}</td>
        <td>${UA.slaCell ? UA.slaCell(r) : ''}</td>
        <td><button class="btn sm" data-act="inopen" data-id="${r.id}">${B.open === r.id ? 'إخفاء المسار' : 'التفاصيل والمسار'}</button> <button class="btn sm" data-act="reqprint" data-id="${r.id}">طباعة النموذج</button></td>
      </tr>
      ${B.open === r.id ? `<tr><td colspan="7" style="background:#F6F8F5;padding:12px">${detail(r)}</td></tr>` : ''}`).join('');

    return `<section class="card">
      <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0">📋 سجل طلباتي الداخلية ومتابعة حالتها (${filtered.length})</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${[['', 'الكل'], ['review', 'قيد المراجعة'], ['approved', 'مقبول'], ['rejected', 'مرفوض']].map(([k, lbl]) => `
            <button class="chip" data-act="instatus" data-st="${k}" aria-pressed="${B.statusFilter === k}">${esc(lbl)}</button>
          `).join('')}
          <input id="in-search-q" value="${esc(B.q)}" placeholder="بحث برقم الطلب أو النموذج..." style="width:200px">
          <button class="btn sm" data-act="insearch">بحث</button>
        </div>
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>رقم الطلب</th><th>نوع النموذج</th><th>الجهة المختصة</th><th>الحالة</th><th>تاريخ التقديم</th><th>مؤشر المهلة (SLA)</th><th>إجراءات</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="hint">لا توجد طلبات مطابقة.</td></tr>'}</tbody></table></div>
    </section>`;
  }

  const detail = (r) => `
    <div style="display:grid;gap:8px">
      <dl class="kv">
        ${Object.entries(r.details).map(([k, v]) => {
          const f = ((B.svcs || []).find((s) => s.code === r.service.code) || { fields: [] }).fields.find((x) => x.name === k);
          return `<dt>${esc(f ? f.label : k)}</dt><dd><b>${esc(v)}</b></dd>`;
        }).join('')}
        ${r.rejectReason ? `<dt style="color:#B3261E">سبب الرفض</dt><dd style="color:#B3261E"><b>${esc(r.rejectReason)}</b></dd>` : ''}
        ${r.attachments.map((a) => `<dt>مرفق رسمي</dt><dd><a class="btn sm" href="/api/attachments/${a.id}" download>${esc(a.name)}</a></dd>`).join('')}
      </dl>
      <div>
        <strong style="font-size:13px">📜 مسار معالجة الطلب:</strong>
        <ol class="small" style="margin:4px 0 0">${r.events.map((e) => `<li><b>${esc(e.text)}</b> — ${esc(e.actor)} (${fmt(e.at)})</li>`).join('')}</ol>
      </div>
    </div>`;

  UA.views.internal = () => {
    const showForm = B.k || B.tab === 'all' || B.tab === 'catalog';
    const showMine = !B.k && (B.tab === 'all' || B.tab === 'mine');
    return `${renderHeader()}${showForm ? form() : ''}${showMine ? mine() : ''}`;
  };

  UA.loaders.internal = async () => {
    const [s, r] = await Promise.all([api('GET', '/api/services'), api('GET', '/api/requests')]);
    B.svcs = s.services;
    B.list = r.requests.filter((x) => x.student && x.student.id === S.me.id);
    S.services = s.services;
    if (!S.requests || !S.requests.length) S.requests = r.requests;
  };

  const A = UA.actions;
  A.intab = (el, d) => { B.tab = d.t; if (d.t === 'mine') B.k = null; UA.render(); };
  A.incat = (el, d) => { B.catFilter = d.c || ''; UA.render(); };
  A.instatus = (el, d) => { B.statusFilter = d.st || ''; UA.render(); };
  A.insearch = () => { B.q = $id('in-search-q')?.value || ''; UA.render(); };
  A.insvcchange = (el) => {
    B.selectedSvcCode = el ? el.value : ($id('in-svc-selector') ? $id('in-svc-selector').value : '');
    UA.render();
  };
  A.inpickselected = () => {
    const sel = $id('in-svc-selector');
    const code = (sel && sel.value) || B.selectedSvcCode;
    if (!code) { toast('يرجى اختيار نموذج من القائمة المنسدلة أولاً.'); return; }
    B.k = code; B.vals = {}; B.files = {}; B.err = ''; UA.render();
  };
  A.inpick = (el, d) => { B.k = d.k; B.vals = {}; B.files = {}; B.err = ''; UA.render(); };
  A.incancel = () => { B.k = null; B.err = ''; UA.render(); };
  A.inopen = (el, d) => { B.open = B.open === Number(d.id) ? null : Number(d.id); UA.render(); };

  UA.forms.inform = async () => {
    const s = svc(); if (!s || B.busy) return;
    s.fields.forEach((f) => { const e = $id('in-' + f.name); if (e) B.vals[f.name] = e.value; });
    slotsOf(s).forEach((_, i) => { const e = $id('in-file-' + i); if (e && e.files[0]) B.files[i] = e.files[0]; });
    B.busy = true; B.err = '';
    try {
      const details = {};
      s.fields.forEach((f) => { const v = B.vals[f.name]; if (v !== undefined && v !== '') details[f.name] = f.type === 'number' ? Number(v) : v; });
      const sl = slotsOf(s), attachments = [];
      for (const [i, f] of Object.entries(B.files)) attachments.push({ name: f.name, data: await UA.readFile(f), slot: sl[i] && sl[i].label });
      const r = await api('POST', '/api/requests', { service: s.code, details, attachments });
      B.k = null; B.vals = {}; B.files = {};
      await UA.loaders.internal();
      UA.render();
      toast('قُدّم الطلب الداخلي بنجاح برقم ' + r.request.no);
    } catch (e) { if (!e.status) throw e; B.err = e.message; } finally { B.busy = false; }
    if (B.err) UA.render();
  };

  /* ---------- طلبات Excel: قالب فارغ، تصدير، استيراد دفعة ---------- */
  UA.views.reqx = () => {
    const x = B.ex, list = B.xsvcs || [], r = x.res;
    const opts = list.map((s) => `<option value="${esc(s.code)}"${x.code === s.code ? ' selected' : ''}>${esc(s.label)}${s.unit ? ' — ' + esc(s.unit.name) : ''}</option>`).join('');
    const out = r ? `<div class="imp-sum"><div class="stat"><small>صفوف الملف</small><b>${r.total}</b></div><div class="stat"><small>${r.committed ? 'قُدِّم' : 'صالحة'}</small><b>${r.committed ? r.created : r.valid}</b></div><div class="stat"><small>مرفوضة</small><b>${r.errorCount}</b></div></div>
      ${r.committed ? `<p class="ok-t">اكتمل الاستيراد${r.rejectedAuto ? ` (${r.rejectedAuto} رُفضت آلياً وفق القواعد)` : ''}.</p>` : '<p class="hint">فحص فقط: لم يُحفظ شيء بعد.</p>'}
      ${r.errorCount ? `<div class="tbl-wrap" style="max-height:240px;overflow:auto"><table><thead><tr><th>الصف</th><th>السبب</th></tr></thead><tbody>${r.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${!r.committed && r.valid ? `<div class="actions"><button class="btn pri" data-act="xgo"${x.busy ? ' disabled' : ''}>اعتماد وتقديم ${r.valid} طلباً${r.errorCount ? ' وتجاهل المرفوض' : ''}</button> <button class="btn" data-act="xcancel"${x.busy ? ' disabled' : ''}>إلغاء</button></div>` : ''}` : '';
    return `<section class="card"><h2>طلبات بصيغة Excel</h2><p class="hint">لكل نموذج قالب فارغ بتعليماته وقوائمه المنسدلة، ويمكن تصدير الطلبات المقدَّمة ضمن صلاحيتك، واستيراد دفعة طلبات من القالب.</p>
      <label>النموذج<select id="rx-svc"><option value="">— اختر —</option>${opts}</select></label>
      <div class="actions" style="margin-top:10px"><button class="btn" data-act="xtpl">تنزيل القالب الفارغ</button> <button class="btn" data-act="xexp">تصدير طلبات هذا النموذج</button> <button class="btn" data-act="xexpall">تصدير كل الطلبات</button></div>
      <div class="inline-form" style="margin-top:8px"><label>من تاريخ<input id="rx-from" type="date"></label><label>إلى تاريخ<input id="rx-to" type="date"></label><label>الحالة<select id="rx-st"><option value="">الكل</option><option value="review">قيد المراجعة</option><option value="approved">مقبول</option><option value="rejected">مرفوض</option></select></label></div></section>
      ${can('request:import') ? `<section class="card"><h3 style="margin:0 0 6px">استيراد دفعة طلبات</h3><p class="hint">الخدمات التي تتطلب مرفقات تُقدَّم من الواجهة. حتى 500 صف في الملف.</p>
        <input id="rx-file" type="file" accept=".xlsx"> <button class="btn pri" data-act="xprev"${x.busy ? ' disabled' : ''}>فحص الملف</button>${out}</section>` : ''}`;
  };
  UA.loaders.reqx = async () => { B.xsvcs = (await api('GET', '/api/services?all=1')).services; };
  const pick = () => { const e = $id('rx-svc'); if (e) B.ex.code = e.value; return B.ex.code; };
  const go = (u) => { const a = document.createElement('a'); a.href = u; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
  const q = () => { const p = new URLSearchParams(); for (const [k, id] of [['from', 'rx-from'], ['to', 'rx-to'], ['status', 'rx-st']]) { const v = $id(id) && $id(id).value; if (v) p.set(k, v); } return p; };
  A.xtpl = () => { const c = pick(); if (!c) return toast('اختر النموذج أولاً'); go(`/api/services/${encodeURIComponent(c)}/template.xlsx`); };
  A.xexp = () => { const c = pick(); if (!c) return toast('اختر النموذج أولاً'); const p = q(); p.set('service', c); go('/api/requests/export.xlsx?' + p); };
  A.xexpall = () => go('/api/requests/export.xlsx?' + q());
  const run = async (commit) => {
    const c = pick(), x = B.ex; if (!c) return toast('اختر النموذج أولاً');
    const f = $id('rx-file') && $id('rx-file').files[0]; if (f) { x.file = f; x.b64 = await UA.readFile(f); }
    if (!x.b64) return toast('اختر ملف Excel أولاً');
    x.busy = true; UA.render();
    try {
      const body = commit ? { commit: true, stagingToken: x.res.stagingToken, acceptPartial: !!x.res.errorCount } : { filename: x.file ? x.file.name : 'requests.xlsx', data: x.b64 };
      x.res = await api('POST', `/api/services/${encodeURIComponent(c)}/import`, body);
    }
    catch (e) { if (!e.status) throw e; x.res = null; toast(e.message); } finally { x.busy = false; }
    UA.render();
  };
  A.xprev = () => run(false);
  A.xgo = () => run(true);
  A.xcancel = async () => { const x = B.ex, token = x.res && x.res.stagingToken; x.res = null; x.b64 = null; if (token) await api('POST', '/api/import-engine/cancel', { stagingToken: token }).catch(() => {}); UA.render(); toast('أُلغي الاستيراد، ولم يُكتب شيء'); };
})();
