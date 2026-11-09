/* السكن الجامعي (المباني والغرف، الساكنون، المواد المسلمة) وشاشة الأدوات التجريبية. */
(function () {
  const UA = window.UA;
  if (!UA) return;
  const { esc, api, toast, S } = UA;
  const legacyLife = UA.views.student_life;
  const H = { tab: 'rooms', building: '', room: null, q: '', editing: null, data: null, labTab: null };
  const isStudent = () => S.me?.role === 'student';
  const canManage = () => UA.can('sa_housing:manage');
  const today = () => new Date().toISOString().slice(0, 10);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
  const load = async () => { H.data = await api('GET', '/api/housing/overview'); };

  function roomOptions(gender, cur) {
    const d = H.data, groups = {};
    for (const r of d.rooms) {
      if (gender && r.gender && r.gender !== gender) continue;
      if (r.status === 'مغلقة') continue;
      if (r.residents >= Number(r.capacity) && String(r.id) !== String(cur)) continue;
      (groups[r.building_name] ||= []).push(r);
    }
    return Object.entries(groups).map(([b, list]) => `<optgroup label="${esc(b)}">${list.map((r) => opt(r.id, `غرفة ${r.room_no} (${r.residents}/${r.capacity})`, cur)).join('')}</optgroup>`).join('');
  }

  function roomsTab() {
    const d = H.data, list = d.rooms.filter((r) => !H.building || r.building_name === H.building);
    const total = (b) => d.rooms.filter((r) => r.building_name === b.name);
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">المباني</h2>${canManage() ? '<button type="button" class="btn pri" data-hs="add-building">＋ مبنى</button>' : ''}</div>
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>المبنى</th><th>القسم</th><th>الغرف</th><th>السعة</th><th>الساكنون</th><th></th></tr></thead><tbody>
      ${d.buildings.map((b) => { const rs = total(b), cap = rs.reduce((s, r) => s + Number(r.capacity), 0), n = rs.reduce((s, r) => s + r.residents, 0); return `<tr><td><b>${esc(b.name)}</b></td><td><span class="pill p-review">${esc(b.gender)}</span></td><td>${rs.length}</td><td>${cap}</td><td>${n}</td><td style="white-space:nowrap"><button type="button" class="btn sm" data-hs="filter" data-b="${esc(b.name)}">الغرف</button>${canManage() ? ` <button type="button" class="btn sm" data-hs="edit-building" data-id="${b.id}">تعديل</button> <button type="button" class="btn sm bad" data-hs="del-building" data-id="${b.id}">حذف</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></section>
      <section class="card"><div class="tool-row"><h2 style="margin:0">الغرف <span class="small">(${list.length})</span></h2>
        <span style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap"><label style="margin:0">المبنى<select data-hsf="building" data-no-other="1">${opt('', 'كل المباني', H.building)}${d.buildings.map((b) => opt(b.name, b.name, H.building)).join('')}</select></label>${canManage() ? '<button type="button" class="btn pri" data-hs="add-room">＋ غرفة</button>' : ''}</span></div>
      <div class="tbl-wrap" style="margin-top:10px;max-height:560px;overflow:auto"><table><thead><tr><th>المبنى</th><th>الطابق</th><th>الغرفة</th><th>النوع</th><th>السعة</th><th>عدد الطلاب</th><th>الطلاب</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${list.map((r) => { const names = d.allocations.filter((a) => a.room_id === r.id).map((a) => a.student_name).join('، '); return `<tr><td>${esc(r.building_name)}</td><td>${r.floor_no}</td><td class="mono"><b>${esc(r.room_no)}</b></td><td>${esc(r.room_type)}</td><td>${r.capacity}</td><td><b>${r.residents}</b></td><td class="small">${esc(names) || '—'}</td><td>${esc(r.status)}</td><td style="white-space:nowrap">${canManage() ? `<button type="button" class="btn sm" data-hs="edit-room" data-id="${r.id}">تعديل</button> <button type="button" class="btn sm bad" data-hs="del-room" data-id="${r.id}">حذف</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">لا غرف.</td></tr>'}
      </tbody></table></div></section>`;
  }

  function residentsTab() {
    const d = H.data, q = H.q.trim();
    const list = d.allocations.filter((a) => !q || a.student_name.includes(q) || String(a.student_no).includes(q));
    return `${canManage() ? `<section class="card"><h2 style="margin-top:0">تسكين طالب</h2><form id="hs-alloc" class="inline-form" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:1;min-width:240px">اسم الطالب أو رقمه<input id="hs-a-student" data-student-picker required placeholder="ابحث واختر من القائمة"><small class="sp-name"></small></label>
        <label style="min-width:240px">الغرفة<select id="hs-a-room" required data-no-other="1"><option value="">اختر الغرفة</option>${roomOptions()}</select></label>
        <label>تاريخ السكن<input id="hs-a-day" type="date" value="${today()}"></label>
        <button class="btn pri" type="submit">تسكين</button></form></section>` : ''}
      <section class="card"><div class="tool-row"><h2 style="margin:0">الطلاب المسجلون في السكن <span class="small">(${list.length})</span></h2><label style="margin:0">بحث<input id="hs-q" value="${esc(H.q)}" placeholder="الاسم أو الرقم"></label></div>
      <div class="tbl-wrap" style="margin-top:10px;max-height:560px;overflow:auto"><table><thead><tr><th>الطالب</th><th>الرقم الجامعي</th><th>الكلية</th><th>المبنى</th><th>الغرفة</th><th>تاريخ السكن</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr><td><b>${esc(a.student_name)}</b></td><td class="mono">${esc(a.student_no)}</td><td>${esc(a.faculty_name)}</td><td>${esc(a.building_name)}</td><td class="mono">${esc(a.room_no)}</td><td>${esc(a.check_in_date)}</td><td style="white-space:nowrap">${canManage() ? `<button type="button" class="btn sm" data-hs="move" data-id="${a.id}">نقل</button> <button type="button" class="btn sm bad" data-hs="out" data-id="${a.id}">إخلاء</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا ساكنين.</td></tr>'}
      </tbody></table></div></section>`;
  }

  function suppliesTab() {
    const d = H.data, e = H.editing, q = H.q.trim();
    const picked = new Map((e?.items || []).map((x) => [x.name, x]));
    const list = d.handouts.filter((h) => !q || h.student_name.includes(q) || String(h.student_no).includes(q));
    return `${canManage() ? `<section class="card"><h2 style="margin-top:0">${e ? 'تعديل سجل المواد' : 'تسليم مواد لطالب'}</h2><form id="hs-hand" style="display:grid;gap:12px">
        <div class="inline-form" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
          <label style="flex:1;min-width:240px">اسم الطالب أو رقمه<input id="hs-h-student" data-student-picker required value="${esc(e?.student_no || '')}" placeholder="ابحث واختر من القائمة"><small class="sp-name"></small></label>
          <label>تاريخ التسليم<input id="hs-h-day" type="date" value="${esc(e?.handed_day || today())}"></label>
          <label>تاريخ الإرجاع (إن وُجد)<input id="hs-h-ret" type="date" value="${esc(e?.returned_day || '')}"></label>
        </div>
        <p class="small hint" style="margin:0">الكلية والغرفة تؤخذان من ملف الطالب وسكنه. قائمة المواد تُعدَّل من «الإعدادات العامة ← السكن الجامعي».</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px">${d.supplyItems.map((n) => { const it = picked.get(n); return `<div style="border:1px solid var(--line,#dce3dd);border-radius:8px;padding:8px"><label style="display:flex;gap:8px;align-items:center;font-weight:700;margin:0"><input type="checkbox" data-hi="${esc(n)}" ${it ? 'checked' : ''} style="width:auto"> ${esc(n)}</label><div style="display:flex;gap:6px;margin-top:6px"><input data-hq="${esc(n)}" type="number" min="1" value="${it?.qty || 1}" aria-label="الكمية" style="width:70px"><input data-hs-serial="${esc(n)}" value="${esc(it?.serial || '')}" placeholder="الرقم التسلسلي" style="flex:1;min-width:0"></div></div>`; }).join('')}</div>
        <label>ملاحظات<input id="hs-h-note" maxlength="300" value="${esc(e?.note || '')}"></label>
        <div class="actions" style="margin:0"><button class="btn pri" type="submit">${e ? 'حفظ التعديل' : 'تسجيل التسليم'}</button>${e ? '<button type="button" class="btn" data-hs="cancel-edit">إلغاء</button>' : ''}</div></form></section>` : ''}
      <section class="card"><div class="tool-row"><h2 style="margin:0">سجل المواد المسلمة <span class="small">(${list.length})</span></h2><label style="margin:0">بحث<input id="hs-q" value="${esc(H.q)}" placeholder="الاسم أو الرقم"></label></div>
      <div class="tbl-wrap" style="margin-top:10px;max-height:560px;overflow:auto"><table><thead><tr><th>الطالب</th><th>الرقم الجامعي</th><th>الكلية</th><th>الغرفة</th><th>المواد</th><th>التسليم</th><th>الإرجاع</th><th>سلّمها</th><th></th></tr></thead><tbody>
      ${list.map((h) => `<tr><td><b>${esc(h.student_name)}</b></td><td class="mono">${esc(h.student_no)}</td><td>${esc(h.faculty_name)}</td><td>${esc(h.room_label) || '—'}</td><td class="small">${h.items.map((x) => esc(`${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''}${x.serial ? ` (${x.serial})` : ''}`)).join('، ')}</td><td>${esc(h.handed_day)}</td><td>${esc(h.returned_day || '—')}</td><td>${esc(h.handed_by)}</td><td style="white-space:nowrap"><button type="button" class="btn sm" data-hs="receipt" data-id="${h.id}">وصل</button>${canManage() ? ` <button type="button" class="btn sm" data-hs="edit-hand" data-id="${h.id}">تعديل</button> <button type="button" class="btn sm bad" data-hs="del-hand" data-id="${h.id}">حذف</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">لا سجلات.</td></tr>'}
      </tbody></table></div></section>`;
  }

  function studentView() {
    const d = H.data, a = d.allocations[0];
    return `<section class="card"><h2 style="margin-top:0">سكني الجامعي</h2>${a ? `<p>المبنى: <b>${esc(a.building_name)}</b> · الغرفة: <b>${esc(a.room_no)}</b> · تاريخ السكن: ${esc(a.check_in_date)}</p>` : '<p class="hint">لست مسجلاً في السكن.</p>'}</section>
      <section class="card"><h2 style="margin-top:0">المواد التي استلمتها</h2>${d.handouts.length ? `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>المواد</th></tr></thead><tbody>${d.handouts.map((h) => `<tr><td>${esc(h.handed_day)}</td><td>${h.items.map((x) => esc(`${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''}`)).join('، ')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">لا مواد مسجلة.</p>'}</section>`;
  }

  const body = () => {
    if (!H.data) return '<div class="empty">جارٍ التحميل…</div>';
    if (isStudent()) return studentView();
    const tabs = [['rooms', 'المباني والغرف'], ['residents', 'الطلاب في السكن'], ['supplies', 'المواد والاحتياجات']];
    const bar = `<div class="sub-tabs no-print" role="tablist">${tabs.map(([t, l]) => `<button class="chip" role="tab" data-act="hstab" data-t="${t}" aria-pressed="${H.tab === t}">${l}</button>`).join('')}</div>`;
    return bar + (H.tab === 'rooms' ? roomsTab() : H.tab === 'residents' ? residentsTab() : suppliesTab());
  };
  UA.actions.hstab = async (el, d) => { H.tab = d.t; H.q = ''; H.editing = null; UA.render(); };

  UA.views.student_life = async function (el) {
    el.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try { await load(); } catch (e) { if (!e.status) throw e; el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    el.innerHTML = body();
    el.onsubmit = onSubmit; el.onclick = onClick; el.onchange = onChange; el.oninput = onInput;
  };
  const redraw = () => { const m = document.getElementById('ua-view-mount'); if (m) m.innerHTML = body(); };
  const reload = async () => { await load(); redraw(); };
  const run = async (fn, ok) => { try { await fn(); await reload(); if (ok) toast(ok); } catch (e) { if (!e.status) throw e; toast(e.message); } };
  const studentNoOf = (v) => (String(v).match(/[A-Za-z]{2,6}-\d{4}-\d{3,5}/) || [String(v).trim()])[0];

  function onSubmit(e) {
    if (e.target.id === 'hs-alloc') {
      e.preventDefault();
      run(() => api('POST', '/api/housing/allocations', { student_no: studentNoOf(document.getElementById('hs-a-student').value), room_id: Number(document.getElementById('hs-a-room').value), check_in_date: document.getElementById('hs-a-day').value }), 'سُكّن الطالب');
    } else if (e.target.id === 'hs-hand') {
      e.preventDefault();
      const items = [...e.target.querySelectorAll('[data-hi]:checked')].map((c) => { const n = c.dataset.hi, f = (a) => [...e.target.querySelectorAll(`[${a}]`)].find((x) => x.getAttribute(a) === n); return { name: n, qty: Number(f('data-hq').value) || 1, serial: f('data-hs-serial').value }; });
      const b = { student_no: studentNoOf(document.getElementById('hs-h-student').value), items, handed_day: document.getElementById('hs-h-day').value, returned_day: document.getElementById('hs-h-ret').value, note: document.getElementById('hs-h-note').value };
      const id = H.editing?.id;
      run(async () => { await (id ? api('PUT', `/api/housing/handouts/${id}`, b) : api('POST', '/api/housing/handouts', b)); H.editing = null; }, 'حُفظ السجل');
    }
  }
  function onChange(e) { if (e.target.dataset?.hsf === 'building') { H.building = e.target.value; redraw(); } }
  function onInput(e) { if (e.target.id === 'hs-q') { H.q = e.target.value; const at = e.target.selectionStart; redraw(); const n = document.getElementById('hs-q'); if (n) { n.focus(); n.setSelectionRange(at, at); } } }
  async function onClick(e) {
    const b = e.target.closest('[data-hs]');
    if (!b) return;
    const a = b.dataset.hs, id = Number(b.dataset.id), d = H.data, GENDERS = ['ذكور', 'إناث'];
    if (a === 'filter') { H.building = b.dataset.b; redraw(); }
    else if (a === 'add-building') {
      const v = await askForm({ title: 'إضافة مبنى', submit: 'إضافة المبنى', fields: [
        { name: 'name', label: 'اسم المبنى', required: true },
        { name: 'gender', label: 'القسم', type: 'select', options: GENDERS, value: 'ذكور' },
        { name: 'rooms', label: 'عدد الغرف', type: 'number', min: 0, value: 50, required: true },
        { name: 'capacity', label: 'سعة الغرفة', type: 'number', min: 1, value: 4, required: true },
      ] });
      if (v) run(() => api('POST', '/api/housing/buildings', v), 'أُضيف المبنى');
    } else if (a === 'edit-building') {
      const x = d.buildings.find((v) => v.id === id);
      const v = await askForm({ title: 'تعديل المبنى', fields: [
        { name: 'name', label: 'اسم المبنى', value: x.name, required: true },
        { name: 'gender', label: 'القسم', type: 'select', options: GENDERS, value: x.gender },
        { name: 'addRooms', label: 'غرف إضافية', type: 'number', min: 0, value: 0, required: true },
      ] });
      if (v) run(() => api('PUT', `/api/housing/buildings/${id}`, v), 'حُفظ');
    } else if (a === 'del-building') { if (window.confirm('حذف المبنى وغرفه؟')) run(() => api('DELETE', `/api/housing/buildings/${id}`), 'حُذف'); }
    else if (a === 'add-room' || a === 'edit-room') {
      const x = a === 'edit-room' ? d.rooms.find((v) => v.id === id) : null;
      const v = await askForm({ title: x ? `تعديل الغرفة ${x.room_no}` : 'إضافة غرفة', fields: [
        ...(x ? [] : [{ name: 'building_name', label: 'المبنى', type: 'select', options: d.buildings.map((n) => n.name), value: H.building || d.buildings[0]?.name, required: true }]),
        { name: 'room_no', label: 'رقم الغرفة', value: x?.room_no ?? '', required: true },
        { name: 'capacity', label: 'السعة', type: 'number', min: 1, value: x?.capacity ?? 4, required: true },
        { name: 'floor_no', label: 'الطابق', type: 'number', value: x?.floor_no ?? 1, required: true },
        ...(x ? [{ name: 'status', label: 'الحالة', type: 'select', options: ['متاحة', 'مغلقة'], value: x.status }] : []),
      ] });
      if (!v) return;
      const payload = { building_name: x?.building_name, status: 'متاحة', room_type: x?.room_type, ...v };
      run(() => (x ? api('PUT', `/api/housing/rooms/${id}`, payload) : api('POST', '/api/housing/rooms', payload)), 'حُفظت الغرفة');
    } else if (a === 'del-room') { if (window.confirm('حذف الغرفة؟')) run(() => api('DELETE', `/api/housing/rooms/${id}`), 'حُذفت'); }
    else if (a === 'move') {
      const x = d.allocations.find((v) => v.id === id);
      const free = d.rooms.filter((r) => r.id !== x.room_id && r.residents < Number(r.capacity) && r.status !== 'مغلقة');
      if (!free.length) { toast('لا توجد غرفة متاحة.'); return; }
      free.sort((p, q) => (q.building_name === x.building_name) - (p.building_name === x.building_name));
      const v = await askForm({ title: 'نقل الطالب إلى غرفة أخرى', submit: 'نقل الطالب', fields: [
        { name: 'room_id', label: 'الغرفة الجديدة', type: 'select', required: true, options: free.map((r) => ({ value: r.id, label: `${r.building_name} / غرفة ${r.room_no} (${r.residents} من ${r.capacity})` })) },
      ] });
      if (v) run(() => api('PUT', `/api/housing/allocations/${id}`, { room_id: Number(v.room_id) }), 'نُقل الطالب');
    } else if (a === 'out') { if (window.confirm('إخلاء الطالب من السكن؟')) run(() => api('DELETE', `/api/housing/allocations/${id}`), 'أُخلي الطالب'); }
    else if (a === 'edit-hand') { H.editing = d.handouts.find((v) => v.id === id); redraw(); }
    else if (a === 'cancel-edit') { H.editing = null; redraw(); }
    else if (a === 'del-hand') { if (window.confirm('حذف سجل المواد؟')) run(() => api('DELETE', `/api/housing/handouts/${id}`), 'حُذف'); }
    else if (a === 'receipt') {
      const h = d.handouts.find((v) => v.id === id);
      if (UA.printDoc) {
        UA.printDoc({ title: 'وصل استلام مواد السكن الجامعي', no: h.handout_no, dept: 'السكن الجامعي', date: h.handed_day,
          html: `<table class="a4-kv a4-kv2"><tbody><tr><th>الطالب</th><td>${esc(h.student_name)}</td><th>الرقم الجامعي</th><td>${esc(h.student_no)}</td></tr><tr><th>الكلية</th><td>${esc(h.faculty_name)}</td><th>الغرفة</th><td>${esc(h.room_label || '—')}</td></tr></tbody></table><h3>المواد المستلمة</h3><table><thead><tr><th>المادة</th><th>الكمية</th><th>الرقم التسلسلي</th></tr></thead><tbody>${h.items.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${esc(x.serial || '')}</td></tr>`).join('')}</tbody></table>${h.note ? `<p><b>ملاحظات:</b> ${esc(h.note)}</p>` : ''}`,
          signers: [['الطالب المستلم', h.student_name], ['المسلِّم', h.handed_by], ['مشرف السكن', '']] });
        return;
      }
      UA.printDocument(`<h2 style="text-align:center">وصل استلام مواد السكن الجامعي</h2><p>رقم الوصل: <b>${esc(h.handout_no)}</b> · التاريخ: ${esc(h.handed_day)}</p><p>الطالب: <b>${esc(h.student_name)}</b> (${esc(h.student_no)}) · ${esc(h.faculty_name)} · الغرفة: ${esc(h.room_label || '—')}</p><table><thead><tr><th>المادة</th><th>الكمية</th><th>الرقم التسلسلي</th></tr></thead><tbody>${h.items.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${esc(x.serial || '')}</td></tr>`).join('')}</tbody></table><p>${esc(h.note)}</p><div style="display:flex;justify-content:space-between;margin-top:40px"><span>توقيع الطالب: ................</span><span>المسلِّم: ${esc(h.handed_by)}</span></div>`,
        '@page{size:A4 portrait;margin:0}', 'body{font-family:Tahoma,Arial,sans-serif;padding:15mm;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #8B9591;padding:6px;text-align:right}');
    }
  }

  /* ---------- أدوات تجريبية ---------- */
  const LAB_TABS = [
    ['office', 'حجوزات الساعات المكتبية والإرشاد', ['sa_housing:view', 'sa_housing:manage', 'faculty:manage']],
    ['library', 'المكتبة الرقمية والإعارة', ['lms_lib:view', 'lms_lib:write', 'lms_lib:edit', 'lms_lib:approve', 'course:manage', 'academic:read']],
    ['activities', 'الأندية والأنشطة الطلابية', ['sa_housing:view', 'sa_housing:manage']],
  ];
  UA.views.labtools = async function (el) {
    const tabs = LAB_TABS.filter((t) => S.me?.role === 'admin' || t[2].some((p) => UA.can(p)));
    if (!tabs.some((t) => t[0] === H.labTab)) H.labTab = tabs[0]?.[0];
    el.innerHTML = `<section class="card"><h2 style="margin:0">أدوات تجريبية</h2><p class="hint" style="margin:4px 0 0">أدوات قيد التجربة، جُمعت هنا منفصلة عن الأعمال اليومية.</p></section>
      <div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="labtab" data-t="${t[0]}" aria-pressed="${H.labTab === t[0]}">${t[1]}</button>`).join('')}</div><div id="lab-body"><div class="empty">جارٍ التحميل…</div></div>`;
    const box = el.querySelector('#lab-body');
    if (H.labTab === 'library') await UA.views.lms(box, S.me, 'library');
    else if (H.labTab === 'office') await legacyLife(box, S.me, 'office');
    else if (H.labTab === 'activities') await legacyLife(box, S.me, 'dorms');
  };
  UA.actions.labtab = async (el, d) => { H.labTab = d.t; UA.render(); };
})();
