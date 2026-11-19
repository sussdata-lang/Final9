/* التقويم الأكاديمي، وإلغاء المحاضرات وتعويضها، والغياب والحرمان: تبويبات في الشؤون الأكاديمية ولوحة في بوابة الطالب */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (UA.toast ? UA.toast(m) : window.alert(m));
  const val = (id) => (document.getElementById(id) || {}).value || '';
  const T = { absenceCourse: '' };
  const table = (heads, rows, empty) => `<div class="tbl-wrap"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="small">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const fail = (e) => `<section class="card"><p class="reason">${esc(e && e.message ? e.message : 'تعذر تحميل البيانات.')}</p></section>`;
  const KIND = { cancel: 'إلغاء', makeup: 'تعويض' };

  const RENDER = {
    async calendar() {
      const d = await UA.api('GET', '/api/teaching/calendar'), manage = UA.can('course:manage');
      const form = manage ? `<div class="inline-form" style="margin-top:10px">
        <label>النوع<select id="tc-kind" data-no-other="1">${opts(Object.entries(d.kinds))}</select></label>
        <label style="flex:2">العنوان<input id="tc-title" maxlength="120" placeholder="اختياري"></label>
        <label>من<input id="tc-start" type="date"></label><label>إلى<input id="tc-end" type="date"></label>
        <button class="btn pri" type="button" data-act="tcadd">إضافة</button></div>
        <p class="hint">«بداية الفصل ونهايته» تحدد الفترة التي يُحسب فيها الغياب للفصل الحالي (${esc(d.currentTerm)}).</p>` : '';
      return `<section class="card"><h2>التقويم الأكاديمي</h2>
        ${table(['الفصل', 'الحدث', 'من', 'إلى', ''], d.events.map((e) => `<tr${e.past ? ' style="opacity:.6"' : ''}><td>${esc(e.term)}</td><td><b>${esc(e.title)}</b><div class="small">${esc(e.kindLabel)}</div></td><td>${esc(e.startDay)}</td><td>${esc(e.endDay)}</td>
          <td>${manage ? `<button class="btn sm" type="button" data-act="tccancel" data-id="${e.id}">إلغاء</button>` : ''}</td></tr>`).join(''), 'لا أحداث في تقويم هذا العام بعد.')}${form}</section>`;
    },
    async lectures() {
      const d = await UA.api('GET', '/api/teaching/lecture-changes');
      const form = (d.courses || []).length ? `<section class="card"><h2>إلغاء محاضرة أو تعويضها</h2>
        <div class="inline-form"><label style="flex:2">المقرر<select id="tl-course" data-no-other="1">${opts(d.courses.map((c) => [c.id, `${c.name}${c.code ? ` (${c.code})` : ''}`]))}</select></label>
          <label>الإجراء<select id="tl-kind" data-no-other="1">${opts([['cancel', 'إلغاء محاضرة'], ['makeup', 'محاضرة تعويضية']])}</select></label>
          <label>تاريخ المحاضرة<input id="tl-day" type="date"></label><label>من<input id="tl-start" type="time"></label><label>إلى<input id="tl-end" type="time"></label></div>
        <div class="inline-form"><label>يوم التعويض<input id="tl-mday" type="date"></label><label>من<input id="tl-mstart" type="time"></label><label>إلى<input id="tl-mend" type="time"></label><label>قاعة التعويض<input id="tl-mhall" maxlength="60"></label></div>
        <label>السبب<input id="tl-reason" maxlength="300"></label>
        <button class="btn pri" type="button" data-act="tladd" style="margin-top:8px">حفظ وإشعار طلاب المقرر</button></section>` : '';
      return `${form}<section class="card"><h2>سجل تغييرات المحاضرات</h2>${table(['المقرر', 'الإجراء', 'المحاضرة', 'التعويض', 'السبب', 'أُبلغ'], d.changes.map((x) => `<tr>
        <td><b>${esc(x.course)}</b></td><td>${esc(KIND[x.kind])}</td><td>${esc(x.lectureDay)} ${esc(x.start)}</td>
        <td>${x.makeupDay ? `${esc(x.makeupDay)} ${esc(x.makeupStart)}-${esc(x.makeupEnd)} ${esc(x.makeupHall)}` : '—'}</td><td>${esc(x.reason)}</td><td>${x.notified} طالب</td></tr>`).join(''), 'لا تغييرات.')}</section>`;
    },
    async absence() {
      const lc = await UA.api('GET', '/api/teaching/lecture-changes');
      const courses = lc.courses || [];
      if (!T.absenceCourse && courses.length) T.absenceCourse = String(courses[0].id);
      const pick = `<div class="inline-form"><label style="flex:2">المقرر<select id="ta-course" data-no-other="1">${opts(courses.map((c) => [c.id, `${c.name}${c.code ? ` (${c.code})` : ''}`]), T.absenceCourse)}</select></label>
        <button class="btn" type="button" data-act="tashow">عرض</button></div>`;
      if (!T.absenceCourse) return `<section class="card"><h2>الغياب والحرمان</h2><p class="small">لا مقررات تدرّسها.</p></section>`;
      const ov = await UA.api('GET', '/api/teaching/absence-overview');
      const wizard = `<section class="card" style="border:2px solid #054239;margin-bottom:16px"><h2>معالج الحرمان الشامل</h2>
        <p class="hint">كل الطلاب الذين تجاوز غيابهم ${ov.maxPercent}% في أي من مقرراتك (${ov.courses} مقرراً) (${esc(ov.term)}): ${ov.students.length} طالباً في ${ov.deprivationCount} حالة حرمان، و${ov.warnCount} حالة بلغت نصف الحد.</p>
        <div class="actions"><button class="btn" type="button" data-act="taoverall">تحديد الكل / إلغاء التحديد</button><button class="btn" type="button" data-act="taoverwarn"${ov.warnCount ? '' : ' disabled'}>إنذار مبكر لمن بلغ نصف الحد (${ov.warnCount})</button>
          <button class="btn dan" type="button" data-act="taoverdeprive"${ov.students.length ? '' : ' disabled'}>حرمان المحددين دفعة واحدة</button></div>
        ${table(['', 'الطالب', 'المقررات المتجاوزة'], ov.students.map((s) => `<tr><td><input type="checkbox" class="ta-ov" value="${s.studentId}" aria-label="اختيار"></td>
          <td><b>${esc(s.name)}</b> <span class="mono small">${esc(s.studentNo)}</span></td><td>${s.courses.map((c) => `${esc(c.name)} <b style="color:#B3261E">${c.percent}%</b>`).join(' · ')}</td></tr>`).join(''), 'لا طالب تجاوز الحد حالياً.')}</section>`;
      const r = await UA.api('GET', `/api/teaching/absence/${T.absenceCourse}`);
      const rows = r.rows.map((x) => `<tr>
        <td>${x.overLimit && !x.deprivationId ? `<input type="checkbox" class="ta-pick" value="${x.studentId}" aria-label="اختيار">` : ''}</td>
        <td><b>${esc(x.name)}</b> <span class="mono small">${esc(x.studentNo)}</span></td><td>${x.present}</td><td>${x.absent}</td>
        <td><b style="color:${x.overLimit ? '#B3261E' : x.warn ? '#8A6A1B' : '#1B7F4B'}">${x.percent}%</b></td>
        <td>${x.deprivationId ? `<span class="pill p-rejected">محروم</span>${UA.can('course:manage') ? ` <button class="btn sm" type="button" data-act="talift" data-id="${x.deprivationId}">رفع الحرمان</button>` : ''}` : x.overLimit ? '<span class="pill p-rejected">تجاوز الحد</span>' : x.warn ? '<span class="pill p-review">تنبيه</span>' : '—'}</td></tr>`).join('');
      // كشف حضور المحاضرة: يُفتح ليوم (اليوم افتراضياً)، الكل حاضر حتى يؤشّر المدرّس الغائبين، ومن مسح بطاقته حاضر دائماً
      const rc = T.roll && String(T.roll.course.id) === String(T.absenceCourse) ? T.roll : null;
      const rollRows = rc ? rc.students.map((x) => `<tr>
        <td><input type="checkbox" class="ta-roll" value="${x.studentId}"${x.present ? ' checked' : ''}${x.byCard ? ' disabled title="مسح بطاقته عند دخول القاعة"' : ''} aria-label="حاضر"></td>
        <td><b>${esc(x.name)}</b> <span class="mono small">${esc(x.studentNo)}</span></td>
        <td>${x.byCard ? '<span class="pill p-approved">حاضر بالبطاقة</span>' : ''}${x.deprived ? ' <span class="pill p-rejected">محروم</span>' : ''}</td></tr>`).join('') : '';
      const roll = `<section class="card"><h2>كشف حضور المحاضرة</h2>
        <p class="hint" style="margin-top:0">اختر يوم المحاضرة وافتح الكشف: الطلاب حاضرون افتراضياً، أزل التأشير عن الغائبين ثم احفظ. تُحتسب المحاضرة منعقدة ولو غاب الجميع، ومن مسح بطاقته عند الدخول يبقى حاضراً.</p>
        <div class="inline-form"><label>يوم المحاضرة<input id="ta-roll-day" type="date" value="${esc(T.rollDay || new Date().toISOString().slice(0, 10))}" max="${new Date().toISOString().slice(0, 10)}"></label>
          <label>القاعة (اختياري)<input id="ta-roll-hall" maxlength="60" placeholder="مثال: المدرج الثاني" value="${esc(rc && rc.session ? rc.session.hall : '')}"></label>
          <button class="btn" type="button" data-act="tarollopen">فتح الكشف</button></div>
        ${rc ? `<p class="small">${rc.saved ? `محفوظ ${esc(new Date(rc.session.takenAt).toLocaleString('ar-SY'))}${rc.session.takenBy ? ` · ${esc(rc.session.takenBy)}` : ''} · حاضر ${rc.session.present} · غائب ${rc.session.absent}` : 'كشف جديد لم يُحفظ بعد'} · <span id="ta-roll-count"></span></p>
          ${table(['حاضر', 'الطالب', ''], rollRows, 'لا طلاب في هذا المقرر.')}
          <div class="actions"><button class="btn" type="button" data-act="tarollall" data-on="1">الكل حاضر</button><button class="btn" type="button" data-act="tarollall" data-on="0">الكل غائب</button>
            <button class="btn pri" type="button" data-act="tarollsave">حفظ الكشف</button>${rc.saved ? '<button class="btn dan" type="button" data-act="tarollcancel">لم تنعقد المحاضرة (حذف الكشف)</button>' : ''}</div>` : ''}</section>`;
      return `${wizard}${roll}<section class="card"><h2>الغياب والحرمان</h2>${pick}
        <p class="hint">${esc(r.term)} · الفترة ${esc(r.window.from)} إلى ${esc(r.window.to)}${r.window.fromCalendar ? '' : ' (لم تُحدد في التقويم؛ آخر 120 يوماً)'} · انعقد المقرر ${r.held} يوماً · الحد ${r.maxPercent}% ويُحسب بعد ${r.minSessions} محاضرات.</p>
        ${table(['', 'الطالب', 'حضر', 'غاب', 'نسبة الغياب', 'الحالة'], rows, 'لا طلاب.')}
        <div class="actions"><button class="btn" type="button" data-act="tawarn">تنبيه من بلغ نصف الحد</button><button class="btn dan" type="button" data-act="tadeprive">حرمان المحددين</button></div></section>`;
    },
  };

  async function mount(tab) {
    const el = document.getElementById('teach-mount');
    if (!el || !RENDER[tab]) return;
    try { const html = await RENDER[tab](); const cur = document.getElementById('teach-mount'); if (cur) cur.innerHTML = html; } catch (e) { const cur = document.getElementById('teach-mount'); if (cur) cur.innerHTML = fail(e); }
  }
  UA.teaching = {
    tab: null,
    render(tab) { UA.teaching.tab = tab; setTimeout(() => mount(tab), 0); return '<div id="teach-mount"><section class="card"><p class="hint">جارٍ التحميل…</p></section></div>'; },
    studentPanel() {
      setTimeout(async () => {
        const el = document.getElementById('teach-student');
        if (!el) return;
        try {
          const d = await UA.api('GET', '/api/teaching/me');
          el.innerHTML = `<article class="sx-panel" style="margin-top:16px"><div class="sx-ph"><div><h2>الغياب وتغييرات المحاضرات</h2><p>${esc(d.term)} · الحد المسموح للغياب ${d.maxPercent}%</p></div></div>
            ${table(['المقرر', 'انعقد', 'حضرت', 'نسبة الغياب', ''], d.absence.map((a) => `<tr><td><b>${esc(a.course)}</b></td><td>${a.held}</td><td>${a.present}</td><td>${a.percent}%</td><td>${a.deprived ? '<span class="pill p-rejected">محروم</span>' : a.overLimit ? '<span class="pill p-rejected">تجاوز الحد</span>' : a.warn ? '<span class="pill p-review">انتبه</span>' : a.held && a.held < d.minSessions ? `<span class="small">يُحتسب بعد ${d.minSessions} محاضرات</span>` : ''}</td></tr>`).join(''), 'لا مقررات.')}
            ${d.changes.length ? `<h3>تغييرات المحاضرات</h3>${table(['المقرر', 'الإجراء', 'الموعد', 'التعويض', 'السبب'], d.changes.map((x) => `<tr><td>${esc(x.course)}</td><td>${esc(KIND[x.kind])}</td><td>${esc(x.lectureDay)} ${esc(x.start)}</td><td>${x.makeupDay ? `${esc(x.makeupDay)} ${esc(x.makeupStart)}-${esc(x.makeupEnd)} ${esc(x.makeupHall)}` : '—'}</td><td>${esc(x.reason)}</td></tr>`).join(''), '')}` : ''}
            ${d.calendar.length ? `<h3>التقويم الأكاديمي القادم</h3>${table(['الحدث', 'من', 'إلى'], d.calendar.map((e) => `<tr><td><b>${esc(e.title)}</b></td><td>${esc(e.startDay)}</td><td>${esc(e.endDay)}</td></tr>`).join(''), '')}` : ''}</article>`;
        } catch { /* غير متاح: لا نعرض اللوحة */ }
      }, 0);
      return '<div id="teach-student"></div>';
    },
  };

  // عدّاد حي لكشف الحضور أثناء التأشير
  const rollCount = () => {
    const all = [...document.querySelectorAll('.ta-roll')], on = all.filter((x) => x.checked).length, el = document.getElementById('ta-roll-count');
    if (el) el.textContent = `المؤشَّر الآن: حاضر ${on} · غائب ${all.length - on}`;
  };
  document.addEventListener('change', (e) => { if (e.target && e.target.classList && e.target.classList.contains('ta-roll')) rollCount(); });
  const again = () => mount(UA.teaching.tab).then(rollCount);
  Object.assign(UA.actions, {
    tcadd: async () => { await UA.api('POST', '/api/teaching/calendar', { kind: val('tc-kind'), title: val('tc-title'), startDay: val('tc-start'), endDay: val('tc-end') }); toast('أُضيف الحدث'); await again(); },
    tccancel: async (_el, d) => { if (!confirm('إلغاء هذا الحدث من التقويم؟')) return; await UA.api('POST', `/api/teaching/calendar/${d.id}/cancel`, {}); await again(); },
    tladd: async () => {
      const r = await UA.api('POST', '/api/teaching/lecture-changes', { courseId: Number(val('tl-course')), kind: val('tl-kind'), lectureDay: val('tl-day'), start: val('tl-start'), end: val('tl-end'), makeupDay: val('tl-mday'), makeupStart: val('tl-mstart'), makeupEnd: val('tl-mend'), makeupHall: val('tl-mhall'), reason: val('tl-reason') });
      toast(`حُفظ التغيير وأُبلغ ${r.notified} طالباً`); await again();
    },
    taoverall: async () => { const all = [...document.querySelectorAll('.ta-ov')], on = all.some((x) => !x.checked); all.forEach((x) => { x.checked = on; }); },
    taoverwarn: async () => { const r = await UA.api('POST', '/api/teaching/absence-overview/warn', {}); toast(`أُرسل الإنذار المبكر إلى ${r.warned} حالة`); await again(); },
    taoverdeprive: async () => {
      const studentIds = [...document.querySelectorAll('.ta-ov:checked')].map((x) => Number(x.value));
      if (!studentIds.length) { toast('حدد الطلاب أولاً.'); return; }
      if (!confirm(`حرمان ${studentIds.length} طالباً من كل مقرر تجاوزوا فيه الحد؟ يُبلَّغ كل منهم.`)) return;
      const r = await UA.api('POST', '/api/teaching/absence-overview/deprive', { studentIds }); toast(`صدر ${r.deprived} قرار حرمان في ${r.courses} مقرر`); await again();
    },
    tashow: async () => { T.absenceCourse = val('ta-course'); T.roll = null; await again(); },
    tarollopen: async () => {
      T.rollDay = val('ta-roll-day');
      T.roll = await UA.api('GET', `/api/teaching/rollcall/${T.absenceCourse}?day=${encodeURIComponent(T.rollDay)}`);
      await again();
    },
    tarollall: async (_el, d) => { document.querySelectorAll('.ta-roll:not(:disabled)').forEach((x) => { x.checked = d.on === '1'; }); rollCount(); },
    tarollsave: async () => {
      const present = [...document.querySelectorAll('.ta-roll:checked')].map((x) => Number(x.value));
      T.roll = await UA.api('POST', `/api/teaching/rollcall/${T.absenceCourse}`, { day: T.roll.day, hall: val('ta-roll-hall'), present });
      toast(`حُفظ كشف ${T.roll.day}: حاضر ${T.roll.session.present} · غائب ${T.roll.session.absent}`); await again();
    },
    tarollcancel: async () => {
      if (!confirm(`حذف كشف حضور ${T.roll.day}؟ لن تُحتسب المحاضرة منعقدة (تبقى سجلات مسح البطاقات).`)) return;
      T.roll = await UA.api('DELETE', `/api/teaching/rollcall/${T.absenceCourse}?day=${encodeURIComponent(T.roll.day)}`);
      toast('حُذف كشف المحاضرة'); await again();
    },
    tawarn: async () => { const r = await UA.api('POST', `/api/teaching/absence/${T.absenceCourse}/warn`, {}); toast(`أُرسل التنبيه إلى ${r.warned} طالباً`); },
    tadeprive: async () => {
      const studentIds = [...document.querySelectorAll('.ta-pick:checked')].map((x) => Number(x.value));
      if (!studentIds.length) { toast('حدد الطلاب أولاً.'); return; }
      if (!confirm(`حرمان ${studentIds.length} طالباً من المقرر؟ يُبلَّغ كل منهم.`)) return;
      const r = await UA.api('POST', `/api/teaching/absence/${T.absenceCourse}/deprive`, { studentIds }); toast(`حُرم ${r.deprived} طالباً`); await again();
    },
    talift: async (_el, d) => { const reason = prompt('سبب رفع الحرمان (عذر مقبول مثلاً):'); if (!reason) return; await UA.api('POST', `/api/teaching/deprivations/${d.id}/lift`, { reason }); await again(); },
  });
})();
