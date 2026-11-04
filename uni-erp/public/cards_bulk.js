/* تصدير البطاقات الجامعية دفعة واحدة بفلاتر الكلية والبرنامج والسنة، وجدول استلام كل بطاقة.
   يظهر فوق البطاقة الفردية في «البطاقة الجامعية». */
(function () {
  const UA = window.UA, { esc, api, toast, S } = UA;
  const C = { open: true, opts: null, filters: { status: 'active' }, list: null, batches: null, detail: null, q: '', busy: false };
  const dt = (ms) => (ms ? new Date(ms).toLocaleString('ar-SY') : '—');
  const query = () => new URLSearchParams(Object.entries(C.filters).filter(([, v]) => v)).toString();

  async function load() {
    C.busy = true;
    try {
      if (!C.opts) C.opts = await api('GET', '/api/cards/options');
      const [list, batches] = await Promise.all([api('GET', `/api/cards/students?${query()}`), api('GET', '/api/cards/batches')]);
      C.list = list; C.batches = batches.batches;
    } catch (e) { if (!e.status) throw e; toast(e.message); } finally { C.busy = false; }
  }
  const option = (value, label, cur) => `<option value="${esc(value)}"${String(cur ?? '') === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
  function filtersHtml() {
    const o = C.opts, f = C.filters, programs = o.programs.filter((p) => !f.faculty || String(p.facultyId) === String(f.faculty));
    const sel = (key, label, items) => `<label style="flex:1;min-width:150px">${esc(label)}<select data-card-filter="${key}" data-no-other="1">${items}</select></label>`;
    return `<div class="inline-form" style="gap:10px;align-items:flex-end">
      ${sel('faculty', 'الكلية / المعهد', option('', 'كل الجهات', f.faculty) + o.faculties.map((x) => option(x.id, x.name, f.faculty)).join(''))}
      ${sel('program', 'البرنامج', option('', 'كل البرامج', f.program) + programs.map((x) => option(x.id, x.name, f.program)).join(''))}
      ${sel('level', 'السنة الدراسية', option('', 'كل السنوات', f.level) + o.levels.map((x) => option(x.value, x.label, f.level)).join(''))}
      ${sel('enrollYear', 'سنة القيد', option('', 'كل السنوات', f.enrollYear) + o.years.map((y) => option(y, y, f.enrollYear)).join(''))}
      ${sel('status', 'حالة القيد', option('active', 'مقيَّد', f.status) + option('suspended', 'موقوف', f.status) + option('graduated', 'خريج', f.status) + option('withdrawn', 'منسحب', f.status))}
    </div>`;
  }
  function detailHtml() {
    const d = C.detail;
    if (!d) return '';
    const q = C.q.trim(), rows = d.rows.filter((r) => !q || r.name.includes(q) || String(r.studentNo).includes(q));
    const done = d.rows.filter((r) => r.receivedAt).length;
    return `<div style="margin-top:14px;padding:14px;border:1px solid var(--line,#e2e8f0);border-radius:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <b>${esc(d.batch.label)} · استلم ${done} من ${d.rows.length}</b>
        <span style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn sm" href="/api/cards/batches/${d.batch.id}/export.xlsx" download>تصدير الجدول Excel</a><button type="button" class="btn sm" data-act="card-close">إغلاق</button></span>
      </div>
      <label style="display:block;margin-top:8px">بحث في الدفعة<input id="card-q" value="${esc(C.q)}" placeholder="الاسم أو الرقم الجامعي" autocomplete="off"></label>
      <div class="tbl-wrap" style="max-height:420px;overflow:auto;margin-top:8px"><table><thead><tr><th>الرقم الجامعي</th><th>الطالب</th><th>الكلية</th><th>السنة</th><th>الحالة</th><th>وقت الاستلام</th><th>المستلم</th><th>سلّمها</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="mono">${esc(r.studentNo)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.faculty)}</td><td>${esc(r.levelLabel)}</td>
          <td><span class="pill ${r.receivedAt ? 'p-approved' : 'p-review'}">${r.receivedAt ? 'مستلَمة' : 'لم تُستلم'}</span></td><td class="small">${esc(dt(r.receivedAt))}</td><td>${esc(r.receiver)}</td><td>${esc(r.handedBy)}</td>
          <td>${r.receivedAt ? `<button type="button" class="btn sm" data-act="card-undo" data-id="${r.id}">إلغاء</button>` : `<button type="button" class="btn sm pri" data-act="card-give" data-id="${r.id}" data-name="${esc(r.name)}">تسليم</button>`}</td></tr>`).join('') || '<tr><td colspan="9" class="hint">لا نتائج.</td></tr>'}
      </tbody></table></div></div>`;
  }
  function panel() {
    const list = C.list, count = list ? list.total : 0;
    return `<details class="card" style="margin-top:0;margin-bottom:16px" data-card-bulk${C.open ? ' open' : ''}>
      <summary style="cursor:pointer;font-weight:800">📇 تصدير البطاقات دفعة واحدة وجدول الاستلام</summary>
      ${!C.opts ? '<p class="hint">جارٍ التحميل…</p>' : `<div style="margin-top:12px">${filtersHtml()}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px">
          <b>${count} طالب مطابق${list && list.truncated ? ' (يُعرض أول 2000؛ ضيّق الفلاتر)' : ''}</b>
          <span style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn pri" data-act="card-print"${count ? '' : ' disabled'}>تصدير كل البطاقات (طباعة أو PDF)</button>
            <button type="button" class="btn" data-act="card-batch"${count ? '' : ' disabled'}>حفظها دفعة لتسجيل الاستلام</button>
          </span>
        </div>
        ${(C.batches || []).length ? `<h4 style="margin:16px 0 6px">دفعات البطاقات</h4><div class="tbl-wrap"><table><thead><tr><th>الدفعة</th><th>أنشأها</th><th>التاريخ</th><th>المستلَم</th><th></th></tr></thead><tbody>${C.batches.map((b) => `<tr><td><b>${esc(b.label)}</b></td><td>${esc(b.creator)}</td><td class="small">${esc(dt(b.createdAt))}</td><td>${b.received} / ${b.total}</td><td><button type="button" class="btn sm" data-act="card-open" data-id="${b.id}">جدول الاستلام</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="small" style="margin-top:12px">لا توجد دفعات بعد.</p>'}
        ${detailHtml()}</div>`}
      ${C.list && C.list.students && C.list.students[0] && UA.idCard ? `<aside class="ux-card-preview" aria-label="معاينة البطاقة"><b class="small">معاينة البطاقة</b>${UA.idCard(C.list.students[0], { photoUrl: C.list.students[0].photoUrl })}</aside>` : ''}
    </details>`;
  }

  const wrap = () => {
    const prev = UA.renderDigitalCardSection;
    if (!prev || prev.__bulk) return;
    const wrapped = () => (UA.can('student:read') ? panel() : '') + prev();
    wrapped.__bulk = true;
    UA.renderDigitalCardSection = wrapped;
  };
  wrap();
  window.addEventListener('load', wrap);

  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d || !d.matches || !d.matches('details[data-card-bulk]')) return;
    C.open = d.open;
    if (d.open && !C.opts && !C.busy) load().then(() => UA.render());
  }, true);
  document.addEventListener('change', async (e) => {
    const key = e.target && e.target.dataset && e.target.dataset.cardFilter;
    if (!key) return;
    C.filters[key] = e.target.value;
    if (key === 'faculty') C.filters.program = '';
    await load(); UA.render();
  });
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'card-q') { C.q = e.target.value; const at = e.target.selectionStart; UA.render(); const again = document.getElementById('card-q'); if (again) { again.focus(); again.setSelectionRange(at, at); } }
  });
  const reloadDetail = async () => { C.detail = await api('GET', `/api/cards/batches/${C.detail.batch.id}`); C.batches = (await api('GET', '/api/cards/batches')).batches; UA.render(); };
  Object.assign(UA.actions, {
    'card-print': () => {
      const list = C.list && C.list.students; if (!list || !list.length) return;
      UA.printHtml(list.map((st) => UA.digitalCardHtml(st)), { card: true });
    },
    'card-batch': async () => {
      const label = window.prompt('اسم الدفعة (مثال: بطاقات السنة الأولى 2026)');
      if (!label) return;
      try { const r = await api('POST', '/api/cards/batches', { label, filters: C.filters }); C.detail = await api('GET', `/api/cards/batches/${r.id}`); C.batches = (await api('GET', '/api/cards/batches')).batches; toast(`أُنشئت الدفعة (${r.total} بطاقة)`); UA.render(); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    'card-open': async (el, d) => { try { C.q = ''; C.detail = await api('GET', `/api/cards/batches/${d.id}`); UA.render(); } catch (e) { if (!e.status) throw e; toast(e.message); } },
    'card-close': () => { C.detail = null; UA.render(); },
    'card-give': async (el, d) => {
      const receiver = window.prompt('اسم المستلم', d.name);
      if (!receiver) return;
      try { await api('POST', `/api/cards/handovers/${d.id}/receive`, { receiver }); await reloadDetail(); toast('سُجّل الاستلام'); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    'card-undo': async (el, d) => {
      if (!window.confirm('إلغاء تسجيل استلام هذه البطاقة؟')) return;
      try { await api('POST', `/api/cards/handovers/${d.id}/undo`, {}); await reloadDetail(); toast('أُلغي التسليم'); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
  });
  void S;
})();
