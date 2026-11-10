/* مكونات علامة المقرر (محرر لكل مقرر، وحقول في نافذة إدخال العلامة)، وإعلان النتائج وقفلها */
(function () {
  'use strict';
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (UA.toast ? UA.toast(m) : window.alert(m));
  const G = { loadedFor: '', comps: [], editor: null, year: '' };

  /* ---------- حقول المكونات في نافذة إدخال العلامة ---------- */
  async function fillGradeForm() {
    const box = document.getElementById('gr-comp'), sel = document.getElementById('gr-course');
    if (!box || !sel) return;
    const course = sel.value, year = (document.getElementById('gr-year') || {}).value || '', key = `${course}|${box.dataset.student}|${year}`;
    if (G.loadedFor === key && box.dataset.ready === '1') return;
    G.loadedFor = key; box.dataset.ready = '1';
    const legacy = [document.getElementById('gr-th'), document.getElementById('gr-pr')].map((x) => x && x.closest('label')).filter(Boolean);
    const show = (on) => { legacy.forEach((l) => { l.style.display = on ? '' : 'none'; const i = l.querySelector('input'); if (i) i.required = on && i.id === 'gr-th'; }); };
    if (!course) { box.innerHTML = ''; G.comps = []; show(true); return; }
    try {
      const d = await UA.api('GET', `/api/courses/${course}/components?studentId=${encodeURIComponent(box.dataset.student || '')}&year=${encodeURIComponent(year)}`);
      G.comps = d.components;
      if (!G.comps.length) { box.innerHTML = ''; show(true); return; }
      show(false);
      box.innerHTML = `<div class="small" style="margin:6px 0">علامة هذا المقرر من مكوناته (المجموع ${d.totalMax}):</div><div class="two">${G.comps.map((c) => `<label>${esc(c.name)} <span class="small">(${esc(c.kindLabel)} · من ${c.max})</span>
        <input class="gr-comp-in" data-id="${c.id}" type="number" min="0" max="${c.max}" required value="${d.marks && d.marks[c.id] !== undefined ? d.marks[c.id] : ''}"></label>`).join('')}</div>`;
    } catch { box.innerHTML = ''; show(true); }
  }
  const observer = new MutationObserver(() => { const box = document.getElementById('gr-comp'); if (box && box.dataset.ready !== '1') fillGradeForm(); });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));
  document.addEventListener('change', (e) => { if (e.target && (e.target.id === 'gr-course' || e.target.id === 'gr-year')) { const box = document.getElementById('gr-comp'); if (box) box.dataset.ready = ''; fillGradeForm(); } });

  /* ---------- محرر مكونات المقرر ---------- */
  function editorHtml() {
    const e = G.editor, sum = e.rows.reduce((s, r) => s + (Number(r.max) || 0), 0);
    return `<div class="modal-bg" data-act="gcclose" style="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center">
      <div class="modal card" role="dialog" aria-label="مكونات العلامة" style="max-width:640px;width:94%;margin:0">
        <h2 style="margin-top:0">مكونات علامة: ${esc(e.name)}</h2>
        <p class="hint">مجموع الأوزان يساوي ${e.totalMax}. اترك القائمة فارغة لرصد النظري والعملي كما هو. لا تتغير الأوزان بعد رصد علامات بها.</p>
        ${e.rows.map((r, i) => `<div class="inline-form" style="margin-bottom:6px"><label style="flex:2">المكوّن<input data-gc="name" data-i="${i}" value="${esc(r.name)}" maxlength="40"></label>
          <label>النوع<select data-gc="kind" data-i="${i}" data-no-other="1"><option value="theory"${r.kind === 'theory' ? ' selected' : ''}>نظري</option><option value="practical"${r.kind === 'practical' ? ' selected' : ''}>عملي</option></select></label>
          <label>الوزن<input data-gc="max" data-i="${i}" type="number" min="1" max="${e.totalMax}" value="${esc(r.max)}" style="width:90px"></label>
          <button class="btn sm" type="button" data-act="gcdel" data-i="${i}">حذف</button></div>`).join('')}
        <p class="small">المجموع الحالي: <b style="color:${sum === e.totalMax || !e.rows.length ? '#1B7F4B' : '#B3261E'}">${sum}</b> من ${e.totalMax}</p>
        <p class="small"><a href="/api/courses/${e.courseId}/grades-template.xlsx" download>تنزيل قالب Excel لاستيراد علامات هذا المقرر</a> (عمود لكل مكوّن باسمه)</p>
        <div class="actions"><button class="btn" type="button" data-act="gcadd">إضافة مكوّن</button><button class="btn pri" type="button" data-act="gcsave">حفظ</button><button class="btn" type="button" data-act="gcclose">إغلاق</button></div>
      </div></div>`;
  }
  const drawEditor = () => { let el = document.getElementById('gc-editor'); if (!el) { el = document.createElement('div'); el.id = 'gc-editor'; document.body.appendChild(el); } el.innerHTML = G.editor ? editorHtml() : ''; };
  const readEditor = () => { document.querySelectorAll('#gc-editor [data-gc]').forEach((x) => { const r = G.editor.rows[Number(x.dataset.i)]; if (r) r[x.dataset.gc] = x.dataset.gc === 'max' ? Number(x.value) : x.value; }); };

  /* ---------- إعلان النتائج وقفلها ---------- */
  async function resultsHtml() {
    const d = await UA.api('GET', `/api/grades/results${G.year ? `?year=${encodeURIComponent(G.year)}` : ''}`);
    G.year = d.year;
    const can = UA.can('grade:approve');
    return `<section class="card"><h2>إعلان النتائج وقفلها</h2>
      <p class="hint" style="margin-top:0">تُعلن نتيجة المقرر بعد اعتماد كل علاماته، فيُبلَّغ طلابه وتُقفل علاماته. التعديل بعدها لمن يملك صلاحية تعديل النتائج المقفلة وبتبرير يُسجَّل.</p>
      <div class="inline-form"><label>العام الدراسي<input id="gl-year" value="${esc(d.year)}" dir="ltr" pattern="\\d{4}/\\d{4}"></label><button class="btn" type="button" data-act="glyear">عرض</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>المقرر</th><th>العلامات</th><th>المعتمدة</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${d.courses.map((c) => `<tr><td><b>${esc(c.name)}</b> <span class="mono small">${esc(c.code || '')}</span></td><td>${c.total}</td><td>${c.approved}</td>
        <td>${c.lockedAt ? `<span class="pill p-approved">أُعلنت</span> <span class="small">${esc(new Date(c.lockedAt).toISOString().slice(0, 10))} · ${esc(c.lockedBy || '')}</span>` : c.approved < c.total ? '<span class="pill p-review">بانتظار الاعتماد</span>' : '<span class="pill p-review">جاهزة للإعلان</span>'}</td>
        <td>${!c.lockedAt && can ? `<button class="btn pri sm" type="button" data-act="gllock" data-id="${c.courseId}"${c.approved < c.total ? ' disabled' : ''}>إعلان وقفل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="small">لا علامات في هذا العام.</td></tr>'}
      </tbody></table></div></section>`;
  }
  async function mountResults() {
    const el = document.getElementById('gl-mount'); if (!el) return;
    try { el.innerHTML = await resultsHtml(); } catch (e) { el.innerHTML = `<section class="card"><p class="reason">${esc(e.message || 'تعذر التحميل.')}</p></section>`; }
  }

  UA.grading = {
    // تُضاف إلى طلب حفظ العلامة: علامات المكونات إن كان للمقرر مكونات
    collect() {
      const ins = [...document.querySelectorAll('#gr-comp .gr-comp-in')];
      return ins.length ? { components: Object.fromEntries(ins.map((x) => [x.dataset.id, x.value === '' ? '' : Number(x.value)])) } : {};
    },
    renderResults() { setTimeout(mountResults, 0); return '<div id="gl-mount"><section class="card"><p class="hint">جارٍ التحميل…</p></section></div>'; },
  };

  Object.assign(UA.actions, {
    gcomp: async (_el, d) => {
      const r = await UA.api('GET', `/api/courses/${d.id}/components`);
      G.editor = { courseId: Number(d.id), name: d.name || '', totalMax: r.totalMax, rows: r.components.map((c) => ({ name: c.name, kind: c.kind, max: c.max })) };
      if (!G.editor.rows.length) G.editor.rows = [{ name: 'أعمال الفصل', kind: 'theory', max: 20 }, { name: 'العملي', kind: 'practical', max: 20 }, { name: 'الامتحان النهائي', kind: 'theory', max: 60 }];
      drawEditor();
    },
    gcadd: async () => { readEditor(); G.editor.rows.push({ name: '', kind: 'theory', max: 10 }); drawEditor(); },
    gcdel: async (_el, d) => { readEditor(); G.editor.rows.splice(Number(d.i), 1); drawEditor(); },
    gcclose: async (el, d, e) => { if (e && e.target && e.target.closest && e.target.closest('.modal') && el.classList.contains('modal-bg')) return; G.editor = null; drawEditor(); },
    gcsave: async () => {
      readEditor();
      await UA.api('PUT', `/api/courses/${G.editor.courseId}/components`, { components: G.editor.rows });
      G.editor = null; drawEditor(); toast('حُفظت مكونات العلامة');
    },
    glyear: async () => { G.year = (document.getElementById('gl-year') || {}).value || ''; await mountResults(); },
    gllock: async (_el, d) => {
      if (!confirm(`إعلان نتيجة المقرر للعام ${G.year} وقفل علاماته؟ يُبلَّغ الطلاب، ولا تتغير العلامات بعدها إلا بالمسار الاستثنائي.`)) return;
      const r = await UA.api('POST', '/api/grades/results/lock', { courseId: Number(d.id), academicYear: G.year });
      toast(`أُعلنت النتيجة وقُفلت ${r.locked} علامة`); await mountResults();
    },
  });
})();
