/* lms_assignments_student.js — واجهة الطالب: اختباراته المتاحة، وتسليم الحل برفع ملفات مع شريط تقدّم، ودرجته وملاحظات المدرّس. */
'use strict';
(function () {
  const UA = window.UA = window.UA || {};
  const STATE = { new: ['جديد', 'p-review'], submitted: ['تم التسليم', 'p-approved'], graded: ['تم التقييم', 'p-approved'], late: ['متأخر', 'p-rejected'], closed: ['مغلق', 'p-mut'] };
  const OFFLINE = 'انقطع الاتصال بالإنترنت، ولم يصل حلك إلى الخادم. لا تغلق الصفحة، وأعد الإرسال بعد عودة الاتصال.';
  const URLS = '/api/lms/assignments';

  function remaining(dueAt, serverNow) {
    const ms = dueAt - serverNow;
    if (ms <= 0) return 'انتهى الموعد';
    const days = Math.floor(ms / 86400000), hours = Math.floor(ms / 3600000) % 24, mins = Math.floor(ms / 60000) % 60;
    if (days) return `متبقٍ ${days} يوم و${hours} ساعة`;
    return hours ? `متبقٍ ${hours} ساعة و${mins} دقيقة` : `متبقٍ ${Math.max(mins, 1)} دقيقة`;
  }

  function mount(box, { notify, api }) {
    const { esc, when, size, fresh, videoHtml, fileLink, ACCEPT, KIND, MODE } = UA.lmsAssignments.util;
    const pill = (s) => `<span class="pill ${STATE[s][1]}">${STATE[s][0]}</span>`;
    // فشل fetch نفسه يعني أن الطلب لم يصل، بخلاف رد الخادم برفض
    const message = (e) => ((!navigator.onLine || e instanceof TypeError) ? OFFLINE : e.message || 'حدث خطأ');
    // إعادة رسم الشاشة (تدوير الجوال مثلاً) لا تُفقد الطالب مكانه ولا ما كتبه
    const me = UA.S.me, typed = (UA.lmsTyped ??= {});
    const alive = () => { if (!box.isConnected) { const b = document.querySelector('#v12-lms-body'); if (b) box = b; } };
    const resumeId = UA.lmsOpen && UA.lmsOpen.uid === me.id ? UA.lmsOpen.id : null;
    const remember = (id) => { UA.lmsOpen = id ? { uid: me.id, id } : null; };

    async function load() {
      alive();
      remember(null);
      box.innerHTML = '<div class="v12-card"><p class="hint">جارٍ التحميل…</p></div>';
      let d;
      try { d = await api('GET', fresh(`${URLS}/mine`)); }
      catch (e) { box.innerHTML = `<div class="v12-card"><p class="reason">${esc(message(e))}</p></div>`; return; }
      box.innerHTML = `<div class="v12-card"><div class="v12-bar"><h3>اختباراتي وتكليفاتي</h3></div>
        ${d.assignments.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.75rem">${d.assignments.map((a) => `
          <article style="border:1px solid var(--border,#DCE3DD);border-radius:10px;padding:.75rem;display:flex;flex-direction:column;gap:.35rem">
            <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:start"><b style="overflow-wrap:anywhere">${esc(a.title)}</b>${pill(a.state)}</div>
            <div class="small hint">${KIND[a.kind]}${a.courseName ? ` · ${esc(a.courseName)}` : ''}</div>
            <div class="small">آخر موعد: ${when(a.dueAt)}</div>
            <div class="small hint">${a.state === 'graded' ? `الدرجة: <b>${esc(a.score)}</b> من ${esc(a.maxScore)}` : remaining(a.dueAt, d.serverNow)}</div>
            <button class="btn sm as-open" data-id="${a.id}" style="align-self:flex-start">فتح</button>
          </article>`).join('')}</div>` : '<div class="empty">لا توجد اختبارات أو تكليفات متاحة لك حالياً.</div>'}</div>`;
      box.querySelectorAll('.as-open').forEach((b) => { b.onclick = () => open(b.dataset.id); });
    }

    async function open(id, banner) {
      try { render(await api('GET', fresh(`${URLS}/${id}/submission`)), banner); }
      catch (e) { notify(message(e), false); if (!box.querySelector('.v12-card')) load(); }
    }

    function resultHtml(s, maxScore) {
      return `<div style="border-top:1px solid var(--border,#DCE3DD);padding:.6rem 0">
        <div class="small hint">المحاولة ${s.attemptNo} · ${when(s.submittedAt)}${s.isLate ? ' · <b>متأخر</b>' : ''}</div>
        ${s.text ? `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(s.text)}</p>` : ''}
        ${s.files.map((f) => `<div>${fileLink(f)} <span class="small hint">${size(f.size)}</span></div>`).join('')}
        ${s.status === 'graded' ? `<div style="margin-top:.5rem;padding:.6rem;border-radius:8px;background:var(--bg-soft,#F2F6F3)">
          <div>الدرجة: <b style="font-size:1.15em">${esc(s.score)}</b> من ${esc(maxScore)}</div>
          ${s.feedback ? `<p style="white-space:pre-wrap;margin:.35rem 0 0"><b>ملاحظات المدرّس:</b> ${esc(s.feedback)}</p>` : ''}
          ${s.feedbackFiles.map((f) => `<div>${fileLink(f)}</div>`).join('')}</div>` : '<div class="small hint" style="margin-top:.35rem">بانتظار التقييم.</div>'}
      </div>`;
    }

    function formHtml(d) {
      const a = d.assignment, w = d.work, editing = w.mode === 'edit';
      return `<div class="v12-card">
        <div class="v12-bar"><h3>${editing ? 'تعديل الحل' : 'إرسال الحل'}</h3><span class="small hint">${d.window === 'late' ? 'تسليم متأخر' : remaining(a.dueAt, d.serverNow)}</span></div>
        <div id="as-net" role="alert" class="reason" hidden></div>
        ${a.submissionMode !== 'files' ? `<label>نص الحل <textarea id="as-text" rows="6" maxlength="20000">${esc(w.text)}</textarea></label>` : ''}
        ${a.submissionMode !== 'text' ? `
          <div id="as-file-list" style="margin:.5rem 0">${w.files.map((f) => `<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.25rem 0"><span style="flex:1;min-width:0">${fileLink(f)}</span><span class="small hint">${size(f.size)}</span><button type="button" class="btn sm bad as-del" data-id="${f.id}">حذف</button></div>`).join('')}</div>
          <label>إرفاق ملفات (حتى ${a.maxFiles}، وكل ملف حتى ${a.maxFileMb} م.ب) <input type="file" id="as-files" multiple accept="${ACCEPT}"></label>
          <div id="as-progress"></div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem">
          <button class="btn pri" id="as-send">${editing ? 'حفظ التعديل' : 'إرسال الحل'}</button>
          ${editing ? '' : '<button class="btn" id="as-save">حفظ مسودة</button>'}
        </div>
      </div>`;
    }

    function render(d, banner) {
      alive();
      const a = d.assignment, id = a.id;
      remember(id);
      const closedNote = !d.work && d.window !== 'pending' ? `<div class="v12-card"><p class="hint">${d.window === 'open' || d.window === 'late' ? 'استنفدت عدد مرات التسليم المسموحة.' : 'انتهى موعد التسليم، ولا يمكن إرسال حل جديد.'}</p></div>` : '';
      box.innerHTML = `
        ${banner ? `<div class="v12-card" role="status" style="border-inline-start:4px solid #0d3b2e"><b>${esc(banner)}</b></div>` : ''}
        <div class="v12-card">
          <div class="v12-bar" style="flex-wrap:wrap;gap:.5rem"><h3 style="overflow-wrap:anywhere">${esc(a.title)} ${pill(d.state)}</h3><button class="btn sm" id="as-back">رجوع للقائمة</button></div>
          <div class="small hint">${KIND[a.kind]}${a.courseName ? ` · ${esc(a.courseName)}` : ''} · الدرجة الكاملة ${esc(a.maxScore)} · نوع الحل: ${MODE[a.submissionMode]} · المحاولات ${d.attemptsUsed} من ${a.maxAttempts}</div>
          <div class="small" style="margin-top:.25rem">البدء: ${when(a.startsAt)} · آخر موعد: <b>${when(a.dueAt)}</b>${a.allowLate ? ` · التأخر مسموح${a.lateUntil ? ` حتى ${when(a.lateUntil)}` : ''}` : ''}</div>
          ${a.description ? `<h4>الوصف</h4><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(a.description)}</p>` : ''}
          ${a.instructions ? `<h4>تعليمات الحل</h4><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(a.instructions)}</p>` : ''}
          ${videoHtml(a)}
          ${a.files.length ? `<h4>المرفقات</h4>${a.files.map((f) => `<div style="padding:.2rem 0">${fileLink(f)} <span class="small hint">${size(f.size)}</span></div>`).join('')}` : ''}
        </div>
        ${d.work ? formHtml(d) : closedNote}
        ${d.submissions.length ? `<div class="v12-card"><div class="v12-bar"><h3>ما سلّمته</h3></div>${d.submissions.map((s) => resultHtml(s, a.maxScore)).join('')}</div>` : ''}`;
      box.querySelector('#as-back').onclick = load;
      if (!d.work) return;
      const net = box.querySelector('#as-net'), textEl = box.querySelector('#as-text'), input = box.querySelector('#as-files');
      const showNet = (m) => { net.textContent = m; net.hidden = !m; };
      if (textEl) { if (typed[id] !== undefined) textEl.value = typed[id]; textEl.oninput = () => { typed[id] = textEl.value; }; }
      const textValue = () => (textEl ? textEl.value : '');
      // يُحفظ النص قبل إعادة الرسم، وإلا ضاع ما كتبه الطالب عند إضافة ملف
      const persist = async () => { if (textEl && d.work.mode !== 'edit') await api('PUT', `${URLS}/${id}/submission`, { text: textValue() }); };
      if (input) input.onchange = async () => {
        const area = box.querySelector('#as-progress'), failed = [];
        input.disabled = true;
        for (const f of [...input.files]) {
          area.innerHTML = `<div class="small" style="margin-top:.4rem">${esc(f.name)}</div><progress max="1" value="0" style="width:100%" aria-label="تقدّم رفع الملف"></progress>`;
          const bar = area.querySelector('progress');
          try { await UA.lmsAssignments.uploadWithProgress(`${URLS}/${id}/submission/files?name=${encodeURIComponent(f.name)}`, f, (p) => { bar.value = p; }); }
          catch (e) { failed.push(`${f.name}: ${e.message}`); }
        }
        area.innerHTML = ''; input.disabled = false; input.value = '';
        if (failed.length) { showNet(`تعذّر رفع: ${failed.join('؛ ')}`); if (!navigator.onLine) return; }
        const kept = textValue();
        try { await persist(); const fresher = await api('GET', fresh(`${URLS}/${id}/submission`)); render(fresher); const t = box.querySelector('#as-text'); if (t && d.work.mode === 'edit') t.value = kept; if (failed.length) { const n = box.querySelector('#as-net'); n.textContent = `تعذّر رفع: ${failed.join('؛ ')}`; n.hidden = false; } }
        catch (e) { showNet(message(e)); }
      };
      box.querySelectorAll('.as-del').forEach((b) => {
        b.onclick = async () => {
          const kept = textValue();
          try { await api('DELETE', `${URLS}/${id}/submission/files/${b.dataset.id}`); await persist(); const fresher = await api('GET', fresh(`${URLS}/${id}/submission`)); render(fresher); const t = box.querySelector('#as-text'); if (t) t.value = kept; }
          catch (e) { showNet(message(e)); }
        };
      });
      const save = box.querySelector('#as-save');
      if (save) save.onclick = async () => {
        try { await persist(); showNet(''); notify('حُفظت المسودة'); } catch (e) { showNet(message(e)); }
      };
      box.querySelector('#as-send').onclick = async (e) => {
        const btn = e.currentTarget;
        if (!navigator.onLine) return showNet(OFFLINE);
        btn.disabled = true; showNet('');
        try {
          const r = await api('POST', `${URLS}/${id}/submission/submit`, { text: textValue() });
          delete typed[id];
          notify(r.edited ? 'حُفظ تعديل الحل' : 'تم إرسال الحل');
          open(id, r.edited ? 'حُفظ تعديل حلك بنجاح.' : r.isLate ? 'تم استلام حلك كتسليم متأخر.' : 'تم استلام حلك بنجاح.');
        } catch (err) { btn.disabled = false; showNet(message(err)); }
      };
    }

    const deep = UA.lmsDeepLink;
    UA.lmsDeepLink = null;
    const target = deep && deep.id ? deep.id : resumeId;
    if (target) open(target); else load();
  }

  UA.lmsAssignmentsStudent = { mount };
})();
