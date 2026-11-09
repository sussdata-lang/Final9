/* أنظمة الدراسة: تجديد القيد، والترفيع السنوي، واستنفاد السنوات، والتظلمات. كل حد يأتي من الإعدادات عبر الخادم. */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const B = '/api/student-regulations';
  const toast = (m) => (UA.toast ? UA.toast(m) : window.alert(m));
  const day = (t) => (t ? new Date(Number(t)).toISOString().slice(0, 10) : '—');
  const PEN = { warning: 'إنذار مسلكي', exam_zero: 'إلغاء علامة مقرر', term_suspension: 'حرمان فصل دراسي', dismissal: 'فصل نهائي' };
  const AP = { pending: ['قيد البت', 'p-review'], upheld: ['ثُبّتت العقوبة', 'p-rejected'], reduced: ['خُففت العقوبة', 'p-approved'], cancelled: ['أُلغيت العقوبة', 'p-approved'] };
  const pill = (st) => `<span class="pill ${(AP[st] || ['', 'p-review'])[1]}">${esc((AP[st] || [st])[0])}</span>`;
  const table = (heads, rows, empty) => `<div class="tbl-wrap"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  const card = (title, hint, body) => `<section class="card"><h2>${esc(title)}</h2><p class="hint" style="margin-top:0">${esc(hint)}</p>${body}</section>`;
  const fail = (e) => `<section class="card"><p class="reason">${esc(e && e.message ? e.message : 'تعذر تحميل البيانات.')}</p></section>`;
  const TABS = ['renewal', 'promotion', 'appeals', 'exhaustion'];

  const RENDER = {
    async promotion() {
      const d = await UA.api('GET', `${B}/promotion`), ok = d.rows.filter((r) => r.eligible);
      return card('الترفيع السنوي', `العام ${d.academicYear}. يُرفَّع من يحمل ${d.maxCarried} مقررات على الأكثر. رُفّع هذا العام ${d.promotedThisYear} طالباً.`,
        `<div class="actions" style="margin:0 0 10px"><button class="btn pri" type="button" data-act="reg-promote"${ok.length ? '' : ' disabled'}>ترفيع المستوفين (${ok.length})</button></div>
        ${table(['الرقم الجامعي', 'الطالب', 'السنة الحالية', 'المقررات المحمولة', 'النتيجة'], d.rows.slice(0, 500).map((r) => `<tr><td class="mono">${esc(r.studentNo)}</td><td><b>${esc(r.name)}</b></td><td>${r.level}</td><td>${r.carried}</td><td>${r.eligible ? `<span class="pill p-approved">يُرفَّع إلى السنة ${r.toLevel}</span>` : '<span class="pill p-rejected">يبقى في سنته</span>'}</td></tr>`).join(''), 'لا يوجد طلاب بانتظار الترفيع.')}`);
    },
    async renewal() {
      const d = await UA.api('GET', `${B}/renewals`);
      return card('تجديد القيد السنوي', `العام ${d.academicYear}. جدّد ${d.renewed} من ${d.total}. المهلة: ${d.open || 'غير محددة'} إلى ${d.close || 'غير محددة'}.`,
        table(['الرقم الجامعي', 'الطالب', 'السنة', 'تجديد القيد', ''], d.rows.slice(0, 500).map((r) => `<tr><td class="mono">${esc(r.studentNo)}</td><td><b>${esc(r.name)}</b></td><td>${r.level}</td><td>${r.renewedAt ? `<span class="pill p-approved">${esc(day(r.renewedAt))}${Number(r.late) ? ' (متأخر)' : ''}</span>` : '<span class="pill p-review">لم يجدد</span>'}</td><td>${r.renewedAt ? '' : `<button class="btn sm" type="button" data-act="reg-renew-for" data-id="${r.id}">تجديد</button>`}</td></tr>`).join(''), 'لا يوجد طلاب.'));
    },
    async exhaustion() {
      const d = await UA.api('GET', `${B}/exhaustion`);
      return card('استنفاد سنوات الدراسة', `الحد الأقصى: مدة البرنامج مضافاً إليها ${d.extraPercent}%. يظهر من بقي له ${d.warnYears} سنة أو أقل.`,
        `<div class="actions" style="margin:0 0 10px"><button class="btn" type="button" data-act="reg-notify"${d.rows.length ? '' : ' disabled'}>إرسال التنبيهات (${d.rows.length})</button></div>
        ${table(['الرقم الجامعي', 'الطالب', 'البرنامج', 'سنة الالتحاق', 'المستهلك / الأقصى', 'الوضع'], d.rows.slice(0, 500).map((r) => `<tr><td class="mono">${esc(r.studentNo)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.program)}</td><td>${r.enrollYear}</td><td>${r.usedYears} / ${r.maxYears}</td><td>${r.exhausted ? '<span class="pill p-rejected">مستنفد</span>' : `<span class="pill p-review">بقي ${r.remaining}</span>`}</td></tr>`).join(''), 'لا يوجد طلاب قريبون من الحد الأقصى.')}`);
    },
    async appeals() {
      const d = await UA.api('GET', `${B}/appeals`);
      return card('التظلم من القرارات الانضباطية', 'يقدم الطالب تظلمه من بوابته خلال المهلة المحددة في الإعدادات.',
        table(['رقم التظلم', 'الطالب', 'القرار', 'العقوبة', 'الأسباب', 'الحالة', 'إجراء'], d.appeals.map((a) => `<tr><td class="mono">${esc(a.appeal_no)}</td><td><b>${esc(a.studentName)}</b><div class="small mono">${esc(a.studentNo)}</div></td><td class="mono">${esc(a.decisionNo || '—')}</td><td>${esc(PEN[a.penaltyLevel] || a.penaltyLevel || '—')}</td><td>${esc(a.reason)}${a.decision_note ? `<div class="small">القرار: ${esc(a.decision_note)}</div>` : ''}</td><td>${pill(a.status)}</td><td style="white-space:nowrap">${a.status === 'pending' && d.canDecide ? ['upheld:تثبيت', 'reduced:تخفيف', 'cancelled:إلغاء'].map((x) => { const [k, l] = x.split(':'); return `<button class="btn sm" type="button" data-act="reg-appeal-decide" data-id="${a.id}" data-o="${k}">${l}</button>`; }).join(' ') : ''}</td></tr>`).join(''), 'لا توجد تظلمات.'));
    },
  };

  UA.studentRegs = {
    tabs: TABS,
    placeholder: () => '<div id="reg-mount"><section class="card"><p class="hint">جارٍ التحميل…</p></section></div>',
    async mount(tab) {
      const el = document.getElementById('reg-mount');
      if (!el || !RENDER[tab]) return;
      try { const html = await RENDER[tab](); const cur = document.getElementById('reg-mount'); if (cur) cur.innerHTML = html; } catch (e) { const cur = document.getElementById('reg-mount'); if (cur) cur.innerHTML = fail(e); }
    },
    studentPlaceholder: () => '<div id="reg-student" style="margin-top:16px"></div>',
    async mountStudent() {
      const el = document.getElementById('reg-student');
      if (!el) return;
      try {
        const d = await UA.api('GET', `${B}/me`), r = d.renewal, cur = document.getElementById('reg-student');
        if (!cur) return;
        const appeal = d.decisions.length ? `<article class="sx-panel" style="margin-top:16px"><div class="sx-ph"><div><h2>القرارات الانضباطية والتظلم</h2><p>يقبل التظلم خلال ${d.appealDays} يوماً من تاريخ القرار.</p></div></div><div class="sx-tscroll"><table class="sx-table rsp"><thead><tr><th>القرار</th><th>العقوبة</th><th>آخر موعد</th><th>التظلم</th></tr></thead><tbody>${d.decisions.map((x) => `<tr><td class="mono">${esc(x.decisionNo)}</td><td>${esc(PEN[x.penaltyLevel] || x.penaltyLevel)}</td><td>${esc(day(x.deadline))}</td><td>${x.appealStatus ? pill(x.appealStatus) : (x.canAppeal ? `<button class="btn sm" type="button" data-act="reg-appeal" data-id="${x.holdId}">تقديم تظلم</button>` : '<span class="small">غير متاح</span>')}</td></tr>`).join('')}</tbody></table></div></article>` : '';
        cur.innerHTML = `<article class="sx-panel"><div class="sx-ph"><div><h2>تجديد القيد للعام ${esc(r.academicYear)}</h2><p>${r.renewedAt ? `جُدّد قيدك بتاريخ ${esc(day(r.renewedAt))}.` : (r.blockers.length ? esc(r.blockers.join(' ')) : (r.late ? 'أنت ضمن فترة التجديد المتأخر.' : 'يمكنك تجديد قيدك الآن.'))}</p></div>${!r.renewedAt && !r.blockers.length ? '<button class="btn pri" type="button" data-act="reg-renew">تجديد القيد</button>' : ''}</div></article>${appeal}`;
      } catch { /* الخدمة غير متاحة: لا نعرض اللوحة */ }
    },
  };
  const reload = () => { const t = UA.S && UA.S.stTab; if (UA.S && UA.S.me && UA.S.me.role === 'student') UA.studentRegs.mountStudent(); else UA.studentRegs.mount(t); };
  Object.assign(UA.actions = UA.actions || {}, {
    'reg-promote': async () => { if (!window.confirm('ترفيع جميع الطلاب المستوفين للشرط؟')) return; const r = await UA.api('POST', `${B}/promotion/apply`, {}); toast(`تم ترفيع ${r.promoted} طالباً`); reload(); },
    'reg-renew-for': async (el, d) => { await UA.api('POST', `${B}/renew`, { studentId: Number(d.id) }); toast('تم تجديد القيد'); reload(); },
    'reg-renew': async () => { await UA.api('POST', `${B}/renew`, {}); toast('تم تجديد قيدك'); reload(); },
    'reg-notify': async () => { const r = await UA.api('POST', `${B}/exhaustion/notify`, {}); toast(`أُرسلت التنبيهات إلى ${r.notified} طالباً`); },
    'reg-appeal': async (el, d) => { const reason = await window.askText('تقديم تظلم', { label: 'أسباب التظلم', type: 'textarea', submit: 'إرسال التظلم' }); if (!reason) return; await UA.api('POST', `${B}/appeals`, { holdId: Number(d.id), reason }); toast('تم تقديم التظلم'); reload(); },
    'reg-appeal-decide': async (el, d) => { const note = await window.askText('البت في التظلم', { label: 'مسوغات القرار', type: 'textarea', submit: 'اعتماد القرار' }); if (!note) return; const r = await UA.api('POST', `${B}/appeals/${d.id}/decide`, { outcome: d.o, note }); toast(r.reinstatementNeeded ? 'صدر القرار. قيد الطالب تغيّر سابقاً، فقدّم حركة إعادة قيد.' : 'صدر قرار التظلم'); reload(); },
  });
})();
