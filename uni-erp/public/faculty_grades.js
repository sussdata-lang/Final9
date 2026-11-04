/* تبويب «علامات موادي» لعضو الهيئة التدريسية: يعتمد العلامات التي أرسلها قسم الامتحانات لمقرراته، أو يعيدها إليه بسبب. */
(function () {
  const UA = window.UA, { api, esc, fmt, toast } = UA;
  const G = { data: null, loading: false, err: '', open: null };
  async function load() {
    try { G.data = await api('GET', '/api/faculty/my-grades'); G.err = ''; } catch (e) { if (!e.status) throw e; G.data = { courses: [] }; G.err = e.message; }
  }
  const statusPill = (r) => `<span class="pill ${r.status === 'approved' ? 'p-approved' : 'p-review'}">${esc(r.statusLabel)}</span>`;
  function courseCard(c) {
    const pending = c.rows.filter((r) => r.status === 'reviewed');
    const rows = c.rows.map((r) => `<tr><td class="mono">${esc(r.studentNo)}</td><td>${esc(r.studentName)}</td><td>${r.theory ?? '—'}</td><td>${r.practical ?? '—'}</td><td><b>${r.total}</b></td><td>${statusPill(r)}</td></tr>`).join('');
    return `<section class="card"><div class="tool-row"><div><h3 style="margin:0">${esc(c.name)} <span class="mono small">${esc(c.code || '')}</span></h3><p class="small" style="margin:4px 0 0">بانتظار اعتمادك: <b>${pending.length}</b> · معتمدة: <b>${c.rows.length - pending.length}</b></p></div>
        ${pending.length ? `<div class="actions no-print" style="margin:0"><button class="btn pri sm" data-act="fgapprove" data-c="${c.id}">اعتماد العلامات (${pending.length})</button><button class="btn sm" data-act="fgreturn" data-c="${c.id}">إعادة لقسم الامتحانات</button></div>` : ''}</div>
      ${G.open === c.id ? `<form id="fg-return" class="form no-print" style="border:0;padding:0;margin-top:10px" novalidate><label>سبب الإعادة<input id="fg-reason" maxlength="300" required placeholder="مثال: علامة العملي غير مطابقة لكشف المدرّس"></label><div class="actions"><button class="btn pri sm" type="submit">إرسال الإعادة</button><button class="btn sm" type="button" data-act="fgcancel">إلغاء</button></div></form>` : ''}
      ${rows ? `<div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الرقم الجامعي</th><th>الطالب</th><th>النظري</th><th>العملي</th><th>المجموع</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="hint">لم يرسل قسم الامتحانات علامات لهذا المقرر بعد.</p>'}</section>`;
  }
  UA.renderMyGrades = function () {
    if (!G.data) {
      if (!G.loading) { G.loading = true; load().then(() => { G.loading = false; UA.render(); }); }
      return '<div class="empty">جارٍ تحميل علامات موادك…</div>';
    }
    const head = `<section class="card"><h2 style="margin:0">علامات موادي</h2><p class="hint" style="margin:4px 0 0">يرسل قسم الامتحانات سجل العلامات، فتراجعه هنا وتعتمده أو تعيده بسبب. تظهر العلامة للطالب بعد اعتمادها.</p>${G.err ? `<p class="reason">${esc(G.err)}</p>` : ''}</section>`;
    if (!G.data.courses.length) return head + '<section class="card"><p class="hint" style="margin:0">لا مقررات مسندة إلى حسابك. يربط مسؤول الشؤون الأكاديمية حسابك بسجلك في «أعضاء هيئة التدريس» ثم يسند إليك المقررات.</p></section>';
    return head + G.data.courses.map(courseCard).join('');
  };
  const pendingIds = (id) => G.data.courses.find((c) => c.id === Number(id)).rows.filter((r) => r.status === 'reviewed').map((r) => r.id);
  async function send(body, done) {
    try {
      const r = await api('POST', '/api/grades/workflow', body);
      G.open = null; await load(); UA.render();
      toast(r.updated ? done(r.updated) : ((r.skipped[0] && r.skipped[0].reason) || 'لم يتغير شيء'));
    } catch (e) { if (!e.status) throw e; toast(e.message); }
  }
  Object.assign(UA.actions, {
    fgapprove: (el, d) => send({ gradeIds: pendingIds(d.c), stage: 'approved' }, (n) => `اعتُمدت ${n} علامة`),
    fgreturn: async (el, d) => { G.open = Number(d.c); UA.render(); },
    fgcancel: async () => { G.open = null; UA.render(); },
  });
  UA.forms['fg-return'] = () => send({ gradeIds: pendingIds(G.open), stage: 'draft', justification: (document.getElementById('fg-reason')?.value ?? '').trim() }, (n) => `أُعيدت ${n} علامة إلى قسم الامتحانات`);
})();
