/* تبويب «فئات الطلاب» في شؤون الطلاب: إنشاء الفئات من الطلاب الموجودين، وتعديل أسمائها وأعضائها، وتوزيع مجموعة على عدة فئات. */
(function () {
  const UA = window.UA, { api, esc, toast, can } = UA;
  const G = { groups: null, kinds: {}, sel: null, members: [], mode: '', q: '', results: [], picked: new Set(), loading: false, err: '' };
  const canWrite = () => can('student:update') || can('course:manage');
  const kindOpts = (sel) => Object.entries(G.kinds).map(([k, l]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');

  async function load() {
    try { const r = await api('GET', '/api/student-groups'); G.groups = r.groups; G.kinds = r.kinds; G.err = ''; } catch (e) { if (!e.status) throw e; G.groups = []; G.err = e.message; }
  }
  UA.loadStudentGroups = load;
  async function select(id) {
    const r = await api('GET', `/api/student-groups/${id}`);
    G.sel = r.group; G.members = r.members; G.mode = ''; G.picked.clear(); G.results = []; G.q = '';
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
