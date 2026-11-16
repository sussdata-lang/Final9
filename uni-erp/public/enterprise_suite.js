/* بطاقات «التطوير المؤسسي»: كل بطاقة تُعرض في القسم الذي يخصها عبر UA.esCards
   (محاكي المعدل، قسائم الرواتب الموقعة، العبء التدريسي، أقساط الرسوم، إرسال الإشعارات، حضور اللجان)،
   إضافة إلى الشعب والتسجيل ومؤشرات الرئاسة ومنشئ التقارير ونافذة الأوامر. */
(function () {
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, toast, render } = UA;

  const E = {
    loading: false,
    data: null,
    quizAnswers: {},
    gpaResult: null,
    verifyResult: null,
    cmdOpen: false,
    cmdQuery: '',
    cmdResults: null,
    reportDataset: 'scheduleSlots',
  };

  const nf = (v) => new Intl.NumberFormat('en-US').format(Number(v || 0));
  const dt = (ms) => {
    if (!ms) return '—';
    try { return new Date(Number(ms)).toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return new Date(Number(ms)).toISOString().slice(0, 16); }
  };

  /* منشئ التقارير: أعمدة كل مصدر بعناوينها، فلا تظهر أسماء أعمدة قاعدة البيانات ولا الحقول الداخلية */
  const REPORTS = {
    scheduleSlots: { label: 'الجداول الدراسية المعتمدة', cols: [['course_code', 'رمز المقرر'], ['course_name', 'المقرر'], ['faculty_name', 'الكلية'], ['instructor_name', 'المدرّس'], ['hall_code', 'القاعة'], ['day_name', 'اليوم'], ['time_slot', 'الوقت'], ['section_code', 'الشعبة'], ['enrolled_count', 'المسجلون'], ['capacity', 'السعة'], ['status', 'الحالة']] },
    signedPayslips: { label: 'قسائم الرواتب', cols: [['payslip_code', 'رقم القسيمة'], ['employee_code', 'كود الموظف'], ['employee_name', 'اسم الموظف'], ['department', 'القسم'], ['month_label', 'الشهر'], ['basic_salary', 'الأساسي'], ['overload_pay', 'العبء الإضافي'], ['allowances', 'البدلات'], ['deductions', 'الخصومات'], ['net_salary', 'الصافي']] },
    facultyOverloads: { label: 'العبء التدريسي الإضافي', cols: [['instructor_name', 'المدرّس'], ['academic_rank', 'الرتبة'], ['faculty_name', 'الكلية'], ['quorum_hours', 'النصاب'], ['actual_teaching_hours', 'الساعات الفعلية'], ['supervision_hours', 'ساعات الإشراف'], ['overload_hours', 'الساعات الإضافية'], ['hourly_rate', 'أجر الساعة'], ['total_overload_pay', 'الإجمالي'], ['semester', 'الفصل'], ['status', 'الحالة']] },
    feeInstallments: { label: 'أقساط الطلاب والإيصالات', cols: [['installment_code', 'رقم القسط'], ['student_no', 'الرقم الجامعي'], ['student_name', 'اسم الطالب'], ['faculty_name', 'الكلية'], ['installment_no', 'القسط'], ['amount', 'المبلغ'], ['due_date', 'تاريخ الاستحقاق'], ['paid_amount', 'المسدد'], ['payment_method', 'طريقة الدفع'], ['receipt_no', 'رقم الإيصال'], ['status', 'الحالة']] },
  };
  const REPORT_PREVIEW_MAX = 50;
  const repRows = () => (E.data && E.data[E.reportDataset]) || [];
  const repTable = (rows) => {
    const { cols } = REPORTS[E.reportDataset];
    return `<table class="grid-tbl"><thead><tr>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map(([k]) => `<td>${esc(r[k] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };
  async function repLoad() {
    E.data = await api('GET', '/api/enterprise/overview');
    UA.enterpriseData = E.data;
    E.repLoaded = true;
  }
  UA.esReportOptions = () => Object.entries(REPORTS).map(([k, r]) => `<option value="${k}"${E.reportDataset === k ? ' selected' : ''}>${esc(r.label)}</option>`).join('');
  UA.esReportPreview = () => {
    if (E.repBusy) return '<p class="hint">جارٍ تحميل المعاينة…</p>';
    if (!E.repLoaded) return '<p class="hint">اختر المصدر ثم اضغط «تحديث المعاينة».</p>';
    const rows = repRows();
    if (!rows.length) return '<p class="hint">لا توجد بيانات في هذا المصدر، أو لا تملك صلاحية عرضه.</p>';
    return `${rows.length > REPORT_PREVIEW_MAX ? `<p class="small" style="margin:0 0 6px">تعرض المعاينة أول ${REPORT_PREVIEW_MAX} من ${rows.length} صف، ويشمل التنزيل الصفوف كلها.</p>` : ''}<div class="tbl-wrap">${repTable(rows.slice(0, REPORT_PREVIEW_MAX))}</div>`;
  };
  async function repReady() {
    const sel = document.getElementById('es-rep-ds');
    if (sel) E.reportDataset = sel.value;
    if (!E.repLoaded) await repLoad();
    if (repRows().length) return true;
    toast('لا توجد بيانات لهذا المصدر، أو لا تملك صلاحية عرضه');
    render();
    return false;
  }
  // خلية تبدأ بهذه الرموز ينفذها Excel صيغة، فتُعطَّل بعلامة اقتباس
  const csvCell = (v) => { const t = String(v ?? ''); return `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };

  UA.loaders.enterprise = async () => {
    E.data = await api('GET', '/api/enterprise/overview');
    if (window.UA) window.UA.enterpriseData = E.data;
  };

  function ensureEnterpriseDataLoaded() {
    if (E.data || E.loading) return;
    E.loading = true;
    UA.loaders.enterprise()
      .then(() => {
        E.loading = false;
        render();
      })
      .catch(() => {
        E.loading = false;
      });
  }

  function injectStyles() {
    if (document.getElementById('es-suite-css')) return;
    const st = document.createElement('style');
    st.id = 'es-suite-css';
    st.textContent = `
      .es-wrap { display: grid; gap: 16px; }
      .es-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
      .es-grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
      .es-card { background: var(--surface, #fff); border: 1px solid var(--line, #dce3dd); border-radius: 14px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,.03); }
      .es-card h2 { margin: 0 0 6px; font-size: 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ink, #042f28); }
      .es-card p.sub { margin: 0 0 14px; font-size: 12.5px; opacity: .75; }
      .es-num { background: #054239; color: #D5B65D; font-size: 11px; padding: 2px 8px; border-radius: 6px; font-family: monospace; }
      .es-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 12px; }
      .es-kpi { background: var(--surface, #fff); border: 1px solid var(--line, #dce3dd); border-inline-start: 4px solid #0e6655; border-radius: 12px; padding: 12px 14px; }
      .es-kpi small { display: block; font-size: 11.5px; opacity: .75; }
      .es-kpi strong { font-size: 22px; color: #054239; display: block; margin-top: 2px; }
      .es-cmd-modal { position: fixed; inset: 0; z-index: 9998; background: rgba(4,25,20,.68); backdrop-filter: blur(3px); display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh; }
      .es-cmd-box { width: min(680px, 94vw); background: var(--surface, #fff); color: var(--ink, #16302a); border-radius: 16px; border: 2px solid #D5B65D; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.4); }
      .es-cmd-input { width: 100%; border: 0; border-bottom: 1px solid var(--line, #dce3dd); padding: 16px 18px; font: inherit; font-size: 15px; background: rgba(14,102,85,.05); color: inherit; outline: none; }
      .es-cmd-list { max-height: 60vh; overflow-y: auto; padding: 12px; display: grid; gap: 6px; }
      .es-cmd-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line, #DCE3DD); background: transparent; cursor: pointer; text-align: start; font: inherit; width: 100%; }
      .es-cmd-item:hover { background: rgba(14,102,85,.1); border-color: #0e6655; }
    `;
    document.head.appendChild(st);
  }

  /* ---------- محاكي المعدل التراكمي (في «الخطة والإرشاد والإنذار») ---------- */
  function gpaCard() {
    const gpa = E.gpaResult;
    return `<section class="es-card">
      <h2><span>محاكي المعدل التراكمي المتوقع</span></h2>
      <p class="sub">أدخل معدل الطالب الحالي وساعاته المنجزة والعلامات المتوقعة لمقررات الفصل، فيُحسب معدله التراكمي المتوقع نهاية الفصل.</p>
      <form id="es-gpa-form" class="form" style="background:rgba(14,102,85,.04);padding:14px;border-radius:12px;border:1px solid var(--line,#dce3dd)">
        <div class="inline-form">
          <label>المعدل التراكمي الحالي (%)<input id="gpa-cur" type="number" step="0.1" required></label>
          <label>الساعات المنجزة<input id="gpa-hrs" type="number" required></label>
        </div>
        <div class="inline-form" style="margin-top:8px">
          <label>علامة المقرر الأول (4 س)<input id="gpa-c1" type="number" min="0" max="100"></label>
          <label>علامة المقرر الثاني (3 س)<input id="gpa-c2" type="number" min="0" max="100"></label>
          <label>علامة المقرر الثالث (3 س)<input id="gpa-c3" type="number" min="0" max="100"></label>
        </div>
        <button class="btn pri" type="submit" style="margin-top:10px">حساب المعدل التراكمي المتوقع</button>
      </form>
      <div class="es-kpis" style="margin-top:14px">
        <div class="es-kpi"><small>المعدل التراكمي المتوقع</small><strong>${gpa ? `${gpa.projectedGpa}%` : '—'}</strong></div>
        <div class="es-kpi"><small>التقدير الجامعي</small><strong>${gpa ? esc(gpa.letter) : '—'}</strong></div>
        <div class="es-kpi"><small>إجمالي الساعات بعد الفصل</small><strong>${gpa ? `${gpa.totalHours} ساعة` : '—'}</strong></div>
        <div class="es-kpi"><small>مقدار التحسن</small><strong style="color:#1B7F4B">${gpa ? `${gpa.delta >= 0 ? '+' + gpa.delta : gpa.delta}%` : '—'}</strong></div>
      </div>
    </section>`;
  }

  /* ---------- التسجيل بالشعب وفترة الحذف والإضافة ---------- */
  const sectionNameOf = (D, id) => (D.courseSections || []).find((s) => Number(s.id) === Number(id))?.name || '—';
  const isCurrent = (D, e) => !e.dropped_at && D.registration && e.semester === D.registration.term;
  const canDrop = (D, e) => isCurrent(D, e) && (S.me?.role === 'student' ? D.registration.isOpen : UA.can('course:manage') || UA.can('student:register'));
  function enrollOptions(D) {
    const sections = D.courseSections || [];
    return (D.enrollableCourses || []).flatMap((c) => {
      const own = sections.filter((s) => s.courseCode === c.code);
      if (!own.length) return [`<option value="${esc(c.code)}|">${esc(c.name)} (${esc(c.code)}) · ${c.hours} ساعة</option>`];
      return own.map((s) => `<option value="${esc(c.code)}|${s.id}"${s.seatsLeft ? '' : ' disabled'}>${esc(c.name)} · شعبة ${esc(s.name)}${s.instructor ? ` · ${esc(s.instructor)}` : ''} · ${s.seatsLeft ? `متبقي ${s.seatsLeft}` : 'مكتملة'}</option>`);
    }).join('');
  }
  function enrollFormHtml(D) {
    const r = D.registration || {};
    const period = r.open || r.close ? ` · فترة التسجيل والحذف والإضافة: ${esc(r.open || 'مفتوحة')} إلى ${esc(r.close || 'مفتوحة')}` : '';
    const head = `<p class="small" style="margin:0 0 10px">الفصل الحالي: <b>${esc(r.term || '—')}</b>${period}${r.isOpen === false ? ' · <b style="color:#9B2C2C">الفترة مغلقة</b>' : ''}</p>`;
    if (UA.S.me.role !== 'student') return `${head}<p class="small">يسجّل الطالب مقرراته من حسابه.</p>`;
    return `${head}<form id="es-enroll-form" class="inline-form" style="margin-bottom:14px">
      <label style="flex:1">المقرر والشعبة<select id="es-enr-course" data-no-other="1" required>${enrollOptions(D) || '<option value="">لا توجد مقررات متاحة</option>'}</select></label>
      <button class="btn pri" type="submit"${r.isOpen === false ? ' disabled' : ''}>تسجيل المقرر في الفصل الحالي</button>
    </form>`;
  }
  function sectionsAdminHtml(D) {
    if (!UA.can('course:manage')) return '';
    const sections = D.courseSections || [];
    return `<section class="es-card">
      <h2><span>شعب مقررات الفصل الحالي</span></h2>
      <p class="sub">إذا فُتحت شعب لمقرر، يختار الطالب إحداها عند التسجيل ضمن سعتها.</p>
      <form id="es-section-form" class="inline-form" style="margin-bottom:14px">
        <label style="flex:2">المقرر<select id="es-sec-course" data-no-other="1" required>${(D.enrollableCourses || []).map((c) => `<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`).join('')}</select></label>
        <label>الشعبة<input id="es-sec-name" maxlength="20" required placeholder="أ"></label>
        <label>السعة<input id="es-sec-cap" type="number" min="1" max="2000" value="40" required></label>
        <label>المدرّس<input id="es-sec-ins" maxlength="120"></label>
        <label>القاعة<input id="es-sec-hall" maxlength="60"></label>
        <button class="btn pri" type="submit">إضافة شعبة</button>
      </form>
      <div class="tbl-wrap"><table>
        <thead><tr><th>المقرر</th><th>الشعبة</th><th>المسجلون</th><th>السعة</th><th>المدرّس</th><th>القاعة</th><th>الحالة</th><th>إجراء</th></tr></thead>
        <tbody>${sections.map((s) => `<tr>
          <td>${esc(s.courseName)} <span class="mono small">${esc(s.courseCode)}</span></td>
          <td>${esc(s.name)}</td><td>${s.enrolled}</td>
          <td><input id="es-cap-${s.id}" type="number" min="1" max="2000" value="${s.capacity}" style="width:80px" aria-label="سعة الشعبة"></td>
          <td>${esc(s.instructor || '—')}</td><td>${esc(s.hall || '—')}</td>
          <td><span class="pill ${s.active ? 'p-approved' : 'p-rejected'}">${s.active ? 'مفعلة' : 'معطلة'}</span></td>
          <td><button class="btn sm" type="button" data-act="essecsave" data-id="${s.id}">حفظ السعة</button> <button class="btn sm" type="button" data-act="essectoggle" data-id="${s.id}" data-on="${s.active ? 0 : 1}">${s.active ? 'تعطيل' : 'تفعيل'}</button></td>
        </tr>`).join('') || '<tr><td colspan="8" class="small">لا توجد شعب لهذا الفصل بعد.</td></tr>'}</tbody>
      </table></div>
    </section>`;
  }

  // تبويب «الشعب والتسجيل» في الشؤون الأكاديمية: إدارة الشعب وتسجيلات الفصل الحالي
  UA.renderSectionsAdmin = () => {
    injectStyles();
    ensureEnterpriseDataLoaded();
    const D = E.data;
    if (!D) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const rows = (D.selfEnrollments || []).filter((e) => D.registration && e.semester === D.registration.term);
    return `<div class="es-wrap">${sectionsAdminHtml(D)}
      <section class="es-card"><h2><span>تسجيلات الفصل الحالي</span></h2>${enrollFormHtml(D)}
      <div class="tbl-wrap"><table>
        <thead><tr><th>الطالب</th><th>المقرر</th><th>الشعبة</th><th>الحالة</th><th>إجراء</th></tr></thead>
        <tbody>${rows.map((e) => `<tr><td>${esc(e.student_name)} <span class="mono small">${esc(e.student_no)}</span></td><td>${esc(e.course_name)} <span class="mono small">${esc(e.course_code)}</span></td>
          <td>${esc(sectionNameOf(D, e.section_id))}</td><td><span class="pill ${e.dropped_at ? 'p-rejected' : 'p-approved'}">${esc(e.status)}</span></td>
          <td>${canDrop(D, e) ? `<button class="btn sm" type="button" data-act="esdrop" data-id="${e.id}">حذف</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="small">لا توجد تسجيلات في هذا الفصل.</td></tr>'}</tbody>
      </table></div></section></div>`;
  };

  // قسم التسجيل في بوابة الطالب (صفحة دليل المواد): النموذج نفسه وجدول تسجيل الفصل الحالي
  UA.renderStudentRegistration = () => {
    injectStyles();
    ensureEnterpriseDataLoaded();
    const D = E.data;
    if (!D) return '<article class="sx-panel" style="margin-top:16px"><p class="hint">جارٍ تحميل التسجيل…</p></article>';
    const rows = (D.selfEnrollments || []).filter((e) => D.registration && e.semester === D.registration.term);
    return `<article class="sx-panel" style="margin-top:16px"><div class="sx-ph"><div><h2>التسجيل في المقررات</h2><p>سجّل مقررات الفصل الحالي واختر شعبتها، واحذف ما تريد ضمن فترة الحذف والإضافة.</p></div></div>
      ${enrollFormHtml(D)}
      <div class="tbl-wrap"><table class="sx-table rsp">
        <thead><tr><th>المقرر</th><th>الساعات</th><th>الشعبة</th><th>الحالة</th><th>إجراء</th></tr></thead>
        <tbody>${rows.map((e) => `<tr>
          <td><strong>${esc(e.course_name)}</strong> <span class="mono small">${esc(e.course_code)}</span></td>
          <td>${e.credits}</td><td>${esc(sectionNameOf(D, e.section_id))}</td>
          <td><span class="pill ${e.dropped_at ? 'p-rejected' : 'p-approved'}">${esc(e.status)}</span></td>
          <td>${canDrop(D, e) ? `<button class="btn sm" type="button" data-act="esdrop" data-id="${e.id}">حذف المقرر</button>` : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="small">لم تسجّل أي مقرر في هذا الفصل بعد.</td></tr>'}</tbody>
      </table></div></article>`;
  };

  /* ---------- قسائم الرواتب الموقعة (في «شؤون الموظفين ← الرواتب») ---------- */
  function payslipCard(D) {
    const payslips = D.signedPayslips || [];
    return `
        <section class="es-card">
          <h2><span>🧾 قسائم الرواتب الشهرية الموقعة رقمياً</span></h2>
          <p class="sub">إصدار قسائم رواتب رسمية موقعة بشهادة PKI تتضمن الراتب الأساسي، الساعات الإضافية، التعويضات، والحسميات.</p>
          <form id="es-payslip-form" class="inline-form" style="margin-bottom:12px">
            <label>اسم الموظف / عضو الهيئة التدريسية<input id="es-ps-name" required></label>
            <label>القسم / الكلية<input id="es-ps-dept" required></label>
            <label>الراتب الأساسي<input id="es-ps-basic" type="number" required></label>
            <label>علاوة العبء الإضافي<input id="es-ps-ov" type="number"></label>
            <button class="btn pri" type="submit">إصدار قسيمة راتب</button>
          </form>
          <form id="es-verify-form" class="inline-form" style="margin-bottom:12px">
            <label style="flex:1">التحقق من توقيع قسيمة<input id="es-v-code" placeholder="PAY-…" dir="ltr" required></label>
            <button class="btn" type="submit">تحقق من التوقيع</button>
          </form>
          ${E.verifyResult ? `<p class="small" style="margin:0 0 12px;color:#1B7F4B"><b>✓ ${esc(E.verifyResult.code)}:</b> ${esc(E.verifyResult.sig)}</p>` : ''}
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>رمز القسيمة</th><th>الموظف</th><th>الأساسي</th><th>العبء الإضافي</th><th>الصافي</th><th>التوقيع الرقمي</th></tr></thead>
              <tbody>
                ${payslips.map((p) => `<tr>
                  <td class="mono"><b>${esc(p.payslip_code)}</b></td>
                  <td>${esc(p.employee_name)}<div class="small">${esc(p.department)}</div></td>
                  <td>${nf(p.basic_salary)}</td>
                  <td>${nf(p.overload_pay)}</td>
                  <td><b style="color:#0e6655">${nf(p.net_salary)} ل.س</b></td>
                  <td class="mono small">${esc(String(p.digital_signature).slice(0, 26))}…</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>`;
  }

  /* ---------- العبء التدريسي الإضافي (في «أعضاء هيئة التدريس») ---------- */
  function overloadCard(D) {
    const overloads = D.facultyOverloads || [];
    return `
        <section class="es-card">
          <h2><span>⚖️ الحساب الآلي للعبء التدريسي الإضافي (Faculty Overload)</span></h2>
          <p class="sub">ربط النصاب التدريسي والاشراف العلمي بمسير الرواتب لحساب تعويض الساعات الإضافية تلقائياً.</p>
          <form id="es-overload-form" class="inline-form" style="margin-bottom:12px">
            <label>عضو الهيئة التدريسية<input id="es-ov-name" required></label>
            <label>الرتبة العلمية<select id="es-ov-rank"><option>أستاذ دكتور</option><option selected>أستاذ مساعد</option><option>مدرّس</option></select></label>
            <label>النصاب القانوني (س)<input id="es-ov-q" type="number" required></label>
            <label>ساعات التدريس الفعلية<input id="es-ov-act" type="number" required></label>
            <label>ساعات الإشراف<input id="es-ov-sup" type="number" required></label>
            <label>أجر الساعة (ل.س)<input id="es-ov-rate" type="number" required></label>
            <button class="btn pri" type="submit">احتساب وترحيل للرواتب</button>
          </form>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>المحاضر</th><th>النصاب</th><th>الفعلي + الإشراف</th><th>الساعات الإضافية</th><th>إجمالي الاستحقاق</th></tr></thead>
              <tbody>
                ${overloads.map((o) => `<tr>
                  <td><b>${esc(o.instructor_name)}</b><div class="small">${esc(o.academic_rank)}</div></td>
                  <td>${o.quorum_hours} س</td>
                  <td>${o.actual_teaching_hours + o.supervision_hours} س</td>
                  <td><span class="pill p-review">+${o.overload_hours} س</span></td>
                  <td><b style="color:#0e6655">${nf(o.total_overload_pay)} ل.س</b></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>`;
  }

  /* ---------- أقساط الرسوم والسداد (في «المالية ← محاسبة الرسوم والأقساط») ---------- */
  function installmentsCard(D) {
    const installments = D.feeInstallments || [];
    return `
      <section class="es-card">
        <h2><span>💳 بوابة الدفع الإلكتروني وتقسيط الرسوم الجامعية (E-Payment & Installments)</span></h2>
        <p class="sub">جدولة الأقساط الجامعية للطلاب مع السداد الإلكتروني الفوري وإصدار إيصالات القبض الرقمية.</p>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>رمز القسط</th><th>الطالب</th><th>الدفعة</th><th>المبلغ المستحق</th><th>تاريخ الاستحقاق</th><th>الحالة / الإيصال</th><th>إجراء</th></tr></thead>
            <tbody>
              ${installments.map((inst) => `<tr>
                <td class="mono"><b>${esc(inst.installment_code)}</b></td>
                <td>${esc(inst.student_name)} <span class="mono small">(${esc(inst.student_no)})</span></td>
                <td>القسط #${inst.installment_no}</td>
                <td><b>${nf(inst.amount)} ل.س</b></td>
                <td class="mono">${esc(inst.due_date)}</td>
                <td>
                  <span class="pill ${inst.paid_amount >= inst.amount ? 'p-approved' : 'p-review'}">${esc(inst.status)}</span>
                  ${inst.receipt_no ? `<div class="small mono">إيصال: ${esc(inst.receipt_no)}</div>` : ''}
                </td>
                <td>
                  ${inst.paid_amount < inst.amount
                    ? `<button class="btn ok sm" data-act="espayinst" data-id="${inst.id}">سداد إلكتروني فوري</button>`
                    : `<span class="ok-t small">✓ مسدد</span>`}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /* ---------- إرسال الإشعارات (في «الأخبار والشكاوى») ---------- */
  function notifCard(D) {
    const notifs = D.notifications || [];
    return `
        <section class="es-card">
          <h2><span>🔔 مركز الإشعارات الفورية متعدد القنوات (Multi-Channel Hub)</span></h2>
          <p class="sub">بث فوري للتنبيهات عبر المتصفح (Web Push)، البريد الرسمي، وقنوات Telegram / WhatsApp.</p>
          <form id="es-notif-form" class="form" style="margin-bottom:14px">
            <div class="inline-form">
              <label style="flex:1">عنوان الإشعار<input id="es-nf-title" required></label>
              <label>الجمهور المستهدف<select id="es-nf-aud">
                <option value="students">كافة الطلاب</option>
                <option value="staff">الهيئة التدريسية والإدارية</option>
              </select></label>
            </div>
            <label style="margin-top:8px">نص الإشعار<input id="es-nf-body" required></label>
            <div class="actions" style="margin:8px 0 0">
              <button class="btn pri" type="submit">إرسال الإشعار عبر البوابة والمتصفح</button>
            </div>
          </form>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>الإشعار</th><th>الجمهور</th><th>القنوات</th><th>الأجهزة المستلمة</th><th>الوقت</th></tr></thead>
              <tbody>
                ${notifs.map((n) => `<tr>
                  <td><b>${esc(n.title)}</b><div class="small">${esc(n.body)}</div></td>
                  <td>${esc(n.target_audience)}</td>
                  <td><span class="mono small">${esc(n.channels)}</span></td>
                  <td><b>${nf(n.delivery_count)}</b></td>
                  <td>${dt(n.created_at)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>`;
  }

  /* ---------- رصد حضور اللجان الامتحانية (في «سجل القاعات») ---------- */
  function committeeCard(D) {
    const batches = D.offlineBatches || [];
    return `
        <section class="es-card">
          <h2><span>📋 رصد حضور اللجان الامتحانية</span></h2>
          <p class="sub">إدخال أرقام الطلاب الحاضرين؛ تُسجَّل في سجل القاعات مباشرة. يتطلب اتصالًا بالخادم.</p>
          <form id="es-offline-form" class="inline-form" style="margin-bottom:14px">
            <label>اللجنة الامتحانية<input id="es-of-comm" required></label>
            <label>القاعة<input id="es-of-hall" required></label>
            <label>رمز المقرر<input id="es-of-course" required></label>
            <label style="flex-basis:100%">الأرقام الجامعية للحاضرين (رقم في كل سطر)<textarea id="es-of-students" rows="4" dir="ltr" required></textarea></label>
            <button class="btn ok" type="submit">حفظ الحضور</button>
          </form>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>رمز الدفعة</th><th>اللجنة والقاعة</th><th>المقرر</th><th>عدد الحاضرين</th><th>تاريخ المزامنة</th></tr></thead>
              <tbody>
                ${batches.map((b) => `<tr>
                  <td class="mono"><b>${esc(b.batch_code)}</b></td>
                  <td>${esc(b.committee_name)} · ${esc(b.hall_code)}</td>
                  <td class="mono">${esc(b.course_code)}</td>
                  <td><span class="pill p-approved">${b.records_count} طالب</span></td>
                  <td>${dt(b.synced_at)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>`;
  }

  /* ---------- التبويب 5: مؤشرات الرئاسة (14) ---------- */
  function viewExecDevops(D) {
    const kpis = D.executiveKpis || { facultiesComparison: [] };

    return `
      <!-- 14. لوحة مؤشرات الأداء الاستراتيجية لرئاسة الجامعة -->
      <section class="es-card">
        <h2><span>🏛️ لوحة مؤشرات الأداء الاستراتيجية لرئاسة الجامعة (Executive KPIs)</span></h2>
        <p class="sub">مقارنة بين الكليات محسوبة من العلامات المعتمدة والمستحقات والإيصالات والأبحاث المنشورة.</p>
        <div class="es-kpis" style="margin-bottom:16px">
          <div class="es-kpi"><small>متوسط النجاح العام بالجامعة</small><strong>${kpis.overallSuccessRate ?? 0}%</strong></div>
          <div class="es-kpi"><small>نسبة التحصيل المالي للأقساط</small><strong>${kpis.financialCollectionRate ?? 0}%</strong></div>
          <div class="es-kpi"><small>الأبحاث المنشورة</small><strong>${kpis.researchPublicationsCount ?? 0} بحثاً</strong></div>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>الكلية</th><th>عدد الطلاب</th><th>نسبة النجاح</th><th>نسبة التحصيل المالي</th><th>الأبحاث المنشورة</th></tr></thead>
            <tbody>
              ${(kpis.facultiesComparison || []).map((f) => `<tr>
                <td><b>${esc(f.faculty)}</b></td>
                <td>${nf(f.students)}</td>
                <td><span class="pill p-approved">${f.successRate}%</span></td>
                <td>${f.collectionRate}%</td>
                <td><b>${f.researchPapers}</b></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  // كل بطاقة تُعرض في القسم الذي يخصها؛ البيانات من /api/enterprise/overview وتُعاد الرسمة عند وصولها
  const card = (fn, needsData = true) => () => {
    injectStyles();
    ensureEnterpriseDataLoaded();
    if (needsData && !E.data) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    return `<div class="es-wrap">${fn(E.data || {})}</div>`;
  };
  UA.esCards = {
    gpa: card(gpaCard, false),
    payslips: card(payslipCard),
    overload: card(overloadCard),
    installments: card(installmentsCard),
    notify: card(notifCard),
    committee: card(committeeCard),
  };

  // لوحة مؤشرات الرئاسة تُعرض في «الامتحانات والتقييم»؛ البيانات من /api/enterprise/overview (صلاحية stats:read)
  UA.renderExecKpis = function () {
    injectStyles();
    return `<div class="es-wrap">${viewExecDevops(E.data || UA.enterpriseData || {})}</div>`;
  };


  /* ---------- نافذة الأوامر والبحث الشامل الفوري (Command Palette Modal) ---------- */
  async function openCommandPalette() {
    injectStyles();
    E.cmdOpen = true;
    const data = await api('GET', '/api/enterprise/global-search?q=' + encodeURIComponent(E.cmdQuery || ''));
    E.cmdResults = data;
    renderCommandModal();
  }

  function closeCommandPalette() {
    E.cmdOpen = false;
    const old = document.getElementById('es-cmd-overlay');
    if (old) old.remove();
  }

  function renderCommandModal() {
    let ov = document.getElementById('es-cmd-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'es-cmd-overlay';
      ov.className = 'es-cmd-modal';
      document.body.appendChild(ov);
    }
    const r = E.cmdResults || { students: [], courses: [], payslips: [] };
    const quickViews = [
      ['payroll', '👥 منظومة شؤون الموظفين والرواتب (10 شاشات)'],
      ['finance', '💰 المالية والمحاسبة القياسية'],
      ['procurement', '📦 المشتريات والمخازن والأصول'],
      ['lms', '📚 التعلم الإلكتروني والمكتبة الرقمية'],
      ['devops', '🖥️ البنية التحتية وسجل بلاغات DevOps'],
    ];

    ov.innerHTML = `
      <div class="es-cmd-box" dir="rtl" role="dialog" aria-modal="true" aria-label="نافذة الأوامر والبحث الشامل">
        <input id="es-cmd-q" class="es-cmd-input" type="search" placeholder="ابحث عن طالب، مقرر، قسيمة راتب، أو انتقل لأي وحدة... (Esc للإغلاق)" value="${esc(E.cmdQuery)}" autocomplete="off">
        <div class="es-cmd-list">
          <div class="small" style="font-weight:800;color:#0e6655;padding:4px 6px">الانتقال السريع للوحدات</div>
          ${quickViews.map((v) => `<button class="es-cmd-item" data-cmd-go="${v[0]}"><span>${esc(v[1])}</span><span class="mono small">انتقال ↵</span></button>`).join('')}
          ${r.students.length ? `<div class="small" style="font-weight:800;color:#0e6655;padding:8px 6px 2px">الطلاب المطابقون</div>` : ''}
          ${r.students.map((s) => `<button class="es-cmd-item" data-cmd-go="affairs"><span>👤 ${esc(s.display_name)} — <b class="mono">${esc(s.student_no)}</b></span><span class="small">${esc(s.program || '')}</span></button>`).join('')}
          ${r.payslips.length ? `<div class="small" style="font-weight:800;color:#0e6655;padding:8px 6px 2px">قسائم الرواتب</div>` : ''}
          ${r.payslips.map((p) => `<button class="es-cmd-item" data-cmd-go="payroll"><span>🧾 ${esc(p.employee_name)} (<span class="mono">${esc(p.payslip_code)}</span>)</span><span class="small">${nf(p.net_salary)} ل.س</span></button>`).join('')}
        </div>
      </div>
    `;

    const inp = document.getElementById('es-cmd-q');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
      inp.oninput = async (ev) => {
        E.cmdQuery = ev.target.value;
        E.cmdResults = await api('GET', '/api/enterprise/global-search?q=' + encodeURIComponent(E.cmdQuery));
        renderCommandModal();
      };
    }
    ov.onclick = async (ev) => {
      if (ev.target === ov) { closeCommandPalette(); return; }
      const goBtn = ev.target.closest('[data-cmd-go]');
      if (goBtn) {
        const v = goBtn.dataset.cmdGo;
        closeCommandPalette();
        await UA.go(v);
        return;
      }
    };
  }

  /* ---------- ربط الأحداث والنماذج ---------- */
  Object.assign(UA.actions, {
    esdrop: async (_el, d) => {
      if (!confirm('حذف هذا المقرر من تسجيل الفصل الحالي؟')) return;
      await api('POST', `/api/enterprise/self-enroll/${d.id}/drop`, {});
      await UA.loaders.enterprise();
      render();
      toast('✓ حُذف المقرر');
    },
    essecsave: async (_el, d) => {
      await api('PUT', `/api/enterprise/sections/${d.id}`, { capacity: Number(document.getElementById(`es-cap-${d.id}`).value) });
      await UA.loaders.enterprise();
      render();
      toast('✓ حُفظت السعة');
    },
    essectoggle: async (_el, d) => {
      await api('PUT', `/api/enterprise/sections/${d.id}`, { active: d.on === '1' });
      await UA.loaders.enterprise();
      render();
    },
    espayinst: async (_el, d) => {
      const r = await api('POST', `/api/enterprise/installments/${d.id}/pay`, { payment_method: 'بطاقة الدفع الإلكتروني الجامعية' });
      await UA.loaders.enterprise();
      render();
      toast(`تم سداد القسط بنجاح وإصدار إيصال رقم: ${r.receipt_no}`);
    },
    esrepchange: async () => {
      const sel = document.getElementById('es-rep-ds');
      if (sel) E.reportDataset = sel.value;
      E.repBusy = true; render();
      try { await repLoad(); } catch (e) { toast(`تعذّر تحميل البيانات: ${e.message}`); }
      E.repBusy = false; render();
    },
    esrepexport: async () => {
      try { if (!await repReady()) return; } catch (e) { toast(`تعذّر تحميل البيانات: ${e.message}`); return; }
      const { cols } = REPORTS[E.reportDataset];
      const csv = '\uFEFF' + [cols.map(([, l]) => csvCell(l)).join(','), ...repRows().map((r) => cols.map(([k]) => csvCell(r[k])).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `uni-erp-report-${E.reportDataset}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('تم تنزيل التقرير');
      render();
    },
    esrepprint: async () => {
      try { if (!await repReady()) return; } catch (e) { toast(`تعذّر تحميل البيانات: ${e.message}`); return; }
      render();
      UA.printHtml(`<div class="rec-print" dir="rtl"><div class="print-hd"><b>${esc(UA.S.uni || '')}</b><span>${esc(REPORTS[E.reportDataset].label)}</span></div>${repTable(repRows())}</div>`);
    },
  });

  Object.assign(UA.forms, {
    'es-schedule-form': async () => {
      await api('POST', `/api/courses/${document.getElementById('es-sc-course').value}/schedule/slots`, {
        day: Number(document.getElementById('es-sc-day').value),
        start: document.getElementById('es-sc-start').value,
        end: document.getElementById('es-sc-end').value,
        hall: document.getElementById('es-sc-hall').value,
      });
      await UA.loaders.enterprise();
      render();
      toast('✓ تم فحص الجدول وإدراج المحاضرة بدون أي تضارب قاعات أو محاضرين');
    },
    'es-gpa-form': async () => {
      E.gpaResult = await api('POST', '/api/enterprise/gpa-simulate', {
        currentGpa: Number(document.getElementById('gpa-cur').value),
        completedHours: Number(document.getElementById('gpa-hrs').value),
        upcomingCourses: [
          { code: 'C1', credits: 4, expectedScore: Number(document.getElementById('gpa-c1').value) },
          { code: 'C2', credits: 3, expectedScore: Number(document.getElementById('gpa-c2').value) },
          { code: 'C3', credits: 3, expectedScore: Number(document.getElementById('gpa-c3').value) },
        ],
      });
      render();
      toast(`المعدل التراكمي المتوقع: ${E.gpaResult.projectedGpa}% (${E.gpaResult.letter})`);
    },
    'es-verify-form': async () => {
      const code = document.getElementById('es-v-code').value.trim();
      E.verifyResult = null;
      try {
        const r = await api('GET', `/api/enterprise/payslips/${encodeURIComponent(code)}/verify`);
        if (r.valid) E.verifyResult = { code: r.code, sig: r.certificateTrusted ? 'توقيع صحيح بشهادة موثوقة' : 'توقيع صحيح بشهادة الجامعة الداخلية' };
        toast(r.valid ? '✓ التوقيع صحيح' : 'التوقيع غير صحيح: القسيمة عُدّلت أو وُقّعت بمفتاح آخر');
      } catch (e) { if (!e.status) throw e; toast(e.message); }
      render();
    },
    'es-enroll-form': async () => {
      const [course_code, section_id] = document.getElementById('es-enr-course').value.split('|');
      await api('POST', '/api/enterprise/self-enroll', { course_code, ...(section_id ? { section_id: Number(section_id) } : {}) });
      await UA.loaders.enterprise();
      render();
      toast(`✓ تم تسجيل المقرر ${course_code}`);
    },
    'es-section-form': async () => {
      const v = (id) => document.getElementById(id).value;
      await api('POST', '/api/enterprise/sections', { courseCode: v('es-sec-course'), name: v('es-sec-name'), capacity: Number(v('es-sec-cap')), instructor: v('es-sec-ins'), hall: v('es-sec-hall') });
      await UA.loaders.enterprise();
      render();
      toast('✓ أُضيفت الشعبة');
    },
    'es-payslip-form': async () => {
      const r = await api('POST', '/api/enterprise/payslips/issue', {
        employee_name: document.getElementById('es-ps-name').value,
        department: document.getElementById('es-ps-dept').value,
        basic_salary: Number(document.getElementById('es-ps-basic').value),
        overload_pay: Number(document.getElementById('es-ps-ov').value),
      });
      await UA.loaders.enterprise();
      render();
      toast(`✓ صدرت قسيمة الراتب: ${r.payslip_code}`);
    },
    'es-overload-form': async () => {
      const r = await api('POST', '/api/enterprise/faculty-overload', {
        instructor_name: document.getElementById('es-ov-name').value,
        academic_rank: document.getElementById('es-ov-rank').value,
        quorum_hours: Number(document.getElementById('es-ov-q').value),
        actual_teaching_hours: Number(document.getElementById('es-ov-act').value),
        supervision_hours: Number(document.getElementById('es-ov-sup').value),
        hourly_rate: Number(document.getElementById('es-ov-rate').value),
      });
      await UA.loaders.enterprise();
      render();
      toast(`✓ تم احتساب ${r.overloadHours} ساعات إضافية بمبلغ ${nf(r.totalOverloadPay)} ل.س`);
    },
    'es-notif-form': async () => {
      await api('POST', '/api/enterprise/notifications/broadcast', {
        title: document.getElementById('es-nf-title').value,
        body: document.getElementById('es-nf-body').value,
        audience: document.getElementById('es-nf-aud').value,
      });
      await UA.loaders.enterprise();
      render();
      toast('✓ أُرسل الإشعار إلى الأجهزة المشتركة');
    },
    'es-offline-form': async () => {
      const r = await api('POST', '/api/enterprise/offline-sync', {
        committee_name: document.getElementById('es-of-comm').value,
        hall_code: document.getElementById('es-of-hall').value,
        course_code: document.getElementById('es-of-course').value,
        student_nos: document.getElementById('es-of-students').value.split(/\s+/).filter(Boolean),
      });
      await UA.loaders.enterprise();
      render();
      toast(`سُجل حضور ${r.recorded_count} طالب (${r.batch_code})`);
    },
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && E.cmdOpen) {
      closeCommandPalette();
    }
  });


  UA.openCommandPalette = openCommandPalette;
})();
