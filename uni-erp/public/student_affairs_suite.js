/* ============================================================================
   منظومة شؤون الطلاب المتكاملة المطورة (Student Affairs Suite v12.6)
   تدمج وتحدّث وحدة «شؤون الطلاب» (affairs) وبوابة الطالب (tx) والسجل الموحّد 360°:
   1. بوابة القبول والمفاضلة الإلكترونية الذكية + محرك معادلة المقررات للطلاب المحولين
   2. شجرة الخطة الدراسية التفاعلية (Prerequisite Tree) + الإرشاد الأكاديمي والإنذار المبكر
   3. أتمتة حركات الوضع الطلابي (تأجيل/إيقاف/انسحاب/إعادة قيد/تحويل) + سجل الانضباط المسلكي المدمج مع student_holds
   5. محرك المنح والإعفاءات والرعاية الطلابية المدمج آلياً مع الحسابات المالية (fin_charges)
   6. تحديث مكتب خدمة الطالب الموحد: نظام حجز المواعيد والدور الذكي + شريط تتبع المعاملة الحي ذو الـ 5 مراحل
   ============================================================================ */
(function () {
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, fmt, val, toast, can } = UA;
  const nf = new Intl.NumberFormat('en-US');

  const SA = {
    data: null,
    loading: false,
    selectedStudentId: null,
  };

  async function loadSuiteData(studentId) {
    try {
      const sid = studentId || SA.selectedStudentId || '';
      const q = sid ? `?studentId=${encodeURIComponent(sid)}` : '';
      SA.data = await api('GET', `/api/student-affairs-suite/overview${q}`);
      if (SA.data && SA.data.targetStudent && !SA.selectedStudentId) {
        SA.selectedStudentId = SA.data.targetStudent.id;
      }
    } catch (e) {
      console.warn('[student_affairs_suite] load notice:', e.message);
    }
  }

  UA.loadStudentAffairsSuite = loadSuiteData;

  // يُعرض أحدث السجلات فقط إذا زاد العدد عن حد القائمة، فيُذكر ذلك صراحة
  const listNote = (keys) => {
    const d = SA.data || {}, max = d.listMax, over = keys.map((k) => (d.totals || {})[k] || 0).filter((n) => max && n > max);
    return over.length ? `<p class="hint no-print">تُعرض أحدث ${nf.format(max)} سجل من أصل ${nf.format(Math.max(...over))}؛ وابحث عن طالب محدد لبقية سجلاته.</p>` : '';
  };

  // حقل الطالب: يبحث في القاعدة عند الكتابة (منتقي الطلاب الموحد) بدل قائمة بكل الطلاب
  const studentField = (id, label, student) => `<label>${label}<input id="${id}" data-student-picker value="${esc(student ? student.studentNo : '')}" placeholder="اكتب اسم الطالب أو رقمه الجامعي" autocomplete="off"></label>`;
  async function studentIdOf(id) {
    const v = val(id).trim();
    const fail = () => Object.assign(new Error('اختر طالباً واحداً من الاقتراحات باسمه أو رقمه الجامعي.'), { status: 400 });
    if (!v) throw fail();
    const list = (await api('GET', `/api/students?limit=5&q=${encodeURIComponent(v)}`)).students;
    const s = list.find((x) => x.studentNo === v) || (list.length === 1 ? list[0] : null);
    if (!s) throw fail();
    return s.id;
  }

  // ربط مقررين في الخطة، وتظليل ما يتطلبه المقرر وما يفتحه عند الضغط عليه
  UA.forms['sa-link-form'] = async () => {
    await api('POST', '/api/student-affairs-suite/prerequisites', {
      courseId: Number(document.getElementById('sa-link-course').value),
      prereqCourseId: Number(document.getElementById('sa-link-prereq').value),
      minMark: document.getElementById('sa-link-mark').value,
    });
    await loadSuiteData();
    UA.render();
    toast('رُبط المقرران في الخطة');
  };
  document.addEventListener('click', (e) => {
    const node = e.target.closest && e.target.closest('[data-plan-node]');
    if (!node || e.target.closest('button')) return;
    const rel = new Set((node.dataset.planRel || '').split(' ').filter(Boolean));
    const wasOn = node.dataset.planOn === '1';
    document.querySelectorAll('[data-plan-node]').forEach((n) => {
      n.dataset.planOn = !wasOn && n === node ? '1' : '';
      n.style.opacity = wasOn || n === node || rel.has(n.dataset.planNode) ? '' : '.35';
    });
  });

  /* ---------- 6-أ. ترقية شريط تتبع المعاملة الحي إلى 5 مراحل تفصيلية ---------- */
  UA.steps5 = function (r) {
    const auto = r.rejectedBy === 'auto';
    const appts = (SA.data && SA.data.deskQueue && SA.data.deskQueue.appointments) || [];
    const appt = appts.find((a) => Number(a.request_id) === Number(r.id));
    const unitLabel = r.unit && r.unit.name ? r.unit.name : 'الكلية / القسم المختص';
    const docLabel = r.document && r.document.code ? `وثيقة (${r.document.code})` : 'المسجل العام والتوقيع PKI';
    const queueLabel = appt
      ? `تذكرة ${appt.ticket_no} (${appt.queue_status === 'completed' ? 'تم التسليم' : appt.queue_status === 'serving' ? 'يُخدم الآن' : appt.time_slot})`
      : r.status === 'approved'
      ? 'جاهز للتسليم / حجز موعد'
      : 'التسليم النهائي';

    const stages = [
      ['1. تقديم الطلب والفحص الآلي', auto ? 'fail' : 'done'],
      ['2. مراجعة شؤون الطلاب', auto ? '' : r.status === 'review' && !r.unit ? 'cur' : 'done'],
      [`3. اعتماد (${unitLabel})`, auto ? '' : r.status === 'review' && r.unit ? 'cur' : r.status === 'approved' ? 'done' : r.status === 'rejected' ? 'fail' : ''],
      [`4. ${docLabel}`, r.status === 'approved' ? 'done' : r.status === 'rejected' && !auto ? 'fail' : ''],
      [`5. ${queueLabel}`, appt && appt.queue_status === 'completed' ? 'done' : appt ? 'cur' : r.status === 'approved' ? 'done' : ''],
    ];
    return '<ol class="steps steps-5" style="margin-top:10px">' + stages.map((x) => `<li class="${x[1]}">${esc(x[0])}</li>`).join('') + '</ol>';
  };

  // ترقية UA.steps الافتراضية في كامل النظام لتعكس المراحل الخمس
  UA.steps = UA.steps5;

  /* ---------- شريط المؤشرات التنفيذي لشؤون الطلاب ---------- */
  function suiteKpiStrip() {
    if (!SA.data || !SA.data.kpis) return '';
    const k = SA.data.kpis;
    return `
      <div class="stats" style="margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        <div class="stat" style="border-inline-start:4px solid #0E6655">
          <small>متقدمو المفاضلة المقبولون</small>
          <b>${k.acceptedApplicants} <span class="small" style="font-weight:normal">/ ${k.totalApplicants}</span></b>
        </div>
        <div class="stat" style="border-inline-start:4px solid #0A5A4D">
          <small>مقررات معادلة معتمدة</small>
          <b>${k.approvedEquivalences}</b>
        </div>
        <div class="stat" style="border-inline-start:4px solid #8A6A1B">
          <small>إنذارات أكاديمية قيد المتابعة</small>
          <b>${k.activeWarnings}</b>
        </div>
        <div class="stat" style="border-inline-start:4px solid #0A5A4D">
          <small>حركات قيد وانضباط</small>
          <b>${k.lifecycleMovementsCount} <span class="small" style="font-weight:normal">(${k.activeHoldsCount} حجب)</span></b>
        </div>
        <div class="stat" style="border-inline-start:4px solid #D5B65D">
          <small>المنح والإعفاءات الفعالة</small>
          <b>${k.activeScholarshipsCount} <span class="small" style="font-weight:normal">(${nf.format(k.totalScholarshipAmount)} ل.س)</span></b>
        </div>
        <div class="stat" style="border-inline-start:4px solid #1B7F4B">
          <small>تذاكر الدور الذكي النشطة</small>
          <b>${k.servingTicketsCount + k.waitingTicketsCount} <span class="small" style="font-weight:normal">(${k.servingTicketsCount} يُخدم الآن)</span></b>
        </div>
      </div>
    `;
  }

  /* ============================================================================
     التبويب 1: بوابة القبول والمفاضلة الإلكترونية الذكية ومعادلة المواد
     ============================================================================ */
  function renderAdmissionsTab() {
    const d = SA.data;
    if (!d) return '<div class="empty">جارٍ تحميل بيانات القبول والمفاضلة…</div>';
    const progs = d.programs || [];
    const apps = d.admissions.applicants || [];
    const eqs = d.admissions.equivalences || [];
    const eqSum = d.admissions.equivalenceSummary || { approvedCoursesCount: 0, earnedHours: 0, remainingHours: 132, completionPercent: 0 };
    const students = d.students || [];
    const courses = d.courses || [];

    const catLabel = {
      general: 'مفاضلة عامة',
      parallel: 'تعليم موازي',
      martyrs: 'أبناء وذوو الشهداء (+8 درجات)',
      transfer: 'انتقال وتحويل جامعي',
    };
    const statusBadge = {
      pending: '<span class="pill p-review">بانتظار الفرز</span>',
      accepted: '<span class="pill p-approved">مقبول بالمفاضلة ✓</span>',
      waitlisted: '<span class="pill p-review">قائمة احتياط</span>',
      rejected: '<span class="pill p-rejected">مرفوض (مجموع أدنى)</span>',
      enrolled: '<span class="pill p-approved" style="background:#054239;color:#fff">تم تثبيت القيد كطالب ★</span>',
      enrolling: '<span class="pill p-review">جارٍ التثبيت</span>',
    };

    const progOptions = progs.map((p) => `<option value="${p.id}">${esc(p.faculty)} — ${esc(p.name)} (حد أدنى: ${p.minScore})</option>`).join('');

    return `
      <div class="sa-suite-section" data-testid="sa-admissions-section" style="margin-top:16px;display:grid;gap:16px">
        <!-- أ. بطاقة الفرز الآلي للمفاضلة -->
        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
            <div>
              <h2 style="margin:0">1. بوابة القبول والمفاضلة الإلكترونية الذكية (Smart Admissions & Auto-Sorting)</h2>
              <p class="hint" style="margin:4px 0 0">فرز آلي للمتقدمين حسب المجموع الموزون، أولوية أبناء الشهداء، الرغبات الثلاث، والطاقة الاستيعابية لكل كلية مع تثبيت القيد الفوري.</p>
            </div>
            <div class="actions" style="margin:0">
              <button class="btn pri" data-act="sa-run-sort" data-testid="sa-run-sort-btn">⚡ تشغيل محرك الفرز والمفاضلة الآلي</button>
            </div>
          </div>

          <!-- خطة القبول: الحد الأدنى والمقاعد لكل برنامج -->
          <details style="margin-bottom:14px;background:rgba(14,102,85,0.05);border:1px solid rgba(14,102,85,0.2);border-radius:10px;padding:10px 14px">
            <summary style="cursor:pointer;font-weight:bold;color:#054239">خطة القبول لكل برنامج (الحد الأدنى والمقاعد)</summary>
            <p class="hint">المقاعد المشغولة هي طلاب دفعة هذه السنة فقط. اترك الحقل فارغاً لاستخدام القيمة الافتراضية من الإعدادات العامة.</p>
            <div class="tbl-wrap"><table><thead><tr><th>البرنامج</th><th>المشغول</th><th>الحد الأدنى</th><th>المقاعد</th><th></th></tr></thead><tbody>
              ${progs.map((p) => `<tr><td>${esc(p.faculty)} — ${esc(p.name)}</td><td>${p.enrolledCount} / ${p.capacity}</td><td><input id="sa-plan-min-${p.id}" type="number" step="0.5" min="1" style="width:100px" value="${p.admission_min_score ?? ''}" placeholder="${p.minScore}"></td><td><input id="sa-plan-cap-${p.id}" type="number" min="0" style="width:100px" value="${p.admission_capacity ?? ''}" placeholder="${p.capacity}"></td><td><button class="btn sm" type="button" data-act="sa-save-plan" data-id="${p.id}">حفظ</button></td></tr>`).join('')}
            </tbody></table></div>
          </details>

          <!-- نموذج إضافة متقدم جديد للمفاضلة -->
          <details style="margin-bottom:14px;background:rgba(14,102,85,0.05);border:1px solid rgba(14,102,85,0.2);border-radius:10px;padding:10px 14px">
            <summary style="cursor:pointer;font-weight:bold;color:#054239">＋ تسجيل طلب متقدم جديد للمفاضلة الجامعية</summary>
            <div class="inline-form" style="margin-top:12px">
              <label>الاسم الثلاثي للمتقدم<input id="sa-app-name" placeholder="مثال: طارق زياد العبدالله"></label>
              <label>الرقم الوطني<input id="sa-app-nid" dir="ltr" placeholder="01010099881"></label>
              <label>الهاتف<input id="sa-app-phone" dir="ltr" placeholder="0944123456"></label>
              <label>الفرع الثانوي<select id="sa-app-hstype"><option value="علمي">علمي</option><option value="أدبي">أدبي</option><option value="معلوماتية">معلوماتية</option></select></label>
              <label>مجموع الثانوية (من 240)<input id="sa-app-score" type="number" step="0.5" min="100" max="240"></label>
              <label>فئة المفاضلة<select id="sa-app-cat">
                <option value="general">مفاضلة عامة</option>
                <option value="parallel">تعليم موازي</option>
                <option value="martyrs">أبناء الشهداء (+8 درجات)</option>
                <option value="transfer">انتقال / تحويل جامعي</option>
              </select></label>
              <label>الرغبة الأولى<select id="sa-app-p1">${progOptions}</select></label>
              <label>الرغبة الثانية<select id="sa-app-p2">${progOptions}</select></label>
              <button class="btn pri" type="button" data-act="sa-add-applicant" data-testid="sa-add-applicant-btn">إضافة للمفاضلة</button>
            </div>
          </details>

          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم المفاضلة</th>
                  <th>اسم المتقدم</th>
                  <th>الفئة</th>
                  <th>المجموع</th>
                  <th>الرغبة الأولى</th>
                  <th>البرنامج المقبول فيه</th>
                  <th>نتيجة المفاضلة</th>
                  <th>إجراء التثبيت</th>
                </tr>
              </thead>
              <tbody>
                ${apps
                  .map(
                    (a) => `
                  <tr>
                    <td class="mono">${esc(a.application_no)}</td>
                    <td><b>${esc(a.full_name)}</b><div class="small mono">${esc(a.national_id)}</div></td>
                    <td>${esc(catLabel[a.category] || a.category)}</td>
                    <td><b>${a.hs_score}</b> <span class="small">(${esc(a.hs_type)})</span></td>
                    <td>${esc(a.pref1Name || '—')}</td>
                    <td><b>${esc(a.acceptedProgramName || '—')}</b></td>
                    <td>${statusBadge[a.sorting_status] || esc(a.sorting_status)}</td>
                    <td>
                      ${
                        a.sorting_status === 'enrolled'
                          ? `<span class="mono small">الرقم الجامعي: <b>${esc(a.enrolledStudentNo || 'مقيَّد')}</b></span>`
                          : a.sorting_status === 'accepted'
                          ? `<button class="btn ok sm" data-act="sa-enroll-app" data-id="${a.id}">تثبيت القيد كطالب نظامي</button>`
                          : `<span class="small">شغّل الفرز أولاً</span>`
                      }
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>

        <!-- ب. محرك معادلة المقررات للطلاب المحولين -->
        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
            <div>
              <h2 style="margin:0">محرك معادلة المقررات للطلاب المحولين (Transfer Credit Equivalence Engine)</h2>
              <p class="hint" style="margin:4px 0 0">مطابقة المقررات المدروسة في جامعة سابقة مع الخطة الدراسية المعتمدة، وإعفاء الطالب منها آلياً في سجل العلامات.</p>
            </div>
            <div class="stats" style="margin:0;display:flex;gap:10px">
              <div class="stat" style="padding:6px 12px"><small>الساعات المعادلة</small><b>${eqSum.earnedHours} س</b></div>
              <div class="stat" style="padding:6px 12px"><small>الساعات المتبقية للتخرج</small><b>${eqSum.remainingHours} س</b></div>
              <div class="stat" style="padding:6px 12px"><small>نسبة الإنجاز المعادل</small><b>${eqSum.completionPercent}%</b></div>
            </div>
          </div>

          <div class="inline-form" style="margin-bottom:14px;background:rgba(53,108,138,0.06);padding:12px;border-radius:10px">
            ${studentField('sa-eq-student', 'الطالب المحول', d.targetStudent)}
            <label>الجامعة المصدر<input id="sa-eq-uni" placeholder="مثال: جامعة دمشق — كلية الحقوق"></label>
            <label>رمز المقرر الخارجي<input id="sa-eq-code" dir="ltr" placeholder="LAW204"></label>
            <label>اسم المقرر الخارجي<input id="sa-eq-name" placeholder="مثال: أمن نظم التشغيل"></label>
            <label>الساعات<input id="sa-eq-hrs" type="number" min="1" max="6"></label>
            <label>العلامة (من 100)<input id="sa-eq-mark" type="number" min="60" max="100"></label>
            <label>المقرر المقابل في جامعتنا<select id="sa-eq-course">${courses.map((c) => `<option value="${c.id}">${esc(c.name)} (سنة ${c.level} · ${c.hours} س)</option>`).join('')}</select></label>
            <button class="btn pri" type="button" data-act="sa-add-eq" data-testid="sa-add-eq-btn">اعتماد المعادلة وإدراج العلامة</button>
          </div>

          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>الجامعة السابقة</th>
                  <th>المقرر الخارجي</th>
                  <th>الساعات</th>
                  <th>العلامة</th>
                  <th>المقرر المعادل في الخطة</th>
                  <th>جهة القرار</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                ${eqs
                  .map(
                    (e) => `
                  <tr>
                    <td><b>${esc(e.studentName || '—')}</b><div class="small mono">${esc(e.studentNo || '')}</div></td>
                    <td>${esc(e.source_university)}</td>
                    <td><b>${esc(e.external_course_name)}</b> <span class="mono small">(${esc(e.external_course_code)})</span></td>
                    <td>${e.external_hours}</td>
                    <td><b>${e.external_mark}%</b></td>
                    <td><b>${esc(e.internalCourseName || '—')}</b></td>
                    <td class="small">${esc(e.decided_by || 'اللجنة العلمية')}</td>
                    <td><span class="pill p-approved">معادل ومعتمد ✓</span></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  /* ============================================================================
     التبويب 2: شجرة الخطة الدراسية التفاعلية والإرشاد الأكاديمي والإنذار المبكر
     ============================================================================ */
  function renderAdvisingTab() {
    const d = SA.data;
    if (!d) return '<div class="empty">جارٍ تحميل الخطة الدراسية والإرشاد الأكاديمي…</div>';
    const students = d.students || [];
    const tree = d.advising.degreeTree || { nodes: [], summary: {} };
    const sm = tree.summary || {};
    const warnings = d.advising.warnings || [];
    const atRisk = d.advising.autoDetectedAtRisk || [];

    const stateMeta = {
      completed: { badge: 'منجز بنجاح ✅', cls: 'p-approved', border: '#1B7F4B', bg: 'rgba(27,127,75,0.08)' },
      in_progress: { badge: 'مسجل حالياً 📘', cls: 'p-review', border: '#0A5A4D', bg: 'rgba(59,130,246,0.08)' },
      available: { badge: 'متاح للتسجيل 🔓', cls: 'p-approved', border: '#D5B65D', bg: 'rgba(213,182,93,0.10)' },
      locked: { badge: 'محجوب بمتطلب سابق 🔒', cls: 'p-rejected', border: '#B3261E', bg: 'rgba(239,68,68,0.06)' },
    };

    const warnTypeLabel = {
      gpa_low: 'انخفاض المعدل التراكمي (GPA < 60%)',
      repeated_fail: 'تعثر متكرر في مقررات أساسية',
      absence_high: 'تجاوز نسبة الغياب المسموحة (> 15%)',
    };

    return `
      <div class="sa-suite-section" data-testid="sa-advising-section" style="margin-top:16px;display:grid;gap:16px">
        <!-- أ. شجرة الخطة الدراسية والمتطلبات السابقة التفاعلية -->
        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
            <div>
              <h2 style="margin:0">2. شجرة الخطة الدراسية التفاعلية والمتطلبات السابقة (Interactive Prerequisite Tree)</h2>
              <p class="hint" style="margin:4px 0 0">خريطة مقررات الطالب: المنجز، والمسجل حالياً، والمتاح، والمحجوب بمتطلب سابق. اضغط مقرراً لتظليل ما يتطلبه وما يفتحه.</p>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <label style="margin:0;font-weight:bold">استعراض خطة الطالب:
                <input id="sa-tree-student" data-student-picker style="min-width:230px" value="${esc(d.targetStudent ? d.targetStudent.studentNo : '')}" placeholder="اسم الطالب أو رقمه الجامعي" autocomplete="off">
              </label>
            </div>
          </div>

          <div class="stats" style="margin-bottom:14px">
            <div class="stat"><small>منجز بنجاح ✅</small><b>${sm.completedCount || 0} مقرر (${sm.completedHours || 0} س)</b></div>
            <div class="stat"><small>مسجل حالياً 📘</small><b>${sm.inProgressCount || 0} مقرر (${sm.inProgressHours || 0} س)</b></div>
            <div class="stat"><small>متاح للتسجيل 🔓</small><b>${sm.availableCount || 0} مقرر (${sm.availableHours || 0} س)</b></div>
            <div class="stat"><small>محجوب بمتطلب 🔒</small><b>${sm.lockedCount || 0} مقرر (${sm.lockedHours || 0} س)</b></div>
          </div>

          ${UA.can('course:manage') || UA.can('sa_advising:edit') ? `<form id="sa-link-form" class="inline-form" style="margin-bottom:14px;padding:12px;background:var(--surface2,#F6F8F5);border:1px solid var(--line,#DCE3DD);border-radius:10px;gap:10px;align-items:flex-end">
            <label style="flex:2;min-width:200px">المقرر<select id="sa-link-course" data-no-other="1" required>${tree.nodes.map((n) => `<option value="${n.id}">${esc(n.code)} — ${esc(n.name)} (س${n.level})</option>`).join('')}</select></label>
            <label style="flex:2;min-width:200px">يتطلب اجتياز<select id="sa-link-prereq" data-no-other="1" required>${tree.nodes.map((n) => `<option value="${n.id}">${esc(n.code)} — ${esc(n.name)} (س${n.level})</option>`).join('')}</select></label>
            <label style="width:110px">علامة الاجتياز<input id="sa-link-mark" type="number" min="0" max="100"></label>
            <button class="btn pri" type="submit">ربط المقررين</button>
          </form>` : ''}
          <div id="sa-plan-nodes" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">
            ${tree.nodes
              .map((n) => {
                const st = stateMeta[n.state] || stateMeta.available;
                const related = [...n.prerequisites.map((p) => p.id), ...n.unlocks.map((u) => u.id)].join(' ');
                return `
                  <article data-plan-node="${n.id}" data-plan-rel="${related}" tabindex="0" style="cursor:pointer;border:1px solid ${st.border};border-inline-start:5px solid ${st.border};background:${st.bg};border-radius:10px;padding:12px;display:flex;flex-direction:column;justify-content:space-between;gap:8px">
                    <div>
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
                        <span class="mono small" style="font-weight:bold">${esc(n.code)} · السنة ${n.level} / ف${n.semester}</span>
                        <span class="pill ${st.cls}" style="font-size:11px">${st.badge}</span>
                      </div>
                      <h4 style="margin:6px 0 2px;font-size:15px">${esc(n.name)}</h4>
                      <div class="small">${n.hours} ساعات معتمدة · ${esc(n.instructor)}</div>
                    </div>
                    <div style="border-top:1px dashed rgba(0,0,0,0.12);padding-top:6px;font-size:12px">
                      ${
                        n.mark !== null
                          ? `<b>العلامة المعتمدة: ${n.mark}%</b>`
                          : n.missingPrereqs && n.missingPrereqs.length
                          ? `<span style="color:#B3261E;font-weight:bold">يتطلب اجتياز: ${esc(n.missingPrereqs.join('، '))}</span>`
                          : n.prerequisites && n.prerequisites.length
                          ? `<span style="color:#0E6655">✓ المتطلب السابق مجتاز (${esc(n.prerequisites.map((p) => p.name).join('، '))})</span>`
                          : '<span class="hint">بدون متطلب سابق — متاح</span>'
                      }
                      ${n.prerequisites.length ? `<div style="margin-top:6px">يتطلب: ${n.prerequisites.map((p) => `<span class="pill" style="font-size:11px">${esc(p.code)} (${p.minMark}%)${UA.can('course:manage') || UA.can('sa_advising:edit') ? ` <button type="button" class="link" data-act="sa-unlink" data-id="${p.linkId}" aria-label="إزالة الربط" style="color:#B3261E;font-weight:700">×</button>` : ''}</span>`).join(' ')}</div>` : ''}
                      ${n.unlocks.length ? `<div style="margin-top:4px">يفتح: ${n.unlocks.map((u) => `<span class="mono small">${esc(u.code)}</span>`).join('، ')}</div>` : ''}
                    </div>
                  </article>
                `;
              })
              .join('')}
          </div>
        </section>

        <!-- ب. نظام الإنذار الأكاديمي المبكر وجلسات الإرشاد -->
        <section class="card">
          <h2>نظام الإنذار الأكاديمي المبكر وجلسات الإرشاد الإلزامية (Early Academic Warning & Advising)</h2>
          <p class="hint" style="margin-top:0">يرصد النظام تلقائياً الطلاب ذوي المعدل التراكمي المنخفض أو المواد الراسبة أو الغياب المرتفع لجدولة جلسات إرشاد أكاديمي موثقة.</p>

          ${
            atRisk.length
              ? `<div class="reason" style="margin-bottom:14px;background:rgba(217,119,6,0.1);border-color:#8A6A1B;color:inherit">
                  <b>⚠️ رصد آلي من سجل العلامات (${d.advising.atRiskTotal ?? atRisk.length} طالباً بحاجة لمتابعة إرشادية${(d.advising.atRiskTotal ?? 0) > atRisk.length ? `؛ يُعرض أضعف ${atRisk.length}` : ''}):</b>
                  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
                    ${atRisk.map((r) => `<span class="pill p-review" style="white-space:normal;max-width:100%">${esc(r.name)} (${esc(r.studentNo)}) · المعدل: ${r.gpa ?? '—'}% · راسب: ${r.failedCount}</span>`).join('')}
                  </div>
                </div>`
              : ''
          }

          <div class="inline-form" style="margin-bottom:14px;background:rgba(217,119,6,0.06);padding:12px;border-radius:10px">
            ${studentField('sa-adv-student', 'الطالب')}
            <label>سبب الإنذار المبكر<select id="sa-adv-type">
              <option value="gpa_low">انخفاض المعدل التراكمي (GPA &lt; 60%)</option>
              <option value="absence_high">تجاوز نسبة الغياب المسموحة (&gt; 15%)</option>
              <option value="repeated_fail">تعثر متكرر في المقررات</option>
            </select></label>
            <label>درجة الخطورة<select id="sa-adv-sev">
              <option value="warning">تنبيه إرشادي أول</option>
              <option value="probation">إنذار أكاديمي رسمي (Probation)</option>
              <option value="critical">خطر فصل / استنفاد فرص</option>
            </select></label>
            <label>المرشد الأكاديمي<input id="sa-adv-advisor"></label>
            <label class="wide">خطة المعالجة والتوصية الإرشادية<input id="sa-adv-plan" placeholder="مثال: تحديد العبء بـ 12 ساعة وإلزام الطالب بحضور الساعات المكتبية الأسبوعية"></label>
            <button class="btn pri" type="button" data-act="sa-add-advising" data-testid="sa-add-advising-btn">توثيق جلسة الإرشاد والإنذار</button>
          </div>

          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>نوع الإنذار</th>
                  <th>المعدل / الغياب</th>
                  <th>المرشد الأكاديمي</th>
                  <th>الخطة العلاجية المتفق عليها</th>
                  <th>تاريخ الجلسة</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${warnings
                  .map(
                    (w) => `
                  <tr>
                    <td><b>${esc(w.studentName || '—')}</b><div class="small mono">${esc(w.studentNo || '')}</div></td>
                    <td><b>${esc(warnTypeLabel[w.warning_type] || w.warning_type)}</b></td>
                    <td class="small">معدل: <b>${w.gpa_snapshot ?? '—'}%</b> · غياب: <b>${w.absence_rate ?? 0}%</b></td>
                    <td>${esc(w.advisor_name)}</td>
                    <td>${esc(w.action_plan)}</td>
                    <td class="mono small">${esc(w.session_date)}</td>
                    <td>${w.status === 'resolved' ? '<span class="pill p-approved">تمت المعالجة ✓</span>' : '<span class="pill p-rejected">إنذار نشط</span>'}</td>
                    <td>${UA.rowPrintBtn('إنذار أكاديمي وخطة إرشاد', 'شؤون الطلاب', 'الطالب|المرشد الأكاديمي|مدير شؤون الطلاب')}${w.status !== 'resolved' ? `<button class="btn sm ok" data-act="sa-resolve-adv" data-id="${w.id}">إغلاق الإنذار</button>` : ''}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  /* ============================================================================
     التبويب 3: أتمتة حركات الوضع الطلابي وسجل الانضباط المسلكي
     ============================================================================ */
  function renderLifecycleTab() {
    const d = SA.data;
    if (!d) return '<div class="empty">جارٍ تحميل حركات القيد وسجل الانضباط…</div>';
    const students = d.students || [];
    const progs = d.programs || [];
    const movs = d.lifecycle.movements || [];
    const holds = d.lifecycle.disciplinaryRecords || [];

    const movTypeLabel = {
      postponement: 'تأجيل فصل دراسي',
      suspension: 'إيقاف قيد طلابي',
      withdrawal: 'انسحاب وطي قيد',
      reinstatement: 'إعادة قيد ومباشرة',
      program_transfer: 'تحويل تخصص داخلي',
    };

    const statusAr = d.lifecycle.statuses || { active: 'مقيَّد', suspended: 'موقوف القيد', withdrawn: 'منسحب', transferred: 'محوَّل', graduated: 'متخرج' };

    return `
      <div class="sa-suite-section" data-testid="sa-lifecycle-section" style="margin-top:16px;display:grid;gap:16px">
        <!-- أ. أتمتة حركات الوضع الطلابي -->
        <section class="card">
          <h2>3. أتمتة حركات الوضع الطلابي (تأجيل، إيقاف قيد، انسحاب، إعادة قيد، تحويل تخصص)</h2>
          <p class="hint" style="margin-top:0">يُحدِّث هذا المحرك حالة الطالب وبرنامجه في جدول <span class="mono">student_profiles</span> تلقائياً ويحتسب الأثر الأكاديمي والمالي للقرار.</p>

          <div class="inline-form" style="margin-bottom:14px;background:rgba(124,58,237,0.06);padding:12px;border-radius:10px">
            ${studentField('sa-mov-student', 'الطالب')}
            <label>نوع حركة القيد<select id="sa-mov-type">
              <option value="postponement">تأجيل فصل دراسي (يحوّل القيد إلى موقوف مؤقتاً)</option>
              <option value="suspension">إيقاف قيد نظامي</option>
              <option value="reinstatement">إعادة قيد وتفعيل (يحوّل القيد إلى مقيَّد فعّال)</option>
              <option value="program_transfer">تحويل تخصص داخلي إلى برنامج آخر</option>
              <option value="withdrawal">انسحاب نهائي وطي قيد</option>
            </select></label>
            <label>البرنامج الجديد (عند التحويل)<select id="sa-mov-prog">${progs.map((p) => `<option value="${p.id}">${esc(p.faculty)} — ${esc(p.name)}</option>`).join('')}</select></label>
            <label>مدة التأجيل (الحد الأقصى ${d.lifecycle.maxPostponementYears ?? 6} سنوات)<select id="sa-mov-dur"><option value="1">فصل واحد</option><option value="2">فصلان / سنة دراسية</option></select></label>
            <label>رقم القرار الإداري<input id="sa-mov-dec" placeholder="قرار مجلس كلية #0E4D2E"></label>
            <label class="wide">السبب الموثق<input id="sa-mov-reason" placeholder="مثال: ظروف صحية موثقة / رغبة الطالب بالتحويل واستيفاء شرط المعدل"></label>
            <button class="btn pri" type="button" data-act="sa-exec-movement" data-testid="sa-exec-movement-btn">تنفيذ الحركة وتحديث قيد الطالب فوراً</button>
          </div>

          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم الحركة</th>
                  <th>الطالب</th>
                  <th>نوع الحركة</th>
                  <th>تغير حالة القيد</th>
                  <th>الأثر الأكاديمي</th>
                  <th>الأثر المالي</th>
                  <th>رقم القرار</th>
                  <th>طباعة</th>
                </tr>
              </thead>
              <tbody>
                ${movs
                  .map(
                    (m) => `
                  <tr>
                    <td class="mono">${esc(m.movement_no)}</td>
                    <td><b>${esc(m.studentName || '—')}</b><div class="small mono">${esc(m.studentNo || '')}</div></td>
                    <td><b>${esc(movTypeLabel[m.movement_type] || m.movement_type)}</b></td>
                    <td><span class="pill p-review">${esc(statusAr[m.from_status] || m.from_status)}</span> ← <span class="pill p-approved">${esc(statusAr[m.to_status] || m.to_status)}</span></td>
                    <td class="small">${esc(m.academic_impact || '—')}</td>
                    <td class="small">${esc(m.financial_impact || '—')}</td>
                    <td class="small"><b>${esc(m.decision_no || '—')}</b><div class="small">${esc(m.reason || '')}</div></td>
                    <td>${UA.rowPrintBtn('قرار حركة قيد', 'شؤون الطلاب', 'الطالب|عميد الكلية|مدير شؤون الطلاب')}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>

        <!-- ب. سجل العقوبات والمخالفات المسلكية المدمج مع student_holds -->
        <section class="card"${d.access && !d.access.discipline ? ' hidden' : ''}>
          <h2>سجل اللجان الانضباطية والمخالفات المسلكية (مدمج مع نظام الحجب <span class="mono">student_holds</span>)</h2>
          <p class="hint" style="margin-top:0">أي عقوبة انضباطية نشطة تُدرج تلقائياً في جدول الموانع (<span class="mono">student_holds</span>) وتحجب إصدار الوثائق لحين تسويتها أو انتهاء مدتها.</p>

          <div class="inline-form" style="margin-bottom:14px;background:rgba(179,38,30,0.06);padding:12px;border-radius:10px">
            ${studentField('sa-disc-student', 'الطالب')}
            <label>رقم قرار لجنة الانضباط<input id="sa-disc-dec" dir="ltr"></label>
            <label>تصنيف المخالفة<select id="sa-disc-cat">
              <option value="exam_misconduct">مخالفة تعليمات امتحانية</option>
              <option value="attendance_breach">إخلال بنظام الدوام والانضباط</option>
              <option value="campus_conduct">مخالفة قواعد السلوك الجامعي</option>
            </select></label>
            <label>العقوبة المقررة<select id="sa-disc-pen">
              <option value="warning">إنذار مسلكي مسجل</option>
              <option value="exam_zero">إلغاء علامة مقرر امتحاني</option>
              <option value="term_suspension">حرمان فصل دراسي</option>
            </select></label>
            <label>تاريخ انتهاء الحجب<input id="sa-disc-exp" type="date"></label>
            <label class="wide">تفاصيل القرار والمخالفة<input id="sa-disc-note" placeholder="مثال: قرار لجنة الانضباط بحجب الوثائق غير العاجلة لنهاية الفصل"></label>
            <button class="btn bad" type="button" data-act="sa-add-disc" data-testid="sa-add-disc-btn">تسجيل العقوبة وتفعيل حجب الوثائق</button>
          </div>

          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>نوع الذمة / العقوبة</th>
                  <th>رقم قرار اللجنة</th>
                  <th>البيان والملاحظة</th>
                  <th>تاريخ الانتهاء</th>
                  <th>حالة الحجب</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                ${holds
                  .map(
                    (h) => `
                  <tr>
                    <td><b>${esc(h.studentName)}</b><div class="small mono">${esc(h.studentNo)}</div></td>
                    <td><span class="pill ${h.holdType === 'disciplinary' ? 'p-rejected' : 'p-review'}">${{ disciplinary: 'تأديبية مسلكية', financial: 'ذمة مالية', library: 'إعارة مكتبة' }[h.holdType] || h.holdType}</span></td>
                    <td class="mono small">${esc(h.decisionNo || '—')}</td>
                    <td>${esc(h.note)}</td>
                    <td class="mono small">${esc(h.expiresAt || '—')}</td>
                    <td>${h.active ? '<span class="bad-t">قائمة (تحجب الوثائق)</span>' : '<span class="ok-t">مسوّاة / مرفوعة ✓</span>'}</td>
                    <td>${UA.rowPrintBtn('قرار لجنة انضباطية', 'شؤون الطلاب', 'الطالب|رئيس اللجنة|مدير شؤون الطلاب')}${h.active ? `<button class="btn sm ok" data-act="sa-clear-hold" data-id="${h.holdId}">تسوية ورفع الحجب</button>` : ''}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  /* ============================================================================
     التبويب 5: المنح، الإعفاءات، والرعاية الطلابية (مدمجة آلياً مع المالية)
     ============================================================================ */
  function renderScholarshipsTab() {
    const d = SA.data;
    if (!d) return '<div class="empty">جارٍ تحميل بيانات المنح والإعفاءات…</div>';
    const students = d.students || [];
    const list = d.scholarships.list || [];

    const schTypeLabel = {
      merit_top: 'منحة التفوق الأكاديمي (أوائل الدفعات)',
      martyrs_kin: 'منحة أبناء وذوي الشهداء (100%)',
      sibling_discount: 'حسم الإخوة المسجلين بالجامعة (20%)',
      social_aid: 'صندوق التكافل والرعاية الطلابية (40%)',
    };

    return `
      <div class="sa-suite-section" data-testid="sa-scholarships-section" style="margin-top:16px;display:grid;gap:16px">
        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
            <div>
              <h2 style="margin:0">5. محرك المنح والإعفاءات والرعاية الطلابية (مدمج مع المالية <span class="mono">fin_charges</span>)</h2>
              <p class="hint" style="margin:4px 0 0">عند اعتماد أي منحة أو إعفاء لطالب هنا، يُنشئ النظام تلقائياً قيد خصم مزدوج في حسابات الطلاب ودفتر الأستاذ في وحدة المالية والمحاسبة.</p>
            </div>
          </div>

          <div class="inline-form" style="margin-bottom:14px;background:rgba(213,182,93,0.12);border:1px solid rgba(213,182,93,0.4);padding:12px;border-radius:10px">
            ${studentField('sa-sch-student', 'الطالب المستفيد')}
            <label>نوع المنحة / الإعفاء<select id="sa-sch-type">
              <option value="merit_top">منحة التفوق الأكاديمي (حسب المعدل GPA)</option>
              <option value="martyrs_kin">منحة أبناء الشهداء (إعفاء 100%)</option>
              <option value="sibling_discount">حسم الإخوة المسجلين بالجامعة (20%)</option>
              <option value="social_aid">إعفاء صندوق التكافل الاجتماعي (40%)</option>
            </select></label>
            <label>القسط الفصلي الأساسي (ل.س)<input id="sa-sch-tuition" type="number" step="50000"></label>
            <label>معدل الطالب الحالي (GPA %)<input id="sa-sch-gpa" type="number" step="0.1" min="50" max="100"></label>
            <label class="wide">ملاحظة قرار المنح<input id="sa-sch-note" placeholder="مثال: تفوق أكاديمي — المرتبة الأولى في السنة الدراسية"></label>
            <button class="btn pri" type="button" data-act="sa-grant-sch" data-testid="sa-grant-sch-btn">اعتماد المنحة وترحيل الخصم للمالية</button>
          </div>

          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم المنحة</th>
                  <th>الطالب</th>
                  <th>نوع المنحة / الإعفاء</th>
                  <th>المعدل عند المنح</th>
                  <th>نسبة الحسم</th>
                  <th>قيمة الخصم المالي</th>
                  <th>الربط المحاسبي (المالية)</th>
                  <th>الجهة المعتمدة</th>
                  <th>طباعة</th>
                </tr>
              </thead>
              <tbody>
                ${list
                  .map(
                    (s) => `
                  <tr>
                    <td class="mono">${esc(s.grant_no)}</td>
                    <td><b>${esc(s.studentName || '—')}</b><div class="small mono">${esc(s.studentNo || '')}</div></td>
                    <td><b>${esc(schTypeLabel[s.scholarship_type] || s.scholarship_type)}</b><div class="small">${esc(s.note || '')}</div></td>
                    <td>${s.gpa_at_grant ? `${s.gpa_at_grant}%` : '—'}</td>
                    <td><span class="pill ${s.status === 'revoked' ? 'p-rejected' : 'p-approved'}">${s.discount_percent}%${s.status === 'revoked' ? ' — ملغاة' : ''}</span></td>
                    <td><b>${nf.format(s.amount)} ل.س</b></td>
                    <td>
                      ${
                        s.fin_charge_id
                          ? `<span class="pill p-approved">مرحل لقيد مالي #${s.fin_charge_id} ✓</span>`
                          : `<span class="pill p-approved">مقيد في كشف حساب الطالب ✓</span>`
                      }
                    </td>
                    <td class="small">${esc(s.approved_by || 'لجنة المنح')}</td>
                    <td>${UA.rowPrintBtn('قرار منحة أو إعفاء', 'شؤون الطلاب', 'الطالب|لجنة المنح|المدير المالي')}${s.status === 'active' ? ` <button class="btn sm bad" type="button" data-act="sa-revoke-sch" data-id="${s.id}">إلغاء</button>` : ''}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  /* ============================================================================
     التبويب 6: مكتب خدمة الطالب الموحد، حجز المواعيد، والدور الذكي
     ============================================================================ */
  function renderDeskQueueSection({ compact = false } = {}) {
    const d = SA.data;
    if (!d || !d.deskQueue) return '';
    const appts = d.deskQueue.appointments || [];
    const students = d.students || [];
    const reqs = S.requests || [];

    const qStatusBadge = {
      waiting: '<span class="pill p-review">قيد الانتظار بالصالة</span>',
      serving: '<span class="pill p-approved" style="background:#0E6655;color:#fff">🔔 يُخدَم الآن على النافذة</span>',
      completed: '<span class="pill p-approved">تم التسليم وإغلاق التذكرة ✓</span>',
      no_show: '<span class="pill p-rejected">لم يحضر</span>',
    };

    return `
      <section class="card" data-testid="sa-desk-queue-panel" style="margin-top:16px;border-top:3px solid #0E6655">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
          <div>
            <h2 style="margin:0">6. مكتب خدمة الطالب الموحد ونظام الدور الذكي وحجز المواعيد (One-Stop Smart Queue)</h2>
            <p class="hint" style="margin:4px 0 0">إدارة مواعيد مراجعة الطلاب لاستلام الوثائق المصدقة وتوزيعهم على نوافذ الخدمة مع ربط التذكرة بشريط تتبع المعاملة ذي الـ 5 مراحل.</p>
          </div>
        </div>

        <div class="inline-form" style="margin-bottom:14px;background:rgba(14,102,85,0.06);padding:12px;border-radius:10px">
          ${studentField('sa-q-student', 'الطالب')}
          <label>ربط بمعاملة حالية (اختياري)<select id="sa-q-req">
            <option value="">— مراجعة عامة / استلام وثيقة —</option>
            ${reqs.map((r) => `<option value="${r.id}">${esc(r.no)} — ${esc(r.service.label)} (${esc(r.student ? r.student.name : '')})</option>`).join('')}
          </select></label>
          <label>الغرض من الموعد<input id="sa-q-purpose"></label>
          <label>التاريخ<input id="sa-q-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
          <label>الفترة الزمنية<select id="sa-q-slot">
            <option value="09:00 - 09:30">09:00 - 09:30</option>
            <option value="09:30 - 10:00">09:30 - 10:00</option>
            <option value="10:00 - 10:30">10:00 - 10:30</option>
            <option value="10:30 - 11:00">10:30 - 11:00</option>
            <option value="11:00 - 11:30">11:00 - 11:30</option>
            <option value="12:00 - 12:30">12:00 - 12:30</option>
          </select></label>
          <label>نافذة الخدمة<select id="sa-q-win">
            <option value="النافذة 1 — الوثائق والشهادات">النافذة 1 — الوثائق والشهادات</option>
            <option value="النافذة 2 — القبول والمعادلة">النافذة 2 — القبول والمعادلة</option>
            <option value="النافذة 3 — شؤون القيد والبطاقات">النافذة 3 — شؤون القيد والبطاقات</option>
          </select></label>
          <button class="btn pri" type="button" data-act="sa-book-ticket" data-testid="sa-book-ticket-btn">🎟️ إصدار تذكرة دور وموعد</button>
        </div>

        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>رقم التذكرة</th>
                <th>الطالب</th>
                <th>المعاملة المرتبطة</th>
                <th>الغرض من المراجعة</th>
                <th>الموعد والنافذة</th>
                <th>حالة الدور</th>
                <th>إجراءات النافذة</th>
              </tr>
            </thead>
            <tbody>
              ${appts
                .slice(0, compact ? 5 : 25)
                .map(
                  (a) => `
                <tr>
                  <td><b class="mono" style="font-size:15px;color:#054239">${esc(a.ticket_no)}</b></td>
                  <td><b>${esc(a.studentName || '—')}</b><div class="small mono">${esc(a.studentNo || '')}</div></td>
                  <td>${a.requestNo ? `<span class="mono">${esc(a.requestNo)}</span><div class="small">${esc(a.serviceLabel || '')}</div>` : '<span class="small">مراجعة مباشرة</span>'}</td>
                  <td>${esc(a.service_purpose)}</td>
                  <td class="small"><b>${esc(a.appointment_date)}</b> · ${esc(a.time_slot)}<div>${esc(a.counter_window)}</div></td>
                  <td>${qStatusBadge[a.queue_status] || esc(a.queue_status)}</td>
                  <td style="white-space:nowrap">${UA.rowPrintBtn('تذكرة مكتب خدمة الطالب', 'شؤون الطلاب', 'الطالب|موظف النافذة')}
                    ${
                      !['sa_scholarships:write', 'sa_scholarships:approve', 'request:decide', 'student:update'].some((p) => UA.can(p)) ? ''
                        : a.queue_status === 'waiting'
                        ? `<button class="btn sm pri" data-act="sa-q-status" data-id="${a.id}" data-st="serving">🔔 نداء للنافذة</button>`
                        : ''
                    }
                    ${
                      a.queue_status === 'serving'
                        ? `<button class="btn sm ok" data-act="sa-q-status" data-id="${a.id}" data-st="completed">✓ تم التسليم</button>`
                        : ''
                    }
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /* ---------- دمج الواجهة في شاشة شؤون الطلاب (affairs) ---------- */
  UA.studentAffairsSuite = {
    load: loadSuiteData,
    kpiStrip: suiteKpiStrip,
    renderTab: (tab) => {
      if (tab === 'admissions') return listNote(['applicants', 'equivalences']) + renderAdmissionsTab();
      if (tab === 'advising') return listNote(['warnings']) + renderAdvisingTab();
      if (tab === 'lifecycle') return listNote(['movements', 'disciplinary']) + renderLifecycleTab();
      if (tab === 'scholarships') return listNote(['scholarships']) + renderScholarshipsTab();
      if (tab === 'desk_queue') return listNote(['appointments']) + renderDeskQueueSection({ compact: false });
      return '';
    },
    renderQueueCompact: () => renderDeskQueueSection({ compact: true }),
    renderStudentPortalBooking: (reqs = []) => {
      const appts = (SA.data && SA.data.deskQueue && SA.data.deskQueue.appointments) || [];
      const myAppts = S.me ? appts.filter((a) => Number(a.student_id) === Number(S.me.id)) : appts.slice(0, 3);
      return `
        <article class="sx-panel" style="margin-top:16px;border-top:3px solid #D5B65D">
          <div class="sx-ph">
            <div>
              <h2>🎟️ مكتب خدمة الطالب الموحد: حجز موعد وتذكرة دور ذكية</h2>
              <p>احجز موعداً إلكترونياً لاستلام وثائقك المصدقة دون انتظار، وتابع رقم دورك مباشرة</p>
            </div>
          </div>
          <div class="inline-form" style="margin-bottom:12px">
            <label>ربط بمعاملة<select id="stu-q-req">
              <option value="">— استلام وثيقة / مراجعة شؤون الطلاب —</option>
              ${(reqs || []).map((r) => `<option value="${r.id}">${esc(r.no)} — ${esc(r.service.label)}</option>`).join('')}
            </select></label>
            <label>الغرض<input id="stu-q-purpose"></label>
            <label>التاريخ<input id="stu-q-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
            <label>الفترة الزمنية<select id="stu-q-slot">
              <option value="10:00 - 10:30">10:00 - 10:30</option>
              <option value="10:30 - 11:00">10:30 - 11:00</option>
              <option value="11:00 - 11:30">11:00 - 11:30</option>
            </select></label>
            <button class="btn pri" type="button" data-act="stu-book-ticket">حجز تذكرة دور الآن</button>
          </div>
          ${
            myAppts.length
              ? `<div class="sx-tscroll"><table class="sx-table rsp"><thead><tr><th>رقم التذكرة</th><th>الغرض</th><th>الموعد والنافذة</th><th>الحالة</th><th>طباعة</th></tr></thead><tbody>${myAppts
                  .map(
                    (a) =>
                      `<tr><td><b class="mono">${esc(a.ticket_no)}</b></td><td>${esc(a.service_purpose)}</td><td>${esc(a.appointment_date)} (${esc(a.time_slot)}) · ${esc(a.counter_window)}</td><td><span class="pill ${a.queue_status === 'completed' ? 'p-approved' : 'p-review'}">${a.queue_status === 'completed' ? 'تم التسليم ✓' : a.queue_status === 'serving' ? '🔔 تفضل للنافذة الآن' : 'قيد الانتظار'}</span></td><td>${UA.rowPrintBtn('تذكرة مكتب خدمة الطالب', 'شؤون الطلاب', 'الطالب|موظف النافذة')}</td></tr>`
                  )
                  .join('')}</tbody></table></div>`
              : ''
          }
        </article>
      `;
    },
  };

  /* ---------- ربط الأحداث والإجراءات التفاعلية ---------- */
  Object.assign(UA.actions, {
    'sa-add-applicant': async () => {
      await api('POST', '/api/student-affairs-suite/admissions/applicant', {
        fullName: val('sa-app-name'),
        nationalId: val('sa-app-nid'),
        phone: val('sa-app-phone'),
        hsType: val('sa-app-hstype'),
        hsScore: Number(val('sa-app-score')),
        category: val('sa-app-cat'),
        pref1ProgramId: Number(val('sa-app-p1')),
        pref2ProgramId: Number(val('sa-app-p2')),
      });
      await loadSuiteData();
      UA.render();
      toast('تم تسجيل المتقدم في بوابة المفاضلة بنجاح');
    },
    'sa-run-sort': async () => {
      const r = await api('POST', '/api/student-affairs-suite/admissions/run-sort', {});
      await loadSuiteData();
      UA.render();
      toast(`اكتمل الفرز الآلي للمفاضلة (${r.sortedCount} متقدماً)`);
    },
    'sa-save-plan': async (el, d) => {
      await api('PUT', `/api/student-affairs-suite/admissions/programs/${d.id}`, { minScore: val(`sa-plan-min-${d.id}`), capacity: val(`sa-plan-cap-${d.id}`) });
      await loadSuiteData();
      UA.render();
      toast('حُفظت خطة قبول البرنامج');
    },
    'sa-revoke-sch': async (el, d) => {
      const reason = await window.askText('إلغاء المنحة وعكس قيدها المالي', { label: 'سبب الإلغاء', submit: 'إلغاء المنحة', minLength: 3 });
      if (!reason) return;
      await api('POST', `/api/student-affairs-suite/scholarships/${d.id}/revoke`, { reason });
      await loadSuiteData();
      UA.render();
      toast('أُلغيت المنحة وعُكس قيدها المالي');
    },
    'sa-enroll-app': async (el, d) => {
      const a = (SA.data.admissions.applicants || []).find((x) => String(x.id) === String(d.id)) || {};
      const opt = SA.data.admissions.enrollOptions || { governorates: [], relations: [] };
      const parts = String(a.full_name || '').trim().split(/\s+/);
      const v = await window.askForm({ title: `تثبيت قيد المتقدم ${a.full_name || ''}`, submit: 'تثبيت القيد', fields: [
        { name: 'first_name', label: 'الاسم الأول', value: parts[0] || '', required: true },
        { name: 'father_name', label: 'اسم الأب', value: parts.length > 2 ? parts[1] : '', required: true },
        { name: 'last_name', label: 'الكنية', value: parts.length > 1 ? parts[parts.length - 1] : '', required: true },
        { name: 'mother_name', label: 'اسم الأم', required: true },
        { name: 'gender', label: 'الجنس', type: 'select', options: ['ذكر', 'أنثى'], required: true },
        { name: 'birth_date', label: 'تاريخ الميلاد', type: 'date', required: true },
        { name: 'birth_place', label: 'مكان الولادة', required: true },
        { name: 'nationality', label: 'الجنسية', value: 'سورية', required: true },
        { name: 'phone', label: 'رقم الهاتف', type: 'tel', value: a.phone || '', required: true },
        { name: 'governorate', label: 'محافظة السكن', type: 'select', options: opt.governorates, required: true },
        { name: 'city', label: 'المدينة / المنطقة', required: true },
        { name: 'address', label: 'العنوان التفصيلي', required: true },
        { name: 'guardian_name', label: 'اسم ولي الأمر', required: true },
        { name: 'guardian_relation', label: 'صلة القرابة', type: 'select', options: opt.relations, required: true },
        { name: 'guardian_phone', label: 'هاتف ولي الأمر', type: 'tel', required: true },
      ] });
      if (!v) return;
      const r = await api('POST', `/api/student-affairs-suite/admissions/enroll/${d.id}`, v);
      await loadSuiteData();
      UA.render();
      toast(`تم تثبيت القبول وتسجيل الطالب بالرقم الجامعي: ${r.student.studentNo}`);
    },
    'sa-add-eq': async () => {
      const sid = await studentIdOf('sa-eq-student');
      SA.selectedStudentId = sid;
      await api('POST', '/api/student-affairs-suite/equivalence', {
        studentId: sid,
        sourceUniversity: val('sa-eq-uni'),
        externalCourseCode: val('sa-eq-code'),
        externalCourseName: val('sa-eq-name'),
        externalHours: Number(val('sa-eq-hrs')),
        externalMark: Number(val('sa-eq-mark')),
        internalCourseId: Number(val('sa-eq-course')),
      });
      await loadSuiteData(sid);
      UA.render();
      toast('تم اعتماد معادلة المقرر وإدراجه في السجل الأكاديمي للطالب');
    },
    'sa-unlink': async (el, d) => {
      await api('DELETE', `/api/student-affairs-suite/prerequisites/${d.id}`);
      await UA.loadStudentAffairsSuite();
      UA.render();
      toast('أُزيل الربط');
    },
    'sa-add-advising': async () => {
      await api('POST', '/api/student-affairs-suite/advising', {
        studentId: await studentIdOf('sa-adv-student'),
        warningType: val('sa-adv-type'),
        severity: val('sa-adv-sev'),
        advisorName: val('sa-adv-advisor'),
        actionPlan: val('sa-adv-plan'),
      });
      await loadSuiteData();
      UA.render();
      toast('تم توثيق جلسة الإرشاد الأكاديمي وخطة المعالجة');
    },
    'sa-resolve-adv': async (el, d) => {
      await api('POST', `/api/student-affairs-suite/advising/${d.id}/resolve`, {});
      await loadSuiteData();
      UA.render();
      toast('تم إغلاق الإنذار الأكاديمي بعد تحسن أداء الطالب');
    },
    'sa-exec-movement': async () => {
      const r = await api('POST', '/api/student-affairs-suite/lifecycle', {
        studentId: await studentIdOf('sa-mov-student'),
        movementType: val('sa-mov-type'),
        durationSemesters: Number(val('sa-mov-dur')),
        toProgramId: Number(val('sa-mov-prog')),
        decisionNo: val('sa-mov-dec'),
        reason: val('sa-mov-reason'),
      });
      await loadSuiteData();
      UA.render();
      toast(`تم تنفيذ حركة القيد (${r.movementNo}) وتحديث حالة الطالب إلى: ${r.newStatusLabel}`);
    },
    'sa-add-disc': async () => {
      const r = await api('POST', '/api/student-affairs-suite/disciplinary', {
        studentId: await studentIdOf('sa-disc-student'),
        decisionNo: val('sa-disc-dec'),
        violationCategory: val('sa-disc-cat'),
        penaltyLevel: val('sa-disc-pen'),
        expiresAt: val('sa-disc-exp'),
        note: val('sa-disc-note'),
      });
      await loadSuiteData();
      UA.render();
      toast(`تم تسجيل قرار لجنة الانضباط (${r.decisionNo}) وتفعيل حجب الوثائق`);
    },
    'sa-clear-hold': async (el, d) => {
      await api('POST', `/api/admin/holds/${d.id}/clear`, {});
      await loadSuiteData();
      UA.render();
      toast('تمت تسوية العقوبة ورفع حجب الوثائق عن الطالب');
    },
    'sa-grant-sch': async () => {
      const r = await api('POST', '/api/student-affairs-suite/scholarships', {
        studentId: await studentIdOf('sa-sch-student'),
        scholarshipType: val('sa-sch-type'),
        baseTuition: Number(val('sa-sch-tuition')),
        gpa: Number(val('sa-sch-gpa')),
        note: val('sa-sch-note'),
      });
      await loadSuiteData();
      UA.render();
      toast(`تم اعتماد المنحة (${r.grantNo}) بقيمة ${nf.format(r.amount)} ل.س وترحيلها للمالية`);
    },
    'sa-book-ticket': async () => {
      const r = await api('POST', '/api/student-affairs-suite/queue/book', {
        studentId: await studentIdOf('sa-q-student'),
        requestId: val('sa-q-req') ? Number(val('sa-q-req')) : null,
        servicePurpose: val('sa-q-purpose'),
        appointmentDate: val('sa-q-date'),
        timeSlot: val('sa-q-slot'),
        counterWindow: val('sa-q-win'),
      });
      await loadSuiteData();
      UA.render();
      toast(`صدرت تذكرة الدور الذكي رقم (${r.ticketNo})`);
    },
    'stu-book-ticket': async () => {
      const r = await api('POST', '/api/student-affairs-suite/queue/book', {
        requestId: val('stu-q-req') ? Number(val('stu-q-req')) : null,
        servicePurpose: val('stu-q-purpose'),
        appointmentDate: val('stu-q-date'),
        timeSlot: val('stu-q-slot'),
      });
      await loadSuiteData();
      UA.render();
      toast(`تم حجز موعدك بنجاح — رقم تذكرة الدور: ${r.ticketNo}`);
    },
    'sa-q-status': async (el, d) => {
      const r = await api('POST', `/api/student-affairs-suite/queue/${d.id}/status`, { status: d.st });
      await loadSuiteData();
      UA.render();
      toast(`تم تحديث تذكرة الدور (${r.ticketNo})`);
    },
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t && t.id === 'sa-tree-student') {
      try {
        SA.selectedStudentId = await studentIdOf('sa-tree-student');
        await loadSuiteData(SA.selectedStudentId);
        UA.render();
      } catch (err) { if (!err.status) throw err; toast(err.message); }
    }
  });
})();
