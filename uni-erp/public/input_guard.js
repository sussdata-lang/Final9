/* تقييد الإدخال في كل الأقسام (المرحلة 5)
   طبقة عامة تعمل على كل حقل يظهر في الواجهة دون تعديل كل شاشة على حدة:
   - تتعرف على نوع الحقل من اسمه/معرّفه ونص التسمية المحيطة به (هاتف، بريد، رقم وطني، مبلغ، نسبة، عدد، سنة، اسم شخص...).
   - تضبط له لوحة المفاتيح المناسبة (inputmode) والنمط (pattern) والطول الأقصى، وتمنع كتابة المحارف غير المسموحة لحظة الكتابة،
     وتحوّل الأرقام الهندية (٠-٩) إلى أرقام لاتينية.
   - تعرض «قيمة وهمية» مثالاً داخل الحقل الفارغ (placeholder) إن لم تكن للحقل قيمة مثال.
   - تمنع زر الحفظ/الإضافة/الإرسال من العمل ما دام في نافذته حقل مملوء بصيغة خاطئة، وتُبرز الحقل برسالة واضحة.
   الخادم يتحقق أيضاً من حقول الهاتف والبريد (server/http.js) فلا يُتجاوز التقييد بطلب مباشر.
   لاستثناء حقل: data-ig="off". */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const AR_DIGITS = /[٠-٩۰-۹]/g;
  const toLatin = (s) => s.replace(AR_DIGITS, (d) => String((d.charCodeAt(0) & 0xF) % 10));
  const SKIP_TYPES = new Set(['checkbox', 'radio', 'file', 'hidden', 'date', 'time', 'month', 'week', 'datetime-local', 'password', 'color', 'range', 'submit', 'button', 'reset', 'image']);

  const labelOf = (el) => {
    const l = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    const t = (l ? l.textContent : '') || el.getAttribute('aria-label') || el.title || '';
    return t.replace(/\s+/g, ' ').replace(/[*:：]/g, '').trim().slice(0, 60);
  };

  /* قواعد مرتبة من الأخص إلى الأعم. k = الاسم/المعرّف بأحرف صغيرة، l = نص التسمية */
  const RULES = [
    { id: 'email', when: (k, l) => /(^|[-_])e?mail$|email/.test(k) || /بريد|إيميل|ايميل/.test(l),
      set: { type: 'email', inputmode: 'email', dir: 'ltr', maxlength: 120, autocomplete: 'email' }, ph: 'name@example.com',
      allow: /[^\s]/g, check: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), msg: 'صيغة البريد غير صحيحة، مثال: name@example.com' },
    { id: 'phone', when: (k, l) => /phone|mobile|(^|[-_])mob$|fax|(^|[-_])tel$/.test(k) || /هاتف|جوال|موبايل|خلوي|فاكس/.test(l),
      set: { inputmode: 'tel', dir: 'ltr', maxlength: 16, autocomplete: 'tel' }, ph: (k, l) => (/fax|فاكس/.test(k + l) ? '0112123456' : '0944123456'),
      allow: /[0-9+]/g, fix: (v) => v.replace(/(?!^)\+/g, ''), check: (v) => /^\+?\d{6,15}$/.test(v), msg: 'رقم الهاتف أرقام فقط (6 إلى 15 رقماً، ويُسمح بـ + في البداية)، مثال: 0944123456' },
    { id: 'nid', when: (k, l) => /(^|[-_])nid$|national[-_]?id/.test(k) || /الرقم الوطني|رقم وطني/.test(l),
      set: { inputmode: 'numeric', dir: 'ltr', maxlength: 11 }, ph: '01020304050',
      allow: /[0-9]/g, check: (v) => /^\d{11}$/.test(v), msg: 'الرقم الوطني 11 رقماً بالضبط، مثال: 01020304050' },
    { id: 'mac', when: (k, l) => /(^|[-_])mac$/.test(k) || /MAC/.test(l), set: { dir: 'ltr', maxlength: 17 }, ph: '00:17:61:AB:CD:EF',
      allow: /[0-9A-Fa-f:-]/g, check: (v) => /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(v), msg: 'عنوان MAC بصيغة 00:17:61:AB:CD:EF' },
    { id: 'ip', when: (k, l) => /(^|[-_])ip$/.test(k) || /عنوان IP|\bIP\b/.test(l), set: { dir: 'ltr', maxlength: 45, inputmode: 'decimal' }, ph: '192.168.1.201',
      allow: /[0-9A-Fa-f.:]/g, check: (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) ? v.split('.').every((n) => +n <= 255) : /^[0-9A-Fa-f:]{2,45}$/.test(v), msg: 'عنوان IP غير صالح، مثال: 192.168.1.201' },
    { id: 'url', when: (k, l) => /url$|(^|[-_])(link|website)$/.test(k) || /رابط|الموقع الإلكتروني/.test(l), set: { type: 'url', inputmode: 'url', dir: 'ltr', maxlength: 500 }, ph: 'https://example.com/…',
      allow: /[^\s]/g, check: (v) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v), msg: 'الرابط يبدأ بـ https:// مثال: https://example.com' },
    { id: 'isbn', when: (k, l) => /isbn/.test(k) || /ISBN|ردمك/.test(l), set: { dir: 'ltr', maxlength: 17, inputmode: 'numeric' }, ph: '978-9953-0-1234-5',
      allow: /[0-9Xx-]/g, check: (v) => [10, 13].includes(v.replace(/-/g, '').length), msg: 'رقم ISBN من 10 أو 13 خانة، مثال: 978-9953-0-1234-5' },
    { id: 'taxno', when: (k, l) => /الرقم الضريبي|رقم ضريبي|السجل التجاري/.test(l), set: { dir: 'ltr', inputmode: 'numeric', maxlength: 20 }, ph: '100200300',
      allow: /[0-9-]/g, check: (v) => /^[\d-]{4,20}$/.test(v), msg: 'الرقم الضريبي أرقام فقط' },
    { id: 'person', when: (k, l) => /(student|applicant|borrower|instructor|supervisor|proctor|sender|full|guardian|mother|father|first|last|contact|person|emp)[-_]?name|(^|[-_])contact$/.test(k)
        || /الاسم الكامل|الاسم الثلاثي|اسم الطالب|اسم المتقدم|اسم الموظف|اسم المشرف|اسم المراقب|اسم المرسل|اسم المستعير|اسم المدرّ?س|اسم الأب|اسم الأم|اسم المسؤول|الشخص المسؤول|جهة الاتصال|اسم المندوب|ولي الأمر/.test(l),
      set: { maxlength: 120, autocomplete: 'name' }, ph: (k, l) => (/first|الاسم الأول/.test(k + l) ? 'مثال: محمد' : /father|اسم الأب/.test(k + l) ? 'مثال: أحمد' : /last|الكنية|اللقب/.test(k + l) ? 'مثال: العلي' : /mother|اسم الأم/.test(k + l) ? 'مثال: سعاد الخطيب' : 'مثال: محمد أحمد العلي'), deny: /[0-9٠-٩<>{}[\]\\/@#$%^*=+_|~`]/g, msg: 'الاسم أحرف فقط بلا أرقام أو رموز' },
  ];

  /* أمثلة الحقول الرقمية (type=number أو حقول نصية تسميتها رقمية) */
  function numberHint(el, k, l) {
    const min = el.getAttribute('min'), max = el.getAttribute('max');
    if (/pct|percent|(^|[-_])rate$|نسبة|٪|%/.test(k + l) && !/cur-|صرف|exchange/.test(k + l)) { if (min === null) el.min = '0'; if (max === null) el.max = '100'; return 'مثال: 15 (من 0 إلى 100)'; }
    if (/(^|[-_])(yr|year)$/.test(k) || /سنة (التخرج|الشهادة|القيد|الإصدار|الحصول|التأسيس|النشر)/.test(l)) { if (min === null) el.min = '1950'; if (max === null) el.max = '2100'; return `مثال: ${new Date().getFullYear()}`; }
    if (/amt|amount|price|cost|salary|base|budget|tui|reg$|fee|housing|transport|value|مبلغ|سعر|كلفة|تكلفة|راتب|رسوم|ميزانية|قيمة|أجر|بدل/.test(k + l)) { if (min === null && !/adj|delta|diff|تسوية|فرق/.test(k + l)) el.min = '0'; return 'مثال: 250000'; }
    if (/mark|score|grade|علامة|درجة|المجموع/.test(k + l)) return max !== null ? `من ${min ?? 0} إلى ${max}` : 'مثال: 85';
    if (/gpa|معدل/.test(k + l)) return max !== null ? `مثال: ${(+max * 0.8).toFixed(2).replace(/\.00$/, '')}` : 'مثال: 3.25';
    if (/port|منفذ/.test(k + l)) { if (min === null) el.min = '1'; if (max === null) el.max = '65535'; return 'مثال: 4370'; }
    if (/qty|count|days|hours|hrs|cap|copies|size|quorum|attempt|files|weeks|num|no$|عدد|كمية|أيام|ساعات|سعة|نسخ|محاولات|نصاب/.test(k + l)) { if (min === null && !/adj|تسوية/.test(k + l)) el.min = '0'; return 'مثال: 10'; }
    if (min !== null && max !== null) return `من ${min} إلى ${max}`;
    if (min !== null) return `${min} فأكثر`;
    return 'أدخل رقماً';
  }

  /* أمثلة وهمية للحقول النصية العامة حسب تسميتها */
  const TEXT_HINTS = [
    [/addr|address|العنوان السكني|عنوان السكن|عنوان التسليم|عنوان المورد|^العنوان$/, 'مثال: دمشق – المزة – شارع الجلاء، بناء 12'],
    [/reason|justif|سبب|مبرر/, 'مثال: ظرف صحي طارئ موثّق بتقرير'],
    [/note|notes|ملاحظ|تعليق|comment/, 'ملاحظة مختصرة (اختياري)'],
    [/subject|الموضوع/, 'مثال: طلب تمديد موعد التسليم'],
    [/(^|[-_])(hall|loc|location|bld)$|قاعة|المكان|الموقع|المبنى/, 'مثال: المبنى A – القاعة 101'],
    [/specialty|domain|التخصص|المجال/, 'مثال: أمن المعلومات'],
    [/job|position|المسمى|الوظيفة|المنصب/, 'مثال: محاسب أول'],
    [/وحدة القياس|(^|[-_])uom$/, 'مثال: قطعة، علبة، كغ'],
    [/(^|[-_])(dept|unit)$|القسم|الجهة|الوحدة|الإدارة/, 'مثال: الشؤون المالية'],
    [/author|المؤلف/, 'مثال: د. سامر الخطيب'],
    [/journal|المجلة/, 'مثال: Journal of Security Studies'],
    [/employer|company|الشركة|جهة العمل/, 'مثال: شركة الاتصالات السورية'],
    [/topic|الموضوع|العنوان البحثي/, 'مثال: تحليل البرمجيات الخبيثة'],
    [/(^|[-_])title$|العنوان|عنوان/, 'مثال: اجتماع مجلس القسم الشهري'],
    [/code|رمز|الكود/, 'مثال: CS-101'],
    [/(^|[-_])(no|ref)$|رقم|المرجع/, 'مثال: REF-2026-0001'],
    [/name|الاسم|اسم/, 'مثال: الاسم كما يظهر في الوثائق'],
  ];

  function guard(el) {
    if (el.dataset.ig || el.disabled) return;
    const tag = el.tagName;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'INPUT' && SKIP_TYPES.has(type)) return;
    if (el.closest('[data-ig="off"], .no-guard')) return;
    const k = `${el.id || ''} ${el.name || ''}`.toLowerCase().trim();
    const l = labelOf(el);
    const isSearch = type === 'search' || /(^|[-_])(q|search|filter)($|[-_])|search/.test(k) || /بحث|ابحث|تصفية/.test(l + (el.placeholder || ''));
    el.dataset.ig = 'on';
    if (isSearch) return;

    if (tag === 'INPUT' && type === 'number') {
      // بلا خطوة محددة: الكسور مسموحة في الحقل (الكميات بالكغ والليتر)، والخادم يرفضها للوحدات الصحيحة
      if (!el.getAttribute('step')) el.step = 'any';
      if (!el.inputMode) el.inputMode = el.step === 'any' || /\./.test(el.step) ? 'decimal' : 'numeric';
      if (!el.placeholder) el.placeholder = numberHint(el, k, l);
      else numberHint(el, k, l);
      el.dataset.igk = 'number';
      return;
    }
    if (tag === 'INPUT' && ['email', 'tel', 'url'].includes(type)) { /* النوع مضبوط مسبقاً: نضيف القاعدة المقابلة فقط */ }

    const rule = tag === 'INPUT' ? RULES.find((r) => r.when(k, l)) : null;
    if (rule) {
      for (const [a, v] of Object.entries(rule.set)) {
        if (a === 'type') { if (type === 'text' || !el.getAttribute('type')) try { el.type = v; } catch { /* نوع غير مدعوم */ } }
        else if (a === 'maxlength') { if (!el.getAttribute('maxlength')) el.maxLength = v; }
        else if (!el.getAttribute(a)) el.setAttribute(a, v);
      }
      if (!el.placeholder) el.placeholder = typeof rule.ph === 'function' ? rule.ph(k, l) : rule.ph;
      el.dataset.igk = rule.id;
      return;
    }
    // حقل نصي تسميته رقمية (عدد/كمية/مبلغ): لوحة أرقام ومنع الأحرف
    if (tag === 'INPUT' && /^(عدد|كمية|المبلغ|مبلغ|السعر|سعر|الكلفة|النسبة)/.test(l)) {
      el.inputMode = 'decimal'; el.setAttribute('dir', 'ltr');
      if (!el.placeholder) el.placeholder = numberHint(el, k, l);
      el.dataset.igk = 'numtext';
      return;
    }
    if (!el.placeholder && !el.readOnly) {
      const hit = TEXT_HINTS.find(([re]) => re.test(k) || re.test(l));
      if (hit) el.placeholder = hit[1];
      else if (l) el.placeholder = `اكتب ${l.replace(/\(?اختياري\)?/g, '').trim()}`;
    }
  }

  const ruleOf = (el) => RULES.find((r) => r.id === el.dataset.igk);
  function sanitize(el) {
    const kind = el.dataset.igk;
    if (!kind) return;
    let v = el.value, nv = v;
    const rule = ruleOf(el);
    if (kind === 'number' || kind === 'numtext') nv = kind === 'numtext' ? toLatin(v).replace(/[^0-9.,-]/g, '') : v;
    else if (rule) {
      if (rule.allow || /[٠-٩۰-۹]/.test(v)) nv = toLatin(v);
      if (rule.allow) nv = (nv.match(rule.allow) || []).join('');
      if (rule.deny) nv = nv.replace(rule.deny, '');
      if (rule.fix) nv = rule.fix(nv);
    }
    if (nv !== v) {
      let pos = null;
      try { pos = el.selectionStart; } catch { /* email/number لا يدعم المؤشر */ }
      el.value = nv;
      if (pos !== null) try { const p = Math.max(0, pos - (v.length - nv.length)); el.setSelectionRange(p, p); } catch { /* لا شيء */ }
      flash(el);
    }
    validate(el, false);
  }

  function validate(el, show) {
    const rule = ruleOf(el);
    const v = String(el.value || '').trim();
    let msg = '';
    if (v && rule && rule.check && !rule.check(v)) msg = rule.msg;
    if (v && el.dataset.igk === 'numtext' && !/^-?[\d,]*\.?\d*$/.test(v)) msg = 'أدخل رقماً فقط';
    try { el.setCustomValidity(msg); } catch { /* لا شيء */ }
    const bad = !!v && !el.checkValidity();
    el.classList.toggle('ig-bad', bad && (show || el.dataset.igTouched === '1'));
    return !bad;
  }

  let flashT = null;
  function flash(el) {
    el.classList.add('ig-blocked');
    clearTimeout(flashT);
    flashT = setTimeout(() => el.classList.remove('ig-blocked'), 450);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input, textarea')) guard(root);
    root.querySelectorAll('input:not([data-ig]), textarea:not([data-ig])').forEach(guard);
  }

  document.addEventListener('input', (e) => { const el = e.target; if (el && el.dataset && el.dataset.ig === 'on') sanitize(el); }, true);
  document.addEventListener('focusin', (e) => { const el = e.target; if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.dataset.ig) guard(el); }, true);
  document.addEventListener('focusout', (e) => { const el = e.target; if (el && el.dataset && el.dataset.igk) { el.dataset.igTouched = '1'; validate(el, true); } }, true);
  // حقول الأرقام: منع e و+ (والسالب إن كان الحد الأدنى صفراً فأكثر)
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'number' || e.ctrlKey || e.metaKey) return;
    if (e.key === 'e' || e.key === 'E' || e.key === '+' || (e.key === '-' && el.min !== '' && +el.min >= 0)) { e.preventDefault(); flash(el); }
  }, true);
  document.addEventListener('paste', (e) => { const el = e.target; if (el && el.dataset && el.dataset.igk) setTimeout(() => sanitize(el), 0); }, true);

  /* زر الحفظ/الإضافة/الإرسال لا يعمل ما دام في نافذته حقل مملوء بصيغة خاطئة */
  const SAVE_RE = /حفظ|احفظ|إضافة|أضف|اضف|سجّل|إرسال|أرسل|ارسل|اعتماد|اعتمد|إنشاء|أنشئ|تأكيد|أكّد|تقديم|قدّم|إصدار|ترحيل|استلام/;
  function blockInvalid(e) {
    const b = e.target.closest && e.target.closest('button, [type="submit"]');
    if (!b || b.disabled || b.closest('[data-ig="off"]')) return;
    const isSubmit = b.type === 'submit' && b.form;
    const bt = (b.textContent || '').trim();
    // زر يضيف صفاً جديداً («+ إضافة …») ليس حفظاً
    if (!isSubmit && (!SAVE_RE.test(bt) || /خروج|إلغاء|إغلاق/.test(bt) || /^[+＋]/.test(bt))) return;
    const box = (isSubmit && b.form) || b.closest('.modal, dialog, form, .card, section, .panel') || document.body;
    const bad = [...box.querySelectorAll('[data-igk]')].filter((el) => el.offsetParent !== null && !validate(el, true));
    if (!bad.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    bad[0].focus();
    try { bad[0].reportValidity(); } catch { /* لا شيء */ }
    const lbl = labelOf(bad[0]);
    if (UA.toast) UA.toast(`تحقق من حقل «${lbl || 'الإدخال'}»: ${bad[0].validationMessage || 'صيغة غير صحيحة'}`);
  }
  document.addEventListener('click', blockInvalid, true);
  document.addEventListener('submit', (e) => {
    const f = e.target;
    const bad = [...f.querySelectorAll('[data-igk]')].filter((el) => !validate(el, true));
    if (bad.length) { e.preventDefault(); e.stopImmediatePropagation(); bad[0].focus(); try { bad[0].reportValidity(); } catch { /* لا شيء */ } }
  }, true);

  let pending = [], queued = false;
  const mo = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) pending.push(n);
    if (!queued && pending.length) { queued = true; queueMicrotask(() => { queued = false; const p = pending; pending = []; p.forEach(scan); }); }
  });
  const start = () => { scan(document.body); mo.observe(document.body, { childList: true, subtree: true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  UA.inputGuard = { scan, guard, validate, RULES };
})();
