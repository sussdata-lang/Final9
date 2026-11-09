/* طباعة المستندات الرسمية (السندات والنماذج والقسائم والتقارير) على ورقة A4 بترويسة الجامعة.
   - الترويسة تُقرأ من «هوية الموقع» لحظة الطباعة، فأي تعديل في الإعدادات يظهر في المطبوع فوراً.
   - المستند يُبنى من محتوى الشاشة الحي (البطاقة أو النافذة التي فيها زر الطباعة)، فيطابق آخر البيانات.
   - يُطبع في طبقة مستقلة (#a4root) تُخفي ما سواها، فلا يتأثر بموضع التمرير أو بالنوافذ المنبثقة.
   سمات اختيارية على البطاقة: data-doc-title، data-doc-no، data-doc-dept، data-doc-date،
   data-doc-signers="المحاسب:الاسم|المدقق المالي|المدير المالي" (الاسم بعد النقطتين اختياري). */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEF = {
    country: 'الجمهورية العربية السورية', ministry: 'وزارة الداخلية', university: 'الجامعة السورية للعلوم الأمنية',
    countryEn: 'SYRIAN ARAB REPUBLIC', ministryEn: 'MINISTRY OF INTERIOR', universityEn: 'Syrian University for Security Sciences',
  };
  let cached = null;

  async function site() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json();
      if (j && j.site) cached = j.site;
    } catch { /* بلا اتصال: آخر قيمة معروفة ثم الافتراضي */ }
    const s = cached || {};
    const pick = (k) => (s[k] === undefined || s[k] === null ? DEF[k] : s[k]);
    return { country: pick('country'), ministry: pick('ministry'), university: s.university || DEF.university, countryEn: pick('countryEn'), ministryEn: pick('ministryEn'), universityEn: pick('universityEn') };
  }

  const lines = (arr, tag) => arr.filter(Boolean).map((x, i) => `<${tag} class="l${i}">${esc(x)}</${tag}>`).join('');
  UA.letterheadHtml = (s) => `<header class="a4-head">
      <div class="a4-ar">${lines([s.country, s.ministry, s.university], 'div')}</div>
      <div class="a4-crest"><img src="/brand/crest.svg" alt=""></div>
      <div class="a4-en" dir="ltr">${lines([s.countryEn, s.ministryEn, s.universityEn], 'div')}</div>
    </header><div class="a4-rule"></div>`;

  // ترويسة فورية للوثائق المعروضة على الشاشة: من هوية الموقع المحمّلة مع الحساب (UA.S.site)
  UA.letterheadSync = (over = {}) => {
    const s = { ...((UA.S && UA.S.site) || {}), ...(cached || {}) };
    const pick = (k) => (s[k] === undefined || s[k] === null ? DEF[k] : s[k]);
    return UA.letterheadHtml({ country: pick('country'), ministry: pick('ministry'), university: over.university || s.university || DEF.university, countryEn: pick('countryEn'), ministryEn: pick('ministryEn'), universityEn: pick('universityEn') });
  };
  const today = () => {
    try { return new Date().toLocaleDateString('ar-SY-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return new Date().toISOString().slice(0, 10); }
  };
  const now = () => {
    try { return new Date().toLocaleString('ar-SY-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
  };
  const curSection = () => {
    const b = document.querySelector('.sx-nav > button[aria-current="page"] span');
    return b ? b.textContent.trim() : '';
  };
  const NO_RE = /\b[A-Z]{2,5}-\d{4}-\d{2,}\b/;

  /* ينظّف نسخة المحتوى للطباعة: الحقول تصير قيماً مكتوبة، والأزرار والعناصر التفاعلية تُحذف */
  function cleanClone(el) {
    const c = el.cloneNode(true);
    const srcFields = el.querySelectorAll('input, select, textarea');
    c.querySelectorAll('input, select, textarea').forEach((f, i) => {
      const src = srcFields[i] || f;
      const span = document.createElement('span');
      span.className = 'a4-field';
      if (f.tagName === 'SELECT') span.textContent = src.selectedOptions && src.selectedOptions[0] ? src.selectedOptions[0].textContent.trim() : '';
      else if (f.type === 'checkbox' || f.type === 'radio') { span.textContent = src.checked ? '☑' : '☐'; span.className = 'a4-check'; }
      else if (['hidden', 'file', 'submit', 'button'].includes(f.type)) { f.remove(); return; }
      else span.textContent = src.value || '';
      if (!span.textContent && span.className === 'a4-field') span.innerHTML = '&nbsp;';
      f.replaceWith(span);
    });
    c.querySelectorAll('.no-print, .row-end, .actions, button, .btn, script, dialog, .sx-acts-menu, [data-print-skip], .ux-face, .ux-tab-marker, .ux-row-tools').forEach((x) => x.remove());
    c.querySelectorAll('[style*="max-height"], [style*="overflow"]').forEach((x) => { x.style.maxHeight = 'none'; x.style.overflow = 'visible'; });
    // عمود زر الطباعة نفسه لا مكان له في الورقة
    c.querySelectorAll('table').forEach((t) => {
      const hr = t.tHead && t.tHead.rows[0]; if (!hr) return;
      [...hr.cells].map((h, i) => (h.textContent.trim() === 'طباعة' ? i : -1)).filter((i) => i >= 0).reverse().forEach((i) => { [...t.rows].forEach((r) => { if (r.cells.length === hr.cells.length) r.deleteCell(i); }); });
    });
    c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    // الخلايا الرقمية والمبالغ لا تنكسر (كي لا ينزل «ل.س» أو جزء من الرقم إلى سطر آخر)
    c.querySelectorAll('td, th').forEach((x) => { if (/^[\s\d,.\-+%٫٬]+(\s*ل\.س)?$/.test(x.textContent.trim())) x.classList.add('a4-num'); });
    return c;
  }

  /* يستخرج من البطاقة عنوانها ورقمها ويحذف العنوان من المتن كي لا يتكرر */
  function describe(el, body) {
    const d = el.dataset || {};
    const h = body.querySelector('h1, h2, h3');
    const title = d.docTitle || (h ? h.textContent.replace(/[\u{1F300}-\u{1FAFF}☀-➿️]/gu, '').replace(/\s+/g, ' ').trim() : '') || document.title;
    // العنوان الأول في رأس البطاقة ينتقل إلى شريط العنوان فيُحذف من المتن (ومعه شارة الحالة المجاورة له)
    const isLead = h && [...body.querySelectorAll('*')].indexOf(h) < 6;
    if (h && !('docKeephead' in d) && (!d.docTitle || isLead)) { const wrap = h.parentElement && h.parentElement !== body && h.parentElement.children.length <= 2 && h.parentElement.classList.contains('spread') ? h.parentElement : h; wrap.remove(); }
    // رقم المستند من عنوانه أو من نصه خارج الجداول، لا من أول صف في تقرير
    const noTbl = body.cloneNode(true); noTbl.querySelectorAll('table').forEach((x) => x.remove());
    const m = (d.docNo ? [d.docNo] : null) || title.match(NO_RE) || noTbl.textContent.match(NO_RE);
    return { title: title.replace(NO_RE, '').replace(/\s*رقم\s*$/, '').trim() || title, no: m ? m[0] : '' };
  }

  function signersHtml(list) {
    return `<section class="a4-sign" style="grid-template-columns:repeat(${list.length},1fr)">${list.map(([role, name]) => `<div class="a4-sig">
        <div class="a4-sig-role">${esc(role)}</div>
        <div class="a4-sig-row"><span>الاسم:</span><b>${name ? esc(name) : ''}</b></div>
        <div class="a4-sig-row"><span>التوقيع:</span><b></b></div>
        <div class="a4-sig-row"><span>التاريخ:</span><b></b></div>
      </div>`).join('')}</section>`;
  }

  /* إطار الصفحة المعتمد بأبعاد الورقة؛ يُرسم بالاتجاهين لأن قلب الورقة يتقرر بعد قياس الجداول */
  function frameSvg(W, H, cls) {
    const c = 10, a = 8.2, b = 11.6, x = W - a, y = H - a, u = W - b, v = H - b, G = '#0A5A4D', L = '#BFD0C9', A = '#C9A24B';
    const cn = (d) => `<path fill="${G}" d="${d}"/>`, ac = (d) => `<path fill="none" stroke="${A}" stroke-width=".45" d="${d}"/>`;
    return `<svg class="a4-frame ${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect x="9" y="9" width="${W - 18}" height="${H - 18}" fill="none" stroke="${G}" stroke-width="1.5"/><rect x="${b}" y="${b}" width="${W - 2 * b}" height="${H - 2 * b}" fill="none" stroke="${L}" stroke-width=".3"/>`
      + cn(`M${a} ${a}H${a + c}A${c} ${c} 0 0 1 ${a} ${a + c}Z`) + cn(`M${x} ${a}H${x - c}A${c} ${c} 0 0 0 ${x} ${a + c}Z`) + cn(`M${a} ${y}H${a + c}A${c} ${c} 0 0 0 ${a} ${y - c}Z`) + cn(`M${x} ${y}H${x - c}A${c} ${c} 0 0 1 ${x} ${y - c}Z`)
      + ac(`M${b + c} ${b}A${c} ${c} 0 0 1 ${b} ${b + c}`) + ac(`M${u - c} ${b}A${c} ${c} 0 0 0 ${u} ${b + c}`) + ac(`M${b + c} ${v}A${c} ${c} 0 0 0 ${b} ${v - c}`) + ac(`M${u - c} ${v}A${c} ${c} 0 0 1 ${u} ${v - c}`) + '</svg>';
  }

  const parseSigners = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(':'); return i < 0 ? [x, ''] : [x.slice(0, i).trim(), x.slice(i + 1).trim()]; });

  /* الدالة العامة: تبني المستند وتطبعه */
  UA.printDoc = async function (o = {}) {
    const s = await site();
    const me = (UA.S && UA.S.me) || {};
    const dept = o.dept || curSection() || s.department || '';
    const signers = (o.signers && o.signers.length ? o.signers : [['المُعِدّ', me.name || ''], ['المدقّق', ''], ['المعتمد / رئيس القسم', '']]);
    const meta = [['القسم', dept], ['التاريخ', o.date || today()], ...(o.no ? [['الرقم / المرجع', o.no]] : []), ...(o.status ? [['الحالة', o.status]] : [])];
    let root = document.getElementById('a4root');
    if (!root) { root = document.createElement('div'); root.id = 'a4root'; document.body.appendChild(root); }
    root.setAttribute('dir', 'rtl');
    root.className = o.landscape ? 'a4-land' : '';
    // الإطار والزخرفة والعلامة المائية ثابتة الموضع فتتكرر في كل صفحة مطبوعة
    root.innerHTML = `${frameSvg(210, 297, 'p')}${frameSvg(297, 210, 'l')}<img class="a4-orn" src="/brand/form-ornament.svg" alt="" aria-hidden="true"><img class="a4-wm" src="/brand/crest.svg" alt="" aria-hidden="true">
      <table class="a4-page" role="presentation"><thead><tr><td><div class="a4-sp-t"></div></td></tr></thead><tfoot><tr><td><div class="a4-sp-b"></div></td></tr></tfoot><tbody><tr><td>
      <article class="a4-doc">
        ${UA.letterheadHtml(s)}
        <div class="a4-title-wrap"><h1 class="a4-title">${esc(o.title || '')}</h1></div>
        <table class="a4-meta"><tr>${meta.map(([k, v]) => `<th>${esc(k)}</th><td${k === 'الرقم / المرجع' ? ' style="white-space:nowrap"' : ''}>${esc(v)}</td>`).join('')}</tr></table>
        <main class="a4-body"></main>
        ${o.noSign ? '' : signersHtml(signers)}
        <footer class="a4-foot"><span>${esc(s.university)}</span><span>طُبع بواسطة: ${esc(me.name || '—')} · ${esc(now())}</span></footer>
      </article></td></tr></tbody></table>`;
    const main = root.querySelector('.a4-body');
    if (o.node) main.appendChild(o.node); else main.innerHTML = o.html || '';
    // الجدول العريض (9 أعمدة فأكثر) يُطبع على ورقة أفقية كي لا يخرج عن الهامش
    if ([...main.querySelectorAll('table')].some((t) => t.rows[0] && [...t.rows[0].cells].reduce((n, c) => n + (c.colSpan || 1), 0) >= 9)) root.classList.add('a4-land');
    // الجداول ذات 12 عموداً فأكثر: حذف الخانتين العشريتين الصفريتين فقط (بلا تغيير في القيمة) كي تتسع للورقة
    main.querySelectorAll('table').forEach((t) => {
      if (!t.rows[0] || t.rows[0].cells.length < 12) return;
      t.classList.add('a4-dense');
      t.querySelectorAll('td, th').forEach((c) => { if (c.children.length === 0 && /^[\d,]+\.00$/.test(c.textContent.trim())) c.textContent = c.textContent.trim().slice(0, -3); });
    });
    // قياس فعلي قبل الطباعة: جدول يتجاوز عرض الورقة يُصغَّر خطه، فإن لم يكفِ تُقلب الورقة بالعرض
    const portraitWide = () => { const w = main.getBoundingClientRect().width; return [...main.querySelectorAll('table')].some((t) => t.getBoundingClientRect().width > w + 1 || t.scrollWidth > w + 1); };
    if (!root.classList.contains('a4-land') && !o.landscape) {
      root.style.cssText = 'display:block;position:absolute;visibility:hidden;left:-9999px;top:0;width:210mm';
      if (portraitWide()) { main.classList.add('a4-tight'); if (portraitWide()) { main.classList.remove('a4-tight'); root.classList.add('a4-land'); } }
      root.removeAttribute('style');
    }
    // ننتظر الشعار والزخرفة وخط الترويسة كي لا تخرج الورقة دونها
    await Promise.all([...root.querySelectorAll('img')].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 2500); }))));
    try { await Promise.race([document.fonts.load('16pt Mohanad', 'ج'), new Promise((r) => setTimeout(r, 2500))]); } catch { /* نطبع بالخط البديل */ }
    // اتجاه الورقة: قاعدة عامة تُضاف عند الطباعة لأن المتصفح لا يطبق الصفحة المسماة على الورقة الأولى. الهامش صفر ليظهر الإطار كاملاً، والفراغ في كل صفحة من رأس .a4-page وذيله
    const pg = document.getElementById('a4page') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'a4page' }));
    pg.textContent = root.classList.contains('a4-land') ? '@page{size:A4 landscape;margin:0}' : '@page{size:A4 portrait;margin:0}';
    document.body.classList.add('print-a4');
    const done = () => { document.body.classList.remove('print-a4'); root.innerHTML = ''; pg.textContent = ''; };
    window.addEventListener('afterprint', done, { once: true });
    setTimeout(() => { try { window.print(); } catch { done(); } }, 60);
  };

  /* ===== نموذج الطلب الموحّد: كل الطلبات (طلبات الطلاب والطلبات الداخلية للموظفين) بالشكل نفسه =====
     يُجلب الطلب من الخادم لحظة الطباعة فيحمل آخر حالة وآخر إجراء، وأسماء الحقول من تعريف الخدمة. */
  const REQ_ST = { review: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', draft: 'مسودة', cancelled: 'ملغى', forwarded: 'محال', pending: 'قيد المعالجة' };
  const fmtAt = (t) => { if (!t) return '—'; try { return new Date(t).toLocaleString('ar-SY-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return new Date(t).toISOString().slice(0, 16).replace('T', ' '); } };
  const kv = (rows) => `<table class="a4-kv"><tbody>${rows.filter((x) => x && x[1] !== undefined && x[1] !== null && x[1] !== '').map(([k, v, raw]) => `<tr><th>${esc(k)}</th><td>${raw ? v : esc(v)}</td></tr>`).join('')}</tbody></table>`;
  // جدول بعمودين متجاورين (حقل/قيمة × 2) لتتسع بيانات النموذج في ورقة واحدة
  const kv2 = (rows) => { const r = rows.filter((x) => x && x[1] !== undefined && x[1] !== null && x[1] !== ''); let h = ''; for (let i = 0; i < r.length; i += 2) { const b = r[i + 1]; h += `<tr><th>${esc(r[i][0])}</th><td${b ? '' : ' colspan="3"'}>${esc(r[i][1])}</td>${b ? `<th>${esc(b[0])}</th><td>${esc(b[1])}</td>` : ''}</tr>`; } return `<table class="a4-kv a4-kv2"><tbody>${h}</tbody></table>`; };
  async function services() {
    const have = (UA.S && UA.S.services) || [];
    if (have.length && have.some((s) => s.fields)) return have;
    try { const r = await fetch('/api/services', { credentials: 'same-origin' }); return (await r.json()).services || []; } catch { return have; }
  }
  const fieldValue = (f, v) => {
    if (v === true) return 'نعم'; if (v === false) return 'لا';
    if (f && Array.isArray(f.options)) { const o = f.options.find((x) => (x && typeof x === 'object' ? String(x.value) : String(x)) === String(v)); if (o && typeof o === 'object') return o.label || o.value; }
    return Array.isArray(v) ? v.join('، ') : String(v);
  };
  // تسميات احتياطية لحقول لا يحمل تعريف خدمتها تسمية
  const FIELD_AR = { reason: 'السبب', justification: 'المبررات', note: 'ملاحظات', notes: 'ملاحظات', details: 'التفاصيل', phone: 'رقم الهاتف', email: 'البريد الإلكتروني', date: 'التاريخ', from: 'من تاريخ', to: 'إلى تاريخ', course: 'المقرر', courses: 'المقررات', semester: 'الفصل', year: 'العام الدراسي', amount: 'المبلغ', purpose: 'الغرض', copies: 'عدد النسخ', language: 'اللغة', recipient: 'الجهة الموجّه إليها', address: 'العنوان', subject: 'الموضوع', type: 'النوع', days: 'عدد الأيام', employeeNo: 'الرقم الوظيفي', department: 'القسم' };
  UA.printRequest = async function (id) {
    let r = null;
    try { const q = await fetch(`/api/requests/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' }); if (q.ok) r = (await q.json()).request; } catch { /* نعود لنسخة الشاشة */ }
    if (!r) r = ((UA.S && UA.S.requests) || []).find((x) => String(x.id) === String(id));
    if (!r) { if (UA.toast) UA.toast('تعذّر تحميل الطلب للطباعة.'); return; }
    const svc = (await services()).find((s) => s.code === (r.service || {}).code) || { fields: [] };
    // الطالب حين يطبع طلبه لا يرسل الخادم بياناته مع الطلب: نأخذها من حسابه
    const me = (UA.S && UA.S.me) || {};
    const who = (r.student && r.student.name) ? r.student : { name: me.name, studentNo: me.studentNo || me.username, kind: me.role === 'student' ? 'student' : 'staff', unit: me.program || (me.unit && me.unit.name) || me.faculty };
    const isStaff = who.kind && who.kind !== 'student';
    const details = Object.entries(r.details || {}).map(([k, v]) => { const f = (svc.fields || []).find((x) => x.name === k); return [f ? f.label : (FIELD_AR[k] || k), fieldValue(f, v)]; });
    const atts = r.attachments && r.attachments.length ? r.attachments : (r.attachment ? [r.attachment] : []);
    const status = REQ_ST[r.status] || r.status;
    const decision = r.status === 'rejected' ? `مرفوض${r.rejectedBy === 'auto' ? ' (بالفحص الآلي)' : ''} — السبب: ${r.rejectReason || '—'}`
      : r.status === 'approved' ? `معتمد${r.document ? ` — صدرت الوثيقة برمز التحقق ${r.document.code}` : ''}` : 'لم يصدر قرار بعد';
    const decider = [...(r.events || [])].reverse().find((e) => /اعتماد|رفض/.test(e.text || '') && e.actor && e.actor !== 'النظام');
    const html = `
      <div class="a4-compact"><h3>أولاً: بيانات مقدّم الطلب</h3>
      ${kv2([['الاسم الكامل', who.name], [isStaff ? 'الرقم الوظيفي' : 'الرقم الجامعي', who.studentNo || who.employeeNo], ['الصفة', isStaff ? 'موظف' : 'طالب'], ['الجهة / الوحدة', who.unit || who.program || who.faculty]])}
      <h3>ثانياً: بيانات الطلب</h3>
      ${kv2([['رقم الطلب', r.no], ['نوع الخدمة', (r.service || {}).label], ['تاريخ التقديم', fmtAt(r.createdAt)], ['الجهة المختصة الحالية', r.unit ? r.unit.name : 'غير محال'], ['مدة الإنجاز المعتمدة', (r.service || {}).sla_hours ? `${r.service.sla_hours} ساعة` : ''], ['حالة الطلب', status], ['تاريخ القرار', r.decidedAt ? fmtAt(r.decidedAt) : '']])}
      <h3>ثالثاً: تفاصيل الطلب</h3>
      ${details.length ? kv(details) : '<p>لا توجد حقول إضافية لهذا النموذج.</p>'}
      ${atts.length ? `<h3>رابعاً: المرفقات</h3>${kv(atts.map((a, i) => [`مرفق ${i + 1}`, `${a.name}${a.size ? ` (${Math.max(1, Math.round(a.size / 1024))} ك.ب)` : ''}`]))}` : ''}
      <h3>${atts.length ? 'خامساً' : 'رابعاً'}: القرار</h3>
      ${kv([['القرار', decision]])}</div>`;
    return UA.printDoc({
      title: `نموذج ${(r.service || {}).label || 'طلب'}`, no: r.no, status,
      dept: r.unit ? r.unit.name : (isStaff ? 'الشؤون الإدارية' : 'شؤون الطلاب'),
      signers: [['مقدّم الطلب', who.name || ''], ['الموظف المختص', decider ? decider.actor : ''], ['رئيس القسم / المعتمد', '']],
      html,
    });
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-act="reqprint"]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    UA.printRequest(b.dataset.id);
  }, true);

  /* الوثائق المصممة كاملة (الإفادات وكشف العلامات): تُنقل نسختها إلى الطبقة المستقلة كما هي دون ترويسة إضافية.
     الطباعة من داخل النافذة المنبثقة كانت تُخرج ورقة بيضاء. */
  UA.printSheet = async function (sheet) {
    if (!sheet) return;
    let root = document.getElementById('a4root');
    if (!root) { root = document.createElement('div'); root.id = 'a4root'; document.body.appendChild(root); }
    root.setAttribute('dir', 'rtl');
    root.className = sheet.querySelector('.trp') ? 'a4-bare a4-zero' : 'a4-bare';
    root.innerHTML = '';
    [...sheet.children].filter((x) => !x.classList.contains('no-print')).forEach((x) => root.appendChild(x.cloneNode(true)));
    await Promise.all([...root.querySelectorAll('img')].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 2500); }))));
    document.body.classList.add('print-a4');
    const done = () => { document.body.classList.remove('print-a4'); root.innerHTML = ''; root.className = ''; };
    window.addEventListener('afterprint', done, { once: true });
    setTimeout(() => { try { window.print(); } catch { done(); } }, 60);
  };

  /* زر طباعة لصف جدول: يبني نموذج A4 من أعمدة الصف وعناوينها، فيطابق الشاشة ويتحدث بتحديثها */
  UA.rowPrintBtn = (title, dept, signers) => `<button type="button" class="btn sm no-print" data-act="rowform" data-doc-title="${esc(title)}" data-doc-dept="${esc(dept)}" data-doc-signers="${esc(signers)}">طباعة</button>`;
  const cellText = (cell) => {
    const c = cleanClone(cell);
    const parts = c.querySelectorAll('.badge, .pill');
    if (parts.length > 1) parts.forEach((x, i) => { if (i < parts.length - 1) x.after('، '); });
    c.querySelectorAll('div, br').forEach((x) => x.before(' · '));
    return c.textContent.replace(/[↕▲▼]/g, '').replace(/\s+/g, ' ').replace(/^[\s·]+|[\s·]+$/g, '').trim();
  };
  UA.printRow = function (btn) {
    const tr = btn.closest('tr'), table = tr && tr.closest('table');
    if (!table || !table.tHead) return;
    const heads = [...table.tHead.rows[0].cells].map(cellText);
    const rows = [...tr.cells].map((td, i) => [heads[i], cellText(td)]).filter(([k, v]) => k && v && !/^(إجراء|طباعة|قسيمة)/.test(k));
    const d = btn.dataset;
    // رقم المستند من عمود «رقم/رمز» الخاص به، لا الرقم الجامعي أو الوظيفي
    const noRow = rows.find(([k, v]) => /رقم|رمز/.test(k) && !/جامعي|وظيف|الموظف|الطالب/.test(k) && v !== '—');
    return UA.printDoc({ title: d.docTitle, no: noRow ? noRow[1].split(' ')[0] : '', dept: d.docDept, signers: parseSigners(d.docSigners), html: `<div class="a4-compact${rows.length <= 12 ? ' a4-roomy' : ''}">${kv(rows)}</div>` });
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-act="rowform"], [data-act="elprint"]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.act === 'rowform') UA.printRow(b); else UA.printElement(document.querySelector(b.dataset.sel));
  }, true);

  /* طباعة بطاقة أو نافذة من الشاشة كما هي ببياناتها الحالية */
  UA.printElement = function (el, extra = {}) {
    if (!el) return;
    const SEL = '[data-doc-title], [data-doc-signers], [data-doc-no], [data-doc-orient], [data-doc-nosign]';
    const metaEl = (extra.metaFrom && extra.metaFrom.querySelector(SEL)) || (el.matches(SEL) ? el : (el.querySelector(SEL) || el));
    const body = cleanClone(el);
    const { title, no } = describe(metaEl, body);
    const d = metaEl.dataset || {};
    return UA.printDoc({
      title: extra.title || title, no: extra.no || no,
      dept: extra.dept || d.docDept, date: extra.date || d.docDate, status: extra.status || d.docStatus, landscape: extra.landscape || d.docOrient === 'landscape', noSign: 'docNosign' in d,
      signers: extra.signers || (d.docSigners ? parseSigners(d.docSigners) : null),
      node: body,
    });
  };
})();
