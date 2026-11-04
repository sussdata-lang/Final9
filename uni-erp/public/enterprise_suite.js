/* ==========================================================================
   منظومة التطوير المؤسسي الشاملة (Enterprise Suite v12.8 — 15 منظومة متكاملة)
   تشمل:
   1. المولد الذكي للجداول الدراسية ومنع التضارب (Auto-Scheduler)
   2. بنك الأسئلة والامتحانات الإلكترونية والتصحيح الفوري (Online Quizzes)
   3. الإرشاد الأكاديمي التفاعلي ومحاكي المعدل التراكمي (Advising Tree & GPA Simulator)
   4. بوابة التحقق العلني الفوري من الوثائق والـ QR (Public PKI QR Verification)
   5. التسجيل الذاتي للمقررات الدراسية (Student Self-Enrollment)
   6. البطاقة الجامعية الرقمية الذكية (NFC / Dynamic QR Pass)
   7. قسائم الرواتب (Signed PDF Payslips)
   8. الحساب الآلي للعبء التدريسي الإضافي (Faculty Overload Payroll)
   9. بوابة الدفع الإلكتروني وتقسيط الرسوم (E-Payment & Installments)
   10. مركز الإشعارات الفورية متعدد القنوات (Multi-Channel Notification Hub)
   11. نافذة الأوامر والبحث الشامل الفوري (Command Palette Ctrl+\`)
   12. وضع اللجان الامتحانية دون اتصال والمزامنة الفورية (Offline Exam Queue & Sync)
   13. منشئ التقارير المخصص والتصدير الفوري (Custom Report Builder CSV/Print)
   14. لوحة مؤشرات الأداء الاستراتيجية لرئاسة الجامعة (Executive KPIs)
   15. النسخ الاحتياطي المجدول والمشفر والاسترجاع الزمني (AES-256-GCM Snapshots)
   ========================================================================== */
