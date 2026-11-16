/* تصنيف البيانات وإدارة الموافقات: مرجع حساسية البيانات المحفوظة، ونظرة على موافقات المستخدمين على المعالجة غير الأساسية */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (t) => (t ? new Date(t).toLocaleString('ar-SY', { timeZone: 'Asia/Damascus', dateStyle: 'short', timeStyle: 'short' }) : '');
  const SENS_PILL = { public: '', internal: '', confidential: 'p-review', secret: 'p-rejected' };
  const PC = { purpose: '' };

  const kpi = (label, value, tone) => `<div class="card" style="margin:0;padding:12px 14px;min-width:150px;flex:1">
    <div class="small">${esc(label)}</div><div style="font-size:1.6rem;font-weight:700;${tone ? `color:${tone}` : ''}">${esc(value)}</div></div>`;

  async function html() {
    const [cls, ov] = await Promise.all([UA.api('GET', '/api/privacy/classification'), UA.api('GET', '/api/privacy/consent-overview')]);
    const log = PC.purpose ? await UA.api('GET', `/api/privacy/consent-log?purpose=${encodeURIComponent(PC.purpose)}`) : null;
    return `<section class="card"><h2>تصنيف البيانات الشخصية</h2>
      <p class="hint" style="margin-top:0">مرجع ثابت لما يحفظه النظام من بيانات شخصية، ومستوى حساسيتها، والحماية المطبَّقة عليها فعلياً.</p>
      <div class="tbl-wrap"><table><thead><tr><th>الفئة</th><th>أمثلة</th><th>الحساسية</th><th>الجداول</th><th>الحماية المطبَّقة</th></tr></thead><tbody>
      ${cls.items.map((x) => `<tr><td><b>${esc(x.category)}</b></td><td class="small">${esc(x.examples)}</td><td><span class="pill ${SENS_PILL[x.sensitivity] || ''}">${esc(cls.sensitivity[x.sensitivity] || x.sensitivity)}</span></td><td class="mono small">${esc(x.tables)}</td><td class="small">${esc(x.protection)}</td></tr>`).join('')}
      </tbody></table></div></section>
    <section class="card"><h2>نظرة على الموافقات</h2>
      <p class="hint" style="margin-top:0">موافقة كل مستخدم على معالجة بياناته لأغراض غير أساسية (نشر الصور، المشاركة الخارجية، ...)؛ يديرها هو من قائمة حسابه. الغرض الأساسي اللازم لتقديم الخدمة لا يُسحَب فلا يظهر هنا.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${kpi('إجمالي المستخدمين الفعّالين', ov.totalUsers)}</div>
      <div class="tbl-wrap"><table><thead><tr><th>الغرض</th><th>موافِق</th><th>ساحب</th><th>لم يُسجَّل</th><th></th></tr></thead><tbody>
      ${ov.purposes.map((p) => `<tr><td>${esc(p.label)}</td><td>${p.granted}</td><td>${p.withdrawn ? `<b style="color:#B3261E">${p.withdrawn}</b>` : '0'}</td><td class="small">${p.notRecorded}</td><td><button class="btn sm" type="button" data-act="pcvlog" data-p="${esc(p.code)}" aria-pressed="${PC.purpose === p.code}">سجلّ التغييرات</button></td></tr>`).join('')}
      </tbody></table></div>
      ${log ? `<div class="tbl-wrap" style="margin-top:14px"><h3 style="margin:0 0 8px">سجلّ التغييرات: ${esc((ov.purposes.find((p) => p.code === PC.purpose) || {}).label || '')}</h3><table><thead><tr><th>المستخدم</th><th>القرار</th><th>الوقت</th><th>سجَّله</th><th>ملاحظة</th></tr></thead><tbody>
        ${log.entries.map((e) => `<tr><td>${esc(e.subjectName)}${e.studentNo ? ` <span class="mono small">${esc(e.studentNo)}</span>` : ''}</td><td><span class="pill ${e.granted ? '' : 'p-rejected'}">${e.granted ? 'موافقة' : 'سحب'}</span></td><td class="small">${esc(when(e.recordedAt))}</td><td class="small">${esc(e.recordedByName || '')}</td><td class="small">${esc(e.note || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="small">لا سجل بعد.</td></tr>'}
      </tbody></table></div>` : ''}
      </section>`;
  }

  async function mount() {
    const el = document.getElementById('pc-mount'); if (!el) return;
    try { el.innerHTML = await html(); } catch (e) { el.innerHTML = `<section class="card"><p class="reason">${esc(e.message || 'تعذّر التحميل.')}</p></section>`; }
  }
  UA.privacyCenter = { render() { setTimeout(mount, 0); return '<div id="pc-mount"><section class="card"><p class="hint">جارٍ التحميل…</p></section></div>'; } };

  Object.assign(UA.actions = UA.actions || {}, {
    pcvlog: async (_el, d) => { PC.purpose = PC.purpose === d.p ? '' : d.p; await mount(); },
  });
})();
