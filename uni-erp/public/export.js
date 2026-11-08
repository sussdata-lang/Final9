/* صفحة تصدير البيانات: اختيار المجموعة (طلاب، مواد، علامات...) والمرشحات (كلية، برنامج، سنة، فصل، عام دراسي)، معاينة، وتنزيل بأكثر من صيغة */
(function () {
  const UA = window.UA, { S, api, esc, toast } = UA;
  const X = { opts: null, dataset: 'grades', f: { faculty: '', program: '', level: '', semester: '', academicYear: '', status: '', enrollYear: '', akind: '', ahall: '', acourse: '', astate: '', afrom: '', ato: '' }, layout: 'single', data: null, busy: '', loading: false, err: '' };
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); Object.assign(X, { opts: null, data: null, busy: '', err: '' }); };

  const APPLIES = {
    students: ['faculty', 'program', 'level', 'status', 'enrollYear'],
    grades: ['faculty', 'program', 'level', 'semester', 'academicYear', 'status', 'enrollYear'],
    courses: ['faculty', 'program', 'level', 'semester'],
    requests: ['faculty', 'program', 'level', 'status', 'enrollYear'], attendance: ['faculty', 'akind', 'ahall', 'acourse', 'astate', 'afrom', 'ato'], holds: ['faculty', 'program', 'level', 'status', 'enrollYear'], complaints: ['faculty', 'program', 'level', 'status', 'enrollYear'],
    all: ['faculty', 'program', 'level', 'semester', 'academicYear', 'status', 'enrollYear', 'akind', 'ahall', 'acourse', 'astate', 'afrom', 'ato'],
  };
  const DS_ICON = { attendance: 'hall', students: 'students', grades: 'grades', courses: 'guide', requests: 'tx', holds: 'lock', complaints: 'help', all: 'export' };
  const FORMATS = [['xlsx', 'Excel', 'sheet'], ['csv', 'CSV', 'csv'], ['json', 'JSON', 'json'], ['docx', 'Word', 'word'], ['pdf', 'PDF', 'pdf']];
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'];

  const query = (extra = {}) => {
    const q = new URLSearchParams({ dataset: X.dataset, tz: new Date().getTimezoneOffset(), ...extra });
    for (const k of APPLIES[X.dataset]) if (X.f[k]) q.set(k, X.f[k]);
    return q;
  };
  async function loadPreview(extra) {
    X.loading = true; X.err = '';
    try { X.data = await api('GET', '/api/export/preview?' + query(extra)); } catch (e) { if (!e.status) throw e; X.err = e.message; X.data = null; }
    X.loading = false;
  }
  UA.loaders.export = async () => { if (!X.opts) X.opts = await api('GET', '/api/export/options'); if (S.exportPreset) { X.dataset = S.exportPreset.dataset; Object.assign(X.f, S.exportPreset.f || {}); S.exportPreset = null; } await loadPreview(); };

  const sel = (key, label, options, all = 'الكل') => `<label>${label}<select data-chg="xfilter" data-k="${key}"><option value="">${all}</option>${options.map(([v, l]) => `<option value="${esc(v)}"${String(X.f[key]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;

  function filters() {
    const o = X.opts, on = new Set(APPLIES[X.dataset]);
    const progs = o.programs.filter((p) => !X.f.faculty || String(p.facultyId) === String(X.f.faculty));
    const lvlLabel = X.dataset === 'students' ? 'السنة الدراسية الحالية' : 'السنة الدراسية';
    return `<div class="xf-grid">
      ${on.has('faculty') ? sel('faculty', 'الكلية / المعهد', o.faculties.map((f) => [f.id, f.name])) : ''}
      ${on.has('program') ? sel('program', 'البرنامج', progs.map((p) => [p.id, p.label])) : ''}
      ${on.has('level') ? sel('level', lvlLabel, LV.map((l, i) => [i + 1, 'السنة ' + l])) : ''}
      ${on.has('semester') ? sel('semester', 'الفصل', [[1, 'الفصل الأول'], [2, 'الفصل الثاني']]) : ''}
      ${on.has('academicYear') ? sel('academicYear', 'العام الدراسي', o.academicYears.map((y) => [y, y])) : ''}
      ${on.has('status') ? sel('status', 'حالة القيد', Object.entries(o.statuses)) : ''}
      ${on.has('enrollYear') ? sel('enrollYear', 'سنة القيد', o.enrollYears.map((y) => [y, y])) : ''}
      ${on.has('akind') ? sel('akind', 'نوع سجل القاعات', Object.entries(o.hallKinds || {})) : ''}
      ${on.has('ahall') ? sel('ahall', 'القاعة', (o.halls || []).map((h) => [h, h])) : ''}
      ${on.has('acourse') ? sel('acourse', 'مادة سجل القاعات', (o.courses || []).map((c) => [c.id, c.name])) : ''}
      ${on.has('astate') ? sel('astate', 'حالة الدخول', [['open', 'داخل القاعة'], ['closed', 'خرج']]) : ''}
      ${on.has('afrom') ? `<label>سجل القاعات من تاريخ<input type="date" data-chg="xfilter" data-k="afrom" value="${esc(X.f.afrom)}"></label>` : ''}
      ${on.has('ato') ? `<label>سجل القاعات إلى تاريخ<input type="date" data-chg="xfilter" data-k="ato" value="${esc(X.f.ato)}"></label>` : ''}
    </div>`;
  }

  function table(s) {
    const more = s.total > s.rows.length ? `<p class="small no-print">المعروض أول ${s.rows.length} من ${s.total} صفاً؛ الملف المُصدَّر يضم كل الصفوف.</p>` : '';
    return `<section class="xp-set"><h3>${esc(s.title)} <span class="small">(${s.total})</span></h3><div class="tbl-wrap"><table class="xp"><thead><tr>${s.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${s.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.headers.length}" class="empty">لا بيانات ضمن المرشحات الحالية.</td></tr>`}</tbody></table></div>${more}</section>`;
  }

  UA.views.export = () => {
    if (!X.opts) return `<div class="empty">${X.err ? esc(X.err) : 'جارٍ التحميل…'}</div>`;
    const total = X.data ? X.data.sets.reduce((n, s) => n + s.total, 0) : 0;
    const dsCards = X.opts.datasets.map((d) => `<button class="xd" data-act="xds" data-d="${d.id}" aria-pressed="${X.dataset === d.id}"><span class="xd-i">${UA.icon(DS_ICON[d.id] || 'tx', 24)}</span><b>${esc(d.label)}</b><small>${esc(d.hint)}</small></button>`).join('');
    const fmts = FORMATS.map(([k, l, ic]) => `<button class="btn xfmt" data-act="xdl" data-k="${k}"${X.busy || !total ? ' disabled' : ''}>${UA.icon(ic, 18)}<span>${X.busy === k ? 'جارٍ التجهيز…' : l}</span></button>`).join('');
    const layoutOpt = ['grades', 'all'].includes(X.dataset) ? `<label class="chk xlay"><input type="checkbox" data-chg="xlayout"${X.layout === 'terms' ? ' checked' : ''}> في ملف Excel: ورقة مستقلة لكل سنة دراسية وفصل</label>` : '';
    const dsLabel = (X.opts.datasets.find((d) => d.id === X.dataset) || {}).label || '';
    return `<div class="xpage"><div class="print-head"><b>تصدير البيانات — الجامعة السورية للعلوم الأمنية</b><span>${esc(dsLabel)} · ${new Date().toLocaleDateString('ar-SY')}</span></div>
      <section class="card no-print"><h2>تصدير البيانات (المركز الموحد لكافة صادرات النظام)</h2><p class="hint" style="margin-top:0">تم تجميع كافة عمليات التصدير في النظام ضمن هذه الصفحة الموحدة: اختر المجموعة، ضيّق بالمرشحات، ثم نزّل الملف بالصيغة المطلوبة (Excel, CSV, JSON, Word, PDF).</p>
        <div class="xd-grid" role="group" aria-label="مجموعة البيانات">${dsCards}</div></section>
      <section class="card no-print xall"><div><b>${UA.icon('backup', 20)} تصدير كل البيانات (Excel شامل)</b><p class="small" style="margin:4px 0 0">ملف واحد بورقة لكل مجموعة (طلاب، مواد، علامات، طلبات، ذمم، شكاوى، سجل القاعات).</p></div><button class="btn pri" data-act="xall"${X.busy ? ' disabled' : ''}>${X.busy === 'all' ? 'جارٍ التجهيز…' : 'تنزيل الكل (xlsx)'}</button></section>
      <!-- منشئ التقارير المخصص والتصدير الفوري (ميزة #13 المنقولة) -->
      <section class="card no-print" style="border:1px solid #054239;box-shadow:0 4px 14px rgba(5,66,57,.06)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px">
          <h2 style="margin:0;display:flex;align-items:center;gap:8px">
            <span>📊 منشئ التقارير المخصص والتصدير الفوري (Custom Report Builder)</span>
          </h2>
          <span style="background:#054239;color:#D5B65D;font-weight:800;font-size:11px;padding:3px 9px;border-radius:6px;font-family:monospace">ميزة #13</span>
        </div>
        <p class="hint" style="margin-top:0">اختر مصدر البيانات وقم بمعاينة الجدول وتصديره مباشرة بصيغة CSV/Excel أو طباعته بالترويسة الرسمية.</p>
        <div class="inline-form" style="gap:10px;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap">
          <label style="flex:1;min-width:220px">مصدر البيانات
            <select id="es-rep-ds" data-no-other="1">
              ${UA.esReportOptions ? UA.esReportOptions() : ''}
            </select>
          </label>
          <button class="btn pri" type="button" data-act="esrepchange" style="height:38px;padding:0 16px">تحديث المعاينة</button>
          <button class="btn ok" type="button" data-act="esrepexport" style="height:38px;padding:0 18px;background:#0e6655;color:#fff;font-weight:700">تنزيل التقرير (CSV)</button>
          <button class="btn" type="button" data-act="esrepprint" style="height:38px;padding:0 16px">طباعة أو PDF</button>
        </div>
        <div id="es-rep-preview-mount">${UA.esReportPreview ? UA.esReportPreview() : ''}</div>
      </section>

      <section class="card no-print" style="background:#F6F8F5;border:1px solid #DCE3DD">
        <h3 style="margin:0 0 8px">صادرات تخصصية مدمجة (طلبات الخدمات Excel + دوام شؤون الموظفين)</h3>
        <div class="inline-form" style="gap:14px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:260px;display:grid;gap:4px">
            <label style="font-size:12px;font-weight:700;color:#0f766e">بحث وتصفية الخدمات
              <input type="search" id="xp-svc-search" placeholder="اكتب اسم الخدمة للفلترة السريعة..." autocomplete="off" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid #DCE3DD;margin-top:2px;font-size:13px">
            </label>
            <label style="font-size:12px">تصدير طلبات خدمة محددة (Excel)
              <select id="xp-req-svc" style="width:100%">
                <option value="">كل الخدمات</option>
                ${(S.services || []).map((s) => `<option value="${esc(s.code)}" data-filter="${esc((s.label + ' ' + s.code).toLowerCase())}">${esc(s.label)}</option>`).join('')}
              </select>
            </label>
          </div>
          <label style="min-width:140px">حالة الطلب
            <select id="xp-req-st"><option value="">الكل</option><option value="review">قيد المراجعة</option><option value="approved">معتمدة</option><option value="rejected">مرفوضة</option></select>
          </label>
          <button type="button" class="btn pri" data-act="xreqxlsx" style="height:38px">تصدير طلبات الخدمة (Excel)</button>
          <label style="min-width:160px">شهر دوام الموظفين
            <input id="xp-hr-month" type="month" value="${new Date().toISOString().slice(0, 7)}" dir="ltr">
          </label>
          <button type="button" class="btn" data-act="xhrcsv" style="height:38px">تصدير دوام الموظفين الشهري (CSV)</button>
        </div>
      </section>
      <section class="card no-print"><h2>${UA.icon('filter', 20)} المرشحات</h2>${filters()}${layoutOpt}</section>
      <section class="card no-print xbar"><div class="xbar-t"><b>${total}</b> صف جاهز للتصدير</div><div class="xfmts">${fmts}</div>
        <p class="small" style="margin:0">PDF: تُفتح نافذة الطباعة (حتى 5000 صف) فاختر «حفظ كـ PDF».</p></section>
      <section class="card"><h2>معاينة</h2>${X.err ? `<div class="err" role="alert">${esc(X.err)}</div>` : ''}${X.loading ? '<div class="empty">جارٍ التحميل…</div>' : (X.data ? X.data.sets.map(table).join('') : '')}</section></div>`;
  };

  async function download(k) {
    const q = query({ format: k }); if (X.layout === 'terms') q.set('layout', 'terms');
    const res = await fetch('/api/export/file?' + q, { credentials: 'same-origin' });
    if (!res.ok) { let m = 'تعذّر التصدير.'; try { m = (await res.json()).message || m; } catch { /* */ } throw Object.assign(new Error(m), { status: res.status }); }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `export.${k}`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  Object.assign(UA.actions, {
    xall: async () => {
      X.busy = 'all'; UA.render(); const keepD = X.dataset, keepF = { ...X.f };
      try { X.dataset = 'all'; X.f = { faculty: '', program: '', level: '', semester: '', academicYear: '', status: '', enrollYear: '', akind: '', ahall: '', acourse: '', astate: '', afrom: '', ato: '' }; await download('xlsx'); toast('تم تصدير كل البيانات'); }
      catch (e) { if (!e.status) throw e; toast(e.message); } finally { X.dataset = keepD; X.f = keepF; X.busy = ''; UA.render(); }
    },
    xreqxlsx: async () => {
      const p = new URLSearchParams();
      const s = document.getElementById('xp-req-svc')?.value || '';
      const st = document.getElementById('xp-req-st')?.value || '';
      if (s) p.set('service', s);
      if (st) p.set('status', st);
      const r = await fetch('/api/requests/export.xlsx?' + p, { credentials: 'same-origin' });
      if (!r.ok) { toast('تعذّر تصدير الطلبات'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `requests-${s || 'all'}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('تم تصدير طلبات الخدمة بصيغة Excel');
    },
    xhrcsv: async () => {
      const m = document.getElementById('xp-hr-month')?.value || new Date().toISOString().slice(0, 7);
      const r = await fetch(`/api/hr/attendance/export.xlsx?month=${encodeURIComponent(m)}`, { credentials: 'same-origin' });
      if (!r.ok) { toast('تعذّر تصدير دوام الموظفين'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `staff-attendance-${m}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('تم تصدير سجل دوام الموظفين');
    },
    xds: async (el, d) => { X.dataset = d.d; X.layout = 'single'; await loadPreview(); UA.render(); },
    xdl: async (el, d) => {
      X.busy = d.k; UA.render();
      try {
        if (d.k === 'pdf') {                                             // الطباعة تحتاج كل الصفوف لا أول 100
          await loadPreview({ limit: 5000 }); X.busy = ''; UA.render();
          document.body.classList.add('print-export'); window.addEventListener('afterprint', async () => { document.body.classList.remove('print-export'); await loadPreview(); UA.render(); }, { once: true });
          setTimeout(() => window.print(), 120); return;
        }
        await download(d.k); toast('تم التصدير');
      } catch (e) { if (!e.status) throw e; toast(e.message); } finally { if (X.busy) { X.busy = ''; UA.render(); } }
    },
  });
  document.addEventListener('change', async (e) => {
    const t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.chg === 'xfilter') {
      X.f[t.dataset.k] = t.value;
      if (t.dataset.k === 'faculty') X.f.program = '';
      await loadPreview(); UA.render();
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t && t.id === 'xp-svc-search') {
      const q = t.value.trim().toLowerCase();
      const sel = document.getElementById('xp-req-svc');
      if (sel) {
        Array.from(sel.options).forEach((opt, idx) => {
          if (idx === 0) return;
          const text = (opt.dataset.filter || opt.textContent || '').toLowerCase();
          opt.hidden = q ? !text.includes(q) : false;
        });
      }
    }
  });
})();
