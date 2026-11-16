/* الرصد السريع للعلامات: كشف المقرر كاملاً في جدول يُملأ بلوحة المفاتيح (أسهم، Enter للحفظ والانتقال، Tab بين الأعمدة)
   مع لصق عمود من Excel، وإحصاءات لحظية وتنبيه على القيم الشاذة. كل صف يُحفظ بقواعد إدخال العلامة نفسها (الحرمان والقفل والحدود). */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (UA.toast ? UA.toast(m) : window.alert(m));
  const G = { sheet: null, cols: [], courses: null, busy: false };
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const num = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[٫,]/g, '.').trim();
  const layer = () => document.getElementById('gg-layer') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'gg-layer' }));
  const cellsOf = (tr) => [...tr.querySelectorAll('.gg-in')];

  function columns(s) {
    if (s.components.length) return s.components.map((c) => ({ key: `c${c.id}`, comp: c.id, label: c.name, max: c.max }));
    const cols = [{ key: 'theory', label: 'النظري', max: s.totalMax }];
    if (s.practicalMax > 0) cols.push({ key: 'practical', label: 'العملي', max: s.practicalMax });
    return cols;
  }
  const valueOf = (r, col) => (col.comp ? r.marks[col.comp] : r[col.key]);

  function html() {
    const s = G.sheet;
    const picker = `<div class="inline-form" style="margin:0 0 10px"><label style="flex:2">المقرر<select id="gg-course" data-act="ggcourse">${(G.courses || []).map((c) => `<option value="${c.id}"${s && String(s.course.id) === String(c.id) ? ' selected' : ''}>${esc(c.name)}${c.code ? ` (${esc(c.code)})` : ''}</option>`).join('')}</select></label>
      <label>العام الدراسي<input id="gg-year" value="${esc(s ? s.year : '')}" maxlength="9" placeholder="2025/2026" style="width:120px"></label>
      <button class="btn" type="button" data-act="ggload">عرض الكشف</button></div>`;
    if (!s) return `${picker}<p class="hint">اختر المقرر ثم «عرض الكشف».</p>`;
    const head = G.cols.map((c) => `<th>${esc(c.label)} <span class="small">/${c.max}</span></th>`).join('');
    const body = s.rows.map((r, i) => `<tr data-r="${r.studentId}"${r.deprived ? ' class="gg-dep"' : ''}><td class="small">${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="mono small">${esc(r.studentNo)}</td>
      ${G.cols.map((c, j) => `<td>${r.deprived ? '—' : `<input class="gg-in" inputmode="numeric" data-col="${j}" data-max="${c.max}" ${c.comp ? `data-comp="${c.comp}"` : `data-k="${c.key}"`} value="${esc(valueOf(r, c) ?? '')}"${s.locked ? ' disabled' : ''} aria-label="${esc(c.label)} ${esc(r.name)}">`}</td>`).join('')}
      <td class="gg-total"><b>—</b></td><td class="gg-st small">${r.deprived ? '<span class="pill p-rejected">محروم</span>' : r.status ? esc({ draft: 'مسودة', reviewed: 'روجعت', approved: 'معتمدة' }[r.status] || r.status) : ''}</td></tr>`).join('');
    return `${picker}
      ${s.locked ? '<p class="reason">نتائج هذا المقرر معلنة ومقفلة لهذا العام؛ لا يمكن تعديلها من هنا.</p>' : '<p class="hint">↓ ↑ للتنقل بين الطلاب · Tab للعمود التالي · Enter يحفظ الصف وينتقل للتالي · الصق (Ctrl+V) عموداً كاملاً من Excel في أي خلية.</p>'}
      <div id="gg-stats" class="gg-stats" aria-live="polite"></div>
      <div class="tbl-wrap" style="max-height:52vh;overflow:auto"><table class="gg-table"><thead><tr><th>#</th><th>الطالب</th><th>الرقم</th>${head}<th>المجموع</th><th>الحالة</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="actions" style="margin-top:10px"><button class="btn pri" type="button" data-act="ggsaveall"${s.locked ? ' disabled' : ''}>حفظ كل الصفوف المعبأة</button><button class="btn" type="button" data-act="ggclose">إغلاق</button></div>`;
  }

  function open() {
    layer().innerHTML = `<div class="gg-bg" data-act="ggclose"><div class="gg-box" role="dialog" aria-label="الرصد السريع للعلامات" onclick="event.stopPropagation()"><h2 style="margin:0 0 10px">⚡ الرصد السريع للعلامات</h2><div id="gg-body">${html()}</div></div></div>`;
    recompute();
  }
  const redraw = () => { const b = document.getElementById('gg-body'); if (b) b.innerHTML = html(); recompute(); };

  // تقرأ قيمة الخلية وتعيد { v, bad } حيث bad سبب الخطأ إن وُجد
  function read(inp) {
    const raw = num(inp.value);
    if (raw === '') return { v: null };
    const v = Number(raw), max = Number(inp.dataset.max);
    if (!Number.isInteger(v) || v < 0) return { v: null, bad: 'ليست عدداً صحيحاً' };
    if (v > max) return { v, bad: `أكبر من الحد ${max} (هل تقصد ${Math.floor(v / 10)}؟)` };
    return { v };
  }
  function recompute() {
    const s = G.sheet; if (!s) return;
    const tbody = document.querySelector('.gg-table tbody'); if (!tbody) return;
    const totals = [], notes = []; let blank = 0, filled = 0, bad = 0;
    for (const tr of tbody.rows) {
      const ins = cellsOf(tr), t = tr.querySelector('.gg-total b');
      if (!ins.length) { t.textContent = '—'; continue; }
      let sum = 0, any = false, rowBad = false;
      for (const inp of ins) {
        const r = read(inp);
        inp.classList.toggle('gg-bad', !!r.bad); inp.title = r.bad || '';
        if (r.bad) { rowBad = true; bad++; notes.push(`${tr.children[1].textContent}: ${r.bad}`); }
        if (r.v !== null) { sum += r.v; any = true; }
      }
      if (any && !rowBad && sum > s.totalMax) { rowBad = true; bad++; notes.push(`${tr.children[1].textContent}: المجموع ${sum} يتجاوز ${s.totalMax}`); }
      tr.classList.toggle('gg-rowbad', rowBad);
      t.textContent = any ? sum : '—';
      if (any) { filled++; if (!rowBad) totals.push({ tr, sum }); } else blank++;
    }
    const n = totals.length, avg = n ? totals.reduce((a, x) => a + x.sum, 0) / n : 0, pass = totals.filter((x) => x.sum >= s.passMark).length;
    const sd = n > 1 ? Math.sqrt(totals.reduce((a, x) => a + (x.sum - avg) ** 2, 0) / n) : 0;
    let outliers = 0;
    for (const x of totals) { const out = n >= 8 && sd > 0 && Math.abs(x.sum - avg) > 2.5 * sd; x.tr.classList.toggle('gg-out', out); if (out) { outliers++; notes.push(`${x.tr.children[1].textContent}: ${x.sum} بعيدة عن المتوسط ${avg.toFixed(1)}`); } }
    const el = document.getElementById('gg-stats');
    if (el) el.innerHTML = `<span>معبأ <b>${filled}</b></span><span>المتوسط <b>${n ? avg.toFixed(1) : '—'}</b></span><span>النجاح <b>${n ? Math.round((pass / n) * 100) + '%' : '—'}</b> (${pass}/${n})</span>
      <span class="${blank ? 'gg-warn' : ''}">بلا علامة <b>${blank}</b></span><span class="${bad ? 'gg-err' : ''}">أخطاء <b>${bad}</b></span><span class="${outliers ? 'gg-warn' : ''}">قيم شاذة <b>${outliers}</b></span>
      ${notes.length ? `<div class="gg-notes">${notes.slice(0, 5).map((x) => `<div>⚠ ${esc(x)}</div>`).join('')}${notes.length > 5 ? `<div>… و${notes.length - 5} تنبيهاً آخر</div>` : ''}</div>` : ''}`;
  }

  function payload(tr) {
    const row = { studentId: Number(tr.dataset.r), components: {} };
    for (const inp of cellsOf(tr)) { const v = num(inp.value); if (inp.dataset.comp) row.components[inp.dataset.comp] = v; else row[inp.dataset.k] = v; }
    if (!G.sheet.components.length) delete row.components;
    return row;
  }
  async function save(trs, justification) {
    const rows = trs.map(payload);
    const out = await UA.api('POST', `/api/courses/${G.sheet.course.id}/grade-sheet`, { year: G.sheet.year, rows, justification });
    const errIds = new Map(out.errors.map((e) => [e.studentId, e.message]));
    for (const tr of trs) {
      const msg = errIds.get(Number(tr.dataset.r));
      tr.classList.toggle('gg-rowbad', !!msg); const st = tr.querySelector('.gg-st');
      if (st) st.innerHTML = msg ? `<span class="reason">${esc(msg)}</span>` : (cellsOf(tr).some((i) => num(i.value) !== '') ? '<span class="pill p-approved">حُفظت</span>' : '');
    }
    return out;
  }

  document.addEventListener('keydown', async (e) => {
    const inp = e.target; if (!inp || !inp.classList || !inp.classList.contains('gg-in')) return;
    const tr = inp.closest('tr'), col = inp.dataset.col, rows = [...tr.parentElement.rows];
    const at = (r) => { const t = rows[r]; return t ? t.querySelector(`.gg-in[data-col="${col}"]`) : null; };
    const i = rows.indexOf(tr), go = (r) => { for (let k = r; k >= 0 && k < rows.length; k += r > i ? 1 : -1) { const c = at(k); if (c) { c.focus(); c.select(); return; } } };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (read(inp).bad || tr.classList.contains('gg-rowbad')) { toast('صحّح القيمة المظللة أولاً.'); return; }
      try { const o = await save([tr]); if (o.errors.length) toast(o.errors[0].message); else go(i + 1); } catch (x) { if (!x.status) throw x; toast(x.message); }
    }
  });
  document.addEventListener('input', (e) => { if (e.target && e.target.classList && e.target.classList.contains('gg-in')) recompute(); });
  document.addEventListener('paste', (e) => {
    const inp = e.target; if (!inp || !inp.classList || !inp.classList.contains('gg-in')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const rows = [...inp.closest('tbody').rows], r0 = rows.indexOf(inp.closest('tr')), c0 = Number(inp.dataset.col);
    text.replace(/\r/g, '').split('\n').filter((l, k, a) => l !== '' || k < a.length - 1).forEach((line, di) => {
      line.split('\t').forEach((cell, dj) => { const t = rows[r0 + di]; const c = t && t.querySelector(`.gg-in[data-col="${c0 + dj}"]`); if (c) c.value = num(cell); });
    });
    recompute();
  });

  Object.assign(UA.actions, {
    ggopen: async () => {
      if (!G.courses) { const d = await UA.api('GET', '/api/courses'); G.courses = (d.courses || d || []).filter((c) => c.active !== false); }
      open();
      const sel = document.getElementById('gg-course');
      if (sel && sel.value) await UA.actions.ggload();
    },
    ggclose: async () => { layer().innerHTML = ''; G.sheet = null; },
    ggcourse: async () => { G.sheet = null; },
    ggload: async () => {
      const course = (document.getElementById('gg-course') || {}).value, year = (document.getElementById('gg-year') || {}).value || '';
      if (!course) return;
      try { G.sheet = await UA.api('GET', `/api/courses/${course}/grade-sheet?year=${encodeURIComponent(year)}`); G.cols = columns(G.sheet); redraw(); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    ggsaveall: async () => {
      const trs = [...document.querySelectorAll('.gg-table tbody tr')].filter((tr) => cellsOf(tr).some((i) => num(i.value) !== ''));
      if (!trs.length) { toast('لا علامات معبأة.'); return; }
      if (document.querySelector('.gg-table tr.gg-rowbad') && !confirm('توجد صفوف فيها أخطاء وسترفضها المنظومة. متابعة حفظ الباقي؟')) return;
      try { const o = await save(trs); toast(`حُفظت ${o.saved} علامة${o.errors.length ? `، ورُفض ${o.errors.length}` : ''}`); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
  });
})();
