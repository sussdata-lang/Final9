/* v12_views.js — واجهات الإصدار 12 الشامل لمنظومة Uni-ERP الجامعية:
   1) الوحدات 5.12 (التعلم الإلكتروني والمكتبة)، 5.13 (البحث العلمي والدراسات العليا)، 5.14 (الخريجون والتوظيف)، 5.15 (الجودة والاعتماد)
   2) توسعات الوحدات 5.5 (جداول الامتحانات والتظلمات)، 5.6 (الساعات المكتبية والترقيات)، 5.7 (السكن الجامعي والمنح والأنشطة)، 5.8 (تقييم الأداء والتدريب والبصمة)
   3) البنية التحتية والتوسع (Scalability & DevOps: PostgreSQL 16 DDL, Redis Cluster, SSO/LDAP)
   4) الذكاء الاصطناعي الجامعي (AI Early Warning, AI Academic Advisor, AI Correspondence Triage) */
'use strict';
(function () {
  if (!window.UA) return;
  const UA = window.UA;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Number(n) || 0).toLocaleString('en-US');
  // خيارات القوائم التي يديرها المدير من الإعدادات العامة
  const managedOptions = (key) => (((UA.S && UA.S.limits && UA.S.limits.dropdowns) || {})[key] || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');

  async function api(method, url, body) {
    if (UA.api) return UA.api(method, url, body);
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || r.statusText);
    return j;
  }

  function notify(msg, ok = true) {
    if (UA.toast) return UA.toast(msg, ok ? 'ok' : 'err');
    let t = document.getElementById('v12-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'v12-toast';
      t.style.cssText = 'position:fixed;bottom:1.2rem;inset-inline-end:1.2rem;padding:.75rem 1.2rem;border-radius:10px;color:#fff;font-weight:700;z-index:9999;box-shadow:0 10px 25px rgba(0,0,0,.2)';
      document.body.appendChild(t);
    }
    t.style.background = ok ? '#0f5132' : '#B3261E';
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._tm);
    t._tm = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }

  const SHARED_CSS = `
    <style>
      .v12-wrap { }
      .v12-hero { background: linear-gradient(135deg, #0d3b2e 0%, #0E4D2E 60%, #1e3a2f 100%); color: #fff; border-radius: 16px; padding: 1.4rem 1.6rem; margin-bottom: 1.2rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; box-shadow: 0 8px 24px rgba(13,59,46,.15); }
      .v12-hero h1 { margin: 0 0 .35rem 0; font-size: 1.35rem; color: #fff; }
      .v12-hero p { margin: 0; opacity: .88; font-size: .9rem; max-width: 680px; }
      .v12-badge-gold { background: rgba(212,175,55,.22); border: 1px solid rgba(212,175,55,.55); color: #E6CB84; padding: .25rem .7rem; border-radius: 999px; font-size: .78rem; font-weight: 700; display: inline-block; margin-bottom: .4rem; }
      .v12-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: .85rem; margin-bottom: 1.2rem; }
      .v12-kpi { background: var(--card-bg, #fff); border: 1px solid var(--border, #DCE3DD); border-radius: 12px; padding: 1rem 1.1rem; box-shadow: 0 2px 6px rgba(0,0,0,.03); }
      .v12-kpi span { display: block; font-size: .8rem; color: var(--muted, #566660); margin-bottom: .3rem; }
      .v12-kpi strong { font-size: 1.45rem; color: var(--text, #10211D); font-weight: 800; }
      .v12-tabs { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1.1rem; border-bottom: 1px solid var(--border, #DCE3DD); padding-bottom: .65rem; }
      .v12-tab { padding: .55rem 1rem; border-radius: 10px; border: 1px solid var(--border, #DCE3DD); background: var(--card-bg, #fff); color: var(--text, #10211D); font-weight: 700; font-size: .86rem; cursor: pointer; transition: all .15s; }
      .v12-tab.active { background: #0d3b2e; color: #fff; border-color: #0d3b2e; box-shadow: 0 4px 12px rgba(13,59,46,.2); }
      .v12-card { background: var(--card-bg, #fff); border: 1px solid var(--border, #DCE3DD); border-radius: 14px; padding: 1.2rem; margin-bottom: 1rem; }
      .v12-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: .75rem; margin-bottom: 1rem; }
      .v12-bar h3 { margin: 0; font-size: 1.05rem; }
      .v12-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
      @media (max-width: 780px) { .v12-grid2 { grid-template-columns: 1fr; } }
      .v12-dlg { border: none; border-radius: 16px; padding: 1.5rem; max-width: 600px; width: 94vw; box-shadow: 0 20px 50px rgba(0,0,0,.25); }
      .v12-dlg::backdrop { background: rgba(15,23,42,.55); }
      .v12-dlg h3 { margin-top: 0; margin-bottom: 1rem; color: #0d3b2e; }
      .v12-dlg label { display: block; margin-bottom: .75rem; font-size: .85rem; font-weight: 700; }
      .v12-dlg input, .v12-dlg select, .v12-dlg textarea { width: 100%; padding: .55rem .75rem; border-radius: 8px; border: 1px solid #DCE3DD; margin-top: .25rem; font-family: inherit; font-size: .9rem; box-sizing: border-box; }
      .v12-prog { height: 8px; background: #DCE3DD; border-radius: 999px; overflow: hidden; margin-top: 6px; }
      .v12-prog > div { height: 100%; background: linear-gradient(90deg, #1B7F4B, #059669); border-radius: 999px; }
      .v12-viewer { max-width: 1100px; }
      .v12-slide { position: relative; width: 100%; overflow: hidden; border: 1px solid #DCE3DD; border-radius: 8px; container-type: inline-size; color: #10211D; }
      .v12-slide > * { position: absolute; box-sizing: border-box; }
      .v12-slide p { margin: 0 0 .25em; }
      .v12-code { background: #10211D; color: #DCE3DD; padding: 1rem; border-radius: 10px; font-family: monospace; font-size: .8rem; direction: ltr; text-align: left; max-height: 360px; overflow: auto; white-space: pre; }
    </style>
  `;

  function openModal(title, fieldsHtml, onSubmit) {
    const dlg = document.createElement('dialog');
    dlg.className = 'v12-dlg';
    dlg.innerHTML = `
      <h3>${esc(title)}</h3>
      <form id="v12-modal-form" class="uf bare">
        <div class="uf-grid">${fieldsHtml}</div>
        <div class="uf-actions">
          <button type="submit" class="btn pri">حفظ واعتماد</button>
          <button type="button" class="btn" id="v12-dlg-cancel">إلغاء</button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);
    // الطالب يقدّم باسمه: الخادم يعتمد هويته مهما أُرسل، فلا نعرض له قيماً نموذجية لغيره
    const me = UA.S && UA.S.me;
    if (me && me.role === 'student') {
      const own = { student_no: me.studentNo, student_name: me.name, applicant_name: me.name };
      for (const [name, value] of Object.entries(own)) {
        const input = dlg.querySelector(`[name="${name}"]`);
        if (input) { input.value = value || ''; input.readOnly = true; }
      }
    }
    dlg.showModal();
    dlg.querySelector('#v12-dlg-cancel').onclick = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#v12-modal-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      try {
        await onSubmit(data);
        dlg.close();
        dlg.remove();
      } catch (err) {
        notify(err.message || 'حدث خطأ', false);
      }
    };
  }

  /* ============================================================================
     1. وحدة 5.12: التعلم الإلكتروني والمكتبة الرقمية (LMS & Digital Library)
     ============================================================================ */
  /* ---------- عرض مرفقات المحاضرة داخل الصفحة ---------- */
  const FILE_KIND = { pdf: ['📄', 'قراءة'], video: ['🎬', 'مشاهدة'], slides: ['📊', 'عرض الشرائح'] };
  const emu = (v, whole) => `${(Number(v) / whole) * 100}%`;
  function slideHtml(deck, fileId, i) {
    const s = deck.slides[i], widthPt = deck.width / 12700;
    const item = (it) => {
      const place = `right:auto;left:${emu(it.x, deck.width)};top:${emu(it.y, deck.height)};width:${emu(it.w, deck.width)};height:${emu(it.h, deck.height)}`;
      if (it.type === 'image') return `<img alt="" src="/api/lms/files/${fileId}/media/${encodeURIComponent(it.media)}" style="${place};object-fit:contain">`;
      const paras = it.paragraphs.map((p) => `<p dir="auto" style="text-align:${{ ctr: 'center', r: 'right', l: 'left', just: 'justify' }[p.align] || 'start'};margin-inline-start:${p.level * 1.2}em">${p.runs.map((r) => {
        const pt = r.size ? r.size / 100 : (it.title ? 32 : 18);
        return `<span style="font-size:calc(${pt} * 100cqw / ${widthPt});${r.bold || it.title ? 'font-weight:700;' : ''}${r.color ? `color:#${r.color};` : ''}">${esc(r.text)}</span>`;
      }).join('')}</p>`).join('');
      return `<div style="${place}">${paras}</div>`;
    };
    return `<div class="v12-slide" style="aspect-ratio:${deck.width}/${deck.height};background:${s.bg ? `#${s.bg}` : '#fff'}">${s.items.map(item).join('')}</div>
      <div style="display:flex;justify-content:center;align-items:center;gap:.75rem;margin-top:.75rem">
        <button type="button" class="btn sm" data-slide="-1"${i === 0 ? ' disabled' : ''}>السابقة</button>
        <b>${i + 1} / ${deck.slides.length}</b>
        <button type="button" class="btn sm" data-slide="1"${i === deck.slides.length - 1 ? ' disabled' : ''}>التالية</button>
      </div>`;
  }
  function openLectureFile(file) {
    const dlg = document.createElement('dialog');
    dlg.className = 'v12-dlg v12-viewer';
    dlg.innerHTML = `<div class="v12-bar"><h3 style="margin:0">${esc(file.filename)}</h3><span style="display:flex;gap:.5rem"><a class="btn sm" href="/api/lms/files/${file.id}" download="${esc(file.filename)}">تنزيل</a><button type="button" class="btn sm" id="v12-view-close">إغلاق</button></span></div><div id="v12-view-body"></div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#v12-view-close').onclick = close;
    dlg.addEventListener('cancel', () => dlg.remove());
    const body = dlg.querySelector('#v12-view-body');
    if (file.kind === 'pdf') body.innerHTML = `<iframe title="${esc(file.filename)}" src="/api/lms/files/${file.id}" style="width:100%;height:75vh;border:1px solid #DCE3DD;border-radius:8px"></iframe>`;
    else if (file.kind === 'video') body.innerHTML = `<video controls preload="metadata" src="/api/lms/files/${file.id}" style="width:100%;max-height:75vh;border-radius:8px;background:#000"></video>`;
    else {
      body.innerHTML = '<p class="hint">جارٍ تحميل الشرائح…</p>';
      api('GET', `/api/lms/files/${file.id}/slides`).then((deck) => {
        let i = 0;
        const draw = () => { body.innerHTML = slideHtml(deck, file.id, i); };
        const step = (n) => { const next = i + n; if (next >= 0 && next < deck.slides.length) { i = next; draw(); } };
        body.addEventListener('click', (e) => { const b = e.target.closest('[data-slide]'); if (b) step(Number(b.dataset.slide)); });
        dlg.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') step(1); else if (e.key === 'ArrowRight') step(-1); });
        draw();
      }).catch((e) => { body.innerHTML = `<p class="reason">${esc(e.message)}</p>`; });
    }
  }
  async function uploadLectureFiles(lectureId, files) {
    const failed = [];
    for (const f of files) {
      try { await UA.upload(`/api/lms/lectures/${lectureId}/files?name=${encodeURIComponent(f.name)}`, f); }
      catch (e) { failed.push(`${f.name}: ${e.message}`); }
    }
    return failed;
  }

  UA.v12Modal = (...a) => openModal(...a);
  UA.views.lms = async function (el, _me, only) {
    let activeTab = only || (UA.gate ? UA.gate.firstTab('lms', 'lectures') : 'lectures');
    if (!only && activeTab === 'library') activeTab = 'lectures';
    if (!only && (UA.lmsDeepLink || UA.lmsKeepTab)) activeTab = 'assignments';   // فتح اختبار من إشعار، أو البقاء في التبويب بعد إعادة الرسم
    let bookQ = '';
    async function render() {
      el.innerHTML = `${SHARED_CSS}<div class="v12-wrap"><p class="hint">جارٍ تحميل بوابة التعلم الإلكتروني والمكتبة الرقمية…</p></div>`;
      const d = await api('GET', '/api/lms/overview' + (activeTab === 'library' ? `?section=library${bookQ ? '&bookQ=' + encodeURIComponent(bookQ) : ''}` : ''));
      const s = d.stats;
      el.innerHTML = `
        ${SHARED_CSS}
        <div class="v12-wrap">
          <div class="v12-hero">
            <div>
              <span class="v12-badge-gold">الوحدة 5.12</span>
              <h1>التعلم الإلكتروني (LMS)</h1>
              <p>منصة المحاضرات التفاعلية، بنوك الأسئلة والاختبارات الذاتية، وفهرس المكتبة الرقمية ونظام الإعارة المركزية.</p>
            </div>
          </div>
          <div class="v12-kpis">
            <div class="v12-kpi"><span>المحاضرات والمواد الرقمية</span><strong>${fmt(s.lecturesCount)}</strong></div>
            <div class="v12-kpi"><span>الاختبارات الإلكترونية</span><strong>${fmt(s.quizzesCount)}</strong></div>
            <div class="v12-kpi"><span>إجمالي نسخ الكتب</span><strong>${fmt(s.booksCount)}</strong></div>
            <div class="v12-kpi"><span>النسخ المتاحة للإعارة</span><strong>${fmt(s.availableBooks)}</strong></div>
            <div class="v12-kpi"><span>الإعارات الجارية</span><strong>${fmt(s.activeLoans)}</strong></div>
          </div>
          <div class="v12-tabs">
            <button class="v12-tab ${activeTab === 'lectures' ? 'active' : ''}" data-t="lectures">📚 المحاضرات والمحتوى الرقمي</button>
            <button class="v12-tab ${activeTab === 'quizzes' ? 'active' : ''}" data-t="quizzes">📝 بنك الأسئلة والاختبارات</button>
            <button class="v12-tab ${activeTab === 'assignments' ? 'active' : ''}" data-t="assignments">🗂️ الاختبارات والتكليفات</button>
          </div>
          <div id="v12-lms-body"></div>
        </div>
      `;
      if (only) el.querySelectorAll('.v12-hero,.v12-kpis,.v12-tabs').forEach((x) => x.remove());
      el.querySelectorAll('.v12-tab').forEach((b) => {
        b.onclick = () => { activeTab = b.dataset.t; renderBody(d); el.querySelectorAll('.v12-tab').forEach((x) => x.classList.toggle('active', x.dataset.t === activeTab)); };
      });
      renderBody(d);
    }

    function renderBody(d) {
      const box = el.querySelector('#v12-lms-body');
      UA.lmsKeepTab = activeTab === 'assignments';
      if (activeTab === 'assignments') { UA.lmsAssignments.mount(box, { modal: openModal, notify, api }); return; }
      if (activeTab === 'lectures') {
        const KIND = { video: '🎬 محاضرة فيديو', pdf: '📄 ملف PDF', slides: '📊 عرض تقديمي', assignment: '✍️ تكليف عملي' };
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>المحتوى الرقمي والمحاضرات المرفوعة</h3>
              <button class="btn pri" id="btn-add-lec">＋ رفع محاضرة / مادة رقمية</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>الرمز</th><th>المقرر</th><th>الأسبوع</th><th>عنوان المحاضرة</th><th>النوع</th><th>المرفقات</th><th>المدرّس</th><th>المشاهدات</th><th></th></tr></thead>
                <tbody>
                  ${d.lectures.map((l) => `
                    <tr>
                      <td class="mono">${esc(l.course_code)}</td>
                      <td><b>${esc(l.course_name)}</b></td>
                      <td>الأسبوع ${l.week_no}</td>
                      <td><b>${esc(l.title)}</b><div class="small hint">${esc(l.summary)}</div></td>
                      <td><span class="pill p-approved">${esc(KIND[l.kind] || l.kind)}</span></td>
                      <td>
                        ${(l.files || []).map((f) => `<div style="display:flex;gap:.35rem;align-items:center;margin-bottom:.25rem"><button type="button" class="btn sm btn-open-file" data-lec="${l.id}" data-file="${f.id}" title="${esc(f.filename)}">${FILE_KIND[f.kind][0]} ${FILE_KIND[f.kind][1]}</button><button type="button" class="btn sm bad btn-del-file" data-file="${f.id}" aria-label="حذف ${esc(f.filename)}">×</button></div>`).join('') || '<span class="small hint">لا مرفقات</span>'}
                        <button type="button" class="btn sm btn-add-file" data-lec="${l.id}" style="margin-top:.25rem">＋ مرفق</button>
                      </td>
                      <td>${esc(l.instructor_name)}</td>
                      <td>${fmt(l.views_count)}</td>
                      <td><button class="btn sm bad btn-del-lec" data-id="${l.id}">حذف</button></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-add-lec').onclick = () => openModal('إضافة محاضرة رقمية جديدة', `
          <label>رمز المقرر <input name="course_code" placeholder="CYB-101" required></label>
          <label>اسم المقرر <input name="course_name" placeholder="مبادئ الأمن السيبراني والتشفير" required></label>
          <label>عنوان المحاضرة <input name="title" placeholder="مثال: المحاضرة 3: بروتوكولات المصادقة الرقمية" required></label>
          <label>نوع المحتوى <select name="kind"><option value="pdf">ملف PDF</option><option value="video">محاضرة فيديو</option><option value="slides">عرض تقديمي</option><option value="assignment">تكليف عملي</option></select></label>
          <label>رقم الأسبوع <input name="week_no" type="number" value="3" min="1" max="16"></label>
          <label>الكلية أو المعهد المستهدف <select name="target_faculty" data-no-other="1"><option value="">كل الكليات والمعاهد</option>${(d.faculties || []).map((f) => `<option>${esc(f)}</option>`).join('')}</select></label>
          <label>فئة الطلاب <select name="target_group_id" data-no-other="1"><option value="">كل الفئات</option>${(d.groups || []).map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label>
          <label>ملخص المحاضرة <textarea name="summary" rows="2" placeholder="وصف موجز للمحاور العلمية..."></textarea></label>
          <label>المرفقات (PDF، فيديو mp4 أو webm، عرض pptx) <input id="v12-lec-files" type="file" multiple accept=".pdf,.mp4,.webm,.pptx"></label>
        `, async (data) => {
          const input = document.getElementById('v12-lec-files'), files = input ? [...input.files] : [];
          delete data[''];
          const { id } = await api('POST', '/api/lms/lectures', data);
          const failed = await uploadLectureFiles(id, files);
          notify(failed.length ? `أُضيفت المحاضرة، وتعذّر رفع: ${failed.join('؛ ')}` : 'تمت إضافة المحاضرة الرقمية بنجاح', !failed.length);
          render();
        });
        box.querySelectorAll('.btn-open-file').forEach((btn) => {
          btn.onclick = () => {
            const lecture = d.lectures.find((x) => String(x.id) === btn.dataset.lec), file = lecture && lecture.files.find((x) => String(x.id) === btn.dataset.file);
            if (file) openLectureFile(file);
          };
        });
        box.querySelectorAll('.btn-add-file').forEach((btn) => {
          btn.onclick = () => openModal('إضافة مرفق للمحاضرة', `<label>الملفات (PDF، فيديو mp4 أو webm، عرض pptx) <input id="v12-lec-files" type="file" multiple required accept=".pdf,.mp4,.webm,.pptx"></label>`, async () => {
            const failed = await uploadLectureFiles(btn.dataset.lec, [...document.getElementById('v12-lec-files').files]);
            if (failed.length) throw new Error(failed.join('؛ '));
            notify('أُضيف المرفق');
            render();
          });
        });
        box.querySelectorAll('.btn-del-file').forEach((btn) => {
          btn.onclick = async () => {
            if (!window.confirm('حذف هذا المرفق نهائياً؟')) return;
            try { await api('DELETE', `/api/lms/files/${btn.dataset.file}`); notify('حُذف المرفق'); render(); }
            catch (e) { if (!e.status) throw e; notify(e.message); }
          };
        });
        box.querySelectorAll('.btn-del-lec').forEach((btn) => {
          btn.onclick = async () => {
            if (!window.confirm('حذف هذه المحاضرة ومرفقاتها نهائيًا؟')) return;
            try { await api('DELETE', `/api/lms/lectures/${btn.dataset.id}`); notify('تم حذف المحاضرة'); render(); }
            catch (e) { if (!e.status) throw e; notify(e.message); }
          };
        });
      } else if (activeTab === 'quizzes') {
        box.innerHTML = UA.quizBank.table(d) + ((d.quizSubmissions || []).length ? `<div class="v12-card"><div class="v12-bar"><h3>أحدث التسليمات</h3></div><div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الطالب</th><th>الرقم الجامعي</th><th>النتيجة</th><th>وقت التسليم</th></tr></thead><tbody>${d.quizSubmissions.map((x) => `<tr><td><b>${esc(x.student_name)}</b></td><td class="mono">${esc(x.student_no)}</td><td><b>${x.score} / ${x.total_marks}</b>${x.needs_grading ? ' <span class="small">(بانتظار التصحيح)</span>' : ''}</td><td>${new Date(Number(x.submitted_at)).toLocaleString('ar-SY')}</td></tr>`).join('')}</tbody></table></div></div>` : '');
        UA.quizBank.bindTable(box, d, { modal: openModal, notify, render, api });
      } else {
        box.innerHTML = `
          <div class="v12-grid2">
            <div class="v12-card">
              <div class="v12-bar">
                <h3>فهرس المكتبة الرقمية والورقية</h3>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  <input id="v12-book-q" placeholder="العنوان أو المؤلف أو ISBN" value="${esc(bookQ)}" style="width:190px">
                  <button class="btn" id="btn-book-q">بحث</button>
                  <button class="btn pri" id="btn-add-book">＋ إضافة كتاب</button>
                </div>
              </div>
              <div class="tbl-wrap">
                <table class="grid-tbl">
                  <thead><tr><th>ISBN</th><th>العنوان والمؤلف</th><th>التصنيف</th><th>الرف</th><th>المتاح</th></tr></thead>
                  <tbody>
                    ${d.books.map((b) => `
                      <tr>
                        <td class="mono small">${esc(b.isbn)}</td>
                        <td><b>${esc(b.title)}</b><div class="small hint">${esc(b.author)} (${b.publish_year})</div></td>
                        <td>${esc(b.category)}</td>
                        <td class="mono">${esc(b.shelf_code)}</td>
                        <td><span class="pill ${b.copies_available > 0 ? 'p-approved' : 'p-rejected'}">${b.copies_available} / ${b.copies_total}</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="v12-card">
              <div class="v12-bar">
                <h3>سجل الإعارة والاسترجاع</h3>
                <button class="btn pri" id="btn-add-loan">＋ تسجيل إعارة</button>
              </div>
              <div class="tbl-wrap">
                <table class="grid-tbl">
                  <thead><tr><th>الكتاب</th><th>المستعير</th><th>الاستحقاق</th><th>الحالة</th><th></th></tr></thead>
                  <tbody>
                    ${d.loans.map((l) => `
                      <tr>
                        <td><b>${esc(l.book_title)}</b></td>
                        <td>${esc(l.borrower_name)}<div class="mono small">${esc(l.borrower_no)}</div></td>
                        <td class="mono small">${esc(l.due_date)}</td>
                        <td><span class="pill ${l.status === 'returned' ? 'p-approved' : l.status === 'overdue' ? 'p-rejected' : 'p-review'}">${l.status === 'returned' ? 'مُرجع' : l.status === 'overdue' ? 'متأخر' : 'مستعار'}</span></td>
                        <td>${l.status !== 'returned' ? `<button class="btn sm pri btn-ret-loan" data-id="${l.id}">إرجاع</button>` : '✓'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
        box.querySelector('#btn-book-q').onclick = () => { bookQ = box.querySelector('#v12-book-q').value.trim(); render(); };
        box.querySelector('#btn-add-book').onclick = () => openModal('إضافة كتاب جديد للمكتبة', `
          <label>عنوان الكتاب <input name="title" required placeholder="مثال: أمن الأنظمة السحابية"></label>
          <label>المؤلف <input name="author" required placeholder="اسم المؤلف"></label>
          <label>ISBN <input name="isbn" placeholder="978-9933-10-510-1"></label>
          <label>التصنيف <input name="category" placeholder="الأمن السيبراني"></label>
          <label>عدد النسخ <input name="copies_total" type="number" value="10"></label>
          <label>رمز الرف <input name="shelf_code" placeholder="CYB-B2"></label>
        `, async (data) => {
          await api('POST', '/api/lms/books', data);
          notify('تمت إضافة الكتاب إلى الفهرس');
          render();
        });
        box.querySelector('#btn-add-loan').onclick = () => openModal('تسجيل إعارة كتاب لطالب/باحث', `
          <label>الكتاب <select name="book_id">${d.books.filter((b) => b.copies_available > 0).map((b) => `<option value="${b.id}">${esc(b.title)} (متاح: ${b.copies_available})</option>`).join('')}</select></label>
          <label>اسم المستعير <input name="borrower_name" required placeholder="الاسم الكامل"></label>
          <label>الرقم الجامعي / الوظيفي <input name="borrower_no" required placeholder="CYB-2026-0001"></label>
          <label>تاريخ الاستحقاق <input name="due_date" type="date"></label>
        `, async (data) => {
          await api('POST', '/api/lms/loans', data);
          notify('تم تسجيل إعارة الكتاب');
          render();
        });
        box.querySelectorAll('.btn-ret-loan').forEach((btn) => {
          btn.onclick = async () => {
            await api('POST', `/api/lms/loans/${btn.dataset.id}/return`);
            notify('تم تسجيل إرجاع الكتاب للمكتبة');
            render();
          };
        });
      }
    }
    await render();
  };

  /* ============================================================================
     2. وحدة 5.13: البحث العلمي والدراسات العليا (Research & Postgraduate Studies)
     ============================================================================ */
  UA.views.research = async function (el) {
    let activeTab = UA.gate ? UA.gate.firstTab('research', 'projects') : 'projects';
    async function render() {
      const d = await api('GET', '/api/research/overview');
      const s = d.stats;
      el.innerHTML = `
        ${SHARED_CSS}
        <div class="v12-wrap">
          <div class="v12-hero">
            <div>
              <span class="v12-badge-gold">الوحدة 5.13</span>
              <h1>البحث العلمي والدراسات العليا (Research & Postgrad)</h1>
              <p>إدارة المشاريع البحثية المحكمة، معاملات التأثير والاستشهادات، ومتابعة أطروحات الماجستير والدكتوراه ولجان الإشراف والحكم.</p>
            </div>
          </div>
          <div class="v12-kpis">
            <div class="v12-kpi"><span>المشاريع والأبحاث المسجلة</span><strong>${fmt(s.projectsCount)}</strong></div>
            <div class="v12-kpi"><span>الأبحاث المنشورة دولياً</span><strong>${fmt(s.publishedCount)}</strong></div>
            <div class="v12-kpi"><span>إجمالي الاستشهادات (Citations)</span><strong>${fmt(s.totalCitations)}</strong></div>
            <div class="v12-kpi"><span>أطروحات الماجستير والدكتوراه</span><strong>${fmt(s.thesesCount)}</strong></div>
            <div class="v12-kpi"><span>ميزانية التمويل البحثي</span><strong>${fmt(s.totalBudget)} ل.س</strong></div>
          </div>
          <div class="v12-tabs">
            <button class="v12-tab ${activeTab === 'projects' ? 'active' : ''}" data-t="projects">🔬 المشاريع والأبحاث المنشورة</button>
            <button class="v12-tab ${activeTab === 'theses' ? 'active' : ''}" data-t="theses">🎓 رسائل الماجستير والدكتوراه</button>
          </div>
          <div id="v12-res-body"></div>
        </div>
      `;
      el.querySelectorAll('.v12-tab').forEach((b) => {
        b.onclick = () => { activeTab = b.dataset.t; renderBody(d); el.querySelectorAll('.v12-tab').forEach((x) => x.classList.toggle('active', x.dataset.t === activeTab)); };
      });
      renderBody(d);
    }

    function renderBody(d) {
      const box = el.querySelector('#v12-res-body');
      if (activeTab === 'projects') {
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>سجل الأبحاث والمشاريع الممولة</h3>
              <button class="btn pri" id="btn-add-proj">＋ تسجيل بحث علمي جديد</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>الرمز</th><th>عنوان البحث والمجلة</th><th>الباحث الرئيسي</th><th>الكلية</th><th>Impact Factor</th><th>الاستشهادات</th><th>الميزانية</th><th>الحالة</th></tr></thead>
                <tbody>
                  ${d.projects.map((p) => `
                    <tr>
                      <td class="mono">${esc(p.code)}</td>
                      <td><b>${esc(p.title)}</b><div class="small hint">${esc(p.journal_name)} · ${esc(p.published_at)}</div></td>
                      <td>${esc(p.principal_investigator)}</td>
                      <td>${esc(p.faculty_name)}</td>
                      <td class="mono"><b>${p.impact_factor}</b></td>
                      <td>${fmt(p.citations_count)}</td>
                      <td>${fmt(p.budget)} ل.س</td>
                      <td><span class="pill ${p.status === 'published' ? 'p-approved' : 'p-review'}">${p.status === 'published' ? 'منشور ومُحكّم' : 'قيد البحث'}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-add-proj').onclick = () => openModal('تسجيل مشروع بحثي / ورقة علمية', `
          <label>عنوان البحث العلمي <input name="title" required placeholder="عنوان البحث..."></label>
          <label>الباحث الرئيسي <input name="principal_investigator" required placeholder="أ.د. ..."></label>
          <label>الكلية <input name="faculty_name" placeholder="كلية هندسة الأمن السيبراني"></label>
          <label>المجال العلمي <input name="domain" placeholder="الأمن السيبراني والذكاء الاصطناعي"></label>
          <label>المجلة العلمية <input name="journal_name" placeholder="IEEE Security & Privacy"></label>
          <label>معامل التأثير (Impact Factor) <input name="impact_factor" type="number" step="0.1" placeholder="5.4"></label>
          <label>ميزانية المنحة البحثية (ل.س) <input name="budget" type="number" placeholder="25000000"></label>
          <label>الحالة <select name="status"><option value="published">منشور ومُحكّم</option><option value="active">قيد الإنجاز</option></select></label>
        `, async (data) => {
          await api('POST', '/api/research/projects', data);
          notify('تم تسجيل البحث العلمي بنجاح');
          render();
        });
      } else {
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>سجل رسائل الماجستير وأطروحات الدكتوراه</h3>
              <button class="btn pri" id="btn-add-thesis">＋ تسجيل أطروحة جديدة</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>الرقم الجامعي</th><th>الباحث</th><th>الدرجة</th><th>عنوان الأطروحة والبرنامج</th><th>المشرف الرئيسي</th><th>المرحلة الحالية</th><th>موعد المناقشة</th><th>النتيجة</th></tr></thead>
                <tbody>
                  ${d.theses.map((t) => `
                    <tr>
                      <td class="mono">${esc(t.student_no)}</td>
                      <td><b>${esc(t.student_name)}</b></td>
                      <td><span class="pill p-review">${esc(t.degree)}</span></td>
                      <td><b>${esc(t.title)}</b><div class="small hint">${esc(t.program_name)}</div></td>
                      <td>${esc(t.supervisor_name)}${t.co_supervisor ? `<div class="small hint">مشارك: ${esc(t.co_supervisor)}</div>` : ''}</td>
                      <td><span class="pill ${t.stage === 'تمت المناقشة' ? 'p-approved' : 'p-review'}">${esc(t.stage)}</span></td>
                      <td class="mono">${esc(t.defense_date || '—')}</td>
                      <td><b>${esc(t.grade_label)}</b></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-add-thesis').onclick = () => openModal('تسجيل أطروحة دراسات عليا جديدة', `
          <label>اسم الباحث (الطالب) <input name="student_name" required></label>
          <label>الرقم الجامعي <input name="student_no" placeholder="PG-2026-0025" required></label>
          <label>الدرجة العلمية <select name="degree"><option value="ماجستير">ماجستير</option><option value="دكتوراه">دكتوراه</option></select></label>
          <label>البرنامج الأكاديمي <input name="program_name" placeholder="الأمن السيبراني والتحقيق الرقمي"></label>
          <label>عنوان الأطروحة <input name="title" required></label>
          <label>المشرف الرئيسي <input name="supervisor_name" placeholder="أ.د. مازن الحسن" required></label>
          <label>المرحلة <select name="stage"><option value="تسجيل الموضوع">تسجيل الموضوع</option><option value="سمنار أول">سمنار أول</option><option value="كتابة الأطروحة">كتابة الأطروحة</option><option value="تشكيل لجنة الحكم">تشكيل لجنة الحكم</option><option value="تمت المناقشة">تمت المناقشة</option></select></label>
          <label>التاريخ المتوقع للمناقشة <input name="defense_date" type="date"></label>
        `, async (data) => {
          await api('POST', '/api/research/theses', data);
          notify('تم تسجيل الأطروحة بنجاح');
          render();
        });
      }
    }
    await render();
  };

  /* ============================================================================
     3. وحدة 5.14: الخريجون والتوظيف (Alumni & Career Portal)
     ============================================================================ */
  UA.views.alumni = async function (el) {
    let activeTab = UA.gate ? UA.gate.firstTab('alumni', 'alumni') : 'alumni';
    async function render() {
      const d = await api('GET', '/api/alumni/overview');
      const s = d.stats;
      el.innerHTML = `
        ${SHARED_CSS}
        <div class="v12-wrap">
          <div class="v12-hero">
            <div>
              <span class="v12-badge-gold">الوحدة 5.14</span>
              <h1>بوابة الخريجين والتوظيف (Alumni & Career Portal)</h1>
              <p>السجل الرسمي الموثق للخريجين، متابعة المسار المهني، ومعرض فرص التوظيف والتدريب التعاوني مع الشركاء.</p>
            </div>
          </div>
          <div class="v12-kpis">
            <div class="v12-kpi"><span>إجمالي الخريجين الموثقين</span><strong>${fmt(s.alumniCount)}</strong></div>
            <div class="v12-kpi"><span>الخريجون العاملون حالياً</span><strong>${fmt(s.employedCount)}</strong></div>
            <div class="v12-kpi"><span>الفرص الوظيفية المفتوحة</span><strong>${fmt(s.openJobsCount)}</strong></div>
            <div class="v12-kpi"><span>طلبات التوظيف المقدمة</span><strong>${fmt(s.applicationsCount)}</strong></div>
          </div>
          <div class="v12-tabs">
            <button class="v12-tab ${activeTab === 'alumni' ? 'active' : ''}" data-t="alumni">🎓 سجل الخريجين الموثق</button>
            <button class="v12-tab ${activeTab === 'jobs' ? 'active' : ''}" data-t="jobs">💼 معرض الوظائف والتدريب</button>
          </div>
          <div id="v12-alm-body"></div>
        </div>
      `;
      el.querySelectorAll('.v12-tab').forEach((b) => {
        b.onclick = () => { activeTab = b.dataset.t; renderBody(d); el.querySelectorAll('.v12-tab').forEach((x) => x.classList.toggle('active', x.dataset.t === activeTab)); };
      });
      renderBody(d);
    }

    function renderBody(d) {
      const box = el.querySelector('#v12-alm-body');
      if (activeTab === 'alumni') {
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>السجل المعتمد للخريجين ورموز التحقق</h3>
              <button class="btn pri" id="btn-add-alm">＋ إدراج خريج جديد</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>الرقم الجامعي</th><th>الاسم الكامل</th><th>الكلية والبرنامج</th><th>سنة التخرج</th><th>المعدل والتقدير</th><th>جهة العمل الحالية</th><th>رمز توثيق الشهادة</th></tr></thead>
                <tbody>
                  ${d.alumni.map((a) => `
                    <tr>
                      <td class="mono">${esc(a.student_no)}</td>
                      <td><b>${esc(a.full_name)}</b><div class="small hint" dir="ltr">${esc(a.email)}</div></td>
                      <td>${esc(a.program_name)}<div class="small hint">${esc(a.faculty_name)}</div></td>
                      <td class="mono">${a.grad_year}</td>
                      <td><b>${a.gpa}%</b> · <span class="pill p-approved">${esc(a.honor_rank)}</span></td>
                      <td><b>${esc(a.job_title || '—')}</b><div class="small hint">${esc(a.current_employer || '')}</div></td>
                      <td class="mono"><span class="pill p-review">${esc(a.verified_code)}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-add-alm').onclick = () => openModal('إدراج خريج في السجل الدائم', `
          <label>الرقم الجامعي <input name="student_no" placeholder="CYB-2022-0045" required></label>
          <label>الاسم الكامل <input name="full_name" required></label>
          <label>الكلية <input name="faculty_name" placeholder="كلية هندسة الأمن السيبراني"></label>
          <label>البرنامج <input name="program_name" placeholder="الأمن السيبراني والشبكات"></label>
          <label>سنة التخرج <input name="grad_year" type="number" placeholder="2026"></label>
          <label>المعدل التراكمي (%) <input name="gpa" type="number" step="0.1" placeholder="89.5"></label>
          <label>التقدير <select name="honor_rank"><option value="مرتبة الشرف الأولى">مرتبة الشرف الأولى</option><option value="ممتاز">ممتاز</option><option value="جيد جداً">جيد جداً</option><option value="جيد">جيد</option></select></label>
          <label>جهة العمل الحالية <input name="current_employer" placeholder="مثال: الهيئة الوطنية لخدمات الشبكة"></label>
          <label>المسمى الوظيفي <input name="job_title" placeholder="مثال: مهندس أمن معلومات"></label>
        `, async (data) => {
          await api('POST', '/api/alumni/records', data);
          notify('تم إدراج الخريج وتوليد رمز التوثيق');
          render();
        });
      } else {
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>فرص التوظيف والتدريب التعاوني المتاحة</h3>
              <button class="btn pri" id="btn-add-job">＋ نشر فرصة وظيفية / تدريب</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>المسمى الوظيفي</th><th>الجهة / الشركة</th><th>النوع والموقع</th><th>الراتب / المكافأة</th><th>آخر موعد</th><th>المتقدمون</th><th></th></tr></thead>
                <tbody>
                  ${d.jobs.map((j) => `
                    <tr>
                      <td><b>${esc(j.title)}</b><div class="small hint">${esc(j.requirements)}</div></td>
                      <td><b>${esc(j.company_name)}</b><div class="small hint">${esc(j.sector)}</div></td>
                      <td><span class="pill p-review">${esc(j.job_type)}</span> · ${esc(j.location)}</td>
                      <td>${esc(j.salary_range)}</td>
                      <td class="mono">${esc(j.deadline)}</td>
                      <td><b>${j.applicants_count}</b> متقدم</td>
                      <td><button class="btn sm pri btn-apply-job" data-id="${j.id}">تقديم مرشح</button></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-add-job').onclick = () => openModal('نشر فرصة وظيفية أو تدريب تعاوني', `
          <label>المسمى الوظيفي <input name="title" required placeholder="مثال: محلل أمن سيبراني"></label>
          <label>الجهة المعلنة <input name="company_name" required></label>
          <label>نوع الفرصة <select name="job_type"><option value="دوام كامل">دوام كامل</option><option value="تدريب تعاوني">تدريب تعاوني</option><option value="عن بعد">عن بعد</option></select></label>
          <label>المدينة <input name="location"></label>
          <label>نطاق الراتب / المكافأة <input name="salary_range" placeholder="3,000,000 - 4,500,000 ل.س"></label>
          <label>المتطلبات الأساسية <textarea name="requirements" rows="2"></textarea></label>
          <label>آخر موعد للتقديم <input name="deadline" type="date" required></label>
        `, async (data) => {
          await api('POST', '/api/alumni/jobs', data);
          notify('تم نشر الفرصة الوظيفية بنجاح');
          render();
        });
        box.querySelectorAll('.btn-apply-job').forEach((btn) => {
          btn.onclick = () => openModal('ترشيح خريج / طالب للوظيفة', `
            <input type="hidden" name="job_id" value="${btn.dataset.id}">
            <label>اسم المتقدم <input name="applicant_name" required placeholder="م. سامر فؤاد النجار"></label>
            <label>الرقم الجامعي <input name="student_no" required placeholder="CYB-2021-0031"></label>
            <label>المعدل التراكمي <input name="gpa" type="number" step="0.1" placeholder="88.4"></label>
            <label>ملخص السيرة الذاتية والمهارات <textarea name="cv_summary" rows="2" required></textarea></label>
          `, async (data) => {
            await api('POST', '/api/alumni/applications', data);
            notify('تم إرسال طلب الترشح للوظيفة');
            render();
          });
        });
      }
    }
    await render();
  };

  /* ============================================================================
     4. وحدة 5.15: الجودة والاعتماد المؤسسي (Quality Assurance & Accreditation)
     ============================================================================ */
  UA.views.qa = async function (el) {
    let activeTab = UA.gate ? UA.gate.firstTab('qa', 'kpis') : 'kpis';
    async function render() {
      const d = await api('GET', '/api/qa/overview');
      const s = d.stats;
      el.innerHTML = `
        ${SHARED_CSS}
        <div class="v12-wrap">
          <div class="v12-hero">
            <div>
              <span class="v12-badge-gold">الوحدة 5.15</span>
              <h1>الجودة والاعتماد المؤسسي (Quality Assurance & Accreditation)</h1>
              <p>متابعة مؤشرات الأداء المعيارية (KPIs)، استبيانات تقييم المقررات والتدريس، وملفات الاعتماد الأكاديمي البرامجي والمؤسسي.</p>
            </div>
          </div>
          <div class="v12-kpis">
            <div class="v12-kpi"><span>مؤشرات الجودة المعتمدة</span><strong>${fmt(s.kpisTotal)}</strong></div>
            <div class="v12-kpi"><span>المؤشرات المتحققة</span><strong>${fmt(s.kpisAchieved)} / ${fmt(s.kpisTotal)}</strong></div>
            <div class="v12-kpi"><span>متوسط رضا الطلاب العام</span><strong>${s.avgSatisfaction} / 5.0</strong></div>
            <div class="v12-kpi"><span>استبيانات التقييم المكتملة</span><strong>${fmt(s.surveysCount)}</strong></div>
            <div class="v12-kpi"><span>البرامج المعتمدة</span><strong>${fmt(s.accreditedPrograms)}</strong></div>
          </div>
          <div class="v12-tabs">
            <button class="v12-tab ${activeTab === 'kpis' ? 'active' : ''}" data-t="kpis">📊 مؤشرات الأداء (KPIs)</button>
            <button class="v12-tab ${activeTab === 'surveys' ? 'active' : ''}" data-t="surveys">⭐ تقييم المقررات والتدريس</button>
            <button class="v12-tab ${activeTab === 'acc' ? 'active' : ''}" data-t="acc">🏅 ملفات الاعتماد الأكاديمي</button>
          </div>
          <div id="v12-qa-body"></div>
        </div>
      `;
      el.querySelectorAll('.v12-tab').forEach((b) => {
        b.onclick = () => { activeTab = b.dataset.t; renderBody(d); el.querySelectorAll('.v12-tab').forEach((x) => x.classList.toggle('active', x.dataset.t === activeTab)); };
      });
      renderBody(d);
    }

    function renderBody(d) {
      const box = el.querySelector('#v12-qa-body');
      if (activeTab === 'kpis') {
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>مؤشرات الأداء المؤسسي والأكاديمي (2026/2027)</h3>
              <button class="btn pri" id="btn-add-kpi">＋ إضافة مؤشر أداء KPI</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>الرمز</th><th>المؤشر</th><th>المعيار</th><th>المستهدف</th><th>المتحقق فعلياً</th><th>نسبة الإنجاز</th><th>الحالة</th></tr></thead>
                <tbody>
                  ${d.kpis.map((k) => {
                    const pct = Math.min(100, Math.round((k.actual_value / Math.max(1, k.target_value)) * 100));
                    return `
                      <tr>
                        <td class="mono">${esc(k.code)}</td>
                        <td><b>${esc(k.title)}</b></td>
                        <td>${esc(k.standard_domain)}</td>
                        <td class="mono">${k.target_value} ${esc(k.unit)}</td>
                        <td class="mono"><b>${k.actual_value} ${esc(k.unit)}</b></td>
                        <td style="min-width:130px">
                          <div class="small">${pct}%</div>
                          <div class="v12-prog"><div style="width:${pct}%"></div></div>
                        </td>
                        <td><span class="pill ${k.status === 'متحقق' ? 'p-approved' : 'p-review'}">${esc(k.status)}</span></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-add-kpi').onclick = () => openModal('إضافة مؤشر جودة جديد (KPI)', `
          <label>رمز المؤشر <input name="code" placeholder="KPI-ACA-05" required></label>
          <label>عنوان المؤشر <input name="title" required placeholder="مثال: نسبة المقررات المحدثة سنوياً"></label>
          <label>المجال المعياري <input name="standard_domain" placeholder="الجودة التعليمية والمناهج"></label>
          <label>القيمة المستهدفة <input name="target_value" type="number" step="0.1" placeholder="90"></label>
          <label>القيمة المتحققة حالياً <input name="actual_value" type="number" step="0.1" placeholder="92"></label>
          <label>وحدة القياس <input name="unit" placeholder="%"></label>
        `, async (data) => {
          await api('POST', '/api/qa/kpis', data);
          notify('تمت إضافة مؤشر الجودة بنجاح');
          render();
        });
      } else if (activeTab === 'surveys') {
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>نتائج استبيانات تقييم المقررات وأعضاء هيئة التدريس</h3>
              <button class="btn pri" id="btn-add-surv">＋ إدراج نتيجة استبيان</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>المقرر</th><th>المدرّس</th><th>الفصل</th><th>المشاركون</th><th>المحتوى</th><th>الأداء التدريسي</th><th>التقييم والامتحانات</th><th>المعدل العام</th></tr></thead>
                <tbody>
                  ${d.surveys.map((s) => `
                    <tr>
                      <td><b>${esc(s.course_name)}</b> <span class="mono small">(${esc(s.course_code)})</span><div class="small hint">${esc(s.notes)}</div></td>
                      <td>${esc(s.instructor_name)}</td>
                      <td>${esc(s.semester)}</td>
                      <td>${fmt(s.responses_count)} طالب</td>
                      <td>${s.content_score} / 5</td>
                      <td>${s.teaching_score} / 5</td>
                      <td>${s.assessment_score} / 5</td>
                      <td><span class="pill p-approved"><b>${s.overall_score} / 5.0</b></span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-add-surv').onclick = () => openModal('إدراج تقييم فصلي لمقرر دراسي', `
          <label>رمز المقرر <input name="course_code" placeholder="CYB-202" required></label>
          <label>اسم المقرر <input name="course_name" required placeholder="اسم المقرر"></label>
          <label>مدرس المقرر <input name="instructor_name" required placeholder="د. ..."></label>
          <label>عدد الطلاب المشاركين <input name="responses_count" type="number" placeholder="65"></label>
          <label>تقييم المحتوى العلمي (من 5) <input name="content_score" type="number" step="0.1" max="5" placeholder="4.7"></label>
          <label>تقييم الأداء التدريسي (من 5) <input name="teaching_score" type="number" step="0.1" max="5" placeholder="4.8"></label>
          <label>تقييم عدالة الامتحانات (من 5) <input name="assessment_score" type="number" step="0.1" max="5" placeholder="4.6"></label>
          <label>ملاحظات وتوصيات <textarea name="notes" rows="2"></textarea></label>
        `, async (data) => {
          await api('POST', '/api/qa/surveys', data);
          notify('تم حفظ تقييم المقرر');
          render();
        });
      } else {
        box.innerHTML = `
          <div class="v12-card">
            <h3>برامج الاعتماد الأكاديمي والدراسة الذاتية</h3>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>البرنامج الأكاديمي</th><th>هيئة الاعتماد</th><th>الرمز المعياري</th><th>إنجاز الدراسة الذاتية</th><th>تاريخ التدقيق</th><th>الحالة</th></tr></thead>
                <tbody>
                  ${d.accreditations.map((a) => `
                    <tr>
                      <td><b>${esc(a.program_name)}</b><div class="small hint">${esc(a.notes)}</div></td>
                      <td>${esc(a.agency_name)}</td>
                      <td class="mono">${esc(a.standard_code)}</td>
                      <td style="min-width:140px">
                        <div class="small">${a.self_study_progress}%</div>
                        <div class="v12-prog"><div style="width:${a.self_study_progress}%"></div></div>
                      </td>
                      <td class="mono">${esc(a.audit_date)}</td>
                      <td><span class="pill ${a.status === 'معتمد' ? 'p-approved' : 'p-review'}">${esc(a.status)}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }
    }
    await render();
  };

  /* ============================================================================
     5. المرحلة 2: توسعات الوحدات 5.5، 5.6، 5.7، 5.8 (الامتحانات، السكن، التقييم، البصمة)
     ============================================================================ */
  UA.views.expansions = async function (el) {
    let activeTab = UA.gate ? UA.gate.firstTab('expansions', 'exams') : 'exams';
    async function render() {
      const d = await api('GET', '/api/expansions/overview');
      el.innerHTML = `
        ${SHARED_CSS}
        <div class="v12-wrap">
          <div class="v12-hero">
            <div>
              <span class="v12-badge-gold">الوحدتان 5.5 · 5.6</span>
              <h1>الامتحانات والتظلمات</h1>
              <p>جداول الامتحانات والقاعات والتظلمات، والترقيات العلمية، ومؤشرات الأداء الاستراتيجية لرئاسة الجامعة.</p>
            </div>
          </div>
          <div class="v12-tabs">
            <button class="v12-tab ${activeTab === 'exams' ? 'active' : ''}" data-t="exams">📅 5.5 جداول الامتحانات والتظلمات</button>
            <button class="v12-tab ${activeTab === 'faculty' ? 'active' : ''}" data-t="faculty">👨‍🏫 5.6 الترقيات العلمية</button>
            <button class="v12-tab ${activeTab === 'kpis' ? 'active' : ''}" data-t="kpis">🏛️ مؤشرات الأداء الاستراتيجية</button>
          </div>
          <div id="v12-exp-body"></div>
        </div>
      `;
      el.querySelectorAll('.v12-tab').forEach((b) => {
        b.onclick = () => { activeTab = b.dataset.t; renderBody(d); el.querySelectorAll('.v12-tab').forEach((x) => x.classList.toggle('active', x.dataset.t === activeTab)); };
      });
      renderBody(d);
    }

    function renderBody(d) {
      const box = el.querySelector('#v12-exp-body');
      if (activeTab === 'kpis') {
        box.innerHTML = UA.enterpriseData ? UA.renderExecKpis() : '<p class="hint">جارٍ تحميل المؤشرات…</p>';
        if (!UA.enterpriseData && UA.loaders.enterprise) UA.loaders.enterprise().then(() => { if (activeTab === 'kpis') box.innerHTML = UA.renderExecKpis(); }).catch(() => { box.innerHTML = '<p class="hint">تعذّر تحميل المؤشرات.</p>'; });
        return;
      }
      if (activeTab === 'exams') {
        box.innerHTML = `
          <div id="exp-master-exam-banner"></div>
          <div class="v12-card">
            <div class="v12-bar">
              <h3>جدول الامتحانات النهائية والعملية وتوزيع القاعات والمراقبين</h3>
              <div style="display:flex;gap:6px;flex-wrap:wrap">${UA.examBuilder?.canScheduleExams() ? '<button class="btn" id="btn-bulk-exam">جدولة جماعية وملف PDF</button>' : ''}<button class="btn pri" id="btn-add-exam">＋ جدولة امتحان جديد</button></div>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>الرمز</th><th>المقرر</th><th>النوع</th><th>التاريخ والوقت</th><th>القاعة</th><th>السعة / المسجلون</th><th>المراقبون</th><th>الحالة</th></tr></thead>
                <tbody>
                  ${d.exams.map((x) => `
                    <tr>
                      <td class="mono">${esc(x.course_code)}</td>
                      <td><b>${esc(x.course_name)}</b><div class="small hint">${esc(x.program_name)}</div></td>
                      <td><span class="pill p-review">${esc(x.exam_type)}</span>${x.academic_year ? `<div class="small">${esc([x.academic_year, x.semester].filter(Boolean).join(' · '))}</div>` : ''}${x.group_name ? `<div class="small">فئة: ${esc(x.group_name)}</div>` : ''}</td>
                      <td class="mono">${esc(x.exam_date)} · ${esc(x.start_time)}-${esc(x.end_time)}</td>
                      <td><b>${esc(x.hall_name)}</b></td>
                      <td>${x.enrolled_count} / ${x.capacity} طالب</td>
                      <td>${esc(x.proctor_name)}</td>
                      <td><span class="pill p-approved">${esc(x.status)}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div class="v12-card">
            <div class="v12-bar">
              <h3>طلبات التظلم والاعتراض على العلامات الامتحانية (Grade Appeals)</h3>
              <button class="btn pri" id="btn-add-appeal">＋ تسجيل طلب تظلم</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>الطالب</th><th>المقرر</th><th>العلامة السابقة</th><th>العلامة بعد المراجعة</th><th>السبب وقرار اللجنة</th><th>الحالة</th><th>إجراء اللجنة</th></tr></thead>
                <tbody>
                  ${d.appeals.map((a) => `
                    <tr>
                      <td><b>${esc(a.student_name)}</b><div class="mono small">${esc(a.student_no)}</div></td>
                      <td>${esc(a.course_name)} (${esc(a.course_code)})</td>
                      <td class="mono">${a.old_mark}</td>
                      <td class="mono"><b>${a.new_mark ?? '—'}</b></td>
                      <td><div>${esc(a.reason)}</div><div class="small hint">${esc(a.committee_note)}</div></td>
                      <td><span class="pill ${a.status.includes('مقبول') ? 'p-approved' : a.status === 'مرفوض' ? 'p-rejected' : 'p-review'}">${esc(a.status)}</span></td>
                      <td>
                        ${a.status === 'قيد اللجنة' ? `<button class="btn sm pri btn-acc-app" data-id="${a.id}" data-old="${a.old_mark}">قبول وتعديل</button> <button class="btn sm bad btn-rej-app" data-id="${a.id}">رفض</button>` : 'مُبتّ'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        const bulkBtn = box.querySelector('#btn-bulk-exam');
        const showBulk = async () => {
          const banner = box.querySelector('#exp-master-exam-banner');
          if (!banner) return;
          if (!UA.uxState.examBuilderOpen) { banner.innerHTML = ''; return; }
          await UA.examBuilder.ensureExamCoursesLoaded();
          banner.innerHTML = UA.renderMasterExamBuilder();
        };
        if (bulkBtn) { bulkBtn.onclick = () => { UA.uxState.examBuilderOpen = !UA.uxState.examBuilderOpen; showBulk(); }; showBulk(); }
        box.querySelector('#btn-add-exam').onclick = () => openModal('جدولة امتحان وتخصيص قاعة', `
          <label>رمز المقرر <input name="course_code" placeholder="CYB-305" required></label>
          <label>اسم المقرر <input name="course_name" required placeholder="مثال: التحقيق الجنائي الرقمي"></label>
          <label>نوع الامتحان <select name="exam_type">${managedOptions('examTypes')}</select></label>
          <label>التاريخ <input name="exam_date" type="date"></label>
          <label>وقت البدء <input name="start_time" value="09:00"></label>
          <label>وقت الانتهاء <input name="end_time" value="11:00"></label>
          <label>القاعة الامتحانية <input name="hall_name" placeholder="المدرج الثاني A2"></label>
          <label>سعة القاعة <input name="capacity" type="number" min="0" placeholder="اختياري"></label>
          <label>فئة الطلاب <select name="group_id"><option value="">— كل الطلاب —</option>${(d.studentGroups || []).map((g) => `<option value="${g.id}">${esc(g.name)} (${g.count} طالب)</option>`).join('')}</select></label>
          <label>المراقب المكلف <input name="proctor_name" placeholder="د. خالد الشامي"></label>
        `, async (data) => {
          const made = await api('POST', '/api/expansions/exams', data);
          const warn = made.conflictWarning || made.capacityWarning;
          notify(warn ? `جُدول الامتحان. تنبيه: ${warn}` : 'تمت جدولة الامتحان بنجاح');
          if (UA.examBuilder) await UA.examBuilder.loadSavedExams();
          render();
        });
        box.querySelector('#btn-add-appeal').onclick = () => openModal('تسجيل طلب تظلم امتحاني', `
          <p class="small hint">الاسم والمقرر والعلامة المعلنة تُؤخذ من سجل العلامات.</p>
          <label>الرقم الجامعي <input name="student_no" placeholder="CYB-2026-0001" required></label>
          <label>رمز المقرر <input name="course_code" placeholder="CYB-101" required></label>
          <label>سبب التظلم <textarea name="reason" rows="2" required placeholder="مراجعة جمع درجات السؤال الثاني."></textarea></label>
        `, async (data) => {
          await api('POST', '/api/expansions/appeals', data);
          notify('تم تقديم طلب التظلم للجنة الامتحانية');
          render();
        });
        box.querySelectorAll('.btn-acc-app').forEach((btn) => {
          btn.onclick = () => openModal('قبول التظلم وتعديل العلامة', `
            <p class="small hint">العلامة الحالية <b>${esc(btn.dataset.old)}</b>. الحفظ يعدّل علامة الطالب الفعلية ويسجل التعديل في سجل تغييرات العلامات.</p>
            <label>العلامة الجديدة <input name="new_mark" type="number" min="0" step="1" required></label>
            <label>قرار اللجنة ومبرره <textarea name="committee_note" rows="2" required minlength="5" maxlength="300"></textarea></label>
          `, async (data) => {
            const r = await api('POST', `/api/expansions/appeals/${btn.dataset.id}/decide`, { approve: true, new_mark: Number(data.new_mark), committee_note: data.committee_note });
            notify(r.pendingApproval ? 'قُبل التظلم وعُدّلت العلامة، وهي تنتظر الاعتماد' : 'قُبل التظلم وعُدّلت العلامة الفعلية');
            render();
          });
        });
        box.querySelectorAll('.btn-rej-app').forEach((btn) => {
          btn.onclick = () => openModal('رفض التظلم', `
            <label>قرار اللجنة ومبرره <textarea name="committee_note" rows="2" required maxlength="300"></textarea></label>
          `, async (data) => {
            await api('POST', `/api/expansions/appeals/${btn.dataset.id}/decide`, { approve: false, committee_note: data.committee_note });
            notify('رُفض التظلم، ولم تتغير العلامة');
            render();
          });
        });
      } else if (activeTab === 'faculty') {
        const canPromo = UA.S.me?.role === 'admin' || UA.can('faculty:manage') || UA.can('hr:manage');
        box.innerHTML = `
            <div class="v12-card">
              <div class="spread" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                <h3 style="margin:0">ملفات الترقيات العلمية لأعضاء هيئة التدريس</h3>
                ${canPromo ? '<button class="btn pri" type="button" id="btn-add-promo">+ ملف ترقية جديد</button>' : ''}
              </div>
              <div class="tbl-wrap">
                <table class="grid-tbl">
                  <thead><tr><th>العضو</th><th>الرتبة الحالية ← المستهدفة</th><th>نقاط الأبحاث</th><th>سنوات الخدمة</th><th>حالة لجنة الترقيات</th><th>إجراءات</th></tr></thead>
                  <tbody>
                    ${d.promotions.map((p) => `
                      <tr>
                        <td><b>${esc(p.faculty_name)}</b><div class="small hint">${esc(p.specialty)}</div></td>
                        <td>${esc(p.current_rank)} ← <b>${esc(p.target_rank)}</b></td>
                        <td class="mono"><b>${p.research_points}</b> / ${p.required_points}</td>
                        <td>${p.teaching_years} سنوات</td>
                        <td><span class="pill ${/مستوفٍ للشروط|معتمدة/.test(p.committee_status) && !/غير/.test(p.committee_status) ? 'p-approved' : /مرفوضة|غير/.test(p.committee_status) ? 'p-rejected' : 'p-review'}">${esc(p.committee_status)}</span></td>
                        <td>${canPromo && p.committee_status !== 'معتمدة بقرار مجلس الجامعة' ? `<button class="btn sm btn-edit-promo" type="button" data-id="${p.id}">تحديث</button>` : ''}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="6" class="empty">لا ملفات ترقية بعد.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
        `;
        // ملف الترقية: العضو من سجل الهيئة التدريسية (أو اسم يُكتب)، والرتب من «الدرجات العلمية» في الإعدادات
        const promoFields = (o, p = {}) => {
          const opt = (list, cur) => list.map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
          return `${p.id ? `<p class="small hint" style="grid-column:1/-1">العضو: <b>${esc(p.faculty_name)}</b>. اعتماد الترقية بقرار المجلس يرفع رتبته في سجل الهيئة التدريسية تلقائياً.</p>` : `
            <label>عضو الهيئة التدريسية <select name="member_id" data-no-other="1"><option value="">— غير مسجَّل: اكتب الاسم أدناه —</option>${o.members.map((m) => `<option value="${m.id}">${esc(m.name)} · ${esc(m.rank)}</option>`).join('')}</select></label>
            <label>الاسم (لغير المسجَّل) <input name="faculty_name" maxlength="100" placeholder="د. اسم العضو"></label>`}
            <label>التخصص <input name="specialty" maxlength="120" value="${esc(p.specialty || '')}" placeholder="يُؤخذ من سجل العضو إن تُرك فارغاً"></label>
            <label>الرتبة الحالية <select name="current_rank" data-no-other="1"><option value="">${p.id ? '' : '— من سجل العضو —'}</option>${opt(o.ranks, p.current_rank)}</select></label>
            <label>الرتبة المستهدفة <select name="target_rank" data-no-other="1" required>${opt(o.ranks, p.target_rank)}</select></label>
            <label>نقاط الأبحاث <input name="research_points" type="number" min="0" max="1000" step="0.5" required value="${p.research_points ?? ''}" placeholder="0"></label>
            <label>النقاط المطلوبة <input name="required_points" type="number" min="1" max="1000" step="0.5" required value="${p.required_points ?? 100}"></label>
            <label>سنوات الخدمة <input name="teaching_years" type="number" min="0" max="60" step="1" required value="${p.teaching_years ?? ''}" placeholder="4"></label>
            <label>حالة لجنة الترقيات <select name="committee_status" data-no-other="1">${opt(o.statuses, p.committee_status || o.statuses[0])}</select></label>`;
        };
        const done = (r, msg) => notify(r && r.rankUpdated ? `${msg}، ورُفعت رتبة العضو في سجل الهيئة التدريسية` : msg);
        const addBtn = box.querySelector('#btn-add-promo');
        if (addBtn) addBtn.onclick = async () => {
          const o = await api('GET', '/api/expansions/promotions/options');
          openModal('فتح ملف ترقية علمية', promoFields(o), async (data) => {
            const r = await api('POST', '/api/expansions/promotions', { ...data, member_id: data.member_id ? Number(data.member_id) : null });
            done(r, 'فُتح ملف الترقية'); render();
          });
        };
        box.querySelectorAll('.btn-edit-promo').forEach((btn) => {
          btn.onclick = async () => {
            const o = await api('GET', '/api/expansions/promotions/options'), p = d.promotions.find((x) => String(x.id) === btn.dataset.id);
            openModal('تحديث ملف الترقية', promoFields(o, p), async (data) => {
              const r = await api('PUT', `/api/expansions/promotions/${p.id}`, data);
              done(r, 'حُدّث ملف الترقية'); render();
            });
          };
        });
      }
    }
    await render();
  };

  /* السكن والساعات المكتبية والمنح والأنشطة: خدمات شؤون الطلاب، منفصلة عن الامتحانات */
  UA.views.student_life = async function (el, _me, only) {
    let activeTab = only || 'office';
    async function render() {
      const d = await api('GET', '/api/student-life/overview');
      el.innerHTML = `
        ${SHARED_CSS}
        <div class="v12-wrap">
          <div class="v12-hero">
            <div>
              <span class="v12-badge-gold">شؤون الطلاب</span>
              <h1>الساعات المكتبية والأنشطة</h1>
              <p>حجوزات الساعات المكتبية والأنشطة الطلابية.</p>
            </div>
          </div>
          <div class="v12-tabs">
            <button class="v12-tab ${activeTab === 'office' ? 'active' : ''}" data-t="office">👨‍🏫 الساعات المكتبية</button>
            <button class="v12-tab ${activeTab === 'dorms' ? 'active' : ''}" data-t="dorms">🏢 السكن والمنح والأنشطة</button>
          </div>
          <div id="v12-life-body"></div>
        </div>
      `;
      if (only) el.querySelectorAll('.v12-hero,.v12-kpis,.v12-tabs').forEach((x) => x.remove());
      el.querySelectorAll('.v12-tab').forEach((b) => {
        b.onclick = () => { activeTab = b.dataset.t; renderBody(d); el.querySelectorAll('.v12-tab').forEach((x) => x.classList.toggle('active', x.dataset.t === activeTab)); };
      });
      renderBody(d);
    }

    function renderBody(d) {
      const box = el.querySelector('#v12-life-body');
      if (activeTab === 'office') {
        box.innerHTML = `
            <div class="v12-card">
              <div class="v12-bar">
                <h3>حجوزات الساعات المكتبية والإرشاد</h3>
                <button class="btn pri" id="btn-add-oh">＋ حجز موعد مكتبي</button>
              </div>
              <div class="tbl-wrap">
                <table class="grid-tbl">
                  <thead><tr><th>عضو هيئة التدريس</th><th>الطالب</th><th>الموعد</th><th>الموضوع</th><th>الحالة</th></tr></thead>
                  <tbody>
                    ${d.officeBookings.map((b) => `
                      <tr>
                        <td><b>${esc(b.faculty_name)}</b></td>
                        <td>${esc(b.student_name)}<div class="mono small">${esc(b.student_no)}</div></td>
                        <td>${esc(b.slot_day)} (${esc(b.slot_time)})</td>
                        <td>${esc(b.topic)}</td>
                        <td><span class="pill p-approved">${esc(b.status)}</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
        `;
        box.querySelector('#btn-add-oh').onclick = () => openModal('حجز موعد ساعة مكتبية مع أستاذ المقرر', `
          <label>عضو هيئة التدريس <input name="faculty_name" placeholder="أ.د. مازن الحسن" required></label>
          <label>اسم الطالب <input name="student_name" placeholder="أحمد محمد العلي" required></label>
          <label>الرقم الجامعي <input name="student_no" placeholder="CYB-2026-0001" required></label>
          <label>اليوم <select name="slot_day"><option value="الأحد">الأحد</option><option value="الإثنين">الإثنين</option><option value="الثلاثاء">الثلاثاء</option><option value="الأربعاء">الأربعاء</option></select></label>
          <label>الفترة الزمنية <input name="slot_time" value="11:00 - 11:30"></label>
          <label>موضوع الاستشارة الأكاديمية <input name="topic" required placeholder="مثال: مراجعة خطة البحث الفصلي"></label>
        `, async (data) => {
          await api('POST', '/api/expansions/office-bookings', data);
          notify('تم تأكيد حجز الموعد المكتبي');
          render();
        });
      } else if (activeTab === 'dorms') {
        box.innerHTML = `
          <div class="v12-grid2">


          </div>
          <div class="v12-card">
            <h3>الأندية الطلابية والفعاليات اللامنهجية</h3>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>النادي الطلابي</th><th>الفعالية</th><th>التصنيف</th><th>التاريخ والمكان</th><th>المشرف</th><th>المشاركون</th></tr></thead>
                <tbody>
                  ${d.activities.map((a) => `
                    <tr>
                      <td><b>${esc(a.club_name)}</b></td>
                      <td>${esc(a.title)}</td>
                      <td><span class="pill p-review">${esc(a.category)}</span></td>
                      <td>${esc(a.event_date)} · ${esc(a.location)}</td>
                      <td>${esc(a.supervisor_name)}</td>
                      <td>${a.participants_count} طالب</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }
    }
    await render();
  };

  /* ============================================================================
     6. المرحلة 3: التحسينات التقنية والبنية التحتية (Scalability & DevOps)
     ============================================================================ */
  UA.views.devops = async function (el) {
    let pgDdl = '';
    let activeTab = 'dashboard'; // افتراضياً فتح لوحة تحليلات الأخطاء والرسوم البيانية
    let filterStatus = 'all';

    async function render() {
      const d = await api('GET', '/api/devops/overview');
      const m = d.metrics;
      const dbCfg = d.settings.db_engine || {};
      const incidents = d.incidents || [];
      const openCount = m.openIncidentsCount || incidents.filter((x) => x.status !== 'resolved').length;
      const critCount = m.criticalIncidentsCount || incidents.filter((x) => x.severity === 'critical' && x.status !== 'resolved').length;

      el.innerHTML = `
        ${SHARED_CSS}
        <div class="v12-wrap">
          <div class="v12-hero">
            <div>
              <span class="v12-badge-gold">المرحلة 3 · البنية التحتية والتوسع ومركز DevOps</span>
              <h1>مركز البنية التحتية وتسجيل تقارير الأخطاء (DevOps & Incident Hub)</h1>
              <p>رصد بلاغات الأخطاء، وحالة قاعدة البيانات والتخزين المؤقت.</p>
            </div>
          </div>
          <div class="v12-kpis">
            <div class="v12-kpi"><span>إصدار محرك Node.js</span><strong class="mono">${esc(m.nodeVersion)}</strong></div>
            <div class="v12-kpi"><span>بلاغات الأخطاء المفتوحة</span><strong style="color:${openCount > 0 ? '#B3261E' : '#1B7F4B'}">${fmt(openCount)} بلاغاً</strong></div>
            <div class="v12-kpi"><span>أخطاء حرجة غير محلولة</span><strong style="color:${critCount > 0 ? '#B3261E' : '#8B9591'}">${fmt(critCount)}</strong></div>
            <div class="v12-kpi"><span>الذاكرة المستخدمة (Heap)</span><strong>${m.heapUsedMb} MB</strong></div>
            <div class="v12-kpi"><span>سجلات التدقيق</span><strong>${fmt(m.auditCount)}</strong></div>
          </div>

          <div class="v12-tabs" style="margin-bottom:1.25rem;">
            <button class="v12-tab ${activeTab === 'dashboard' ? 'active' : ''}" data-t="dashboard">
              📊 لوحة تحليلات الأخطاء
            </button>
            <button class="v12-tab ${activeTab === 'incidents' ? 'active' : ''}" data-t="incidents">
              🚨 بلاغات أخطاء استوديو الكود والبنية التحتية
              ${openCount > 0 ? `<span style="margin-inline-start:6px;background:#B3261E;color:#fff;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:bold;">${openCount}</span>` : ''}
            </button>
            <button class="v12-tab ${activeTab === 'infra' ? 'active' : ''}" data-t="infra">
              ⚙️ قاعدة البيانات والتخزين المؤقت
            </button>
          </div>

          <div id="v12-devops-body"></div>
        </div>
      `;

      el.querySelectorAll('.v12-tab').forEach((b) => {
        b.onclick = () => {
          activeTab = b.dataset.t;
          renderBody(d);
          el.querySelectorAll('.v12-tab').forEach((x) => x.classList.toggle('active', x.dataset.t === activeTab));
        };
      });

      renderBody(d);
    }

    function renderBody(d) {
      const box = el.querySelector('#v12-devops-body');
      if (!box) return;

      if (activeTab === 'dashboard') {
        const a = d.analytics || {
          delivery: { successRate: 98.4, directDeliveryRate: 94.2, resolutionRate: 78.5, avgLatencyMs: 38 },
          timeSeries: [],
          byOperation: [],
          bySeverity: [],
          byFile: [],
        };
        const ts = a.timeSeries || [];
        const maxTs = Math.max(1, ...ts.map((x) => x.total || 0));

        box.innerHTML = `
          <!-- بطاقات مؤشرات التسليم والاعتمادية -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
            <div style="background:#fff;border:1px solid #DCE3DD;border-radius:8px;padding:14px;border-top:3px solid #1B7F4B;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
              <div class="small hint" style="font-weight:700">نسبة نجاح تسليم البلاغات</div>
              <div style="font-size:26px;font-weight:900;color:#1B7F4B;margin:4px 0">${a.delivery.successRate}%</div>
              <div class="small hint">تسليم مؤكد وموثق لوحدة DevOps</div>
            </div>
            <div style="background:#fff;border:1px solid #DCE3DD;border-radius:8px;padding:14px;border-top:3px solid #0A5A4D;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
              <div class="small hint" style="font-weight:700">تسليم مباشر فوري (Direct)</div>
              <div style="font-size:26px;font-weight:900;color:#0A5A4D;margin:4px 0">${a.delivery.directDeliveryRate}%</div>
              <div class="small hint">دون اللجوء لقنوات المعالجة البديلة</div>
            </div>
            <div style="background:#fff;border:1px solid #DCE3DD;border-radius:8px;padding:14px;border-top:3px solid #D5B65D;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
              <div class="small hint" style="font-weight:700">نسبة معالجة وحل الأخطاء</div>
              <div style="font-size:26px;font-weight:900;color:#8A6A1B;margin:4px 0">${a.delivery.resolutionRate}%</div>
              <div class="small hint">تم إغلاقها وتوثيق تصحيحها</div>
            </div>
            <div style="background:#fff;border:1px solid #DCE3DD;border-radius:8px;padding:14px;border-top:3px solid #4DB6A0;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
              <div class="small hint" style="font-weight:700">متوسط زمن الاستجابة والتسليم</div>
              <div style="font-size:26px;font-weight:900;color:#4DB6A0;margin:4px 0">${a.delivery.avgLatencyMs} ms</div>
              <div class="small hint">زمن تأكيد التسليم بين الاستوديو والـ API</div>
            </div>
          </div>

          <!-- شريط الإجراءات السريعة -->
          <div style="background:linear-gradient(135deg,#054239 0%,#095549 100%);color:#fff;padding:12px 18px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
            <div>
              <div style="font-weight:800;font-size:14.5px">لوحة تحليلات DevOps التفاعلية</div>
              <div class="small" style="color:#A8D8BE">رسوم بيانية مركبة (Composed & Area Charts) لتواتر الأعطال ونسب الإرسال على مدار الـ 7 أيام الماضية.</div>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn sm" id="btn-launch-recharts" style="background:#D5B65D;color:#042f28;font-weight:800;cursor:pointer;">📊 فتح التحليلات في صفحة الإحصاءات</button>
            </div>
          </div>

          <!-- رسم تواتر الأخطاء بمرور الوقت -->
          <div class="v12-card" style="margin-bottom:16px;">
            <div class="v12-bar">
              <div>
                <h3 style="margin:0;">تواتر الأخطاء المكتشفة بمرور الوقت (Error Frequency Timeline - 7 Days)</h3>
                <p class="small hint" style="margin:2px 0 0;">تتبع إجمالي البلاغات المسجلة، الأخطاء الحرجة، وفشل عمليات حفظ الملفات يومياً.</p>
              </div>
              <span class="small font-bold" style="background:#F6F8F5;padding:3px 8px;border-radius:4px;">تحديث مباشر</span>
            </div>
            <div style="display:flex;align-items:flex-end;gap:12px;height:180px;padding:16px 10px 0;background:#F6F8F5;border-radius:6px;border:1px solid #F6F8F5;">
              ${ts.map((item) => {
                const totalH = Math.max(8, (item.total / maxTs) * 130);
                const critH = Math.min(totalH, Math.max(4, (item.critical / maxTs) * 130));
                return `
                  <div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:6px;">
                    <span style="font-size:11px;font-weight:800;color:#10211D;">${item.total}</span>
                    <div style="width:100%;max-width:38px;height:${totalH}px;background:#B3261E;border-radius:4px 4px 0 0;position:relative;display:flex;align-items:flex-end;overflow:hidden;" title="إجمالي: ${item.total} | حرج: ${item.critical} | فشل حفظ: ${item.saveFailures}">
                      <div style="width:100%;height:${critH}px;background:#B3261E;"></div>
                    </div>
                    <span style="font-size:11px;font-weight:600;color:#566660;white-space:nowrap;">${esc(item.label)}</span>
                  </div>
                `;
              }).join('')}
            </div>
            <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:12px;">
              <span style="display:flex;align-items:center;gap:6px;"><i style="width:12px;height:12px;background:#B3261E;border-radius:2px;display:inline-block;"></i> إجمالي البلاغات</span>
              <span style="display:flex;align-items:center;gap:6px;"><i style="width:12px;height:12px;background:#B3261E;border-radius:2px;display:inline-block;"></i> أخطاء حرجة (Critical)</span>
            </div>
          </div>

          <!-- شبكة التفاصيل حسب العمليات والملفات -->
          <div class="v12-grid2">
            <div class="v12-card">
              <h3>توزيع الأخطاء حسب نوع العملية (Operations)</h3>
              <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
                ${(a.byOperation || []).map((op) => { const all = (a.byOperation || []).reduce((n, x) => n + x.total, 0), percentage = all ? Math.round((op.total / all) * 100) : 0; return `
                  <div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                      <b>${esc(op.label)}</b>
                      <span class="mono">${op.total} بلاغ (${percentage}%)</span>
                    </div>
                    <div style="height:8px;background:#F6F8F5;border-radius:4px;overflow:hidden;">
                      <div style="width:${Math.max(5, percentage)}%;height:100%;background:#0A5A4D;border-radius:4px;"></div>
                    </div>
                  </div>
                `; }).join('')}
              </div>
            </div>

            <div class="v12-card">
              <h3>الملفات الأكثر تأثراً ببلاغات الاستوديو (Affected Files)</h3>
              <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
                ${(a.byFile || []).map((f) => `
                  <div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                      <b class="mono" dir="ltr">${esc(f.name)}</b>
                      <span class="mono" style="font-weight:700;">${f.count} بلاغ</span>
                    </div>
                    <div style="height:8px;background:#F6F8F5;border-radius:4px;overflow:hidden;">
                      <div style="width:${Math.max(8, (f.count / (ts.reduce((s, x) => s + x.total, 0) || 1)) * 100)}%;height:100%;background:#D5B65D;border-radius:4px;"></div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `;

        box.querySelector('#btn-launch-recharts').onclick = () => {
          window.UA.openAnalytics('devops');
        };

      } else if (activeTab === 'incidents') {
        const incidents = d.incidents || [];
        const filtered = incidents.filter((x) => {
          if (filterStatus === 'open') return x.status !== 'resolved';
          if (filterStatus === 'resolved') return x.status === 'resolved';
          if (filterStatus === 'critical') return x.severity === 'critical';
          return true;
        });

        const openCount = incidents.filter((x) => x.status !== 'resolved').length;
        const resolvedCount = incidents.filter((x) => x.status === 'resolved').length;
        const critCount = incidents.filter((x) => x.severity === 'critical').length;

        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar" style="flex-wrap:wrap;gap:10px;">
              <div>
                <h3 style="display:flex;align-items:center;gap:8px;">
                  <span>سجل تقارير الأخطاء المستلمة من استوديو الكود (Incident Logs)</span>
                  <span style="font-size:11px;background:#054239;color:#D5B65D;padding:2px 8px;border-radius:12px;font-weight:bold;">DevOps Listener Active</span>
                </h3>
                <p class="small hint">يتم استقبال تقارير الأعطال البرمجية وفشل حفظ أو قراءة الملفات تلقائياً من واجهة استوديو الكود مع السجل التشخيصي الكامل.</p>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <select id="sel-inc-filter" style="font-size:12px;padding:5px 8px;border-radius:6px;background:var(--surface);border:1px solid var(--line);">
                  <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>كافة البلاغات (${incidents.length})</option>
                  <option value="open" ${filterStatus === 'open' ? 'selected' : ''}>المفتوحة فقط (${openCount})</option>
                  <option value="critical" ${filterStatus === 'critical' ? 'selected' : ''}>الحرجة فقط (${critCount})</option>
                  <option value="resolved" ${filterStatus === 'resolved' ? 'selected' : ''}>تم حلها (${resolvedCount})</option>
                </select>
                <button class="btn sm pri" id="btn-ref-inc">🔄 تحديث</button>
              </div>
            </div>

            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead>
                  <tr>
                    <th>رمز البلاغ</th>
                    <th>المصدر والعملية</th>
                    <th>الملف المتأثر</th>
                    <th>مستوى الخطورة</th>
                    <th>رسالة الخطأ والتشخيص</th>
                    <th>وقت الإرسال</th>
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.length ? filtered.map((inc) => {
                    const isCrit = inc.severity === 'critical';
                    const isErr = inc.severity === 'error';
                    const isResolved = inc.status === 'resolved';
                    const sevBadge = isCrit
                      ? '<span class="pill" style="background:#FBE0DD;color:#B3261E;border:1px solid #B3261E;">حرج (Critical)</span>'
                      : isErr
                      ? '<span class="pill" style="background:#FBEBD0;color:#8A6A1B;border:1px solid #C9A24B;">خطأ (Error)</span>'
                      : '<span class="pill" style="background:#E2EEE9;color:#054239;">تحذير / معلومة</span>';

                    return `
                      <tr style="${isCrit && !isResolved ? 'background:rgba(239,68,68,0.04);' : ''}">
                        <td class="mono font-bold" style="color:#D5B65D">${esc(inc.report_code)}</td>
                        <td>
                          <b>${esc(inc.source)}</b>
                          <div class="small hint mono">${esc(inc.event_type)}</div>
                        </td>
                        <td class="mono small" dir="ltr" style="text-align:right;">
                          ${inc.file_path ? `<span style="background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;">${esc(inc.file_path)}</span>` : '—'}
                        </td>
                        <td>${sevBadge}</td>
                        <td style="max-width:280px;">
                          <div style="font-weight:600;color:${isCrit ? '#B3261E' : 'inherit'};">${esc(inc.error_message)}</div>
                          ${inc.resolution_note ? `<div class="small hint" style="color:#1B7F4B;">الحل: ${esc(inc.resolution_note)}</div>` : ''}
                        </td>
                        <td class="small hint" style="white-space:nowrap;">
                          ${new Date(inc.created_at).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          <br>${new Date(inc.created_at).toLocaleDateString('ar-SY')}
                        </td>
                        <td>
                          <span class="pill ${isResolved ? 'p-approved' : 'p-review'}">
                            ${isResolved ? 'تم الحل والمطابقة' : 'قيد المعالجة (DevOps)'}
                          </span>
                        </td>
                        <td style="white-space:nowrap;">
                          <button class="btn sm btn-view-inc" data-id="${inc.id}" style="margin-inline-end:4px;">🔍 التفاصيل</button>
                          ${!isResolved ? `<button class="btn sm pri btn-res-inc" data-id="${inc.id}">✓ حل</button>` : ''}
                          <button class="btn sm bad btn-del-inc" data-id="${inc.id}">✕</button>
                        </td>
                      </tr>
                    `;
                  }).join('') : `
                    <tr>
                      <td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">
                        لا توجد بلاغات أخطاء مطابقة للمرشح المحدد حالياً.
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
        `;

        box.querySelector('#sel-inc-filter').onchange = (e) => {
          filterStatus = e.target.value;
          renderBody(d);
        };

        box.querySelector('#btn-ref-inc').onclick = () => render();

        box.querySelectorAll('.btn-view-inc').forEach((btn) => {
          btn.onclick = () => {
            const inc = (d.incidents || []).find((x) => x.id === Number(btn.dataset.id));
            if (!inc) return;
            let detFormatted = inc.error_details;
            try {
              detFormatted = JSON.stringify(JSON.parse(inc.error_details), null, 2);
            } catch {}
            let ctxFormatted = inc.client_context;
            try {
              ctxFormatted = JSON.stringify(JSON.parse(inc.client_context), null, 2);
            } catch {}

            openModal(`تقرير البلاغ التشخيصي: ${inc.report_code}`, `
              <div style="font-size:13px;line-height:1.6;direction:rtl;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;background:var(--surface2);padding:10px;border-radius:8px;">
                  <div><b>المصدر:</b> ${esc(inc.source)}</div>
                  <div><b>نوع الحدث:</b> <code class="mono">${esc(inc.event_type)}</code></div>
                  <div><b>الملف المتأثر:</b> <code class="mono">${esc(inc.file_path || '—')}</code></div>
                  <div><b>مستوى الخطورة:</b> ${esc(inc.severity)}</div>
                  <div><b>وقت التسجيل:</b> ${new Date(inc.created_at).toLocaleString('ar-SY')}</div>
                  <div><b>الحالة:</b> ${inc.status === 'resolved' ? 'تم الحل' : 'مفتوح'}</div>
                </div>
                <div style="margin-bottom:10px;">
                  <b>رسالة الخطأ:</b>
                  <div style="color:#B3261E;background:#FBE0DD;padding:8px 12px;border-radius:6px;margin-top:4px;font-weight:600;">
                    ${esc(inc.error_message)}
                  </div>
                </div>
                <div style="margin-bottom:10px;">
                  <b>التفاصيل الفنية وتتبع المكدس (Stack Trace & Payload):</b>
                  <pre class="v12-code" dir="ltr" style="max-height:160px;overflow:auto;margin-top:4px;">${esc(detFormatted || 'لا تفاصيل إضافية')}</pre>
                </div>
                <div>
                  <b>بيئة العميل والمستخدم (Client Context):</b>
                  <pre class="v12-code" dir="ltr" style="max-height:120px;overflow:auto;margin-top:4px;">${esc(ctxFormatted || '—')}</pre>
                </div>
              </div>
            `, null, { noSubmit: true });
          };
        });

        box.querySelectorAll('.btn-res-inc').forEach((btn) => {
          btn.onclick = () => {
            const id = Number(btn.dataset.id);
            openModal('اعتماد حل البلاغ وإغلاقه في DevOps', `
              <label>ملاحظة الحل الفني والإجراء المتخذ <textarea name="note" rows="3" required placeholder="مثال: تم فحص أذونات القرص وإعادة تشغيل معالج الملفات وتأكيد سلامة الحفظ."></textarea></label>
            `, async (data) => {
              await api('POST', `/api/devops/incidents/${id}/resolve`, data);
              notify('تم اعتماد حل البلاغ وتحديث سجلات التدقيق');
              render();
            });
          };
        });

        box.querySelectorAll('.btn-del-inc').forEach((btn) => {
          btn.onclick = async () => {
            if (!confirm('حذف هذا البلاغ من سجل DevOps نهائياً؟')) return;
            await api('DELETE', `/api/devops/incidents/${btn.dataset.id}`);
            notify('تم حذف البلاغ');
            render();
          };
        });

      } else {
        // Tab Infra
        const dbCfg = d.settings.db_engine || {};

        box.innerHTML = `
          <div class="v12-grid2">
            <div class="v12-card">
              <h3>🗄️ قاعدة البيانات (PostgreSQL Pool)</h3>
              <p class="small hint">طبقة الوصول في <code>server/db.js</code> تعمل على PostgreSQL حصراً عبر مجمع اتصالات.</p>
              <table class="grid-tbl">
                <tbody>
                  <tr><td><b>المحرك النشط حالياً</b></td><td><span class="pill p-approved">PostgreSQL + Connection Pool</span></td></tr>
                  <tr><td><b>خادم PostgreSQL الهدف</b></td><td class="mono">${dbCfg.pgHost ? `${esc(dbCfg.pgHost)}:${dbCfg.pgPort || 5432}` : 'غير مضبوط'}</td></tr>
                  <tr><td><b>الحد الأقصى لاتصالات المجمع (Pool Max)</b></td><td>${dbCfg.poolMax ? `${dbCfg.poolMax} اتصال متزامن · ${dbCfg.readReplicas || 0} نسخ قراءة (Read Replicas)` : 'غير مضبوط'}</td></tr>
                </tbody>
              </table>
              <div style="margin-top:.85rem">
                <button class="btn pri" id="btn-gen-pg">⚡ توليد مخطط PostgreSQL 16 الكامل (DDL)</button>
              </div>
            </div>

            <div class="v12-card">
              <h3>⚡ التخزين المؤقت</h3>
              <table class="grid-tbl">
                <tbody>
                  <tr><td><b>Redis</b></td><td><span class="pill ${d.cache && d.cache.redisConfigured ? 'p-approved' : 'p-review'}">${d.cache && d.cache.redisConfigured ? 'مضبوط عبر REDIS_URL' : 'غير مضبوط: ذاكرة الخادم فقط'}</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div id="v12-pg-box" style="display:${pgDdl ? 'block' : 'none'}" class="v12-card" style="margin-top:1rem;">
            <div class="v12-bar">
              <h3>مخطط PostgreSQL 16 المولّد آلياً من جداول النظام الحالية</h3>
              <button class="btn sm pri" id="btn-copy-pg">نسخ كود SQL</button>
            </div>
            <pre class="v12-code" id="v12-pg-code">${esc(pgDdl)}</pre>
          </div>
        `;

        box.querySelector('#btn-gen-pg').onclick = async () => {
          const res = await api('GET', '/api/devops/postgres-ddl');
          pgDdl = res.ddl;
          notify(`تم توليد مخطط PostgreSQL لـ ${res.tablesCount} جدولاً بنجاح!`);
          render();
        };

        const copyBtn = box.querySelector('#btn-copy-pg');
        if (copyBtn) {
          copyBtn.onclick = () => {
            navigator.clipboard.writeText(pgDdl);
            notify('تم نسخ مخطط PostgreSQL 16 إلى الحافظة');
          };
        }
      }
    }

    await render();
  };

  /* ============================================================================
     7. المرحلة 4: الذكاء الاصطناعي الجامعي (AI-Powered University)
     ============================================================================ */
  UA.views.ai = async function (el) {
    let activeTab = UA.gate ? UA.gate.firstTab('ai', 'early') : 'early';
    async function render() {
      const d = await api('GET', '/api/ai/overview');
      const s = d.stats;
      el.innerHTML = `
        ${SHARED_CSS}
        <div class="v12-wrap">
          <div class="v12-hero">
            <div>
              <span class="v12-badge-gold">الذكاء الاصطناعي</span>
              <h1>الذكاء الاصطناعي الجامعي (AI-Powered University)</h1>
              <p>نظام الإنذار الأكاديمي المبكر لكشف التعثر الطلابي، المرشد الأكاديمي الذكي للخطط واللوائح، والمصنّف الآلي للمراسلات والشكاوى.</p>
              <p class="small" style="margin-top:8px;font-weight:700">الردود والتشخيصات هنا مولّدة محلياً بقواعد ثابتة، ولا تُرسل أي بيانات خارج النظام.</p>
            </div>
          </div>
          <div class="v12-kpis">
            <div class="v12-kpi"><span>حالات إنذار مبكر حرجة</span><strong style="color:#B3261E">${fmt(s.criticalCount)}</strong></div>
            <div class="v12-kpi"><span>حالات متوسطة قيد المتابعة</span><strong style="color:#8A6A1B">${fmt(s.mediumCount)}</strong></div>
            <div class="v12-kpi"><span>حالات مستقرة وآمنة</span><strong style="color:#1B7F4B">${fmt(s.safeCount)}</strong></div>
            <div class="v12-kpi"><span>مراسلات وشكاوى مصنفة آلياً</span><strong>${fmt(s.triageCount)}</strong></div>
            <div class="v12-kpi"><span>استشارات المرشد الذكي</span><strong>${fmt(s.chatsCount)}</strong></div>
          </div>
          <div class="v12-tabs">
            <button class="v12-tab ${activeTab === 'early' ? 'active' : ''}" data-t="early">🚨 نظام الإنذار الأكاديمي المبكر</button>
            <button class="v12-tab ${activeTab === 'advisor' ? 'active' : ''}" data-t="advisor">🤖 المرشد الأكاديمي الذكي</button>
            <button class="v12-tab ${activeTab === 'triage' ? 'active' : ''}" data-t="triage">📨 التصنيف الآلي للمراسلات والشكاوى</button>
          </div>
          <div id="v12-ai-body"></div>
        </div>
      `;
      el.querySelectorAll('.v12-tab').forEach((b) => {
        b.onclick = () => { activeTab = b.dataset.t; renderBody(d); el.querySelectorAll('.v12-tab').forEach((x) => x.classList.toggle('active', x.dataset.t === activeTab)); };
      });
      renderBody(d);
    }

    function renderBody(d) {
      const box = el.querySelector('#v12-ai-body');
      if (activeTab === 'early') {
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>سجل التنبؤ والإنذار الأكاديمي المبكر (Early Warning System)</h3>
              <button class="btn pri" id="btn-ai-scan">✨ فحص حالة طالب بالذكاء الاصطناعي</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>الطالب</th><th>البرنامج</th><th>المعدل</th><th>نسبة الحضور</th><th>مواد متعثرة</th><th>مستوى الخطر</th><th>التشخيص الذكي وخطة التدخل الإرشادية</th></tr></thead>
                <tbody>
                  ${d.warnings.map((w) => `
                    <tr>
                      <td><b>${esc(w.student_name)}</b><div class="mono small">${esc(w.student_no)}</div></td>
                      <td>${esc(w.program_name)}</td>
                      <td class="mono"><b>${w.gpa}%</b></td>
                      <td class="mono">${w.attendance_rate}%</td>
                      <td>${w.failed_courses}</td>
                      <td><span class="pill ${w.risk_level === 'حرج' ? 'p-rejected' : w.risk_level === 'متوسط' ? 'p-review' : 'p-approved'}">${esc(w.risk_level)}</span></td>
                      <td>
                        <div><b>التشخيص:</b> ${esc(w.ai_diagnosis)}</div>
                        <div class="small hint" style="margin-top:4px"><b>خطة التدخل:</b> ${esc(w.ai_action_plan)}</div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-ai-scan').onclick = () => openModal('تحليل مخاطر التعثر الأكاديمي بالذكاء الاصطناعي', `
          <label>اسم الطالب <input name="student_name" required placeholder="مثال: سامي وليد الحسين"></label>
          <label>الرقم الجامعي <input name="student_no" placeholder="CYB-2026-0011" required></label>
          <label>البرنامج الأكاديمي <input name="program_name" placeholder="هندسة الأمن السيبراني"></label>
          <label>المعدل التراكمي الحالي (%) <input name="gpa" type="number" step="0.1" placeholder="62.0" required></label>
          <label>نسبة الحضور الفصلي (%) <input name="attendance_rate" type="number" placeholder="66" required></label>
          <label>عدد المقررات المتعثرة <input name="failed_courses" type="number" placeholder="2"></label>
        `, async (data) => {
          notify('جارٍ تحليل السجل الأكاديمي بواسطة الذكاء الاصطناعي...');
          await api('POST', '/api/ai/early-warning/analyze', data);
          notify('تم إصدار التشخيص وخطة التدخل الإرشادية بنجاح');
          render();
        });
      } else if (activeTab === 'advisor') {
        box.innerHTML = `
          <div class="v12-card">
            <h3>🤖 المرشد الأكاديمي الذكي (مدرب على اللوائح والخطط الدراسية)</h3>
            <p class="small hint">اطرح أي سؤال حول شروط التخرج، نسب الغياب المسموحة، العبء التدريسي، أو توزيع المقررات.</p>
            <form id="form-ai-ask" style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap">
              <input id="inp-ai-q" style="flex:1;min-width:240px;padding:.65rem .9rem;border-radius:10px;border:1px solid #DCE3DD" placeholder="مثال: ما شروط التخرج بمرتبة الشرف وما الحد الأقصى للغياب المسموح؟" required>
              <button type="submit" class="btn pri">إرسال للمرشد الذكي</button>
            </form>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:1rem">
              <button type="button" class="btn sm q-preset" data-q="ما هي شروط التخرج والحد الأدنى للمعدل التراكمي؟">شروط التخرج والمعدل</button>
              <button type="button" class="btn sm q-preset" data-q="ما هي نسبة الغياب المسموحة قبل إصدار الحرمان من الامتحان؟">لائحة الغياب والحرمان</button>
              <button type="button" class="btn sm q-preset" data-q="كيف أختار المقررات المناسبة لرفع معدلي التراكمي في الفصل القادم؟">نصائح رفع المعدل</button>
            </div>
            <div style="space-y:.75rem">
              ${d.chats.map((c) => `
                <div style="border:1px solid #DCE3DD;border-radius:12px;padding:1rem;margin-bottom:.75rem;background:#F6F8F5">
                  <div style="font-weight:700;color:#0d3b2e;margin-bottom:.4rem">سؤال (${esc(c.user_label)}): ${esc(c.question)}</div>
                  <div style="line-height:1.65;color:#10211D">${esc(c.answer)}</div>
                  <div class="small hint" style="margin-top:.35rem">المحرك: <span class="mono">${esc(c.model_used)}</span></div>
                </div>
              `).join('') || '<p class="hint">لا توجد استشارات سابقة بعد. ابدأ بطرح سؤالك أعلاه.</p>'}
            </div>
          </div>
        `;
        box.querySelectorAll('.q-preset').forEach((b) => {
          b.onclick = () => { box.querySelector('#inp-ai-q').value = b.dataset.q; };
        });
        box.querySelector('#form-ai-ask').onsubmit = async (e) => {
          e.preventDefault();
          const q = box.querySelector('#inp-ai-q').value.trim();
          if (!q) return;
          notify('جارٍ استشارة المرشد الأكاديمي الذكي...');
          await api('POST', '/api/ai/advisor/ask', { question: q });
          render();
        };
      } else {
        box.innerHTML = `
          <div class="v12-card">
            <div class="v12-bar">
              <h3>📨 المصنّف والمحلل الذكي للمراسلات والشكاوى</h3>
              <button class="btn pri" id="btn-ai-triage">✨ تحليل وتصنيف مذكرة / شكوى جديدة</button>
            </div>
            <div class="tbl-wrap">
              <table class="grid-tbl">
                <thead><tr><th>المرسل والنوع</th><th>الموضوع والنص</th><th>التصنيف الآلي</th><th>الأولوية</th><th>الجهة المختصة المقترحة</th><th>الملخص ومسودة الرد الرسمي</th></tr></thead>
                <tbody>
                  ${d.triageLogs.map((t) => `
                    <tr>
                      <td><b>${esc(t.sender_name)}</b><div class="small hint">${esc(t.source_type)}</div></td>
                      <td><b>${esc(t.subject)}</b><div class="small hint">${esc(t.body_text)}</div></td>
                      <td><span class="pill p-review">${esc(t.ai_category)}</span></td>
                      <td><span class="pill ${t.ai_priority.includes('عاجل') ? 'p-rejected' : 'p-review'}">${esc(t.ai_priority)}</span></td>
                      <td><b>${esc(t.target_unit)}</b></td>
                      <td>
                        <div><b>الملخص:</b> ${esc(t.ai_summary)}</div>
                        <div class="small hint" style="margin-top:4px"><b>مسودة الرد:</b> ${esc(t.ai_draft_reply)}</div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        box.querySelector('#btn-ai-triage').onclick = () => openModal('تحليل وتوجيه ذكي لشكوى أو مراسلة إدارية', `
          <label>نوع الوارد <select name="source_type"><option value="شكوى طلابية">شكوى طلابية</option><option value="مراسلة إدارية">مراسلة إدارية</option><option value="طلب عاجل">طلب عاجل</option></select></label>
          <label>اسم المرسل / الجهة <input name="sender_name" placeholder="طالب في كلية الحقوق" required></label>
          <label>الموضوع <input name="subject" required placeholder="مثال: طلب تقسيط الرسوم الجامعية للفصل الأول"></label>
          <label>نص المراسلة أو الشكوى <textarea name="body_text" rows="3" required placeholder="اكتب تفاصيل الشكوى أو المذكرة ليقوم الذكاء الاصطناعي بتصنيفها واقتراح الجهة المختصة ومسودة الرد..."></textarea></label>
        `, async (data) => {
          notify('جارٍ تحليل المراسلة وصياغة مشروع الرد الرسمي...');
          await api('POST', '/api/ai/triage/analyze', data);
          notify('تم تصنيف المراسلة وتوجيهها وإعداد مسودة الرد');
          render();
        });
      }
    }
    await render();
  };

  /* إخفاء أزرار الكتابة عمّن يرفضها الخادم (نفس صلاحيات v12_modules.js). الأزرار تبقى في الصفحة
     لأن كل شاشة تربط معالجاتها بها مباشرة، لذلك الإخفاء بالتنسيق لا بالحذف. */
  const LMS_W = ['course:manage', 'lms_lib:write', 'lms_lib:edit'];
  const LIB_W = ['holds:manage', ...LMS_W];
  const EXAM_W = ['exams_housing:write', 'exams_housing:edit', 'exams_housing:approve'];
  const WRITE_RULES = [
    [['#btn-add-lec', '.btn-add-file', '#btn-add-quiz'], LMS_W],
    [['.btn-del-lec', '.btn-del-file'], ['course:manage', 'lms_lib:delete', 'lms_lib:edit']],
    [['#btn-add-book', '#btn-add-loan', '.btn-ret-loan'], LIB_W],
    [['#btn-add-proj', '#btn-add-thesis'], ['research_grad:write', 'research_grad:edit', 'research_grad:approve']],
    [['#btn-add-alm', '#btn-add-job'], ['alumni_career:write', 'alumni_career:edit']],
    [['.btn-apply-job'], ['alumni_career:write', 'alumni_career:edit'], true],
    [['#btn-add-kpi', '#btn-add-surv'], ['qa_inst:edit', 'qa_inst:approve']],
    [['#btn-add-exam'], [...EXAM_W, 'course:manage']],
    [['#btn-add-appeal'], [...EXAM_W, 'grade:manage', 'grade:approve'], true],
    [['.btn-acc-app', '.btn-rej-app'], ['grade:approve', 'exams_housing:approve']],
    [['#btn-add-oh'], ['sa_housing:manage', 'faculty:manage'], true],
    [['#btn-add-dorm'], ['sa_housing:manage']],
    [['#btn-add-sch'], ['sa_scholarships:approve', 'finance:fees']],
    [['#btn-add-appr'], ['hr_emp:edit', 'hr:manage']],
    [['#btn-sync-bio'], ['hr:manage', 'staffatt:manage']],
    [['#btn-ai-scan'], ['enterprise_ai:use', 'sa_advising:edit']],
    [['.v12-tab[data-t="triage"]'], ['enterprise_ai:use', 'corr:use', 'complaint:manage']],
  ];
  function applyWriteRules() {
    const me = UA.S && UA.S.me;
    if (!me) return;
    let style = document.getElementById('v12-write-rules');
    if (!style) {
      style = document.createElement('style');
      style.id = 'v12-write-rules';
      document.head.appendChild(style);
    }
    const hidden = me.role === 'admin' ? [] : WRITE_RULES
      .filter(([, perms, studentAllowed]) => !(studentAllowed && me.role === 'student') && !perms.some((p) => (me.permissions || []).includes(p)))
      .flatMap(([selectors]) => selectors);
    style.textContent = hidden.length ? `${hidden.join(',')}{display:none!important}` : '';
  }
  for (const key of ['lms', 'research', 'alumni', 'qa', 'expansions', 'student_life', 'ai']) {
    const view = UA.views[key];
    // معامل صريح: render يميّز شاشات التركيب غير المتزامنة بعدد المعاملات، و(...args) طوله صفر فتُعرض [object Promise]
    if (view) UA.views[key] = function (el, ...rest) { applyWriteRules(); return view.call(this, el, ...rest); };
  }
})();
