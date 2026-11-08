/* منشئ الاختبارات الإلكترونية: أسئلة نظرية واختيار واحد واختيار متعدد، بترقيم تلقائي وعلامات وتحريك، ثم الاعتماد والنشر والطباعة والتصحيح. */
(function () {
  const UA = window.UA;
  if (!UA) return;
  const esc = UA.esc;
  const TYPE = { single: 'اختيار واحد', multi: 'اختيار متعدد', essay: 'سؤال نظري' };
  const STATUS = { draft: ['مسودة', 'p-review'], pending: ['بانتظار اعتماد المدرس', 'p-review'], approved: ['معتمد', 'p-approved'] };
  const can = (p) => UA.can(p);
  const blank = () => ({ type: 'single', q: '', options: ['', ''], correct: [], marks: 1 });
  const dtLocal = (ms) => { if (!ms) return ''; const d = new Date(Number(ms)), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const sum = (qs) => Math.round(qs.reduce((s, q) => s + (Number(q.marks) || 0), 0) * 100) / 100;

  function questionHtml(q, i) {
    const opts = q.type === 'essay' ? '<p class="hint" style="margin:0">يجيب الطالب كتابةً، ويصححه المدرس يدوياً.</p>' : `<div style="display:grid;gap:6px">${q.options.map((o, k) => `
        <div style="display:flex;gap:8px;align-items:center">
          <input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="qb-c-${i}" data-qb="correct" data-i="${i}" data-k="${k}" ${q.correct.includes(k) ? 'checked' : ''} aria-label="الإجابة الصحيحة" style="width:auto">
          <input data-qb="opt" data-i="${i}" data-k="${k}" value="${esc(o)}" placeholder="الخيار ${k + 1}" style="flex:1">
          <button type="button" class="btn sm" data-qbact="delopt" data-i="${i}" data-k="${k}" ${q.options.length <= 2 ? 'disabled' : ''}>حذف</button>
        </div>`).join('')}
        <div><button type="button" class="btn sm" data-qbact="addopt" data-i="${i}">＋ خيار</button> <span class="small hint">حدد الإجابة الصحيحة بالدائرة أو المربع.</span></div></div>`;
    return `<div class="card" style="margin:0 0 10px;padding:12px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <b>السؤال ${i + 1}</b>
        <select data-qb="type" data-i="${i}" data-no-other="1" style="width:auto">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}"${q.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <label style="display:inline-flex;gap:6px;align-items:center;margin:0">العلامة <input type="number" min="0.25" step="0.25" data-qb="marks" data-i="${i}" value="${q.marks}" style="width:80px"></label>
        <span style="margin-inline-start:auto;display:flex;gap:4px">
          <button type="button" class="btn sm" data-qbact="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="تحريك لأعلى">▲</button>
          <button type="button" class="btn sm" data-qbact="down" data-i="${i}" aria-label="تحريك لأسفل">▼</button>
          <button type="button" class="btn sm bad" data-qbact="del" data-i="${i}">حذف</button>
        </span>
      </div>
      <textarea data-qb="q" data-i="${i}" rows="2" placeholder="نص السؤال" style="width:100%;margin-bottom:8px">${esc(q.q)}</textarea>
      ${opts}
    </div>`;
  }

  // المنشئ يُرسم داخل عنصر الشاشة، ويعيد الجدول عند الانتهاء
  function open(box, quiz, ctx, done) {
    const st = {
      f: { course_code: quiz?.course_code || '', course_name: quiz?.course_name || '', title: quiz?.title || '', instructor_name: quiz?.instructor_name || '', faculty_name: quiz?.faculty_name || '', exam_day: quiz?.exam_day || '', publish_at: dtLocal(quiz?.publish_at), close_at: dtLocal(quiz?.close_at), duration_min: quiz?.duration_min || 60, instructions: quiz?.instructions || 'أجب عن جميع الأسئلة. لا يُسمح باستخدام الكتب أو الهاتف.' },
      qs: quiz ? quiz.questions.map((q) => ({ type: q.type, q: q.q, options: q.options?.length ? [...q.options] : ['', ''], correct: [...(q.correct || [])], marks: q.marks })) : [blank()],
    };
    const field = (key, label, attrs = '') => `<label>${label}<input data-qf="${key}" value="${esc(st.f[key])}" ${attrs}></label>`;
    const draw = () => {
      box.innerHTML = `<section class="card">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
          <h2 style="margin:0">${quiz ? 'تعديل اختبار' : 'إنشاء اختبار إلكتروني'}</h2>
          <span><b>${st.qs.length} سؤال · المجموع ${sum(st.qs)} علامة</b> <button type="button" class="btn" data-qbact="back">رجوع</button></span>
        </div>
        ${quiz?.rejection_note ? `<p class="err" style="margin:8px 0 0">سبب إعادته من المدرس: ${esc(quiz.rejection_note)}</p>` : ''}
        <h3 style="margin:14px 0 8px">ترويسة الامتحان</h3>
        <div class="inline-form" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
          ${field('title', 'عنوان الامتحان', 'required maxlength="150"')}
          ${field('course_code', 'رمز المادة', 'required maxlength="30" list="qb-courses"')}
          ${field('course_name', 'اسم المادة', 'maxlength="100"')}
          ${field('instructor_name', 'مدرس المادة', 'maxlength="100"')}
          <label>الكلية أو المعهد<select data-qf="faculty_name" data-no-other="1"><option value="">الكل</option>${(ctx.faculties || []).map((x) => `<option${st.f.faculty_name === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          ${field('exam_day', 'تاريخ الامتحان', 'type="date"')}
          ${field('publish_at', 'موعد النشر', 'type="datetime-local"')}
          ${field('close_at', 'موعد الإغلاق (اختياري)', 'type="datetime-local"')}
          ${field('duration_min', 'مدة الامتحان (دقيقة)', 'type="number" min="1" max="600"')}
        </div>
        <datalist id="qb-courses">${(ctx.courses || []).map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</datalist>
        <label style="display:block;margin-top:10px">تعليمات الامتحان<textarea data-qf="instructions" rows="2" style="width:100%">${esc(st.f.instructions)}</textarea></label>
        <h3 style="margin:16px 0 8px">الأسئلة</h3>
        ${st.qs.map(questionHtml).join('')}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button type="button" class="btn" data-qbact="add" data-t="single">＋ اختيار واحد</button>
          <button type="button" class="btn" data-qbact="add" data-t="multi">＋ اختيار متعدد</button>
          <button type="button" class="btn" data-qbact="add" data-t="essay">＋ سؤال نظري</button>
          <span style="margin-inline-start:auto;display:flex;gap:8px">
            <button type="button" class="btn" data-qbact="print">طباعة ورقة الامتحان</button>
            <button type="button" class="btn pri" data-qbact="save">حفظ مسودة</button>
            <button type="button" class="btn pri" data-qbact="send">حفظ وإرسال للاعتماد</button>
          </span>
        </div>
      </section>`;
    };
    const payload = () => ({ ...st.f, duration_min: Number(st.f.duration_min), questions: st.qs });
    const save = async () => (quiz ? (await UA.api('PUT', `/api/lms/quizzes/${quiz.id}`, payload()), quiz.id) : (quiz = { ...(await UA.api('POST', '/api/lms/quizzes', payload())), questions: st.qs }).id);
    box.oninput = (e) => {
      const t = e.target, i = Number(t.dataset.i), k = Number(t.dataset.k);
      if (t.dataset.qf) st.f[t.dataset.qf] = t.value;
      else if (t.dataset.qb === 'q') st.qs[i].q = t.value;
      else if (t.dataset.qb === 'opt') st.qs[i].options[k] = t.value;
      else if (t.dataset.qb === 'marks') st.qs[i].marks = Number(t.value) || 0;
    };
    box.onchange = (e) => {
      const t = e.target, i = Number(t.dataset.i), k = Number(t.dataset.k);
      if (t.dataset.qf) { st.f[t.dataset.qf] = t.value; return; }
      if (t.dataset.qb === 'type') { st.qs[i].type = t.value; st.qs[i].correct = []; if (t.value !== 'essay' && st.qs[i].options.length < 2) st.qs[i].options = ['', '']; draw(); }
      if (t.dataset.qb === 'correct') {
        const q = st.qs[i];
        if (q.type === 'single') q.correct = [k];
        else q.correct = t.checked ? [...new Set([...q.correct, k])] : q.correct.filter((x) => x !== k);
      }
    };
    box.onclick = async (e) => {
      const b = e.target.closest('[data-qbact]');
      if (!b) return;
      const a = b.dataset.qbact, i = Number(b.dataset.i), k = Number(b.dataset.k), qs = st.qs;
      if (a === 'add') { qs.push({ ...blank(), type: b.dataset.t }); draw(); }
      else if (a === 'del') { if (window.confirm(`حذف السؤال ${i + 1}؟`)) { qs.splice(i, 1); if (!qs.length) qs.push(blank()); draw(); } }
      else if (a === 'up' && i > 0) { [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; draw(); }
      else if (a === 'down' && i < qs.length - 1) { [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]; draw(); }
      else if (a === 'addopt') { qs[i].options.push(''); draw(); }
      else if (a === 'delopt') { qs[i].options.splice(k, 1); qs[i].correct = qs[i].correct.filter((x) => x !== k).map((x) => (x > k ? x - 1 : x)); draw(); }
      else if (a === 'print') printPaper({ ...st.f, questions: qs });
      else if (a === 'back') { box.oninput = box.onchange = box.onclick = null; done(); }
      else if (a === 'save' || a === 'send') {
        try {
          const id = await save();
          if (a === 'send') await UA.api('POST', `/api/lms/quizzes/${id}/request-approval`, {});
          UA.toast(a === 'send' ? 'أُرسل الاختبار إلى المدرس لاعتماده' : 'حُفظت المسودة');
          box.oninput = box.onchange = box.onclick = null; done();
        } catch (err) { if (!err.status) throw err; UA.toast(err.message); }
      }
    };
    draw();
  }

  // ورقة الامتحان بالترويسة: الجامعة والمادة والتاريخ وتوقيع مدرس المادة
  function printPaper(q, withAnswers = false) {
    const uni = /[؀-ۿ]/.test(String(UA.S.uni || '')) ? UA.S.uni : 'الجامعة السورية للعلوم الأمنية';
    const qs = q.questions || [];
    const css = `body{font-family:Tahoma,Arial,sans-serif;color:#10211D;font-size:13px;padding:14mm}.h{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;border-bottom:2px solid #054239;padding-bottom:8px}.h img{height:62px}.c{text-align:center}.c b{display:block;font-size:17px}.m{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:10px 0;padding:8px;border:1px solid #8B9591}.q{break-inside:avoid;margin:12px 0}.q b{display:block;margin-bottom:6px}.o{margin:3px 12px}.l{border-bottom:1px dotted #566660;height:24px}.s{display:flex;justify-content:space-between;margin-top:30px;break-inside:avoid}.ok{font-weight:700;text-decoration:underline}`;
    const body = `<div class="h"><div>الجامعة: <b>${esc(uni)}</b><br>${esc(q.faculty_name || '')}</div><div class="c"><img src="/brand/crest.svg" alt=""><b>${esc(q.title)}</b></div><div style="text-align:left">التاريخ: ${esc(q.exam_day || '')}<br>المدة: ${esc(q.duration_min)} دقيقة</div></div>
      <div class="m"><div>المادة: <b>${esc(q.course_name || '')}</b> (${esc(q.course_code || '')})</div><div>مدرس المادة: <b>${esc(q.instructor_name || '')}</b></div><div>اسم الطالب: ....................................</div><div>الرقم الجامعي: ........................ · العلامة الكلية: <b>${sum(qs)}</b></div></div>
      ${q.instructions ? `<p>${esc(q.instructions)}</p>` : ''}
      ${qs.map((x, i) => `<div class="q"><b>${i + 1}. ${esc(x.q)} (${x.marks} علامة)</b>${x.type === 'essay' ? '<div class="l"></div><div class="l"></div><div class="l"></div>' : (x.options || []).map((o, k) => `<div class="o${withAnswers && (x.correct || []).includes(k) ? ' ok' : ''}">${x.type === 'multi' ? '☐' : '○'} ${esc(o)}</div>`).join('')}</div>`).join('')}
      <div class="s"><div>توقيع مدرس المادة: ........................</div><div>ختم الجامعة</div></div>`;
    // الورقة الرسمية: الترويسة الموحّدة (print_doc.js) بدل الرأس المختصر، وأنماط الأسئلة محصورة في متن الورقة
    if (UA.printDoc) {
      const scoped = '.a4-body .m{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:0 0 10px;padding:8px;border:1px solid #9DB5AD;border-radius:2mm}.a4-body .q{break-inside:avoid;margin:10px 0}.a4-body .q b{display:block;margin-bottom:5px}.a4-body .o{margin:3px 12px}.a4-body .l{border-bottom:1px dotted #566660;height:24px}.a4-body .s{display:flex;justify-content:space-between;margin-top:30px;break-inside:avoid}.a4-body .ok{font-weight:700;text-decoration:underline}';
      const paper = body.replace(/^<div class="h">[\s\S]*?<\/div><\/div>\s*/, '');
      UA.printDoc({ title: `${q.title}${withAnswers ? ' — نموذج الإجابة' : ''}`, dept: q.faculty_name || undefined, date: q.exam_day || undefined, html: `<style>${scoped}</style><p class="small">مدة الامتحان: <b>${esc(q.duration_min)} دقيقة</b></p>${paper}`, noSign: true });
      return;
    }
    UA.printDocument(body, '@page{size:A4 portrait;margin:0}', css);
  }

  // تقديم الطالب: الوقت من الخادم، فيُعدّ حتى لو أُغلقت الصفحة
  async function take(q, modal, notify, after) {
    const s = await UA.api('POST', `/api/lms/quizzes/${q.id}/start`, {});
    const mins = Math.max(0, Math.round((s.endsAt - Date.now()) / 60000));
    modal(`${s.title} · يتبقى نحو ${mins} دقيقة`, s.questions.map((x, i) => `<fieldset style="grid-column:1/-1;border:1px solid var(--line,#dce3dd);border-radius:8px;padding:10px"><legend style="font-weight:700">${i + 1}. ${esc(x.q)} (${x.marks} علامة · ${TYPE[x.type]})</legend>
      ${x.type === 'essay' ? `<textarea data-a="${i}" rows="4" style="width:100%"></textarea>` : x.options.map((o, k) => `<label style="display:block"><input type="${x.type === 'multi' ? 'checkbox' : 'radio'}" name="a${i}" data-a="${i}" value="${k}" style="width:auto"> ${esc(o)}</label>`).join('')}</fieldset>`).join(''), async () => {
      const form = document.getElementById('v12-modal-form');
      const answers = s.questions.map((x, i) => {
        if (x.type === 'essay') return form.querySelector(`textarea[data-a="${i}"]`).value;
        const picked = [...form.querySelectorAll(`input[data-a="${i}"]:checked`)].map((n) => Number(n.value));
        return x.type === 'multi' ? picked : (picked.length ? picked[0] : null);
      });
      const r = await UA.api('POST', `/api/lms/quizzes/${q.id}/submit`, { answers });
      notify(r.pendingEssays ? `سُلّم الاختبار. علامة الأسئلة الموضوعية: ${r.score} من ${r.totalMarks}، والأسئلة النظرية تُصحَّح لاحقاً` : `النتيجة: ${r.score} من ${r.totalMarks}`);
      after();
    });
  }

  async function grade(q, modal, notify, after) {
    const d = await UA.api('GET', `/api/lms/quizzes/${q.id}/submissions`);
    const pending = d.submissions.filter((s) => s.needs_grading);
    if (!pending.length) { notify(d.submissions.length ? 'لا تسليمات بانتظار التصحيح' : 'لا تسليمات بعد'); return; }
    const s = pending[0], essays = d.questions.map((x, i) => [x, i]).filter(([x]) => x.type === 'essay');
    modal(`تصحيح ${s.student_name} (${s.student_no}) · بقي ${pending.length}`, essays.map(([x, i]) => `<fieldset style="grid-column:1/-1;border:1px solid var(--line,#dce3dd);border-radius:8px;padding:10px"><legend style="font-weight:700">${esc(x.q)}</legend><p>${esc(s.answers[i] || '—')}</p><label>العلامة من ${x.marks} <input type="number" name="m${x.id}" min="0" max="${x.marks}" step="0.25" required></label></fieldset>`).join(''), async (data) => {
      const marks = {};
      for (const [x] of essays) marks[x.id] = Number(data[`m${x.id}`]);
      const r = await UA.api('POST', `/api/lms/quiz-submissions/${s.id}/grade`, { marks });
      notify(`العلامة النهائية: ${r.score}`);
      after();
    });
  }

  // جدول الاختبارات ضمن بنك الأسئلة
  function table(d) {
    const student = UA.S?.me?.role === 'student', write = can('sa_quiz:write') || UA.S?.me?.role === 'admin', approve = can('sa_quiz:approve') || UA.S?.me?.role === 'admin';
    return `<div class="v12-card"><div class="v12-bar"><h3>الاختبارات الإلكترونية</h3>${write && !student ? '<button class="btn pri" data-qt="new">＋ إنشاء اختبار إلكتروني</button>' : ''}</div>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الرمز</th><th>المقرر</th><th>العنوان</th><th>النشر</th><th>المدة</th><th>العلامة</th><th>الأسئلة</th>${student ? '' : '<th>الحالة</th><th>المتقدمون</th>'}<th>إجراء</th></tr></thead><tbody>
      ${d.quizzes.map((q) => `<tr><td class="mono">${esc(q.course_code)}</td><td>${esc(q.course_name)}</td><td><b>${esc(q.title)}</b></td><td class="small">${q.publish_at ? esc(new Date(Number(q.publish_at)).toLocaleString('ar-SY')) : 'فوراً بعد الاعتماد'}</td><td>${Number(q.duration_min)} د</td><td>${Number(q.total_marks)}</td><td>${q.questions.length}</td>
        ${student ? '' : `<td><span class="pill ${(STATUS[q.status] || STATUS.draft)[1]}">${(STATUS[q.status] || STATUS.draft)[0]}</span>${q.open ? ' <span class="small">منشور</span>' : ''}</td><td>${Number(q.attempts_count)}${q.pending_grading ? ` <span class="small">(${q.pending_grading} للتصحيح)</span>` : ''}</td>`}
        <td style="white-space:nowrap">${student ? `<button class="btn sm pri" data-qt="take" data-id="${q.id}">تقديم الاختبار</button>` : `
          ${write ? `<button class="btn sm" data-qt="edit" data-id="${q.id}">تعديل</button> ` : ''}
          ${write && q.status === 'draft' ? `<button class="btn sm" data-qt="send" data-id="${q.id}">إرسال للاعتماد</button> ` : ''}
          ${approve && q.status === 'pending' ? `<button class="btn sm pri" data-qt="approve" data-id="${q.id}">اعتماد</button> <button class="btn sm" data-qt="reject" data-id="${q.id}">إعادة</button> ` : ''}
          <button class="btn sm" data-qt="print" data-id="${q.id}">طباعة</button>
          ${q.pending_grading && (write || approve) ? `<button class="btn sm pri" data-qt="grade" data-id="${q.id}">تصحيح</button> ` : ''}
          ${write ? `<button class="btn sm bad" data-qt="del" data-id="${q.id}">حذف</button>` : ''}`}</td></tr>`).join('') || `<tr><td colspan="10" class="empty">لا توجد اختبارات${student ? ' متاحة الآن' : ''}.</td></tr>`}
      </tbody></table></div></div>`;
  }
  function bindTable(box, d, { modal, notify, render, api }) {
    const byId = (id) => d.quizzes.find((x) => String(x.id) === String(id));
    box.addEventListener('click', async function handler(e) {
      const b = e.target.closest('[data-qt]');
      if (!b) return;
      const a = b.dataset.qt, q = byId(b.dataset.id);
      try {
        if (a === 'new' || a === 'edit') { const courses = (await api('GET', '/api/courses').catch(() => ({ courses: [] }))).courses; box.removeEventListener('click', handler); open(box, a === 'edit' ? q : null, { courses, faculties: d.faculties }, render); }
        else if (a === 'send') { await api('POST', `/api/lms/quizzes/${q.id}/request-approval`, {}); notify('أُرسل للاعتماد'); render(); }
        else if (a === 'approve') { await api('POST', `/api/lms/quizzes/${q.id}/decide`, { approve: true }); notify('اعتُمد الاختبار'); render(); }
        else if (a === 'reject') { const note = await askText('إعادة الاختبار للتعديل', { label: 'سبب الإعادة', type: 'textarea', submit: 'إعادة الاختبار' }); if (!note) return; await api('POST', `/api/lms/quizzes/${q.id}/decide`, { approve: false, note }); notify('أُعيد الاختبار'); render(); }
        else if (a === 'print') printPaper(q);
        else if (a === 'del') { if (!window.confirm(`حذف «${q.title}» نهائياً؟`)) return; await api('DELETE', `/api/lms/quizzes/${q.id}`); notify('حُذف'); render(); }
        else if (a === 'take') await take(q, modal, notify, render);
        else if (a === 'grade') await grade(q, modal, notify, render);
      } catch (err) { if (!err.status) throw err; UA.toast(err.message); }
    });
  }
  UA.quizBank = { table, bindTable };
})();
