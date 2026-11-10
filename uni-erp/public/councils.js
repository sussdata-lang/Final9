/* المجالس واللجان: التشكيل، والاجتماعات وجدول أعمالها، والقرارات بالنصاب والتصويت والتنحي، ومهام تنفيذ القرارات */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (UA.toast ? UA.toast(m) : window.alert(m));
  const C = { tab: 'councils', councilId: null, meetingId: null, data: null, detail: null, meeting: null };
  const ST = { draft: ['مسودة', 'p-review'], scheduled: ['مدعو إليه', 'p-review'], held: ['منعقد', 'p-approved'], closed: ['مغلق ومعتمد المحضر', 'p-approved'], cancelled: ['ملغى', 'p-rejected'] };
  const OUT = { approved: ['موافقة', 'p-approved'], rejected: ['رفض', 'p-rejected'], deferred: ['مؤجل', 'p-review'] };
  const pill = (map, k) => `<span class="pill ${(map[k] || ['', 'p-review'])[1]}">${esc((map[k] || [k])[0])}</span>`;
  const at = (t) => (t ? new Date(Number(t)).toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const table = (heads, rows, empty) => `<div class="tbl-wrap"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="small">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const val = (id) => (document.getElementById(id) || {}).value || '';

  async function load() {
    C.data = await UA.api('GET', '/api/councils');
    C.detail = C.councilId ? await UA.api('GET', `/api/councils/${C.councilId}`).catch(() => null) : null;
    C.meeting = C.meetingId ? await UA.api('GET', `/api/council-meetings/${C.meetingId}`).catch(() => null) : null;
  }
  const refresh = async (msg) => { await load(); UA.render(); if (msg) toast(msg); };
  UA.loaders.councils = load;

  function listView(d) {
    const create = d.canCreate ? `<section class="card"><h2>تشكيل مجلس أو لجنة</h2>
      <form id="cn-create" class="inline-form">
        <label style="flex:2">الاسم<input id="cn-name" required maxlength="120" placeholder="مجلس كلية الأمن السيبراني"></label>
        <label>النوع<select id="cn-type" data-no-other="1">${opts(Object.entries(d.types))}</select></label>
        <label>الوحدة<select id="cn-unit" data-no-other="1"><option value="">—</option>${opts(d.units.map((u) => [u.id, u.name]))}</select></label>
        <label>النصاب (%)<input id="cn-quorum" type="number" min="1" max="100" value="50"></label>
        <button class="btn pri" type="submit">تشكيل</button>
      </form></section>` : '';
    return `<section class="card"><h2>المجالس واللجان</h2>
      <p class="hint" style="margin-top:0">${d.canCreate ? 'كل المجالس واللجان في الجامعة.' : 'المجالس واللجان التي أنت عضو فيها.'}</p>
      ${table(['الاسم', 'النوع', 'الوحدة', 'الأعضاء', 'النصاب', 'صفتي', 'الحالة', ''], d.councils.map((c) => `<tr>
        <td><b>${esc(c.name)}</b></td><td>${esc(c.typeLabel)}</td><td>${esc(c.unit || '—')}</td><td>${c.members}</td><td>${c.quorumPercent}%</td>
        <td>${esc(c.myRole ? d.roles[c.myRole] : '—')}</td><td>${c.active ? 'فعّال' : 'غير فعّال'}</td>
        <td><button class="btn sm" type="button" data-act="cnopen" data-id="${c.id}">فتح</button></td></tr>`).join(''), 'لا توجد مجالس أو لجان.')}
    </section>${create}`;
  }

  function councilView(d, x) {
    const c = x.council, manage = d.canCreate;
    const members = table(['العضو', 'الصفة', 'التصويت', 'من', 'إلى', ''], x.members.map((m) => `<tr${m.active ? '' : ' style="opacity:.6"'}>
      <td><b>${esc(m.name)}</b></td><td>${esc(m.roleLabel)}</td><td>${m.voting ? 'يصوّت' : 'لا يصوّت'}</td><td>${esc(m.fromDay)}</td><td>${esc(m.toDay || '—')}</td>
      <td>${m.active && manage ? `<button class="btn sm" type="button" data-act="cnend" data-id="${m.id}">إنهاء العضوية</button>` : ''}</td></tr>`).join(''), 'لا أعضاء بعد.');
    const addMember = manage ? `<form id="cn-member" class="inline-form" style="margin-top:10px">
      <label style="flex:2">الموظف<select id="cn-m-user" data-no-other="1">${opts(d.staff.map((u) => [u.id, u.name]))}</select></label>
      <label>الصفة<select id="cn-m-role" data-no-other="1">${opts(Object.entries(d.roles), 'member')}</select></label>
      <button class="btn pri" type="submit">إضافة عضو</button></form>` : '';
    const newMeeting = c.canManage ? `<section class="card"><h2>اجتماع جديد</h2>
      <form id="cn-meeting" class="form">
        <div class="inline-form"><label style="flex:2">العنوان<input id="cn-mt-title" required maxlength="160" placeholder="الاجتماع الدوري الثالث"></label>
        <label>الموعد<input id="cn-mt-at" type="datetime-local" required></label><label>المكان<input id="cn-mt-loc" maxlength="120"></label></div>
        <label>جدول الأعمال (بند في كل سطر)<textarea id="cn-mt-items" rows="4" placeholder="المصادقة على محضر الاجتماع السابق&#10;النظر في طلبات المعادلة"></textarea></label>
        <button class="btn pri" type="submit">إعداد الاجتماع</button></form></section>` : '';
    return `<div class="actions" style="margin:0 0 10px"><button class="btn" type="button" data-act="cnback">← كل المجالس</button></div>
      <section class="card"><h2>${esc(c.name)}</h2><p class="hint" style="margin-top:0">${esc(c.typeLabel)} · النصاب ${c.quorumPercent}% من الأعضاء الذين يحق لهم التصويت${c.unit ? ` · ${esc(c.unit)}` : ''}</p>
        <h3>الأعضاء</h3>${members}${addMember}</section>
      <section class="card"><h2>الاجتماعات</h2>${table(['الرقم', 'العنوان', 'الموعد', 'البنود', 'الحالة', ''], x.meetings.map((m) => `<tr>
        <td class="mono">${esc(m.no)}</td><td><b>${esc(m.title)}</b></td><td>${esc(at(m.meetingAt))}</td><td>${m.items}</td><td>${pill(ST, m.status)}</td>
        <td><button class="btn sm" type="button" data-act="cnmeet" data-id="${m.id}">فتح</button></td></tr>`).join(''), 'لا اجتماعات بعد.')}</section>${newMeeting}`;
  }

  function itemView(x, i, manage) {
    const st = x.meeting.status, open = i.status === 'pending';
    const voters = x.members.filter((m) => m.voting);
    const recusals = i.recusals.length ? `<p class="small">تنحّى: ${i.recusals.map((r) => `${esc(r.name)} (${esc(r.reason)})`).join('، ')}</p>` : '';
    const recuseForm = manage && open && ['scheduled', 'held'].includes(st) ? `<form id="cn-rec-${i.id}" class="inline-form" data-cn-form="recuse" data-id="${i.id}">
      <label>تنحي عضو<select id="cn-rec-u-${i.id}" data-no-other="1">${opts(x.members.map((m) => [m.userId, m.name]))}</select></label>
      <label style="flex:2">السبب<input id="cn-rec-r-${i.id}" maxlength="300" placeholder="صلة قرابة بصاحب الطلب"></label>
      <button class="btn sm" type="button" data-act="cnrecuse" data-id="${i.id}">تسجيل التنحي</button></form>` : '';
    const decideForm = manage && open && st === 'held' ? `<div class="form" style="margin-top:8px">
      <div class="inline-form"><label>القرار<select id="cn-out-${i.id}" data-no-other="1">${opts([['approved', 'موافقة'], ['rejected', 'رفض'], ['deferred', 'تأجيل']])}</select></label>
      <label>موافق<input id="cn-vf-${i.id}" type="number" min="0" value="${voters.filter((m) => m.present).length}" style="width:80px"></label>
      <label>معارض<input id="cn-va-${i.id}" type="number" min="0" value="0" style="width:80px"></label>
      <label>ممتنع<input id="cn-vb-${i.id}" type="number" min="0" value="0" style="width:80px"></label></div>
      <label>نص القرار<textarea id="cn-txt-${i.id}" rows="2"></textarea></label>
      <button class="btn pri sm" type="button" data-act="cndecide" data-id="${i.id}">اعتماد القرار</button></div>` : '';
    const decision = open ? '' : `<p style="margin:6px 0">${pill(OUT, i.outcome)} ${i.decisionNo ? `<b class="mono">${esc(i.decisionNo)}</b> · ` : ''}${i.outcome === 'deferred' ? '' : `موافق ${i.votes.for} · معارض ${i.votes.against} · ممتنع ${i.votes.abstain}`}</p><p style="white-space:pre-line;margin:0">${esc(i.decisionText)}</p>`;
    const tasks = i.outcome === 'approved' ? `<h4 style="margin:10px 0 4px">مهام التنفيذ</h4>${table(['المهمة', 'المكلَّف', 'الموعد', 'الحالة'], i.tasks.map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.assignee)}</td><td>${esc(t.dueDay)}</td>
      <td>${t.status === 'done' ? `<span class="pill p-approved">منجزة</span> <span class="small">${esc(t.doneNote)}</span>` : t.overdue ? '<span class="pill p-rejected">متأخرة</span>' : '<span class="pill p-review">قيد التنفيذ</span>'}</td></tr>`).join(''), 'لا مهام بعد.')}
      ${manage && st !== 'cancelled' ? `<div class="inline-form" style="margin-top:6px"><label style="flex:2">مهمة<input id="cn-tk-t-${i.id}" maxlength="200"></label>
        <label>المكلَّف<select id="cn-tk-u-${i.id}" data-no-other="1">${opts((C.data.staff || []).map((u) => [u.id, u.name]))}</select></label>
        <label>الموعد<input id="cn-tk-d-${i.id}" type="date"></label><button class="btn sm" type="button" data-act="cntask" data-id="${i.id}">إسناد</button></div>` : ''}` : '';
    return `<article class="card" style="margin:10px 0"><h3 style="margin:0 0 4px">${i.seq}. ${esc(i.title)}</h3>
      ${i.details ? `<p class="small" style="white-space:pre-line;margin:0">${esc(i.details)}</p>` : ''}${i.sourceRef ? `<p class="small">المرجع: ${esc(i.sourceRef)}</p>` : ''}
      ${recusals}${decision}${recuseForm}${decideForm}${tasks}</article>`;
  }

  function meetingView(x) {
    const m = x.meeting, manage = x.canManage;
    const attendance = manage && ['scheduled', 'held'].includes(m.status) && x.items.every((i) => i.status === 'pending') ? `<section class="card"><h2>الحضور</h2>
      <div style="display:flex;flex-wrap:wrap;gap:10px">${x.members.map((p) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="cn-present" value="${p.userId}"${p.present || m.status === 'scheduled' ? ' checked' : ''}> ${esc(p.name)} <span class="small">(${esc(p.roleLabel)})</span></label>`).join('')}</div>
      <p class="small">ألغِ تحديد الغائبين.</p><button class="btn pri" type="button" data-act="cnattend" style="margin-top:10px">تسجيل الحضور وبدء الاجتماع</button></section>` : '';
    const present = x.members.filter((p) => p.present);
    const addItem = manage && ['draft', 'scheduled'].includes(m.status) ? `<form id="cn-item" class="inline-form" style="margin-top:10px">
      <label style="flex:2">بند جديد<input id="cn-it-title" maxlength="200" required></label><label>المرجع<input id="cn-it-ref" maxlength="60" placeholder="رقم طلب أو كتاب"></label>
      <button class="btn sm" type="submit">إضافة</button></form>` : '';
    const actions = manage ? `<div class="actions" style="margin:0">${m.status === 'draft' ? '<button class="btn pri" type="button" data-act="cnschedule">إرسال الدعوة للأعضاء</button>' : ''}
      ${['draft', 'scheduled'].includes(m.status) ? '<button class="btn dan" type="button" data-act="cncancel">إلغاء الاجتماع</button>' : ''}</div>` : '';
    const close = manage && m.status === 'held' ? `<section class="card"><h2>المحضر وإغلاق الاجتماع</h2>
      <p class="hint" style="margin-top:0">يُغلق الاجتماع بعد البت في كل البنود، ولا يتغير بعدها.</p>
      <textarea id="cn-minutes-txt" rows="5" style="width:100%">${esc(`عُقد اجتماع ${x.council.name} برئاسة ${(x.members.find((p) => p.role === 'chair') || {}).name || '—'}، وحضره ${present.length} من ${x.members.length} أعضاء.`)}</textarea>
      <button class="btn pri" type="button" data-act="cnclose" style="margin-top:8px">اعتماد المحضر وإغلاق الاجتماع</button></section>` : '';
    const minutes = m.status === 'closed' ? `<section class="card" id="cn-minutes" data-doc-title="محضر اجتماع" data-doc-no="${esc(m.no)}" data-doc-signers="أمين السر|رئيس المجلس">
      <h2>محضر الاجتماع ${esc(m.no)}</h2><p class="small">${esc(x.council.name)} · ${esc(at(m.meetingAt))}${m.location ? ` · ${esc(m.location)}` : ''}</p>
      <p><b>الحضور:</b> ${present.map((p) => esc(p.name)).join('، ') || '—'}</p><p style="white-space:pre-line">${esc(m.minutes)}</p>
      ${table(['البند', 'القرار', 'رقم القرار', 'الأصوات'], x.items.map((i) => `<tr><td>${esc(i.title)}</td><td>${esc((OUT[i.outcome] || ['—'])[0])}: ${esc(i.decisionText)}</td><td class="mono">${esc(i.decisionNo || '—')}</td><td>${i.outcome === 'deferred' ? '—' : `${i.votes.for}/${i.votes.against}/${i.votes.abstain}`}</td></tr>`).join(''), '')}
      </section><div class="actions"><button class="btn" type="button" data-act="elprint" data-sel="#cn-minutes">طباعة المحضر</button></div>` : '';
    return `<div class="actions" style="margin:0 0 10px"><button class="btn" type="button" data-act="cnopen" data-id="${x.council.id}">← ${esc(x.council.name)}</button></div>
      <section class="card"><h2>${esc(m.title)} <span class="mono small">${esc(m.no)}</span></h2>
        <p class="hint" style="margin-top:0">${esc(at(m.meetingAt))}${m.location ? ` · ${esc(m.location)}` : ''} · ${pill(ST, m.status)}${m.cancelReason ? ` · ${esc(m.cancelReason)}` : ''}</p>${actions}</section>
      ${attendance}
      <section class="card"><h2>جدول الأعمال</h2>${x.items.map((i) => itemView(x, i, manage)).join('') || '<p class="small">لا بنود بعد.</p>'}${addItem}</section>
      ${close}${minutes}`;
  }

  function tasksView(d) {
    return `<section class="card"><h2>مهامي من القرارات</h2>${table(['القرار', 'المجلس', 'المهمة', 'الموعد', 'الحالة', ''], d.myTasks.map((t) => `<tr>
      <td class="mono">${esc(t.decisionNo)}</td><td>${esc(t.council)}</td><td><b>${esc(t.title)}</b><div class="small">${esc(t.itemTitle)}</div></td><td>${esc(t.dueDay)}</td>
      <td>${t.status === 'done' ? '<span class="pill p-approved">منجزة</span>' : t.overdue ? '<span class="pill p-rejected">متأخرة</span>' : '<span class="pill p-review">قيد التنفيذ</span>'}</td>
      <td>${t.status === 'open' ? `<button class="btn sm" type="button" data-act="cndone" data-id="${t.id}">تم الإنجاز</button>` : esc(t.doneNote)}</td></tr>`).join(''), 'لا مهام مسندة إليك.')}</section>`;
  }

  UA.views.councils = () => {
    const d = C.data;
    if (!d) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const open = d.myTasks.filter((t) => t.status === 'open').length;
    const bar = `<div class="sub-tabs no-print" role="tablist">
      <button class="chip" role="tab" data-act="cntab" data-t="councils" aria-pressed="${C.tab === 'councils'}">المجالس واللجان</button>
      <button class="chip" role="tab" data-act="cntab" data-t="tasks" aria-pressed="${C.tab === 'tasks'}">مهامي من القرارات${open ? ` <span class="badge">${open}</span>` : ''}</button></div>`;
    if (C.tab === 'tasks') return bar + tasksView(d);
    if (C.meetingId && C.meeting) return bar + meetingView(C.meeting);
    if (C.councilId && C.detail) return bar + councilView(d, C.detail);
    return bar + listView(d);
  };

  const id = (d) => Number(d.id);
  Object.assign(UA.actions, {
    cntab: async (_el, d) => { C.tab = d.t; UA.render(); },
    cnopen: async (_el, d) => { C.tab = 'councils'; C.councilId = id(d); C.meetingId = null; await refresh(); },
    cnback: async () => { C.councilId = null; C.meetingId = null; await refresh(); },
    cnmeet: async (_el, d) => { C.meetingId = id(d); await refresh(); },
    cnend: async (_el, d) => { if (!confirm('إنهاء هذه العضوية؟ يبقى سجلها ظاهراً.')) return; await UA.api('POST', `/api/councils/${C.councilId}/members/${id(d)}/end`, {}); await refresh('أُنهيت العضوية'); },
    cnschedule: async () => { await UA.api('POST', `/api/council-meetings/${C.meetingId}/schedule`, {}); await refresh('أُرسلت الدعوة للأعضاء'); },
    cncancel: async () => { const reason = prompt('سبب إلغاء الاجتماع:'); if (!reason) return; await UA.api('POST', `/api/council-meetings/${C.meetingId}/cancel`, { reason }); await refresh('أُلغي الاجتماع'); },
    cnattend: async () => {
      const present = [...document.querySelectorAll('.cn-present:checked')].map((x) => Number(x.value));
      await UA.api('POST', `/api/council-meetings/${C.meetingId}/attendance`, { present }); await refresh('سُجل الحضور');
    },
    cnrecuse: async (_el, d) => { await UA.api('POST', `/api/council-items/${id(d)}/recuse`, { userId: Number(val(`cn-rec-u-${id(d)}`)), reason: val(`cn-rec-r-${id(d)}`) }); await refresh('سُجل التنحي'); },
    cndecide: async (_el, d) => {
      const k = id(d);
      const r = await UA.api('POST', `/api/council-items/${k}/decide`, { outcome: val(`cn-out-${k}`), votesFor: Number(val(`cn-vf-${k}`)), votesAgainst: Number(val(`cn-va-${k}`)), votesAbstain: Number(val(`cn-vb-${k}`)), text: val(`cn-txt-${k}`) });
      await refresh(r.decisionNo ? `صدر القرار ${r.decisionNo}` : 'أُجّل البند');
    },
    cntask: async (_el, d) => { const k = id(d); await UA.api('POST', `/api/council-items/${k}/tasks`, { title: val(`cn-tk-t-${k}`), assigneeId: Number(val(`cn-tk-u-${k}`)), dueDay: val(`cn-tk-d-${k}`) }); await refresh('أُسندت المهمة'); },
    cnclose: async () => { if (!confirm('اعتماد المحضر وإغلاق الاجتماع؟ لا يتغير بعدها.')) return; await UA.api('POST', `/api/council-meetings/${C.meetingId}/close`, { minutes: val('cn-minutes-txt') }); await refresh('اعتُمد المحضر'); },
    cndone: async (_el, d) => { const note = prompt('ما الذي أُنجز؟'); if (!note) return; await UA.api('POST', `/api/council-tasks/${id(d)}/done`, { note }); await refresh('سُجل الإنجاز'); },
  });
  Object.assign(UA.forms, {
    'cn-create': async () => { await UA.api('POST', '/api/councils', { name: val('cn-name'), type: val('cn-type'), unitId: Number(val('cn-unit')) || null, quorumPercent: Number(val('cn-quorum')) }); await refresh('شُكّل المجلس'); },
    'cn-member': async () => { await UA.api('POST', `/api/councils/${C.councilId}/members`, { userId: Number(val('cn-m-user')), role: val('cn-m-role') }); await refresh('أُضيف العضو'); },
    'cn-meeting': async () => {
      const items = val('cn-mt-items').split('\n').map((t) => t.trim()).filter(Boolean).map((title) => ({ title }));
      const r = await UA.api('POST', `/api/councils/${C.councilId}/meetings`, { title: val('cn-mt-title'), meetingAt: val('cn-mt-at'), location: val('cn-mt-loc'), items });
      C.meetingId = r.id; await refresh('أُعدّ الاجتماع');
    },
    'cn-item': async () => { await UA.api('POST', `/api/council-meetings/${C.meetingId}/items`, { title: val('cn-it-title'), sourceRef: val('cn-it-ref') }); await refresh('أُضيف البند'); },
  });
})();
