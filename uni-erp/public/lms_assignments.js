/* lms_assignments.js — تبويب «الاختبارات والتكليفات» داخل شاشة التعلم الإلكتروني (واجهة عضو الهيئة).
   واجهة الطالب في lms_assignments_student.js. الحماية الفعلية كلها في الخادم. */
'use strict';
(function () {
  const UA = window.UA = window.UA || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS = { draft: ['مسودة', 'p-mut'], scheduled: ['مجدول', 'p-review'], published: ['منشور', 'p-approved'], closed: ['مغلق', 'p-rejected'] };
  const APPROVAL = { approved: ['معتمد', 'p-approved'], pending: ['بانتظار الاعتماد', 'p-review'], rejected: ['مرفوض', 'p-rejected'] };
  const SOLUTION = { submitted: ['تم التسليم', 'p-review'], graded: ['تم التقييم', 'p-approved'], missing: ['لم يسلّم', 'p-mut'] };
  const KIND = { exam: 'اختبار', assignment: 'تكليف' };
  const MODE = { text: 'نص فقط', files: 'ملفات فقط', both: 'نص وملفات' };
  const TYPES = [['pdf', 'PDF'], ['word', 'Word'], ['powerpoint', 'PowerPoint'], ['image', 'صور'], ['zip', 'ZIP']];
  const FILE_ICON = { pdf: '📄', word: '📝', powerpoint: '📊', image: '🖼️', zip: '🗜️', video: '🎬' };
  const ACCEPT = '.pdf,.docx,.pptx,.jpg,.jpeg,.png,.webp,.gif,.zip,.mp4,.webm';

  const when = (t) => { if (!t) return '—'; try { return new Date(t).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };
  const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);
  // حقول datetime-local بتوقيت جهاز المستخدم، والخادم يخزّن لحظة زمنية مطلقة
  const toLocal = (ms) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const fromLocal = (s) => (s ? new Date(s).getTime() : null);
  const pillOf = (map, s) => `<span class="pill ${map[s][1]}">${map[s][0]}</span>`;
  const pill = (s) => pillOf(STATUS, s);
  // رفع الملف لا يمر بطبقة api، فلا يُبطل مؤقت القراءات القصير؛ هذا الوسيط يضمن قراءة حديثة
  const fresh = (url) => `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;

  function videoHtml(a) {
    if (!a.video) return '';
    return `<div style="margin-top:.75rem"><iframe src="${esc(a.video.embed)}" title="فيديو توضيحي" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" style="width:100%;aspect-ratio:16/9;border:0;border-radius:8px"></iframe></div>`;
  }
  const fileLink = (f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener" style="overflow-wrap:anywhere">${FILE_ICON[f.kind] || '📎'} ${esc(f.filename)}</a>`;

  // رفع بشريط تقدّم: fetch لا يوفّر تقدّم الإرسال
  function uploadWithProgress(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let j = null; try { j = JSON.parse(x.responseText); } catch { /* رد غير JSON */ }
        if (x.status >= 200 && x.status < 300) resolve(j); else reject(new Error((j && j.message) || 'تعذّر رفع الملف.'));
      };
      x.onerror = () => reject(new Error('انقطع الاتصال أثناء رفع الملف. تحقق من الشبكة وأعد المحاولة.'));
      x.ontimeout = x.onerror;
      x.send(file);
    });
  }

  function mount(box, deps) {
    const me = UA.S && UA.S.me;
    if (me && me.role === 'student') return UA.lmsAssignmentsStudent.mount(box, deps);
    const { modal, notify, api } = deps;
    let data = null;
    const fail = (e) => notify(e.message || 'حدث خطأ', false);
    const URLS = '/api/lms/assignments';
    // الشاشة قد يعاد رسمها أثناء العمل (تدوير الجوال مثلاً): نكتب في الحاوية الحالية، ونعود إلى الاختبار المفتوح
    const alive = () => { if (!box.isConnected) { const b = document.querySelector('#v12-lms-body'); if (b) box = b; } };
    const resumeId = UA.lmsOpen && me && UA.lmsOpen.uid === me.id ? UA.lmsOpen.id : null;
    const remember = (id) => { UA.lmsOpen = id && me ? { uid: me.id, id } : null; };

    async function load() {
      box.innerHTML = '<div class="v12-card"><p class="hint">جارٍ التحميل…</p></div>';
      try { data = await api('GET', fresh(URLS)); renderList(); }
      catch (e) { box.innerHTML = `<div class="v12-card"><p class="reason">${esc(e.message)}</p></div>`; return false; }
      return true;
    }

    function approvalsHtml() {
      if (!data.canApprove || !data.approvals.length) return '';
      return `<div class="v12-card"><div class="v12-bar"><h3>طلبات النشر الواسع (${data.approvals.length})</h3></div><div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الاختبار</th><th>الجمهور المطلوب</th><th>مقدّم الطلب</th><th></th></tr></thead><tbody>
        ${data.approvals.map((t) => `<tr><td><b>${esc(t.title)}</b></td><td>${esc(t.label)}</td><td>${esc(t.requestedBy)}</td><td style="white-space:nowrap"><button class="btn sm pri as-decide" data-id="${t.id}" data-ok="1">اعتماد</button> <button class="btn sm bad as-decide" data-id="${t.id}">رفض</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    }

    function renderList() {
      alive();
      box.innerHTML = `${approvalsHtml()}${data.canAuthor ? `
        <div class="v12-card">
          <div class="v12-bar"><h3>الاختبارات والتكليفات</h3><button class="btn pri" id="as-new">＋ اختبار أو تكليف جديد</button></div>
          ${data.assignments.length ? `<div class="tbl-wrap"><table class="grid-tbl">
            <thead><tr><th>العنوان</th><th>النوع</th><th>المقرر</th><th>البدء</th><th>آخر موعد</th><th>المرفقات</th><th>الحالة</th><th></th></tr></thead>
            <tbody>${data.assignments.map((a) => `<tr>
              <td><b>${esc(a.title)}</b></td><td>${KIND[a.kind]}</td><td>${esc(a.courseName || '—')}</td><td>${when(a.startsAt)}</td><td>${when(a.dueAt)}</td><td>${a.fileCount}</td><td>${pill(a.status)}</td>
              <td><button class="btn sm as-open" data-id="${a.id}">فتح</button></td></tr>`).join('')}</tbody>
          </table></div>` : '<div class="empty">لم تنشئ اختباراً أو تكليفاً بعد.</div>'}
        </div>` : (data.approvals.length ? '' : '<div class="v12-card"><div class="empty">لا طلبات نشر بانتظار الاعتماد.</div></div>')}`;
      const add = box.querySelector('#as-new');
      if (add) add.onclick = () => openForm(null);
      box.querySelectorAll('.as-open').forEach((b) => { b.onclick = () => openDetail(b.dataset.id); });
      box.querySelectorAll('.as-decide').forEach((b) => {
        b.onclick = async () => {
          try { await api('POST', `${URLS}/targets/${b.dataset.id}/decide`, { approve: !!b.dataset.ok }); notify(b.dataset.ok ? 'اعتُمد النشر' : 'رُفض الطلب'); load(); } catch (e) { fail(e); }
        };
      });
    }

    function formHtml(a) {
      const v = a || { kind: 'assignment', submissionMode: 'both', allowedTypes: TYPES.map((t) => t[0]), maxFileMb: data.limits.studentFileMb, maxFiles: data.limits.studentFiles, maxAttempts: 1, maxScore: 100 };
      const opt = (val, label, cur) => `<option value="${esc(val)}"${String(cur ?? '') === String(val) ? ' selected' : ''}>${esc(label)}</option>`;
      return `
        <label>النوع <select name="kind" data-no-other="1">${Object.entries(KIND).map(([k, l]) => opt(k, l, v.kind)).join('')}</select></label>
        <label>العنوان <input name="title" maxlength="150" required value="${esc(v.title)}"></label>
        <label>المقرر المرتبط (اختياري) <select name="courseId" data-no-other="1">${opt('', 'بدون مقرر', v.courseId)}${data.courses.map((c) => opt(c.id, c.code ? `${c.code} — ${c.name}` : c.name, v.courseId)).join('')}</select></label>
        <label>الدرجة الكاملة <input name="maxScore" type="number" min="0.01" max="1000" step="0.01" required value="${esc(v.maxScore)}"></label>
        <label>تاريخ ووقت البدء <input name="startsAt" type="datetime-local" required value="${toLocal(v.startsAt)}"></label>
        <label>آخر موعد للتسليم <input name="dueAt" type="datetime-local" required value="${toLocal(v.dueAt)}"></label>
        <label style="grid-column:1/-1">الوصف <textarea name="description" rows="3" maxlength="8000">${esc(v.description)}</textarea></label>
        <label style="grid-column:1/-1">تعليمات الحل <textarea name="instructions" rows="3" maxlength="8000">${esc(v.instructions)}</textarea></label>
        <label style="grid-column:1/-1">فيديو توضيحي: رابط YouTube أو Google Drive (اختياري) <input name="videoUrl" dir="ltr" maxlength="500" placeholder="https://" value="${esc(v.video ? v.video.url : '')}"></label>
        <label>نوع الحل المسموح <select name="submissionMode" data-no-other="1">${Object.entries(MODE).map(([k, l]) => opt(k, l, v.submissionMode)).join('')}</select></label>
        <label>عدد مرات التسليم <input name="maxAttempts" type="number" min="1" max="20" required value="${esc(v.maxAttempts)}"></label>
        <label>أقصى حجم للملف (م.ب، حتى ${data.limits.studentFileMb}) <input name="maxFileMb" type="number" min="1" max="${data.limits.studentFileMb}" required value="${esc(v.maxFileMb)}"></label>
        <label>عدد الملفات (حتى ${data.limits.studentFiles}) <input name="maxFiles" type="number" min="1" max="${data.limits.studentFiles}" required value="${esc(v.maxFiles)}"></label>
        <fieldset style="grid-column:1/-1;border:0;padding:0;margin:0"><legend>أنواع الملفات المسموحة</legend>
          ${TYPES.map(([k, l]) => `<label style="display:inline-flex;gap:.3rem;margin-inline-end:1rem;align-items:center"><input type="checkbox" class="as-type" value="${k}"${v.allowedTypes.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}
        </fieldset>
        <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="as-edit"${v.allowEdit ? ' checked' : ''}> السماح بتعديل الحل قبل الموعد</label>
        <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="as-late"${v.allowLate ? ' checked' : ''}> السماح بالتسليم المتأخر</label>
        <label>نهاية التسليم المتأخر (اختياري) <input name="lateUntil" type="datetime-local" value="${toLocal(v.lateUntil)}"></label>`;
    }

    function openForm(a) {
      modal(a ? 'تعديل الاختبار' : 'اختبار أو تكليف جديد', formHtml(a), async (d) => {
        const dlg = document.querySelector('.v12-dlg');
        const body = { ...d, startsAt: fromLocal(d.startsAt), dueAt: fromLocal(d.dueAt), lateUntil: fromLocal(d.lateUntil), maxScore: Number(d.maxScore), maxFileMb: Number(d.maxFileMb), maxFiles: Number(d.maxFiles), maxAttempts: Number(d.maxAttempts),
          allowedTypes: [...dlg.querySelectorAll('.as-type:checked')].map((x) => x.value), allowEdit: dlg.querySelector('#as-edit').checked, allowLate: dlg.querySelector('#as-late').checked };
        const out = a ? await api('PUT', `${URLS}/${a.id}`, body) : await api('POST', URLS, body);
        notify(a ? 'حُفظت التعديلات' : 'أُنشئت المسودة');
        renderDetail(out.assignment);
      });
    }

    async function openDetail(id) {
      try { renderDetail((await api('GET', fresh(`${URLS}/${id}`))).assignment); } catch (e) { remember(null); fail(e); }
    }

    function detailBody(a) {
      const locked = a.status === 'closed';
      const row = (k, val) => `<div><span class="small hint">${k}</span><div><b>${val}</b></div></div>`;
      return `
        <div class="v12-card">
          <div class="v12-bar"><h3>الجمهور المستهدف</h3><span class="small hint">الطلاب المستهدفون الآن: <b>${a.audienceCount}</b></span></div>
          ${a.targets.length ? `<div style="display:flex;flex-wrap:wrap;gap:.5rem">${a.targets.map((t) => `<span style="display:inline-flex;gap:.35rem;align-items:center;border:1px solid var(--border,#DCE3DD);border-radius:8px;padding:.25rem .5rem">${esc(t.label)} ${pillOf(APPROVAL, t.approval)}</span>`).join('')}</div>` : '<p class="hint">لم يُحدد جمهور بعد.</p>'}
          ${locked ? '' : '<button class="btn sm" id="as-audience" style="margin-top:.6rem">تحديد الجمهور</button>'}
        </div>
        <div class="v12-card">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin-bottom:.75rem">
            ${row('النوع', KIND[a.kind])}${row('المقرر', esc(a.courseName || '—'))}${row('البدء', when(a.startsAt))}${row('آخر موعد', when(a.dueAt))}${row('الدرجة الكاملة', esc(a.maxScore))}
            ${row('نوع الحل', MODE[a.submissionMode])}${row('مرات التسليم', a.maxAttempts)}${row('تعديل الحل', a.allowEdit ? 'مسموح' : 'غير مسموح')}${row('التسليم المتأخر', a.allowLate ? (a.lateUntil ? `حتى ${when(a.lateUntil)}` : 'مسموح') : 'ممنوع')}
          </div>
          ${a.description ? `<h4>الوصف</h4><p style="white-space:pre-wrap">${esc(a.description)}</p>` : ''}
          ${a.instructions ? `<h4>تعليمات الحل</h4><p style="white-space:pre-wrap">${esc(a.instructions)}</p>` : ''}
          ${videoHtml(a)}
        </div>
        <div class="v12-card">
          <div class="v12-bar"><h3>المرفقات (${a.files.length})</h3></div>
          ${a.files.length ? a.files.map((f) => `<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.35rem 0;border-bottom:1px solid var(--border,#DCE3DD)">
            <span style="flex:1;min-width:0">${fileLink(f)}</span>
            <span class="small hint">${size(f.size)}</span>${locked ? '' : `<button type="button" class="btn sm bad as-del-file" data-id="${f.id}">حذف</button>`}</div>`).join('') : '<p class="hint">لا مرفقات بعد.</p>'}
          ${locked ? '' : `<div style="margin-top:.75rem">
            <label>إضافة ملفات (PDF، Word، PowerPoint، صور، ZIP حتى ${data.limits.teacherFileMb} م.ب، فيديو حتى ${data.limits.teacherVideoMb} م.ب؛ يُفضَّل رابط خارجي للفيديو الكبير)
              <input type="file" id="as-files" multiple accept="${ACCEPT}"></label>
            <div id="as-progress"></div>
          </div>`}
        </div>`;
    }

    function renderDetail(a, tab = 'details') {
      alive();
      remember(a.id);
      const live = a.status === 'published' || a.status === 'scheduled';
      box.innerHTML = `
        <div class="v12-card">
          <div class="v12-bar" style="flex-wrap:wrap;gap:.5rem">
            <h3>${esc(a.title)} ${pill(a.status)}</h3>
            <span style="display:flex;flex-wrap:wrap;gap:.4rem">
              <button class="btn sm" id="as-back">رجوع للقائمة</button>
              ${a.status === 'draft' ? '<button class="btn sm pri" id="as-publish">نشر</button>' : ''}
              ${live ? '<button class="btn sm" id="as-close">إغلاق</button>' : ''}
              ${a.status === 'closed' ? '<button class="btn sm" id="as-reopen">إعادة فتح</button>' : ''}
              ${a.status === 'closed' ? '' : '<button class="btn sm" id="as-edit-btn">تعديل</button>'}
              <button class="btn sm" id="as-copy">نسخ</button>
              <button class="btn sm bad" id="as-del">حذف</button>
            </span>
          </div>
          <div class="sub-tabs" role="tablist" style="display:flex;gap:.4rem">
            <button class="chip" role="tab" id="as-tab-details" aria-pressed="${tab === 'details'}">التفاصيل</button>
            <button class="chip" role="tab" id="as-tab-solutions" aria-pressed="${tab === 'solutions'}">الحلول</button>
          </div>
        </div>
        <div id="as-tab-body">${tab === 'details' ? detailBody(a) : ''}</div>`;
      const on = (sel, fn) => { const el = box.querySelector(sel); if (el) el.onclick = fn; };
      const act = (path, msg) => async () => {
        try { const out = await api('POST', `${URLS}/${a.id}/${path}`); notify(msg); renderDetail(out.assignment, tab); } catch (e) { fail(e); }
      };
      on('#as-back', () => { remember(null); load(); });
      on('#as-tab-details', () => renderDetail(a, 'details'));
      on('#as-tab-solutions', () => renderDetail(a, 'solutions'));
      on('#as-publish', act('publish', 'نُشر الاختبار'));
      on('#as-close', act('close', 'أُغلق الاختبار'));
      on('#as-reopen', act('reopen', 'أُعيد فتح الاختبار'));
      on('#as-edit-btn', () => openForm(a));
      on('#as-copy', async () => { try { const out = await api('POST', `${URLS}/${a.id}/copy`); notify('أُنشئت نسخة مسودة'); renderDetail(out.assignment); } catch (e) { fail(e); } });
      on('#as-del', async () => {
        if (!window.confirm('حذف هذا الاختبار ومرفقاته نهائياً؟')) return;
        try { await api('DELETE', `${URLS}/${a.id}`); remember(null); notify('حُذف الاختبار'); load(); } catch (e) { fail(e); }
      });
      if (tab === 'solutions') return renderSolutions(a, box.querySelector('#as-tab-body'), { page: 1, q: '', status: '' });
      on('#as-audience', () => openAudience(a));
      box.querySelectorAll('.as-del-file').forEach((b) => {
        b.onclick = async () => {
          if (!window.confirm('حذف هذا المرفق نهائياً؟')) return;
          try { await api('DELETE', `${URLS}/attachments/${b.dataset.id}`); notify('حُذف المرفق'); openDetail(a.id); } catch (e) { fail(e); }
        };
      });
      const input = box.querySelector('#as-files');
      if (input) input.onchange = () => uploadAll(a.id, [...input.files], input);
    }

    async function openAudience(a) {
      let o; try { o = await api('GET', fresh(`${URLS}/${a.id}/target-options`)); } catch (e) { return fail(e); }
      const has = (type, id) => a.targets.some((t) => t.type === type && (type === 'all' || t.refId === id));
      const box2 = (type, id, label) => `<label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" class="as-target" data-type="${type}" data-id="${id ?? ''}"${has(type, id) ? ' checked' : ''}> ${esc(label)}</label>`;
      const section = (title, html) => `<fieldset style="grid-column:1/-1;border:0;padding:0;margin:0"><legend><b>${title}</b></legend>${html || '<p class="small hint">لا خيارات متاحة.</p>'}</fieldset>`;
      modal('تحديد الجمهور المستهدف', `
        ${o.canApprove ? '' : '<p class="small hint" style="grid-column:1/-1">النشر على مستوى الكلية أو المعهد أو الجامعة يحتاج اعتماداً إدارياً، ويبقى معلّقاً حتى يُعتمد.</p>'}
        ${section('الفئات والشعب', o.groups.map((g) => box2('group', g.id, `${g.name} (${g.members} طالب)${g.needsApproval ? ' — يحتاج اعتماداً' : ''}`)).join(''))}
        ${section('البرامج والأقسام', o.programs.map((p) => box2('program', p.id, p.name)).join(''))}
        ${section('الكليات والمعاهد', o.faculties.map((f) => box2('faculty', f.id, f.name)).join(''))}
        ${section('الجامعة', box2('all', null, 'الجامعة كلها'))}`, async () => {
        const targets = [...document.querySelectorAll('.v12-dlg .as-target:checked')].map((x) => (x.dataset.type === 'all' ? { type: 'all' } : { type: x.dataset.type, id: Number(x.dataset.id) }));
        const out = await api('PUT', `${URLS}/${a.id}/targets`, { targets });
        notify('حُفظ الجمهور');
        renderDetail(out.assignment);
      });
    }

    async function uploadAll(id, files, input) {
      const area = box.querySelector('#as-progress'), failed = [];
      input.disabled = true;
      for (const f of files) {
        area.innerHTML = `<div class="small" style="margin-top:.4rem">${esc(f.name)}</div><progress max="1" value="0" style="width:100%" aria-label="تقدّم رفع الملف"></progress>`;
        const bar = area.querySelector('progress');
        try { await uploadWithProgress(`${URLS}/${id}/attachments?name=${encodeURIComponent(f.name)}`, f, (p) => { bar.value = p; }); }
        catch (e) { failed.push(`${f.name}: ${e.message}`); }
      }
      notify(failed.length ? `تعذّر رفع: ${failed.join('؛ ')}` : 'رُفعت المرفقات', !failed.length);
      openDetail(id);
    }

    async function renderSolutions(a, host, q) {
      host.innerHTML = '<div class="v12-card"><p class="hint">جارٍ التحميل…</p></div>';
      let d;
      try { d = await api('GET', fresh(`${URLS}/${a.id}/submissions?page=${q.page}&q=${encodeURIComponent(q.q)}&status=${q.status}`)); }
      catch (e) { host.innerHTML = `<div class="v12-card"><p class="reason">${esc(e.message)}</p></div>`; return; }
      const pages = Math.max(1, Math.ceil(d.total / d.size)), kpi = (l, v) => `<div class="v12-kpi"><span>${l}</span><strong>${v}</strong></div>`;
      host.innerHTML = `
        <div class="v12-kpis">${kpi('المستهدفون', d.stats.targeted)}${kpi('سلّموا', d.stats.submitted)}${kpi('متأخرون', d.stats.late)}${kpi('لم يسلّموا', d.stats.missing)}${kpi('تم تقييمهم', d.stats.graded)}</div>
        <div class="v12-card">
          <div class="v12-bar" style="flex-wrap:wrap;gap:.5rem">
            <span style="display:flex;flex-wrap:wrap;gap:.4rem;flex:1">
              <input id="as-q" type="search" placeholder="بحث بالاسم أو الرقم الجامعي" value="${esc(q.q)}" style="flex:1;min-width:150px">
              <select id="as-status" data-no-other="1">${[['', 'كل الحالات'], ['submitted', 'تم التسليم'], ['graded', 'تم التقييم'], ['late', 'متأخر'], ['missing', 'لم يسلّم']].map(([v, l]) => `<option value="${v}"${q.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
            </span>
            <span style="display:flex;flex-wrap:wrap;gap:.4rem">
              <a class="btn sm" href="${URLS}/${a.id}/submissions.zip">تنزيل كل الحلول ZIP</a>
              <a class="btn sm" href="${URLS}/${a.id}/grades.csv?tzo=${new Date().getTimezoneOffset()}">تصدير الدرجات CSV</a>
            </span>
          </div>
          ${d.rows.length ? `<div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الرقم</th><th>الطالب</th><th>وقت التسليم</th><th>الحالة</th><th>الملفات</th><th>الدرجة</th><th></th></tr></thead><tbody>
            ${d.rows.map((r) => `<tr><td class="mono">${esc(r.studentNo)}</td><td><b>${esc(r.name)}</b></td><td>${when(r.submittedAt)}</td><td>${pillOf(SOLUTION, r.status)}${r.isLate ? ' <span class="pill p-rejected">متأخر</span>' : ''}</td><td>${r.fileCount}</td><td>${r.score === null ? '—' : `${esc(r.score)} / ${esc(d.maxScore)}`}</td><td>${r.submissionId ? `<button class="btn sm as-grade" data-id="${r.submissionId}">فتح وتقييم</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">لا نتائج.</div>'}
          <div style="display:flex;gap:.5rem;align-items:center;justify-content:center;margin-top:.6rem">
            <button class="btn sm" id="as-prev"${q.page <= 1 ? ' disabled' : ''}>السابق</button><span class="small">${q.page} / ${pages}</span><button class="btn sm" id="as-next"${q.page >= pages ? ' disabled' : ''}>التالي</button>
          </div>
        </div>`;
      const again = (o) => renderSolutions(a, host, { ...q, ...o });
      host.querySelector('#as-prev').onclick = () => again({ page: q.page - 1 });
      host.querySelector('#as-next').onclick = () => again({ page: q.page + 1 });
      host.querySelector('#as-status').onchange = (e) => again({ status: e.target.value, page: 1 });
      host.querySelector('#as-q').onkeydown = (e) => { if (e.key === 'Enter') again({ q: e.target.value.trim(), page: 1 }); };
      host.querySelectorAll('.as-grade').forEach((b) => { b.onclick = () => openGrade(b.dataset.id, () => renderSolutions(a, host, q)); });
    }

    async function openGrade(id, done) {
      let s; try { s = await api('GET', fresh(`${URLS}/submissions/${id}`)); } catch (e) { return fail(e); }
      const full = 'grid-column:1/-1';
      modal(`حل ${s.name}`, `
        <p style="${full}" class="small hint">الرقم الجامعي: ${esc(s.studentNo)} · المحاولة ${s.attemptNo} · ${when(s.submittedAt)}${s.isLate ? ' · متأخر' : ''}</p>
        ${s.text ? `<div style="${full}"><b>نص الحل</b><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(s.text)}</p></div>` : ''}
        ${s.files.length ? `<div style="${full}"><b>ملفات الحل</b>${s.files.map((f) => `<div>${fileLink(f)} <span class="small hint">${size(f.size)}</span></div>`).join('')}</div>` : ''}
        <label>الدرجة (من ${esc(s.maxScore)}) <input name="score" type="number" min="0" max="${esc(s.maxScore)}" step="0.01" required value="${s.score === null ? '' : esc(s.score)}"></label>
        <label style="${full}">ملاحظات للطالب <textarea name="feedback" rows="3" maxlength="4000">${esc(s.feedback)}</textarea></label>
        ${s.feedbackFiles.length ? `<div style="${full}"><b>ملفات التصحيح</b>${s.feedbackFiles.map((f) => `<div>${fileLink(f)}</div>`).join('')}</div>` : ''}
        <label style="${full}">إرفاق ملف تصحيح (اختياري) <input type="file" id="as-feedback-file" accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png,.webp,.zip"></label>`, async (d) => {
        await api('POST', `${URLS}/submissions/${id}/grade`, { score: Number(d.score), feedback: d.feedback });
        const file = document.getElementById('as-feedback-file').files[0];
        if (file) await uploadWithProgress(`${URLS}/submissions/${id}/feedback-file?name=${encodeURIComponent(file.name)}`, file);
        notify('رُصدت الدرجة');
        done();
      });
    }

    load().then((ok) => {
      const deep = UA.lmsDeepLink;
      UA.lmsDeepLink = null;
      const target = deep && deep.id ? deep.id : resumeId;
      if (ok && target) openDetail(target);
    });
  }

  UA.lmsAssignments = { mount, uploadWithProgress, util: { esc, when, size, fresh, videoHtml, fileLink, ACCEPT, KIND, MODE, FILE_ICON } };
})();
