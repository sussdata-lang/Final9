/* وحدة المالية والمحاسبة (5.9) — نسخة مؤسسية معاد هيكلتها بالكامل (القيد المزدوج، الخزينة، القوائم الختامية، ومحاسبة الطلاب) */
(function () {
  const UA = window.UA;
  if (!UA) return;
  const { api, esc, fmt, toast, S } = UA;
  const money = (n) => Number(n || 0).toLocaleString('en-US') + ' ل.س';
  const num = (n) => Number(n || 0).toLocaleString('en-US');

  const F = (S.fin = {
    tab: 'overview',
    coaTypeFilter: '',
    coaQuery: '',
    jeStatusFilter: '',
    treasurySub: 'vouchers', // vouchers | invoices | parties
    reportSub: 'tb',         // tb | is | bs | gl | cb | cc | ps
    feeSub: 'invoices',      // invoices | structures | discounts | overdue
    ov: null,
    accounts: [],
    years: [],
    centers: [],
    entries: [],
    parties: [],
    invoices: [],
    vouchers: [],
    tb: null,
    gl: null,
    is: null,
    bs: null,
    cb: null,
    cc: null,
    ps: null,
    feesOv: null,
    feeStructures: [],
    stuInvoices: [],
    discounts: [],
    stuPayments: [],
    currencies: [],
    feeTypes: [],
    overdue: [],
    programs: []
  });

  const can = (p) => S.me?.permissions?.includes(p) || S.me?.role === 'admin';
  const TYPE_LBL = {
    asset: ['أصول', 'b-info'],
    liability: ['خصوم والتزامات', 'b-warn'],
    equity: ['حقوق ملكية', 'b-mut'],
    revenue: ['إيرادات', 'b-ok'],
    expense: ['مصروفات', 'b-err']
  };
  const JE_ST = {
    draft: ['مسودة', 'b-warn'],
    posted: ['مرحّل للأستاذ', 'b-ok'],
    reversed: ['معكوس', 'b-mut']
  };
  const INV_ST = {
    draft: ['مسودة', 'b-mut'],
    issued: ['صادرة', 'b-warn'],
    partial: ['مسددة جزئياً', 'b-info'],
    paid: ['مسددة بالكامل', 'b-ok'],
    cancelled: ['ملغاة', 'b-err']
  };
  const badge = (map, s) => {
    const [l, c] = map[s] || [s, 'b-mut'];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };

  const TABS = [
    ['overview', '📊 المركز المالي ولوحة القيادة'],
    ['coa', '🌳 شجرة الحسابات ومراكز التكلفة'],
    ['journal', '⚖️ قيود اليومية المزدوجة'],
    ['treasury', '🏦 الخزينة والسندات والذمم'],
    ['reports', '📈 القوائم والتقارير المالية الختامية'],
    ['student_fees', '🎓 محاسبة الرسوم والأقساط الطلابية'],
    ['payroll_fin', '💼 التكامل المالي للرواتب']
  ];

  async function loadTab() {
    const t = F.tab;
    if (t === 'overview') {
      const [ov, fy] = await Promise.all([api('GET', '/api/finance/overview'), api('GET', '/api/finance/fiscal-years')]);
      F.ov = ov; F.years = fy.fiscalYears;
    } else if (t === 'coa') {
      const [a, c, y, cur] = await Promise.all([
        api('GET', '/api/finance/accounts'),
        api('GET', '/api/finance/cost-centers'),
        api('GET', '/api/finance/fiscal-years'),
        api('GET', '/api/finance/currencies')
      ]);
      F.accounts = a.accounts; F.centers = c.costCenters; F.years = y.fiscalYears; F.currencies = cur.currencies;
    } else if (t === 'journal') {
      const [j, a, c] = await Promise.all([
        api('GET', '/api/finance/journal' + (F.jeStatusFilter ? `?status=${F.jeStatusFilter}` : '')),
        api('GET', '/api/finance/accounts'),
        api('GET', '/api/finance/cost-centers')
      ]);
      F.entries = j.entries; F.accounts = a.accounts; F.centers = c.costCenters;
    } else if (t === 'treasury') {
      const [v, inv, p, a] = await Promise.all([
        api('GET', '/api/finance/vouchers'),
        api('GET', '/api/finance/invoices'),
        api('GET', '/api/finance/parties'),
        api('GET', '/api/finance/accounts')
      ]);
      F.vouchers = v.vouchers; F.invoices = inv.invoices; F.parties = p.parties; F.accounts = a.accounts;
    } else if (t === 'reports') {
      const [tb, is, bs, cb, cc, a, p] = await Promise.all([
        api('GET', '/api/finance/reports/trial-balance'),
        api('GET', '/api/finance/reports/income-statement'),
        api('GET', '/api/finance/reports/balance-sheet'),
        api('GET', '/api/finance/reports/cash-book'),
        api('GET', '/api/finance/reports/cost-centers'),
        api('GET', '/api/finance/accounts'),
        api('GET', '/api/finance/parties')
      ]);
      F.tb = tb; F.is = is; F.bs = bs; F.cb = cb; F.cc = cc; F.accounts = a.accounts; F.parties = p.parties;
    } else if (t === 'student_fees') {
      const [ov, fs, inv, d, od] = await Promise.all([
        api('GET', '/api/finance/fees/overview'),
        api('GET', '/api/finance/fee-structures'),
        api('GET', `/api/finance/student-invoices?page=${F.stuPage || 1}${F.stuQ ? '&q=' + encodeURIComponent(F.stuQ) : ''}`),
        api('GET', '/api/finance/discounts'),
        api('GET', '/api/finance/fees/overdue')
      ]);
      F.feesOv = ov; F.feeStructures = fs.structures; F.stuInvoices = inv.invoices; F.stuTotal = inv.total; F.stuPages = inv.pages;
      F.discounts = d.discounts; F.overdue = od.installments; F.programs = fs.programs || [];
      if (can('finance:fees')) {
        const [pay, ft, acc] = await Promise.all([api('GET', '/api/finance/payments'), api('GET', '/api/finance/fee-types'), api('GET', '/api/finance/accounts')]);
        F.stuPayments = pay.payments; F.feeTypes = Array.isArray(ft) ? ft : []; F.accounts = acc.accounts;
      }
    }
  }

  function renderHeaderBanner() {
    const openYear = (F.years || []).find((y) => y.status === 'open');
    return `
      <div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#10211D 0%,#054239 100%);color:#fff;border:1px solid #10211D;padding:15px 18px">
        <div class="spread" style="flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:11px;color:#0A5A4D;font-weight:700;letter-spacing:.4px">الإدارة المالية والمحاسبية · DOUBLE-ENTRY GENERAL LEDGER & TREASURY</div>
            <div style="font-size:15px;font-weight:800;margin-top:2px">النظام المحاسبي الموحد والقوائم المالية الختامية للجامعة</div>
            <div style="font-size:12px;color:#DCE3DD;margin-top:3px">
              السنة المالية الفعالة: <b>${esc(openYear?.code || '2026')}</b> (${esc(openYear?.startDay || '2026-01-01')} ← ${esc(openYear?.endDay || '2026-12-31')}) · قاعدة القيد المزدوج المتوازن مفعّلة إجبارياً
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('finance:post') ? `<button class="btn pri sm" data-act="fin-new-je">+ قيد يومية مزدوج</button>` : ''}
            ${can('finance:entry') ? `
              <button class="btn sm" style="background:rgba(27,127,75,.2);color:#F6F8F5;border-color:rgba(27,127,75,.4)" data-act="fin-new-vch" data-kind="receipt">+ سند قبض</button>
              <button class="btn sm" style="background:rgba(244,63,94,.2);color:#F6F8F5;border-color:rgba(244,63,94,.4)" data-act="fin-new-vch" data-kind="payment">+ سند صرف</button>
            ` : ''}
            <a class="btn sm" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)" href="/api/finance/reports/trial-balance.xlsx" target="_blank">📥 ميزان المراجعة Excel</a>
          </div>
        </div>
      </div>`;
  }

  function viewOverview() {
    const o = F.ov || {};
    const rev = Number(o.totalRevenue || 0);
    const exp = Number(o.totalExpense || 0);
    const maxBar = Math.max(rev, exp, 1);
    const revPct = Math.round((rev / maxBar) * 100);
    const expPct = Math.round((exp / maxBar) * 100);
    return `
      ${renderHeaderBanner()}
      <div class="kpis" style="margin-bottom:14px">
        <div class="kpi"><div class="k-num" style="color:#0A5A4D">${money(o.cashBalance)}</div><div class="k-lbl">السيولة النقدية والمصرفية</div></div>
        <div class="kpi"><div class="k-num" style="color:#0d9488">${money(o.receivables)}</div><div class="k-lbl">ذمم مدينة قيد التحصيل</div></div>
        <div class="kpi"><div class="k-num" style="color:#8A6A1B">${money(o.payables)}</div><div class="k-lbl">ذمم دائنة للموردين</div></div>
        <div class="kpi"><div class="k-num" style="color:#1B7F4B">${money(o.totalRevenue)}</div><div class="k-lbl">إجمالي الإيرادات المحققة</div></div>
        <div class="kpi"><div class="k-num" style="color:#B3261E">${money(o.totalExpense)}</div><div class="k-lbl">إجمالي المصروفات التشغيلية</div></div>
        <div class="kpi" style="background:${(o.netIncome || 0) >= 0 ? '#F6F8F5' : '#F6F8F5'}"><div class="k-num" style="color:${(o.netIncome || 0) >= 0 ? '#0E4D2E' : '#B3261E'}">${money(o.netIncome)}</div><div class="k-lbl">صافي الفائض / (العجز) المالي</div></div>
        <div class="kpi"><div class="k-num">${num(o.postedEntries)}</div><div class="k-lbl">قيود يومية مرحّلة</div></div>
        <div class="kpi"><div class="k-num">${num(o.draftEntries)}</div><div class="k-lbl">قيود مسودة قيد المراجعة</div></div>
      </div>

      <div class="grid2" style="margin-bottom:14px">
        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">📈 مؤشر الأداء المالي (الإيرادات مقابل المصروفات)</h3>
            <button class="btn sm" data-act="fin-go-rep" data-r="is">قائمة الدخل التفصيلية</button>
          </div>
          <div style="margin-bottom:12px">
            <div class="spread" style="font-size:13px;margin-bottom:4px"><span>إجمالي الإيرادات</span><b style="color:#1B7F4B">${money(rev)}</b></div>
            <div style="height:12px;background:#DCE3DD;border-radius:99px;overflow:hidden"><div style="width:${revPct}%;height:100%;background:linear-gradient(90deg,#1B7F4B,#1B7F4B)"></div></div>
          </div>
          <div style="margin-bottom:12px">
            <div class="spread" style="font-size:13px;margin-bottom:4px"><span>إجمالي المصروفات</span><b style="color:#B3261E">${money(exp)}</b></div>
            <div style="height:12px;background:#DCE3DD;border-radius:99px;overflow:hidden"><div style="width:${expPct}%;height:100%;background:linear-gradient(90deg,#B3261E,#B3261E)"></div></div>
          </div>
          <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;justify-content:space-between;align-items:center">
            <span class="mut">صافي النتيجة المالية للفترة:</span>
            <strong style="font-size:16px;color:${(o.netIncome || 0) >= 0 ? '#0E4D2E' : '#B3261E'}">${money(o.netIncome)}</strong>
          </div>
        </div>

        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">⚡ وصول سريع للقوائم المالية الختامية</h3>
            <button class="btn sm" data-act="fin-tab" data-t="reports">مركز التقارير</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
            <button class="btn" style="text-align:start;justify-content:flex-start" data-act="fin-go-rep" data-r="tb">⚖️ ميزان المراجعة بالمجاميع والأرصدة</button>
            <button class="btn" style="text-align:start;justify-content:flex-start" data-act="fin-go-rep" data-r="is">📊 قائمة الدخل (الأرباح والخسائر)</button>
            <button class="btn" style="text-align:start;justify-content:flex-start" data-act="fin-go-rep" data-r="bs">🏛️ الميزانية العمومية (المركز المالي)</button>
            <button class="btn" style="text-align:start;justify-content:flex-start" data-act="fin-go-rep" data-r="cb">💵 حركة الصندوق والمصرف</button>
            <button class="btn" style="text-align:start;justify-content:flex-start" data-act="fin-go-rep" data-r="gl">📖 دفتر الأستاذ العام لحساب</button>
            <button class="btn" style="text-align:start;justify-content:flex-start" data-act="fin-go-rep" data-r="cc">🎯 تحليل مراكز التكلفة</button>
          </div>
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">📒 أحدث قيود اليومية المزدوجة</h3>
            <button class="btn sm" data-act="fin-tab" data-t="journal">كل القيود</button>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>القيمة المتوازنة</th><th>الحالة</th></tr></thead><tbody>
            ${(o.recentEntries || []).map((e) => `<tr>
              <td><code>${esc(e.no)}</code></td>
              <td>${esc(e.entry_day)}</td>
              <td>${esc(e.description)}</td>
              <td><b>${money(e.total_debit)}</b></td>
              <td>${badge(JE_ST, e.status)}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">لا توجد قيود يومية</td></tr>'}
          </tbody></table></div>
        </div>

        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">🧾 أحدث سندات الخزينة (قبض وصرف)</h3>
            <button class="btn sm" data-act="fin-tab" data-t="treasury">إدارة الخزينة</button>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم السند</th><th>النوع</th><th>التاريخ</th><th>الطرف</th><th>المبلغ</th></tr></thead><tbody>
            ${(o.recentVouchers || []).map((v) => `<tr>
              <td><code>${esc(v.no)}</code></td>
              <td><span class="badge ${v.kind === 'receipt' ? 'b-ok' : 'b-warn'}">${v.kind === 'receipt' ? 'سند قبض' : 'سند صرف'}</span></td>
              <td>${esc(v.voucher_day)}</td>
              <td>${esc(v.party_name || 'مباشر')}</td>
              <td><b>${money(v.amount)}</b></td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">لا توجد سندات خزينة</td></tr>'}
          </tbody></table></div>
        </div>
      </div>`;
  }

  const currenciesCard = () => `
        <div class="card" style="margin-top:14px">
          <h3 style="margin-top:0">💱 العملات وأسعار الصرف</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>السعر</th><th>الحالة</th><th></th></tr></thead><tbody>
            ${F.currencies.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td><b>${esc(x.name)}</b>${x.is_base ? ' <span class="mut">(أساسية)</span>' : ''}</td><td>${esc(x.rate)}</td><td>${x.active ? 'مفعلة' : 'معطلة'}</td><td>${can('finance:setup') && !x.is_base ? `<button class="btn sm" data-act="fin-cur-rate" data-code="${esc(x.code)}" data-rate="${esc(x.rate)}">تعديل السعر</button> <button class="btn sm" data-act="fin-toggle-cur" data-code="${esc(x.code)}" data-on="${x.active ? 0 : 1}">${x.active ? 'تعطيل' : 'تفعيل'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">لا توجد عملات</td></tr>'}
          </tbody></table></div>
        </div>`;

  function viewCoa() {
    const filtered = F.accounts.filter((a) => {
      if (F.coaTypeFilter && a.type !== F.coaTypeFilter) return false;
      if (F.coaQuery) {
        const q = F.coaQuery.toLowerCase();
        return String(a.code).toLowerCase().includes(q) || String(a.name).toLowerCase().includes(q);
      }
      return true;
    });
    return `
      <div class="card" style="margin-bottom:14px">
        <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">🌳 الدليل المحاسبي الشجري الموحد (${num(filtered.length)} حساب)</h3>
            <div class="mut" style="font-size:12px">اضغط على «دفتر الأستاذ» أمام أي حساب فرعي لاستعراض حركته التفصيلية</div>
          </div>
          ${can('finance:setup') ? `<button class="btn pri sm" data-act="fin-new-acc">+ إضافة حساب في الدليل</button>` : ''}
        </div>

        <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${[['', 'كل الحسابات'], ['asset', 'الأصول (1)'], ['liability', 'الخصوم (2)'], ['equity', 'حقوق الملكية (3)'], ['revenue', 'الإيرادات (4)'], ['expense', 'المصروفات (5)']].map(([k, lbl]) => `
              <button class="btn sm ${F.coaTypeFilter === k ? 'pri' : ''}" data-act="fin-coa-type" data-type="${k}">${esc(lbl)}</button>
            `).join('')}
          </div>
          <div style="display:flex;gap:6px">
            <input id="fcoa-q" value="${esc(F.coaQuery)}" placeholder="بحث برمز أو اسم الحساب..." style="width:220px">
            <button class="btn sm" data-act="fin-coa-search">بحث</button>
          </div>
        </div>

        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رمز الحساب</th><th>اسم الحساب</th><th>التصنيف</th><th>الطبيعة</th><th>المستوى</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
          ${filtered.map((a) => {
            const depth = Math.max(0, String(a.code).length - 1);
            const isHeader = String(a.code).length <= 2;
            return `<tr style="${isHeader ? 'background:#F6F8F5;font-weight:700' : ''}">
              <td><code>${esc(a.code)}</code></td>
              <td style="padding-inline-start:${depth * 14 + 10}px">${isHeader ? '📂 ' : '📄 '}<b>${esc(a.name)}</b></td>
              <td>${badge(TYPE_LBL, a.type)}</td>
              <td><span class="badge ${a.normal === 'debit' ? 'b-info' : 'b-warn'}">${a.normal === 'debit' ? 'مدين' : 'دائن'}</span></td>
              <td>${isHeader ? 'حساب رئيسي' : 'حساب فرعي'}</td>
              <td><span class="badge ${a.active ? 'b-ok' : 'b-mut'}">${a.active ? 'نشط' : 'معطّل'}</span></td>
              <td style="white-space:nowrap">
                <button class="btn sm" data-act="fin-open-gl" data-id="${a.id}">📖 دفتر الأستاذ</button>
                ${can('finance:setup') ? `<button class="btn sm" data-act="fin-edit-acc" data-id="${a.id}">تعديل</button>` : ''}
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="7" class="empty">لا توجد حسابات مطابقة</td></tr>'}
        </tbody></table></div>
      </div>

      <div class="grid2">
        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">🎯 مراكز التكلفة (${num(F.centers.length)})</h3>
            ${can('finance:setup') ? `<button class="btn pri sm" data-act="fin-new-cc">+ مركز تكلفة</button>` : ''}
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>اسم مركز التكلفة</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
            ${F.centers.map((c) => `<tr>
              <td><code>${esc(c.code)}</code></td>
              <td><b>${esc(c.name)}</b></td>
              <td><span class="badge ${c.active ? 'b-ok' : 'b-mut'}">${c.active ? 'نشط' : 'معطّل'}</span></td>
              <td>${can('finance:setup') ? `<button class="btn dan sm" data-act="fin-del-cc" data-id="${c.id}">حذف</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">لا توجد مراكز تكلفة</td></tr>'}
          </tbody></table></div>
        </div>

        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">📅 السنوات والفترات المالية (${num(F.years.length)})</h3>
            ${can('finance:setup') ? `<button class="btn pri sm" data-act="fin-new-fy">+ سنة مالية جديدة</button>` : ''}
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>السنة</th><th>من تاريخ</th><th>إلى تاريخ</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
            ${F.years.map((y) => `<tr>
              <td><b>${esc(y.code)}</b></td>
              <td>${esc(y.startDay)}</td>
              <td>${esc(y.endDay)}</td>
              <td><span class="badge ${y.status === 'open' ? 'b-ok' : 'b-mut'}">${y.status === 'open' ? 'مفتوحة' : 'مقفلة'}</span></td>
              <td>${can('finance:setup') && y.status === 'open' ? `<button class="btn dan sm" data-act="fin-close-fy" data-id="${y.id}">إقفال السنة</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">لا توجد سنوات مالية</td></tr>'}
          </tbody></table></div>
        </div>
      </div>`;
  }

  function viewJournal() {
    return `
      <div class="card">
        <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">⚖️ دفتر قيود اليومية المزدوجة (${num(F.entries.length)} قيد)</h3>
            <div class="mut" style="font-size:12px">لا يُقبل حفظ أو ترحيل أي قيد يومية إلا بتوازن الطرف المدين مع الطرف الدائن تماماً</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${[['', 'الكل'], ['posted', 'مرحّل للأستاذ'], ['draft', 'مسودة'], ['reversed', 'معكوس']].map(([k, lbl]) => `
              <button class="btn sm ${F.jeStatusFilter === k ? 'pri' : ''}" data-act="fin-je-filter" data-st="${k}">${esc(lbl)}</button>
            `).join('')}
            ${can('finance:post') ? `<button class="btn pri sm" data-act="fin-new-je">+ إنشاء قيد يومية مزدوج</button>` : ''}
          </div>
        </div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم القيد</th><th>التاريخ</th><th>المرجع</th><th>البيان والتفاصيل</th><th>إجمالي المدين</th><th>إجمالي الدائن</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
          ${F.entries.map((e) => `<tr>
            <td><code>${esc(e.no)}</code></td>
            <td>${esc(e.day || e.entryDay || "")}</td>
            <td><code>${esc(e.reference || '—')}</code></td>
            <td>
              <b>${esc(e.description)}</b>
              <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">
                ${(e.lines || []).map((l) => `<span style="font-size:11px;background:#F6F8F5;padding:2px 6px;border-radius:4px"><code>${esc(l.code || l.accountCode || "")}</code> ${esc(l.account || l.accountName || "")}: ${l.debit > 0 ? `<b style="color:#0A5A4D">مدين ${money(l.debit)}</b>` : `<b style="color:#0d9488">دائن ${money(l.credit)}</b>`}</span>`).join('')}
              </div>
            </td>
            <td><b>${money(e.totalDebit ?? e.total)}</b></td>
            <td><b>${money(e.totalCredit ?? e.total)}</b></td>
            <td>${badge(JE_ST, e.status)}</td>
            <td style="white-space:nowrap">
              <button class="btn sm" data-act="fin-view-je" data-id="${e.id}">عرض / طباعة</button>
              ${e.status === 'draft' && can('finance:post') ? `
                <button class="btn pri sm" data-act="fin-post-je" data-id="${e.id}">ترحيل</button>
                <button class="btn dan sm" data-act="fin-del-je" data-id="${e.id}">حذف</button>
              ` : ''}
              ${e.status === 'posted' && !e.reversedBy && can('finance:post') ? `<button class="btn dan sm" data-act="fin-rev-je" data-id="${e.id}">قيد عكسي</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="8" class="empty">لا توجد قيود يومية</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  function viewTreasury() {
    const s = F.treasurySub || 'vouchers';
    return `
      <div class="card" style="margin-bottom:14px;padding:12px 16px">
        <div class="spread" style="flex-wrap:wrap;gap:10px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn ${s === 'vouchers' ? 'pri' : ''}" data-act="fin-tr-sub" data-sub="vouchers">🧾 سندات القبض والصرف (${num(F.vouchers.length)})</button>
            <button class="btn ${s === 'invoices' ? 'pri' : ''}" data-act="fin-tr-sub" data-sub="invoices">📄 فواتير المبيعات والمشتريات (${num(F.invoices.length)})</button>
            <button class="btn ${s === 'parties' ? 'pri' : ''}" data-act="fin-tr-sub" data-sub="parties">👥 الأطراف والذمم المالية (${num(F.parties.length)})</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('finance:entry') ? `
              <button class="btn pri sm" data-act="fin-new-vch" data-kind="receipt">+ سند قبض</button>
              <button class="btn sm" data-act="fin-new-vch" data-kind="payment">+ سند صرف</button>
              <button class="btn sm" data-act="fin-new-inv">+ فاتورة ذمم</button>
            ` : ''}
            ${can('finance:setup') ? `<button class="btn sm" data-act="fin-new-party">+ تعريف طرف مالي</button>` : ''}
          </div>
        </div>
      </div>

      ${s === 'vouchers' ? `
        <div class="card">
          <h3 style="margin-top:0">🧾 سجل سندات القبض والصرف (الخزينة والمصرف)</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم السند</th><th>النوع</th><th>التاريخ</th><th>الطرف المالي</th><th>طريقة الدفع</th><th>المبلغ</th><th>البيان</th><th>القيد المحاسبي</th><th>طباعة</th></tr></thead><tbody>
            ${F.vouchers.map((v) => `<tr>
              <td><code>${esc(v.no)}</code></td>
              <td><span class="badge ${v.kind === 'receipt' ? 'b-ok' : 'b-warn'}">${v.kind === 'receipt' ? 'سند قبض' : 'سند صرف'}</span></td>
              <td>${esc(v.voucherDay)}</td>
              <td><b>${esc(v.partyName || 'مباشر')}</b></td>
              <td>${v.method === 'bank' ? 'تحويل مصرفي' : v.method === 'cheque' ? 'شيك' : 'نقدي (صندوق)'}</td>
              <td><b>${money(v.amount)}</b></td>
              <td>${esc(v.description)}</td>
              <td><code>JE#${v.journalId || '—'}</code></td>
              <td>${UA.rowPrintBtn(v.kind === 'receipt' ? 'سند قبض' : 'سند صرف', 'المالية والمحاسبة', 'أمين الصندوق|المحاسب|المستلم / الدافع')}</td>
            </tr>`).join('') || '<tr><td colspan="9" class="empty">لا توجد سندات خزينة</td></tr>'}
          </tbody></table></div>
        </div>
      ` : s === 'invoices' ? `
        <div class="card">
          <h3 style="margin-top:0">📄 فواتير المبيعات (الذمم المدينة) والمشتريات (الذمم الدائنة)</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم الفاتورة</th><th>النوع</th><th>الطرف</th><th>التاريخ</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
            ${F.invoices.map((i) => `<tr>
              <td><code>${esc(i.no)}</code></td>
              <td><span class="badge ${i.kind === 'sale' ? 'b-info' : 'b-warn'}">${i.kind === 'sale' ? 'مبيعات / إيراد' : 'مشتريات / مورد'}</span></td>
              <td><b>${esc(i.partyName)}</b></td>
              <td>${esc(i.issueDay)}</td>
              <td><b>${money(i.total)}</b></td>
              <td>${money(i.paidAmount)}</td>
              <td style="color:${i.total - i.paidAmount > 0 ? '#B3261E' : '#1B7F4B'}"><b>${money(i.total - i.paidAmount)}</b></td>
              <td>${badge(INV_ST, i.status)}</td>
              <td>
                ${UA.rowPrintBtn(i.kind === 'sale' ? 'فاتورة مبيعات' : 'فاتورة مشتريات', 'المالية والمحاسبة', 'المحاسب|المدير المالي|الطرف المستلم')}
                ${i.status === 'draft' && can('finance:entry') ? `<button class="btn pri sm" data-act="fin-iss-inv" data-id="${i.id}">إصدار وترحيل</button>` : ''}
                ${['issued', 'partial'].includes(i.status) && can('finance:entry') ? `<button class="btn pri sm" data-act="fin-pay-inv" data-id="${i.id}">تسجيل دفعة</button>` : ''}
                ${['draft', 'issued'].includes(i.status) && i.paidAmount === 0 && can('finance:entry') ? `<button class="btn dan sm" data-act="fin-can-inv" data-id="${i.id}">إلغاء</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="9" class="empty">لا توجد فواتير</td></tr>'}
          </tbody></table></div>
        </div>
      ` : `
        <div class="card">
          <h3 style="margin-top:0">👥 سجل الأطراف المالية (العملاء والموردون والجهات)</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>التصنيف</th><th>الهاتف</th><th>البريد الإلكتروني</th><th>الرقم الضريبي</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
            ${F.parties.map((p) => `<tr>
              <td><code>${esc(p.code)}</code></td>
              <td><b>${esc(p.name)}</b></td>
              <td><span class="badge ${p.kind === 'customer' ? 'b-info' : 'b-warn'}">${p.kind === 'customer' ? 'عميل / ذمة مدينة' : 'مورد / ذمة دائنة'}</span></td>
              <td>${esc(p.phone || '—')}</td>
              <td>${esc(p.email || '—')}</td>
              <td><code>${esc(p.taxNo || '—')}</code></td>
              <td><span class="badge ${p.active ? 'b-ok' : 'b-mut'}">${p.active ? 'نشط' : 'موقوف'}</span></td>
              <td><button class="btn sm" data-act="fin-open-ps" data-id="${p.id}">📄 كشف حساب</button></td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty">لا توجد أطراف مالية</td></tr>'}
          </tbody></table></div>
        </div>
      `}`;
  }

  function viewReports() {
    const r = F.reportSub || 'tb';
    const tb = F.tb || { rows: [], totalDebit: 0, totalCredit: 0, balanced: true };
    const is = F.is || { revenues: [], expenses: [], totalRevenue: 0, totalExpense: 0, netIncome: 0 };
    const bs = F.bs || { assets: { rows: [], total: 0 }, liabilities: { rows: [], total: 0 }, equity: { rows: [], surplus: 0, total: 0 }, balanced: true, difference: 0 };
    const cb = F.cb || { accounts: [], grandTotal: 0 };
    const cc = F.cc || { rows: [] };
    return `
      <div class="card" style="margin-bottom:14px;padding:12px 16px">
        <div class="spread" style="flex-wrap:wrap;gap:8px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${[
              ['tb', '⚖️ ميزان المراجعة'],
              ['is', '📊 قائمة الدخل'],
              ['bs', '🏛️ الميزانية العمومية'],
              ['gl', '📖 دفتر الأستاذ العام'],
              ['cb', '💵 دفتر الصندوق والمصرف'],
              ['cc', '🎯 مراكز التكلفة'],
              ['ps', '📄 كشف حساب طرف']
            ].map(([k, lbl]) => `<button class="btn sm ${r === k ? 'pri' : ''}" data-act="fin-rep-sub" data-r="${k}">${esc(lbl)}</button>`).join('')}
          </div>
          <div style="display:flex;gap:6px">
            <a class="btn sm" href="/api/finance/reports/trial-balance.xlsx" target="_blank">📥 تصدير Excel</a>
            <button class="btn sm no-print" data-act="print" data-print-next>🖨️ طباعة التقرير</button><span hidden data-doc-dept="المالية والمحاسبة" data-doc-signers="المحاسب|المدقق المالي|المدير المالي"></span>
          </div>
        </div>
      </div>

      ${r === 'tb' ? `
        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">⚖️ ميزان المراجعة بالمجاميع والأرصدة (Trial Balance)</h3>
            <span class="badge ${tb.balanced ? 'b-ok' : 'b-err'}">${tb.balanced ? '✓ الميزان متوازن تماماً' : '⚠️ غير متوازن'}</span>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رمز الحساب</th><th>اسم الحساب</th><th>النوع</th><th>مجموع المدين</th><th>مجموع الدائن</th><th>صافي الرصيد</th></tr></thead><tbody>
            ${tb.rows.map((x) => `<tr>
              <td><code>${esc(x.code)}</code></td>
              <td><b>${esc(x.name)}</b></td>
              <td>${badge(TYPE_LBL, x.type)}</td>
              <td>${money(x.debit)}</td>
              <td>${money(x.credit)}</td>
              <td><b>${money(x.balance ?? ((x.closeDebit || 0) - (x.closeCredit || 0)))}</b></td>
            </tr>`).join('')}
          </tbody><tfoot><tr><th colspan="3">الإجمالي العام للميزان</th><th>${money(tb.totalDebit ?? (tb.totals || {}).debit)}</th><th>${money(tb.totalCredit ?? (tb.totals || {}).credit)}</th><th>${tb.balanced ? 'متوازن ✔' : 'غير متوازن'}</th></tr></tfoot></table></div>
        </div>
      ` : r === 'is' ? `
        <div class="card">
          <h3 style="margin-top:0">📊 قائمة الدخل (الأرباح والخسائر - Income Statement)</h3>
          <div class="grid2">
            <div>
              <h4 style="color:#1B7F4B">الإيرادات التشغيلية والأكاديمية</h4>
              <table class="tbl"><thead><tr><th>الرمز</th><th>الحساب</th><th>المبلغ</th></tr></thead><tbody>
                ${is.revenues.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td>${esc(x.name)}</td><td><b>${money(x.amount)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="empty">لا توجد إيرادات</td></tr>'}
              </tbody><tfoot><tr><th colspan="2">إجمالي الإيرادات</th><th>${money(is.totalRevenue)}</th></tr></tfoot></table>
            </div>
            <div>
              <h4 style="color:#B3261E">المصروفات والأعباء التشغيلية</h4>
              <table class="tbl"><thead><tr><th>الرمز</th><th>الحساب</th><th>المبلغ</th></tr></thead><tbody>
                ${is.expenses.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td>${esc(x.name)}</td><td><b>${money(x.amount)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="empty">لا توجد مصروفات</td></tr>'}
              </tbody><tfoot><tr><th colspan="2">إجمالي المصروفات</th><th>${money(is.totalExpense)}</th></tr></tfoot></table>
            </div>
          </div>
          <div style="margin-top:14px;padding:12px 16px;background:#F6F8F5;border:1px solid var(--bd);border-radius:8px" class="spread">
            <strong>صافي الفائض / (العجز) عن الفترة المالية:</strong>
            <strong style="font-size:18px;color:${is.netIncome >= 0 ? '#0E4D2E' : '#B3261E'}">${money(is.netIncome)}</strong>
          </div>
        </div>
      ` : r === 'bs' ? `
        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">🏛️ الميزانية العمومية (قائمة المركز المالي - Balance Sheet)</h3>
            <span class="badge ${bs.balanced ? 'b-ok' : 'b-warn'}">${bs.balanced ? 'معادلة الميزانية: الأصول = الخصوم + حقوق الملكية' : `الميزانية غير متوازنة، الفارق: ${money(bs.difference)}`}</span>
          </div>
          <div class="grid2">
            <div>
              <h4 style="color:#0A5A4D">الأصول (الموجودات)</h4>
              <table class="tbl"><thead><tr><th>الرمز</th><th>الحساب</th><th>الرصيد</th></tr></thead><tbody>
                ${bs.assets.rows.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td>${esc(x.name)}</td><td><b>${money(x.amount)}</b></td></tr>`).join('')}
              </tbody><tfoot><tr><th colspan="2">إجمالي الأصول</th><th>${money(bs.assets.total)}</th></tr></tfoot></table>
            </div>
            <div>
              <h4 style="color:#8A6A1B">الخصوم وحقوق الملكية (المطاليب)</h4>
              <table class="tbl"><thead><tr><th>الرمز</th><th>الحساب</th><th>الرصيد</th></tr></thead><tbody>
                ${bs.liabilities.rows.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td>${esc(x.name)} (خصوم)</td><td><b>${money(x.amount)}</b></td></tr>`).join('')}
                ${bs.equity.rows.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td>${esc(x.name)} (ملكية)</td><td><b>${money(x.amount)}</b></td></tr>`).join('')}
                <tr><td><code>—</code></td><td>الأرباح المحتجزة / فائض الفترة</td><td><b>${money(bs.equity.surplus)}</b></td></tr>
              </tbody><tfoot><tr><th colspan="2">إجمالي الخصوم وحقوق الملكية</th><th>${money(bs.liabilities.total + bs.equity.total)}</th></tr></tfoot></table>
            </div>
          </div>
        </div>
      ` : r === 'gl' ? `
        <div class="card">
          <h3 style="margin-top:0">📖 دفتر الأستاذ العام لحساب (General Ledger)</h3>
          <div class="row" style="gap:8px;margin-bottom:12px">
            <select id="fgl-acc" style="min-width:280px">${F.accounts.map((a) => `<option value="${a.id}" ${F.gl?.account?.id === a.id ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select>
            <button class="btn pri sm" data-act="fin-load-gl">عرض حركة الأستاذ</button>
          </div>
          ${F.gl ? `
            <p><b>الحساب:</b> <code>${esc(F.gl.account.code)}</code> ${esc(F.gl.account.name)} · <b>الرصيد الختامي:</b> ${money(F.gl.closing ?? F.gl.closingBalance)}</p>
            <div class="tbl-wrap"><table class="tbl"><thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد التراكمي</th></tr></thead><tbody>
              ${(F.gl.lines || F.gl.rows || []).map((x) => `<tr><td>${esc(x.day || x.entry_day || '')}</td><td><code>${esc(x.no)}</code></td><td>${esc(x.memo || x.description)}</td><td>${money(x.debit)}</td><td>${money(x.credit)}</td><td><b>${money(x.balance)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد حركات</td></tr>'}
            </tbody></table></div>
          ` : '<div class="empty">اختر حساباً لعرض حركته التفصيلية</div>'}
        </div>
      ` : r === 'cb' ? `
        <div class="card">
          <h3 style="margin-top:0">💵 دفتر الصندوق والمصرف — إجمالي السيولة المتاحة: ${money(cb.grandTotal)}</h3>
          ${cb.accounts.map((c) => `
            <div style="margin-bottom:14px">
              <h4><code>${esc(c.account.code)}</code> ${esc(c.account.name)} — الرصيد: <span style="color:#0A5A4D">${money(c.closingBalance)}</span></h4>
              <div class="tbl-wrap"><table class="tbl"><thead><tr><th>التاريخ</th><th>القيد</th><th>البيان</th><th>مقبوضات (مدين)</th><th>مدفوعات (دائن)</th><th>الرصيد</th></tr></thead><tbody>
                ${c.rows.map((x) => `<tr><td>${esc(x.entry_day)}</td><td><code>${esc(x.no)}</code></td><td>${esc(x.memo || x.description)}</td><td>${money(x.debit)}</td><td>${money(x.credit)}</td><td><b>${money(x.balance)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد حركات</td></tr>'}
              </tbody></table></div>
            </div>
          `).join('')}
        </div>
      ` : r === 'cc' ? `
        <div class="card">
          <h3 style="margin-top:0">🎯 تقرير تحليل مراكز التكلفة</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>مركز التكلفة</th><th>إجمالي المدين (التكاليف)</th><th>إجمالي الدائن (الإيرادات)</th><th>الصافي</th></tr></thead><tbody>
            ${cc.rows.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td><b>${esc(x.name)}</b></td><td>${money(x.debit)}</td><td>${money(x.credit)}</td><td><b>${money(x.net)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="empty">لا توجد بيانات</td></tr>'}
          </tbody></table></div>
        </div>
      ` : `
        <div class="card">
          <h3 style="margin-top:0">📄 كشف حساب طرف وحركة الذمم (Party Statement)</h3>
          <div class="row" style="gap:8px;margin-bottom:12px">
            <select id="fps-party" style="min-width:260px"><option value="">— اختر الطرف المالي —</option>${F.parties.map((p) => `<option value="${p.id}" ${F.ps?.party?.id === p.id ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('')}</select>
            <button class="btn pri sm" data-act="fin-load-ps">عرض كشف الحساب</button>
          </div>
          ${F.ps ? `
            <p><b>الطرف:</b> ${esc(F.ps.party.name)} · <b>إجمالي الفواتير:</b> ${money(F.ps.totalInvoiced)} · <b>إجمالي الدفعات:</b> ${money(F.ps.totalVoucher)} · <b>الرصيد المستحق:</b> <span style="color:#B3261E">${money(F.ps.outstanding)}</span></p>
          ` : '<div class="empty">اختر طرفاً مالياً لعرض كشف حسابه</div>'}
        </div>
      `}`;
  }

  function viewStudentFees() {
    const o = F.feesOv || {};
    const sub = F.feeSub || 'invoices';
    const INV_STATUS = { unpaid: ['غير مسددة', 'b-warn'], partial: ['مسددة جزئياً', 'b-info'], paid: ['مسددة بالكامل', 'b-ok'], cancelled: ['ملغاة', 'b-err'] };
    return `
      <div class="kpis" style="margin-bottom:14px">
        <div class="kpi"><div class="k-num">${num(o.invoicesCount)}</div><div class="k-lbl">فواتير الرسوم الطلابية</div></div>
        <div class="kpi"><div class="k-num" style="color:#0A5A4D">${money(o.totalBilled)}</div><div class="k-lbl">صافي الرسوم المفوترة</div></div>
        <div class="kpi"><div class="k-num" style="color:#1B7F4B">${money(o.totalCollected)}</div><div class="k-lbl">إجمالي المحصّل الفعلي</div></div>
        <div class="kpi"><div class="k-num" style="color:#B3261E">${money(o.totalRemaining)}</div><div class="k-lbl">الذمم الطلابية المتبقية</div></div>
        <div class="kpi"><div class="k-num">${o.collectionRate || 0}%</div><div class="k-lbl">نسبة التحصيل الأكاديمي</div></div>
        <div class="kpi"><div class="k-num" style="color:#8A6A1B">${num(o.overdueCount)}</div><div class="k-lbl">أقساط متأخرة السداد</div></div>
      </div>

      <div class="card" style="margin-bottom:14px;padding:12px 16px">
        <div class="spread" style="flex-wrap:wrap;gap:8px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn sm ${sub === 'invoices' ? 'pri' : ''}" data-act="fin-fee-sub" data-sub="invoices">🧾 فواتير وأقساط الطلاب (${num(F.stuTotal || 0)})</button>
            <button class="btn sm ${sub === 'structures' ? 'pri' : ''}" data-act="fin-fee-sub" data-sub="structures">📐 هياكل الرسوم الدراسية (${num(F.feeStructures.length)})</button>
            <button class="btn sm ${sub === 'discounts' ? 'pri' : ''}" data-act="fin-fee-sub" data-sub="discounts">🎖️ المنح والحسومات (${num(F.discounts.length)})</button>
            <button class="btn sm ${sub === 'overdue' ? 'pri' : ''}" data-act="fin-fee-sub" data-sub="overdue">⚠️ الأقساط المتأخرة (${num(F.overdue.length)})</button>
            ${can('finance:fees') ? `<button class="btn sm ${sub === 'payments' ? 'pri' : ''}" data-act="fin-fee-sub" data-sub="payments">💵 الدفعات المحصلة (${num(F.stuPayments.length)})</button>
            <button class="btn sm ${sub === 'feetypes' ? 'pri' : ''}" data-act="fin-fee-sub" data-sub="feetypes">🏷️ أنواع الرسوم (${num(F.feeTypes.length)})</button>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('finance:fees') ? `<button class="btn pri sm" data-act="fin-new-stu-inv">+ إصدار فاتورة رسوم لطالب</button>` : ''}
            ${can('finance:setup') ? `<button class="btn sm" data-act="fin-new-fs">+ هيكل رسوم</button>` : ''}
            ${can('finance:fees') ? `<button class="btn sm" data-act="fin-new-disc">+ منح حسم/منحة</button>
              <button class="btn sm" data-act="fin-new-ft">+ نوع رسم</button>` : ''}
          </div>
        </div>
      </div>

      ${sub === 'invoices' ? `
        <div class="card">
          <div class="spread" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <h3 style="margin:0">🧾 فواتير الرسوم الدراسية وخطط التقسيط</h3>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <input id="fsi-q" placeholder="الرقم الجامعي أو الاسم" value="${esc(F.stuQ || '')}" style="width:190px">
              <button class="btn sm" data-act="fin-stu-search">بحث</button>
              <button class="btn sm" data-act="fin-stu-page" data-p="${(F.stuPage || 1) - 1}" ${(F.stuPage || 1) <= 1 ? 'disabled' : ''}>السابق</button>
              <span class="mut" style="font-size:12px">صفحة ${num(F.stuPage || 1)} من ${num(F.stuPages || 1)}</span>
              <button class="btn sm" data-act="fin-stu-page" data-p="${(F.stuPage || 1) + 1}" ${(F.stuPage || 1) >= (F.stuPages || 1) ? 'disabled' : ''}>التالي</button>
            </div>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم الفاتورة</th><th>الطالب</th><th>العام والفصل</th><th>الإجمالي</th><th>الحسم</th><th>الصافي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
            ${F.stuInvoices.map((i) => `<tr>
              <td><code>${esc(i.no)}</code></td>
              <td><b>${esc(i.studentName)}</b> <span class="mut">(${esc(i.studentNo || '')})</span></td>
              <td>${esc(i.academicYear)}<div class="mut" style="font-size:11px">${esc(i.feeType || '')}${i.note ? ' · ' + esc(i.note) : ''} · ${esc(i.dueDay)}</div></td>
              <td>${money(i.totalAmount)}</td>
              <td>${money(i.discountAmount)}</td>
              <td><b>${money(i.netAmount)}</b></td>
              <td style="color:#1B7F4B">${money(i.paidAmount)}</td>
              <td style="color:${i.netAmount - i.paidAmount > 0 ? '#B3261E' : '#1B7F4B'}"><b>${money(i.netAmount - i.paidAmount)}</b></td>
              <td>${badge(INV_STATUS, i.status)}</td>
              <td>
                <button class="btn sm" data-act="fin-view-stu-inv" data-id="${i.id}">الأقساط</button>
                ${i.status !== 'paid' && i.status !== 'cancelled' && can('finance:fees') ? `<button class="btn pri sm" data-act="fin-pay-stu-inv" data-id="${i.id}">💵 تحصيل دفعة</button>` : ''}
                ${can('finance:fees') ? `<button class="btn sm" data-act="fin-stu-statement" data-id="${i.studentId}">كشف الحساب</button>` : ''}
                ${i.status !== 'cancelled' && i.paidAmount === 0 && can('finance:fees') ? `<button class="btn dan sm" data-act="fin-void-charge" data-id="${i.id}">إلغاء</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="10" class="empty">لا توجد فواتير رسوم طلابية</td></tr>'}
          </tbody></table></div>
        </div>
      ` : sub === 'structures' ? `
        <div class="card">
          <h3 style="margin-top:0">📐 هياكل الرسوم المعتمدة للبرامج الأكاديمية</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>البرنامج الأكاديمي</th><th>العام الدراسي</th><th>الفصل</th><th>رسوم التعليم</th><th>رسوم التسجيل</th><th>الإجمالي الفصلي</th></tr></thead><tbody>
            ${F.feeStructures.map((s) => `<tr><td><b>${esc(s.programName)}</b></td><td>${esc(s.academicYear)}</td><td>الفصل ${s.semester}</td><td>${money(s.tuitionFee)}</td><td>${money(s.registrationFee)}</td><td><b>${money(s.totalFee)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد هياكل رسوم</td></tr>'}
          </tbody></table></div>
        </div>
      ` : sub === 'payments' ? `
        <div class="card">
          <h3 style="margin-top:0">💵 الدفعات المحصلة من الطلاب</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الإيصال</th><th>الطالب</th><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>الحالة</th><th></th></tr></thead><tbody>
            ${F.stuPayments.map((p) => `<tr><td><code>${esc(p.receiptNo)}</code></td><td><b>${esc(p.student || '')}</b></td><td>${esc(p.paidDay)}</td><td>${money(p.amount)}</td><td>${p.method === 'bank' ? 'تحويل مصرفي' : 'نقدي'}</td><td>${p.status === 'void' ? 'ملغاة' : 'سارية'}</td><td>${p.status === 'ok' ? `<button class="btn dan sm" data-act="fin-void-pay" data-id="${p.id}">إلغاء</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا توجد دفعات</td></tr>'}
          </tbody></table></div>
        </div>
      ` : sub === 'feetypes' ? `
        <div class="card">
          <h3 style="margin-top:0">🏷️ أنواع الرسوم والخصومات</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الحالة</th><th></th></tr></thead><tbody>
            ${F.feeTypes.map((t) => `<tr><td><code>${esc(t.code)}</code></td><td><b>${esc(t.name)}</b></td><td>${t.kind === 'discount' ? 'خصم' : 'رسم'}</td><td>${t.active ? 'مفعل' : 'معطل'}</td><td><button class="btn sm" data-act="fin-toggle-ft" data-id="${t.id}" data-on="${t.active ? 0 : 1}">${t.active ? 'تعطيل' : 'تفعيل'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">لا توجد أنواع رسوم</td></tr>'}
          </tbody></table></div>
        </div>
      ` : sub === 'discounts' ? `
        <div class="card">
          <h3 style="margin-top:0">🎖️ سجل المنح والإعفاءات والحسومات الطلابية</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الطالب</th><th>العام الدراسي</th><th>النوع</th><th>النسبة / المبلغ</th><th>السبب والقرار</th><th></th></tr></thead><tbody>
            ${F.discounts.map((d) => `<tr><td><b>${esc(d.studentName)}</b> (${esc(d.studentNo || '')})</td><td>${esc(d.academicYear)}</td><td>${esc(d.kindLabel)}</td><td><b>${d.percent}% · ${money(d.amount)}</b></td><td>${esc(d.reason)}</td><td>${can('finance:fees') ? `<button class="btn dan sm" data-act="fin-void-charge" data-id="${d.chargeId}">إلغاء</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد منح أو حسومات</td></tr>'}
          </tbody></table></div>
        </div>
      ` : `
        <div class="card">
          <h3 style="margin-top:0">⚠️ الأقساط الطلابية المستحقة المتأخرة</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الفاتورة</th><th>الطالب</th><th>القسط</th><th>تاريخ الاستحقاق</th><th>قيمة القسط</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>
            ${F.overdue.map((x) => `<tr><td><code>${esc(x.invoiceNo)}</code></td><td><b>${esc(x.studentName)}</b> (${esc(x.studentNo || '')})</td><td>#${x.seq}</td><td>${esc(x.dueDay)}</td><td>${money(x.amount)}</td><td>${money(x.paidAmount)}</td><td><b style="color:#B3261E">${money(x.amount - x.paidAmount)}</b></td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا توجد أقساط متأخرة</td></tr>'}
          </tbody></table></div>
        </div>
      `}`;
  }

  async function loadPayrollMonths() {
    const { months } = await api('GET', '/api/finance/payroll-months');
    const box = document.getElementById('fin-payroll-box');
    if (!box) return;
    box.className = '';
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الشهر</th><th>الموظفون</th><th>بلا راتب مسجل</th><th>الإجمالي</th><th>القيد</th><th></th></tr></thead><tbody>
      ${months.map((m) => `<tr>
        <td><code>${esc(m.month)}</code></td><td>${num(m.employees)}</td><td>${num(m.missingSalary)}</td><td><b>${money(m.total)}</b></td>
        <td>${m.entry ? `<code>${esc(m.entry.no)}</code>${m.entry.reversed ? ' <span class="mut">(معكوس)</span>' : ''}` : '<span class="mut">غير مرحّل</span>'}</td>
        <td><button class="btn sm" data-act="fin-preview-payroll" data-month="${esc(m.month)}">معاينة${!m.entry && m.total > 0 ? ' وترحيل' : ''}</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  function viewPayrollFin() {
    return `
      <div class="card">
        <div class="spread" style="margin-bottom:10px">
          <div>
            <h3 style="margin:0">💼 التكامل المحاسبي مع مسيرات الرواتب والأجور (HR Payroll Integration)</h3>
            <div class="mut" style="font-size:12px">ترحيل مسيرات الرواتب المعتمدة من شؤون العاملين إلى قيود يومية مزدوجة في الأستاذ العام</div>
          </div>
          <button class="btn pri sm" data-act="fin-load-payroll-runs">🔄 جلب مسيرات الرواتب من شؤون العاملين</button>
        </div>
        <div id="fin-payroll-box" class="empty">اضغط «جلب مسيرات الرواتب» لاستعراض آخر 12 شهرًا ومعاينة قيودها وترحيلها</div>
      </div>`;
  }

  function renderBody() {
    if (F.tab === 'overview') return viewOverview();
    if (F.tab === 'coa') return viewCoa() + currenciesCard();
    if (F.tab === 'journal') return viewJournal();
    if (F.tab === 'treasury') return viewTreasury();
    if (F.tab === 'reports') return viewReports();
    if (F.tab === 'student_fees') return viewStudentFees();
    if (F.tab === 'payroll_fin') return viewPayrollFin();
    return '';
  }

  async function mount(el) {
    await loadTab();
    el.innerHTML = `
      <div class="sub-tabs" style="margin-bottom:14px">
        ${TABS.map(([k, l]) => `<button class="tab ${F.tab === k ? 'on' : ''}" data-act="fin-tab" data-t="${k}" aria-pressed="${F.tab === k}">${l}</button>`).join('')}
      </div>
      <div id="fin-body">${renderBody()}</div>
      <div id="fin-modal"></div>`;
  }

  function showModal(html) {
    const m = document.getElementById('fin-modal');
    if (m) m.innerHTML = `<div class="modal-bg" data-act="fin-close-modal"><div class="modal" style="max-width:740px">${html}</div></div>`;
  }
  const closeModal = () => { const m = document.getElementById('fin-modal'); if (m) m.innerHTML = ''; };
  const refresh = async () => { const el = document.getElementById('ua-view-mount'); if (el) await mount(el); };

  function updateJeTotals() {
    const rows = [...document.querySelectorAll('#je-lines .je-line')];
    let d = 0, c = 0;
    for (const r of rows) {
      d += Number(r.querySelector('.je-deb')?.value || 0);
      c += Number(r.querySelector('.je-cred')?.value || 0);
    }
    const box = document.getElementById('je-balance-indicator');
    if (box) {
      const diff = d - c;
      const ok = d > 0 && diff === 0;
      box.innerHTML = `إجمالي المدين: <b>${money(d)}</b> · إجمالي الدائن: <b>${money(c)}</b> — ` +
        (ok ? `<span class="badge b-ok">✓ القيد متوازن تماماً</span>` : `<span class="badge b-err">⚠️ فارق التوازن: ${money(Math.abs(diff))}</span>`);
    }
  }

  document.addEventListener('input', (e) => {
    if (e.target.closest('#je-lines')) updateJeTotals();
  });

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act^="fin-"]');
    if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'fin-tab') { F.tab = b.dataset.t; await refresh(); }
      else if (act === 'fin-go-rep') { F.tab = 'reports'; F.reportSub = b.dataset.r; await refresh(); }
      else if (act === 'fin-rep-sub') { F.reportSub = b.dataset.r; await refresh(); }
      else if (act === 'fin-tr-sub') { F.treasurySub = b.dataset.sub; await refresh(); }
      else if (act === 'fin-fee-sub') { F.feeSub = b.dataset.sub; await refresh(); }
      else if (act === 'fin-coa-type') { F.coaTypeFilter = b.dataset.type || ''; await refresh(); }
      else if (act === 'fin-coa-search') { F.coaQuery = document.getElementById('fcoa-q')?.value.trim() || ''; await refresh(); }
      else if (act === 'fin-je-filter') { F.jeStatusFilter = b.dataset.st || ''; await refresh(); }
      else if (act === 'fin-close-modal') { if (b.classList.contains('modal-bg') && e.target.closest('.modal')) return; closeModal(); }

      else if (act === 'fin-open-gl') {
        const accId = Number(b.dataset.id);
        F.tab = 'reports'; F.reportSub = 'gl';
        await loadTab();
        F.gl = await api('GET', `/api/finance/reports/ledger?accountId=${accId}`);
        const el = document.getElementById('ua-view-mount');
        if (el) el.querySelector('#fin-body').innerHTML = renderBody();
      }
      else if (act === 'fin-open-ps') {
        const pid = Number(b.dataset.id);
        F.tab = 'reports'; F.reportSub = 'ps';
        await loadTab();
        F.ps = await api('GET', `/api/finance/reports/party-statement?partyId=${pid}`);
        const el = document.getElementById('ua-view-mount');
        if (el) el.querySelector('#fin-body').innerHTML = renderBody();
      }

      else if (act === 'fin-new-acc' || act === 'fin-edit-acc') {
        const cur = act === 'fin-edit-acc' ? F.accounts.find((x) => x.id === Number(b.dataset.id)) : null;
        showModal(`<h3>${cur ? 'تعديل حساب في الدليل المحاسبي' : 'إضافة حساب جديد في شجرة الحسابات'}</h3>
          <div class="form-grid">
            <label>رمز الحساب<input id="fa-code" value="${esc(cur?.code || '')}" placeholder="1150"></label>
            <label>اسم الحساب<input id="fa-name" value="${esc(cur?.name || '')}" placeholder="سلف العاملين"></label>
            <label>نوع الحساب الرئيسي<select id="fa-type">${Object.entries(TYPE_LBL).map(([k, [l]]) => `<option value="${k}" ${cur?.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label>الطبيعة المحاسبية<select id="fa-norm"><option value="debit" ${cur?.normal === 'debit' ? 'selected' : ''}>مدين (Debit)</option><option value="credit" ${cur?.normal === 'credit' ? 'selected' : ''}>دائن (Credit)</option></select></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-acc" data-id="${cur?.id || ''}">حفظ الحساب</button></div>`);
      }
      else if (act === 'fin-save-acc') {
        const id = b.dataset.id;
        const body = { code: document.getElementById('fa-code').value, name: document.getElementById('fa-name').value, type: document.getElementById('fa-type').value, normal: document.getElementById('fa-norm').value };
        if (id) await api('PUT', `/api/finance/accounts/${id}`, body);
        else await api('POST', '/api/finance/accounts', body);
        toast('تم حفظ الحساب في الدليل المحاسبي'); closeModal(); await refresh();
      }

      else if (act === 'fin-new-cc') {
        showModal(`<h3>إضافة مركز تكلفة</h3>
          <div class="form-grid">
            <label>الرمز<input id="fcc-code" placeholder="CC-05"></label>
            <label>اسم مركز التكلفة<input id="fcc-name" placeholder="كلية الصيدلة"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-cc">حفظ</button></div>`);
      }
      else if (act === 'fin-save-cc') {
        await api('POST', '/api/finance/cost-centers', { code: document.getElementById('fcc-code').value, name: document.getElementById('fcc-name').value });
        toast('أُضيف مركز التكلفة'); closeModal(); await refresh();
      }
      else if (act === 'fin-del-cc') { await api('DELETE', `/api/finance/cost-centers/${b.dataset.id}`); toast('حُذف مركز التكلفة'); await refresh(); }

      else if (act === 'fin-new-fy') {
        showModal(`<h3>فتح سنة مالية جديدة</h3>
          <div class="form-grid">
            <label>رمز السنة<input id="ffy-code" placeholder="2027"></label>
            <label>تاريخ البداية<input id="ffy-s" type="date"></label>
            <label>تاريخ النهاية<input id="ffy-e" type="date"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-fy">فتح السنة المالية</button></div>`);
      }
      else if (act === 'fin-save-fy') {
        await api('POST', '/api/finance/fiscal-years', { code: document.getElementById('ffy-code').value, startDay: document.getElementById('ffy-s').value, endDay: document.getElementById('ffy-e').value });
        toast('تم فتح السنة المالية'); closeModal(); await refresh();
      }
      else if (act === 'fin-close-fy') { await api('POST', `/api/finance/fiscal-years/${b.dataset.id}/close`, {}); toast('تم إقفال السنة المالية'); await refresh(); }

      else if (act === 'fin-new-je') {
        if (!F.accounts.length) {
          const [a, c] = await Promise.all([api('GET', '/api/finance/accounts'), api('GET', '/api/finance/cost-centers')]);
          F.accounts = a.accounts; F.centers = c.costCenters;
        }
        const leafAccs = F.accounts.filter((a) => a.active && String(a.code).length >= 3);
        const accOpts = leafAccs.map((a) => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');
        const ccOpts = `<option value="">— مركز تكلفة (اختياري) —</option>` + (F.centers || []).map((c) => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name)}</option>`).join('');
        const today = new Date().toISOString().slice(0, 10);
        showModal(`<h3>⚖️ تحرير قيد يومية مزدوج (Double-Entry Journal)</h3>
          <div class="form-grid">
            <label>تاريخ القيد<input id="je-day" type="date" value="${today}"></label>
            <label>رقم المرجع / المستند<input id="je-ref" placeholder="DOC-2026-01"></label>
            <label style="grid-column:1/-1">البيان العام للقيد<input id="je-desc" placeholder="إثبات إيراد رسوم أو مصروف تشغيلي"></label>
          </div>
          <div class="spread" style="margin:10px 0 6px">
            <h4 style="margin:0">أطراف القيد المحاسبي</h4>
            <div id="je-balance-indicator"></div>
          </div>
          <div id="je-lines">
            <div class="form-grid je-line" style="margin-bottom:6px;grid-template-columns:1.6fr .8fr .8fr 1fr 1fr">
              <select class="je-acc">${accOpts}</select>
              <input class="je-deb" type="number" placeholder="مدين">
              <input class="je-cred" type="number" placeholder="دائن" value="0">
              <select class="je-cc">${ccOpts}</select>
              <input class="je-memo" placeholder="إيضاح السطر">
            </div>
            <div class="form-grid je-line" style="margin-bottom:6px;grid-template-columns:1.6fr .8fr .8fr 1fr 1fr">
              <select class="je-acc">${accOpts}</select>
              <input class="je-deb" type="number" placeholder="مدين" value="0">
              <input class="je-cred" type="number" placeholder="دائن">
              <select class="je-cc">${ccOpts}</select>
              <input class="je-memo" placeholder="إيضاح السطر">
            </div>
          </div>
          <button class="btn sm" data-act="fin-add-je-line">+ إضافة سطر للقيد</button>
          <div class="row-end" style="margin-top:12px">
            <button class="btn" data-act="fin-close-modal">إلغاء</button>
            <button class="btn" data-act="fin-save-je" data-post="0">حفظ كمسودة</button>
            <button class="btn pri" data-act="fin-save-je" data-post="1">حفظ وترحيل للأستاذ العام</button>
          </div>`);
        updateJeTotals();
      }
      else if (act === 'fin-add-je-line') {
        const c = document.getElementById('je-lines');
        const first = c?.querySelector('.je-line');
        if (c && first) {
          const clone = first.cloneNode(true);
          clone.querySelectorAll('input').forEach((i) => (i.value = i.type === 'number' ? '0' : ''));
          c.appendChild(clone);
          updateJeTotals();
        }
      }
      else if (act === 'fin-save-je') {
        const lines = [...document.querySelectorAll('#je-lines .je-line')].map((r) => ({
          accountId: Number(r.querySelector('.je-acc').value),
          debit: Number(r.querySelector('.je-deb').value || 0),
          credit: Number(r.querySelector('.je-cred').value || 0),
          costCenterId: r.querySelector('.je-cc')?.value ? Number(r.querySelector('.je-cc').value) : null,
          memo: r.querySelector('.je-memo').value
        }));
        await api('POST', '/api/finance/journal', {
          entryDay: document.getElementById('je-day').value,
          reference: document.getElementById('je-ref').value,
          description: document.getElementById('je-desc').value,
          post: b.dataset.post === '1',
          lines
        });
        toast('تم حفظ قيد اليومية المزدوج بنجاح'); closeModal(); F.tab = 'journal'; await refresh();
      }
      else if (act === 'fin-view-je') {
        const { entry: j } = await api('GET', `/api/finance/journal/${b.dataset.id}`);
        // الخادم يرسل day وcode/account وnote وtotal؛ والأسماء القديمة تبقى احتياطاً
        const jl = j.lines || [];
        const sumD = jl.reduce((a, l) => a + Number(l.debit || 0), 0), sumC = jl.reduce((a, l) => a + Number(l.credit || 0), 0);
        showModal(`<div data-doc-title="سند ${esc(j.typeLabel || 'قيد يومية')}" data-doc-no="${esc(j.no)}" data-doc-dept="المالية والمحاسبة" data-doc-status="${esc((JE_ST[j.status] || [j.status])[0] || j.status)}" data-doc-signers="المحاسب:${esc(j.createdBy || '')}|المدقق المالي|المدير المالي${j.postedBy ? ' (الترحيل):' + esc(j.postedBy) : ''}">
          <div class="spread"><h3>سند قيد يومية رقم ${esc(j.no)}</h3>${badge(JE_ST, j.status)}</div>
          <p><b>تاريخ القيد:</b> ${esc(j.day || j.entryDay || '')} · <b>المرجع:</b> ${esc(j.reference || '—')} · <b>السنة المالية:</b> ${esc(j.year || '')}</p>
          <p><b>البيان:</b> ${esc(j.description)}</p>
          <table class="tbl"><thead><tr><th>رمز الحساب</th><th>اسم الحساب</th><th>مركز التكلفة</th><th>مدين</th><th>دائن</th><th>البيان</th></tr></thead><tbody>
            ${jl.map((l) => `<tr><td><code>${esc(l.code || l.accountCode || '')}</code></td><td>${esc(l.account || l.accountName || '')}${l.party ? ` <small>(${esc(l.party)})</small>` : ''}</td><td>${esc(l.costCenter || '—')}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td>${esc((l.note || l.memo || '') === j.description ? '' : (l.note || l.memo || ''))}</td></tr>`).join('')}
          </tbody><tfoot><tr><th colspan="3">الإجمالي المتوازن</th><th>${money(sumD)}</th><th>${money(sumC)}</th><th></th></tr></tfoot></table>
          <p class="small">أنشأه: ${esc(j.createdBy || '—')}${j.postedBy ? ` · رحّله: ${esc(j.postedBy)}` : ''}</p>
        </div>
          <div class="row-end" style="margin-top:12px"><button class="btn no-print" data-act="print">🖨️ طباعة سند القيد</button><button class="btn pri" data-act="fin-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'fin-post-je') { await api('POST', `/api/finance/journal/${b.dataset.id}/post`, {}); toast('تم ترحيل القيد إلى الأستاذ العام'); await refresh(); }
      else if (act === 'fin-rev-je') { await api('POST', `/api/finance/journal/${b.dataset.id}/reverse`, {}); toast('تم إنشاء وترحيل قيد عكسي'); await refresh(); }
      else if (act === 'fin-del-je') { await api('DELETE', `/api/finance/journal/${b.dataset.id}`); toast('حُذفت المسودة'); await refresh(); }

      else if (act === 'fin-new-vch') {
        if (!F.accounts.length || !F.parties.length) {
          const [a, p] = await Promise.all([api('GET', '/api/finance/accounts'), api('GET', '/api/finance/parties')]);
          F.accounts = a.accounts; F.parties = p.parties;
        }
        const kind = b.dataset.kind || 'receipt';
        const leaf = F.accounts.filter((a) => a.active && String(a.code).length >= 3);
        const cashAccs = leaf.filter((a) => a.code.startsWith('111') || a.code.startsWith('112'));
        const today = new Date().toISOString().slice(0, 10);
        showModal(`<h3>${kind === 'receipt' ? '🟢 تحرير سند قبض خزينة (Receipt Voucher)' : '🔴 تحرير سند صرف خزينة (Payment Voucher)'}</h3>
          <input type="hidden" id="fv-kind" value="${kind}">
          <div class="form-grid">
            <label>تاريخ السند<input id="fv-day" type="date" value="${today}"></label>
            <label>طريقة الدفع<select id="fv-method"><option value="cash">نقدي (الصندوق)</option><option value="bank">تحويل مصرفي</option><option value="cheque">شيك مصرفي</option></select></label>
            <label>حساب الصندوق / المصرف<select id="fv-cash">${(cashAccs.length ? cashAccs : leaf).map((a) => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label>
            <label>الحساب المقابل<select id="fv-cnt">${leaf.map((a) => `<option value="${a.id}" ${kind === 'receipt' && a.code === '4100' ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label>
            <label>الطرف المالي (اختياري)<select id="fv-party"><option value="">— بدون طرف —</option>${F.parties.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
            <label>المبلغ (ل.س)<input id="fv-amt" type="number"></label>
            <label style="grid-column:1/-1">البيان والتفاصيل<input id="fv-desc" placeholder="${kind === 'receipt' ? 'قبض رسوم دراسية / إيراد خدمات' : 'صرف نفقات تشغيلية / دفعة لمورد'}"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-vch">إصدار السند وتوليد القيد المحاسبي</button></div>`);
      }
      else if (act === 'fin-save-vch') {
        await api('POST', '/api/finance/vouchers', {
          kind: document.getElementById('fv-kind').value,
          voucherDay: document.getElementById('fv-day').value,
          method: document.getElementById('fv-method').value,
          cashAccountId: Number(document.getElementById('fv-cash').value),
          counterAccountId: Number(document.getElementById('fv-cnt').value),
          partyId: document.getElementById('fv-party').value ? Number(document.getElementById('fv-party').value) : null,
          amount: Number(document.getElementById('fv-amt').value),
          description: document.getElementById('fv-desc').value
        });
        toast('تم إصدار السند وترحيل قيده المحاسبي تلقائياً'); closeModal(); F.tab = 'treasury'; F.treasurySub = 'vouchers'; await refresh();
      }

      else if (act === 'fin-new-inv') {
        const today = new Date().toISOString().slice(0, 10);
        const accOpts = (types) => F.accounts.filter((a) => a.active && a.postable && types.includes(a.type)).map((a) => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');
        showModal(`<h3>📄 إنشاء فاتورة ذمم جديدة</h3>
          ${F.parties.length ? '' : '<p class="hint">لا توجد أطراف مالية بعد؛ أضف طرفًا من تبويب الأطراف أولاً.</p>'}
          <div class="form-grid">
            <label>نوع الفاتورة<select id="fi-kind"><option value="sale">فاتورة مبيعات / إيراد</option><option value="purchase">فاتورة مشتريات / مورد</option></select></label>
            <label>الطرف المالي<select id="fi-party">${F.parties.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.kind === 'customer' ? 'عميل' : 'مورد'})</option>`).join('')}</select></label>
            <label>حساب الإيراد أو المصروف<select id="fi-counter"><option value="">الحساب الافتراضي للنوع</option><optgroup label="إيرادات (للمبيعات)">${accOpts(['revenue'])}</optgroup><optgroup label="مصروفات وأصول (للمشتريات)">${accOpts(['expense', 'asset'])}</optgroup></select></label>
            <label>تاريخ الإصدار<input id="fi-day" type="date" value="${today}"></label>
            <label>وصف البند<input id="fi-desc"></label>
            <label>الكمية<input id="fi-qty" type="number" value="1"></label>
            <label>سعر الوحدة (ل.س)<input id="fi-price" type="number"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn" data-act="fin-save-inv" data-draft="1">حفظ كمسودة</button><button class="btn pri" data-act="fin-save-inv">حفظ وإصدار الفاتورة</button></div>`);
      }
      else if (act === 'fin-save-inv') {
        const draft = b.dataset.draft === '1';
        await api('POST', '/api/finance/invoices', {
          kind: document.getElementById('fi-kind').value,
          partyId: Number(document.getElementById('fi-party').value),
          counterAccountId: Number(document.getElementById('fi-counter').value) || null,
          issueDay: document.getElementById('fi-day').value,
          issue: !draft,
          lines: [{ description: document.getElementById('fi-desc').value, qty: Number(document.getElementById('fi-qty').value), unitPrice: Number(document.getElementById('fi-price').value) }]
        });
        toast(draft ? 'حُفظت الفاتورة كمسودة' : 'أُصدرت الفاتورة ورُحّل قيدها'); closeModal(); await refresh();
      }
      else if (act === 'fin-pay-inv') {
        const inv = F.invoices.find((x) => String(x.id) === b.dataset.id);
        const cashAccs = F.accounts.filter((a) => a.active && a.postable && String(a.code).startsWith('11'));
        const left = Math.round((inv.total - inv.paidAmount) * 100) / 100;
        showModal(`<h3>💵 تسجيل دفعة على الفاتورة ${esc(inv.no)}</h3>
          <p class="hint">${esc(inv.partyName)} — المتبقي ${money(left)}</p>
          <input type="hidden" id="fp-inv" value="${inv.id}">
          <div class="form-grid">
            <label>المبلغ (ل.س)<input id="fp-amt" type="number" min="0" step="0.01" value="${left}"></label>
            <label>تاريخ الدفعة<input id="fp-day" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
            <label>الصندوق أو المصرف<select id="fp-cash">${cashAccs.map((a) => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-pay-inv">تسجيل الدفعة وترحيل قيدها</button></div>`);
      }
      else if (act === 'fin-save-pay-inv') {
        await api('POST', `/api/finance/invoices/${document.getElementById('fp-inv').value}/pay`, {
          amount: Number(document.getElementById('fp-amt').value),
          day: document.getElementById('fp-day').value,
          cashAccountId: Number(document.getElementById('fp-cash').value) || null
        });
        toast('سُجلت الدفعة ورُحّل قيدها'); closeModal(); await refresh();
      }
      else if (act === 'fin-iss-inv') { await api('POST', `/api/finance/invoices/${b.dataset.id}/issue`, {}); toast('أُصدرت الفاتورة'); await refresh(); }
      else if (act === 'fin-can-inv') { await api('POST', `/api/finance/invoices/${b.dataset.id}/cancel`, {}); toast('أُلغيت الفاتورة'); await refresh(); }

      else if (act === 'fin-new-party') {
        showModal(`<h3>👥 تعريف طرف مالي جديد (عميل / مورد)</h3>
          <div class="form-grid">
            <label>الرمز<input id="fp-code" placeholder="CUS-02"></label>
            <label>الاسم الكامل / الشركة<input id="fp-name"></label>
            <label>النوع<select id="fp-kind"><option value="customer">عميل / ذمة مدينة</option><option value="supplier">مورد / ذمة دائنة</option></select></label>
            <label>الهاتف<input id="fp-phone"></label>
            <label>البريد الإلكتروني<input id="fp-email"></label>
            <label>الرقم الضريبي<input id="fp-tax"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-party">حفظ الطرف</button></div>`);
      }
      else if (act === 'fin-save-party') {
        await api('POST', '/api/finance/parties', {
          code: document.getElementById('fp-code').value,
          name: document.getElementById('fp-name').value,
          kind: document.getElementById('fp-kind').value,
          phone: document.getElementById('fp-phone').value,
          email: document.getElementById('fp-email').value,
          taxNo: document.getElementById('fp-tax').value
        });
        toast('تم حفظ الطرف المالي'); closeModal(); await refresh();
      }

      else if (act === 'fin-load-gl') {
        const id = document.getElementById('fgl-acc')?.value;
        F.gl = await api('GET', `/api/finance/reports/ledger?accountId=${id}`);
        const el = document.getElementById('ua-view-mount');
        if (el) el.querySelector('#fin-body').innerHTML = renderBody();
      }
      else if (act === 'fin-load-ps') {
        const id = document.getElementById('fps-party')?.value;
        if (!id) return;
        F.ps = await api('GET', `/api/finance/reports/party-statement?partyId=${id}`);
        const el = document.getElementById('ua-view-mount');
        if (el) el.querySelector('#fin-body').innerHTML = renderBody();
      }

      else if (act === 'fin-new-fs') {
        showModal(`<h3>📐 تعريف هيكل رسوم دراسية</h3>
          <div class="form-grid">
            <label>البرنامج الأكاديمي<select id="ffs-prog">${F.programs.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
            <label>العام الدراسي<input id="ffs-yr"></label>
            <label>الفصل الدراسي<select id="ffs-sem"><option value="1">الفصل الأول</option><option value="2">الفصل الثاني</option></select></label>
            <label>رسوم التعليم (ل.س)<input id="ffs-tui" type="number"></label>
            <label>رسوم التسجيل والخدمات<input id="ffs-reg" type="number"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-fs">حفظ الهيكل</button></div>`);
      }
      else if (act === 'fin-save-fs') {
        await api('POST', '/api/finance/fee-structures', {
          programId: Number(document.getElementById('ffs-prog').value),
          academicYear: document.getElementById('ffs-yr').value,
          semester: Number(document.getElementById('ffs-sem').value),
          tuitionFee: Number(document.getElementById('ffs-tui').value),
          registrationFee: Number(document.getElementById('ffs-reg').value)
        });
        toast('تم حفظ هيكل الرسوم'); closeModal(); await refresh();
      }
      else if (act === 'fin-new-disc') {
        showModal(`<h3>🎖️ منح حسم أو منحة لطالب</h3>
          <div class="form-grid">
            <label>الرقم الجامعي<input id="fd-stu" dir="ltr" required></label>
            <label>العام الدراسي (كما في فاتورة الرسوم)<input id="fd-yr" required></label>
            <label>النوع<select id="fd-kind"><option value="scholarship">منحة تفوق</option><option value="sibling">حسم أخوة</option><option value="social">إعفاء اجتماعي</option></select></label>
            <label>نسبة الحسم (%)<input id="fd-pct" type="number"></label>
            <label style="grid-column:1/-1">السبب ورقم القرار<input id="fd-rsn"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-disc">حفظ المنحة/الحسم</button></div>`);
      }
      else if (act === 'fin-save-disc') {
        await api('POST', '/api/finance/discounts', {
          studentNo: document.getElementById('fd-stu').value,
          academicYear: document.getElementById('fd-yr').value,
          kind: document.getElementById('fd-kind').value,
          percent: Number(document.getElementById('fd-pct').value),
          reason: document.getElementById('fd-rsn').value
        });
        toast('تم تسجيل الحسم للطالب'); closeModal(); await refresh();
      }
      else if (act === 'fin-new-stu-inv') {
        const today = new Date().toISOString().slice(0, 10);
        showModal(`<h3>🧾 إصدار فاتورة رسوم دراسية وخطة تقسيط لطالب</h3>
          <div class="form-grid">
            <label>الرقم الجامعي<input id="fsi-stu" dir="ltr" required></label>
            <label>العام الدراسي<input id="fsi-yr" required></label>
            <label>نوع الرسم<select id="fsi-ft">${F.feeTypes.filter((t) => t.kind === 'fee' && t.active).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
            <label>المبلغ الإجمالي (ل.س)<input id="fsi-amt" type="number"></label>
            <label>عدد الأقساط<select id="fsi-cnt"><option value="1">دفعة واحدة</option><option value="2" selected>قسطان</option><option value="3">3 أقساط</option></select></label>
            <label>استحقاق القسط الأول<input id="fsi-due" type="date" value="${today}"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-stu-inv">إصدار الفاتورة وترحيل القيد</button></div>`);
      }
      else if (act === 'fin-save-stu-inv') {
        await api('POST', '/api/finance/student-invoices', {
          studentNo: document.getElementById('fsi-stu').value,
          academicYear: document.getElementById('fsi-yr').value,
          feeTypeId: Number(document.getElementById('fsi-ft').value),
          totalAmount: Number(document.getElementById('fsi-amt').value),
          installmentsCount: Number(document.getElementById('fsi-cnt').value),
          firstDueDay: document.getElementById('fsi-due').value
        });
        toast('أُصدرت فاتورة الطالب مع خطة الأقساط'); closeModal(); await refresh();
      }
      else if (act === 'fin-stu-page') { F.stuPage = Number(b.dataset.p); await refresh(); }
      else if (act === 'fin-stu-search') { F.stuQ = document.getElementById('fsi-q').value.trim(); F.stuPage = 1; await refresh(); }
      else if (act === 'fin-stu-statement') {
        const st = await api('GET', `/api/finance/student-statement/${b.dataset.id}`);
        showModal(`<h3>كشف حساب: ${esc(st.student.name)}</h3>
          <p>الرسوم: <b>${money(st.totalCharged)}</b> · الحسومات: <b>${money(st.totalDiscounts)}</b> · المدفوع: <b>${money(st.totalPaid)}</b> · الرصيد: <b>${money(st.balance)}</b></p>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead><tbody>
            ${st.charges.filter((c) => c.status === 'open').map((c) => `<tr><td>${esc(c.dueDay)}</td><td>${esc(c.feeType)}${c.note ? ' · ' + esc(c.note) : ''}</td><td>${c.kind === 'fee' ? money(c.amount) : ''}</td><td>${c.kind === 'discount' ? money(c.amount) : ''}</td></tr>`).join('')}
            ${st.payments.filter((p) => p.status === 'ok').map((p) => `<tr><td>${esc(p.paidDay)}</td><td>دفعة ${esc(p.receiptNo)}</td><td></td><td>${money(p.amount)}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="row-end" style="margin-top:12px"><button class="btn no-print" data-act="print">طباعة</button><span hidden data-doc-dept="المالية والمحاسبة" data-doc-signers="الطالب:${esc(st.student.name)}|المحاسب|المدير المالي"></span><button class="btn pri" data-act="fin-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'fin-void-charge' || act === 'fin-void-pay') {
        const isPay = act === 'fin-void-pay';
        showModal(`<h3>${isPay ? 'إلغاء الدفعة' : 'إلغاء القيد'}</h3>
          <p class="hint">يُعكس قيدها المحاسبي ويبقى أثرها في السجل.</p>
          <label>سبب الإلغاء<input id="fv-reason" required></label>
          <div class="row-end" style="margin-top:12px"><button class="btn" data-act="fin-close-modal">تراجع</button><button class="btn dan" data-act="fin-do-void" data-kind="${isPay ? 'payments' : 'charges'}" data-id="${b.dataset.id}">تأكيد الإلغاء</button></div>`);
      }
      else if (act === 'fin-do-void') {
        const reason = document.getElementById('fv-reason').value.trim();
        if (!reason) { toast('اكتب سبب الإلغاء'); return; }
        await api('POST', `/api/finance/${b.dataset.kind}/${b.dataset.id}/void`, { reason });
        toast('أُلغي وعُكس قيده'); closeModal(); await refresh();
      }
      else if (act === 'fin-new-ft') {
        const leaf = F.accounts.filter((a) => a.active && a.postable && ['revenue', 'expense'].includes(a.type));
        showModal(`<h3>نوع رسم جديد</h3>
          <div class="form-grid">
            <label>الرمز<input id="ft-code" dir="ltr" required></label>
            <label>الاسم<input id="ft-name" required></label>
            <label>النوع<select id="ft-kind"><option value="fee">رسم</option><option value="discount">خصم</option></select></label>
            <label>الحساب<select id="ft-acc">${leaf.map((a) => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-ft">حفظ</button></div>`);
      }
      else if (act === 'fin-save-ft') {
        await api('POST', '/api/finance/fee-types', { code: document.getElementById('ft-code').value, name: document.getElementById('ft-name').value, kind: document.getElementById('ft-kind').value, accountId: Number(document.getElementById('ft-acc').value) });
        toast('حُفظ نوع الرسم'); closeModal(); F.feeSub = 'feetypes'; await refresh();
      }
      else if (act === 'fin-toggle-ft') {
        await api('POST', `/api/finance/fee-types/${b.dataset.id}/toggle`, { active: b.dataset.on === '1' });
        toast('حُدّث نوع الرسم'); await refresh();
      }
      else if (act === 'fin-cur-rate') {
        showModal(`<h3>سعر صرف ${esc(b.dataset.code)}</h3>
          <label>السعر مقابل العملة الأساسية<input id="cur-rate" type="number" min="0" step="any" value="${esc(b.dataset.rate)}"></label>
          <div class="row-end" style="margin-top:12px"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-save-cur" data-code="${esc(b.dataset.code)}">حفظ</button></div>`);
      }
      else if (act === 'fin-save-cur') {
        await api('PUT', `/api/finance/currencies/${encodeURIComponent(b.dataset.code)}`, { rate: Number(document.getElementById('cur-rate').value) });
        toast('حُدّث سعر الصرف'); closeModal(); await refresh();
      }
      else if (act === 'fin-toggle-cur') {
        await api('PUT', `/api/finance/currencies/${encodeURIComponent(b.dataset.code)}`, { active: b.dataset.on === '1' });
        toast('حُدّثت العملة'); await refresh();
      }
      else if (act === 'fin-view-stu-inv') {
        const { invoice: inv } = await api('GET', `/api/finance/student-invoices/${b.dataset.id}`);
        showModal(`<h3>أقساط الفاتورة ${esc(inv.no)} — ${esc(inv.studentName)}</h3>
          <p>الصافي: <b>${money(inv.netAmount)}</b> · المسدد: <b>${money(inv.paidAmount)}</b> · المتبقي: <b>${money(inv.netAmount - inv.paidAmount)}</b></p>
          <table class="tbl"><thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th>المبلغ</th><th>المسدد</th><th>الحالة</th></tr></thead><tbody>
            ${inv.installments.map((x) => `<tr><td>${x.seq}</td><td>${esc(x.dueDay)}</td><td>${money(x.amount)}</td><td>${money(x.paidAmount)}</td><td>${esc(x.status)}</td></tr>`).join('')}
          </tbody></table>
          <div class="row-end" style="margin-top:12px"><button class="btn no-print" data-act="print">طباعة</button><span hidden data-doc-dept="المالية والمحاسبة" data-doc-signers="الطالب|المحاسب|المدير المالي"></span><button class="btn pri" data-act="fin-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'fin-pay-stu-inv') {
        const { invoice: inv } = await api('GET', `/api/finance/student-invoices/${b.dataset.id}`);
        const rem = inv.netAmount - inv.paidAmount;
        showModal(`<h3>💵 تحصيل دفعة من فاتورة الطالب ${esc(inv.no)}</h3>
          <div class="form-grid">
            <label>المبلغ المحصّل (المتبقي: ${money(rem)})<input id="fsp-amt" type="number" value="${rem}"></label>
            <label>طريقة الدفع<select id="fsp-m"><option value="cash">نقدي (الصندوق)</option><option value="bank">تحويل مصرفي</option></select></label>
          </div>
          <div class="row-end"><button class="btn" data-act="fin-close-modal">إلغاء</button><button class="btn pri" data-act="fin-do-pay-stu" data-id="${inv.id}">تأكيد التحصيل وإصدار سند قبض</button></div>`);
      }
      else if (act === 'fin-do-pay-stu') {
        await api('POST', `/api/finance/student-invoices/${b.dataset.id}/pay`, {
          amount: Number(document.getElementById('fsp-amt').value),
          method: document.getElementById('fsp-m').value
        });
        toast('تم تحصيل الدفعة وإصدار سند قبض وقيد محاسبي آلي'); closeModal(); await refresh();
      }
      else if (act === 'fin-load-payroll-runs') { await loadPayrollMonths(); }
      else if (act === 'fin-preview-payroll') {
        const p = await api('GET', `/api/finance/payroll-preview?month=${encodeURIComponent(b.dataset.month)}`);
        showModal(`<h3>رواتب شهر ${esc(p.month)}</h3>
          <p>الإجمالي: <b>${money(p.total)}</b> · الموظفون: <b>${num(p.rows.length)}</b>${p.missing.length ? ` · <span style="color:#B3261E">بلا راتب مسجل: ${num(p.missing.length)}</span>` : ''}</p>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرقم</th><th>الموظف</th><th>الراتب</th></tr></thead><tbody>
            ${p.rows.map((x) => `<tr><td><code>${esc(x.employeeNo)}</code></td><td>${esc(x.name)}</td><td>${money(x.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">لا توجد رواتب مسجلة</td></tr>'}
          </tbody></table></div>
          <div class="row-end" style="margin-top:12px"><button class="btn no-print" data-act="print">طباعة</button><span hidden data-doc-dept="المالية والمحاسبة" data-doc-signers="المحاسب|مدير شؤون الموظفين|المدير المالي"></span><button class="btn" data-act="fin-close-modal">إغلاق</button>${!p.entry && p.total > 0 && can('finance:post') ? `<button class="btn pri" data-act="fin-post-payroll" data-month="${esc(p.month)}">ترحيل القيد</button>` : ''}</div>`);
      }
      else if (act === 'fin-post-payroll') {
        const r = await api('POST', '/api/finance/payroll-entry', { month: b.dataset.month });
        toast(`رُحّلت رواتب الشهر بالقيد ${r.entry.no}`); closeModal(); await loadPayrollMonths();
      }
    } catch (err) {
      toast(err.message || 'تعذّر تنفيذ العملية المالية');
    }
  });

  UA.views.finance = async function (el) { await mount(el); };
})();
