/* صفحة المحفظة الجامعية للموظفين: نقطة البيع (لمن عُيِّن محصّلاً)، وإدارة المحافظ (المكتب المالي):
   الشحن والرد النقدي وإلغاء الرمز والإيقاف، ونقاط البيع ومحصّلوها، وحدود المحفظة. كل قسم يظهر بحسب ما يسمح به الخادم. */
(function () {
  'use strict';
  const root = document.getElementById('wallet-app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => `${Number(v || 0).toLocaleString('en-US')} ل.س`;
  const when = (t) => (t ? new Date(t).toLocaleString('ar-SY', { timeZone: 'Asia/Damascus', dateStyle: 'short', timeStyle: 'short' }) : '');
  const KIND = { topup: 'شحن', fee_payment: 'سداد رسوم', purchase: 'شراء', purchase_refund: 'إرجاع', cash_refund: 'رد نقدي' };
  const MONEY = new Set(['/api/wallet/admin/topup', '/api/wallet/admin/refund', '/api/wallet/pos/charge']);
  const S = { me: null, pos: null, admin: null, student: null, q: '', merchant: '', refunding: 0, last: null };

  function toast(msg) {
    const t = document.getElementById('toast'); if (!t) return;
    t.querySelector('span').textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
  }
  async function api(method, url, body) {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (method === 'POST' && MONEY.has(url)) headers['Idempotency-Key'] = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
    const r = await fetch(url, { method, credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* ليس JSON */ }
    if (!r.ok) throw Object.assign(new Error((j && j.message) || 'تعذر تنفيذ الطلب.'), { status: r.status, code: j && j.error });
    return j;
  }
  const v = (id) => ((document.getElementById(id) || {}).value || '').trim();

  /* ---------- نقطة البيع ---------- */
  function posHtml() {
    const p = S.pos; if (!p || !p.merchants.length) return '';
    const sel = S.merchant || String(p.merchants[0].id);
    const last = S.last ? `<div class="card" style="margin:12px 0 0;border-color:#1B7F4B"><b style="color:#1B7F4B">تم التحصيل: ${esc(money(S.last.amount))}</b>
      <div class="small">${esc(S.last.student)} · ${esc(S.last.no)} · الرصيد المتبقي ${esc(money(S.last.balance))}</div></div>` : '';
    const rows = p.recent.map((t) => `<tr><td class="small" style="white-space:nowrap">${esc(when(t.at))}</td><td>${esc(t.student)} <span class="mono small">${esc(t.studentNo || '')}</span></td>
      <td>${esc(KIND[t.kind] || t.kind)}</td><td>${esc(money(Math.abs(t.amount)))}</td><td class="small">${esc(t.description)}</td>
      <td>${t.kind === 'purchase' && !t.refunded ? (S.refunding === t.id
        ? `<div class="inline-form"><input id="pos-rf-reason" placeholder="سبب الإرجاع" maxlength="200"><button class="btn sm pri" type="button" data-act="posrefundgo" data-id="${t.id}">تأكيد</button><button class="btn sm" type="button" data-act="posrefundcancel">إلغاء</button></div>`
        : `<button class="btn sm" type="button" data-act="posrefund" data-id="${t.id}">إرجاع</button>`) : (t.refunded ? '<span class="pill">أُرجعت</span>' : '')}</td></tr>`).join('');
    return `<section class="card"><h2 style="margin-top:0">نقطة البيع</h2>
      <p class="hint" style="margin-top:0">امسح البطاقة الجامعية أو اكتب الرقم الجامعي، ثم يُدخل الطالب رمزه السري بنفسه.</p>
      <div class="inline-form">
        <label>نقطة البيع<select id="pos-merchant">${p.merchants.map((m) => `<option value="${m.id}"${String(m.id) === sel ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        <label>الرقم الجامعي<input id="pos-student" dir="ltr" maxlength="40" autocomplete="off" autofocus></label>
        <label>المبلغ (ل.س)<input id="pos-amount" type="number" min="1" step="1" dir="ltr"></label>
        <label style="flex:1">البيان<input id="pos-desc" maxlength="120" placeholder="وجبة، طباعة، قرطاسية…"></label>
        <label>رمز الطالب<input id="pos-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>
        <button class="btn pri" type="button" data-act="poscharge">تحصيل</button>
      </div>${last}
      <h3>عمليات اليوم <span class="small">(${p.today.count} عملية · ${esc(money(p.today.total))})</span></h3>
      <div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>الطالب</th><th>النوع</th><th>المبلغ</th><th>البيان</th><th></th></tr></thead><tbody>
      ${rows || '<tr><td colspan="6" class="small">لا عمليات اليوم.</td></tr>'}</tbody></table></div></section>`;
  }

  /* ---------- إدارة المحافظ (المكتب المالي) ---------- */
  function studentHtml() {
    const s = S.student, can = S.admin.can; if (!s) return '';
    const txns = s.txns.map((t) => `<tr><td class="small" style="white-space:nowrap">${esc(when(t.at))}</td><td class="mono small">${esc(t.no)}</td><td>${esc(KIND[t.kind] || t.kind)}</td>
      <td style="color:${t.amount > 0 ? '#1B7F4B' : 'inherit'}">${t.amount > 0 ? '+' : ''}${esc(money(t.amount))}</td><td>${esc(money(t.balanceAfter))}</td><td class="small">${esc(t.merchant || t.description)}</td></tr>`).join('');
    return `<section class="card" id="wl-student"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">${esc(s.student.name)} <span class="mono small">${esc(s.student.studentNo || '')}</span></h2>
          <p class="small" style="margin:4px 0 0">الرصيد <b style="font-size:1.3rem">${esc(money(s.balance))}</b> · المستحق من الرسوم ${esc(money(s.dues))} ·
          ${s.hasPin ? 'الرمز السري معيَّن' : 'لا رمز سري'}${s.status === 'frozen' ? ` · <b style="color:#B3261E">موقوفة: ${esc(s.frozenReason)}</b>` : ''}${s.locked ? ' · <b style="color:#B3261E">مقفلة مؤقتاً</b>' : ''}</p></div>
        <div class="actions" style="margin:0">
          ${can.entry && s.hasPin ? '<button class="btn sm" type="button" data-act="wlresetpin">إلغاء الرمز السري</button>' : ''}
          ${can.entry ? (s.status === 'frozen' ? '<button class="btn sm" type="button" data-act="wlunfreeze">تفعيل المحفظة</button>' : '<button class="btn sm" type="button" data-act="wlfreeze">إيقاف المحفظة</button>') : ''}
        </div></div>
      ${can.entry ? `<h3>شحن نقدي</h3><div class="inline-form"><label>المبلغ (ل.س)<input id="wl-top-amt" type="number" min="1" dir="ltr"></label>
        <label>الطريقة<select id="wl-top-method"><option value="cash">نقداً في الصندوق</option><option value="bank">إيداع مصرفي</option></select></label>
        <label style="flex:1">ملاحظة<input id="wl-top-note" maxlength="100" placeholder="رقم الإيصال الورقي إن وُجد"></label>
        <button class="btn pri sm" type="button" data-act="wltopup">شحن</button></div>` : ''}
      ${can.post ? `<h3>رد نقدي</h3><p class="hint" style="margin:0 0 6px">عند التخرج أو الانسحاب أو بطلب الطالب. اترك المبلغ فارغاً لرد الرصيد كله.</p>
        <div class="inline-form"><label>المبلغ (ل.س)<input id="wl-rf-amt" type="number" min="1" dir="ltr" placeholder="الرصيد كله"></label>
        <label style="flex:1">السبب<input id="wl-rf-reason" maxlength="200" placeholder="تخرج الطالب"></label>
        <button class="btn sm" type="button" data-act="wlrefund">رد</button></div>` : ''}
      <h3>الحركات</h3><div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>الرقم</th><th>النوع</th><th>المبلغ</th><th>الرصيد بعدها</th><th>البيان</th></tr></thead><tbody>
      ${txns || '<tr><td colspan="6" class="small">لا حركات.</td></tr>'}</tbody></table></div></section>`;
  }
  function adminHtml() {
    const a = S.admin; if (!a) return '';
    const t = a.today || {}, sum = (k) => (t[k] ? Math.abs(t[k].sum) : 0), cnt = (k) => (t[k] ? t[k].count : 0);
    const kpi = (l, val) => `<div class="card" style="margin:0;padding:12px 14px;min-width:160px;flex:1"><div class="small">${esc(l)}</div><div style="font-size:1.4rem;font-weight:700">${esc(val)}</div></div>`;
    const list = a.wallets.map((w) => `<tr><td><button class="btn sm" type="button" data-act="wlopen" data-k="${esc(w.studentNo || w.id)}">${esc(w.name)}</button></td><td class="mono small">${esc(w.studentNo || '')}</td>
      <td>${esc(money(w.balance))}</td><td class="small">${esc(when(w.lastAt))}</td><td>${w.status === 'frozen' ? '<span class="pill p-rejected">موقوفة</span>' : ''}${w.hasPin ? '' : ' <span class="pill">بلا رمز</span>'}</td></tr>`).join('');
    const merchants = a.merchants.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.active ? '<span class="pill p-approved">فعّالة</span>' : '<span class="pill">متوقفة</span>'}</td><td class="small">${esc(m.operators || '—')}</td>
      <td>${a.can.setup ? `<button class="btn sm" type="button" data-act="wlmtoggle" data-id="${m.id}" data-on="${m.active ? 0 : 1}">${m.active ? 'إيقاف' : 'تفعيل'}</button>` : ''}</td></tr>`).join('');
    const setup = a.can.setup ? `<h3>إضافة نقطة بيع</h3><div class="inline-form"><label style="flex:1">الاسم<input id="wl-m-name" maxlength="80" placeholder="المقصف، الطباعة، القرطاسية"></label><button class="btn sm pri" type="button" data-act="wlmadd">إضافة</button></div>
      <h3>تعيين محصّل</h3><div class="inline-form"><label>نقطة البيع<select id="wl-op-m">${a.merchants.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
        <label>اسم مستخدم الموظف<input id="wl-op-user" dir="ltr" maxlength="80"></label>
        <button class="btn sm pri" type="button" data-act="wlopadd">تعيين</button><button class="btn sm" type="button" data-act="wlopdel">إزالة</button></div>
      <h3>حدود المحفظة</h3><div class="inline-form">${Object.entries(a.configLabels).map(([k, l]) => `<label>${esc(l)}<input data-cfg="${k}" type="number" min="1" dir="ltr" value="${esc(a.config[k])}"></label>`).join('')}
        <button class="btn sm pri" type="button" data-act="wlcfg">حفظ الحدود</button></div>` : '';
    return `<section class="card"><h2 style="margin-top:0">إدارة المحافظ</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${kpi('مجموع أرصدة المحافظ (التزام على الجامعة)', money(a.totalBalance))}${kpi(`شحن اليوم (${cnt('topup')})`, money(sum('topup')))}${kpi(`مشتريات اليوم (${cnt('purchase')})`, money(sum('purchase')))}${kpi(`سداد رسوم اليوم (${cnt('fee_payment')})`, money(sum('fee_payment')))}</div>
      <div class="inline-form" style="margin-top:12px"><label style="flex:1">بحث بالرقم الجامعي أو الاسم<input id="wl-q" value="${esc(S.q)}" maxlength="60"></label><button class="btn sm" type="button" data-act="wlsearch">بحث</button><button class="btn sm pri" type="button" data-act="wlopenq">فتح محفظة الطالب</button></div>
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>الطالب</th><th>الرقم</th><th>الرصيد</th><th>آخر حركة</th><th></th></tr></thead><tbody>
      ${list || '<tr><td colspan="5" class="small">لا محافظ مستعملة بعد. ابحث عن طالب لشحن محفظته.</td></tr>'}</tbody></table></div></section>
      ${studentHtml()}
      <section class="card"><h2 style="margin-top:0">نقاط البيع</h2><div class="tbl-wrap"><table><thead><tr><th>النقطة</th><th>الحالة</th><th>المحصّلون</th><th></th></tr></thead><tbody>
      ${merchants || '<tr><td colspan="4" class="small">لا نقاط بيع بعد.</td></tr>'}</tbody></table></div>${setup}</section>`;
  }

  function render() {
    const head = `<header class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px"><img src="/brand/crest.svg" alt="" width="40" height="48"><div><h1 style="margin:0;font-size:1.3rem">المحفظة الجامعية</h1>
      <div class="small">محفظة مغلقة تُصرف داخل الجامعة فقط${S.me ? ` · ${esc(S.me.name)}` : ''}</div></div></div><a class="btn sm" href="/">العودة إلى البوابة</a></header>`;
    if (!S.me) { root.innerHTML = head + '<section class="card"><p>سجّل الدخول من البوابة أولاً، ثم عد إلى هذه الصفحة.</p><a class="btn pri" href="/">تسجيل الدخول</a></section>'; return; }
    const body = posHtml() + adminHtml();
    root.innerHTML = head + (body || '<section class="card"><p>لا تملك صلاحية على المحفظة الجامعية: هذه الصفحة للمكتب المالي ولمحصّلي نقاط البيع. محفظة الطالب في قائمة حسابه في البوابة.</p></section>');
  }

  async function load() {
    try { S.me = (await api('GET', '/api/me')).user; } catch { S.me = null; }
    if (!S.me) return render();
    if (S.me.role === 'student') { location.replace('/'); return; }
    const [pos, admin] = await Promise.all([api('GET', '/api/wallet/pos').catch(() => null), api('GET', `/api/wallet/admin${S.q ? `?q=${encodeURIComponent(S.q)}` : ''}`).catch(() => null)]);
    S.pos = pos; S.admin = admin;
    if (S.student && S.admin) S.student = await api('GET', `/api/wallet/admin/students/${encodeURIComponent(S.student.student.studentNo || S.student.student.id)}`).catch(() => null);
    render();
  }

  const ACT = {
    poscharge: async () => {
      S.merchant = v('pos-merchant');
      const r = await api('POST', '/api/wallet/pos/charge', { merchantId: Number(S.merchant), studentNo: v('pos-student'), amount: Number(v('pos-amount')), pin: v('pos-pin'), description: v('pos-desc') });
      S.last = { ...r, amount: Number(v('pos-amount')) }; toast('تم التحصيل'); await load();
      const f = document.getElementById('pos-student'); if (f) f.focus();
    },
    posrefund: async (d) => { S.refunding = Number(d.id); render(); const f = document.getElementById('pos-rf-reason'); if (f) f.focus(); },
    posrefundcancel: async () => { S.refunding = 0; render(); },
    posrefundgo: async (d) => { await api('POST', `/api/wallet/pos/refund/${d.id}`, { reason: v('pos-rf-reason') }); S.refunding = 0; toast('أُرجع المبلغ إلى محفظة الطالب'); await load(); },
    wlsearch: async () => { S.q = v('wl-q'); await load(); },
    wlopenq: async () => { const k = v('wl-q'); if (!k) { toast('اكتب الرقم الجامعي.'); return; } S.student = await api('GET', `/api/wallet/admin/students/${encodeURIComponent(k)}`); render(); document.getElementById('wl-student')?.scrollIntoView({ block: 'start' }); },
    wlopen: async (d) => { S.student = await api('GET', `/api/wallet/admin/students/${encodeURIComponent(d.k)}`); render(); document.getElementById('wl-student')?.scrollIntoView({ block: 'start' }); },
    wltopup: async () => {
      const amount = Number(v('wl-top-amt')); if (!(amount > 0)) { toast('أدخل مبلغ الشحن.'); return; }
      if (!confirm(`شحن ${money(amount)} في محفظة ${S.student.student.name}؟`)) return;
      const r = await api('POST', '/api/wallet/admin/topup', { studentNo: S.student.student.studentNo, amount, method: v('wl-top-method'), note: v('wl-top-note') });
      toast(`شُحنت المحفظة: ${r.no}. الرصيد ${money(r.balance)}`); await load();
    },
    wlrefund: async () => {
      const amt = v('wl-rf-amt'), reason = v('wl-rf-reason');
      if (!confirm(`رد ${amt ? money(amt) : 'كامل الرصيد'} نقداً إلى ${S.student.student.name}؟`)) return;
      const r = await api('POST', '/api/wallet/admin/refund', { studentNo: S.student.student.studentNo, amount: amt || undefined, reason });
      toast(`رُد المبلغ: ${r.no}`); await load();
    },
    wlresetpin: async () => { if (!confirm('إلغاء الرمز السري؟ يعيّن الطالب رمزاً جديداً من قائمة حسابه.')) return; await api('POST', `/api/wallet/admin/students/${encodeURIComponent(S.student.student.studentNo)}/reset-pin`); toast('أُلغي الرمز'); await load(); },
    wlfreeze: async () => { const reason = prompt('سبب إيقاف المحفظة:'); if (!reason) return; await api('POST', `/api/wallet/admin/students/${encodeURIComponent(S.student.student.studentNo)}/freeze`, { frozen: true, reason }); toast('أُوقفت المحفظة'); await load(); },
    wlunfreeze: async () => { await api('POST', `/api/wallet/admin/students/${encodeURIComponent(S.student.student.studentNo)}/freeze`, { frozen: false }); toast('فُعّلت المحفظة'); await load(); },
    wlmadd: async () => { await api('POST', '/api/wallet/admin/merchants', { name: v('wl-m-name') }); toast('أُضيفت نقطة البيع'); await load(); },
    wlmtoggle: async (d) => { await api('POST', '/api/wallet/admin/merchants', { id: Number(d.id), active: d.on === '1' }); await load(); },
    wlopadd: async () => { await api('POST', `/api/wallet/admin/merchants/${v('wl-op-m')}/operators`, { username: v('wl-op-user') }); toast('عُيِّن المحصّل'); await load(); },
    wlopdel: async () => { await api('POST', `/api/wallet/admin/merchants/${v('wl-op-m')}/operators`, { username: v('wl-op-user'), remove: true }); toast('أُزيل المحصّل'); await load(); },
    wlcfg: async () => {
      const body = {}; document.querySelectorAll('[data-cfg]').forEach((x) => { body[x.dataset.cfg] = Number(x.value); });
      await api('PUT', '/api/wallet/admin/config', body); toast('حُفظت الحدود'); await load();
    },
  };
  let busy = false;
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]'); if (!el || !ACT[el.dataset.act] || busy) return;
    busy = true; el.disabled = true;
    try { await ACT[el.dataset.act]({ ...el.dataset }); } catch (err) { toast(err.message || 'تعذر التنفيذ.'); } finally { busy = false; el.disabled = false; }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'pos-pin') { e.preventDefault(); root.querySelector('[data-act=poscharge]')?.click(); } });
  load();
})();