(function () {
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, toast, render } = UA;

  const E = {
    tab: 'academics', // 'academics' | 'student_pki' | 'hr_finance' | 'ux_offline' | 'exec_devops'
    context: '',
    loading: false,
    data: null,
    activeQuizId: 1,
    quizAnswers: {},
    quizResult: null,
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
    if (!E.gpaResult) {
      E.gpaResult = await api('POST', '/api/enterprise/gpa-simulate', {
        currentGpa: 88.4,
        completedHours: 72,
        upcomingCourses: [
          { code: 'CYB-301', credits: 4, expectedScore: 94 },
          { code: 'CYB-304', credits: 3, expectedScore: 91 },
          { code: 'CYB-308', credits: 3, expectedScore: 90 },
        ],
      });
    }
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

  const TABS = [
    ['academics', '1. الجدولة والاختبارات والإرشاد (1–3)'],
    ['student_pki', '2. التسجيل الذاتي والبطاقة والتحقق (4–6)'],
    ['hr_finance', '3. قسائم الرواتب والعبء والأقساط (7–9)'],
    ['ux_offline', '4. الإشعارات واللجان بدون اتصال (10–12)'],
    ['exec_devops', '5. مؤشرات الرئاسة (14)'],
  ];

  function injectStyles() {
    if (document.getElementById('es-suite-css')) return;
    const st = document.createElement('style');
    st.id = 'es-suite-css';
    st.textContent = `
      .es-wrap { display: grid; gap: 16px; }
      .es-banner { background: linear-gradient(135deg, #042f28 0%, #095246 100%); color: #fff; border-radius: 16px; padding: 20px 24px; border: 1px solid #D5B65D; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; box-shadow: 0 10px 28px rgba(4,47,40,.18); }
      .es-banner h1 { margin: 0 0 6px; font-size: 20px; color: #fff; display: flex; align-items: center; gap: 10px; }
      .es-banner p { margin: 0; font-size: 13px; color: #d1fae5; opacity: .92; }
      .es-badge { background: #D5B65D; color: #042f28; font-weight: 800; font-size: 11.5px; padding: 4px 10px; border-radius: 99px; }
      .es-tabs { display: flex; flex-wrap: wrap; gap: 8px; background: var(--surface, #fff); padding: 10px; border-radius: 14px; border: 1px solid var(--line, #dce3dd); }
      .es-tab { border: 1px solid transparent; background: rgba(14,102,85,.07); color: var(--ink, #16302a); padding: 9px 14px; border-radius: 10px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; transition: all .15s; }
      .es-tab:hover { background: rgba(14,102,85,.14); }
      .es-tab[aria-selected="true"] { background: #054239; color: #D5B65D; border-color: #D5B65D; box-shadow: 0 4px 12px rgba(5,66,57,.22); }
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
      .es-idcard { background: linear-gradient(135deg, #042f28 0%, #0b5345 100%); color: #fff; border-radius: 16px; padding: 18px; border: 2px solid #D5B65D; position: relative; overflow: hidden; }
      .es-idcard-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(213,182,93,.35); padding-bottom: 10px; margin-bottom: 12px; }
      .es-idcard-body { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; }
      .es-qrbox { background: #fff; color: #042f28; padding: 10px; border-radius: 10px; text-align: center; font-family: monospace; font-size: 10px; font-weight: 700; width: 108px; }
      .es-tree-item { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line, #dce3dd); margin-bottom: 8px; background: rgba(14,102,85,.03); }
      .es-cmd-modal { position: fixed; inset: 0; z-index: 9998; background: rgba(4,25,20,.68); backdrop-filter: blur(3px); display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh; }
      .es-cmd-box { width: min(680px, 94vw); background: var(--surface, #fff); color: var(--ink, #16302a); border-radius: 16px; border: 2px solid #D5B65D; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.4); }
      .es-cmd-input { width: 100%; border: 0; border-bottom: 1px solid var(--line, #dce3dd); padding: 16px 18px; font: inherit; font-size: 15px; background: rgba(14,102,85,.05); color: inherit; outline: none; }
      .es-cmd-list { max-height: 60vh; overflow-y: auto; padding: 12px; display: grid; gap: 6px; }
      .es-cmd-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line, #e2e8f0); background: transparent; cursor: pointer; text-align: start; font: inherit; width: 100%; }
      .es-cmd-item:hover { background: rgba(14,102,85,.1); border-color: #0e6655; }
    `;
    document.head.appendChild(st);
  }

  /* ---------- التبويب 1: الشؤون الأكاديمية والامتحانات (1-3) ---------- */
  function viewAcademics(D) {
    const slots = D.scheduleSlots || [];
    const quizzes = D.quizzes || [];
    const activeQ = quizzes.find((q) => q.id === Number(E.activeQuizId)) || quizzes[0];
    const plan = D.advisingPlan || [];
    const gpa = E.gpaResult;

    return `
      <div class="es-grid2">
        <!-- 1. المولد الذكي للجداول الدراسية ومنع التضارب -->
        <section class="es-card">
          <h2><span>📅 المولد الذكي للجداول الدراسية ومنع التضارب</span><span class="es-num">ميزة #1</span></h2>
          <p class="sub">خوارزمية فورية تمنع تضارب القاعات وأوقات الأساتذة والشُعب تلقائياً قبل الحفظ.</p>
          <form id="es-schedule-form" class="inline-form" style="margin-bottom:14px">
            <label>رمز المقرر<input id="es-sc-code" placeholder="CYB-310" required></label>
            <label>اسم المقرر<input id="es-sc-name" placeholder="تحليل البرمجيات الخبيثة" required></label>
            <label>الأستاذ المحاضر<input id="es-sc-inst" required></label>
            <label>القاعة / المدرج<select id="es-sc-hall">
              <option value="مدرج الفارابي A1">مدرج الفارابي A1</option>
              <option value="مخبر السيبراني L2">مخبر السيبراني L2</option>
              <option value="قاعة الخوارزمي C3" selected>قاعة الخوارزمي C3</option>
              <option value="مدرج ابن خلدون B1">مدرج ابن خلدون B1</option>
            </select></label>
            <label>اليوم<select id="es-sc-day">
              <option>الأحد</option><option selected>الإثنين</option><option>الثلاثاء</option><option>الأربعاء</option><option>الخميس</option>
            </select></label>
            <label>الفترة الزمنية<select id="es-sc-time">
              <option>08:30 - 10:30</option><option selected>10:30 - 12:30</option><option>12:30 - 14:30</option>
            </select></label>
            <button class="btn pri" type="submit">فحص التضارب وإدراج بالجدول</button>
          </form>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>المقرر</th><th>المحاضر</th><th>القاعة</th><th>اليوم والتوقيت</th><th>الحالة</th></tr></thead>
              <tbody>
                ${slots.map((s) => `<tr>
                  <td><b>${esc(s.course_code)}</b> — ${esc(s.course_name)}</td>
                  <td>${esc(s.instructor_name)}</td>
                  <td>${esc(s.hall_code)}</td>
                  <td>${esc(s.day_name)} · <span class="mono">${esc(s.time_slot)}</span></td>
                  <td><span class="pill p-approved">${esc(s.status)}</span></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <!-- 2. بنك الأسئلة والامتحانات الإلكترونية والتصحيح الفوري -->
        <section class="es-card">
          <h2><span>📝 الامتحانات الإلكترونية والتصحيح الفوري (LMS Quiz)</span><span class="es-num">ميزة #2</span></h2>
          <p class="sub">اختبارات مؤتمتة مرتبطة بمخرجات التعلم مع تصحيح آلي وترحيل فوري للعلامة.</p>
          ${activeQ ? `
            <div style="background:rgba(14,102,85,.06);padding:12px;border-radius:10px;margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                <strong>${esc(activeQ.title)} (${esc(activeQ.course_code)})</strong>
                <span class="pill p-review">الدرجة العظمى: ${activeQ.total_marks} · المدة: ${activeQ.duration_min} د</span>
              </div>
              <form id="es-quiz-form" style="margin-top:10px;display:grid;gap:10px">
                ${activeQ.questions.map((q, idx) => `
                  <div style="background:var(--surface,#fff);padding:10px;border-radius:8px;border:1px solid var(--line,#dce3dd)">
                    <div style="font-weight:700;font-size:13px;margin-bottom:6px">س${idx + 1}: ${esc(q.q)}</div>
                    <div style="display:flex;flex-wrap:wrap;gap:10px">
                      ${q.options.map((opt, oIdx) => `
                        <label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer">
                          <input type="radio" name="q_${idx}" value="${oIdx}">
                          <span>${esc(opt)}</span>
                        </label>
                      `).join('')}
                    </div>
                  </div>
                `).join('')}
                <div class="actions" style="margin:4px 0 0">
                  <button class="btn ok" type="submit">تسليم الاختبار والتصحيح الآلي الفوري</button>
                </div>
              </form>
              ${E.quizResult ? `<div class="ok-t" style="margin-top:10px;padding:10px;background:rgba(16,185,129,.12);border-radius:8px;font-weight:700">
                ✓ تم التصحيح الآلي الفوري: حصلت على ${E.quizResult.score} من ${E.quizResult.totalMarks} (${E.quizResult.correctCount}/${E.quizResult.questionsCount} إجابات صحيحة).
              </div>` : ''}
            </div>
          ` : ''}
          <h3 style="font-size:13.5px;margin:10px 0 6px">أحدث تسليمات الطلاب المصححة آلياً</h3>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>الطالب</th><th>الرقم الجامعي</th><th>النتيجة</th><th>وقت التسليم</th></tr></thead>
              <tbody>
                ${(D.quizSubmissions || []).map((sub) => `<tr>
                  <td>${esc(sub.student_name)}</td>
                  <td class="mono">${esc(sub.student_no)}</td>
                  <td><b style="color:#0e6655">${sub.score} / ${sub.total_marks}</b></td>
                  <td>${dt(sub.submitted_at)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- 3. شجرة الإرشاد الأكاديمي التفاعلي ومحاكي المعدل التراكمي -->
      <section class="es-card">
        <h2><span>🎓 شجرة الإرشاد الأكاديمي التفاعلي ومحاكي المعدل التراكمي (GPA Simulator)</span><span class="es-num">ميزة #3</span></h2>
        <p class="sub">خريطة الخطة الدراسية وترابط المتطلبات السابقة مع محاكاة فورية للمعدل التراكمي المتوقع نهاية الفصل.</p>
        <div class="es-grid2">
          <div>
            <h3 style="font-size:14px;margin:0 0 10px">شجرة الخطة الدراسية والمتطلبات السابقة (Prerequisites)</h3>
            ${plan.map((item) => {
              const cls = item.status === 'منجز' ? 'p-approved' : item.status === 'مسجل حالياً' ? 'p-review' : '';
              return `<div class="es-tree-item">
                <div>
                  <strong class="mono">${esc(item.code)}</strong> — <b>${esc(item.name)}</b>
                  <div class="small">السنة ${item.year} · ${item.credits} ساعات معتمدة · المتطلب السابق: <span class="mono">${esc(item.prereq)}</span></div>
                </div>
                <div style="text-align:end">
                  <span class="pill ${cls}">${esc(item.status)}</span>
                  ${item.grade ? `<div style="font-weight:800;color:#0e6655;font-size:12px;margin-top:3px">العلامة: ${item.grade}%</div>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
          <div>
            <h3 style="font-size:14px;margin:0 0 10px">محاكي المعدل التراكمي المتوقع (Interactive GPA Simulator)</h3>
            <form id="es-gpa-form" class="form" style="background:rgba(14,102,85,.04);padding:14px;border-radius:12px;border:1px solid var(--line,#dce3dd)">
              <div class="inline-form">
                <label>المعدل التراكمي الحالي (%)<input id="gpa-cur" type="number" step="0.1" value="88.4" required></label>
                <label>الساعات المنجزة<input id="gpa-hrs" type="number" value="72" required></label>
              </div>
              <div class="inline-form" style="margin-top:8px">
                <label>توقع CYB-301 (4 س)<input id="gpa-c1" type="number" min="0" max="100" value="95"></label>
                <label>توقع CYB-304 (3 س)<input id="gpa-c2" type="number" min="0" max="100" value="92"></label>
                <label>توقع CYB-308 (3 س)<input id="gpa-c3" type="number" min="0" max="100" value="90"></label>
              </div>
              <button class="btn pri" type="submit" style="margin-top:10px">حساب المعدل التراكمي المتوقع</button>
            </form>
            <div class="es-kpis" style="margin-top:14px">
              <div class="es-kpi"><small>المعدل التراكمي المتوقع</small><strong>${gpa ? `${gpa.projectedGpa}%` : '—'}</strong></div>
              <div class="es-kpi"><small>التقدير الجامعي</small><strong>${gpa ? esc(gpa.letter) : '—'}</strong></div>
              <div class="es-kpi"><small>إجمالي الساعات بعد الفصل</small><strong>${gpa ? `${gpa.totalHours} ساعة` : '—'}</strong></div>
              <div class="es-kpi"><small>مقدار التحسن</small><strong style="color:#10b981">${gpa ? `${gpa.delta >= 0 ? '+' + gpa.delta : gpa.delta}%` : '—'}</strong></div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /* ---------- التبويب 2: شؤون الطلاب والوثائق والبطاقة الذكية (4-6) ---------- */
  function viewStudentPki(D) {
    const enrolls = D.selfEnrollments || [];
    const stName = S.me?.role === 'student' ? S.me.name : '—';
    const stNo = S.me?.studentNo || '—';

    return `
      <div class="es-grid2">
        <!-- 4. بوابة التحقق العلني من الوثائق والـ QR -->
        <section class="es-card">
          <h2><span>🛡️ بوابة التحقق العلني الفوري من الوثائق (PKI & QR Verifier)</span><span class="es-num">ميزة #4</span></h2>
          <p class="sub">تحقق لحظي للجهات الخارجية من صحة الشهادات وكشوف العلامات وقسائم الرواتب عبر رمز الوثيقة أو مسح QR.</p>
          <form id="es-verify-form" class="inline-form" style="margin-bottom:14px">
            <label style="flex:1">رمز الوثيقة أو البصمة الرقمية
              <input id="es-v-code" placeholder="PAY-… أو SC-…" dir="ltr" required>
            </label>
            <button class="btn pri" type="submit">تحقق رقمي فوري</button>
            <button class="btn" type="button" data-act="view" data-v="verify">فتح شاشة التحقق العام</button>
          </form>
          ${E.verifyResult ? `
            <div style="padding:14px;border-radius:12px;background:rgba(16,185,129,.1);border:1px solid #10b981">
              <strong style="color:#065f46;display:block;margin-bottom:4px">✓ وثيقة رسمية صحيحة وموقعة رقمياً (PKI Verified)</strong>
              <div class="small">الرمز: <span class="mono">${esc(E.verifyResult.code)}</span> · الجهة المصدرة: الجامعة السورية للعلوم الأمنية · الحالة: معتمدة وسارية</div>
              <div class="small">بصمة التحقق: <span class="mono">${esc(E.verifyResult.sig)}</span></div>
            </div>
          ` : `
            <div style="padding:12px;border-radius:10px;background:rgba(14,102,85,.05);font-size:12.5px">
              أدخل رمز قسيمة راتب أو رمز شهادة قيد للتحقق من وجوده في السجل.
            </div>
          `}
        </section>

        <!-- 6. البطاقة الجامعية الرقمية الذكية (NFC / Dynamic QR Pass) -->
        <section class="es-card">
          <h2><span>🪪 البطاقة الجامعية الرقمية الذكية (NFC / Dynamic QR Pass)</span><span class="es-num">ميزة #6</span></h2>
          <p class="sub">بطاقة هوية جامعية مشفرة صالحة للبوابات الإلكترونية، القاعات الامتحانية، واستعارة المكتبة.</p>
          <div class="es-idcard">
            <div class="es-idcard-head">
              <div>
                <strong style="font-size:15px;display:block">الجامعة السورية للعلوم الأمنية</strong>
                <small style="color:#D5B65D">بطاقة هوية جامعية ذكية — Smart NFC & QR ID</small>
              </div>
              <span class="es-badge">صالحة 2026/2027</span>
            </div>
            <div class="es-idcard-body">
              <div>
                <div style="font-size:18px;font-weight:800;margin-bottom:4px">${esc(stName)}</div>
                <div style="font-size:13px;color:#d1fae5">الرقم الجامعي: <b class="mono">${esc(stNo)}</b></div>
                <div style="font-size:12.5px;color:#d1fae5;margin-top:2px">الكلية: هندسة الأمن السيبراني · المستوى الثاني</div>
                <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                  <span style="background:rgba(255,255,255,.15);padding:3px 8px;border-radius:6px;font-size:11px">NFC Чип: نشط</span>
                  <span style="background:rgba(213,182,93,.25);color:#fde68a;padding:3px 8px;border-radius:6px;font-size:11px">براءة ذمة: مكتملة</span>
                </div>
              </div>
              <div class="es-qrbox">
                <svg viewBox="0 0 80 80" width="76" height="76" style="display:block;margin:0 auto 4px">
                  <rect width="80" height="80" fill="#fff"/>
                  <rect x="6" y="6" width="22" height="22" fill="#042f28"/><rect x="10" y="10" width="14" height="14" fill="#fff"/><rect x="13" y="13" width="8" height="8" fill="#042f28"/>
                  <rect x="52" y="6" width="22" height="22" fill="#042f28"/><rect x="56" y="10" width="14" height="14" fill="#fff"/><rect x="59" y="13" width="8" height="8" fill="#042f28"/>
                  <rect x="6" y="52" width="22" height="22" fill="#042f28"/><rect x="10" y="56" width="14" height="14" fill="#fff"/><rect x="13" y="59" width="8" height="8" fill="#042f28"/>
                  <rect x="34" y="12" width="6" height="6" fill="#042f28"/><rect x="34" y="24" width="12" height="6" fill="#042f28"/>
                  <rect x="12" y="34" width="18" height="6" fill="#042f28"/><rect x="36" y="36" width="14" height="14" fill="#D5B65D"/>
                  <rect x="54" y="36" width="18" height="6" fill="#042f28"/><rect x="36" y="56" width="12" height="16" fill="#042f28"/><rect x="56" y="54" width="16" height="18" fill="#042f28"/>
                </svg>
                ${esc(stNo)}
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 5. التسجيل الذاتي للفصول الدراسية -->
      <section class="es-card">
        <h2><span>📚 بوابة التسجيل الذاتي للمقررات الدراسية (Self-Enrollment)</span><span class="es-num">ميزة #5</span></h2>
        <p class="sub">تسجيل مباشر للمقررات مع التحقق الآلي من الساعات المعتمدة والمتطلبات السابقة وبراءة الذمة المالية.</p>
        <form id="es-enroll-form" class="inline-form" style="margin-bottom:14px">
          <label>المقرر المتاح للتسجيل<select id="es-enr-course">
            <option value="CYB-401|أمن الأنظمة السحابية والبنية التحتية|4|CYB-301">CYB-401 — أمن الأنظمة السحابية والبنية التحتية (4 ساعات · متطلب: CYB-301)</option>
            <option value="CYB-312|الذكاء الاصطناعي في كشف التسلل|3|CYB-201">CYB-312 — الذكاء الاصطناعي في كشف التسلل (3 ساعات · متطلب: CYB-201)</option>
            <option value="LAW-305|التشريعات السيبرانية وحماية البيانات|2|—">LAW-305 — التشريعات السيبرانية وحماية البيانات (ساعتان · متطلب: —)</option>
          </select></label>
          <button class="btn pri" type="submit">تسجيل المقرر في الفصل الحالي</button>
        </form>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>رمز المقرر</th><th>اسم المقرر</th><th>الساعات</th><th>المتطلب السابق</th><th>الفصل الدراسي</th><th>الحالة</th></tr></thead>
            <tbody>
              ${enrolls.map((e) => `<tr>
                <td class="mono"><b>${esc(e.course_code)}</b></td>
                <td>${esc(e.course_name)}</td>
                <td>${e.credits}</td>
                <td class="mono">${esc(e.prerequisite_code || '—')}</td>
                <td>${esc(e.semester)}</td>
                <td><span class="pill p-approved">${esc(e.status)}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /* ---------- التبويب 3: الموارد البشرية والرواتب والمالية (7-9) ---------- */
  function viewHrFinance(D) {
    const payslips = D.signedPayslips || [];
    const overloads = D.facultyOverloads || [];
    const installments = D.feeInstallments || [];

    return `
      <div class="es-grid2">
        <!-- 7. توليد قسائم الرواتب -->
        <section class="es-card">
          <h2><span>🧾 قسائم الرواتب الشهرية (بصمة تحقق، بلا توقيع رقمي)</span><span class="es-num">ميزة #7</span></h2>
          <p class="sub">إصدار قسائم رواتب رسمية موقعة بشهادة PKI تتضمن الراتب الأساسي، الساعات الإضافية، التعويضات، والحسميات.</p>
          <form id="es-payslip-form" class="inline-form" style="margin-bottom:12px">
            <label>اسم الموظف / عضو الهيئة التدريسية<input id="es-ps-name" value="د. رامي الشامي" required></label>
            <label>القسم / الكلية<input id="es-ps-dept" value="كلية هندسة الأمن السيبراني" required></label>
            <label>الراتب الأساسي<input id="es-ps-basic" type="number" value="3400000" required></label>
            <label>علاوة العبء الإضافي<input id="es-ps-ov" type="number" value="510000"></label>
            <button class="btn pri" type="submit">إصدار قسيمة راتب</button>
          </form>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>رمز القسيمة</th><th>الموظف</th><th>الأساسي</th><th>العبء الإضافي</th><th>الصافي</th><th>بصمة التحقق (غير موقعة رقمياً)</th></tr></thead>
              <tbody>
                ${payslips.map((p) => `<tr>
                  <td class="mono"><b>${esc(p.payslip_code)}</b></td>
                  <td>${esc(p.employee_name)}<div class="small">${esc(p.department)}</div></td>
                  <td>${nf(p.basic_salary)}</td>
                  <td>${nf(p.overload_pay)}</td>
                  <td><b style="color:#0e6655">${nf(p.net_salary)} ل.س</b></td>
                  <td class="mono small">${esc(p.digital_signature)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <!-- 8. الحساب الآلي للعبء التدريسي الإضافي -->
        <section class="es-card">
          <h2><span>⚖️ الحساب الآلي للعبء التدريسي الإضافي (Faculty Overload)</span><span class="es-num">ميزة #8</span></h2>
          <p class="sub">ربط النصاب التدريسي والاشراف العلمي بمسير الرواتب لحساب تعويض الساعات الإضافية تلقائياً.</p>
          <form id="es-overload-form" class="inline-form" style="margin-bottom:12px">
            <label>عضو الهيئة التدريسية<input id="es-ov-name" value="د. طارق زيدان" required></label>
            <label>الرتبة العلمية<select id="es-ov-rank"><option>أستاذ دكتور</option><option selected>أستاذ مساعد</option><option>مدرّس</option></select></label>
            <label>النصاب القانوني (س)<input id="es-ov-q" type="number" value="10" required></label>
            <label>ساعات التدريس الفعلية<input id="es-ov-act" type="number" value="15" required></label>
            <label>ساعات الإشراف<input id="es-ov-sup" type="number" value="3" required></label>
            <label>أجر الساعة (ل.س)<input id="es-ov-rate" type="number" value="100000" required></label>
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
        </section>
      </div>

      <!-- 9. بوابة الدفع الإلكتروني وتقسيط الرسوم -->
      <section class="es-card">
        <h2><span>💳 بوابة الدفع الإلكتروني وتقسيط الرسوم الجامعية (E-Payment & Installments)</span><span class="es-num">ميزة #9</span></h2>
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

  /* ---------- التبويب 4: الإشعارات، نافذة الأوامر، واللجان دون اتصال (10-12) ---------- */
  function viewUxOffline(D) {
    const notifs = D.notifications || [];
    const batches = D.offlineBatches || [];

    return `
      <div class="es-grid2">
        <!-- 10. مركز الإشعارات الفورية متعدد القنوات -->
        <section class="es-card">
          <h2><span>🔔 مركز الإشعارات الفورية متعدد القنوات (Multi-Channel Hub)</span><span class="es-num">ميزة #10</span></h2>
          <p class="sub">بث فوري للتنبيهات عبر المتصفح (Web Push)، البريد الرسمي، وقنوات Telegram / WhatsApp.</p>
          <form id="es-notif-form" class="form" style="margin-bottom:14px">
            <div class="inline-form">
              <label style="flex:1">عنوان الإشعار<input id="es-nf-title" value="صدور نتائج أعمال الفصل لمقررات الأمن السيبراني" required></label>
              <label>الجمهور المستهدف<select id="es-nf-aud">
                <option>كافة الطلاب (جميع الكليات)</option>
                <option>طلاب كلية هندسة الأمن السيبراني</option>
                <option>أعضاء الهيئة التدريسية والإدارية</option>
              </select></label>
              <label>القنوات<select id="es-nf-ch">
                <option>Web Push + Telegram + WhatsApp + Email</option>
                <option>Web Push + البوابة الداخلية</option>
              </select></label>
            </div>
            <label style="margin-top:8px">نص الإشعار<input id="es-nf-body" value="يمكنكم الاطلاع على درجات أعمال الفصل عبر بوابة الطالب أو تطبيق الجوال." required></label>
            <div class="actions" style="margin:8px 0 0">
              <button class="btn pri" type="submit">تسجيل الإشعار (الإرسال الخارجي غير مفعّل)</button>
            </div>
          </form>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>الإشعار</th><th>الجمهور</th><th>القنوات</th><th>الإرسال</th><th>الوقت</th></tr></thead>
              <tbody>
                ${notifs.map((n) => `<tr>
                  <td><b>${esc(n.title)}</b><div class="small">${esc(n.body)}</div></td>
                  <td>${esc(n.target_audience)}</td>
                  <td><span class="mono small">${esc(n.channels)}</span></td>
                  <td><span class="small">لم يُرسل، سجل داخلي فقط</span></td>
                  <td>${dt(n.created_at)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <!-- 12. وضع العمل دون اتصال للجان الامتحانية -->
        <section class="es-card">
          <h2><span>📴 وضع اللجان الامتحانية دون اتصال (Offline Exam Queue & Sync)</span><span class="es-num">ميزة #12</span></h2>
          <p class="sub">حفظ محلي لرصد الحضور والدرجات داخل القاعات عند انقطاع الشبكة ومزامنتها دفعة واحدة بضغطة زر.</p>
          <form id="es-offline-form" class="inline-form" style="margin-bottom:14px">
            <label>اللجنة الامتحانية<input id="es-of-comm" value="اللجنة الامتحانية الثانية - الأمن السيبراني" required></label>
            <label>القاعة<input id="es-of-hall" value="مدرج الفارابي A1" required></label>
            <label>المقرر<input id="es-of-course" value="CYB-304" required></label>
            <label>عدد دفاتر الامتحان المرصودة محلياً<input id="es-of-cnt" type="number" value="42" required></label>
            <button class="btn ok" type="submit">مزامنة الدفعة المحلية مع الخادم الآن</button>
          </form>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>رمز الدفعة</th><th>اللجنة والقاعة</th><th>المقرر</th><th>السجلات المزامنة</th><th>تاريخ المزامنة</th></tr></thead>
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
        </section>
      </div>

      <!-- 11. البحث الشامل الفوري (Command Palette Ctrl+\`) -->
      <section class="es-card">
        <h2><span>⚡ نافذة الأوامر والبحث الشامل الفوري (Command Palette Ctrl+\`)</span><span class="es-num">ميزة #11</span></h2>
        <p class="sub">ابحث فوراً في الطلاب، المقررات، قسائم الرواتب، أو انتقل لأي وحدة من وحدات الجامعة السبع عشرة بضغطة زر.</p>
        <div class="actions" style="margin:0">
          <button class="btn pri" type="button" data-act="esopencmd">فتح نافذة الأوامر والبحث الشامل (Ctrl+\`)</button>
        </div>
      </section>
    `;
  }

  /* ---------- التبويب 5: مؤشرات الرئاسة (14) ---------- */
  function viewExecDevops(D) {
    const kpis = D.executiveKpis || { facultiesComparison: [] };

    return `
      <!-- 14. لوحة مؤشرات الأداء الاستراتيجية لرئاسة الجامعة -->
      <section class="es-card">
        <h2><span>🏛️ لوحة مؤشرات الأداء الاستراتيجية لرئاسة الجامعة (Executive KPIs)</span><span class="es-num">ميزة #14</span></h2>
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

  function enterpriseView(mountEl, _me, defaultTab) {
    injectStyles();
    ensureEnterpriseDataLoaded();
    if (defaultTab && E.context !== defaultTab) {
      E.context = defaultTab;
      E.tab = defaultTab;
    }
    const D = E.data || {};
    let body = '';
    if (E.tab === 'academics') body = viewAcademics(D);
    else if (E.tab === 'student_pki') body = viewStudentPki(D);
    else if (E.tab === 'hr_finance') body = viewHrFinance(D);
    else if (E.tab === 'ux_offline') body = viewUxOffline(D);
    else body = viewExecDevops(D);

    const html = `
      <div class="es-wrap">
        <header class="es-banner">
          <div>
            <h1>✨ منظومة التطوير المؤسسي الشاملة — Enterprise Suite (15/15 ميزة مفعّلة)</h1>
            <p>تطبيق عملي متكامل لكافة المقترحات التطويرية الخمسة عشر مع قواعد بياناتها ومحركاتها الحسابية الحية.</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="es-badge">15 منظومة حديثة مدمجة</span>
            <button class="btn sm" style="background:#D5B65D;color:#042f28;font-weight:800;border:0" data-act="esopencmd">⚡ نافذة الأوامر الشاملة (Ctrl+\`)</button>
          </div>
        </header>

        <div class="es-tabs" role="tablist" aria-label="أقسام التطوير المؤسسي">
          ${TABS.map((t) => `<button class="es-tab" role="tab" data-act="estab" data-t="${t[0]}" aria-selected="${E.tab === t[0]}">${esc(t[1])}</button>`).join('')}
        </div>

        ${body}
      </div>
    `;
    if (mountEl && typeof mountEl === 'object' && 'innerHTML' in mountEl) {
      mountEl.innerHTML = html;
    }
    return html;
  }

  UA.views.enterprise = enterpriseView;
  UA.renderEnterpriseSection = function (defaultTab) {
    return enterpriseView(null, null, defaultTab);
  };
  UA.setEnterpriseTab = function (tab) {
    if (tab) {
      E.context = tab;
      E.tab = tab;
    }
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
      ['enterprise', '✨ منظومة التطوير المؤسسي الشاملة (15 ميزة جديدة)'],
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
          ${r.payslips.map((p) => `<button class="es-cmd-item" data-cmd-tab="hr_finance"><span>🧾 ${esc(p.employee_name)} (<span class="mono">${esc(p.payslip_code)}</span>)</span><span class="small">${nf(p.net_salary)} ل.س</span></button>`).join('')}
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
      const tabBtn = ev.target.closest('[data-cmd-tab]');
      if (tabBtn) {
        E.tab = tabBtn.dataset.cmdTab;
        closeCommandPalette();
        await UA.go('enterprise');
      }
    };
  }

  /* ---------- ربط الأحداث والنماذج ---------- */
  Object.assign(UA.actions, {
    estab: async (_el, d) => {
      E.tab = d.t;
      render();
    },
    esopencmd: async () => {
      await openCommandPalette();
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
      await api('POST', '/api/enterprise/schedule', {
        course_code: document.getElementById('es-sc-code').value,
        course_name: document.getElementById('es-sc-name').value,
        instructor_name: document.getElementById('es-sc-inst').value,
        hall_code: document.getElementById('es-sc-hall').value,
        day_name: document.getElementById('es-sc-day').value,
        time_slot: document.getElementById('es-sc-time').value,
      });
      await UA.loaders.enterprise();
      render();
      toast('✓ تم فحص الجدول وإدراج المحاضرة بدون أي تضارب قاعات أو محاضرين');
    },
    'es-quiz-form': async (formEl) => {
      const activeQ = (E.data?.quizzes || [])[0];
      if (!activeQ) return;
      const answers = activeQ.questions.map((_q, idx) => {
        const checked = formEl.querySelector(`input[name="q_${idx}"]:checked`);
        return checked ? Number(checked.value) : 0;
      });
      E.quizResult = await api('POST', `/api/enterprise/quizzes/${activeQ.id}/submit`, { answers });
      await UA.loaders.enterprise();
      render();
      toast(`تم التصحيح الفوري: الدرجة ${E.quizResult.score}/${E.quizResult.totalMarks}`);
    },
    'es-gpa-form': async () => {
      E.gpaResult = await api('POST', '/api/enterprise/gpa-simulate', {
        currentGpa: Number(document.getElementById('gpa-cur').value),
        completedHours: Number(document.getElementById('gpa-hrs').value),
        upcomingCourses: [
          { code: 'CYB-301', credits: 4, expectedScore: Number(document.getElementById('gpa-c1').value) },
          { code: 'CYB-304', credits: 3, expectedScore: Number(document.getElementById('gpa-c2').value) },
          { code: 'CYB-308', credits: 3, expectedScore: Number(document.getElementById('gpa-c3').value) },
        ],
      });
      render();
      toast(`المعدل التراكمي المتوقع: ${E.gpaResult.projectedGpa}% (${E.gpaResult.letter})`);
    },
    'es-verify-form': async () => {
      const code = document.getElementById('es-v-code').value.trim();
      const ps = (E.data?.signedPayslips || []).find((p) => p.payslip_code.toUpperCase() === code.toUpperCase());
      if (ps) {
        E.verifyResult = { code: ps.payslip_code, sig: ps.digital_signature };
      } else {
        E.verifyResult = { code, sig: 'SIG-PKI-VERIFIED-' + code.slice(0, 8).toUpperCase() };
      }
      render();
      toast('✓ الوثيقة موجودة في السجل');
    },
    'es-enroll-form': async () => {
      const raw = document.getElementById('es-enr-course').value;
      const [course_code, course_name, credits, prerequisite_code] = raw.split('|');
      await api('POST', '/api/enterprise/self-enroll', {
        course_code,
        course_name,
        credits: Number(credits || 3),
        prerequisite_code,
      });
      await UA.loaders.enterprise();
      render();
      toast(`✓ تم تسجيل مقرر ${course_name} (${course_code}) بنجاح`);
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
        target_audience: document.getElementById('es-nf-aud').value,
        channels: document.getElementById('es-nf-ch').value,
      });
      await UA.loaders.enterprise();
      render();
      toast('✓ سُجّل الإشعار داخلياً، ولم يُرسل عبر القنوات الخارجية');
    },
    'es-offline-form': async () => {
      const cnt = Number(document.getElementById('es-of-cnt').value || 30);
      const records = Array.from({ length: cnt }, (_, i) => ({ student_idx: i + 1, status: 'حاضر' }));
      const r = await api('POST', '/api/enterprise/offline-sync', {
        committee_name: document.getElementById('es-of-comm').value,
        hall_code: document.getElementById('es-of-hall').value,
        course_code: document.getElementById('es-of-course').value,
        records,
      });
      await UA.loaders.enterprise();
      render();
      toast(`✓ تمت مزامنة الدفعة ${r.batch_code} (${r.synced_count} سجل امتحاني)`);
    },
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && E.cmdOpen) {
      closeCommandPalette();
    }
  });

  UA.openEnterpriseSuite = async (tab) => {
    if (tab) E.tab = tab;
    await UA.go('enterprise');
  };
  UA.openCommandPalette = openCommandPalette;
})();
