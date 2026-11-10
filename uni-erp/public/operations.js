/* ثلاث شاشات تشغيلية: التوظيف (recruitment)، والخدمات الإدارية (facilities)، وعروض الأسعار (quotations) */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (UA.toast ? UA.toast(m) : window.alert(m));
  const val = (id) => (document.getElementById(id) || {}).value || '';
  const money = (n) => Number(n || 0).toLocaleString('en-US');
  const table = (heads, rows, empty) => `<div class="tbl-wrap"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="small">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const sel = (id, list, extra = '') => `<select id="${id}" data-no-other="1"${extra}>${opts(list)}</select>`;
  const pill = (cls, t) => `<span class="pill ${cls}">${esc(t)}</span>`;
  const at = (t) => (t ? new Date(Number(t)).toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const O = { rec: null, vac: null, vacId: null, fac: null, quo: null };
  const reload = async (view, msg) => { await UA.loaders[view](); UA.render(); if (msg) toast(msg); };

  /* ===== التوظيف ===== */
  UA.loaders.recruitment = async () => { O.rec = await UA.api('GET', '/api/recruitment'); O.vac = O.vacId ? await UA.api('GET', `/api/recruitment/vacancies/${O.vacId}`).catch(() => null) : null; };
  const ST = { open: ['p-approved', 'مفتوح'], closed: ['p-rejected', 'مغلق'], filled: ['p-review', 'مكتمل'] };
  const AST = { applied: 'p-review', shortlisted: 'p-review', interview: 'p-review', offered: 'p-approved', hired: 'p-approved', rejected: 'p-rejected' };
  UA.views.recruitment = () => {
    const d = O.rec;
    if (!d) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    if (O.vac) {
      const v = O.vac.vacancy;
      const rows = O.vac.applicants.map((a) => {
        const iv = a.interviews.map((i) => `<div class="small">${esc(at(i.at))} · ${esc(i.panel)}${i.recommendation ? ` · ${i.score}/100 · ${{ hire: 'يوصى بالتعيين', reserve: 'احتياط', reject: 'لا يوصى' }[i.recommendation]}` : ` <button class="btn sm" type="button" data-act="rcres" data-id="${i.id}">النتيجة</button>`}</div>`).join('');
        const moves = a.next.map((s) => `<button class="btn sm${s === 'rejected' ? ' dan' : ''}" type="button" data-act="rcmove" data-id="${a.id}" data-s="${s}">${esc(d.statuses[s])}</button>`).join(' ');
        return `<tr><td><b>${esc(a.name)}</b><div class="small mono">${esc(a.nationalId)}</div></td><td>${esc(a.qualification)}<div class="small">${a.experience} سنة خبرة</div></td>
          <td>${pill(AST[a.status], a.statusLabel)}${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}${iv}</td>
          <td>${moves} ${a.status === 'interview' ? `<button class="btn sm" type="button" data-act="rciv" data-id="${a.id}">تحديد مقابلة</button>` : ''} ${a.status === 'offered' ? `<button class="btn pri sm" type="button" data-act="rchire" data-id="${a.id}">تعيين</button>` : ''}</td></tr>`;
      }).join('');
      return `<div class="actions" style="margin:0 0 10px"><button class="btn" type="button" data-act="rcback">← كل الشواغر</button></div>
        <section class="card"><h2>${esc(v.title)} ${pill(ST[v.status][0], ST[v.status][1])}</h2><p class="hint" style="margin-top:0">${esc(v.unit || '—')} · ${v.positions} شاغر · عُيّن ${v.hired}${v.closesOn ? ` · آخر موعد ${esc(v.closesOn)}` : ''}</p>
          ${v.requirements ? `<p class="small" style="white-space:pre-line">${esc(v.requirements)}</p>` : ''}
          ${v.status === 'open' ? `<button class="btn dan sm" type="button" data-act="rcclose">إغلاق الشاغر</button>` : ''}</section>
        <section class="card"><h2>المتقدمون</h2>${table(['المتقدم', 'المؤهل', 'الحالة', 'إجراء'], rows, 'لا متقدمين بعد.')}
          ${v.status === 'open' ? `<div class="inline-form" style="margin-top:10px"><label style="flex:2">الاسم الكامل<input id="rc-a-name" maxlength="100"></label><label>الرقم الوطني<input id="rc-a-nid" maxlength="20" inputmode="numeric"></label>
            <label>الهاتف<input id="rc-a-phone" maxlength="30"></label><label style="flex:2">المؤهل<input id="rc-a-q" maxlength="200"></label><label>الخبرة (سنة)<input id="rc-a-exp" type="number" min="0" max="60" value="0"></label>
            <button class="btn pri" type="button" data-act="rcapp">تسجيل متقدم</button></div>` : ''}</section>`;
    }
    return `<section class="card"><h2>الشواغر الوظيفية</h2>${table(['المسمى', 'الوحدة', 'الشواغر', 'المتقدمون', 'المعيّنون', 'الحالة', ''], d.vacancies.map((v) => `<tr><td><b>${esc(v.title)}</b></td><td>${esc(v.unit || '—')}</td><td>${v.positions}</td><td>${v.applicants}</td><td>${v.hired}</td><td>${pill(ST[v.status][0], ST[v.status][1])}</td>
      <td><button class="btn sm" type="button" data-act="rcopen" data-id="${v.id}">فتح</button></td></tr>`).join(''), 'لا شواغر.')}</section>
      <section class="card"><h2>إعلان شاغر</h2><div class="inline-form"><label style="flex:2">المسمى الوظيفي<input id="rc-title" maxlength="120"></label>
        <label>الوحدة${sel('rc-unit', [['', '—'], ...d.units.map((u) => [u.id, u.name])])}</label><label>العدد<input id="rc-pos" type="number" min="1" max="100" value="1"></label><label>آخر موعد<input id="rc-close" type="date"></label></div>
        <label>الشروط والمتطلبات<textarea id="rc-req" rows="3"></textarea></label><button class="btn pri" type="button" data-act="rcnew" style="margin-top:8px">إعلان الشاغر</button></section>`;
  };

  /* ===== الخدمات الإدارية ===== */
  UA.loaders.facilities = async () => { O.fac = await UA.api('GET', '/api/facilities'); };
  const BST = { pending: ['p-review', 'بانتظار الاعتماد'], approved: ['p-approved', 'معتمد'], rejected: ['p-rejected', 'مرفوض'], cancelled: ['p-rejected', 'ملغى'] };
  const MST = { open: ['p-review', 'جديد'], assigned: ['p-review', 'قيد التنفيذ'], done: ['p-approved', 'نُفّذ'], closed: ['p-approved', 'مغلق'], cancelled: ['p-rejected', 'ملغى'] };
  UA.views.facilities = () => {
    const d = O.fac;
    if (!d) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const m = d.canManage;
    const bookings = d.bookings.map((b) => `<tr><td><b>${esc(b.room)}</b></td><td>${esc(b.title)}<div class="small">${esc(b.requester)}</div></td><td>${esc(b.day)} ${esc(b.start)}-${esc(b.end)}</td>
      <td>${pill(BST[b.status][0], BST[b.status][1])}${b.note ? `<div class="small">${esc(b.note)}</div>` : ''}</td>
      <td>${m && b.status === 'pending' ? `<button class="btn pri sm" type="button" data-act="fcdec" data-id="${b.id}" data-d="approved">اعتماد</button> <button class="btn dan sm" type="button" data-act="fcdec" data-id="${b.id}" data-d="rejected">رفض</button>` : ''}
        ${(b.mine || m) && ['pending', 'approved'].includes(b.status) ? ` <button class="btn sm" type="button" data-act="fcdec" data-id="${b.id}" data-d="cancel">إلغاء</button>` : ''}</td></tr>`).join('');
    const orders = d.orders.map((o) => `<tr><td class="mono">${esc(o.no)}</td><td><b>${esc(o.location)}</b><div class="small">${esc(o.category)} · ${esc(o.description)}</div></td>
      <td>${pill(o.priority === 'normal' ? 'p-review' : 'p-rejected', o.priorityLabel)}</td><td>${pill(MST[o.status][0], MST[o.status][1])}${o.doneNote ? `<div class="small">${esc(o.doneNote)}</div>` : ''}</td><td>${esc(o.assignee)}</td>
      <td>${m && ['open', 'assigned'].includes(o.status) ? `${sel(`fc-tech-${o.id}`, d.staff.map((u) => [u.id, u.name]))} <button class="btn sm" type="button" data-act="fcact" data-id="${o.id}" data-a="assign">إسناد</button>` : ''}
        ${(o.assignedToMe || m) && o.status === 'assigned' ? ` <button class="btn pri sm" type="button" data-act="fcact" data-id="${o.id}" data-a="done">تم التنفيذ</button>` : ''}
        ${(o.mine || m) && o.status === 'done' ? ` <button class="btn pri sm" type="button" data-act="fcact" data-id="${o.id}" data-a="close">تأكيد الإغلاق</button> <button class="btn sm" type="button" data-act="fcact" data-id="${o.id}" data-a="reopen">لم يُعالج</button>` : ''}
        ${(o.mine || m) && o.status === 'open' ? ` <button class="btn sm" type="button" data-act="fcact" data-id="${o.id}" data-a="cancel">إلغاء</button>` : ''}</td></tr>`).join('');
    return `<section class="card"><h2>بلاغ صيانة</h2><div class="inline-form"><label style="flex:2">المكان<input id="fc-loc" maxlength="120" placeholder="المبنى أ، القاعة 3"></label>
        <label>النوع${sel('fc-cat', d.categories.map((c) => [c, c]))}</label><label>الأولوية${sel('fc-pri', Object.entries(d.priorities))}</label></div>
        <label>وصف العطل<input id="fc-desc" maxlength="1000"></label><button class="btn pri" type="button" data-act="fcmnt" style="margin-top:8px">إرسال البلاغ</button></section>
      <section class="card"><h2>${m ? 'أوامر الصيانة' : 'بلاغاتي وما أُسند إلي'}</h2>${table(['الرقم', 'العطل', 'الأولوية', 'الحالة', 'الفني', 'إجراء'], orders, 'لا أوامر صيانة.')}</section>
      <section class="card"><h2>حجز قاعة أو مرفق</h2>${d.rooms.length ? `<div class="inline-form"><label>القاعة${sel('fc-room', d.rooms.map((r) => [r.id, `${r.name}${r.capacity ? ` (${r.capacity})` : ''}`]))}</label>
        <label>اليوم<input id="fc-day" type="date"></label><label>من<input id="fc-start" type="time"></label><label>إلى<input id="fc-end" type="time"></label><label>الحضور<input id="fc-att" type="number" min="0" value="0"></label></div>
        <label>الغرض<input id="fc-title" maxlength="120"></label><button class="btn pri" type="button" data-act="fcbook" style="margin-top:8px">طلب الحجز</button>` : '<p class="small">لا قاعات معرّفة بعد.</p>'}
        ${m ? `<div class="inline-form" style="margin-top:12px"><label>قاعة جديدة<input id="fc-rname" maxlength="80"></label><label>المبنى<input id="fc-rbld" maxlength="80"></label><label>السعة<input id="fc-rcap" type="number" min="0" value="30"></label><button class="btn" type="button" data-act="fcroom">تعريف القاعة</button></div>` : ''}</section>
      <section class="card"><h2>${m ? 'الحجوزات' : 'حجوزاتي'}</h2>${table(['القاعة', 'الغرض', 'الموعد', 'الحالة', ''], bookings, 'لا حجوزات.')}</section>`;
  };

  /* ===== عروض الأسعار ===== */
  UA.loaders.quotations = async () => { O.quo = await UA.api('GET', '/api/procurement/quotations'); };
  UA.views.quotations = () => {
    const d = O.quo;
    if (!d) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const manage = UA.can('procurement:manage');
    const rfqs = d.rfqs.map((r) => {
      const cheapest = r.quotes[0];
      const quotes = table(['المورّد', 'الإجمالي', 'مدة التوريد', 'ملاحظات', ''], r.quotes.map((q) => `<tr${r.awardedQuoteId === q.id ? ' style="background:#EAF3F0"' : ''}><td><b>${esc(q.supplier)}</b>${cheapest && q.id === cheapest.id ? ' <span class="pill p-approved">الأرخص</span>' : ''}</td><td>${money(q.total)}</td><td>${q.deliveryDays} يوم</td><td>${esc(q.notes)}</td>
        <td>${manage && r.status === 'open' ? `<button class="btn pri sm" type="button" data-act="qtaward" data-id="${r.id}" data-q="${q.id}">ترسية</button>` : r.awardedQuoteId === q.id ? 'رُسّي عليه' : ''}</td></tr>`).join(''), 'لا عروض بعد.');
      const addQuote = manage && r.status === 'open' ? `<div class="inline-form" style="margin-top:8px"><label>المورّد${sel(`qt-sup-${r.id}`, d.suppliers.map((s) => [s.id, `${s.name}${s.score ? ` (${s.score}/5)` : ''}`]))}</label>
        ${r.lines.map((l) => `<label>${esc(l.description)} × ${l.qty}<input class="qt-price-${r.id}" data-line="${l.id}" type="number" min="0" placeholder="سعر الوحدة"></label>`).join('')}
        <label>التوريد (يوم)<input id="qt-days-${r.id}" type="number" min="0" value="7"></label><button class="btn sm" type="button" data-act="qtquote" data-id="${r.id}">تسجيل العرض</button></div>` : '';
      return `<article class="card"><h3 style="margin:0">${esc(r.title)} <span class="mono small">${esc(r.no)}</span></h3>
        <p class="small">طلب الشراء ${esc(r.requestNo)} · آخر موعد ${esc(r.closesOn)} · ${r.status === 'open' ? 'مفتوح' : r.status === 'awarded' ? 'رُسّي' : 'ملغى'}${r.awardNote ? ` · ${esc(r.awardNote)}` : ''}</p>${quotes}${addQuote}</article>`;
    }).join('');
    return `<section class="card"><h2>طلبات عروض الأسعار</h2><p class="hint" style="margin-top:0">الحد الأدنى ${d.minQuotes} عروض. الترسية على غير الأرخص أو بعروض أقل تحتاج تبريراً مكتوباً، وتنشئ أمر التوريد بأسعار العرض.</p>
      ${manage && d.requests.length ? `<div class="inline-form"><label style="flex:2">طلب شراء معتمد${sel('qt-req', d.requests.map((r) => [r.id, `${r.no} · ${r.title}`]))}</label><label>آخر موعد<input id="qt-close" type="date"></label><button class="btn pri" type="button" data-act="qtnew">طلب عروض</button></div>` : ''}</section>
      ${rfqs || '<section class="card"><p class="small">لا طلبات عروض.</p></section>'}
      <section class="card"><h2>تقييم المورّدين</h2>${table(['المورّد', 'عدد التقييمات', 'المتوسط'], d.suppliers.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.ratings}</td><td>${s.score ?? '—'}</td></tr>`).join(''), 'لا مورّدين.')}
        ${manage && d.ratable.length ? `<div class="inline-form" style="margin-top:8px"><label style="flex:2">أمر توريد مستلم${sel('qt-ro', d.ratable.map((o) => [o.id, `${o.no} · ${o.supplier}`]))}</label>
          ${[['quality', 'الجودة'], ['timeliness', 'الالتزام بالموعد'], ['price', 'السعر']].map(([k, l]) => `<label>${l}${sel(`qt-r-${k}`, [[5, '5'], [4, '4'], [3, '3'], [2, '2'], [1, '1']])}</label>`).join('')}
          <button class="btn sm" type="button" data-act="qtrate">حفظ التقييم</button></div>` : ''}</section>`;
  };

  Object.assign(UA.actions, {
    rcopen: async (_el, d) => { O.vacId = Number(d.id); await reload('recruitment'); },
    rcback: async () => { O.vacId = null; await reload('recruitment'); },
    rcnew: async () => { await UA.api('POST', '/api/recruitment/vacancies', { title: val('rc-title'), unitId: Number(val('rc-unit')) || null, positions: Number(val('rc-pos')), closesOn: val('rc-close') || null, requirements: val('rc-req') }); await reload('recruitment', 'أُعلن الشاغر'); },
    rcclose: async () => { if (!confirm('إغلاق الشاغر؟')) return; await UA.api('POST', `/api/recruitment/vacancies/${O.vacId}/close`, {}); await reload('recruitment'); },
    rcapp: async () => { await UA.api('POST', `/api/recruitment/vacancies/${O.vacId}/applicants`, { name: val('rc-a-name'), nationalId: val('rc-a-nid'), phone: val('rc-a-phone'), qualification: val('rc-a-q'), experience: Number(val('rc-a-exp')) }); await reload('recruitment', 'سُجل المتقدم'); },
    rcmove: async (_el, d) => { const note = d.s === 'rejected' ? prompt('سبب الاستبعاد:') : ''; if (d.s === 'rejected' && !note) return; await UA.api('POST', `/api/recruitment/applicants/${d.id}/move`, { status: d.s, note }); await reload('recruitment'); },
    rciv: async (_el, d) => { const when = prompt('موعد المقابلة (2026-12-01 10:00):'); if (!when) return; const panel = prompt('أعضاء لجنة المقابلة:'); if (!panel) return; await UA.api('POST', `/api/recruitment/applicants/${d.id}/interviews`, { at: when.replace(' ', 'T'), panel }); await reload('recruitment', 'حُددت المقابلة'); },
    rcres: async (_el, d) => { const score = prompt('التقييم من 100:'); if (!score) return; const rec = prompt('التوصية: hire (تعيين) أو reserve (احتياط) أو reject (استبعاد)', 'hire'); if (!rec) return; await UA.api('POST', `/api/recruitment/interviews/${d.id}/result`, { score: Number(score), recommendation: rec.trim() }); await reload('recruitment'); },
    rchire: async (_el, d) => {
      const salary = prompt('الراتب الأساسي:', '0'); if (salary === null) return;
      const r = await UA.api('POST', `/api/recruitment/applicants/${d.id}/hire`, { baseSalary: Number(salary) });
      if (r.account && r.account.tempPassword) window.alert(`عُيّن برقم ${r.employeeNo}.\nاسم المستخدم: ${r.account.username}\nكلمة المرور المؤقتة: ${r.account.tempPassword}`);
      await reload('recruitment', 'تم التعيين');
    },
    fcmnt: async () => { const r = await UA.api('POST', '/api/facilities/maintenance', { location: val('fc-loc'), category: val('fc-cat'), priority: val('fc-pri'), description: val('fc-desc') }); await reload('facilities', `أُرسل البلاغ ${r.no}`); },
    fcact: async (_el, d) => {
      const body = { action: d.a };
      if (d.a === 'assign') body.assigneeId = Number(val(`fc-tech-${d.id}`));
      if (d.a === 'done') { body.note = prompt('ما الذي نُفّذ؟'); if (!body.note) return; body.cost = Number(prompt('الكلفة (ل.س):', '0') || 0); }
      await UA.api('POST', `/api/facilities/maintenance/${d.id}/action`, body); await reload('facilities');
    },
    fcbook: async () => { const r = await UA.api('POST', '/api/facilities/bookings', { roomId: Number(val('fc-room')), day: val('fc-day'), start: val('fc-start'), end: val('fc-end'), attendees: Number(val('fc-att')), title: val('fc-title') }); await reload('facilities', r.status === 'approved' ? 'تم الحجز' : 'أُرسل طلب الحجز للاعتماد'); },
    fcdec: async (_el, d) => { const note = d.d === 'rejected' ? prompt('سبب الرفض:') : ''; if (d.d === 'rejected' && !note) return; await UA.api('POST', `/api/facilities/bookings/${d.id}/decide`, { decision: d.d, note }); await reload('facilities'); },
    fcroom: async () => { await UA.api('POST', '/api/facilities/rooms', { name: val('fc-rname'), building: val('fc-rbld'), capacity: Number(val('fc-rcap')) }); await reload('facilities', 'عُرّفت القاعة'); },
    qtnew: async () => { await UA.api('POST', '/api/procurement/rfqs', { requestId: Number(val('qt-req')), closesOn: val('qt-close') }); await reload('quotations', 'أُنشئ طلب العروض'); },
    qtquote: async (_el, d) => {
      const prices = Object.fromEntries([...document.querySelectorAll(`.qt-price-${d.id}`)].map((x) => [x.dataset.line, Number(x.value)]));
      await UA.api('POST', `/api/procurement/rfqs/${d.id}/quotes`, { supplierId: Number(val(`qt-sup-${d.id}`)), prices, deliveryDays: Number(val(`qt-days-${d.id}`)) }); await reload('quotations', 'سُجل العرض');
    },
    qtaward: async (_el, d) => {
      const send = (note) => UA.api('POST', `/api/procurement/rfqs/${d.id}/award`, { quoteId: Number(d.q), note });
      let r;
      try { r = await send(''); } catch (e) { if (e.code !== 'justification_required' && !/تبرير/.test(e.message || '')) throw e; const note = prompt(`${e.message}\nالتبرير:`); if (!note) return; r = await send(note); }
      await reload('quotations', `رُسّي وأُنشئ أمر التوريد ${r.orderNo}`);
    },
    qtrate: async () => { await UA.api('POST', '/api/procurement/supplier-ratings', { orderId: Number(val('qt-ro')), quality: Number(val('qt-r-quality')), timeliness: Number(val('qt-r-timeliness')), price: Number(val('qt-r-price')) }); await reload('quotations', 'حُفظ التقييم'); },
  });
})();
