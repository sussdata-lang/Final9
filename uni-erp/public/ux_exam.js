/* إنشاء فحص الامتحان والمواد والعلامات (مفصول من ux_restructure.js) */
(function () {
  'use strict';
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, fmt, toast, can } = UA;
  const U = UA.uxState;

  /* ==========================================================================
     5. تطوير نظام إنشاء فحص الامتحان الشامل (فورم يحتوي كافة المواد مع تاريخ الفحص + PDF)
     ========================================================================== */
  async function ensureExamCoursesLoaded() {
    if (U.examSchedule.loaded && U.examSchedule.courses.length) return;
    try {
      const [r, g] = await Promise.all([api('GET', '/api/courses').catch(() => ({ courses: [] })), can('grade:manage') || can('course:manage') ? api('GET', '/api/student-groups').catch(() => ({ groups: [] })) : { groups: [] }]);
      const list = Array.isArray(r.courses) ? r.courses : [];
      U.examSchedule.groups = g.groups || [];
      U.examSchedule.courses = list;
      const baseDate = new Date(U.examSchedule.startDate || Date.now() + 7 * 86400000);
      const halls = ((S.limits && S.limits.dropdowns && S.limits.dropdowns.halls) || []);
      list.forEach((c, idx) => {
        if (!U.examSchedule.rows[c.id]) {
          const d = new Date(baseDate.getTime() + (idx % 14) * 86400000);
          if (d.getDay() === 5) d.setDate(d.getDate() + 2);
          if (d.getDay() === 6) d.setDate(d.getDate() + 1);
          U.examSchedule.rows[c.id] = {
            included: true,
            date: d.toISOString().slice(0, 10),
            time: idx % 2 === 0 ? '09:00' : '12:00',
            duration: 120,
            hall: halls[idx % halls.length] || '',
            proctor: c.instructor || 'لجنة المراقبة الامتحانية',
            notes: 'امتحان رسمي موحد',
          };
        }
      });
      U.examSchedule.loaded = true;
      await loadSavedExams();
    } catch { /* ignore */ }
  }

  // ما حُفظ من قبل يملأ الأداة، فيُعدَّل بدل أن يُكرَّر
  async function loadSavedExams() {
    U.examSchedule.saved = (await api('GET', '/api/expansions/exams').catch(() => ({ exams: [] }))).exams || [];
    applySavedExams();
  }
  function applySavedExams() {
    const E = U.examSchedule, today = new Date().toISOString().slice(0, 10);
    const inTerm = (x) => (x.exam_type === E.examType && x.academic_year === E.academicYear && x.semester === E.semester) || (!x.academic_year && x.exam_date >= today);
    const minutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
    for (const c of E.courses || []) {
      const row = E.rows[c.id] || (E.rows[c.id] = {});
      const x = (E.saved || []).find((s) => s.course_code === c.code && inTerm(s));
      row.savedId = x ? x.id : null;
      if (!x) continue;
      Object.assign(row, { date: x.exam_date, time: x.start_time, duration: (minutes(x.end_time) - minutes(x.start_time)) || 120, hall: x.hall_name, proctor: x.proctor_name, groupId: x.group_id || null, capacity: Number(x.capacity) || 0 });
    }
  }
  function refreshExamBuilder() {
    if (S.view === 'expansions') { const banner = document.getElementById('exp-master-exam-banner'); if (banner) banner.innerHTML = UA.renderMasterExamBuilder(); } else UA.render();
  }
  const canScheduleExams = () => can('grade:manage') || can('course:manage') || can('exams_housing:write') || can('exams_housing:edit') || can('exams_housing:approve');

  function syncExamDomToState() {
    const tp = document.getElementById('exm-type');
    const yr = document.getElementById('exm-year');
    const sm = document.getElementById('exm-sem');
    const sd = document.getElementById('exm-start-date');
    if (tp) U.examSchedule.examType = tp.value;
    if (yr) U.examSchedule.academicYear = yr.value;
    if (sm) U.examSchedule.semester = sm.value;
    if (sd) U.examSchedule.startDate = sd.value;

    document.querySelectorAll('[data-exm-cid]').forEach((tr) => {
      const cid = Number(tr.getAttribute('data-exm-cid'));
      const row = U.examSchedule.rows[cid] || (U.examSchedule.rows[cid] = {});
      const inc = tr.querySelector('.exm-inc');
      const dt = tr.querySelector('.exm-date');
      const tm = tr.querySelector('.exm-time');
      const dur = tr.querySelector('.exm-dur');
      const hl = tr.querySelector('.exm-hall');
      const pr = tr.querySelector('.exm-proc');
      const gr = tr.querySelector('.exm-group');
      if (gr) row.groupId = Number(gr.value) || null;
      if (inc) row.included = inc.checked;
      if (dt) row.date = dt.value;
      if (tm) row.time = tm.value;
      if (dur) row.duration = Number(dur.value) || 120;
      const cap = tr.querySelector('.exm-cap');
      if (cap) row.capacity = Number(cap.value) || 0;
      if (hl) row.hall = hl.value;
      if (pr) row.proctor = pr.value;
    });
  }

  function generateExamSchedulePdf() {
    syncExamDomToState();
    const courses = U.examSchedule.courses || [];
    const selected = courses
      .filter((c) => (U.examSchedule.rows[c.id]?.included ?? true))
      .map((c) => ({ ...c, ...(U.examSchedule.rows[c.id] || {}), groupName: (U.examSchedule.groups || []).find((g) => g.id === U.examSchedule.rows[c.id]?.groupId)?.name || '' }))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')));

    if (!selected.length) {
      toast('اختر مادة واحدة على الأقل لتضمينها في ملف PDF');
      return;
    }

    const uni = S.uni || 'الجامعة السورية للعلوم الأمنية';
    const docCode = `EXM-${new Date().getFullYear()}-${String(selected.length).padStart(3, '0')}`;
    const rowsHtml = selected.map((c, idx) => `<tr>
      <td style="text-align:center;font-weight:700">${idx + 1}</td>
      <td class="mono" dir="ltr" style="font-weight:700">${esc(c.code)}</td>
      <td><b>${esc(c.name)}</b>${c.groupName ? `<div>الفئة: ${esc(c.groupName)}</div>` : ''}</td>
      <td>${esc(c.programName || c.faculty || 'البرنامج العام')} · السنة ${esc(c.levelLabel || c.level || '')}</td>
      <td class="mono" dir="ltr" style="font-weight:700;color:#054239">${esc(c.date || '—')}</td>
      <td class="mono" dir="ltr">${esc(c.time || '09:00')} (${c.duration || 120} د)</td>
      <td>${esc(c.hall || 'المدرج الرئيسي')}</td>
      <td>${esc(c.proctor || '—')}</td>
    </tr>`).join('');

    const html = `<div class="doc" dir="rtl" style="max-width:980px;margin:0 auto;padding:28px;background:#fff;color:#10211D;font-family:inherit;border:2px solid #054239;border-radius:12px">
      <div class="doc-head" style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #054239;padding-bottom:14px">
        <div>
          <div style="font-size:13px;color:#566660;font-weight:700">الجمهورية العربية السورية · وزارة الداخلية</div>
          <h2 style="margin:4px 0;color:#054239;font-size:22px">${esc(uni)}</h2>
          <div style="font-size:14px;font-weight:700;color:#10211D">رئاسة دائرة الامتحانات والشؤون الأكاديمية</div>
        </div>
        <img class="crest" src="/brand/crest.svg" alt="" width="64" height="74">
        <div style="text-align:left;font-size:12px" dir="ltr">
          <div><b>Doc No:</b> ${esc(docCode)}</div>
          <div><b>Date:</b> ${new Date().toISOString().slice(0, 10)}</div>
          <div><b>Courses:</b> ${selected.length}</div>
        </div>
      </div>

      <div style="text-align:center;margin:18px 0">
        <h3 style="margin:0;font-size:19px;color:#054239;background:#F6F8F5;display:inline-block;padding:6px 22px;border-radius:8px;border:1px solid #A8D8BE">
          جدول فحص الامتحانات الرسمي الشامل — ${esc(U.examSchedule.examType)}
        </h3>
        <div style="margin-top:6px;font-size:13px;color:#10211D;font-weight:600">
          العام الدراسي: ${esc(U.examSchedule.academicYear)} · ${esc(U.examSchedule.semester)} · إجمالي المقررات المجدولة: (${selected.length}) مقرر دراسي
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px" border="1" cellpadding="7">
        <thead style="background:#054239;color:#fff">
          <tr>
            <th>#</th>
            <th>رمز المقرر</th>
            <th>اسم المقرر الدراسي</th>
            <th>الكلية / البرنامج والسنة</th>
            <th>تاريخ الفحص</th>
            <th>الوقت والمدة</th>
            <th>القاعة الامتحانية</th>
            <th>رئيس القاعة / المدرس</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="margin-top:18px;padding:12px;background:#F6F8F5;border:1px solid #DCE3DD;border-radius:8px;font-size:12px">
        <b>تعليمات امتحانية إلزامية:</b>
        <ol style="margin:6px 0 0;padding-inline-start:20px">
          <li>يُطلب من جميع الطلاب الحضور إلى القاعة الامتحانية قبل (15) دقيقة من موعد بدء الفحص مصطحبين البطاقة الجامعية الذكية.</li>
          <li>يُمنع إدخال الهواتف المحمولة أو الساعات الذكية أو أي وسائط إلكترونية إلى قاعات الفحص تحت طائلة المساءلة أمام اللجنة الانضباطية.</li>
          <li>تُعتمد تواريخ الفحص الواردة في هذا الجدول رسمياً وتُبلَّغ لكافة الكليات وأعضاء الهيئة التدريسية والطلاب.</li>
        </ol>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;padding-top:14px;border-top:1px dashed #8B9591;font-size:13px">
        <div>
          <span class="stamp" style="display:inline-block;padding:4px 12px;border:2px solid #054239;color:#054239;font-weight:800;border-radius:6px">وثيقة امتحانية مصدّقة رقمياً (PDF)</span>
          <div style="margin-top:6px">رمز التحقق المرجعي: <span class="mono" dir="ltr">${esc(docCode)}</span></div>
        </div>
        <div style="text-align:center">
          <b>رئيس دائرة الامتحانات</b>
          <div style="margin-top:24px;color:#566660">التوقيع والختم الرسمي</div>
        </div>
        <div style="text-align:center">
          <b>اعتماد رئاسة الجامعة</b>
          <div style="margin-top:24px;color:#566660">التوقيع والختم الرسمي</div>
        </div>
      </div>
    </div>`;

    if (UA.printHtml) {
      UA.printHtml(html);
      toast('تم إنشاء ملف PDF لجدول فحص الامتحانات — اختر «حفظ بتنسيق PDF» من نافذة الطباعة');
    }
  }

  UA.renderMasterExamBuilder = () => {
    if (!canScheduleExams()) return '';   // أداة موظفي الامتحانات، لا تظهر للطالب ولا لغيرهم
    const courses = U.examSchedule.courses || [];
    const examTypes = ((S.limits && S.limits.dropdowns && S.limits.dropdowns.examTypes) || [
      'امتحان فصلي نهائي (Final)',
      'امتحان نصفي (Midterm)',
      'فحص عملي / مخبري',
      'امتحان تكميلي / بديل',
      'سبر معلومات / مذاكرة',
      'أخرى',
    ]);
    const halls = ((S.limits && S.limits.dropdowns && S.limits.dropdowns.halls) || []);

    const q = (U.examSchedule.filterQuery || '').trim().toLowerCase();
    const prog = U.examSchedule.filterProgram || '';
    const filtered = courses.filter((c) => {
      if (prog && String(c.programId) !== String(prog)) return false;
      if (!q) return true;
      return `${c.code} ${c.name} ${c.programName || ''} ${c.instructor || ''}`.toLowerCase().includes(q);
    });

    const rowsHtml = filtered.map((c, idx) => {
      const r = U.examSchedule.rows[c.id] || {
        included: true,
        date: U.examSchedule.startDate,
        time: '09:00',
        duration: 120,
        hall: halls[idx % halls.length] || '',
        proctor: c.instructor || 'لجنة المراقبة',
      };
      return `<tr data-exm-cid="${c.id}">
        <td><input type="checkbox" class="exm-inc" ${r.included !== false ? 'checked' : ''} aria-label="تضمين المقرر"></td>
        <td class="mono" dir="ltr"><b>${esc(c.code)}</b></td>
        <td><b>${esc(c.name)}</b><div class="small">${esc(c.programName || c.faculty || '')} · السنة ${esc(c.levelLabel || c.level || '')}${r.savedId ? ' · <span class="pill p-approved">محفوظ</span>' : ''}</div></td>
        <td><select class="exm-group" aria-label="فئة الطلاب"><option value="">كل الطلاب</option>${(U.examSchedule.groups || []).map((g) => `<option value="${g.id}"${g.id === r.groupId ? ' selected' : ''}>${esc(g.name)} (${g.count})</option>`).join('')}</select></td>
        <td><input type="date" class="exm-date" value="${esc(r.date || U.examSchedule.startDate)}" dir="ltr" required></td>
        <td><input type="time" class="exm-time" value="${esc(r.time || '09:00')}" dir="ltr" style="width:105px"></td>
        <td><input type="number" class="exm-dur" min="30" max="300" step="15" value="${r.duration || 120}" style="width:75px"> د</td>
        <td>
          <select class="exm-hall">
            ${halls.map((h) => `<option value="${esc(h)}"${h === r.hall ? ' selected' : ''}>${esc(h)}</option>`).join('')}
          </select>
        </td>
        <td><input type="number" class="exm-cap" min="0" value="${Number(r.capacity) || 0}" style="width:75px" aria-label="سعة القاعة"></td>
        <td><input type="text" class="exm-proc" value="${esc(r.proctor || '')}" placeholder="اسم المراقب / المدرس" style="min-width:140px"></td>
      </tr>`;
    }).join('');

    return `<section class="card" id="master-exam-builder-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0;color:#054239">الجدولة الجماعية للامتحانات وإصدار ملف PDF</h2>
          <p class="hint" style="margin:4px 0 0">فورم موحد يحتوي على كافة المقررات الدراسية في الجامعة مع تحديد تاريخ الفحص، الساعة، القاعة، والمراقب لكل مادة، مع إمكانية التوزيع التلقائي للتواريخ وإنشاء ملف PDF مصدّق للطباعة والنشر.</p>
        </div>
        <div class="actions" style="margin:0">
          <button type="button" class="btn" data-act="exmautodates">📅 توزيع تلقائي لتواريخ الفحص</button>
          <button type="button" class="btn pri" data-act="exmsaveall">💾 حفظ جدول الفحص (${filtered.length} مادة)</button>
          <button type="button" class="btn ok" data-act="exmpdf">📄 إنشاء وتصدير ملف PDF لجدول الفحص</button>
        </div>
      </div>

      <div class="inline-form" style="margin-top:14px;padding:14px;background:#F6F8F5;border:1px solid #DCE3DD;border-radius:12px">
        <label>نوع الفحص / الدورة الامتحانية
          <select id="exm-type">
            ${examTypes.map((t) => `<option value="${esc(t)}"${t === U.examSchedule.examType ? ' selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
        </label>
        <label>العام الدراسي
          <input id="exm-year" value="${esc(U.examSchedule.academicYear)}" dir="ltr" style="width:120px">
        </label>
        <label>الفصل الدراسي
          <select id="exm-sem">
            <option value="الفصل الأول"${U.examSchedule.semester === 'الفصل الأول' ? ' selected' : ''}>الفصل الأول</option>
            <option value="الفصل الثاني"${U.examSchedule.semester === 'الفصل الثاني' ? ' selected' : ''}>الفصل الثاني</option>
            <option value="الدورة الصيفية / التكميلية"${U.examSchedule.semester === 'الدورة الصيفية / التكميلية' ? ' selected' : ''}>الدورة الصيفية / التكميلية</option>
            <option value="أخرى">أخرى</option>
          </select>
        </label>
        <label>تاريخ بدء أول امتحان (للتوزيع الآلي)
          <input id="exm-start-date" type="date" value="${esc(U.examSchedule.startDate)}" dir="ltr">
        </label>
        <label style="flex:1;min-width:200px">بحث فوري في المواد
          <input id="exm-filter-q" type="search" value="${esc(U.examSchedule.filterQuery)}" placeholder="ابحث باسم المادة أو الرمز أو المدرس...">
        </label>
      </div>

      <div class="tbl-wrap" style="margin-top:14px;max-height:520px;overflow:auto">
        <table id="exm-master-table">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" id="exm-toggle-all" checked title="تحديد / إلغاء تحديد الكل"></th>
              <th>الرمز</th>
              <th>المادة الدراسية والبرنامج</th>
              <th>فئة الطلاب</th>
              <th>تاريخ الفحص</th>
              <th>وقت البدء</th>
              <th>المدة</th>
              <th>القاعة الامتحانية</th>
              <th>السعة</th>
              <th>المراقب / مدرس المقرر</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="10" class="empty">لا توجد مواد مطابقة للبحث.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>`;
  };

  /* دمج منظومة إنشاء الفحص وميزات التطوير الأكاديمي في قسم «المواد والعلامات والامتحانات» */
  const origAcadLoader = UA.loaders.academics;
  const origAcadView = UA.views.academics;
  UA.loaders.academics = async () => {
    await Promise.all([
      origAcadLoader ? origAcadLoader().catch(() => {}) : Promise.resolve(),
      UA.loaders.enterprise ? UA.loaders.enterprise().catch(() => {}) : Promise.resolve(),
      U.acadTab === 'members' && UA.loadFacultyMembers ? UA.loadFacultyMembers().catch(() => {}) : Promise.resolve(),
    ]);
  };

  function renderGpaSimBlock() {
    const es = (window.UA && window.UA.enterpriseData) || {};
    const plan = es.advisingPlan || [];
    const sim = U.gpaSimCalc || { curGpa: '', hrs: '', expGpa: null, letter: '—', delta: '—' };

    return `<section class="card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px">
          <span>🎓 محاكي المعدل التراكمي المتوقع وشجرة الخطة (GPA Simulator)</span>
        </h2>
        <span style="background:#054239;color:#D5B65D;font-weight:800;font-size:11px;padding:3px 9px;border-radius:6px;font-family:monospace">ميزة #3 المنقولة</span>
      </div>
      <p class="sub" style="margin-top:0;color:#566660;font-size:13px">خريطة الخطة الدراسية وترابط المتطلبات السابقة مع محاكاة فورية للمعدل التراكمي المتوقع نهاية الفصل.</p>
      
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-top:14px">
        <div>
          <h3 style="font-size:14px;margin:0 0 10px">شجرة الخطة الدراسية والمتطلبات السابقة (Prerequisites)</h3>
          ${plan.length ? '' : '<p class="hint">تظهر الخطة للطالب من مقررات برنامجه وعلاماته المعتمدة.</p>'}
          ${plan.map((item) => {
            const cls = item.status === 'منجز' ? 'p-approved' : item.status === 'مسجل حالياً' ? 'p-review' : '';
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px;border:1px solid #DCE3DD;margin-bottom:8px;background:rgba(14,102,85,.02)">
              <div>
                <strong class="mono">${esc(item.code)}</strong> — <b>${esc(item.name)}</b>
                <div class="small" style="color:#566660">السنة ${item.year} · ${item.credits} ساعات معتمدة · المتطلب: <span class="mono">${esc(item.prereq)}</span></div>
              </div>
              <div style="text-align:end">
                <span class="pill ${cls}">${esc(item.status)}</span>
                ${item.grade ? `<div style="font-weight:800;color:#0e6655;font-size:12px;margin-top:3px">العلامة: ${item.grade}%</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
        <div>
          <h3 style="font-size:14px;margin:0 0 10px">حاسبة ومحاكي المعدل التراكمي المتوقع (Interactive GPA Calculator)</h3>
          <form id="gpa-sim-calc-form" class="form" style="background:rgba(14,102,85,.04);padding:14px;border-radius:12px;border:1px solid #DCE3DD">
            <div class="inline-form" style="gap:10px">
              <label>المعدل التراكمي الحالي (%)<input id="gpa-cur" type="number" step="0.1" value="${sim.curGpa}"></label>
              <label>الساعات المنجزة<input id="gpa-hrs" type="number" value="${sim.hrs}"></label>
            </div>
            <div class="inline-form" style="margin-top:10px;gap:8px">
              <label>توقع المقرر الأول (4 س)<input id="gpa-c1" type="number" min="0" max="100"></label>
              <label>توقع المقرر الثاني (3 س)<input id="gpa-c2" type="number" min="0" max="100"></label>
            </div>
            <button class="btn pri" type="button" data-act="calcgpasim" style="margin-top:12px;height:38px;width:100%">حساب وتوقع المعدل التراكمي</button>
          </form>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px">
            <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #0e6655;border-radius:10px;padding:12px">
              <small style="display:block;font-size:11.5px;color:#566660">المعدل التراكمي المتوقع</small>
              <strong style="font-size:22px;color:#054239;display:block;margin-top:2px">${sim.expGpa === null ? '—' : `${sim.expGpa}%`}</strong>
            </div>
            <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #0e6655;border-radius:10px;padding:12px">
              <small style="display:block;font-size:11.5px;color:#566660">التقدير الأكاديمي</small>
              <strong style="font-size:20px;color:#054239;display:block;margin-top:2px">${esc(sim.letter)}</strong>
            </div>
            <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #0e6655;border-radius:10px;padding:12px">
              <small style="display:block;font-size:11.5px;color:#566660">إجمالي الساعات بعد الفصل</small>
              <strong style="font-size:20px;color:#054239;display:block;margin-top:2px">${sim.hrs === '' ? '—' : `${Number(sim.hrs) + 7} ساعة`}</strong>
            </div>
            <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #1B7F4B;border-radius:10px;padding:12px">
              <small style="display:block;font-size:11.5px;color:#566660">مقدار التحسن المتوقع</small>
              <strong style="font-size:20px;color:#1B7F4B;display:block;margin-top:2px">${sim.delta}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>`;
  }

  UA.views.academics = () => {
    const cur = U.acadTab || (UA.can('grade:approve_own') && (!UA.can('grade:manage') || S.me?.role === 'admin') ? 'my_grades' : 'courses');
    const tabs = [
      ...(UA.can('grade:approve_own') ? [['my_grades', 'علامات موادي']] : []),
      ['courses', 'دليل المواد والمقررات'],
      ['grades', 'جدول العلامات'],
      ['gpa_sim', '🎓 محاكي المعدل التراكمي (GPA Simulator)'],
    ];
    if (UA.can('faculty:manage')) tabs.push(['members', 'أعضاء هيئة التدريس']);

    const bar = `<div class="sub-tabs no-print" role="tablist">
      ${tabs.map(([id, label]) => `<button class="chip" role="tab" data-act="acadtab" data-t="${id}" aria-pressed="${cur === id}">${label}</button>`).join('')}
    </div>`;

    if (cur === 'my_grades' && UA.renderMyGrades) return bar + UA.renderMyGrades();
    if (cur === 'gpa_sim') return bar + renderGpaSimBlock();
    if (cur === 'members' && UA.facultyView) return bar + UA.facultyView();
    return bar + (origAcadView ? origAcadView().replace(/<div class="sub-tabs[^"]*"[^>]*>[\s\S]*?<\/div>/, '') : '');
  };

  UA.examBuilder = { ensureExamCoursesLoaded, syncExamDomToState, generateExamSchedulePdf, loadSavedExams, applySavedExams, refreshExamBuilder, canScheduleExams };
})();
