/* شؤون الموظفين: أجهزة البصمة والحضور الحيوي (تعريف كامل وتعليمات ربط وربط الموظفين وسجل الحركات) وتقييم الأداء الشامل.
   الإجراءات بسمة data-hb (لا data-act) كي لا تتداخل مع معالجات الأقسام الأخرى. */
(function () {
  'use strict';
  const UA = (window.UA = window.UA || {});
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (UA.toast ? UA.toast(m) : alert(m));
  const api = (...a) => UA.api(...a);
  const can = (p) => !!(UA.can && UA.can(p));
  const canBio = () => can('hr:manage') || can('staffatt:manage');
  const canEval = () => can('hr_emp:edit') || can('hr:manage');
  const when = (ms) => (ms ? new Date(ms).toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const $ = (id) => document.getElementById(id);
  const val = (id) => ($(id) ? String($(id).value).trim() : '');
  const B = { bio: null, punchFilter: '', tpl: null, list: null, mine: null };

  /* ---------- نافذة منبثقة بسيطة ---------- */
  function modal(title, html, wide) {
    let host = $('hb-modal');
    if (!host) { host = document.createElement('div'); host.id = 'hb-modal'; document.body.appendChild(host); }
    host.innerHTML = `<div class="modal-back" data-hb="close" style="z-index:9000">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="width:min(${wide ? 980 : 720}px,100%)"><div class="spread" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0">${esc(title)}</h2><button class="btn sm" type="button" data-hb="close" aria-label="إغلاق">إغلاق</button></div>${html}</div></div>`;
  }
  const closeModal = () => { const h = $('hb-modal'); if (h) h.innerHTML = ''; };
  const mount = (id, fn) => { setTimeout(async () => { const el = $(id); if (!el) return; try { el.innerHTML = await fn(); } catch (e) { el.innerHTML = `<section class="card"><p class="reason">${esc(e.message || 'تعذّر التحميل.')}</p></section>`; } }, 0); return `<div id="${id}"><section class="card"><p class="hint">جارٍ التحميل…</p></section></div>`; };

  /* ===================== أجهزة البصمة ===================== */
  async function loadBio() { B.bio = await api('GET', '/api/hr/biometric'); return B.bio; }
  const STATE_PILL = { 'متصل': 'p-approved', 'غير متصل': 'p-rejected', 'لم يتصل بعد': 'p-review', 'معطّل': 'p-review' };
  async function bioHtml() {
    const d = await loadBio(), devs = d.devices, mapped = d.users.filter((u) => u.pin).length;
    const rows = devs.map((x) => `<tr>
      <td><code>${esc(x.code)}</code></td>
      <td><b>${esc(x.name)}</b><div class="small">${esc([x.brand, x.model].filter(Boolean).join(' · '))}</div></td>
      <td class="mono" dir="ltr">${esc(x.serialNo || '—')}</td>
      <td class="mono" dir="ltr">${x.ip ? `${esc(x.ip)}${x.port ? `:${x.port}` : ''}` : '—'}</td>
      <td class="small">${esc(x.commLabel)}<div>${esc(d.directions[x.direction] || '')} · ${x.verifyModes.map((m) => esc(d.modes[m])).join('، ')}</div></td>
      <td>${esc(x.location)}${x.building ? `<div class="small">${esc(x.building)}</div>` : ''}</td>
      <td><span class="pill ${STATE_PILL[x.state] || 'p-review'}">${esc(x.state)}</span><div class="small">${x.lastSeenAt ? `آخر اتصال ${when(x.lastSeenAt)}` : ''}</div></td>
      <td><b>${Number(x.logsSynced).toLocaleString('en-US')}</b></td>
      <td style="white-space:nowrap">
        <button class="btn sm" data-hb="guide" data-id="${x.id}">تعليمات الربط</button>
        ${canBio() ? `<button class="btn sm" data-hb="dev-edit" data-id="${x.id}">تعديل</button>
          ${x.commType === 'push_http' ? `<button class="btn sm" data-hb="dev-token" data-id="${x.id}">${x.hasToken ? 'تجديد رمز الربط' : 'إصدار رمز الربط'}</button>` : ''}
          <button class="btn sm" data-hb="dev-import" data-id="${x.id}">استيراد ملف</button>
          <button class="btn sm" data-hb="dev-toggle" data-id="${x.id}" data-on="${x.active ? 0 : 1}">${x.active ? 'تعطيل' : 'تفعيل'}</button>` : ''}
      </td></tr>`).join('');
    const users = d.users.map((u) => `<tr>
      <td><b>${esc(u.name)}</b><div class="small mono">${esc(u.username)}</div></td><td>${esc(u.unit || '—')}</td>
      <td>${canBio() ? `<input id="hb-pin-${u.userId}" value="${esc(u.pin)}" maxlength="20" inputmode="numeric" placeholder="مثال: 1024" style="width:110px" aria-label="رقم الموظف على الجهاز">` : esc(u.pin || '—')}</td>
      <td>${canBio() ? `<input id="hb-card-${u.userId}" value="${esc(u.cardNo)}" maxlength="30" placeholder="اختياري" style="width:120px" aria-label="رقم البطاقة">` : esc(u.cardNo || '—')}</td>
      <td class="small">${when(u.lastPunch)}</td>
      <td>${canBio() ? `<button class="btn sm" data-hb="user-save" data-id="${u.userId}">حفظ</button>` : ''}</td></tr>`).join('');
    const punches = d.punches.filter((p) => !B.punchFilter || p.status === B.punchFilter).map((p) => `<tr>
      <td class="small">${when(p.at)}</td><td>${esc(p.device || '—')}</td><td class="mono">${esc(p.pin)}</td>
      <td>${p.employee ? esc(p.employee) : '<span class="pill p-rejected">غير مربوط بموظف</span>'}</td>
      <td class="small">${esc(d.modes[p.verify] || p.verify || '—')}</td><td class="small">${esc({ adms: 'ADMS', http: 'HTTP', usb: 'ملف USB' }[p.source] || p.source)}</td></tr>`).join('');
    return `<section class="card">
        <div class="spread" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div><h2 style="margin:0">أجهزة البصمة والحضور الحيوي</h2><p class="hint" style="margin:4px 0 0">عرّف كل جهاز بكامل بياناته، واربط كل موظف برقمه على الأجهزة. تُطبَّق كل بصمة على دوام الموظف بوقتها الفعلي على الجهاز.</p></div>
          ${canBio() ? '<button class="btn pri" data-hb="dev-new">+ إضافة جهاز بصمة</button>' : ''}
        </div>
        <div class="imp-sum" style="margin-top:12px"><div class="stat"><small>الأجهزة</small><b>${devs.length}</b></div><div class="stat"><small>متصلة الآن</small><b>${devs.filter((x) => x.online).length}</b></div>
          <div class="stat"><small>موظفون مربوطون</small><b>${mapped} / ${d.users.length}</b></div><div class="stat"><small>حركات غير مربوطة</small><b>${d.unmapped}</b></div></div>
      </section>
      <section class="card"><h3>الأجهزة المعرّفة</h3><div class="tbl-wrap"><table><thead><tr><th>الرمز</th><th>الجهاز</th><th>الرقم التسلسلي</th><th>IP:المنفذ</th><th>الاتصال والتحقق</th><th>الموقع</th><th>الحالة</th><th>الحركات</th><th>إجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty">لا أجهزة بعد؛ أضف أول جهاز.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h3>رقم الموظف على أجهزة البصمة</h3><p class="hint" style="margin-top:0">سجّل الموظف على الجهاز بالرقم نفسه (User ID / PIN) المدخل هنا. الحركات التي وصلت برقم قبل ربطه تُطبَّق تلقائياً عند الربط.</p>
        <div class="tbl-wrap"><table><thead><tr><th>الموظف</th><th>الوحدة</th><th>الرقم على الجهاز</th><th>رقم البطاقة</th><th>آخر بصمة</th><th></th></tr></thead><tbody>${users}</tbody></table></div></section>
      <section class="card"><div class="spread" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0">آخر الحركات الواردة</h3>
        <span><button class="btn sm${B.punchFilter ? '' : ' pri'}" data-hb="pf" data-f="">الكل</button> <button class="btn sm${B.punchFilter === 'unmapped' ? ' pri' : ''}" data-hb="pf" data-f="unmapped">غير المربوطة (${d.unmapped})</button></span></div>
        <div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>الجهاز</th><th>الرقم</th><th>الموظف</th><th>التحقق</th><th>المصدر</th></tr></thead><tbody>${punches || '<tr><td colspan="6" class="empty">لا حركات بعد.</td></tr>'}</tbody></table></div></section>`;
  }
  const refreshBio = async () => { const el = $('hb-bio'); if (el) el.innerHTML = await bioHtml(); };

  function deviceForm(x) {
    const d = B.bio, v = x || { commType: 'push_adms', direction: 'both', verifyModes: ['fingerprint'], port: 4370 };
    const sel = (id, map, cur) => `<select id="${id}" data-no-other="1">${Object.entries(map).map(([k, l]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    modal(x ? `تعديل جهاز ${x.code}` : 'إضافة جهاز بصمة', `<div class="form-grid" style="margin-top:10px">
      <label>رمز الجهاز<input id="hd-code" value="${esc(v.code || '')}" maxlength="30" placeholder="BIO-GATE-01" dir="ltr"></label>
      <label>اسم الجهاز<input id="hd-name" value="${esc(v.name || '')}" maxlength="80" placeholder="بوابة المبنى الرئيسي"></label>
      <label>الشركة المصنّعة<select id="hd-brand" data-no-other="1">${['', ...d.brands].map((b) => `<option value="${esc(b)}"${b === (v.brand || '') ? ' selected' : ''}>${esc(b || '— اختر —')}</option>`).join('')}</select></label>
      <label>الطراز<input id="hd-model" value="${esc(v.model || '')}" maxlength="60" placeholder="SpeedFace-V5L" dir="ltr"></label>
      <label>الرقم التسلسلي (SN)<input id="hd-serial" value="${esc(v.serialNo || '')}" maxlength="60" placeholder="من إعدادات الجهاز ← معلومات النظام" dir="ltr"></label>
      <label>عنوان MAC (اختياري)<input id="hd-mac" value="${esc(v.mac || '')}" maxlength="17" placeholder="00:17:61:AB:CD:EF" dir="ltr"></label>
      <label>عنوان IP<input id="hd-ip" value="${esc(v.ip || '')}" maxlength="45" placeholder="192.168.1.201" dir="ltr"></label>
      <label>المنفذ<input id="hd-port" type="number" min="1" max="65535" value="${esc(v.port ?? 4370)}"></label>
      <label>طريقة الاتصال${sel('hd-comm', d.comm, v.commType)}</label>
      <label>الاتجاه${sel('hd-dir', d.directions, v.direction)}</label>
      <fieldset style="grid-column:1/-1;border:1px solid var(--line);border-radius:8px;padding:8px"><legend class="small">طرق التحقق المتاحة على الجهاز</legend>${Object.entries(d.modes).map(([k, l]) => `<label class="chk" style="display:inline-flex;gap:4px;margin-inline-end:14px"><input type="checkbox" class="hd-mode" value="${k}"${v.verifyModes.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</fieldset>
      <label>الموقع / البوابة<input id="hd-loc" value="${esc(v.location || '')}" maxlength="120" placeholder="البوابة الرئيسية"></label>
      <label>المبنى والطابق (اختياري)<input id="hd-bld" value="${esc(v.building || '')}" maxlength="80" placeholder="مبنى الإدارة — الطابق الأرضي"></label>
      <label>إصدار البرنامج الثابت (اختياري)<input id="hd-fw" value="${esc(v.firmware || '')}" maxlength="60" placeholder="Ver 6.60" dir="ltr"></label>
      <label>تاريخ التركيب<input id="hd-inst" type="date" value="${esc(v.installedOn || '')}"></label>
      <label>نهاية الضمان<input id="hd-war" type="date" value="${esc(v.warrantyUntil || '')}"></label>
      <label class="chk" style="align-self:end"><input type="checkbox" id="hd-rip"${v.restrictIp ? ' checked' : ''}> قبول الحركات من عنوان IP الجهاز فقط</label>
      <label style="grid-column:1/-1">ملاحظات<input id="hd-notes" value="${esc(v.notes || '')}" maxlength="300"></label>
    </div><div class="actions"><button class="btn pri" data-hb="dev-save" data-id="${x ? x.id : ''}">حفظ الجهاز</button></div>`);
  }
  function guide(x) {
    const host = B.bio.host || location.host, https = location.protocol === 'https:';
    const body = x.commType === 'push_adms' ? `<ol>
        <li>في الجهاز: <b>القائمة ← الاتصال (COMM) ← إعدادات الخادم السحابي / ADMS</b>.</li>
        <li>عنوان الخادم: <code dir="ltr">${esc(host.split(':')[0])}</code> · المنفذ: <code>${esc(host.split(':')[1] || (https ? '443' : '80'))}</code>${https ? ' · فعّل HTTPS' : ''}.</li>
        <li>تأكد أن الرقم التسلسلي للجهاز هو <code dir="ltr">${esc(x.serialNo)}</code> كما سُجّل هنا (من معلومات النظام).</li>
        <li>اضبط المنطقة الزمنية للجهاز على +3 (دمشق) وتاريخه ووقته.</li>
        <li>سجّل كل موظف على الجهاز برقمه في جدول «رقم الموظف على أجهزة البصمة».</li>
        <li>خلال دقيقة تتغير حالة الجهاز إلى «متصل» وتبدأ الحركات بالوصول.</li></ol>`
      : x.commType === 'push_http' ? `<p>يرسل الجهاز أو برنامج الوسيط الحركات بصيغة JSON إلى:</p>
        <pre dir="ltr" style="white-space:pre-wrap;background:var(--surface2);padding:10px;border-radius:8px">POST ${esc(location.protocol)}//${esc(host)}/api/hr/biometric/push
Authorization: Bearer &lt;رمز الربط${x.tokenLast4 ? ` …${esc(x.tokenLast4)}` : ''}&gt;
Content-Type: application/json

{"records":[{"pin":"1024","time":"2026-11-16 08:02:11"}]}</pre>
        <p class="small">الوقت بتوقيت دمشق، أو ISO مع المنطقة الزمنية. ${x.hasToken ? 'رمز الربط صادر؛ جدّده إن فُقد.' : 'أصدر رمز الربط أولاً من زر «إصدار رمز الربط».'}</p>`
      : `<ol><li>في الجهاز: <b>إدارة USB ← تنزيل ← سجل الحضور (AttLog)</b> إلى ذاكرة USB.</li><li>من هذه الشاشة: «استيراد ملف» واختر ملف <code dir="ltr">.dat</code> أو <code dir="ltr">.txt</code>.</li><li>كل سطر: الرقم ثم التاريخ والوقت؛ المكرر يُتجاهل تلقائياً.</li></ol>`;
    modal(`تعليمات ربط ${x.name}`, `<p class="small">طريقة الاتصال: <b>${esc(x.commLabel)}</b></p>${body}`);
  }

  /* ===================== تقييم الأداء الشامل ===================== */
  const STATUS = { draft: ['مسودة', 'p-review'], submitted: ['بانتظار الاعتماد', 'p-review'], approved: ['معتمد', 'p-approved'] };
  async function listHtml() {
    const [l, t] = await Promise.all([api('GET', '/api/hr/appraisals'), canEval() ? api('GET', '/api/hr/appraisals/template') : Promise.resolve(null)]);
    B.list = l.appraisals; B.tpl = t;
    const me = UA.S && UA.S.me ? UA.S.me.id : null;
    const rows = B.list.map((a) => `<tr>
      <td><b>${esc(a.employeeName)}</b><div class="small">${esc(a.jobTitle || '')}</div></td><td>${esc(a.department)}</td><td>${esc(a.periodLabel)}${a.periodFrom ? `<div class="small">${esc(a.periodFrom)} ← ${esc(a.periodTo)}</div>` : ''}</td>
      <td><b>${a.overall}%</b><div class="small">${esc(a.grade || '')}</div></td><td class="small">${a.attendancePct == null ? '—' : `${a.attendancePct}%`}</td>
      <td><span class="pill ${(STATUS[a.status] || STATUS.approved)[1]}">${esc((STATUS[a.status] || STATUS.approved)[0])}</span>${a.acknowledgedAt ? '<div class="small">اطّلع الموظف</div>' : ''}</td>
      <td class="small">${esc(a.evaluatorName)}</td><td>${esc(a.recommendation)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-hb="ap-view" data-id="${a.id}">عرض / طباعة</button>
        ${a.status !== 'approved' && (can('hr:manage') || a.evaluatorId === me) && canEval() ? `<button class="btn sm" data-hb="ap-edit" data-id="${a.id}">تعديل</button>` : ''}
        ${a.status === 'submitted' && can('hr:manage') && a.evaluatorId !== me ? `<button class="btn pri sm" data-hb="ap-approve" data-id="${a.id}">اعتماد</button> <button class="btn sm" data-hb="ap-return" data-id="${a.id}">إعادة</button>` : ''}</td></tr>`).join('');
    return `<section class="card"><div class="spread" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div><h2 style="margin:0">تقييم الأداء الوظيفي الشامل</h2><p class="hint" style="margin:4px 0 0">محاور بأوزان: الانضباط (مع نسبة الدوام من سجل الحضور)، أداء المهام، المهارات، العلاقات، والقيادة للمشرفين، مع مسؤوليات الوظيفة الخاصة بكل موظف. يُعدّه المقيّم ويعتمده مدير شؤون الموظفين، ثم يطّلع عليه الموظف.</p></div>
        ${canEval() ? '<button class="btn pri" data-hb="ap-new">+ تقييم جديد</button>' : ''}</div></section>
      <section class="card"><div class="tbl-wrap"><table><thead><tr><th>الموظف</th><th>الوحدة</th><th>الدورة</th><th>النتيجة</th><th>الدوام</th><th>الحالة</th><th>المقيّم</th><th>التوصية</th><th>إجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty">لا تقييمات بعد.</td></tr>'}</tbody></table></div></section>`;
  }
  const refreshList = async () => { const el = $('hb-ap'); if (el) el.innerHTML = await listHtml(); };

  const opt5 = (cur) => `<option value="">—</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${Number(cur) === n ? ' selected' : ''}>${n} · ${esc(B.tpl.scale[n])}</option>`).join('')}`;
  const respRow = (r = {}) => `<div class="form-grid hb-resp" style="grid-template-columns:2fr 1fr 2fr auto;margin-bottom:6px"><input class="hb-rt" maxlength="120" value="${esc(r.title || '')}" placeholder="مثال: أرشفة المراسلات الواردة إلكترونياً" aria-label="المسؤولية"><select class="hb-rr" data-no-other="1" aria-label="التقدير">${opt5(r.rating)}</select><input class="hb-rc" maxlength="200" value="${esc(r.comment || '')}" placeholder="تعليق (اختياري)" aria-label="تعليق"><button class="btn sm" type="button" data-hb="resp-del" aria-label="حذف المسؤولية">×</button></div>`;
  function appraisalForm(a) {
    const t = B.tpl, today = new Date().toISOString().slice(0, 10), y = today.slice(0, 4);
    const v = a || { periodFrom: `${y}-01-01`, periodTo: today, periodLabel: `التقييم السنوي ${y}`, scores: {}, responsibilities: [], recommendation: 'علاوة دورية', isSupervisor: false };
    const axes = t.axes.map((ax) => `<fieldset class="hb-axis" data-sup="${ax.supervisorOnly ? 1 : 0}" style="border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:8px"${ax.supervisorOnly && !v.isSupervisor ? ' hidden' : ''}>
        <legend><b>${esc(ax.label)}</b> <span class="small">(الوزن ${ax.weight}) · <span class="hb-axp" data-ax="${ax.key}"></span></span></legend>
        ${ax.criteria.map((c) => `<label style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0"><span>${esc(c.label)}${c.key === 'attendance' ? ' <span class="small" id="hb-attnote"></span>' : ''}</span><select class="hb-sc" data-k="${c.key}" data-ax="${ax.key}" data-no-other="1" style="width:160px">${opt5(v.scores[c.key])}</select></label>`).join('')}</fieldset>`).join('');
    modal(a ? `تعديل تقييم ${a.employeeName}` : 'تقييم أداء وظيفي شامل', `<div class="form-grid" style="margin-top:10px">
        <label>الموظف<select id="ha-user" data-no-other="1"${a ? ' disabled' : ''}><option value="">— اختر الموظف —</option>${t.employees.map((e) => `<option value="${e.id}" data-job="${esc(e.jobTitle)}"${a && a.userId === e.id ? ' selected' : ''}>${esc(e.name)}${e.unit ? ` — ${esc(e.unit)}` : ''}</option>`).join('')}</select></label>
        <label>المسمى الوظيفي<input id="ha-job" maxlength="80" value="${esc(v.jobTitle || '')}" placeholder="رئيس شعبة الأرشيف"></label>
        <label>دورة التقييم<input id="ha-label" maxlength="60" value="${esc(v.periodLabel)}"></label>
        <label>من<input id="ha-from" type="date" value="${esc(v.periodFrom)}"></label><label>إلى<input id="ha-to" type="date" value="${esc(v.periodTo)}"></label>
        <label class="chk" style="align-self:end"><input type="checkbox" id="ha-sup"${v.isSupervisor ? ' checked' : ''}> يشغل وظيفة إشرافية (يُقيَّم محور القيادة)</label>
      </div>
      <p class="small"><button class="btn sm" type="button" data-hb="ap-att">احسب نسبة الدوام من سجل الحضور</button> <span id="hb-att"></span></p>
      <h3>المحاور والمعايير <span class="small">(1 ضعيف ← 5 ممتاز)</span></h3>${axes}
      <h3>مسؤوليات الوظيفة الخاصة بالموظف <span class="small">(الوزن ${t.respWeight}، تُحتسب إن ذُكرت)</span></h3>
      <div id="hb-resps">${(v.responsibilities.length ? v.responsibilities : [{}]).map(respRow).join('')}</div>
      <button class="btn sm" type="button" data-hb="resp-add">+ مسؤولية</button>
      <div class="form-grid" style="margin-top:10px">
        <label>نقاط القوة<textarea id="ha-str" rows="2" maxlength="1000">${esc(v.strengths || '')}</textarea></label>
        <label>مجالات التحسين<textarea id="ha-imp" rows="2" maxlength="1000">${esc(v.improvements || '')}</textarea></label>
        <label>الاحتياجات التدريبية<textarea id="ha-trn" rows="2" maxlength="1000">${esc(v.trainingNeeds || '')}</textarea></label>
        <label>أهداف الفترة القادمة<textarea id="ha-goal" rows="2" maxlength="1000">${esc(v.goalsNext || '')}</textarea></label>
        <label>التوصية<select id="ha-rec" data-no-other="1">${t.recommendations.map((r) => `<option${r === v.recommendation ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      </div>
      <p style="font-size:16px">النتيجة الحالية: <b id="hb-total">—</b></p>
      <div class="actions"><button class="btn" data-hb="ap-save" data-id="${a ? a.id : ''}" data-submit="0">حفظ مسودة</button><button class="btn pri" data-hb="ap-save" data-id="${a ? a.id : ''}" data-submit="1">إرسال للاعتماد</button></div>`, true);
    recompute();
  }
  // الحساب نفسه في الخادم: متوسط كل محور ×20، ثم المتوسط الموزون للمحاور المكتملة
  function recompute() {
    const t = B.tpl; if (!t || !$('hb-total')) return;
    const sup = $('ha-sup').checked, parts = [];
    document.querySelectorAll('.hb-axis').forEach((f) => { f.hidden = f.dataset.sup === '1' && !sup; });
    for (const ax of t.axes.filter((x) => !x.supervisorOnly || sup)) {
      const vals = [...document.querySelectorAll(`.hb-sc[data-ax="${ax.key}"]`)].map((s) => Number(s.value)).filter(Boolean);
      const pct = vals.length === ax.criteria.length ? Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 200) / 10 : null;
      const lbl = document.querySelector(`.hb-axp[data-ax="${ax.key}"]`); if (lbl) lbl.textContent = pct == null ? 'غير مكتمل' : `${pct}%`;
      parts.push([ax.weight, pct]);
    }
    const rs = [...document.querySelectorAll('.hb-resp')].filter((r) => r.querySelector('.hb-rt').value.trim()).map((r) => Number(r.querySelector('.hb-rr').value)).filter(Boolean);
    if (rs.length) parts.push([t.respWeight, Math.round((rs.reduce((s, x) => s + x, 0) / rs.length) * 200) / 10]);
    const done = parts.filter((p) => p[1] != null), w = done.reduce((s, p) => s + p[0], 0);
    const all = done.length === parts.length && w ? Math.round((done.reduce((s, p) => s + p[0] * p[1], 0) / w) * 10) / 10 : null;
    const g = all == null ? '' : all >= 90 ? 'ممتاز' : all >= 80 ? 'جيد جداً' : all >= 70 ? 'جيد' : all >= 60 ? 'مقبول' : 'ضعيف';
    $('hb-total').textContent = all == null ? 'أكمل كل المعايير' : `${all}% — ${g}`;
  }
  function collect() {
    const scores = {}; document.querySelectorAll('.hb-axis:not([hidden]) .hb-sc').forEach((s) => { if (s.value) scores[s.dataset.k] = Number(s.value); });
    const responsibilities = [...document.querySelectorAll('.hb-resp')].map((r) => ({ title: r.querySelector('.hb-rt').value.trim(), rating: Number(r.querySelector('.hb-rr').value) || null, comment: r.querySelector('.hb-rc').value.trim() })).filter((r) => r.title);
    return { userId: Number(val('ha-user')) || null, jobTitle: val('ha-job'), periodLabel: val('ha-label'), periodFrom: val('ha-from'), periodTo: val('ha-to'), isSupervisor: $('ha-sup').checked, scores, responsibilities,
      strengths: val('ha-str'), improvements: val('ha-imp'), trainingNeeds: val('ha-trn'), goalsNext: val('ha-goal'), recommendation: val('ha-rec') };
  }
  function viewHtml(a, mineView) {
    const crit = Object.fromEntries((B.tpl ? B.tpl.axes : []).flatMap((x) => x.criteria.map((c) => [c.key, c.label])));
    const sc = (n) => (n ? `${n} · ${({ 1: 'ضعيف', 2: 'مقبول', 3: 'جيد', 4: 'جيد جداً', 5: 'ممتاز' })[n]}` : '—');
    return `<div data-doc-title="تقييم أداء وظيفي" data-doc-no="${a.id}" data-doc-dept="شؤون الموظفين" data-doc-signers="الموظف|المقيّم:${esc(a.evaluatorName)}|مدير شؤون الموظفين"></div>
      <dl class="kv"><dt>الموظف</dt><dd>${esc(a.employeeName)} · ${esc(a.jobTitle || '')}</dd><dt>الوحدة</dt><dd>${esc(a.department)}</dd><dt>الدورة</dt><dd>${esc(a.periodLabel)}${a.periodFrom ? ` (${esc(a.periodFrom)} ← ${esc(a.periodTo)})` : ''}</dd>
        <dt>النتيجة</dt><dd><b>${a.overall}% — ${esc(a.grade)}</b></dd><dt>نسبة الدوام</dt><dd>${a.attendancePct == null ? '—' : `${a.attendancePct}%`}</dd><dt>التوصية</dt><dd>${esc(a.recommendation)}</dd>
        <dt>الحالة</dt><dd>${esc((STATUS[a.status] || STATUS.approved)[0])}${a.approvedBy ? ` · اعتمده ${esc(a.approvedBy)} ${when(a.approvedAt)}` : ''}</dd></dl>
      ${a.breakdown ? `<table class="tbl"><thead><tr><th>المحور</th><th>الوزن</th><th>النسبة</th></tr></thead><tbody>${a.breakdown.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.weight}</td><td>${x.pct == null ? '—' : `${x.pct}%`}</td></tr>`).join('')}</tbody></table>
        <table class="tbl" style="margin-top:8px"><thead><tr><th>المعيار</th><th>التقدير</th></tr></thead><tbody>${Object.entries(a.scores).map(([k, n]) => `<tr><td>${esc(crit[k] || k)}</td><td>${sc(n)}</td></tr>`).join('')}</tbody></table>
        ${a.responsibilities.length ? `<table class="tbl" style="margin-top:8px"><thead><tr><th>مسؤولية الوظيفة</th><th>التقدير</th><th>تعليق</th></tr></thead><tbody>${a.responsibilities.map((r) => `<tr><td>${esc(r.title)}</td><td>${sc(r.rating)}</td><td>${esc(r.comment || '')}</td></tr>`).join('')}</tbody></table>` : ''}`
        : `<p class="small">تقييم سابق مختصر: الالتزام ${a.punctuality}% · الجودة ${a.productivity}% · التعاون ${a.teamwork}%.</p>`}
      <dl class="kv" style="margin-top:8px"><dt>نقاط القوة</dt><dd>${esc(a.strengths || '—')}</dd><dt>مجالات التحسين</dt><dd>${esc(a.improvements || '—')}</dd><dt>الاحتياجات التدريبية</dt><dd>${esc(a.trainingNeeds || '—')}</dd><dt>أهداف الفترة القادمة</dt><dd>${esc(a.goalsNext || '—')}</dd>
        <dt>تعليق الموظف</dt><dd>${a.acknowledgedAt ? `${esc(a.employeeComment || 'اطّلع دون تعليق')} (${when(a.acknowledgedAt)})` : 'لم يطّلع بعد'}</dd></dl>
      ${mineView && !a.acknowledgedAt ? `<label>تعليقك (اختياري)<textarea id="ha-mycom" rows="2" maxlength="1000"></textarea></label><div class="actions"><button class="btn pri" data-hb="ap-ack" data-id="${a.id}">اطّلعت على التقييم</button></div>` : ''}
      <div class="actions no-print"><button class="btn" data-act="print">🖨️ طباعة</button></div>`;
  }

  /* ---------- تقييماتي (للموظف) ---------- */
  async function mineHtml() {
    B.mine = (await api('GET', '/api/hr/my-appraisals')).appraisals;
    if (!B.mine.length) return '';
    return `<section class="card"><h2>تقييمات أدائي</h2><div class="tbl-wrap"><table><thead><tr><th>الدورة</th><th>النتيجة</th><th>التوصية</th><th>الاطلاع</th><th></th></tr></thead><tbody>
      ${B.mine.map((a) => `<tr><td>${esc(a.periodLabel)}</td><td><b>${a.overall}%</b> ${esc(a.grade)}</td><td>${esc(a.recommendation)}</td><td>${a.acknowledgedAt ? 'اطّلعت' : '<span class="pill p-review">بانتظار اطلاعك</span>'}</td><td><button class="btn sm" data-hb="my-view" data-id="${a.id}">عرض</button></td></tr>`).join('')}
    </tbody></table></div></section>`;
  }

  UA.hrBio = { render: () => mount('hb-bio', bioHtml) };
  UA.hrAppraisal = { render: () => mount('hb-ap', listHtml), mine: () => mount('hb-mine', mineHtml) };

  /* ---------- الإجراءات ---------- */
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#hb-modal') && (t.classList.contains('hb-sc') || t.classList.contains('hb-rr') || t.id === 'ha-sup')) recompute();
    if (t.id === 'ha-user' && t.selectedOptions[0] && !val('ha-job')) $('ha-job').value = t.selectedOptions[0].dataset.job || '';
  });
  document.addEventListener('input', (e) => { if (e.target && e.target.classList && e.target.classList.contains('hb-rt')) recompute(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('hb-modal') && $('hb-modal').innerHTML) closeModal(); });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-hb]');
    if (!b) return;
    const a = b.dataset.hb, id = Number(b.dataset.id);
    if (a === 'close') { if (b.classList.contains('modal-back') && e.target.closest('.modal')) return; closeModal(); return; }
    try {
      if (a === 'pf') { B.punchFilter = b.dataset.f; await refreshBio(); }
      else if (a === 'dev-new') deviceForm(null);
      else if (a === 'dev-edit') deviceForm(B.bio.devices.find((x) => x.id === id));
      else if (a === 'guide') guide(B.bio.devices.find((x) => x.id === id));
      else if (a === 'dev-save') {
        const body = { code: val('hd-code'), name: val('hd-name'), brand: val('hd-brand'), model: val('hd-model'), serialNo: val('hd-serial'), mac: val('hd-mac'), ip: val('hd-ip'), port: val('hd-port'),
          commType: val('hd-comm'), direction: val('hd-dir'), verifyModes: [...document.querySelectorAll('.hd-mode:checked')].map((x) => x.value), location: val('hd-loc'), building: val('hd-bld'),
          firmware: val('hd-fw'), installedOn: val('hd-inst'), warrantyUntil: val('hd-war'), restrictIp: $('hd-rip').checked, notes: val('hd-notes') };
        const r = id ? await api('PUT', `/api/hr/biometric/devices/${id}`, body) : await api('POST', '/api/hr/biometric/devices', body);
        closeModal(); await refreshBio(); toast(id ? 'حُفظ الجهاز' : 'أُضيف الجهاز');
        if (!id) guide(r.device);
      }
      else if (a === 'dev-token') {
        if (!confirm('إصدار رمز ربط جديد يُبطل الرمز السابق. متابعة؟')) return;
        const r = await api('POST', `/api/hr/biometric/devices/${id}/token`, {});
        modal('رمز ربط الجهاز', `<p>انسخ الرمز الآن وضعه في إعدادات الجهاز أو الوسيط؛ <b>لن يظهر مرة أخرى</b>.</p><input id="hb-tok" readonly value="${esc(r.token)}" dir="ltr" style="width:100%"><div class="actions"><button class="btn pri" data-hb="tok-copy">نسخ</button></div>`);
        await refreshBio();
      }
      else if (a === 'tok-copy') { try { await navigator.clipboard.writeText(val('hb-tok')); toast('نُسخ الرمز'); } catch { $('hb-tok').select(); } }
      else if (a === 'dev-import') {
        modal('استيراد ملف حركات من الجهاز', `<p class="small">ملف سجل الحضور المصدَّر من الجهاز (AttLog بامتداد .dat أو .txt): الرقم ثم التاريخ والوقت في كل سطر. المكرر يُتجاهل.</p><input id="hb-file" type="file" accept=".dat,.txt,.csv,text/plain"><div class="actions"><button class="btn pri" data-hb="imp-go" data-id="${id}">استيراد</button></div>`);
      }
      else if (a === 'imp-go') {
        const f = $('hb-file') && $('hb-file').files[0]; if (!f) { toast('اختر الملف أولاً.'); return; }
        const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(f); });
        const r = await api('POST', `/api/hr/biometric/devices/${id}/import`, { data });
        closeModal(); await refreshBio(); toast(`استُورد ${r.inserted} حركة (${r.duplicates} مكررة، ${r.unmapped} غير مربوطة، ${r.rejected} سطر مرفوض)`);
      }
      else if (a === 'dev-toggle') { await api('POST', `/api/hr/biometric/devices/${id}/toggle`, { active: b.dataset.on === '1' }); await refreshBio(); }
      else if (a === 'user-save') {
        const r = await api('PUT', `/api/hr/biometric/users/${id}`, { pin: val(`hb-pin-${id}`), cardNo: val(`hb-card-${id}`) });
        toast(r.pin ? `رُبط الموظف بالرقم ${r.pin}${r.applied ? ` وطُبّقت ${r.applied} حركة سابقة` : ''}` : 'أُلغي ربط الموظف'); await refreshBio();
      }
      else if (a === 'ap-new') { if (!B.tpl) B.tpl = await api('GET', '/api/hr/appraisals/template'); appraisalForm(null); }
      else if (a === 'ap-edit') { if (!B.tpl) B.tpl = await api('GET', '/api/hr/appraisals/template'); appraisalForm((await api('GET', `/api/hr/appraisals/${id}`)).appraisal); }
      else if (a === 'resp-add') { $('hb-resps').insertAdjacentHTML('beforeend', respRow()); }
      else if (a === 'resp-del') { b.closest('.hb-resp').remove(); recompute(); }
      else if (a === 'ap-att') {
        const uid = val('ha-user') || (B.list.find((x) => String(x.id) === String(document.querySelector('[data-hb="ap-save"]').dataset.id)) || {}).userId;
        if (!uid) { toast('اختر الموظف أولاً.'); return; }
        const r = await api('GET', `/api/hr/appraisals/attendance?userId=${uid}&from=${encodeURIComponent(val('ha-from'))}&to=${encodeURIComponent(val('ha-to'))}`);
        $('hb-att').textContent = r.pct == null ? 'لا أيام عمل في الفترة.' : `حضر ${r.presentDays} من ${r.workDays} يوم عمل (${r.pct}%)، وإجازات ${r.leaveDays} يوم. التقدير المقترح: ${r.suggested}.`;
        const s = document.querySelector('.hb-sc[data-k="attendance"]'); if (s && r.suggested) { s.value = String(r.suggested); recompute(); }
      }
      else if (a === 'ap-save') {
        const body = { ...collect(), submit: b.dataset.submit === '1' };
        if (id) await api('PUT', `/api/hr/appraisals/${id}`, body); else await api('POST', '/api/hr/appraisals', body);
        closeModal(); await refreshList(); toast(body.submit ? 'أُرسل التقييم للاعتماد' : 'حُفظت المسودة');
      }
      else if (a === 'ap-view') { const r = await api('GET', `/api/hr/appraisals/${id}`); if (!B.tpl && canEval()) B.tpl = await api('GET', '/api/hr/appraisals/template'); modal(`تقييم ${r.appraisal.employeeName}`, viewHtml(r.appraisal, false), true); }
      else if (a === 'ap-approve') { if (!confirm('اعتماد هذا التقييم؟ يُبلَّغ الموظف ولا يُعدَّل بعدها.')) return; await api('POST', `/api/hr/appraisals/${id}/approve`, {}); await refreshList(); toast('اعتُمد التقييم وأُبلغ الموظف'); }
      else if (a === 'ap-return') { const note = prompt('سبب إعادة التقييم للمقيّم:'); if (!note) return; await api('POST', `/api/hr/appraisals/${id}/return`, { note }); await refreshList(); toast('أُعيد التقييم للمقيّم'); }
      else if (a === 'my-view') { const x = B.mine.find((m) => m.id === id); modal(`تقييم أدائي: ${x.periodLabel}`, viewHtml(x, true), true); }
      else if (a === 'ap-ack') {
        await api('POST', `/api/hr/my-appraisals/${id}/acknowledge`, { comment: val('ha-mycom') });
        closeModal(); toast('سُجّل اطلاعك على التقييم'); const el = $('hb-mine'); if (el) el.innerHTML = await mineHtml();
      }
    } catch (err) { toast(err.message || 'تعذّر تنفيذ الإجراء'); }
  });
})();
