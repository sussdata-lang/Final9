/* تبويبات «الأقسام والموارد» و«أخطاء DevOps» في صفحة الإحصاءات: رسوم SVG خالصة بلا مكتبة خارجية.
   تعرضها UA.views.dashboard عبر UA.analyticsPanel، وتقرأ من /api/devops/incidents و/api/hr-pro/overview. */
(function () {
  const UA = window.UA = window.UA || {};
  const PAL = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  const st = { tab: 'departments', dept: 'all', dev: null, hr: null, loading: false, err: '' };
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); Object.assign(st, { dept: 'all', dev: null, hr: null, err: '' }); };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const short = (s, n = 16) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  async function get(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 401 ? 'انتهت الجلسة، سجّل الدخول من جديد.' : res.status === 403 ? 'لا تملك صلاحية عرض هذه البيانات.' : 'تعذّر جلب البيانات (' + res.status + ')');
    return res.json();
  }

  /* ---------- رسوم SVG ---------- */
  function nice(max) {
    if (max <= 0) return 1;
    if (max <= 4) return Math.ceil(max);                      // أعداد صغيرة: محور بخطوات صحيحة
    const p = Math.pow(10, Math.floor(Math.log10(max))), f = max / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function legend(series) {
    return `<div class="an-lg">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }
  // أعمدة مجمّعة: cats = [{label, vals:[..]}]، series = [{name,color}]
  function bars(cats, series, o = {}) {
    if (!cats.length) return '<div class="an-empty">لا توجد بيانات</div>';
    const W = o.wide ? 1000 : 560, H = 230, L = 46, R = 10, T = 12, B = 54;
    const max = nice(Math.max(1, ...cats.flatMap((c) => c.vals))), tk = max <= 4 ? max : 4;
    const iw = W - L - R, ih = H - T - B, gw = iw / cats.length, bw = Math.min(26, (gw * 0.7) / series.length);
    let g = '';
    for (let i = 0; i <= tk; i++) {
      const y = T + ih - (ih * i) / tk;
      g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="an-grid"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="an-ax">${nf((max * i) / tk)}</text>`;
    }
    cats.forEach((c, i) => {
      const cx = L + gw * i + gw / 2, x0 = cx - (bw * series.length) / 2;
      c.vals.forEach((v, j) => {
        const h = (ih * v) / max;
        g += `<rect x="${x0 + bw * j}" y="${T + ih - h}" width="${bw - 2}" height="${Math.max(h, v > 0 ? 1 : 0)}" rx="3" fill="${series[j].color}"><title>${esc(c.label)} — ${esc(series[j].name)}: ${nf(v)}${o.unit ? ' ' + esc(o.unit) : ''}</title></rect>`;
      });
      g += `<text x="${cx}" y="${H - B + 16}" text-anchor="middle" class="an-ax" transform="rotate(-18 ${cx} ${H - B + 16})">${esc(short(c.label, 14))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="an-svg" role="img" aria-label="${esc(o.label || 'مخطط أعمدة')}">${g}</svg>${series.length > 1 ? legend(series) : ''}`;
  }
  // خطوط/مساحة: labels[], series=[{name,color,vals[]}]
  function lines(labels, series, o = {}) {
    if (!labels.length) return '<div class="an-empty">لا توجد بيانات</div>';
    const W = o.wide ? 1000 : 560, H = 230, L = 40, R = 14, T = 12, B = 44;
    const max = nice(Math.max(1, ...series.flatMap((s) => s.vals))), tk = max <= 4 ? max : 4;
    const iw = W - L - R, ih = H - T - B, step = labels.length > 1 ? iw / (labels.length - 1) : 0;
    const X = (i) => W - R - step * i;                       // الأقدم يميناً والأحدث يساراً (RTL)
    const Y = (v) => T + ih - (ih * v) / max;
    let g = '';
    for (let i = 0; i <= tk; i++) {
      const y = T + ih - (ih * i) / tk;
      g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="an-grid"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="an-ax">${nf((max * i) / tk)}</text>`;
    }
    labels.forEach((l, i) => { g += `<text x="${X(i)}" y="${H - B + 18}" text-anchor="middle" class="an-ax">${esc(short(l, 15))}</text>`; });
    series.forEach((s, k) => {
      const pts = s.vals.map((v, i) => [X(i), Y(v)]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if (k === 0 && pts.length > 1) g += `<path d="${d} L${pts[pts.length - 1][0]} ${T + ih} L${pts[0][0]} ${T + ih} Z" fill="${s.color}" opacity=".12"/>`;
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round"/>`;
      pts.forEach((p, i) => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="${s.color}"><title>${esc(labels[i])} — ${esc(s.name)}: ${nf(s.vals[i])}</title></circle>`; });
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="an-svg" role="img" aria-label="مخطط خطي">${g}</svg>${legend(series)}`;
  }
  // دائرة: items=[{name,value,color}]
  function donut(items, centerLabel) {
    const data = items.filter((d) => Number(d.value) > 0);
    const total = data.reduce((s, d) => s + Number(d.value), 0);
    if (!total) return '<div class="an-empty">لا توجد بيانات</div>';
    const R = 70, r = 44, C = 90;
    let a0 = -Math.PI / 2, g = '';
    data.forEach((d, i) => {
      const frac = Number(d.value) / total, a1 = a0 + (frac >= 1 ? 2 * Math.PI - 0.001 : frac * 2 * Math.PI);
      const p = (a, rad) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
      const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r), big = a1 - a0 > Math.PI ? 1 : 0;
      g += `<path d="M${x0} ${y0}A${R} ${R} 0 ${big} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${big} 0 ${x3} ${y3}Z" fill="${d.color || PAL[i % PAL.length]}"><title>${esc(d.name)}: ${nf(d.value)} (${Math.round(frac * 100)}%)</title></path>`;
      a0 = a1;
    });
    const lg = data.map((d, i) => `<span><i style="background:${d.color || PAL[i % PAL.length]}"></i>${esc(d.name)} <b>${nf(d.value)}</b></span>`).join('');
    return `<div class="an-donut"><svg viewBox="0 0 180 180" role="img" aria-label="مخطط دائري">${g}<text x="90" y="88" text-anchor="middle" class="an-big">${nf(total)}</text><text x="90" y="106" text-anchor="middle" class="an-ax">${esc(centerLabel || 'الإجمالي')}</text></svg><div class="an-lg col">${lg}</div></div>`;
  }
  // أشرطة أفقية: items=[{label,value,color?,sub?}]
  function hbars(items, unit) {
    if (!items.length) return '<div class="an-empty">لا توجد بيانات</div>';
    const max = Math.max(1, ...items.map((i) => Number(i.value)));
    return `<div class="an-hb">${items.map((it, i) => `<div class="an-hr" title="${esc(it.label)}: ${nf(it.value)}"><span class="an-hl">${esc(short(it.label, 34))}</span><div class="an-ht"><div class="an-hf" style="width:${(Number(it.value) / max) * 100}%;background:${it.color || PAL[i % PAL.length]}"></div></div><b>${nf(it.value)}${unit ? ' ' + esc(unit) : ''}</b></div>`).join('')}</div>`;
  }
  const kpi = (label, value, tone, sub) => `<div class="an-kpi ${tone || ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const card = (title, body, wide) => `<section class="an-card${wide ? ' wide' : ''}"><h3>${esc(title)}</h3>${body}</section>`;

  /* ---------- التبويبات ---------- */
  function devopsTab() {
    const d = st.dev;
    if (!d) return '<div class="an-empty">لا توجد بيانات</div>';
    const s = d.stats || {};
    const ts = d.timeSeries || [];
    return `<div class="an-kpis">
      ${kpi('إجمالي البلاغات', nf(s.total), '', '')}
      ${kpi('قيد المعالجة', nf(s.open), s.open ? 'warn' : 'ok')}
      ${kpi('حرجة مفتوحة', nf(s.critical), s.critical ? 'bad' : 'ok', 'من أصل ' + nf(s.totalCritical) + ' حرجة')}
      ${kpi('تمت المعالجة', nf(s.resolved), 'ok', 'نسبة الحل ' + nf(s.resolutionRate) + '%')}
      ${kpi('نجاح الإرسال', nf(s.deliverySuccessRate) + '%', 'ok', 'مباشر ' + nf(s.directDeliveryRate) + '%')}
      ${kpi('متوسط الاستجابة', nf(s.avgLatencyMs) + ' مللي ثانية', '')}
    </div>
    <div class="an-grid2">
      ${card('تواتر الأخطاء خلال آخر 7 أيام', lines(ts.map((x) => x.label), [
        { name: 'الإجمالي', color: '#3b82f6', vals: ts.map((x) => x.totalErrors) },
        { name: 'حرجة', color: '#ef4444', vals: ts.map((x) => x.criticalCount) },
        { name: 'تمت معالجتها', color: '#10b981', vals: ts.map((x) => x.resolvedCount) },
      ], { wide: true }), true)}
      ${card('حالة المعالجة', donut(d.statusBreakdown || [], 'بلاغ'))}
      ${card('طريقة إرسال البلاغات', donut(d.deliveryBreakdown || [], 'بلاغ'))}
      ${card('التوزيع حسب الخطورة', donut((d.bySeverity || []).map((x) => ({ name: x.name, value: x.value, color: x.color })), 'بلاغ'))}
      ${card('أكثر العمليات تسبباً بالأخطاء', hbars((d.byOperation || []).map((o) => ({ label: o.label || o.operation, value: o.total }))))}
      ${card('أكثر الملفات تعرضاً للأخطاء', hbars((d.byFile || []).map((f) => ({ label: f.filePath, value: f.count }))), true)}
    </div>`;
  }

  function deptTab() {
    const h = st.hr;
    if (!h) return '<div class="an-empty">لا توجد بيانات</div>';
    const k = h.kpis || {}, a = h.analytics || {}, sc = h.accessScope || {};
    // الهيكل فيه أقسام كثيرة، والمخططات تعرض ما فيه موظفون فقط حتى تبقى مقروءة
    const depts = (a.departmentBreakdown || []).filter((d) => Number(d.count) > 0);
    const names = (sc.availableDepartments || ['all']);
    const sel = `<label class="an-sel">القسم: <select id="an-dept" data-no-other="1">${names.map((n) => `<option value="${esc(n)}"${n === st.dept ? ' selected' : ''}>${n === 'all' ? 'كافة الأقسام' : esc(n)}</option>`).join('')}</select></label>
      <span class="an-scope">${esc(sc.userName || '')}${sc.assignedDepartment ? ' · ' + esc(sc.assignedDepartment) : ''}</span>`;
    const ct = (a.contractBreakdown || []).map((c) => ({ name: c.label, value: c.count, color: c.color }));
    const mods = (h.enterpriseModules || []).map((m) => `<div class="an-mod" style="border-top-color:${esc(m.color || '#10b981')}">
        <h4>${esc(m.icon || '')} ${esc(m.title || m.department)}</h4><small>${esc(m.department || '')}</small>
        <ul>${(m.metrics || []).map((x) => `<li><span>${esc(x.label)}</span><b>${typeof x.value === 'number' ? nf(x.value) : esc(x.value)} <em>${esc(x.unit || '')}</em></b></li>`).join('')}</ul></div>`).join('');
    return `<div class="an-bar">${sel}</div>
    <div class="an-kpis">
      ${kpi('عدد العاملين', nf(k.totalEmployees), '', 'على رأس العمل ' + nf(k.activeEmployees))}
      ${kpi('صافي الرواتب', nf(k.totalNetPayroll), 'ok')}
      ${kpi('إجمالي الاستحقاقات', nf(k.totalGrossPayroll), '')}
      ${kpi('متوسط الالتزام', k.totalEmployees ? nf(k.avgCommitment) + '%' : '—', k.totalEmployees && k.avgCommitment < 85 ? 'warn' : '')}
      ${kpi('أيام الغياب', nf(k.totalAbsenceDays), k.totalAbsenceDays ? 'warn' : 'ok')}
      ${kpi('تنبيهات نشطة', nf(k.alertsCount), k.alertsCount ? 'bad' : 'ok')}
    </div>
    <div class="an-grid2">
      ${card('عدد العاملين حسب القسم', bars(depts.map((d) => ({ label: d.department, vals: [d.activeCount, Math.max(0, d.count - d.activeCount)] })), [{ name: 'على رأس العمل', color: '#10b981' }, { name: 'غير ذلك', color: '#94a3b8' }], { unit: 'موظف', wide: true }), true)}
      ${card('الرواتب والاستحقاقات والخصومات', bars(depts.map((d) => ({ label: d.department, vals: [d.baseSalaries, d.totalAllowances, d.totalDeductions] })), [{ name: 'الأساسي', color: '#3b82f6' }, { name: 'البدلات', color: '#f59e0b' }, { name: 'الخصومات', color: '#ef4444' }], { wide: true }), true)}
      ${card('نسبة الالتزام بالدوام %', hbars(depts.map((d) => ({ label: d.department, value: d.avgCommitment, color: d.avgCommitment < 85 ? '#f59e0b' : '#10b981' })), '%'))}
      ${card('توزيع الإجازات (أيام)', donut((a.leaveDistribution || []).filter((x) => x.days > 0).map((x) => ({ name: x.type, value: x.days })), 'يوم'))}
      ${card('حالة العقود', donut(ct, 'عقد'))}
      ${card('السلف المتبقية حسب القسم', hbars(depts.map((d) => ({ label: d.department, value: d.advancesRemaining })).filter((x) => x.value > 0)))}
    </div>
    ${mods ? `<h3 class="an-sec">إحصاءات الوحدات الجامعية</h3><div class="an-mods">${mods}</div>` : ''}`;
  }

  /* ---------- الهيكل والأحداث ---------- */
  const CSS = `
  .ua-an .an-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
  .ua-an .an-kpi{background:var(--surface,#fff);border:1px solid var(--line,#DCE3DD);border-radius:12px;padding:12px 14px;display:grid;gap:3px;border-inline-start:4px solid #3b82f6}
  .ua-an .an-kpi span{font-size:12px;opacity:.75}.ua-an .an-kpi strong{font-size:22px;line-height:1.2}.ua-an .an-kpi small{font-size:11px;opacity:.65}
  .ua-an .an-kpi.ok{border-inline-start-color:#10b981}.ua-an .an-kpi.warn{border-inline-start-color:#f59e0b}.ua-an .an-kpi.bad{border-inline-start-color:#ef4444}
  .ua-an .an-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}
  .ua-an .an-card{background:var(--surface,#fff);border:1px solid var(--line,#DCE3DD);border-radius:14px;padding:14px;min-width:0}
  .ua-an .an-card.wide{grid-column:1/-1}
  .ua-an .an-card h3{margin:0 0 10px;font-size:14px}
  .ua-an .an-svg{width:100%;height:auto;max-height:290px;display:block}
  .ua-an .an-grid{stroke:currentColor;opacity:.12}.ua-an .an-ax{fill:currentColor;opacity:.65;font-size:10.5px}.ua-an .an-big{fill:currentColor;font-size:24px;font-weight:800}
  .ua-an .an-lg{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;margin-top:8px}.ua-an .an-lg.col{flex-direction:column;margin:0}
  .ua-an .an-lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:6px;vertical-align:middle}
  .ua-an .an-donut{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.ua-an .an-donut svg{width:170px;height:170px;flex:none}
  .ua-an .an-hb{display:grid;gap:9px}.ua-an .an-hr{display:grid;grid-template-columns:minmax(90px,38%) 1fr auto;gap:10px;align-items:center;font-size:12.5px}
  .ua-an .an-ht{height:12px;border-radius:7px;background:rgba(127,127,127,.18);overflow:hidden}.ua-an .an-hf{height:100%;border-radius:7px}
  .ua-an .an-empty{padding:26px;text-align:center;opacity:.6;font-size:13px}
  .ua-an .an-bar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:12px;font-size:13px}
  .ua-an .an-sel select{font:inherit;padding:7px 10px;border-radius:8px;border:1px solid var(--line,#ccc);background:var(--surface,#fff);color:inherit}
  .ua-an .an-scope{opacity:.7;font-size:12px}
  .ua-an .an-sec{margin:22px 0 10px;font-size:15px}
  .ua-an .an-mods{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
  .ua-an .an-mod{background:var(--surface,#fff);border:1px solid var(--line,#DCE3DD);border-top:4px solid #10b981;border-radius:12px;padding:12px 14px}
  .ua-an .an-mod h4{margin:0 0 2px;font-size:13.5px}.ua-an .an-mod small{opacity:.6;font-size:11px}
  .ua-an .an-mod ul{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}.ua-an .an-mod li{display:flex;justify-content:space-between;gap:8px;font-size:12.5px}.ua-an .an-mod em{font-style:normal;opacity:.65;font-weight:500}
  .ua-an .an-msg{padding:40px;text-align:center}
  @media (max-width:640px){.ua-an .an-grid2{grid-template-columns:1fr}.ua-an .an-hr{grid-template-columns:1fr auto}.ua-an .an-hr .an-ht{grid-column:1/-1;order:3}}`;

  function html() {
    if (!document.getElementById('ua-an-css')) {
      const s = document.createElement('style'); s.id = 'ua-an-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    const sub = st.tab === 'devops' ? 'أخطاء الملفات والنشر والمعالجة (آخر 7 أيام)' : 'العاملون والرواتب والالتزام وإحصاءات الوحدات';
    let content;
    if (st.loading && !(st.tab === 'devops' ? st.dev : st.hr)) content = '<div class="an-msg">جارٍ تحميل البيانات…</div>';
    else if (st.err) content = `<div class="an-msg" role="alert">${esc(st.err)}</div>`;
    else content = st.tab === 'devops' ? devopsTab() : deptTab();
    return `<div class="ua-an" id="ua-an"><div class="an-bar"><span class="an-scope">${esc(sub)}</span><button class="btn sm" data-an="refresh" style="margin-inline-start:auto">تحديث</button></div>${content}</div>`;
  }
  function paint() {
    const el = document.getElementById('ua-an');
    if (!el) return;
    el.outerHTML = html();
    const now = document.getElementById('ua-an');
    if (now && UA.i18n) UA.i18n.translateDom(now);
  }
  async function load() {
    st.loading = true; st.err = ''; paint();
    try {
      if (st.tab === 'devops') st.dev = await get('/api/devops/incidents');
      else st.hr = await get('/api/hr-pro/overview' + (st.dept && st.dept !== 'all' ? '?dept=' + encodeURIComponent(st.dept) : ''));
    } catch (e) { st.err = e.message || 'تعذّر جلب البيانات'; }
    st.loading = false; paint();
  }
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#ua-an [data-an="refresh"]')) load(); });
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'an-dept') { st.dept = e.target.value; st.hr = null; load(); } });

  UA.analyticsPanel = {
    html(tab) { st.tab = tab; return html(); },
    load(tab) { st.tab = tab; return load(); },
  };
})();
