/* مركز الأمان: مؤشرات اليوم، والتنبيهات الأمنية ومتابعتها (استلام ثم إغلاق بملاحظة)، وأكثر العناوين فشلاً، وآخر الأحداث،
   وإجراءات الاحتواء: حجب عنوان IP ورفع حجبه، وإنهاء جلسات حساب مشبوه */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (UA.toast ? UA.toast(m) : window.alert(m));
  const when = (t) => (t ? new Date(t).toLocaleString('ar-SY', { timeZone: 'Asia/Damascus', dateStyle: 'short', timeStyle: 'short' }) : '');
  const SEV_PILL = { critical: 'p-rejected', high: 'p-rejected', medium: 'p-review', low: '' };
  const ST_PILL = { open: 'p-rejected', ack: 'p-review', closed: 'p-approved' };
  const SC = { filter: 'active', closing: 0, banIp: '' };
  const banBtn = (ip, can) => (can && ip ? `<button class="btn sm" type="button" data-act="scbanform" data-ip="${esc(ip)}">حجب</button>` : '');

  const kpi = (label, value, tone) => `<div class="card" style="margin:0;padding:12px 14px;min-width:150px;flex:1">
    <div class="small">${esc(label)}</div><div style="font-size:1.6rem;font-weight:700;${tone ? `color:${tone}` : ''}">${esc(value)}</div></div>`;

  function alertRow(a, canManage) {
    const actions = !canManage || a.status === 'closed' ? '' : `${a.status === 'open' ? `<button class="btn sm" type="button" data-act="scack" data-id="${a.id}">استلام</button>` : ''}
      <button class="btn sm" type="button" data-act="scclose" data-id="${a.id}">إغلاق</button>`;
    const closing = SC.closing === a.id ? `<tr><td colspan="7"><div class="inline-form" data-sc-close="${a.id}">
      <label style="flex:1">ملاحظة الإغلاق (ما الذي وُجد وما الذي اتُّخذ)<input id="sc-note" maxlength="500" required minlength="5"></label>
      <button class="btn pri sm" type="button" data-act="scclosego" data-id="${a.id}">تأكيد الإغلاق</button><button class="btn sm" type="button" data-act="sccancel">إلغاء</button></div></td></tr>` : '';
    return `<tr><td><span class="pill ${SEV_PILL[a.severity] || ''}">${esc(a.severityLabel)}</span></td>
      <td><b>${esc(a.title)}</b><div class="small">${esc(a.ruleLabel)}${a.detail ? ` · ${esc(a.detail)}` : ''}</div>${a.note ? `<div class="small">ملاحظة: ${esc(a.note)}</div>` : ''}</td>
      <td>${a.count}</td><td class="small" style="white-space:nowrap">${esc(when(a.firstAt))}${a.lastAt !== a.firstAt ? `<br>${esc(when(a.lastAt))}` : ''}</td>
      <td><span class="pill ${ST_PILL[a.status] || ''}">${esc(a.statusLabel)}</span>${a.closedBy ? `<div class="small">${esc(a.closedBy)}</div>` : a.ackBy ? `<div class="small">${esc(a.ackBy)}</div>` : ''}</td>
      <td class="mono small">${esc(a.ip || '')}</td><td style="white-space:nowrap">${actions} ${a.status !== 'closed' ? banBtn(a.ip, canManage) : ''}</td></tr>${closing}`;
  }

  async function html() {
    const status = SC.filter === 'active' ? '' : SC.filter;
    const [o, l, bn] = await Promise.all([UA.api('GET', '/api/security/overview'), UA.api('GET', `/api/security/alerts${status ? `?status=${status}` : ''}`), UA.api('GET', '/api/security/bans').catch(() => ({ bans: [] }))]);
    const can = !!o.canManage;
    const chip = (v, t) => `<button class="chip" type="button" data-act="scfilter" data-v="${v}" aria-pressed="${SC.filter === v}">${t}</button>`;
    return `<section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">مركز الأمان</h2>
          <p class="hint" style="margin:4px 0 0">يفحص سجل الدخول والصلاحيات والتصدير وجدار الحماية كل دقيقة، ويرفع تنبيهاً واحداً لكل نمط مشبوه. ${o.enabled ? '' : '<b style="color:#B3261E">قواعد الكشف متوقفة من الإعدادات.</b>'}</p></div>
        ${can ? `<div class="actions" style="margin:0"><button class="btn" type="button" data-act="scscan">فحص الآن</button><button class="btn" type="button" data-act="scexport">تصدير التنبيهات (NDJSON)</button></div>` : ''}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        ${kpi('تنبيهات مفتوحة', o.openTotal, o.openTotal ? '#B3261E' : '#1B7F4B')}
        ${kpi('حرجة وعالية', o.open.critical + o.open.high, o.open.critical + o.open.high ? '#B3261E' : '')}
        ${kpi('دخول فاشل (24 ساعة)', o.failed24h)}
        ${kpi('دخول ناجح (24 ساعة)', o.logins24h)}
        ${kpi('عناوين حجبها الجدار (24 ساعة)', o.bans24h)}
      </div></section>
    <section class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">التنبيهات</h2>
      <div class="sub-tabs" role="tablist" style="margin:0">${chip('active', 'المفتوحة وقيد المتابعة')}${chip('closed', 'المغلقة')}${chip('all', 'الكل')}</div></div>
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>الخطورة</th><th>التنبيه</th><th>العدد</th><th>الوقت</th><th>الحالة</th><th>العنوان</th><th></th></tr></thead><tbody>
      ${l.alerts.map((a) => alertRow(a, can)).join('') || `<tr><td colspan="7" class="small">${SC.filter === 'active' ? 'لا تنبيهات مفتوحة.' : 'لا تنبيهات.'}</td></tr>`}
      </tbody></table></div></section>
    ${containment(bn.bans, can)}
    <div class="two">
      <section class="card"><h2>أكثر العناوين فشلاً في الدخول (24 ساعة)</h2><div class="tbl-wrap"><table><thead><tr><th>العنوان</th><th>محاولات</th><th>حسابات</th><th>آخرها</th><th></th></tr></thead><tbody>
        ${o.topIps.map((r) => `<tr><td class="mono">${esc(r.ip)}</td><td>${r.failures}</td><td>${r.users}</td><td class="small" style="white-space:nowrap">${esc(when(r.lastAt))}</td><td>${banBtn(r.ip, can)}</td></tr>`).join('') || '<tr><td colspan="5" class="small">لا محاولات فاشلة.</td></tr>'}
      </tbody></table></div></section>
      <section class="card"><h2>آخر الأحداث الأمنية</h2><div class="tbl-wrap" style="max-height:420px;overflow:auto"><table><thead><tr><th>الوقت</th><th>الحدث</th><th>المستخدم</th><th>العنوان</th></tr></thead><tbody>
        ${o.recent.map((r) => `<tr><td class="small" style="white-space:nowrap">${esc(when(r.at))}</td><td>${esc(r.action)}${r.ref ? ` <span class="small">${esc(r.ref)}</span>` : ''}</td><td>${esc(r.actor)}</td><td class="mono small">${esc(r.ip || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="small">لا أحداث.</td></tr>'}
      </tbody></table></div></section>
    </div>`;
  }

  // الاحتواء: العناوين المحجوبة الآن، ونموذجا الحجب وإنهاء الجلسات لمن يملك صلاحية مراقبة الأمن
  function containment(bans, can) {
    const rows = bans.map((x) => `<tr><td class="mono">${esc(x.ip)}</td><td>${x.manual ? '<span class="pill p-review">يدوي</span>' : '<span class="pill">تلقائي</span>'}</td>
      <td class="small">${esc(x.reason || '')}${x.by ? `<div>${esc(x.by)}</div>` : ''}</td><td class="small" style="white-space:nowrap">${x.until ? esc(when(x.until)) : esc(x.expiresIn || '')}</td>
      <td>${can ? `<button class="btn sm" type="button" data-act="scunban" data-ip="${esc(x.ip)}">رفع الحجب</button>` : ''}</td></tr>`).join('');
    const banForm = can ? `<div class="inline-form" style="margin-top:12px">
        <label>عنوان IP<input id="sc-ban-ip" dir="ltr" value="${esc(SC.banIp)}" placeholder="203.0.113.7" maxlength="45"></label>
        <label>المدة<select id="sc-ban-min" data-no-other="1"><option value="60">ساعة</option><option value="1440" selected>يوم</option><option value="10080">أسبوع</option><option value="43200">30 يوماً</option></select></label>
        <label style="flex:1">السبب<input id="sc-ban-reason" maxlength="300" placeholder="محاولات تخمين من عنوان خارجي"></label>
        <button class="btn pri sm" type="button" data-act="scban">حجب</button></div>` : '';
    const sessForm = can ? `<h3 style="margin:18px 0 6px">إنهاء جلسات حساب</h3>
      <p class="hint" style="margin:0 0 6px">يُخرج الحساب من كل الأجهزة فوراً، فيلزمه الدخول من جديد. استعمله عند الاشتباه بسرقة كلمة المرور، ثم أعد ضبطها من إدارة الحسابات.</p>
      <div class="inline-form"><label>اسم المستخدم<input id="sc-sess-user" dir="ltr" maxlength="80"></label>
        <label style="flex:1">السبب<input id="sc-sess-reason" maxlength="300" placeholder="دخول من عنوان غير معتاد"></label>
        <button class="btn pri sm" type="button" data-act="scendsess">إنهاء الجلسات</button></div>` : '';
    return `<section class="card" id="sc-contain"><h2>الاحتواء</h2>
      <p class="hint" style="margin-top:0">الحجب يمنع العنوان من الوصول إلى الموقع كله حتى انتهاء مدته. الحجب اليدوي يبقى بعد إعادة تشغيل الخادم، أما حجب الجدار التلقائي فمؤقت.</p>
      <div class="tbl-wrap"><table><thead><tr><th>العنوان</th><th>النوع</th><th>السبب</th><th>ينتهي</th><th></th></tr></thead><tbody>
      ${rows || '<tr><td colspan="5" class="small">لا عناوين محجوبة الآن.</td></tr>'}</tbody></table></div>${banForm}${sessForm}</section>`;
  }

  async function mount() {
    const el = document.getElementById('sc-mount'); if (!el) return;
    try { el.innerHTML = await html(); } catch (e) { el.innerHTML = `<section class="card"><p class="reason">${esc(e.message || 'تعذر تحميل مركز الأمان.')}</p></section>`; }
  }

  UA.securityCenter = { render() { setTimeout(mount, 0); return '<div id="sc-mount"><section class="card"><p class="hint">جارٍ تحميل مركز الأمان…</p></section></div>'; } };

  Object.assign(UA.actions = UA.actions || {}, {
    scbanform: async (_el, d) => { SC.banIp = d.ip || ''; await mount(); const s = document.getElementById('sc-contain'); if (s) s.scrollIntoView({ block: 'center' }); const r = document.getElementById('sc-ban-reason'); if (r) r.focus(); },
    scban: async () => {
      const v = (id) => ((document.getElementById(id) || {}).value || '').trim();
      const ip = v('sc-ban-ip'), reason = v('sc-ban-reason'), minutes = Number(v('sc-ban-min') || 1440);
      if (!ip) { toast('أدخل عنوان IP.'); return; }
      if (reason.length < 5) { toast('اكتب سبب الحجب (5 أحرف على الأقل).'); return; }
      if (!confirm(`حجب ${ip}؟ لن يصل هذا العنوان إلى الموقع حتى انتهاء المدة.`)) return;
      await UA.api('POST', '/api/security/bans', { ip, minutes, reason });
      SC.banIp = ''; toast(`حُجب ${ip}`); await mount();
    },
    scunban: async (_el, d) => {
      if (!confirm(`رفع الحجب عن ${d.ip}؟`)) return;
      await UA.api('POST', '/api/security/bans/unban', { ip: d.ip }); toast('رُفع الحجب'); await mount();
    },
    scendsess: async () => {
      const v = (id) => ((document.getElementById(id) || {}).value || '').trim();
      const username = v('sc-sess-user'), reason = v('sc-sess-reason');
      if (!username) { toast('أدخل اسم المستخدم.'); return; }
      if (reason.length < 5) { toast('اكتب السبب (5 أحرف على الأقل).'); return; }
      if (!confirm(`إنهاء كل جلسات ${username}؟ سيُطلب منه الدخول من جديد.`)) return;
      const r = await UA.api('POST', '/api/security/end-sessions', { username, reason });
      toast(`أُنهيت ${r.ended} جلسة لـ ${r.name}`); await mount();
    },
    scfilter: async (_el, d) => { SC.filter = d.v || 'active'; SC.closing = 0; await mount(); },
    scexport: async () => { window.location.assign('/api/security/export.ndjson'); },
    scscan: async () => { const r = await UA.api('POST', '/api/security/scan', {}); toast(r.created ? `تنبيهات جديدة: ${r.created}` : 'اكتمل الفحص، لا تنبيهات جديدة'); await mount(); },
    scack: async (_el, d) => { await UA.api('POST', `/api/security/alerts/${d.id}`, { action: 'ack' }); toast('استُلم التنبيه'); await mount(); },
    scclose: async (_el, d) => { SC.closing = Number(d.id); await mount(); const n = document.getElementById('sc-note'); if (n) n.focus(); },
    sccancel: async () => { SC.closing = 0; await mount(); },
    scclosego: async (_el, d) => {
      const note = ((document.getElementById('sc-note') || {}).value || '').trim();
      if (note.length < 5) { toast('اكتب ملاحظة الإغلاق (5 أحرف على الأقل).'); return; }
      await UA.api('POST', `/api/security/alerts/${d.id}`, { action: 'close', note });
      SC.closing = 0; toast('أُغلق التنبيه'); await mount();
    },
  });
})();
