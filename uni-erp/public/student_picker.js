/* منتقي الطلاب الموحَّد: كل حقل «الرقم الجامعي» يقترح «الرقم — الاسم» من قاعدة الطلاب بدل القائمة العامة المختلطة
   (أسماء + أرقام طلبات + مقررات). يعمل بالتفويض عند التركيز، فيصمد أمام إعادة رسم الواجهة (لا يعتمد على MutationObserver).
   لإضافته لأي حقل مستقبلاً: أضف السمة data-student-picker، ولعرض الاسم المختار في مكان محدد: data-student-name="<id العنصر>". */
(function () {
  'use strict';
  const DL_ID = 'ua-student-picker-dl';
  const NO_RE = /[A-Za-z]{2,6}-\d{4}-\d{3,5}/;
  const cache = new Map();            // استعلام ← نتائج
  let timer = null, seq = 0;

  const isStudentNoField = (el) => {
    if (!el || el.tagName !== 'INPUT' || el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') return false;
    if (el.hasAttribute('data-student-picker')) return true;
    if (el.hasAttribute('data-no-student-picker')) return false;
    const id = (el.id || '') + ' ' + (el.name || '');
    if (/(^|[-_ ])(h-no|stno|student[-_]?no|studentno|sno)([-_ ]|$)/i.test(id)) return true;
    if (NO_RE.test(el.placeholder || '')) return true;
    const lab = el.closest('label');
    return !!(lab && /الرقم الجامعي|رقم الطالب/.test(lab.firstChild ? lab.textContent.slice(0, 60) : ''));
  };

  const dl = () => {
    let d = document.getElementById(DL_ID);
    if (!d) { d = document.createElement('datalist'); d.id = DL_ID; document.body.appendChild(d); }
    return d;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paint = (rows) => {
    const html = rows.map((s) => `<option value="${esc(s.studentNo)}" label="${esc(s.studentNo)} — ${esc(s.name)}">${esc(s.name)}</option>`).join(''), d = dl();
    if (d.dataset.sig !== html) { d.dataset.sig = html; d.innerHTML = html; }   // لا نعيد الكتابة دون تغيّر كي لا تُغلق القائمة المفتوحة
  };

  async function search(q) {
    q = q.trim();
    if (cache.has(q)) return cache.get(q);
    const r = await fetch('/api/students?' + new URLSearchParams({ q, limit: '15' }), { credentials: 'same-origin' });
    if (!r.ok) return [];
    const rows = ((await r.json()).students || []).filter((s) => s.studentNo);
    if (cache.size > 60) cache.clear();
    cache.set(q, rows);
    return rows;
  }

  function nameBox(el) {
    const target = el.dataset.studentName && document.getElementById(el.dataset.studentName);
    if (target) return target;
    let b = el.parentElement && el.parentElement.querySelector('.sp-name');
    if (!b) { b = document.createElement('small'); b.className = 'sp-name'; b.style.cssText = 'display:block;margin-top:3px;color:var(--muted,#64748b);font-weight:600'; el.insertAdjacentElement('afterend', b); }
    return b;
  }
  const setName = (el, text) => { const b = nameBox(el); if ('value' in b && b.tagName === 'INPUT') b.value = text; else b.textContent = text ? '👤 ' + text : ''; };

  function attach(el) {
    if (el.getAttribute('list') !== DL_ID) el.setAttribute('list', DL_ID);
    el.setAttribute('autocomplete', 'off');
    el.dataset.spBound = '1';
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!isStudentNoField(el)) return;
    attach(el);
    if (!el.value) search('').then(paint).catch(() => {});
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!isStudentNoField(el)) return;
    attach(el);
    const mine = ++seq, q = el.value;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { const rows = await search(q); if (mine === seq) paint(rows); } catch { /* الاقتراحات اختيارية؛ الفشل لا يمنع الإدخال اليدوي */ }
    }, 200);
  });

  // التعبئة التلقائية: عند اختيار رقم جامعي أو لصقه نعرض اسم الطالب للتأكد قبل الحفظ، ونطلق حدثاً يستفيد منه أي نموذج
  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (!isStudentNoField(el)) return;
    const v = el.value.trim();
    if (!v) { setName(el, ''); return; }
    try {
      const rows = await search(v);
      const hit = rows.find((s) => String(s.studentNo).toLowerCase() === v.toLowerCase());
      if (hit) {
        el.value = hit.studentNo;
        setName(el, hit.name);
        el.dispatchEvent(new CustomEvent('ua:student-picked', { bubbles: true, detail: hit }));
      } else setName(el, '⚠️ لا يوجد طالب بهذا الرقم');
    } catch { /* تجاهل */ }
  });
})();
