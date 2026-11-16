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
      const [list, batches] = await Promise.all([api('GET', `/api/cards/students?limit=31&${query()}`), api('GET', '/api/cards/batches')]);
      C.list = list; C.batches = batches.batches;
    } catch (e) { if (!e.status) throw e; toast(e.message); } finally { C.busy = false; }
  }
  const option = (value, label, cur) => `<option value="${esc(value)}"${String(cur ?? '') === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
  function filtersHtml() {
    const o = C.opts, f = C.filters, programs = o.programs.filter((p) => !f.faculty || String(p.facultyId) === String(f.faculty));
    const sel = (key, label, items) => `<label style="flex:1;min-width:150px">${esc(label)}<select data-card-filter="${key}" data-no-other="1">${items}</select></label>`;
    return `<label style="display:block;margin-bottom:10px">بحث بالاسم أو الرقم الجامعي<input id="card-search" value="${esc(f.q || '')}" maxlength="60" placeholder="اكتب اسم الطالب أو رقمه لطباعة بطاقته وحده" autocomplete="off"></label>
      <div class="inline-form" style="gap:10px;align-items:flex-end">
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
    return `<div style="margin-top:14px;padding:14px;border:1px solid var(--line,#DCE3DD);border-radius:10px">
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
  // نتائج البحث: طباعة بطاقة طالب واحد من بينها
  function matchesHtml() {
    if (!C.filters.q || !C.list) return '';
    const rows = C.list.students.slice(0, 30).map((s) => `<tr><td class="mono">${esc(s.studentNo)}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.program.faculty || '')}</td><td>${esc(s.levelLabel)}</td><td><button type="button" class="btn sm" data-act="card-cert-one" data-id="${s.id}">شهادة التسجيل</button> <button type="button" class="btn sm pri" data-act="card-print-one" data-id="${s.id}">البطاقة الشخصية</button></td></tr>`).join('');
    return `<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>الرقم الجامعي</th><th>الطالب</th><th>الكلية</th><th>السنة</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="hint">لا طلاب مطابقون.</td></tr>'}</tbody></table></div>${C.list.students.length > 30 ? '<p class="small">تُعرض أول 30 نتيجة؛ أكمل كتابة الاسم.</p>' : ''}`;
  }
  function panel() {
    const list = C.list, count = list ? list.total : 0;
    return `<details class="card" style="margin-top:0;margin-bottom:16px" data-card-bulk${C.open ? ' open' : ''}>
      <summary style="cursor:pointer;font-weight:800">📇 طباعة شهادات التسجيل والبطاقات الشخصية وجدول الاستلام</summary>
      ${!C.opts ? '<p class="hint">جارٍ التحميل…</p>' : `<div style="margin-top:12px">${filtersHtml()}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px">
          <b>${count} طالب مطابق${list && list.truncated ? ' (يُعرض أول 2000؛ ضيّق الفلاتر)' : ''}</b>
          <span style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            ${UA.cardPrintModeHtml()}
            <button type="button" class="btn pri" data-act="card-print-certs"${count ? '' : ' disabled'}>${count === 1 ? 'طباعة شهادة التسجيل' : `طباعة شهادات التسجيل (${count})`}</button>
            <button type="button" class="btn pri" data-act="card-print"${count ? '' : ' disabled'}>${count === 1 ? 'طباعة البطاقة الشخصية' : `طباعة البطاقات الشخصية (${count})`}</button>
            <button type="button" class="btn" data-act="card-batch"${count ? '' : ' disabled'}>حفظها دفعة لتسجيل الاستلام</button>
          </span>
        </div>
        ${matchesHtml()}
        ${(C.batches || []).length ? `<h4 style="margin:16px 0 6px">دفعات البطاقات</h4><div class="tbl-wrap"><table><thead><tr><th>الدفعة</th><th>أنشأها</th><th>التاريخ</th><th>المستلَم</th><th></th></tr></thead><tbody>${C.batches.map((b) => `<tr><td><b>${esc(b.label)}</b></td><td>${esc(b.creator)}</td><td class="small">${esc(dt(b.createdAt))}</td><td>${b.received} / ${b.total}</td><td><button type="button" class="btn sm" data-act="card-open" data-id="${b.id}">جدول الاستلام</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="small" style="margin-top:12px">لا توجد دفعات بعد.</p>'}
        ${detailHtml()}</div>`}
      ${C.list && C.list.students && C.list.students[0] && UA.idCard ? `<aside class="ux-card-preview" aria-label="معاينة شهادة التسجيل"><b class="small">معاينة شهادة التسجيل</b>${UA.idCard(C.list.students[0], { cred: { username: C.list.students[0].studentNo, tempPassword: '••••••••' } })}</aside>` : ''}
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
  let searchTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'card-search') {
      C.filters.q = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        await load(); UA.render();
        const again = document.getElementById('card-search');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 300);
      return;
    }
    if (e.target && e.target.id === 'card-q') { C.q = e.target.value; const at = e.target.selectionStart; UA.render(); const again = document.getElementById('card-q'); if (again) { again.focus(); again.setSelectionRange(at, at); } }
  });
  // الشهادة تحمل كلمة مرور مؤقتة، وهي مخزنة بصمة فلا تُقرأ: تُصدر جديدة لمن لم يدخل بعد، ومن غيّر كلمته لا تُمس
  async function printCertificates(body, count) {
    const msg = count === 1 ? 'ستُصدر كلمة مؤقتة جديدة إن لم يدخل الطالب بعد، وتبطل الورقة السابقة. متابعة؟' : `ستُطبع ${count} شهادة، وتُصدر كلمة مؤقتة جديدة لمن لم يدخل بعد، وتبطل أوراقهم السابقة. متابعة؟`;
    if (!window.confirm(msg)) return;
    try {
      toast('جارٍ تجهيز الشهادات…');
      const { students } = await api('POST', '/api/cards/certificates', body);
      UA.printCertificates(students.map((s) => UA.idCard(s, { cert: s.cert, cred: { username: s.studentNo, tempPassword: s.tempPassword || 'غيّرها الطالب بعد أول دخول' } })));
    } catch (e) { if (!e.status) throw e; toast(e.message); }
  }
  const reloadDetail = async () => { C.detail = await api('GET', `/api/cards/batches/${C.detail.batch.id}`); C.batches = (await api('GET', '/api/cards/batches')).batches; UA.render(); };
  Object.assign(UA.actions, {
    'card-print': async () => {
      if (!C.list || !C.list.total) return;
      const list = (await api('GET', `/api/cards/students?qr=1&${query()}`)).students;
      UA.printHtml(list.map((st) => UA.cardSides(st)), { card: true });
    },
    'card-print-certs': async () => {
      if (!C.list || !C.list.total) return;
      await printCertificates({ filters: C.filters }, C.list.total);
    },
    'card-cert-one': async (el, d) => { await printCertificates({ studentIds: [Number(d.id)] }, 1); },
    'card-print-one': async (el, d) => {
      try {
        const st = (await api('GET', `/api/cards/students?qr=1&id=${Number(d.id)}`)).students[0];
        if (st) UA.printHtml([UA.cardSides(st)], { card: true });
      } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    'card-batch': async () => {
      const label = await askText('دفعة بطاقات جديدة', { label: 'اسم الدفعة', placeholder: 'بطاقات السنة الأولى 2026', submit: 'إنشاء الدفعة' });
      if (!label) return;
      try { const r = await api('POST', '/api/cards/batches', { label, filters: C.filters }); C.detail = await api('GET', `/api/cards/batches/${r.id}`); C.batches = (await api('GET', '/api/cards/batches')).batches; toast(`أُنشئت الدفعة (${r.total} بطاقة)`); UA.render(); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    'card-open': async (el, d) => { try { C.q = ''; C.detail = await api('GET', `/api/cards/batches/${d.id}`); UA.render(); } catch (e) { if (!e.status) throw e; toast(e.message); } },
    'card-close': () => { C.detail = null; UA.render(); },
    'card-give': async (el, d) => {
      const receiver = await askText('تسجيل استلام البطاقة', { label: 'اسم المستلم', value: d.name, submit: 'تسجيل الاستلام' });
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
