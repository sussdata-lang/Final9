/* «منظومة شؤون الموظفين والرواتب المتكاملة» (وحدة 5.8 المطوّرة):
   تدمج كافة شاشات «سيستم الموارد البشرية المتكامل» العشر (واجهة الدخول، بيانات الموظفين، الحضور والانصراف،
   الغياب، الإجازات، الرواتب والحسابات، إدارة السلف، عقود الموظفين والتجديد، لوحة تحليل البيانات والإحصائيات،
   وبرمجة السيستم وإعدادات التنبيهات) مع الجداول الحالية دون أي تعارض. */
(function () {
  const UA = window.UA, { api, esc, toast } = UA;
  const today = () => new Date().toISOString().slice(0, 10);

  const TABS = [
    ['hub', 'الرئيسية والتنبيهات'],
    ['emp', 'بيانات الموظفين'],
    ['att', 'الحضور والانصراف'],
    ['abs', 'الغياب والخصومات'],
    ['leave', 'الإجازات والأرصدة'],
    ['sal', 'الرواتب والحسابات'],
    ['adv', 'إدارة السلف'],
    ['contract', 'عقود الموظفين والتجديد'],
    ['analytics', 'الإحصائيات والتحليلات'],
    ['config', 'برمجة النظام والتنبيهات'],
  ];

  const fresh = () => ({
    tab: 'hub',
    data: null,
    refDate: '2026-10-11',
    empSearch: '',
    empDept: '',
    empStatus: '',
    ctFilter: 'all',
    analyticsDept: 'all',
    modal: null, // { type: 'emp'|'att'|'abs'|'leave'|'adv'|'contract'|'renew'|'payslip', item: ... }
    err: '',
  });

  const B = fresh();
  const prevReset = UA.reset;
  UA.reset = () => {
    if (prevReset) prevReset();
    Object.assign(B, fresh());
  };

  const $id = (id) => document.getElementById(id);
  const nf = (n, digits = 0) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(n) || 0);
  const nfMoney = (n) => nf(n, 2);

  async function load() {
    if (!['hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr:manage', 'hr_payroll:approve', 'staffatt:manage'].some(UA.can)) { B.data = null; return; }   // موظف عادي: حضوره فقط
    let url = '/api/hr-pro/overview?refDate=' + encodeURIComponent(B.refDate);
    if (B.analyticsDept && B.analyticsDept !== 'all') {
      url += '&dept=' + encodeURIComponent(B.analyticsDept);
    }
    B.data = await api('GET', url);
  }
  UA.loaders.payroll = load;

  const badge = (text, tone) => {
    const map = {
      ok: 'background:#DDF3E6;color:#0E4D2E;border:1px solid #A8D8BE',
      warn: 'background:#FBEBD0;color:#8A6A1B;border:1px solid #C9A24B',
      bad: 'background:#FBE0DD;color:#B3261E;border:1px solid #F2B8B5',
      info: 'background:#E2EEE9;color:#054239;border:1px solid #BFD8CF',
      neutral: 'background:#F6F8F5;color:#10211D;border:1px solid #DCE3DD',
    };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;${map[tone] || map.neutral}">${esc(text)}</span>`;
  };

  /* ==================== الشريط العلوي السريع داخل المنظومة ==================== */
  function topNavStrip(D) {
    const tr = (s) => (window.UA && window.UA.i18n ? window.UA.i18n.tr(s) : s);
    const k = D.kpis;
    return `
      <section class="card no-print" style="margin-bottom:14px;padding:14px 16px;background:linear-gradient(135deg,#054239 0%,#0a5c4f 100%);color:#fff;border:none">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="background:#D5B65D;color:#054239;padding:2px 9px;border-radius:4px;font-size:11px;font-weight:800">HR ERP v12.5</span>
              <h2 style="margin:0;color:#fff;font-size:19px">${esc(tr('سيستم الموارد البشرية وشؤون الموظفين المتكامل'))}</h2>
            </div>
            <p style="margin:4px 0 0;font-size:12.5px;color:#A8D8BE">${esc(tr('إدارة متكاملة لبيانات الموظفين، الحضور والالتزام، الغياب، الإجازات، الرواتب، السلف، العقود، التحليلات، والتنبيهات الذكية'))}</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn sm" style="background:${B.tab === 'analytics' ? '#D5B65D' : 'rgba(255,255,255,0.14)'};color:${B.tab === 'analytics' ? '#054239' : '#fff'};border:1px solid rgba(255,255,255,0.25);font-weight:700" data-act="hrtab" data-t="analytics">📊 ${esc(tr('لوحة التحليلات والإحصائيات'))}</button>
            <button class="btn sm" style="background:${B.tab === 'config' ? '#D5B65D' : 'rgba(255,255,255,0.14)'};color:${B.tab === 'config' ? '#054239' : '#fff'};border:1px solid rgba(255,255,255,0.25);font-weight:700" data-act="hrtab" data-t="config">⚙️ ${esc(tr('إعدادات التنبيهات وبرمجة النظام (26)'))}</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.15)">
          ${TABS.map(([id, label]) => {
            const active = B.tab === id;
            return `<button type="button" data-act="hrtab" data-t="${id}" aria-pressed="${!!active}" style="padding:6px 12px;border-radius:6px;border:1px solid ${active ? '#D5B65D' : 'rgba(255,255,255,0.2)'};background:${active ? '#D5B65D' : 'rgba(255,255,255,0.08)'};color:${active ? '#054239' : '#fff'};font-weight:${active ? '800' : '600'};font-size:12.5px;cursor:pointer">${esc(tr(label))}</button>`;
          }).join('')}
        </div>
      </section>
    `;
  }

  /* ==================== 1) واجهة الدخول الرئيسية والتنبيهات (الصورة 9) ==================== */
  function hubTab(D) {
    const k = D.kpis;
    const tiles = [
      { t: 'emp', title: 'بيانات الموظفين', sub: `${k.totalEmployees} موظف مسجّل`, icon: 'users', tone: 'mint' },
      { t: 'att', title: 'الحضور والانصراف', sub: `متوسط الالتزام ${k.avgCommitment}%`, icon: 'clock', tone: 'sand' },
      { t: 'abs', title: 'الغياب والخصومات', sub: `${k.totalAbsenceDays} يوم غياب مسجّل`, icon: 'clipboard', tone: 'blue' },
      { t: 'leave', title: 'الإجازات والأرصدة', sub: `${k.totalLeaveDays} يوم إجازة`, icon: 'calendar', tone: 'lav' },
      { t: 'sal', title: 'الرواتب والحسابات', sub: `الصافي: ${nf(k.totalNetPayroll)}`, icon: 'wallet', tone: 'sand' },
      { t: 'adv', title: 'إدارة السلف', sub: `إجمالي السلف: ${nf(k.totalAdvances)}`, icon: 'exchange', tone: 'mint' },
      { t: 'contract', title: 'عقود الموظفين', sub: `${k.expiredContractsCount} منتهي · ${k.expiringSoonContractsCount} للتجديد`, icon: 'file', tone: 'blue' },
      { t: 'analytics', title: 'داشبورد التحليلات', sub: 'مخططات الأقسام والإجازات', icon: 'bars', tone: 'lav' },
      { t: 'config', title: 'برمجة النظام والتنبيهات', sub: 'القوائم المرجعية وشروط العقود', icon: 'settings', tone: 'mint' },
    ];

    const summaryCards = [
      { label: 'إجمالي الموظفين', val: nf(k.totalEmployees), headBg: 'var(--accent-soft)' },
      { label: 'الموظفون المتواجدون فعلياً', val: nf(k.activeEmployees), headBg: 'var(--accent-soft)' },
      { label: 'عدد أيام الغياب', val: nf(k.totalAbsenceDays), headBg: 'var(--accent-soft)' },
      { label: 'عدد أيام الإجازات', val: nf(k.totalLeaveDays), headBg: 'var(--accent-soft)' },
      { label: 'إجمالي رواتب الموظفين', val: nf(k.totalGrossPayroll), headBg: 'var(--t-sand-bg)' },
      { label: 'إجمالي سلف الموظفين', val: nf(k.totalAdvances), headBg: 'var(--t-sand-bg)' },
      { label: 'انتهاء العقود (منتهي / قريباً)', val: `${k.expiredContractsCount} / ${k.expiringSoonContractsCount}`, headBg: 'var(--t-sand-bg)' },
      { label: 'متوسط الرواتب الأساسية', val: nf(k.avgSalary), headBg: 'var(--t-sand-bg)' },
    ];

    const criticalAlerts = D.alerts.slice(0, 10);

    const tr = (s) => (window.UA && window.UA.i18n ? window.UA.i18n.tr(s) : s);
    return `
      <section class="card" style="margin-bottom:14px">
        <div style="text-align:center;margin-bottom:16px">
          <div style="display:inline-block;background:var(--accent-soft);color:var(--accent);border:1px solid var(--line);padding:8px 36px;border-radius:10px;font-size:20px;font-weight:800">
            ${esc(tr('سيستم الموارد البشرية المتكامل — بوابة التحكم السريع'))}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:20px">
          ${tiles.map((x) => `
            <button type="button" class="hr-tile" data-act="hrtab" data-t="${x.t}">
              <span class="sx-ic sx-${x.tone}">${window.UA.sx.ico(x.icon, 24)}</span>
              <span class="hr-tile-t"><b>${esc(tr(x.title))}</b><small>${esc(x.sub)}</small></span>
            </button>
          `).join('')}
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
          ${summaryCards.map((c) => `
            <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;text-align:center;background:var(--surface)">
              <div style="background:${c.headBg};color:var(--accent);padding:7px 10px;font-size:13px;font-weight:700">${esc(c.label)}</div>
              <div style="padding:10px;font-size:20px;font-weight:800;color:var(--fg);font-variant-numeric:tabular-nums">${esc(c.val)}</div>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div>
            <h3 style="margin:0">🔔 مركز التنبيهات الاستباقية لشؤون الموظفين (${D.alerts.length} تنبيه نشط)</h3>
            <p class="small" style="margin:2px 0 0">يرصد تلقائياً العقود المنتهية أو التي تحتاج تجديداً (خلال ${esc(D.settingsMap.contract_expiry_warning_days || 60)} يوماً)، وتدني نسبة الالتزام (< ${esc(D.settingsMap.attendance_good_pct || 85)}%)، وتجاوز أيام الغياب، والسلف المستحقة.</p>
          </div>
          <button class="btn sm pri" data-act="hrtab" data-t="config">تخصيص شروط وفترات التنبيهات ⚙️</button>
        </div>
        ${criticalAlerts.length ? `
          <div class="tbl-wrap">
            <table class="grid-tbl">
              <thead>
                <tr>
                  <th>مستوى التنبيه</th>
                  <th>التصنيف</th>
                  <th>الموظف</th>
                  <th>تفاصيل التنبيه</th>
                  <th>البيانات المرجعية</th>
                  <th>الإجراء السريع</th>
                </tr>
              </thead>
              <tbody>
                ${criticalAlerts.map((a) => `
                  <tr>
                    <td>${a.severity === 'critical' ? badge('حرج / عاجل', 'bad') : a.severity === 'warning' ? badge('تنبيه مبكر', 'warn') : badge('متابعة مالية', 'info')}</td>
                    <td><b>${esc(a.categoryLabel)}</b></td>
                    <td><b>${esc(a.employeeName)}</b> <span class="small mono">#${esc(a.employeeNo)}</span></td>
                    <td>${esc(a.title)}</td>
                    <td class="small">${esc(a.detail)}</td>
                    <td class="nowrap">
                      ${a.contractId ? `<button class="btn sm pri" data-act="hrrenewopen" data-id="${a.contractId}">تجديد العقد</button> ` : ''}
                      <button class="btn sm" data-act="hrtab" data-t="${esc(a.actionTab)}">فتح السجل</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p class="hint">لا توجد تنبيهات حرجة حالياً.</p>'}
      </section>
    `;
  }

  /* ==================== 2) شاشة بيانات الموظفين (الصورة 10) ==================== */
  function empTab(D) {
    const q = B.empSearch.trim().toLowerCase();
    const rows = D.employees.filter((e) => {
      if (B.empDept && e.department !== B.empDept) return false;
      if (B.empStatus && e.statusAr !== B.empStatus) return false;
      if (q && ![e.name, e.employeeNo, e.department, e.position, e.email, e.phone].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });

    return `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h2 style="margin:0">بيانات الموظفين <span class="small">(${rows.length} من ${D.employees.length})</span></h2>
            <p class="small" style="margin:2px 0 0">السجل الرئيسي للموظفين، الأقسام، الوظائف، حالات التعيين، أنواع العقود، والرواتب والبدلات</p>
          </div>
          <button class="btn pri" data-act="hrempnew">+ إضافة موظف جديد</button>
        </div>

        <div class="filters no-print" style="margin-bottom:12px">
          <label class="grow">بحث شامل
            <input id="hr-emp-q" value="${esc(B.empSearch)}" placeholder="ابحث بالاسم، كود الموظف، القسم، الوظيفة، الهاتف، البريد...">
          </label>
          <label>القسم
            <select id="hr-emp-dept">
              <option value="">كل الأقسام</option>
              ${D.lookups.departments.map((d) => `<option value="${esc(d.label)}"${B.empDept === d.label ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}
            </select>
          </label>
          <label>حالة الموظف
            <select id="hr-emp-st">
              <option value="">الكل</option>
              ${D.lookups.emp_statuses.map((s) => `<option value="${esc(s.label)}"${B.empStatus === s.label ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </label>
          <button class="btn" data-act="hrempfilter">تطبيق الفلتر</button>
        </div>

        <div class="tbl-wrap">
          <table class="grid-tbl">
            <thead>
              <tr>
                <th>كود الموظف</th>
                <th>اسم الموظف</th>
                <th>القسم</th>
                <th>الوظيفة</th>
                <th>الهاتف</th>
                <th>البريد الإلكتروني</th>
                <th>تاريخ التعيين</th>
                <th>حالة الموظف</th>
                <th>نوع العقد</th>
                <th>الراتب الأساسي</th>
                <th>بدل سكن</th>
                <th>بدل انتقال</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((e) => `
                <tr>
                  <td class="mono"><b>${esc(e.employeeNo)}</b></td>
                  <td><b>${esc(e.name)}</b></td>
                  <td>${esc(e.department)}</td>
                  <td>${esc(e.position)}</td>
                  <td class="mono">${esc(e.phone || '—')}</td>
                  <td class="mono">${esc(e.email || '—')}</td>
                  <td class="mono">${esc(e.hireDate)}</td>
                  <td>${e.statusAr === 'نشط' ? badge('نشط', 'ok') : e.statusAr === 'تحت الاختبار' ? badge('تحت الاختبار', 'warn') : badge(e.statusAr, 'bad')}</td>
                  <td>${badge(e.contractTypeAr, 'info')}</td>
                  <td class="mono"><b>${nf(e.baseSalary)}</b></td>
                  <td class="mono">${nf(e.housingAllowance)}</td>
                  <td class="mono">${nf(e.transportAllowance)}</td>
                  <td class="nowrap">
                    <button class="btn sm" data-act="hrempedit" data-id="${e.id}">تعديل</button>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="13" class="empty">لا يوجد موظفون مطابقون للبحث.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /* ==================== 3) شاشة حضور وانصراف (الصورة 8) ==================== */
  function attTab(D) {
    const exc = D.settingsMap.attendance_excellent_pct || 95;
    const good = D.settingsMap.attendance_good_pct || 85;
    return `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h2 style="margin:0">حضور وانصراف الموظفين ونسبة الالتزام</h2>
            <p class="small" style="margin:2px 0 0">المعادلة المطبّقة آلياً: <code dir="ltr">=IF(I3>=${exc}%;"ممتاز";IF(I3>=${good}%;"جيد";"يحتاج متابعة"))</code></p>
          </div>
          <button class="btn pri" data-act="hrattopen">+ تسجيل / تعديل حضور شهري</button>
        </div>

        <div class="tbl-wrap">
          <table class="grid-tbl">
            <thead>
              <tr>
                <th>كود الموظف</th>
                <th>اسم الموظف</th>
                <th>الوظيفة / القسم</th>
                <th>أيام العمل الفعلية</th>
                <th>أيام تأخير</th>
                <th>إجمالي ساعات التأخير</th>
                <th>أيام حضور كاملة</th>
                <th>أيام عمل الشهر</th>
                <th>نسبة الالتزام</th>
                <th>ملاحظات التقييم</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              ${D.attendance.map((a) => {
                const tone = a.evaluationNote === 'ممتاز' ? 'ok' : a.evaluationNote === 'جيد' ? 'info' : 'bad';
                return `
                  <tr>
                    <td class="mono"><b>${esc(a.employeeNo)}</b></td>
                    <td><b>${esc(a.employeeName)}</b></td>
                    <td>${esc(a.department)} · <span class="small">${esc(a.position)}</span></td>
                    <td class="mono"><b>${a.actualDays}</b></td>
                    <td class="mono">${a.lateDays}</td>
                    <td class="mono">${a.lateHours}</td>
                    <td class="mono"><b>${a.fullDays}</b></td>
                    <td class="mono">${a.workDaysMonth}</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:6px">
                        <span class="mono" style="font-weight:800">${a.commitmentRate}%</span>
                        <div style="width:60px;height:7px;background:#DCE3DD;border-radius:4px;overflow:hidden">
                          <div style="width:${a.commitmentRate}%;height:100%;background:${tone === 'ok' ? '#1B7F4B' : tone === 'info' ? '#0A5A4D' : '#B3261E'}"></div>
                        </div>
                      </div>
                    </td>
                    <td>${badge(a.evaluationNote, tone)}</td>
                    <td><button class="btn sm" data-act="hrattedit" data-emp="${a.employeeId}">تعديل</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /* ==================== 4) شاشة الغياب والخصومات (الصورة 7) ==================== */
  function absTab(D) {
    return `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h2 style="margin:0">سجل الغياب والخصومات الشهرية</h2>
            <p class="small" style="margin:2px 0 0">المعادلة المطبّقة: <code dir="ltr">إجمالي خصم الغياب = عدد أيام الغياب × (الراتب الأساسي / ${esc(D.settingsMap.salary_day_divisor || 30)})</code> · التحويل للمراجعة الإدارية عند ≥ ${esc(D.settingsMap.absence_review_threshold_days || 3)} أيام</p>
          </div>
          <button class="btn pri" data-act="hrabsnew">+ تسجيل واقعة غياب</button>
        </div>

        <div class="tbl-wrap">
          <table class="grid-tbl">
            <thead>
              <tr>
                <th>كود الموظف</th>
                <th>اسم الموظف</th>
                <th>القسم</th>
                <th>سبب الغياب</th>
                <th>عدد أيام الغياب</th>
                <th>خصم اليوم</th>
                <th>إجمالي خصم الغياب</th>
                <th>الشهر</th>
                <th>ملاحظات</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              ${D.absences.map((ab) => {
                const tone = ab.statusNote === 'لا يوجد غياب' ? 'ok' : ab.statusNote === 'مقبول' ? 'info' : 'bad';
                return `
                  <tr>
                    <td class="mono"><b>${esc(ab.employeeNo)}</b></td>
                    <td><b>${esc(ab.employeeName)}</b></td>
                    <td>${esc(ab.department)}</td>
                    <td>${esc(ab.reason)}</td>
                    <td class="mono"><b>${ab.absenceDays}</b></td>
                    <td class="mono">${nfMoney(ab.dailyRate)}</td>
                    <td class="mono" style="color:${ab.totalDeduction > 0 ? '#B3261E' : 'inherit'};font-weight:700">${nfMoney(ab.totalDeduction)}</td>
                    <td>${esc(ab.month)}</td>
                    <td>${badge(ab.statusNote, tone)}</td>
                    <td><button class="btn sm bad" data-act="hrabsdel" data-id="${ab.id}">حذف</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /* ==================== 5) شاشة الإجازات والأرصدة (الصورة 6) ==================== */
  function leaveTab(D) {
    return `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h2 style="margin:0">سجل الإجازات والأرصدة السنوية</h2>
            <p class="small" style="margin:2px 0 0">المعادلة المطبّقة: <code dir="ltr">=F7-SUMIFS(أيام الإجازة; الموظف; "سنوية")</code> مع احتساب خصم الإجازة بدون راتب آلياً في مسير الرواتب</p>
          </div>
          <button class="btn pri" data-act="hrleavenew">+ تسجيل إجازة جديدة</button>
        </div>

        <div class="tbl-wrap">
          <table class="grid-tbl">
            <thead>
              <tr>
                <th>كود الموظف</th>
                <th>اسم الموظف</th>
                <th>الوظيفة</th>
                <th>نوع الإجازة</th>
                <th>عدد أيام الإجازة</th>
                <th>رصيد سنوي</th>
                <th>المتبقي من السنوية</th>
                <th>خصم إجازة بدون راتب</th>
                <th>تاريخ البداية</th>
                <th>تاريخ النهاية</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              ${D.leaves.map((l) => `
                <tr>
                  <td class="mono"><b>${esc(l.employeeNo)}</b></td>
                  <td><b>${esc(l.employeeName)}</b></td>
                  <td>${esc(l.position)}</td>
                  <td>${badge(l.leaveTypeAr, l.leaveTypeAr === 'بدون راتب' ? 'warn' : l.leaveTypeAr === 'مرضية' ? 'info' : 'ok')}</td>
                  <td class="mono"><b>${l.days}</b></td>
                  <td class="mono">${l.annualQuota}</td>
                  <td class="mono"><b>${l.remainingAnnual}</b></td>
                  <td class="mono" style="color:${l.unpaidDeduction > 0 ? '#B3261E' : 'inherit'};font-weight:700">${nfMoney(l.unpaidDeduction)}</td>
                  <td class="mono">${esc(l.startDate)}</td>
                  <td class="mono">${esc(l.endDate)}</td>
                  <td>${badge(LEAVE_STATUS[l.status] || l.status, l.status === 'approved' ? 'ok' : l.status === 'pending' ? 'warn' : 'info')}${l.status === 'rejected' && l.notes ? `<div class="small">${esc(l.notes)}</div>` : ''}</td>
                  <td style="white-space:nowrap">${UA.rowPrintBtn('طلب إجازة', 'شؤون الموظفين', 'الموظف|رئيس القسم|مدير شؤون الموظفين')}${l.status === 'pending' && UA.can('hr:manage') ? `<button class="btn sm pri" data-act="hrleaveapprove" data-id="${l.id}">اعتماد</button>
                    <button class="btn sm" data-act="hrleavereject" data-id="${l.id}">رفض</button>
                    <button class="btn sm" data-act="hrleavecancel" data-id="${l.id}">إلغاء</button>` : ''}</td>
                </tr>
              `).join('') || '<tr><td colspan="12" class="empty">لا توجد إجازات مسجّلة.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  const LEAVE_STATUS = { pending: 'قيد الاعتماد', approved: 'معتمدة', rejected: 'مرفوضة', cancelled: 'ملغاة' };

  /* ==================== 6) شاشة الرواتب والحسابات (الصورة 3) ==================== */
  function salTab(D) {
    const totals = D.payroll.reduce((acc, p) => {
      acc.base += p.baseSalary;
      acc.housing += p.housingAllowance;
      acc.transport += p.transportAllowance;
      acc.gross += p.grossEarnings;
      acc.absDays += p.absenceDays;
      acc.absDed += p.absenceDeduction;
      acc.unpaidDed += p.unpaidLeaveDeduction;
      acc.advInst += p.advanceInstallment;
      acc.ins += p.insurance;
      acc.tax += p.taxes;
      acc.totDed += p.totalDeductions;
      acc.net += p.netSalary;
      return acc;
    }, { base: 0, housing: 0, transport: 0, gross: 0, absDays: 0, absDed: 0, unpaidDed: 0, advInst: 0, ins: 0, tax: 0, totDed: 0, net: 0 });

    return `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h2 style="margin:0">مسير الرواتب والحسابات التفصيلي</h2>
            <p class="small" style="margin:2px 0 0">يجمع تلقائياً الاستحقاقات (الأساسي + السكن + الانتقال) ويطرح الخصومات (الغياب + إجازة بدون راتب + قسط السلفة + التأمينات + الضرائب)</p>
          </div>
          <button class="btn no-print" data-act="print">🖨️ طباعة مسير الرواتب</button><span hidden data-doc-orient="landscape" data-doc-dept="شؤون الموظفين" data-doc-signers="مُعِدّ المسير|مدير شؤون الموظفين|المدير المالي|الآمر بالصرف"></span>
        </div>

        <div class="tbl-wrap">
          <table class="grid-tbl" data-tf="off" style="font-size:11.5px;width:100%">
            <thead>
              <tr style="background:#F6F8F5">
                <th style="padding:6px 4px">#</th>
                <th style="padding:6px 6px">اسم الموظف</th>
                <th style="padding:6px 5px">القسم</th>
                <th style="padding:6px 4px">الأساسي</th>
                <th style="padding:6px 4px">بدل سكن</th>
                <th style="padding:6px 4px">بدل انتقال</th>
                <th style="padding:6px 5px;background:#DDF3E6;color:#0E4D2E">الاستحقاقات</th>
                <th style="padding:6px 4px">غياب</th>
                <th style="padding:6px 4px">خصم غياب</th>
                <th style="padding:6px 4px">إجازة بلا راتب</th>
                <th style="padding:6px 4px">قسط سلفة</th>
                <th style="padding:6px 4px">تأمينات</th>
                <th style="padding:6px 4px">ضرائب</th>
                <th style="padding:6px 5px;background:#FBE0DD;color:#B3261E">الخصومات</th>
                <th style="padding:6px 6px;background:#A8D8BE;color:#054239">صافي الراتب</th>
                <th class="no-print" style="padding:6px 4px">قسيمة</th>
              </tr>
            </thead>
            <tbody>
              ${D.payroll.map((p) => `
                <tr>
                  <td class="mono" style="padding:5px 4px">${esc(p.employeeNo)}</td>
                  <td style="padding:5px 6px;white-space:nowrap"><b>${esc(p.name)}</b></td>
                  <td style="padding:5px 4px;white-space:nowrap">${esc(p.department)}</td>
                  <td class="mono" style="padding:5px 4px">${nfMoney(p.baseSalary)}</td>
                  <td class="mono" style="padding:5px 4px">${nfMoney(p.housingAllowance)}</td>
                  <td class="mono" style="padding:5px 4px">${nfMoney(p.transportAllowance)}</td>
                  <td class="mono" style="padding:5px 5px;background:#F6F8F5;font-weight:800;color:#0E4D2E">${nfMoney(p.grossEarnings)}</td>
                  <td class="mono" style="padding:5px 4px;text-align:center">${p.absenceDays}</td>
                  <td class="mono" style="padding:5px 4px">${nfMoney(p.absenceDeduction)}</td>
                  <td class="mono" style="padding:5px 4px">${nfMoney(p.unpaidLeaveDeduction)}</td>
                  <td class="mono" style="padding:5px 4px">${nfMoney(p.advanceInstallment)}</td>
                  <td class="mono" style="padding:5px 4px">${nfMoney(p.insurance)}</td>
                  <td class="mono" style="padding:5px 4px">${nfMoney(p.taxes)}</td>
                  <td class="mono" style="padding:5px 5px;background:#F6F8F5;font-weight:800;color:#B3261E">${nfMoney(p.totalDeductions)}</td>
                  <td class="mono" style="padding:5px 6px;background:#F6F8F5;font-weight:900;color:#054239">${nfMoney(p.netSalary)}</td>
                  <td class="no-print" style="padding:5px 4px"><button class="btn sm" style="padding:3px 7px;font-size:11px" data-act="hrpayslip" data-id="${p.employeeId}">كشف</button></td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr style="background:#F6F8F5;font-weight:800">
                <td colspan="3" style="padding:6px">الإجمالي (${D.payroll.length} موظف)</td>
                <td class="mono" style="padding:5px 4px">${nfMoney(totals.base)}</td>
                <td class="mono" style="padding:5px 4px">${nfMoney(totals.housing)}</td>
                <td class="mono" style="padding:5px 4px">${nfMoney(totals.transport)}</td>
                <td class="mono" style="padding:5px 5px;color:#0E4D2E">${nfMoney(totals.gross)}</td>
                <td class="mono" style="padding:5px 4px;text-align:center">${totals.absDays}</td>
                <td class="mono" style="padding:5px 4px">${nfMoney(totals.absDed)}</td>
                <td class="mono" style="padding:5px 4px">${nfMoney(totals.unpaidDed)}</td>
                <td class="mono" style="padding:5px 4px">${nfMoney(totals.advInst)}</td>
                <td class="mono" style="padding:5px 4px">${nfMoney(totals.ins)}</td>
                <td class="mono" style="padding:5px 4px">${nfMoney(totals.tax)}</td>
                <td class="mono" style="padding:5px 5px;color:#B3261E">${nfMoney(totals.totDed)}</td>
                <td class="mono" style="padding:5px 6px;color:#054239">${nfMoney(totals.net)}</td>
                <td class="no-print"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    `;
  }

  /* ==================== 7) شاشة إدارة السلف (الصورة 4) ==================== */
  function advTab(D) {
    return `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h2 style="margin:0">إدارة السلف والأقساط الشهرية</h2>
            <p class="small" style="margin:2px 0 0">متابعة السلف الممنوحة للموظفين، الأقساط الشهرية المستحقة في الرواتب، والرصيد المتبقي لكل سلفة</p>
          </div>
          <button class="btn pri" data-act="hradvnew">+ منح سلفة جديدة</button>
        </div>

        <div class="tbl-wrap">
          <table class="grid-tbl">
            <thead>
              <tr>
                <th>رقم السلفة</th>
                <th>كود الموظف</th>
                <th>اسم الموظف</th>
                <th>تاريخ السلفة</th>
                <th>قيمة السلفة</th>
                <th>عدد الأقساط</th>
                <th>حالة السلفة</th>
                <th>قسط الشهر</th>
                <th>المتبقي</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              ${D.advances.map((ad) => {
                const tone = ad.status === 'مدفوعة' ? 'ok' : ad.status === 'مستحقة' ? 'bad' : 'warn';
                return `
                  <tr>
                    <td class="mono"><b>${esc(ad.advanceCode)}</b></td>
                    <td class="mono">${esc(ad.employeeNo)}</td>
                    <td><b>${esc(ad.employeeName)}</b></td>
                    <td class="mono">${esc(ad.advanceDate)}</td>
                    <td class="mono"><b>${nfMoney(ad.amount)}</b></td>
                    <td class="mono">${ad.installmentsCount} <span class="small">(سُدّد ${ad.paidInstallments})</span></td>
                    <td>${badge(ad.status, tone)}</td>
                    <td class="mono"><b>${nfMoney(ad.monthlyInstallment)}</b></td>
                    <td class="mono" style="color:${ad.remainingAmount > 0 ? '#B3261E' : '#0E4D2E'};font-weight:800">${nfMoney(ad.remainingAmount)}</td>
                    <td class="nowrap">
                      ${UA.rowPrintBtn('سند سلفة موظف', 'شؤون الموظفين', 'الموظف|مدير شؤون الموظفين|المدير المالي')}
                      ${ad.status !== 'مدفوعة' && ad.remainingAmount > 0
                        ? `<button class="btn sm pri" data-act="hradvpay" data-id="${ad.id}">تسديد قسط</button>`
                        : '<span class="small">مكتملة ✓</span>'}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /* ==================== 8) شاشة عقود الموظفين والتجديد (الصورة 5) ==================== */
  function contractTab(D) {
    const rows = D.contracts.filter((c) => {
      if (B.ctFilter === 'expired') return c.remainingDays < 0;
      if (B.ctFilter === 'expiring') return c.renewalAlert === 'يحتاج تجديد';
      if (B.ctFilter === 'valid') return c.renewalAlert === 'ساري';
      return true;
    });

    return `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h2 style="margin:0">عقود الموظفين والتجديد الآلي</h2>
            <p class="small" style="margin:2px 0 0">يرصد الأيام المتبقية لكل عقد ويطلق تنبيه «يحتاج تجديد» قبل ${esc(D.settingsMap.contract_expiry_warning_days || 60)} يوماً من تاريخ الانتهاء</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label class="small" style="display:flex;align-items:center;gap:6px;margin:0">تاريخ الحساب المرجعي:
              <input type="date" id="hr-ref-date" value="${esc(B.refDate)}" style="width:auto;padding:4px 8px">
            </label>
            <button class="btn sm" data-act="hrrefdate">تحديث الحساب</button>
            <button class="btn pri" data-act="hrctnew">+ إبرام عقد جديد</button>
          </div>
        </div>

        <div class="chips no-print" style="margin-bottom:12px">
          <button class="chip" data-act="hrctflt" data-f="all" aria-pressed="${B.ctFilter === 'all'}">كل العقود (${D.contracts.length})</button>
          <button class="chip" data-act="hrctflt" data-f="expiring" aria-pressed="${B.ctFilter === 'expiring'}">⚠️ يحتاج تجديد / ينتهي قريباً (${D.kpis.expiringSoonContractsCount})</button>
          <button class="chip" data-act="hrctflt" data-f="expired" aria-pressed="${B.ctFilter === 'expired'}">🚨 عقود منتهية (${D.kpis.expiredContractsCount})</button>
          <button class="chip" data-act="hrctflt" data-f="valid" aria-pressed="${B.ctFilter === 'valid'}">✅ عقود سارية (${D.kpis.validContractsCount})</button>
        </div>

        <div class="tbl-wrap">
          <table class="grid-tbl">
            <thead>
              <tr>
                <th>كود الموظف</th>
                <th>اسم الموظف</th>
                <th>الوظيفة</th>
                <th>نوع العقد</th>
                <th>تاريخ بداية العقد</th>
                <th>تاريخ نهاية العقد</th>
                <th>مدة العقد بالأيام</th>
                <th>الأيام المتبقية</th>
                <th>تنبيه التجديد</th>
                <th>حالة العقد</th>
                <th>إجراء التجديد</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((c) => {
                const alertTone = c.renewalAlert === 'منتهي' ? 'bad' : c.renewalAlert === 'يحتاج تجديد' ? 'warn' : 'ok';
                const statusTone = c.contractStatus === 'منتهي' ? 'bad' : c.contractStatus === 'ينتهي قريبا' ? 'warn' : 'ok';
                return `
                  <tr>
                    <td class="mono"><b>${esc(c.employeeNo)}</b></td>
                    <td><b>${esc(c.employeeName)}</b></td>
                    <td>${esc(c.position)}</td>
                    <td>${esc(c.contractTypeAr)}</td>
                    <td class="mono">${esc(c.startDate)}</td>
                    <td class="mono">${esc(c.endDate)}</td>
                    <td class="mono">${nf(c.durationDays)}</td>
                    <td class="mono" style="direction:ltr;text-align:center;font-weight:800;color:${c.remainingDays < 0 ? '#B3261E' : c.remainingDays <= 60 ? '#8A6A1B' : '#0E4D2E'}">${c.remainingDays}</td>
                    <td>${badge(c.renewalAlert, alertTone)}</td>
                    <td>${badge(c.contractStatus, statusTone)}</td>
                    <td>${UA.rowPrintBtn('بيانات عقد عمل', 'شؤون الموظفين', 'الموظف|مدير شؤون الموظفين|الآمر بالتعيين')}<button class="btn sm pri" data-act="hrrenewopen" data-id="${c.id}">تجديد العقد</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /* ==================== 9) لوحة تحليل بيانات الموارد البشرية والإحصائيات ==================== */
  function analyticsTab(D) {
    const k = D.kpis;
    const lvDist = D.analytics.leaveDistribution;
    const deptRows = D.analytics.departmentBreakdown;
    const PAL = ['#054239', '#C9A24B', '#4DB6A0', '#0A5A4D', '#8A6A1B', '#1B7F4B'];

    const me = UA.S && UA.S.me;
    const isAdmin = D.userRole === 'admin' || (me && me.role === 'admin');
    const myDept = D.myDepartment || (me && me.department) || 'القسم التابع له';
    const activeDeptFilter = D.activeDepartmentFilter || B.analyticsDept || 'all';
    const allDepts = D.allDepartmentNames || [];
    const entStats = D.allEnterpriseStats || {};
    const entModules = D.enterpriseModules || [];

    let accPct = 0;
    const totalLv = Math.max(1, lvDist.reduce((s, x) => s + x.days, 0));
    const stops = lvDist.map((x, idx) => {
      const start = accPct;
      const pct = (x.days / totalLv) * 100;
      accPct += pct;
      return `${PAL[idx % PAL.length]} ${start.toFixed(1)}% ${accPct.toFixed(1)}%`;
    }).join(', ');

    const maxDeptCount = Math.max(1, ...deptRows.map((d) => d.count));

    let scopeBanner = '';
    if (isAdmin) {
      scopeBanner = `
        <div style="background:linear-gradient(135deg,#032E28 0%,#054239 100%);color:#fff;padding:14px 18px;border-radius:8px;margin-bottom:14px;border:1px solid #1B7F4B;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="background:#D5B65D;color:#054239;padding:3px 10px;border-radius:4px;font-size:11.5px;font-weight:800">👑 صلاحية الإدارة العليا (مدير النظام)</span>
              <h3 style="margin:0;color:#fff;font-size:16px">استعراض إحصائيات كافة قطاعات وأقسام الجامعة (9 قطاعات)</h3>
            </div>
            <p class="small" style="margin:4px 0 0;color:#a7f3d0">بصفتك مديراً للنظام، تمتلك صلاحية استعراض الإحصائيات الشاملة لكافة الإدارات، أو حصر التحليل بقسم محدد.</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <button class="btn sm" style="background:${activeDeptFilter === 'all' ? '#D5B65D' : 'rgba(255,255,255,0.15)'};color:${activeDeptFilter === 'all' ? '#054239' : '#fff'};font-weight:800" data-act="hranalyticsdept" data-dept="all">كافة الأقسام (${entStats.totalEnterpriseEmployees || k.totalEmployees})</button>
            ${allDepts.map((dp) => `<button class="btn sm" style="background:${activeDeptFilter === dp ? '#D5B65D' : 'rgba(255,255,255,0.15)'};color:${activeDeptFilter === dp ? '#054239' : '#fff'};font-weight:700" data-act="hranalyticsdept" data-dept="${esc(dp)}">${esc(dp)}</button>`).join('')}
            <button class="btn sm" style="background:#0A5A4D;color:#fff;font-weight:800;border:1px solid #4DB6A0" data-act="hropenrecharts" data-tab="departments">📊 تحليلات الأقسام في صفحة الإحصاءات</button>
          </div>
        </div>
      `;
    } else {
      scopeBanner = `
        <div style="background:#F6F8F5;border:1px solid #E6CB84;color:#8A6A1B;padding:12px 16px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">🔒</span>
            <div>
              <div style="font-weight:800;font-size:14px">عرض الإحصائيات مقيّد بقسم: «${esc(myDept)}»</div>
              <div class="small" style="color:#8A6A1B">حسابك ينتمي إلى قسم (${esc(myDept)}). تم عزل بيانات الأقسام الأخرى تلقائياً وفق سياسة أمن وصلاحيات النظام. مدير النظام فقط يمتلك استعراض كافة الأقسام.</div>
            </div>
          </div>
          <button class="btn sm" style="background:#054239;color:#D5B65D;font-weight:800" data-act="hropenrecharts" data-tab="departments">📊 تحليلات الأقسام في صفحة الإحصاءات</button>
        </div>
      `;
    }

    let entGridHtml = '';
    if (entModules && entModules.length > 0) {
      entGridHtml = `
        <div style="margin-bottom:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h3 style="margin:0;font-size:15px;color:#10211D">🏢 المؤشرات التشغيلية لكافة قطاعات وأقسام الجامعة الـ 9</h3>
            <span class="small hint">مؤشرات حية متزامنة مع كافة وحدات المنظومة</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px">
            ${entModules.map((m) => `
              <div style="border:1px solid #DCE3DD;border-radius:8px;padding:12px;background:#fff;border-top:3px solid #054239;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
                  <span style="font-size:11px;font-weight:800;color:#054239;background:#F6F8F5;padding:1px 6px;border-radius:4px">${esc(m.code)}</span>
                  <span style="font-size:11px;color:#1B7F4B;font-weight:700">● ${esc(m.status)}</span>
                </div>
                <div style="font-weight:800;font-size:13.5px;color:#10211D;margin-bottom:4px">${esc(m.name)}</div>
                <div class="small hint" style="margin-bottom:8px">${esc(m.scope)}</div>
                <div style="background:#F6F8F5;padding:6px 8px;border-radius:6px;font-size:11.5px;display:flex;justify-content:space-between;border:1px solid #F6F8F5">
                  <span>${esc(m.kpi1Label)}: <b>${esc(m.kpi1Val)}</b></span>
                  <span>${esc(m.kpi2Label)}: <b>${esc(m.kpi2Val)}</b></span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    return `
      ${scopeBanner}

      ${entGridHtml}

      <section class="card" style="margin-bottom:14px">
        <div style="background:#054239;color:#fff;padding:10px 18px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <h2 style="margin:0;color:#fff;font-size:19px">لوحة تحليل بيانات الموارد البشرية والإحصائيات</h2>
            <p class="small" style="margin:2px 0 0;color:#DCE9E4">
              ${activeDeptFilter === 'all' ? 'عرض شامل لكافة موظفي الجامعة' : `عرض مخصص لقسم: «${esc(activeDeptFilter)}»`}
            </p>
          </div>
          <button class="btn sm" style="background:#D5B65D;color:#042f28;font-weight:800" data-act="hropenrecharts" data-tab="departments">📊 تحليلات الأقسام في صفحة الإحصاءات</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:18px">
          <div style="border:1px solid #DCE3DD;border-radius:6px;overflow:hidden;text-align:center">
            <div style="background:#054239;color:#fff;padding:8px;font-weight:700">إجمالي الموظفين</div>
            <div style="padding:14px;font-size:24px;font-weight:900">${nf(k.totalEmployees)}</div>
          </div>
          <div style="border:1px solid #DCE3DD;border-radius:6px;overflow:hidden;text-align:center">
            <div style="background:#054239;color:#fff;padding:8px;font-weight:700">نشط</div>
            <div style="padding:14px;font-size:24px;font-weight:900;color:#0E4D2E">${nf(k.activeEmployees)}</div>
          </div>
          <div style="border:1px solid #DCE3DD;border-radius:6px;overflow:hidden;text-align:center">
            <div style="background:#054239;color:#fff;padding:8px;font-weight:700">متوسط الالتزام</div>
            <div style="padding:14px;font-size:24px;font-weight:900;color:#0A5A4D">%${k.avgCommitment}</div>
          </div>
          <div style="border:1px solid #DCE3DD;border-radius:6px;overflow:hidden;text-align:center">
            <div style="background:#054239;color:#fff;padding:8px;font-weight:700">إجمالي الاستحقاقات والرواتب</div>
            <div style="padding:14px;font-size:24px;font-weight:900;color:#054239">${nf(k.totalGrossPayroll)}</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
          <!-- توزيع أيام الإجازات حسب النوع -->
          <div style="border:1px solid #DCE3DD;border-radius:8px;padding:16px;background:#fff">
            <h3 style="margin:0 0 14px;text-align:center">توزيع أيام الإجازات حسب النوع (${k.totalLeaveDays} يوم)</h3>
            <div style="display:flex;align-items:center;justify-content:center;gap:24px;flex-wrap:wrap">
              <div style="width:190px;height:190px;border-radius:50%;background:conic-gradient(${stops});display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
                <div style="width:96px;height:96px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center">
                  <strong style="font-size:20px">${k.totalLeaveDays}</strong>
                  <span class="small">إجمالي الأيام</span>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;min-width:170px">
                ${lvDist.map((x, idx) => `
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px">
                    <span style="display:flex;align-items:center;gap:6px">
                      <i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${PAL[idx % PAL.length]}"></i>
                      <b>${esc(x.type)}</b>
                    </span>
                    <span style="font-variant-numeric:tabular-nums;font-weight:700">${x.days} يوم (${x.percentage}%)</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- عدد الموظفين حسب القسم -->
          <div style="border:1px solid #DCE3DD;border-radius:8px;padding:16px;background:#fff">
            <h3 style="margin:0 0 14px;text-align:center">عدد الموظفين والرواتب حسب القسم</h3>
            <div style="display:flex;flex-direction:column;gap:9px">
              ${deptRows.map((d) => `
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px">
                    <b>${esc(d.department)}</b>
                    <span style="font-variant-numeric:tabular-nums;font-weight:600;color:#10211D">${d.count} موظف · راتب ${nf(d.totalSalaries)} · التزام ${d.avgCommitment}%</span>
                  </div>
                  <div style="height:10px;background:#F6F8F5;border-radius:5px;overflow:hidden">
                    <div style="width:${Math.max(4, (d.count / maxDeptCount) * 100)}%;height:100%;background:#054239;border-radius:5px"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </section>

      <div class="grid2">
        <section class="card">
          <h3>جدول توزيع الموظفين والالتزام حسب القسم</h3>
          <div class="tbl-wrap">
            <table class="grid-tbl">
              <thead>
                <tr>
                  <th>القسم</th>
                  <th>عدد الموظفين</th>
                  <th>إجمالي الاستحقاقات</th>
                  <th>متوسط الالتزام</th>
                </tr>
              </thead>
              <tbody>
                ${deptRows.map((d) => `
                  <tr>
                    <td><b>${esc(d.department)}</b></td>
                    <td class="mono"><b>${d.count}</b></td>
                    <td class="mono">${nf(d.totalSalaries)}</td>
                    <td class="mono">${d.avgCommitment}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <h3>ملخص حالة العقود والانضباط المؤسسي</h3>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div>
              <h4 style="margin:0 0 6px">حالة عقود الموظفين (${D.contracts.length} عقد)</h4>
              ${D.analytics.contractBreakdown.map((c) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid #DCE3DD;border-radius:6px;margin-bottom:6px">
                  <span style="display:flex;align-items:center;gap:8px">
                    <i style="width:12px;height:12px;border-radius:50%;background:${c.color};display:inline-block"></i>
                    <b>${esc(c.label)}</b>
                  </span>
                  <strong class="mono">${c.count}</strong>
                </div>
              `).join('')}
            </div>
            <div>
              <h4 style="margin:0 0 6px">مستويات الالتزام بالحضور والانصراف</h4>
              ${D.analytics.commitmentBreakdown.map((c) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid #DCE3DD;border-radius:6px;margin-bottom:6px">
                  <span style="display:flex;align-items:center;gap:8px">
                    <i style="width:12px;height:12px;border-radius:50%;background:${c.color};display:inline-block"></i>
                    <b>${esc(c.label)}</b>
                  </span>
                  <strong style="font-variant-numeric:tabular-nums">${c.count} موظف</strong>
                </div>
              `).join('')}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  /* ==================== 10) شاشة برمجة السيستم وإعدادات التنبيهات (الصورة 2 + طلب المستخدم) ==================== */
  function configTab(D) {
    const s = D.settingsMap;
    const cats = [
      ['positions', 'الوظائف'],
      ['emp_statuses', 'حالات الموظف'],
      ['contract_types', 'أنواع العقود'],
      ['leave_types', 'أنواع الإجازات'],
      ['absence_reasons', 'أسباب الغياب'],
      ['advance_statuses', 'حالة السلفة'],
      ['contract_statuses', 'حالة العقد'],
    ];

    return `
      <section class="card" style="margin-bottom:14px">
        <div style="background:#054239;color:#fff;padding:10px 16px;border-radius:6px;margin-bottom:14px">
          <h2 style="margin:0;color:#fff;font-size:18px">🔔 إعدادات التنبيهات الذكية والسياسات المالية لشؤون الموظفين</h2>
          <p class="small" style="margin:4px 0 0;color:#A8D8BE">تحكّم بفترة التنبيه قبل انتهاء عقد الموظف، شروط تقييم الحضور والانصراف، حدود المراجعة الإدارية للغياب، ومعادلات الرواتب والبدلات</p>
        </div>

        <form id="hr-alert-settings-form" class="form" style="border:0;margin:0;padding:0">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
            <label>فترة التنبيه المبكر قبل انتهاء عقد الموظف (يوم)
              <input type="number" id="hs-ct-warn" min="1" max="365" value="${esc(s.contract_expiry_warning_days || 60)}" required>
              <span class="small">العقود التي يتبقى لها أقل من هذه المدة تظهر بحالة «ينتهي قريبا / يحتاج تجديد»</span>
            </label>
            <label>فترة التنبيه الحرج لانتهاء العقد (يوم)
              <input type="number" id="hs-ct-crit" min="1" max="180" value="${esc(s.contract_expiry_critical_days || 15)}" required>
              <span class="small">يُصنّف التنبيه كأولوية قصوى عند اقتراب انتهاء العقد لهذه المدة</span>
            </label>
            <label>فترة التنبيه قبل انتهاء فترة الاختبار 3 شهور (يوم)
              <input type="number" id="hs-prob-days" min="1" max="90" value="${esc(s.probation_expiry_alert_days || 14)}" required>
            </label>
            <label>الحد الأدنى لنسبة الالتزام «ممتاز» (%)
              <input type="number" id="hs-att-exc" min="50" max="100" value="${esc(s.attendance_excellent_pct || 95)}" required>
            </label>
            <label>الحد الأدنى لنسبة الالتزام «جيد» قبل تنبيه المتابعة (%)
              <input type="number" id="hs-att-good" min="30" max="99" value="${esc(s.attendance_good_pct || 85)}" required>
              <span class="small">أي موظف تقل نسبة التزامه عن هذا الحد يظهر له تنبيه «يحتاج متابعة»</span>
            </label>
            <label>عدد أيام الغياب الشهري للمراجعة الإدارية (أيام)
              <input type="number" id="hs-abs-rev" min="1" max="30" value="${esc(s.absence_review_threshold_days || 3)}" required>
            </label>
            <label>أيام العمل المعيارية في الشهر (حساب الالتزام)
              <input type="number" id="hs-work-days" min="15" max="31" value="${esc(s.standard_month_work_days || 26)}" required>
            </label>
            <label>الرصيد السنوي الافتراضي للإجازات (يوم)
              <input type="number" id="hs-lv-quota" min="1" max="60" value="${esc(s.default_annual_leave_days || 21)}" required>
            </label>
            <label>تنبيه انخفاض رصيد الإجازات عند تبقي (أيام)
              <input type="number" id="hs-lv-low" min="0" max="15" value="${esc(s.low_leave_balance_alert_days || 3)}" required>
            </label>
            <label>مقسوم الشهر لحساب أجر اليوم في الخصومات
              <input type="number" id="hs-day-div" min="20" max="31" value="${esc(s.salary_day_divisor || 30)}" required>
            </label>
            <label>نسبة بدل السكن الافتراضية من الأساسي (%)
              <input type="number" id="hs-housing-pct" min="0" max="100" value="${esc(s.default_housing_pct || 18)}" required>
            </label>
            <label>نسبة التأمينات الاجتماعية (%) / الضرائب (%)
              <div style="display:flex;gap:8px">
                <input type="number" id="hs-ins-pct" min="0" max="50" value="${esc(s.default_insurance_pct || 11)}" title="نسبة التأمينات %">
                <input type="number" id="hs-tax-pct" min="0" max="50" value="${esc(s.default_tax_pct || 8)}" title="نسبة الضرائب %">
              </div>
            </label>
          </div>

          <div style="display:flex;gap:18px;flex-wrap:wrap;margin:14px 0;padding:10px 12px;background:#F6F8F5;border-radius:6px;border:1px solid #DCE3DD">
            <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" id="hs-en-ct" style="width:auto"${s.enable_contract_alerts !== '0' ? ' checked' : ''}> تفعيل تنبيهات انتهاء وتجديد العقود</label>
            <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" id="hs-en-att" style="width:auto"${s.enable_attendance_alerts !== '0' ? ' checked' : ''}> تفعيل تنبيهات التزام الحضور والغياب</label>
            <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" id="hs-en-adv" style="width:auto"${s.enable_advance_alerts !== '0' ? ' checked' : ''}> تفعيل تنبيهات أقساط السلف المستحقة</label>
            <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" id="hs-en-lv" style="width:auto"${s.enable_leave_alerts !== '0' ? ' checked' : ''}> تفعيل تنبيهات انخفاض رصيد الإجازات</label>
          </div>

          <div class="actions" style="margin:0">
            <button class="btn pri" type="submit">💾 حفظ إعدادات التنبيهات وإعادة فحص العقود والالتزام</button>
          </div>
        </form>
      </section>

      <section class="card">
        <div style="background:#0A5A4D;color:#fff;padding:9px 16px;border-radius:6px;text-align:center;margin-bottom:14px">
          <h2 style="margin:0;color:#fff;font-size:19px">برمجة السيستم — القوائم المرجعية للنظام</h2>
        </div>
        <p class="small" style="margin:0 0 12px">الأقسام لا تُضاف من هنا: تتبع هيكل الجامعة في لوحة الإدارة ← وحدات النظام، والكليات والمعاهد.</p>

        <form id="hr-lookup-add-form" class="inline-form" style="margin-bottom:14px">
          <label>الفئة
            <select id="hlk-cat">
              ${cats.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
            </select>
          </label>
          <label class="grow">إضافة عنصر جديد للقائمة
            <input id="hlk-label" required maxlength="80" placeholder="اكتب اسم الوظيفة أو نوع العقد أو الإجازة...">
          </label>
          <button class="btn pri" type="submit">+ إضافة للسيستم</button>
        </form>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px">
          ${cats.map(([k, title]) => `
            <div style="border:1px solid #DCE3DD;border-radius:6px;overflow:hidden;background:#fff">
              <div style="background:#054239;color:#fff;padding:8px 10px;font-weight:700;text-align:center;font-size:13px">${esc(title)}</div>
              <ul style="list-style:none;margin:0;padding:0">
                ${(D.lookups[k] || []).map((item) => `
                  <li style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid #F6F8F5;font-size:12.5px">
                    <span>${esc(item.label)}</span>
                    <button type="button" class="link" style="color:#B3261E;font-size:11px" data-act="hrlkdel" data-id="${item.id}" title="حذف">✕</button>
                  </li>
                `).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  /* ==================== النوافذ المنبثقة (Modals) ==================== */
  function modalHtml(D) {
    const m = B.modal;
    if (!m) return '';
    let content = '';

    if (m.type === 'emp') {
      const e = m.item || {};
      content = `
        <h2 id="mttl">${e.id ? 'تعديل بيانات موظف' : 'إضافة موظف جديد'}</h2>
        <form id="hr-emp-form" class="form" style="border:0;margin:0;padding:0">
          <div class="two">
            <label>كود الموظف *<input id="he-no" required value="${esc(e.employeeNo || String(D.employees.length + 1))}" ${e.id ? 'disabled' : ''}></label>
            <label>اسم الموظف *<input id="he-name" required value="${esc(e.name || '')}"></label>
          </div>
          <div class="two">
            <label>القسم *
              <select id="he-dept" data-no-other="1">
                ${e.department && !D.lookups.departments.some((d) => d.label === e.department) ? `<option value="${esc(e.department)}" selected>${esc(e.department)} (قسم قديم، اختر بديله)</option>` : ''}
                ${D.lookups.departments.map((d) => `<option value="${esc(d.label)}"${e.department === d.label ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}
              </select>
            </label>
            <label>الوظيفة *
              <select id="he-pos">
                ${D.lookups.positions.map((p) => `<option value="${esc(p.label)}"${e.position === p.label ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="two">
            <label>الهاتف<input id="he-phone" dir="ltr" value="${esc(e.phone || '0944000000')}"></label>
            <label>البريد الإلكتروني<input id="he-email" type="email" dir="ltr" value="${esc(e.email || '')}"></label>
          </div>
          <div class="two">
            <label>تاريخ التعيين *<input id="he-hire" type="date" required value="${esc(e.hireDate || '2026-01-10')}"></label>
            <label>حالة الموظف *
              <select id="he-status">
                ${D.lookups.emp_statuses.map((s) => `<option value="${esc(s.label)}"${e.statusAr === s.label ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="two">
            <label>نوع العقد *
              <select id="he-ctype">
                ${D.lookups.contract_types.map((c) => `<option value="${esc(c.label)}"${e.contractTypeAr === c.label ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
              </select>
            </label>
            <label>الراتب الأساسي *<input id="he-base" type="number" min="0" required value="${esc(e.baseSalary ?? 5950)}"></label>
          </div>
          <div class="two">
            <label>بدل سكن<input id="he-housing" type="number" min="0" value="${esc(e.housingAllowance ?? 1071)}"></label>
            <label>بدل انتقال<input id="he-transport" type="number" min="0" value="${esc(e.transportAllowance ?? 575)}"></label>
          </div>
          <div class="two">
            <label>التأمينات<input id="he-ins" type="number" min="0" value="${esc(e.insuranceAmount ?? 654)}"></label>
            <label>الضرائب<input id="he-tax" type="number" min="0" value="${esc(e.taxAmount ?? 476)}"></label>
          </div>
          <div class="actions">
            <button class="btn pri" type="submit">حفظ البيانات</button>
            <button class="btn" type="button" data-act="hrmclose">إلغاء</button>
          </div>
        </form>
      `;
    } else if (m.type === 'att') {
      const a = m.item || {};
      content = `
        <h2 id="mttl">تسجيل / تحديث الحضور والانصراف الشهري</h2>
        <form id="hr-att-form" class="form" style="border:0;margin:0;padding:0">
          <label>الموظف *
            <select id="ha-emp" required>
              ${D.employees.map((e) => `<option value="${e.id}"${a.employeeId === e.id ? ' selected' : ''}>${esc(e.name)} (#${esc(e.employeeNo)})</option>`).join('')}
            </select>
          </label>
          <div class="two">
            <label>أيام عمل الشهر المعيارية<input id="ha-work" type="number" min="1" max="31" value="${esc(a.workDaysMonth ?? 26)}" required></label>
            <label>أيام العمل الفعلية *<input id="ha-actual" type="number" min="0" max="31" value="${esc(a.actualDays ?? 25)}" required></label>
          </div>
          <div class="two">
            <label>أيام التأخير<input id="ha-lated" type="number" min="0" max="31" value="${esc(a.lateDays ?? 1)}" required></label>
            <label>إجمالي ساعات التأخير<input id="ha-lateh" type="number" min="0" step="0.1" value="${esc(a.lateHours ?? 1.5)}" required></label>
          </div>
          <div class="actions">
            <button class="btn pri" type="submit">حفظ واحتساب نسبة الالتزام</button>
            <button class="btn" type="button" data-act="hrmclose">إلغاء</button>
          </div>
        </form>
      `;
    } else if (m.type === 'abs') {
      content = `
        <h2 id="mttl">تسجيل غياب موظف واحتساب الخصم</h2>
        <form id="hr-abs-form" class="form" style="border:0;margin:0;padding:0">
          <label>الموظف *
            <select id="hab-emp" required>
              ${D.employees.map((e) => `<option value="${e.id}">${esc(e.name)} (#${esc(e.employeeNo)} — الراتب: ${nf(e.baseSalary)})</option>`).join('')}
            </select>
          </label>
          <div class="two">
            <label>سبب الغياب *
              <select id="hab-reason">
                ${D.lookups.absence_reasons.map((r) => `<option value="${esc(r.label)}">${esc(r.label)}</option>`).join('')}
              </select>
            </label>
            <label>عدد أيام الغياب *<input id="hab-days" type="number" min="1" max="30" value="1" required></label>
          </div>
          <label>الشهر<input id="hab-month"></label>
          <div class="actions">
            <button class="btn pri" type="submit">تسجيل الغياب واحتساب الخصم</button>
            <button class="btn" type="button" data-act="hrmclose">إلغاء</button>
          </div>
        </form>
      `;
    } else if (m.type === 'leave') {
      content = `
        <h2 id="mttl">طلب إجازة موظف</h2>
        ${UA.formKit.render({
          id: 'hr-leave-form',
          bare: true,
          sections: [{ title: 'تفاصيل الطلب', html: `<label>الموظف *
            <select id="hlv-emp" required>
              ${D.employees.map((e) => `<option value="${e.id}">${esc(e.name)} (المتبقي السنوي: ${e.remainingAnnualLeave} يوم)</option>`).join('')}
            </select>
          </label>
          <label>نوع الإجازة *
            <select id="hlv-type">
              ${D.lookups.leave_types.map((t) => `<option value="${esc(t.label)}">${esc(t.label)}</option>`).join('')}
            </select>
          </label>
          <label>عدد الأيام *<input id="hlv-days" type="number" min="1" max="90" value="3" required></label>
          <label>تاريخ البداية *<input id="hlv-start" type="date" value="${today()}" required></label>
          <label>تاريخ النهاية *<input id="hlv-end" type="date" value="${today()}" required></label>` }],
          justification: { id: 'hlv-reason', label: 'سبب الإجازة', max: 200 },
          actions: `<button class="btn pri" type="submit">إرسال الطلب للاعتماد</button>
            <button class="btn" type="button" data-act="hrmclose">إلغاء</button>`,
        })}
      `;
    } else if (m.type === 'leave_reject') {
      content = `
        <h2 id="mttl">رفض طلب الإجازة</h2>
        ${UA.formKit.render({
          id: 'hr-leave-reject-form',
          bare: true,
          sections: [{ title: 'سبب الرفض', html: `<label>السبب *<input id="hlr-reason" maxlength="200" required></label>` }],
          actions: `<button class="btn pri" type="submit">تأكيد الرفض</button>
            <button class="btn" type="button" data-act="hrmclose">إلغاء</button>`,
        })}
      `;
    } else if (m.type === 'adv') {
      content = `
        <h2 id="mttl">منح سلفة مالية جديدة</h2>
        ${UA.formKit.render({
          id: 'hr-adv-form',
          bare: true,
          sections: [{ title: 'تفاصيل الطلب', html: `<label>الموظف *
            <select id="had-emp" required>
              ${D.employees.map((e) => `<option value="${e.id}">${esc(e.name)} (#${esc(e.employeeNo)})</option>`).join('')}
            </select>
          </label>
          <label>قيمة السلفة *<input id="had-amount" type="number" min="100" step="50" required></label>
          <label>عدد الأقساط الشهرية *<input id="had-count" type="number" min="1" max="36" value="3" required></label>
          <label>تاريخ السلفة *<input id="had-date" type="date" value="${today()}" required></label>
          <label>حالة السلفة
            <select id="had-status">
              ${D.lookups.advance_statuses.map((s) => `<option value="${esc(s.label)}">${esc(s.label)}</option>`).join('')}
            </select>
          </label>` }],
          justification: { id: 'had-notes', label: 'سبب السلفة', max: 200 },
          actions: `<button class="btn pri" type="submit">اعتماد السلفة وجدولة الأقساط</button>
            <button class="btn" type="button" data-act="hrmclose">إلغاء</button>`,
        })}
      `;
    } else if (m.type === 'contract' || m.type === 'renew') {
      const c = m.item || {};
      const isRenew = m.type === 'renew';
      content = `
        <h2 id="mttl">${isRenew ? `تجديد عقد الموظف: ${esc(c.employeeName)}` : 'إبرام عقد عمل جديد'}</h2>
        <form id="hr-contract-form" class="form" style="border:0;margin:0;padding:0">
          ${!isRenew ? `
            <label>الموظف *
              <select id="hct-emp" required>
                ${D.employees.map((e) => `<option value="${e.id}">${esc(e.name)} (#${esc(e.employeeNo)})</option>`).join('')}
              </select>
            </label>
          ` : ''}
          <div class="two">
            <label>نوع العقد *
              <select id="hct-type">
                ${D.lookups.contract_types.map((t) => `<option value="${esc(t.label)}"${c.contractTypeAr === t.label ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
              </select>
            </label>
            <label>الراتب التعاقدي *<input id="hct-sal" type="number" min="0" value="${esc(c.salary || 5950)}" required></label>
          </div>
          <div class="two">
            <label>تاريخ بداية العقد *<input id="hct-start" type="date" value="${esc(isRenew ? '2026-10-11' : (c.startDate || '2026-10-11'))}" required></label>
            <label>تاريخ نهاية العقد *<input id="hct-end" type="date" value="${esc(isRenew ? '2027-10-11' : (c.endDate || '2027-10-11'))}" required></label>
          </div>
          <div class="actions">
            <button class="btn pri" type="submit">${isRenew ? 'اعتماد التجديد وإزالة التنبيه' : 'حفظ العقد'}</button>
            <button class="btn" type="button" data-act="hrmclose">إلغاء</button>
          </div>
        </form>
      `;
    } else if (m.type === 'payslip') {
      const p = m.item;
      content = `
        <h2 id="mttl">قسيمة راتب تفصيلية — ${esc(p.name)}</h2>
        <div style="border:1px solid #DCE3DD;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;border-bottom:1px solid #DCE3DD;padding-bottom:8px">
            <div><b>الموظف:</b> ${esc(p.name)} (#${esc(p.employeeNo)})</div>
            <div><b>القسم / الوظيفة:</b> ${esc(p.department)} — ${esc(p.position)}</div>
          </div>
          <div class="grid2">
            <div>
              <h4 style="margin:0 0 6px;color:#0E4D2E">الاستحقاقات</h4>
              <p class="small" style="margin:4px 0">الراتب الأساسي: <b class="mono">${nfMoney(p.baseSalary)}</b></p>
              <p class="small" style="margin:4px 0">بدل سكن: <b class="mono">${nfMoney(p.housingAllowance)}</b></p>
              <p class="small" style="margin:4px 0">بدل انتقال: <b class="mono">${nfMoney(p.transportAllowance)}</b></p>
              <p style="margin:8px 0 0;color:#0E4D2E"><b>إجمالي الاستحقاقات: <span class="mono">${nfMoney(p.grossEarnings)}</span></b></p>
            </div>
            <div>
              <h4 style="margin:0 0 6px;color:#B3261E">الخصومات والاستقطاعات</h4>
              <p class="small" style="margin:4px 0">خصم الغياب (${p.absenceDays} يوم): <b class="mono">${nfMoney(p.absenceDeduction)}</b></p>
              <p class="small" style="margin:4px 0">خصم إجازة بدون راتب: <b class="mono">${nfMoney(p.unpaidLeaveDeduction)}</b></p>
              <p class="small" style="margin:4px 0">قسط السلفة الشهري: <b class="mono">${nfMoney(p.advanceInstallment)}</b></p>
              <p class="small" style="margin:4px 0">تأمينات اجتماعية: <b class="mono">${nfMoney(p.insurance)}</b></p>
              <p class="small" style="margin:4px 0">ضرائب: <b class="mono">${nfMoney(p.taxes)}</b></p>
              <p style="margin:8px 0 0;color:#B3261E"><b>إجمالي الخصومات: <span class="mono">${nfMoney(p.totalDeductions)}</span></b></p>
            </div>
          </div>
          <div style="margin-top:12px;padding:10px;background:#F6F8F5;border-radius:6px;text-align:center;font-size:18px;font-weight:900;color:#054239">
            صافي الراتب المستحق للصرف: <span class="mono">${nfMoney(p.netSalary)}</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn pri no-print" type="button" data-act="print">🖨️ طباعة القسيمة</button><span hidden data-doc-title="قسيمة راتب" data-doc-dept="شؤون الموظفين" data-doc-signers="المحاسب|مدير شؤون الموظفين|توقيع الموظف بالاستلام"></span>
          <button class="btn" type="button" data-act="hrmclose">إغلاق</button>
        </div>
      `;
    }

    return `<div class="modal-back" data-act="hrmclose"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mttl">${content}</div></div>`;
  }

  /* ==================== العرض الرئيسي ==================== */
  let autoLoading = false;
  UA.views.payroll = () => {
    const D = B.data;
    if (!D) {
      if (!autoLoading) {
        autoLoading = true;
        load().then(() => { autoLoading = false; UA.render(); }).catch(() => { autoLoading = false; });
      }
      return '<section class="card"><p class="hint">جارٍ تحميل منظومة شؤون الموظفين المتكاملة…</p></section>';
    }
    const tr = (s) => (window.UA && window.UA.i18n ? window.UA.i18n.tr(s) : s);
    // نُضمّن أيضاً sub-tabs ليتكامل مع القائمة الجانبية في shell.js بسلاسة
    const sideBar = `<div class="sub-tabs no-print" role="tablist">${TABS.map(([id, label]) => `<button class="chip" role="tab" data-act="hrtab" data-t="${id}" aria-pressed="${B.tab === id}">${esc(tr(label))}</button>`).join('')}</div>`;
    let body = '';
    if (B.tab === 'hub') body = hubTab(D);
    else if (B.tab === 'emp') body = empTab(D);
    else if (B.tab === 'att') body = attTab(D);
    else if (B.tab === 'abs') body = absTab(D);
    else if (B.tab === 'leave') body = leaveTab(D);
    else if (B.tab === 'sal') body = salTab(D);
    else if (B.tab === 'adv') body = advTab(D);
    else if (B.tab === 'contract') body = contractTab(D);
    else if (B.tab === 'analytics') body = analyticsTab(D);
    else if (B.tab === 'config') body = configTab(D);
    else body = hubTab(D);

    return sideBar + topNavStrip(D) + body + modalHtml(D);
  };

  /* ==================== الأحداث والنماذج ==================== */
  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      if (!e.status) throw e;
      toast(e.message);
    }
  };
  const reload = async () => {
    await load();
    UA.render();
  };

  Object.assign(UA.actions, {
    hrtab: async (el, d) => {
      B.tab = d.t;
      B.modal = null;
      if (!B.data) await load();
      UA.render();
      window.scrollTo(0, 0);
    },
    hrmclose: (el, d, e) => {
      if (e && e.target.closest('.modal') && el.classList.contains('modal-back')) return;
      B.modal = null;
      UA.render();
    },
    hrempfilter: () => {
      B.empSearch = ($id('hr-emp-q') && $id('hr-emp-q').value) || '';
      B.empDept = ($id('hr-emp-dept') && $id('hr-emp-dept').value) || '';
      B.empStatus = ($id('hr-emp-st') && $id('hr-emp-st').value) || '';
      UA.render();
    },
    hrempnew: () => {
      B.modal = { type: 'emp', item: null };
      UA.render();
    },
    hrempedit: (el, d) => {
      const item = B.data.employees.find((x) => x.id === Number(d.id));
      if (!item) return;
      B.modal = { type: 'emp', item };
      UA.render();
    },
    hrattopen: () => {
      B.modal = { type: 'att', item: B.data.attendance[0] || {} };
      UA.render();
    },
    hrattedit: (el, d) => {
      const item = B.data.attendance.find((x) => x.employeeId === Number(d.emp)) || { employeeId: Number(d.emp) };
      B.modal = { type: 'att', item };
      UA.render();
    },
    hrabsnew: () => {
      B.modal = { type: 'abs' };
      UA.render();
    },
    hrabsdel: (el, d) => run(async () => {
      await api('DELETE', `/api/hr-pro/absences/${d.id}`);
      await reload();
      toast('حُذف سجل الغياب');
    }),
    hrleaveapprove: (el, d) => run(async () => {
      await api('POST', `/api/hr-pro/leaves/${d.id}/approve`, {});
      await reload();
      toast('اعتُمدت الإجازة');
    }),
    hrleavecancel: (el, d) => run(async () => {
      await api('POST', `/api/hr-pro/leaves/${d.id}/cancel`, {});
      await reload();
      toast('أُلغي طلب الإجازة');
    }),
    hrleavereject: (el, d) => {
      B.modal = { type: 'leave_reject', item: { id: d.id } };
      UA.render();
    },
    hrleavenew: () => {
      B.modal = { type: 'leave' };
      UA.render();
    },
    hradvnew: () => {
      B.modal = { type: 'adv' };
      UA.render();
    },
    hradvpay: (el, d) => run(async () => {
      await api('POST', `/api/hr-pro/advances/${d.id}/pay`, {});
      await reload();
      toast('سُدّد قسط السلفة وحُدّث الرصيد المتبقي');
    }),
    hrctflt: (el, d) => {
      B.ctFilter = d.f;
      UA.render();
    },
    hrrefdate: () => run(async () => {
      const v = $id('hr-ref-date') && $id('hr-ref-date').value;
      if (v) B.refDate = v;
      await reload();
      toast('حُدّثت الأيام المتبقية وتنبيهات العقود');
    }),
    hrctnew: () => {
      B.modal = { type: 'contract', item: {} };
      UA.render();
    },
    hrrenewopen: (el, d) => {
      const ct = B.data.contracts.find((x) => x.id === Number(d.id));
      if (!ct) return;
      B.modal = { type: 'renew', item: ct };
      UA.render();
    },
    hrpayslip: (el, d) => {
      const p = B.data.payroll.find((x) => x.employeeId === Number(d.id));
      if (!p) return;
      B.modal = { type: 'payslip', item: p };
      UA.render();
    },
    hrlkdel: (el, d) => run(async () => {
      await api('DELETE', `/api/hr-pro/lookups/${d.id}`);
      await reload();
      toast('حُذف العنصر من برمجة السيستم');
    }),
    hranalyticsdept: (el, d) => run(async () => {
      B.analyticsDept = d.dept || 'all';
      await reload();
      toast(d.dept === 'all' ? 'عرض إحصائيات كافة الأقسام' : `تم حصر الإحصائيات بقسم: ${d.dept}`);
    }),
    hropenrecharts: (el, d) => {
      window.UA.openAnalytics(d.tab || 'departments');
    },
  });

  Object.assign(UA.forms, {
    'hr-emp-form': () => run(async () => {
      const it = B.modal && B.modal.item;
      const body = {
        employeeNo: $id('he-no').value.trim(),
        name: $id('he-name').value.trim(),
        department: $id('he-dept').value,
        position: $id('he-pos').value,
        phone: $id('he-phone').value.trim(),
        email: $id('he-email').value.trim(),
        hireDate: $id('he-hire').value,
        statusAr: $id('he-status').value,
        contractTypeAr: $id('he-ctype').value,
        baseSalary: Number($id('he-base').value) || 0,
        housingAllowance: Number($id('he-housing').value) || 0,
        transportAllowance: Number($id('he-transport').value) || 0,
        insuranceAmount: Number($id('he-ins').value) || 0,
        taxAmount: Number($id('he-tax').value) || 0,
      };
      if (it && it.id) {
        const u = await api('PUT', `/api/hr-pro/employees/${it.id}`, body);
        toast(u.accountClosed ? 'حُدّثت بيانات الموظف، وأُغلق حسابه وطُلب استرداد بطاقته' : 'حُدّثت بيانات الموظف');
      } else {
        const r = await api('POST', '/api/hr-pro/employees', body);
        // تظهر كلمة المرور المؤقتة مرة واحدة؛ يغيّرها الموظف عند أول دخول
        if (r.account && r.account.tempPassword) window.alert(`أُضيف الموظف وأُنشئ حسابه بصلاحيات دنيا.
اسم المستخدم: ${r.account.username}
كلمة المرور المؤقتة: ${r.account.tempPassword}
امنحه دوره من شاشة الحسابات والصلاحيات.`);
        toast(r.account && r.account.linked ? 'أُضيف الموظف ورُبط بحسابه القائم' : 'أُضيف الموظف الجديد');
      }
      B.modal = null;
      await reload();
    }),
    'hr-att-form': () => run(async () => {
      await api('POST', '/api/hr-pro/attendance', {
        employeeId: Number($id('ha-emp').value),
        workDaysMonth: Number($id('ha-work').value),
        actualDays: Number($id('ha-actual').value),
        lateDays: Number($id('ha-lated').value),
        lateHours: Number($id('ha-lateh').value),
      });
      B.modal = null;
      await reload();
      toast('حُدّث سجل الحضور ونسبة الالتزام');
    }),
    'hr-abs-form': () => run(async () => {
      await api('POST', '/api/hr-pro/absences', {
        employeeId: Number($id('hab-emp').value),
        reason: $id('hab-reason').value,
        absenceDays: Number($id('hab-days').value),
        month: $id('hab-month').value.trim(),
      });
      B.modal = null;
      await reload();
      toast('سُجّل الغياب واحتُسب الخصم في الرواتب');
    }),
    'hr-leave-reject-form': () => run(async () => {
      await api('POST', `/api/hr-pro/leaves/${B.modal.item.id}/reject`, { reason: $id('hlr-reason').value });
      B.modal = null;
      await reload();
      toast('رُفض طلب الإجازة');
    }),
    'hr-leave-form': () => run(async () => {
      await api('POST', '/api/hr-pro/leaves', {
        employeeId: Number($id('hlv-emp').value),
        leaveTypeAr: $id('hlv-type').value,
        days: Number($id('hlv-days').value),
        startDate: $id('hlv-start').value,
        endDate: $id('hlv-end').value,
        reason: $id('hlv-reason').value,
      });
      B.modal = null;
      await reload();
      toast('سُجّل طلب الإجازة، وينتظر الاعتماد');
    }),
    'hr-adv-form': () => run(async () => {
      await api('POST', '/api/hr-pro/advances', {
        employeeId: Number($id('had-emp').value),
        amount: Number($id('had-amount').value),
        installmentsCount: Number($id('had-count').value),
        advanceDate: $id('had-date').value,
        status: $id('had-status').value,
        notes: $id('had-notes').value,
      });
      B.modal = null;
      await reload();
      toast('اعتُمدت السلفة وجُدولت أقساطها الشهرية');
    }),
    'hr-contract-form': () => run(async () => {
      const m = B.modal;
      if (m.type === 'renew' && m.item) {
        await api('POST', `/api/hr-pro/contracts/${m.item.id}/renew`, {
          contractTypeAr: $id('hct-type').value,
          salary: Number($id('hct-sal').value),
          startDate: $id('hct-start').value,
          endDate: $id('hct-end').value,
        });
        toast('جُدّد عقد الموظف بنجاح');
      } else {
        await api('POST', '/api/hr-pro/contracts', {
          employeeId: Number($id('hct-emp').value),
          contractTypeAr: $id('hct-type').value,
          salary: Number($id('hct-sal').value),
          startDate: $id('hct-start').value,
          endDate: $id('hct-end').value,
        });
        toast('أُبرم العقد الجديد');
      }
      B.modal = null;
      await reload();
    }),
    'hr-alert-settings-form': () => run(async () => {
      await api('PUT', '/api/hr-pro/settings', {
        contract_expiry_warning_days: $id('hs-ct-warn').value,
        contract_expiry_critical_days: $id('hs-ct-crit').value,
        probation_expiry_alert_days: $id('hs-prob-days').value,
        attendance_excellent_pct: $id('hs-att-exc').value,
        attendance_good_pct: $id('hs-att-good').value,
        absence_review_threshold_days: $id('hs-abs-rev').value,
        standard_month_work_days: $id('hs-work-days').value,
        default_annual_leave_days: $id('hs-lv-quota').value,
        low_leave_balance_alert_days: $id('hs-lv-low').value,
        salary_day_divisor: $id('hs-day-div').value,
        default_housing_pct: $id('hs-housing-pct').value,
        default_insurance_pct: $id('hs-ins-pct').value,
        default_tax_pct: $id('hs-tax-pct').value,
        enable_contract_alerts: $id('hs-en-ct').checked ? '1' : '0',
        enable_attendance_alerts: $id('hs-en-att').checked ? '1' : '0',
        enable_advance_alerts: $id('hs-en-adv').checked ? '1' : '0',
        enable_leave_alerts: $id('hs-en-lv').checked ? '1' : '0',
      });
      await reload();
      toast('حُفظت إعدادات التنبيهات وأُعيد احتساب حالات العقود والالتزام');
    }),
    'hr-lookup-add-form': () => run(async () => {
      await api('POST', '/api/hr-pro/lookups', {
        category: $id('hlk-cat').value,
        label: $id('hlk-label').value.trim(),
      });
      $id('hlk-label').value = '';
      await reload();
      toast('أُضيف العنصر إلى برمجة السيستم');
    }),
  });
})();
