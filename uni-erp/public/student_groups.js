/* تبويب «فئات الطلاب» في شؤون الطلاب: إنشاء الفئات من الطلاب الموجودين، وتعديل أسمائها وأعضائها، وتوزيع مجموعة على عدة فئات. */
(function () {
  const UA = window.UA, { api, esc, toast, can } = UA;
  const G = { groups: null, kinds: {}, sel: null, members: [], mode: '', q: '', results: [], picked: new Set(), loading: false, err: '', sched: null, labEdit: null, examEdit: null };
  const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  const EXAM_TYPES = ['امتحان فصلي نهائي (Final)', 'امتحان نصفي (Midterm)', 'فحص عملي / مخبري', 'امتحان تكميلي / بديل', 'سبر معلومات / مذاكرة', 'أخرى'];
  const SEMESTERS = ['الفصل الأول', 'الفصل الثاني', 'الدورة الصيفية / التكميلية'];
  const ICON_LAB = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v5L4.6 15.2A2 2 0 0 0 6.4 18h11.2a2 2 0 0 0 1.8-2.8L15 7V2"/><line x1="8" y1="2" x2="16" y2="2"/><line x1="7" y1="13" x2="17" y2="13"/></svg>';
  const ICON_EXAM = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2.2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>';
  const opts = (list, sel) => list.map((v) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const canWrite = () => can('student:update') || can('course:manage');
  const kindOpts = (sel) => Object.entries(G.kinds).map(([k, l]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');

  async function load() {
    try { const r = await api('GET', '/api/student-groups'); G.groups = r.groups; G.kinds = r.kinds; G.err = ''; } catch (e) { if (!e.status) throw e; G.groups = []; G.err = e.message; }
  }
  UA.loadStudentGroups = load;
  async function select(id) {
    const r = await api('GET', `/api/student-groups/${id}`);
    G.sel = r.group; G.members = r.members; G.mode = ''; G.picked.clear(); G.results = []; G.q = '';
    G.labEdit = null; G.examEdit = null; await loadSched();
  }
  async function loadSched() {
    try { G.sched = await api('GET', `/api/student-groups/${G.sel.id}/schedule`); } catch (e) { if (!e.status) throw e; G.sched = null; }
  }

  const courseOpts = (sel) => G.sched.courses.map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}${c.code ? ` (${esc(c.code)})` : ''}</option>`).join('');
  const emptyBox = (label, act) => `<div class="sg-slot-empty"><span>لا يوجد موعد محدد بعد</span>${act ? `<button type="button" class="btn pri sm" data-act="${act}">${label}</button>` : ''}</div>`;
  function labForm() {
    const s = G.labEdit, editing = !!s.id;
    return `<form id="sg-lab" class="form sg-slot-form" style="border:0;padding:0" novalidate>
      <label>المقرر<select id="sgl-course" required${editing ? ' disabled' : ''}><option value="">— اختر المقرر —</option>${courseOpts(s.courseId)}</select></label>
      <div class="two"><label>اليوم<select id="sgl-day">${DAYS.map((d, i) => `<option value="${i}"${i === (s.day ?? 1) ? ' selected' : ''}>${d}</option>`).join('')}</select></label><label>القاعة<input id="sgl-hall" maxlength="60" value="${esc(s.hall || '')}" placeholder="مثال: قاعة المختبر 2"></label></div>
      <div class="two"><label>من<input id="sgl-start" type="time" required value="${esc(s.start || '10:00')}"></label><label>إلى<input id="sgl-end" type="time" required value="${esc(s.end || '11:30')}"></label></div>
      <div class="actions"><button class="btn pri sm" type="submit">حفظ الموعد</button><button class="btn sm" type="button" data-act="sglabcancel">إلغاء</button></div></form>`;
  }
  function examForm() {
    const e = G.examEdit, editing = !!e.id, ES = (UA.uxState && UA.uxState.examSchedule) || {};
    const types = [...new Set([e.exam_type, ...((UA.S && UA.S.limits && UA.S.limits.dropdowns && UA.S.limits.dropdowns.examTypes) || EXAM_TYPES)].filter(Boolean))];
    const sems = [...new Set([e.semester, ...SEMESTERS].filter(Boolean))];
    const code = e.course_code || '', course = G.sched.courses.find((c) => c.code === code);
    return `<form id="sg-exam" class="form sg-slot-form" style="border:0;padding:0" novalidate>
      <label>المقرر<select id="sge-course" required${editing ? ' disabled' : ''}><option value="">— اختر المقرر —</option>${courseOpts(course ? course.id : null)}</select></label>
      <div class="two"><label>نوع الامتحان<select id="sge-type"${editing ? ' disabled' : ''}>${opts(types, e.exam_type || ES.examType || types[0])}</select></label><label>الفصل<select id="sge-sem"${editing ? ' disabled' : ''}>${opts(sems, e.semester || ES.semester || sems[0])}</select></label></div>
      <div class="two"><label>التاريخ<input id="sge-date" type="date" required value="${esc(e.exam_date || ES.startDate || '')}"></label><label>القاعة<input id="sge-hall" maxlength="60" required value="${esc(e.hall_name || '')}" placeholder="مثال: قاعة الامتحانات 1"></label></div>
      <div class="two"><label>من<input id="sge-start" type="time" required value="${esc(e.start_time || '09:00')}"></label><label>إلى<input id="sge-end" type="time" required value="${esc(e.end_time || '11:00')}"></label></div>
      <div class="two"><label>المراقب (اختياري)<input id="sge-proctor" maxlength="100" value="${esc(e.proctor_name || '')}"></label><label>سعة القاعة (اختياري)<input id="sge-cap" type="number" min="0" value="${e.capacity || ''}"></label></div>
      <div class="actions"><button class="btn pri sm" type="submit">حفظ الموعد</button><button class="btn sm" type="button" data-act="sgexamcancel">إلغاء</button></div></form>`;
  }
  function labCard() {
    const labs = G.sched.labs;
    const list = labs.map((s) => `<div class="sg-slot"><div><div class="sg-slot-when">${esc(s.dayLabel)} · ${esc(s.start)} – ${esc(s.end)}</div><div class="sg-slot-where">${s.hall ? `${esc(s.hall)} · ` : ''}من جدول «${esc(s.courseName)}»</div></div>
      ${G.labEdit ? '' : `<div class="actions"><button type="button" class="btn sm" data-act="sglabedit" data-id="${s.id}">تعديل الموعد</button><button type="button" class="btn sm bad" data-act="sglabdel" data-id="${s.id}" aria-label="حذف موعد ${esc(s.courseName)}">حذف</button></div>`}</div>`).join('');
    const body = G.labEdit ? list + labForm() : labs.length ? `${list}<div><button type="button" class="btn sm" data-act="sglabnew">إضافة موعد لمقرر آخر</button></div>` : emptyBox('تحديد موعد المختبر', 'sglabnew');
    return `<div class="sg-slot-card"><div class="sg-slot-head"><span class="sg-slot-ico">${ICON_LAB}</span>موعد المحاضرة / المختبر</div>${body}</div>`;
  }
  function examCard() {
    const exams = G.sched.exams, w = G.sched.canExam && !G.examEdit;
    const day = (d) => { const t = new Date(d + 'T00:00:00'); return isNaN(t) ? '' : DAYS[(t.getDay() + 1) % 7] + ' '; };
    const list = exams.map((e) => `<div class="sg-slot"><div><div class="sg-slot-when">${esc(day(e.exam_date))}${esc(e.exam_date)} · ${esc(e.start_time)} – ${esc(e.end_time)}</div><div class="sg-slot-where">${esc(e.course_name || e.course_code)} · ${esc(e.exam_type)}<br>${esc(e.hall_name)}${e.proctor_name ? ` · المراقب: ${esc(e.proctor_name)}` : ''}</div></div>
      ${w ? `<div class="actions"><button type="button" class="btn sm" data-act="sgexamedit" data-id="${e.id}">تعديل الموعد</button><button type="button" class="btn sm bad" data-act="sgexamdel" data-id="${e.id}" aria-label="حذف امتحان ${esc(e.course_name || e.course_code)}">حذف</button></div>` : ''}</div>`).join('');
    const body = G.examEdit ? list + examForm() : exams.length ? list + (w ? '<div><button type="button" class="btn sm" data-act="sgexamnew">إضافة امتحان آخر</button></div>' : '') : emptyBox('تحديد موعد الامتحان', G.sched.canExam ? 'sgexamnew' : '');
    return `<div class="sg-slot-card"><div class="sg-slot-head"><span class="sg-slot-ico">${ICON_EXAM}</span>موعد الامتحان</div>${body}</div>`;
  }
  function schedSection() {
    const s = G.sched; if (!s || (!s.labs && !s.exams)) return '';
    return `<h3 class="sg-sched-h">المواعيد المرتبطة بالفئة</h3><p class="hint">حدِّد موعدًا هنا ليحضر كل أفراد الفئة المختبر أو الامتحان معًا، دون فتح شاشة أخرى.</p>
      <div class="sg-sched">${s.labs ? labCard() : ''}${s.exams ? examCard() : ''}</div>`;
  }
  async function search() {
    const r = await api('GET', `/api/students-table?size=200&sort=studentNo&dir=asc${G.q ? `&q=${encodeURIComponent(G.q)}` : ''}`);
    const inside = new Set(G.members.map((m) => m.id));
    G.results = r.rows.filter((s) => !G.sel || !inside.has(s.id));
    const box = document.getElementById('sg-results'); if (box) box.innerHTML = resultsHtml();
  }
  function resultsHtml() {
    if (!G.results.length) return '<p class="hint" style="margin:0">لا طلاب مطابقون.</p>';
    return `<div class="tbl-wrap sg-picker"><table class="grid-tbl"><thead><tr><th></th><th>الرقم الجامعي</th><th>الطالب</th></tr></thead><tbody>${G.results.map((s) => `<tr><td><input type="checkbox" data-sg-pick="${s.id}" aria-label="تحديد ${esc(s.name)}"${G.picked.has(s.id) ? ' checked' : ''}></td><td class="mono">${esc(s.studentNo)}</td><td>${esc(s.name)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const pickedLine = () => `المحددون: <b id="sg-count">${G.picked.size}</b>`;
  function picker() {
    return `<div class="sg-pick-head"><label>بحث في الطلاب<input id="sg-q" value="${esc(G.q)}" maxlength="60" placeholder="الاسم أو الرقم الجامعي" autocomplete="off"></label>
      <button type="button" class="btn sm" data-act="sgpickall">تحديد كل النتائج</button><span class="small">${pickedLine()}</span></div><div id="sg-results">${resultsHtml()}</div>`;
  }
  function newForm() {
    return `<section class="card"><h3 style="margin-top:0">فئة جديدة</h3><form id="sg-new" class="form" style="border:0;padding:0" novalidate>
      <div class="two"><label>اسم الفئة<input id="sg-name" maxlength="80" required placeholder="مثال: مختبر الشبكات 1"></label><label>النوع<select id="sg-kind">${kindOpts('lecture')}</select></label></div>
      <label>ملاحظات (اختياري)<input id="sg-notes" maxlength="500"></label>
      ${picker()}
      <div class="actions"><button class="btn pri" type="submit">إنشاء الفئة</button><button class="btn" type="button" data-act="sgcancel">إلغاء</button></div>
      <div class="sg-split"><b>أو وزّع المحددين على عدة فئات متساوية</b><div class="two"><label>عدد الطلاب في كل فئة<input id="sg-size" type="number" min="1" max="500" value="25"></label><span class="small" style="align-self:center">تُسمّى الفئات بالاسم أعلاه مع رقم: «الاسم 1»، «الاسم 2»…</span></div><button class="btn" type="button" data-act="sgsplit">توزيع على فئات</button></div>
    </form></section>`;
  }
  function detail() {
    const g = G.sel; if (!g) return '';
    const rows = G.members.map((m) => `<tr><td class="mono">${esc(m.studentNo)}</td><td>${esc(m.name)}</td><td>${esc(m.program)}</td>${canWrite() ? `<td><button class="btn sm" data-act="sgremove" data-id="${m.id}">إزالة</button></td>` : ''}</tr>`).join('');
    return `<section class="card"><div class="tool-row"><h3 style="margin:0">${esc(g.name)} <span class="small">(${G.members.length} طالب)</span></h3>${canWrite() ? '<button class="btn sm bad" data-act="sgdelete">حذف الفئة</button>' : ''}</div>
      ${canWrite() ? `<form id="sg-edit" class="form" style="border:0;padding:0;margin-top:10px" novalidate><div class="two"><label>اسم الفئة<input id="sg-name" maxlength="80" required value="${esc(g.name)}"></label><label>النوع<select id="sg-kind">${kindOpts(g.kind)}</select></label></div><label>ملاحظات<input id="sg-notes" maxlength="500" value="${esc(g.notes)}"></label><div class="actions"><button class="btn pri sm" type="submit">حفظ التعديل</button></div></form>` : ''}
      ${schedSection()}
      <h4 style="margin-bottom:6px">أعضاء الفئة</h4>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الرقم الجامعي</th><th>الطالب</th><th>البرنامج</th>${canWrite() ? '<th></th>' : ''}</tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">لا طلاب في هذه الفئة بعد.</td></tr>`}</tbody></table></div>
      ${canWrite() ? `<h4>إضافة طلاب</h4>${picker()}<div class="actions"><button class="btn pri sm" type="button" data-act="sgadd">إضافة المحددين</button></div>` : ''}</section>`;
  }
  UA.renderStudentGroups = function () {
    if (!G.groups) {
      if (!G.loading) { G.loading = true; load().then(() => { G.loading = false; UA.render(); }); }
      return '<div class="empty">جارٍ تحميل الفئات…</div>';
    }
    const rows = G.groups.map((g) => `<tr${G.sel && G.sel.id === g.id ? ' class="sel"' : ''}><td><button class="link" data-act="sgopen" data-id="${g.id}"><b>${esc(g.name)}</b></button></td><td><span class="pill p-review">${esc(g.kindLabel)}</span></td><td>${esc(g.programName || '—')}</td><td>${g.count}</td></tr>`).join('');
    return `<section class="card"><div class="tool-row"><div><h2 style="margin:0">فئات الطلاب</h2><p class="hint" style="margin:4px 0 0">قسّم الطلاب إلى فئات للمحاضرات والمختبرات والامتحانات، ثم اخترها عند جدولة الامتحان وفي جلسة القاعة.</p></div>
        ${canWrite() ? '<div class="actions no-print" style="margin:0"><button class="btn pri sm" data-act="sgnew">فئة جديدة</button><button class="btn sm" data-act="sgimport">استيراد من Excel</button></div>' : ''}</div>
      ${G.err ? `<p class="reason">${esc(G.err)}</p>` : ''}
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الفئة</th><th>النوع</th><th>البرنامج</th><th>الطلاب</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">لا فئات بعد. أنشئ أول فئة من الطلاب الموجودين أو استوردها من Excel.</td></tr>'}</tbody></table></div></section>
      ${G.mode === 'new' ? newForm() : detail()}`;
  };

  const value = (id) => (document.getElementById(id)?.value ?? '').trim();
  const refresh = async () => { await load(); UA.render(); };
  const guarded = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (!e.status) throw e; toast(e.message); } };
  Object.assign(UA.actions, {
    sgopen: guarded(async (el, d) => { await select(d.id); UA.render(); if (canWrite()) await search(); }),
    sgnew: guarded(async () => { G.mode = 'new'; G.sel = null; G.members = []; G.picked.clear(); G.q = ''; UA.render(); await search(); }),
    sgcancel: async () => { G.mode = ''; G.picked.clear(); UA.render(); },
    sgimport: async () => { await UA.go('exchange'); },
    sgpickall: async () => { for (const s of G.results) G.picked.add(s.id); const box = document.getElementById('sg-results'); if (box) box.innerHTML = resultsHtml(); const n = document.getElementById('sg-count'); if (n) n.textContent = G.picked.size; },
    sgremove: guarded(async (el, d) => { const r = await api('PUT', `/api/student-groups/${G.sel.id}/members`, { remove: [Number(d.id)] }); G.members = r.members; G.sel = r.group; await refresh(); await search(); }),
    sgadd: guarded(async () => {
      if (!G.picked.size) return toast('حدد الطلاب أولاً');
      const r = await api('PUT', `/api/student-groups/${G.sel.id}/members`, { add: [...G.picked] });
      G.members = r.members; G.sel = r.group; G.picked.clear(); toast('أُضيف الطلاب إلى الفئة'); await refresh(); await search();
    }),
    sgdelete: guarded(async () => {
      if (!confirm(`حذف الفئة «${G.sel.name}»؟ لا يُحذف الطلاب، وتبقى الامتحانات المرتبطة بها دون فئة.`)) return;
      await api('DELETE', `/api/student-groups/${G.sel.id}`); G.sel = null; G.members = []; toast('حُذفت الفئة'); await refresh();
    }),
    sglabnew: async () => { G.labEdit = {}; UA.render(); document.getElementById('sgl-course')?.focus(); },
    sglabedit: async (el, d) => { G.labEdit = { ...G.sched.labs.find((s) => s.id === Number(d.id)) }; UA.render(); document.getElementById('sgl-day')?.focus(); },
    sglabcancel: async () => { G.labEdit = null; UA.render(); },
    sglabdel: guarded(async (el, d) => {
      const s = G.sched.labs.find((x) => x.id === Number(d.id));
      if (!confirm(`حذف موعد «${s.courseName}» (${s.dayLabel} ${s.start}) من هذه الفئة؟`)) return;
      await api('DELETE', `/api/student-groups/${G.sel.id}/labs/${s.id}`); await loadSched(); toast('حُذف الموعد'); UA.render();
    }),
    sgexamnew: async () => { G.examEdit = {}; UA.render(); document.getElementById('sge-course')?.focus(); },
    sgexamedit: async (el, d) => { G.examEdit = { ...G.sched.exams.find((e) => e.id === Number(d.id)) }; UA.render(); document.getElementById('sge-date')?.focus(); },
    sgexamcancel: async () => { G.examEdit = null; UA.render(); },
    sgexamdel: guarded(async (el, d) => {
      const e = G.sched.exams.find((x) => x.id === Number(d.id));
      if (!confirm(`حذف امتحان «${e.course_name || e.course_code}» (${e.exam_date} ${e.start_time}) من جدول الامتحانات؟`)) return;
      G.sched = await api('DELETE', `/api/student-groups/${G.sel.id}/exams/${e.id}`); toast('حُذف موعد الامتحان'); UA.render();
    }),
    sgsplit: guarded(async () => {
      const r = await api('POST', '/api/student-groups/split', { baseName: value('sg-name'), kind: value('sg-kind'), notes: value('sg-notes'), size: Number(value('sg-size')), studentIds: [...G.picked] });
      G.mode = ''; G.picked.clear(); toast(`أُنشئت ${r.groups.length} فئة`); await refresh();
    }),
  });
  UA.forms['sg-new'] = guarded(async () => {
    const r = await api('POST', '/api/student-groups', { name: value('sg-name'), kind: value('sg-kind'), notes: value('sg-notes'), studentIds: [...G.picked] });
    toast('أُنشئت الفئة'); await load(); await select(r.group.id); UA.render(); await search();
  });
  UA.forms['sg-edit'] = guarded(async () => {
    const r = await api('PUT', `/api/student-groups/${G.sel.id}`, { name: value('sg-name'), kind: value('sg-kind'), notes: value('sg-notes') });
    G.sel = r.group; toast('حُفظ التعديل'); await refresh(); await search();
  });
  UA.forms['sg-lab'] = guarded(async () => {
    const s = G.labEdit, courseId = s.id ? s.courseId : Number(value('sgl-course'));
    if (!courseId) return toast('اختر المقرر');
    await api('PUT', `/api/student-groups/${G.sel.id}/labs`, { slotId: s.id || null, courseId, day: Number(value('sgl-day')), start: value('sgl-start'), end: value('sgl-end'), hall: value('sgl-hall') });
    G.labEdit = null; await loadSched(); toast('حُفظ موعد المختبر لكل أفراد الفئة'); UA.render();
  });
  UA.forms['sg-exam'] = guarded(async () => {
    const e = G.examEdit, ES = (UA.uxState && UA.uxState.examSchedule) || {};
    const c = e.id ? { code: e.course_code, name: e.course_name } : G.sched.courses.find((x) => x.id === Number(value('sge-course')));
    if (!c) return toast('اختر المقرر');
    if (!c.code) return toast('لا يوجد رمز لهذا المقرر؛ أضفه من شاشة المقررات أولاً');
    const r = await api('POST', '/api/expansions/exams/bulk', {
      exam_type: value('sge-type'), academic_year: e.academic_year || ES.academicYear, semester: value('sge-sem'),
      items: [{ course_code: c.code, course_name: c.name, exam_date: value('sge-date'), start_time: value('sge-start'), end_time: value('sge-end'), hall_name: value('sge-hall'), proctor_name: value('sge-proctor'), capacity: Number(value('sge-cap')) || 0, group_id: G.sel.id }],
    });
    G.examEdit = null; await loadSched(); UA.render();
    toast(r.warnings && r.warnings.length ? r.warnings.join(' — ') : 'حُفظ موعد الامتحان لكل أفراد الفئة');
  });
  let timer = null;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'sg-q') return;
    G.q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(() => { search().catch(() => {}); }, 250);
  });
  document.addEventListener('change', (e) => {
    const id = e.target.dataset && e.target.dataset.sgPick; if (!id) return;
    if (e.target.checked) G.picked.add(Number(id)); else G.picked.delete(Number(id));
    const n = document.getElementById('sg-count'); if (n) n.textContent = G.picked.size;
  });
})();
