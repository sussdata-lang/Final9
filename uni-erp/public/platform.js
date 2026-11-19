/* مركز العمل (hub): أنشطتي ومهامي، والموافقات، والتقارير المحورية، والأتمتة، ونقاش أي سجل في النظام.
   يُحمَّل عند فتح الشاشة (LAZY في app.js). مكوّن النقاش متاح للوحدات الأخرى عبر UA.openRecord(model, id). */
(function () {
  'use strict';
  const UA = window.UA;
  if (!UA) return;
  const esc = UA.esc, toast = (m) => UA.toast(m), val = (id) => (document.getElementById(id) || {}).value || '';
  const can = (p) => UA.can(p);
  const at = (t) => (t ? new Date(Number(t)).toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const money = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
  const pill = (cls, t) => `<span class="pill ${cls}">${esc(t)}</span>`;
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const table = (heads, rows, empty) => `<div class="tbl-wrap"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="small">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Damascus' }).slice(0, 10);
  const H = { tab: 'mine', box: 'mine', sum: null, acts: [], people: [], rec: null, apprBox: 'todo', appr: [], apprId: null, apprDetail: null, types: null, catalog: null, editType: null,
    pivot: { datasets: [], q: { dataset: '', row: '', col: '', measure: 'count', from: '', to: '' }, result: null }, auto: null, editRule: null };
  const AST = { open: 'p-review', done: 'p-approved', cancelled: 'p-rejected' };
  const RST = { pending: 'p-review', approved: 'p-approved', rejected: 'p-rejected', cancelled: 'p-rejected' };
  const SST = { waiting: 'p-mut', pending: 'p-review', approved: 'p-approved', rejected: 'p-rejected', skipped: 'p-mut' };
  const KIND = { todo: 'مهمة', call: 'اتصال', meeting: 'اجتماع', review: 'مراجعة', deadline: 'موعد نهائي' };

  /* ===== التحميل ===== */
  async function loadPeople(q = '') { H.people = (await UA.api('GET', `/api/hub/people?q=${encodeURIComponent(q)}`)).people; }
  async function loadTab() {
    H.sum = await UA.api('GET', '/api/hub/summary');
    if (H.tab === 'mine') {
      H.acts = (await UA.api('GET', `/api/activities?box=${H.box === 'done' ? 'mine' : H.box}&status=${H.box === 'done' ? 'done' : 'open'}`)).activities;
      if (H.rec) H.rec.data = await UA.api('GET', `/api/records/${H.rec.model}/${H.rec.id}/thread`);
    } else if (H.tab === 'approvals') {
      if (!H.types) { const t = await UA.api('GET', `/api/approval-types${can('approvals:manage') ? '?all=1' : ''}`); H.types = t.types; H.catalog = t.catalog; }
      if (H.apprId) {
        H.apprDetail = await UA.api('GET', `/api/approvals/${H.apprId}`);
        H.rec = { model: 'approval', id: H.apprId, data: await UA.api('GET', `/api/records/approval/${H.apprId}/thread`) };
      } else if (H.apprBox === 'todo') H.inbox = (await UA.api('GET', '/api/approvals/inbox')).items;
      else if (H.apprBox !== 'new' && H.apprBox !== 'types') H.appr = (await UA.api('GET', `/api/approvals?box=${H.apprBox}`)).approvals;
    } else if (H.tab === 'pivot') {
      if (!H.pivot.datasets.length) {
        H.pivot.datasets = (await UA.api('GET', '/api/reports/pivot/datasets')).datasets;
        const d = H.pivot.datasets[0];
        if (d) Object.assign(H.pivot.q, { dataset: d.key, row: d.dims[0].key, col: '', measure: 'count' });
      }
    } else if (H.tab === 'auto') H.auto = await UA.api('GET', '/api/automation');
    if (!H.people.length) await loadPeople();
  }
  UA.loaders.hub = async () => {
    const link = UA.hubDeepLink; UA.hubDeepLink = null;
    if (link) {
      const p = new URLSearchParams(String(link).replace(/^[^?]*\?/, ''));
      const rec = /^([a-z_]+):(\d+)$/.exec(p.get('rec') || '');
      if (p.get('tab') === 'approvals' || p.get('id')) { H.tab = 'approvals'; H.apprId = Number(p.get('id')) || null; }
      else if (rec) { H.tab = 'mine'; H.rec = { model: rec[1], id: Number(rec[2]) }; }
      else H.tab = 'mine';
    }
    await loadTab();
  };
  const reload = async (msg) => { await loadTab(); UA.render(); if (msg) toast(msg); };
  UA.openRecord = async (model, id) => { H.tab = 'mine'; H.rec = { model, id: Number(id) }; await UA.go('hub'); };

  /* ===== مكوّن النقاش ===== */
  function personSel(id, sel, withSelf = true) {
    const me = UA.S.me;
    const list = [...(withSelf && me ? [[me.id, `أنا (${me.display_name || me.name || ''})`]] : []), ...H.people.filter((p) => !me || p.id !== me.id).map((p) => [p.id, `${p.name}${p.unit ? ` — ${p.unit}` : ''}`])];
    return `<select id="${id}" data-no-other="1">${opts(list, sel)}</select>`;
  }
  const peopleSearch = (pfx) => `<label>بحث عن موظف<span style="display:flex;gap:4px"><input id="${pfx}-q" maxlength="60" placeholder="اسم أو اسم مستخدم"><button class="btn sm" type="button" data-act="hbpeople" data-p="${pfx}">بحث</button></span></label>`;
  function msgHtml(m) {
    const kind = { comment: '', note: pill('p-mut', 'ملاحظة داخلية'), tracking: pill('p-review', 'تغيير'), system: pill('p-mut', 'النظام') }[m.kind];
    const tr = m.tracking?.length ? `<ul class="small" style="margin:4px 0 0">${m.tracking.map((t) => `<li>${esc(t.label)}: ${esc(t.from ?? '—')} ← ${esc(t.to ?? '—')}</li>`).join('')}</ul>` : '';
    return `<div style="border-bottom:1px solid var(--line,#e5e7eb);padding:8px 0"><div class="small"><b>${esc(m.author)}</b> · ${esc(at(m.at))} ${kind}</div>${m.body ? `<div style="white-space:pre-line">${esc(m.body)}</div>` : ''}${tr}</div>`;
  }
  function actRows(list, withRecord) {
    return list.map((a) => `<tr><td>${pill('p-mut', a.kindLabel)} <b>${esc(a.title)}</b>${a.note ? `<div class="small" style="white-space:pre-line">${esc(a.note)}</div>` : ''}
      ${withRecord && a.model ? `<div class="small"><a href="#" data-act="hbrec" data-m="${esc(a.model)}" data-id="${a.resId}">${esc(a.modelLabel)}: ${esc(a.record || '')}</a></div>` : ''}</td>
      <td>${esc(a.assignee)}<div class="small">من ${esc(a.creator)}</div></td>
      <td>${esc(a.due)} ${a.status === 'open' ? (a.overdue ? pill('p-rejected', 'متأخر') : a.dueToday ? pill('p-review', 'اليوم') : '') : pill(AST[a.status], a.status === 'done' ? 'منجز' : 'ملغى')}${a.doneNote ? `<div class="small">${esc(a.doneNote)}</div>` : ''}</td>
      <td>${a.canEdit ? `<button class="btn pri sm" type="button" data-act="hbdone" data-id="${a.id}">تم</button> <button class="btn sm" type="button" data-act="hbresched" data-id="${a.id}" data-due="${esc(a.due)}">تأجيل</button>
        ${a.creatorId === UA.S.me.id ? ` <button class="btn dan sm" type="button" data-act="hbcancel" data-id="${a.id}">إلغاء</button>` : ''}` : ''}</td></tr>`).join('');
  }
  function activityForm(pfx, model, id) {
    return `<div class="inline-form" style="margin-top:8px"><label style="flex:2">النشاط<input id="${pfx}-title" maxlength="160" placeholder="ما المطلوب؟"></label>
      <label>النوع<select id="${pfx}-kind" data-no-other="1">${opts(Object.entries(KIND))}</select></label>
      <label>الاستحقاق<input id="${pfx}-due" type="date" min="${today()}" value="${today()}"></label>
      <label style="flex:2">المسند إليه${personSel(`${pfx}-who`)}</label>${peopleSearch(pfx)}</div>
      <label>تفاصيل<textarea id="${pfx}-note" rows="2" maxlength="1000"></textarea></label>
      <button class="btn pri sm" type="button" data-act="hbadd" data-p="${pfx}"${model ? ` data-m="${esc(model)}" data-id="${id}"` : ''} style="margin-top:6px">إضافة النشاط</button>`;
  }
  function threadHtml(rec) {
    const d = rec.data;
    if (!d) return '';
    return `<section class="card"><h2>${esc(d.record.label)}: ${esc(d.record.title)}</h2>
      <p class="hint" style="margin-top:0">المتابعون: ${d.followers.map((f) => esc(f.name)).join('، ') || '—'}
        <button class="btn sm" type="button" data-act="hbfollow" data-on="${d.following ? '0' : '1'}">${d.following ? 'إلغاء المتابعة' : 'متابعة'}</button></p>
      <label>تعليق<textarea id="ch-body" rows="3" maxlength="4000" placeholder="التعليق يُشعر المتابعين؛ الملاحظة الداخلية لا تُشعر أحداً"></textarea></label>
      <div class="actions" style="margin:6px 0 10px"><button class="btn pri sm" type="button" data-act="hbpost" data-k="comment">إرسال تعليق</button> <button class="btn sm" type="button" data-act="hbpost" data-k="note">ملاحظة داخلية</button></div>
      <h3>الأنشطة</h3>${table(['النشاط', 'المسند إليه', 'الاستحقاق', ''], actRows(d.activities, false), 'لا أنشطة على هذا السجل.')}
      ${activityForm('ra', rec.model, rec.id)}
      <h3 style="margin-top:14px">السجل</h3>${d.messages.map(msgHtml).join('') || '<p class="small">لا رسائل بعد.</p>'}</section>`;
  }

  /* ===== أنشطتي ===== */
  function mineView() {
    const s = H.sum?.activities || { open: 0, overdue: 0, today: 0 };
    const back = H.rec ? `<div class="actions" style="margin:0 0 10px"><button class="btn" type="button" data-act="hbunrec">← أنشطتي</button></div>` : '';
    if (H.rec) return back + threadHtml(H.rec);
    const boxes = [['mine', 'المسندة إليّ'], ['created', 'كلّفت بها غيري'], ['done', 'المنجزة']];
    return `<section class="card"><h2>أنشطتي ومهامي</h2><p class="hint" style="margin-top:0">مفتوحة ${s.open} · اليوم ${s.today} · متأخرة ${s.overdue}</p>
      <div class="actions" style="margin:0 0 8px">${boxes.map(([k, l]) => `<button class="chip" type="button" data-act="hbbox" data-b="${k}" aria-pressed="${H.box === k}">${l}</button>`).join(' ')}</div>
      ${table(['النشاط', 'المسند إليه', 'الاستحقاق', ''], actRows(H.acts, true), 'لا أنشطة هنا.')}</section>
      <section class="card"><h2>نشاط جديد</h2><p class="hint" style="margin-top:0">مهمة لك أو لزميل، بموعد وتذكير تلقائي يوم الاستحقاق وعند التأخر.</p>${activityForm('na')}</section>`;
  }

  /* ===== الموافقات ===== */
  function approvalsView() {
    const boxes = [['todo', `بانتظار قراري${H.sum?.approvalsTodo ? ` (${H.sum.approvalsTodo})` : ''}`], ['mine', 'طلباتي'], ['new', 'طلب جديد'],
      ...(can('approvals:manage') || can('approvals:read_all') ? [['all', 'كل الطلبات']] : []), ...(can('approvals:manage') ? [['types', 'أنواع الموافقات']] : [])];
    const bar = `<div class="actions" style="margin:0 0 10px">${boxes.map(([k, l]) => `<button class="chip" type="button" data-act="hbabox" data-b="${k}" aria-pressed="${!H.apprId && H.apprBox === k}">${esc(l)}</button>`).join(' ')}</div>`;
    if (H.apprId && H.apprDetail) return bar + approvalDetail(H.apprDetail);
    if (H.apprBox === 'new') return bar + newApproval();
    if (H.apprBox === 'types') return bar + typesView();
    if (H.apprBox === 'todo') return bar + inboxView();
    return bar + `<section class="card">${table(['الرقم', 'الطلب', 'المبلغ', 'مقدّم الطلب', 'الحالة', ''], H.appr.map((r) => `<tr><td class="mono">${esc(r.no)}</td>
      <td><b>${esc(r.title)}</b><div class="small">${esc(r.type)}${r.linked ? ` · ${esc(r.linked.label)}: ${esc(r.linked.title || '')}` : ''}</div></td><td>${money(r.amount)}</td>
      <td>${esc(r.requester)}<div class="small">${esc(at(r.at))}</div></td><td>${pill(RST[r.status], r.statusLabel)}${r.current ? `<div class="small">${esc(r.current)}</div>` : ''}</td>
      <td><button class="btn${r.awaitingMe ? ' pri' : ''} sm" type="button" data-act="hbaopen" data-id="${r.id}">${r.awaitingMe ? 'البت' : 'فتح'}</button></td></tr>`).join(''), 'لا طلبات هنا.')}</section>`;
  }
  // الصندوق الموحّد: الموافقات العامة وسلاسل الوحدات (المشتريات، المراسلات، حركات القيد) في جدول واحد
  function inboxView() {
    const list = H.inbox || [];
    const rows = list.map((x) => `<tr><td>${pill('p-mut', x.sourceLabel)}<div class="mono small">${esc(x.no || '')}</div></td>
      <td><b>${esc(x.title)}</b><div class="small">${esc(x.step || '')}</div></td><td>${money(x.amount)}</td><td>${esc(x.requester || '—')}${x.at ? `<div class="small">${esc(at(x.at))}</div>` : ''}</td>
      <td>${x.source === 'approval' ? `<button class="btn pri sm" type="button" data-act="hbaopen" data-id="${x.id}">البت</button>`
        : x.actions.map((a) => `<button class="btn sm${a.key === 'approve' ? ' pri' : a.key === 'reject' ? ' dan' : ''}" type="button" data-act="hbidec" data-s="${esc(x.source)}" data-id="${x.id}" data-d="${a.key}" data-n="${a.needsNote ? 1 : 0}"${x.stepNo ? ` data-step="${x.stepNo}"` : ''}>${esc(a.label)}</button>`).join(' ')}
        <button class="btn sm" type="button" data-act="hbrec" data-m="${esc(x.model)}" data-id="${x.resId}">النقاش</button></td></tr>`).join('');
    const by = {};
    for (const x of list) by[x.sourceLabel] = (by[x.sourceLabel] || 0) + 1;
    return `<section class="card"><h2>بانتظار قراري</h2><p class="hint" style="margin-top:0">${Object.entries(by).map(([k, n]) => `${esc(k)}: ${n}`).join(' · ') || 'لا شيء ينتظرك.'}</p>
      ${table(['المصدر', 'الطلب والمرحلة', 'المبلغ', 'مقدّم الطلب', ''], rows, 'لا شيء ينتظر قرارك.')}</section>`;
  }
  function approvalDetail(d) {
    const steps = table(['#', 'الخطوة', 'المعتمد', 'الحالة', 'القرار'], d.steps.map((s) => `<tr><td>${s.seq}</td><td>${esc(s.label)}</td><td>${esc(s.approver)}</td>
      <td>${pill(SST[s.status], s.statusLabel)}</td><td>${s.decidedBy ? `${esc(s.decidedBy)}<div class="small">${esc(at(s.decidedAt))}${s.note ? ` — ${esc(s.note)}` : ''}</div>` : ''}</td></tr>`).join(''), '');
    return `<div class="actions" style="margin:0 0 10px"><button class="btn" type="button" data-act="hbaback">← القائمة</button></div>
      <section class="card"><h2>${esc(d.no)} — ${esc(d.title)} ${pill(RST[d.status], d.statusLabel)}</h2>
      <p class="hint" style="margin-top:0">${esc(d.type)} (${d.mode === 'parallel' ? 'متوازٍ' : 'تسلسلي'}) · مقدّم الطلب ${esc(d.requester)} · ${esc(at(d.at))}${d.amount !== null ? ` · المبلغ ${money(d.amount)}` : ''}</p>
      ${d.linked ? `<p class="small">مرتبط بـ <a href="#" data-act="hbrec" data-m="${esc(d.linked.model)}" data-id="${d.linked.id}">${esc(d.linked.label)}: ${esc(d.linked.title || '')}</a></p>` : ''}
      ${d.details ? `<p style="white-space:pre-line">${esc(d.details)}</p>` : ''}${steps}
      ${d.awaitingMe ? `<label style="margin-top:10px">ملاحظة القرار (إلزامية عند الرفض)<textarea id="ap-note" rows="2" maxlength="1000"></textarea></label>
        <div class="actions"><button class="btn pri" type="button" data-act="hbadec" data-d="approve">اعتماد</button> <button class="btn dan" type="button" data-act="hbadec" data-d="reject">رفض</button></div>` : ''}
      ${d.canCancel ? '<button class="btn dan sm" type="button" data-act="hbacancel" style="margin-top:8px">إلغاء الطلب</button>' : ''}</section>${H.rec ? threadHtml(H.rec) : ''}`;
  }
  function newApproval() {
    const types = (H.types || []).filter((t) => t.active && !t.owner);
    if (!types.length) return `<section class="card"><p class="hint">لا أنواع موافقة معرّفة بعد.${can('approvals:manage') ? ' عرّفها من «أنواع الموافقات».' : ' يعرّفها مدير الموافقات.'}</p></section>`;
    return `<section class="card"><h2>طلب موافقة جديد</h2><div class="inline-form"><label style="flex:2">النوع<select id="ap-type" data-no-other="1">${opts(types.map((t) => [t.id, t.name]))}</select></label>
      <label style="flex:3">العنوان<input id="ap-title" maxlength="160"></label><label>المبلغ (إن وجد)<input id="ap-amount" type="number" min="0" step="1"></label></div>
      <label>التفاصيل<textarea id="ap-details" rows="4" maxlength="2000"></textarea></label>
      <p class="small">${types.map((t) => `<b>${esc(t.name)}</b>: ${t.steps.map((s) => `${esc(s.label)}${s.minAmount ? ` (من ${money(s.minAmount)})` : ''}`).join(' ← ')}`).join('<br>')}</p>
      <button class="btn pri" type="button" data-act="hbasubmit">تقديم الطلب</button></section>`;
  }
  function typesView() {
    const t = H.editType || { code: '', name: '', description: '', mode: 'sequential', amountRequired: false, active: true, steps: [] };
    const rows = [...t.steps, ...Array(Math.max(0, 5 - t.steps.length)).fill({})].slice(0, 10);
    const perms = (H.catalog?.permissions || []).map((p) => [p, p]);
    const stepRow = (s, i) => `<tr><td>${i + 1}</td><td><input id="ts-label-${i}" maxlength="80" value="${esc(s.label || '')}" placeholder="اتركه فارغاً لحذف الخطوة"></td>
      <td><select id="ts-kind-${i}" data-no-other="1">${opts(Object.entries(H.catalog?.kinds || {}), s.kind || 'unit_head')}</select></td>
      <td>${personSel(`ts-user-${i}`, s.userId, false)}</td><td><select id="ts-perm-${i}" data-no-other="1">${opts([['', '—'], ...perms], s.perm)}</select></td>
      <td><input id="ts-min-${i}" type="number" min="0" step="1" value="${Number(s.minAmount || 0)}" style="width:8em"></td></tr>`;
    return `<section class="card"><h2>أنواع الموافقات</h2>${table(['النوع', 'الرمز', 'الخطوات', 'الحالة', ''], (H.types || []).map((x) => `<tr><td><b>${esc(x.name)}</b><div class="small">${esc(x.description)}</div></td>
      <td class="mono">${esc(x.code)}</td><td class="small">${x.steps.map((s) => `${esc(s.label)} (${esc(s.user || s.perm || s.kindLabel)}${s.minAmount ? `، من ${money(s.minAmount)}` : ''})`).join(' ← ')}</td>
      <td>${x.active ? pill('p-approved', 'فعّال') : pill('p-mut', 'معطّل')}${x.owner ? ` ${pill('p-review', `تنفّذه ${x.ownerLabel}`)}` : ''}</td><td><button class="btn sm" type="button" data-act="hbtedit" data-id="${x.id}">تعديل</button></td></tr>`).join(''), 'لا أنواع بعد.')}</section>
      <section class="card"><h2>${t.id ? `تعديل «${esc(t.name)}»` : 'نوع جديد'}</h2><div class="inline-form">
      ${t.id ? '' : '<label>الرمز (لاتيني)<input id="tp-code" maxlength="40" placeholder="travel_mission"></label>'}<label style="flex:2">الاسم<input id="tp-name" maxlength="120" value="${esc(t.name)}"></label>
      <label>المسار<select id="tp-mode" data-no-other="1">${opts([['sequential', 'تسلسلي'], ['parallel', 'متوازٍ']], t.mode)}</select></label>
      <label><input id="tp-amount" type="checkbox"${t.amountRequired ? ' checked' : ''}> يتطلب مبلغاً</label><label><input id="tp-active" type="checkbox"${t.active ? ' checked' : ''}> فعّال</label></div>
      <label>الوصف<textarea id="tp-desc" rows="2" maxlength="500">${esc(t.description)}</textarea></label>
      ${t.owner ? `<p class="hint">نوع تنفّذه وحدة ${esc(t.ownerLabel)}: خطواته تُضاف تلقائياً قبل المعتمدين الذين يختارهم كاتب المستند، ونمط المسار يحدده المستند. المسموح: موظف محدد أو رئيس وحدة الكاتب، ويجوز تركه بلا خطوات.</p>` : ''}
      <p class="small">المعتمد: «موظف محدد» يستعمل عمود الموظف، و«حامل صلاحية» يستعمل عمود الصلاحية، و«رئيس الوحدة» يُحدَّد تلقائياً. الخطوة تنطبق إن بلغ المبلغ حدّها.</p>
      ${peopleSearch('ts')}${table(['#', 'الخطوة', 'نوع المعتمد', 'الموظف', 'الصلاحية', 'من مبلغ'], rows.map(stepRow).join(''), '')}
      <div class="actions"><button class="btn pri" type="button" data-act="hbtsave">حفظ النوع</button>${t.id ? ' <button class="btn" type="button" data-act="hbtnew">نوع جديد</button>' : ''}</div></section>`;
  }

  /* ===== التقارير المحورية ===== */
  function pivotView() {
    const P = H.pivot, ds = P.datasets.find((d) => d.key === P.q.dataset);
    if (!ds) return '<section class="card"><p class="hint">لا مجموعات بيانات متاحة لصلاحياتك.</p></section>';
    const dims = ds.dims.map((d) => [d.key, d.label]);
    const r = P.result;
    const res = !r ? '' : `<section class="card"><h2>${esc(r.dataset.label)}: ${esc(r.measure.label)} حسب ${esc(r.row.label)}${r.col ? ` و${esc(r.col.label)}` : ''}</h2>
      ${table([r.row.label, ...(r.col ? r.cols.map((c) => c.label) : []), 'الإجمالي'], r.rows.map((x) => `<tr><td><b>${esc(x.label)}</b></td>${r.col ? x.cells.map((v) => `<td>${v === null ? '' : money(v)}</td>`).join('') : ''}<td><b>${money(x.total)}</b></td></tr>`).join('')
        + `<tr><td><b>الإجمالي</b></td>${r.col ? r.cols.map((c) => `<td><b>${money(c.total)}</b></td>`).join('') : ''}<td><b>${money(r.grand)}</b></td></tr>`, 'لا بيانات.')}
      <button class="btn sm" type="button" data-act="hbpxl" style="margin-top:8px">تصدير Excel</button></section>`;
    return `<section class="card"><h2>التقارير المحورية</h2><div class="inline-form">
      <label>البيانات<select id="pv-ds" data-no-other="1">${opts(P.datasets.map((d) => [d.key, d.label]), P.q.dataset)}</select></label>
      <label>الصفوف<select id="pv-row" data-no-other="1">${opts(dims, P.q.row)}</select></label>
      <label>الأعمدة<select id="pv-col" data-no-other="1">${opts([['', '— بلا —'], ...dims], P.q.col)}</select></label>
      <label>المقياس<select id="pv-m" data-no-other="1">${opts(ds.measures.map((m) => [m.key, m.label]), P.q.measure)}</select></label>
      ${ds.hasDate ? `<label>من<input id="pv-from" type="date" value="${esc(P.q.from)}"></label><label>إلى<input id="pv-to" type="date" value="${esc(P.q.to)}"></label>` : ''}
      <button class="btn pri" type="button" data-act="hbprun">عرض</button></div></section>${res}`;
  }
  const readPivot = () => Object.assign(H.pivot.q, { row: val('pv-row'), col: val('pv-col'), measure: val('pv-m') || 'count', from: val('pv-from'), to: val('pv-to') });
  const pivotQs = () => new URLSearchParams(Object.entries(H.pivot.q).filter(([, v]) => v)).toString();
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'pv-ds') {
      const d = H.pivot.datasets.find((x) => x.key === e.target.value);
      if (d) { Object.assign(H.pivot.q, { dataset: d.key, row: d.dims[0].key, col: '', measure: 'count', from: '', to: '' }); H.pivot.result = null; UA.render(); }
    }
  });

  /* ===== الأتمتة ===== */
  function autoView() {
    const a = H.auto;
    if (!a) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const c = a.catalog, r = H.editRule || { name: '', active: true, trigger: 'event', event: 'approval.submitted', condition: {}, action: 'notify', params: { to: 'approvers', text: '' } };
    const evSel = `<select id="ar-ev" data-no-other="1"><optgroup label="عند حدث">${opts(Object.entries(c.events).map(([k, l]) => [`event:${k}`, l]), `${r.trigger}:${r.event}`)}</optgroup>
      <optgroup label="فحص دوري كل ساعة">${opts(Object.entries(c.schedules).map(([k, l]) => [`schedule:${k}`, l]), `${r.trigger}:${r.event}`)}</optgroup></select>`;
    const p = r.params || {}, cond = r.condition || {};
    return `<section class="card"><h2>قواعد الأتمتة</h2><div class="actions" style="margin:0 0 8px"><button class="btn sm" type="button" data-act="hbrun">تشغيل الفحص الدوري الآن</button></div>
      ${table(['القاعدة', 'المشغّل', 'الإجراء', 'التنفيذ', ''], a.rules.map((x) => `<tr><td><b>${esc(x.name)}</b> ${x.active ? '' : pill('p-mut', 'معطّلة')}</td><td>${esc(x.eventLabel)}</td>
        <td>${esc(x.actionLabel)}${x.params.to ? ` ← ${esc(c.recipients[x.params.to] || x.params.to)}` : ''}</td><td>${x.runCount}<div class="small">${esc(at(x.lastRunAt))}</div></td>
        <td><button class="btn sm" type="button" data-act="hbredit" data-id="${x.id}">تعديل</button> <button class="btn dan sm" type="button" data-act="hbrdel" data-id="${x.id}">حذف</button></td></tr>`).join(''), 'لا قواعد بعد.')}</section>
      <section class="card"><h2>${r.id ? `تعديل «${esc(r.name)}»` : 'قاعدة جديدة'}</h2><div class="inline-form">
      <label style="flex:2">الاسم<input id="ar-name" maxlength="120" value="${esc(r.name)}"></label><label style="flex:2">المشغّل${evSel}</label>
      <label><input id="ar-active" type="checkbox"${r.active ? ' checked' : ''}> فعّالة</label></div>
      <div class="inline-form"><label>نوع الموافقة<select id="ar-type" data-no-other="1">${opts([['', 'أي نوع'], ...c.types.map((t) => [t.code, t.name])], cond.typeCode)}</select></label>
      <label>نوع السجل<select id="ar-model" data-no-other="1">${opts([['', 'أي سجل'], ...Object.entries(c.models)], cond.model)}</select></label>
      <label>من مبلغ<input id="ar-min" type="number" min="0" value="${cond.minAmount ?? ''}"></label><label>بعد (أيام، للفحص الدوري)<input id="ar-days" type="number" min="0" max="365" value="${cond.days ?? 1}"></label></div>
      <div class="inline-form"><label>الإجراء<select id="ar-action" data-no-other="1">${opts(Object.entries(c.actions), r.action)}</select></label>
      <label>المستلم أو المسند إليه<select id="ar-to" data-no-other="1">${opts(Object.entries(c.recipients), p.to)}</select></label>
      <label style="flex:2">الموظف${personSel('ar-user', p.userId, false)}</label><label>الصلاحية<select id="ar-perm" data-no-other="1">${opts([['', '—'], ...c.permissions.map((x) => [x, x])], p.perm)}</select></label></div>
      ${peopleSearch('ar')}
      <label>النص (يقبل {{title}} و{{no}} و{{record}})<textarea id="ar-text" rows="2" maxlength="300">${esc(p.text || '')}</textarea></label>
      <div class="inline-form"><label style="flex:2">عنوان النشاط (لإجراء النشاط)<input id="ar-atitle" maxlength="160" value="${esc(p.title || '')}"></label>
      <label>نوعه<select id="ar-akind" data-no-other="1">${opts(Object.entries(c.activityKinds), p.kind)}</select></label><label>مهلته (أيام)<input id="ar-due" type="number" min="0" max="365" value="${p.dueDays ?? 1}"></label></div>
      <div class="actions"><button class="btn pri" type="button" data-act="hbrsave">حفظ القاعدة</button>${r.id ? ' <button class="btn" type="button" data-act="hbrnew">قاعدة جديدة</button>' : ''}</div></section>
      <section class="card"><h2>سجل التنفيذ</h2>${table(['الوقت', 'القاعدة', 'المرجع', 'النتيجة'], a.log.map((l) => `<tr><td>${esc(at(l.at))}</td><td>${esc(l.rule)}</td><td class="mono small">${esc(l.ref)}</td><td>${esc(l.outcome)}</td></tr>`).join(''), 'لم تُنفَّذ قاعدة بعد.')}</section>`;
  }

  /* ===== الشاشة ===== */
  UA.views.hub = () => {
    if (!H.sum) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const s = H.sum, tabs = [['mine', `أنشطتي${s.activities.overdue ? ` <span class="badge">${s.activities.overdue}</span>` : ''}`], ['approvals', `الموافقات${s.approvalsTodo ? ` <span class="badge">${s.approvalsTodo}</span>` : ''}`], ['pivot', 'التقارير المحورية'],
      ...(can('automation:manage') ? [['auto', 'الأتمتة']] : [])];
    const bar = `<div class="sub-tabs no-print" role="tablist">${tabs.map(([k, l]) => `<button class="chip" role="tab" data-act="hbtab" data-t="${k}" aria-pressed="${H.tab === k}">${l}</button>`).join('')}</div>`;
    return bar + ({ mine: mineView, approvals: approvalsView, pivot: pivotView, auto: autoView }[H.tab] || mineView)();
  };

  const stepsFromForm = () => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const el = document.getElementById(`ts-label-${i}`);
      if (!el) break;
      if (!el.value.trim()) continue;
      const kind = val(`ts-kind-${i}`);
      out.push({ label: el.value.trim(), kind, userId: kind === 'user' ? Number(val(`ts-user-${i}`)) : null, perm: kind === 'permission' ? val(`ts-perm-${i}`) : null, minAmount: Number(val(`ts-min-${i}`) || 0) });
    }
    return out;
  };

  Object.assign(UA.actions, {
    hbtab: async (_el, d) => { H.tab = d.t; H.rec = null; H.apprId = null; await reload(); },
    hbbox: async (_el, d) => { H.box = d.b; await reload(); },
    hbrec: async (_el, d) => { H.tab = 'mine'; H.apprId = null; H.rec = { model: d.m, id: Number(d.id) }; await reload(); },
    hbunrec: async () => { H.rec = null; await reload(); },
    hbpeople: async (_el, d) => { await loadPeople(val(`${d.p}-q`)); UA.render(); },
    hbadd: async (_el, d) => {
      const p = d.p;
      await UA.api('POST', '/api/activities', { title: val(`${p}-title`), kind: val(`${p}-kind`), dueDate: val(`${p}-due`), assigneeId: Number(val(`${p}-who`)), note: val(`${p}-note`), ...(d.m ? { model: d.m, resId: Number(d.id) } : {}) });
      await reload('أُضيف النشاط');
    },
    hbdone: async (_el, d) => { const note = prompt('ملاحظة الإنجاز (اختيارية):', ''); if (note === null) return; await UA.api('POST', `/api/activities/${d.id}/done`, { note }); await reload('أُنجز النشاط'); },
    hbcancel: async (_el, d) => { if (!confirm('إلغاء النشاط؟')) return; await UA.api('POST', `/api/activities/${d.id}/cancel`, {}); await reload('أُلغي النشاط'); },
    hbresched: async (_el, d) => { const due = prompt('الموعد الجديد (YYYY-MM-DD):', d.due); if (!due) return; await UA.api('PUT', `/api/activities/${d.id}`, { dueDate: due.trim() }); await reload('أُجّل النشاط'); },
    hbpost: async (_el, d) => { const body = val('ch-body'); if (!body.trim()) return toast('اكتب نص التعليق.'); await UA.api('POST', `/api/records/${H.rec.model}/${H.rec.id}/messages`, { kind: d.k, body }); await reload(d.k === 'note' ? 'حُفظت الملاحظة' : 'أُرسل التعليق'); },
    hbfollow: async (_el, d) => { await UA.api('POST', `/api/records/${H.rec.model}/${H.rec.id}/follow`, { follow: d.on === '1' }); await reload(); },
    hbabox: async (_el, d) => { H.apprBox = d.b; H.apprId = null; H.rec = null; H.editType = null; await reload(); },
    hbidec: async (_el, d) => {
      let note = '';
      if (d.n === '1') { note = prompt(d.d === 'return' ? 'ما المطلوب تعديله؟' : 'سبب الرفض:'); if (!note) return; }
      else if (d.d === 'approve') { note = prompt('ملاحظة (اختيارية):', ''); if (note === null) return; }
      const r = await UA.api('POST', `/api/approvals/inbox/${d.s}/${d.id}/decide`, { decision: d.d, note, stepNo: d.step ? Number(d.step) : undefined });
      await reload(r.status === 'approved' ? 'اعتُمد نهائياً' : r.status === 'rejected' ? 'رُفض' : 'سُجّل قرارك');
    },
    hbaopen: async (_el, d) => { H.apprId = Number(d.id); await reload(); },
    hbaback: async () => { H.apprId = null; H.rec = null; await reload(); },
    hbasubmit: async () => {
      const amount = val('ap-amount');
      const r = await UA.api('POST', '/api/approvals', { typeId: Number(val('ap-type')), title: val('ap-title'), details: val('ap-details'), amount: amount === '' ? null : Number(amount) });
      H.apprBox = 'mine'; H.apprId = r.id; await reload(`قُدّم الطلب ${r.no}`);
    },
    hbadec: async (_el, d) => { const r = await UA.api('POST', `/api/approvals/${H.apprId}/decide`, { decision: d.d, note: val('ap-note') }); await reload(r.status === 'approved' ? 'اعتُمد الطلب نهائياً' : r.status === 'rejected' ? 'رُفض الطلب' : 'سُجّل قرارك وانتقل الطلب للخطوة التالية'); },
    hbacancel: async () => { if (!confirm('إلغاء طلب الموافقة؟')) return; await UA.api('POST', `/api/approvals/${H.apprId}/cancel`, {}); await reload('أُلغي الطلب'); },
    hbtedit: async (_el, d) => { H.editType = (H.types || []).find((t) => t.id === Number(d.id)) || null; UA.render(); },
    hbtnew: async () => { H.editType = null; UA.render(); },
    hbtsave: async () => {
      const t = H.editType, body = { name: val('tp-name'), description: val('tp-desc'), mode: val('tp-mode'), amountRequired: document.getElementById('tp-amount').checked, active: document.getElementById('tp-active').checked, steps: stepsFromForm() };
      if (t) await UA.api('PUT', `/api/approval-types/${t.id}`, body); else await UA.api('POST', '/api/approval-types', { ...body, code: val('tp-code') });
      H.types = null; H.editType = null; await reload('حُفظ نوع الموافقة');
    },
    hbprun: async () => { readPivot(); H.pivot.result = await UA.api('GET', `/api/reports/pivot?${pivotQs()}`); UA.render(); },
    hbpxl: async () => {
      const res = await fetch(`/api/reports/pivot.xlsx?${pivotQs()}`, { credentials: 'same-origin' });
      if (!res.ok) { let m = 'تعذّر التصدير.'; try { m = (await res.json()).message || m; } catch { /* */ } return toast(m); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'تقرير-محوري.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
    hbrun: async () => { const r = await UA.api('POST', '/api/automation/run', {}); await reload(`اكتمل الفحص: ${r.fired} تنفيذ، ${r.reminded} تذكير`); },
    hbredit: async (_el, d) => { H.editRule = H.auto.rules.find((x) => x.id === Number(d.id)) || null; UA.render(); },
    hbrnew: async () => { H.editRule = null; UA.render(); },
    hbrdel: async (_el, d) => { if (!confirm('حذف القاعدة وسجلها؟')) return; await UA.api('DELETE', `/api/automation/rules/${d.id}`); H.editRule = null; await reload('حُذفت القاعدة'); },
    hbrsave: async () => {
      const [trigger, event] = val('ar-ev').split(':');
      const condition = { typeCode: val('ar-type') || undefined, model: val('ar-model') || undefined, minAmount: val('ar-min') === '' ? undefined : Number(val('ar-min')), days: trigger === 'schedule' ? Number(val('ar-days') || 0) : undefined };
      const to = val('ar-to');
      const params = { to, userId: to === 'user' ? Number(val('ar-user')) : undefined, perm: to === 'permission' ? val('ar-perm') : undefined, text: val('ar-text'), title: val('ar-atitle'), kind: val('ar-akind'), dueDays: Number(val('ar-due') || 1) };
      const body = { name: val('ar-name'), active: document.getElementById('ar-active').checked, trigger, event, condition, action: val('ar-action'), params };
      if (H.editRule) await UA.api('PUT', `/api/automation/rules/${H.editRule.id}`, body); else await UA.api('POST', '/api/automation/rules', body);
      H.editRule = null; await reload('حُفظت القاعدة');
    },
  });
})();
