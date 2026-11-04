/* نافذة الطالب عند النقر على اسمه في السجل: «المعلومات الشخصية الرئيسية» مع لوحة المرفقات والبنود الإضافية و«تم التدقيق»،
   وتبويب «التعديلات السابقة»، وفيها الصورة وحالة القيد وإجراءات الطالب وطلباته. */
(function () {
  const UA = window.UA, { api, esc, fmt, toast, S, can } = UA;
  const F = { id: null, tab: 'info', data: null, fresh: false };
  const ITEMS = [['generalNotes', 'ملاحظات عامة'], ['box', 'الصندوق'], ['dossier', 'الإضبارة'], ['certNotes', 'ملاحظات الشهادة'], ['exception', 'الاستثناء']];
  const SEAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 9.500 4.200 6.200 4l-.7 3.200L2.800 9l1.300 3-1.300 3 2.700 1.800.7 3.200 3.300-.2L12 22l2.500-2.200 3.300.2.700-3.200 2.700-1.800-1.300-3 1.300-3-2.700-1.800-.7-3.200-3.300.2Z"/><path d="m8.500 12 2.500 2.500 4.500-5"/></svg>';
  UA.auditSeal = (small) => `<span class="sf-seal${small ? ' small' : ''}" title="تم التدقيق">${SEAL}<b>مدقَّق</b></span>`;
  const sizeText = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);

  const certLine = () => {
    const c = S.stCert; if (!c) return '';
    const stamp = c.tsaStatus === 'rfc3161' ? 'ختم زمني موثوق' : c.tsaStatus === 'failed' ? 'تعذّر الختم الموثوق' : 'ختم زمني محلي';
    return `<p class="small">رمز التحقق <span class="mono" dir="ltr">${esc(c.code)}</span> · ${stamp} · بصمة <span class="mono" dir="ltr">${esc(c.pdfSha256.slice(0, 16))}…</span>${c.selfSigned ? ' · شهادة ذاتية' : ''}</p>`;
  };
  function identity(d) {
    const st = S.stSel && S.stSel.id === d.student.id ? S.stSel : d.student;
    return `<section class="sf-identity${d.canEdit ? '' : ' ro'}">${UA.photoBox(st)}
      <div class="sf-id-body">
        <div class="sf-id-pills">${UA.spill(st.status, st.statusLabel)}${st.activeHolds ? `<span class="pill p-rejected">${st.activeHolds} عقوبة قائمة</span>` : ''}</div>
        <div class="actions no-print">${d.canEdit ? `<button class="btn pri sm" data-act="sfedit" data-id="${st.id}">تعديل</button>` : ''}${can('student:reset_password') ? '<button class="btn sm" data-act="sfpw">إعادة تعيين كلمة المرور</button>' : ''}<button class="btn sm" data-act="stcert">شهادة التسجيل الموقَّعة (PDF)</button>${can('student:delete') ? '<button class="btn sm bad" data-act="sfdel">حذف الطالب</button>' : ''}</div>
        ${certLine()}
        ${UA.relatedRequests(st)}
        <p class="small">سُجِّل ${esc(fmt(st.createdAt))} · آخر تعديل ${esc(fmt(st.updatedAt))}</p>
      </div>
    </section>`;
  }
  function infoTab(d) {
    const groups = d.groups.map((g) => {
      const rows = g.fields.filter((f) => f.value).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('');
      return rows ? `<section class="sf-group"><h3>${esc(g.title)}</h3><dl class="sf-kv">${rows}</dl></section>` : '';
    }).join('');
    const extra = d.extra.length ? `<section class="sf-group"><h3>بيانات إضافية</h3><dl class="sf-kv">${d.extra.map((x) => `<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join('')}</dl></section>` : '';
    const off = d.canEdit ? '' : ' disabled';
    const m = d.meta;
    const auditedLine = m.audited && m.auditedAt ? `<p class="small sf-audited-by">دقّقه ${esc(m.auditedBy || '—')} في ${esc(fmt(m.auditedAt))}</p>` : '';
    const files = d.attachments.length
      ? d.attachments.map((k) => `<section class="sf-att"><h4>${esc(k.label)} <span class="sf-count">${k.files.length}</span></h4><ul>${k.files.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a><small>${esc(sizeText(f.size))}</small></li>`).join('')}</ul></section>`).join('')
      : '<p class="hint" style="margin:0">لم تُضف مرفقات لهذا الطالب بعد.</p>';
    return `${identity(d)}<div class="sf-grid">
      <div class="sf-main">${groups}${extra}
        <form id="sf-form" class="sf-items" novalidate>
          <h3>بنود إضافية</h3>
          <div class="sf-fields">${ITEMS.map(([k, l]) => `<label>${esc(l)}<textarea id="sf-${k}" rows="4" maxlength="2000"${off}>${esc(m[k] || '')}</textarea></label>`).join('')}</div>
          <div class="sf-foot">
            <label class="sf-check"><input id="sf-audited" type="checkbox"${m.audited ? ' checked' : ''}${off}><span>تم التدقيق</span></label>
            ${auditedLine}
            ${d.canEdit ? '<button class="btn pri" type="submit">حفظ البنود</button>' : '<span class="small">لا تملك صلاحية التعديل.</span>'}
          </div>
        </form>
      </div>
      <aside class="sf-side" aria-label="المرفقات"><h3>المرفقات المضافة</h3>${files}</aside>
    </div>`;
  }
  function historyTab(d) {
    const last = d.last
      ? `<section class="sf-last"><h3>آخر تعديل</h3><dl class="sf-kv"><div><dt>الحساب</dt><dd>${esc(d.last.actor)}${d.last.username ? ` <span class="mono">(${esc(d.last.username)})</span>` : ''}</dd></div><div><dt>الوقت</dt><dd>${esc(fmt(d.last.at))}</dd></div><div class="wide"><dt>ما عُدّل</dt><dd>${esc(d.last.action)}</dd></div></dl></section>`
      : '<section class="sf-last"><h3>آخر تعديل</h3><p class="hint" style="margin:0">لم تُعدَّل بيانات هذا الطالب منذ تسجيله.</p></section>';
    const rows = d.history.map((h) => `<tr><td class="nowrap">${esc(fmt(h.at))}</td><td>${esc(h.actor)}${h.username ? `<div class="small mono">${esc(h.username)}</div>` : ''}</td><td>${esc(h.action)}</td></tr>`).join('');
    return `${last}<h3 class="sf-h">السجل الكامل</h3><div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>الحساب</th><th>الإجراء</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="empty">لا عمليات مسجلة.</td></tr>'}</tbody></table></div>`;
  }
  function paint() {
    const d = F.data, layer = document.getElementById('layer');
    if (!d || !layer) return;
    const st = d.student, keep = layer.querySelector('.sf-sheet')?.scrollTop ?? 0;
    const tab = (k, l) => `<button type="button" class="chip" role="tab" data-act="sftab" data-t="${k}" aria-selected="${F.tab === k}" aria-pressed="${F.tab === k}">${esc(l)}</button>`;
    layer.innerHTML = `<div class="overlay" dir="rtl" data-act="close"><div class="sheet sf-sheet" role="dialog" aria-modal="true" aria-labelledby="sf-title">
      <header class="sf-head"><div class="sf-id"><h2 id="sf-title">${esc(st.name)}</h2><span class="mono">${esc(st.studentNo)}</span>${d.meta.audited ? `<span class="sf-seal-wrap${F.fresh ? ' fresh' : ''}">${UA.auditSeal()}</span>` : ''}</div>
        <div class="sf-acts no-print"><button class="btn sm" data-act="strecord" data-id="${st.id}">السجل الموحّد 360°</button><button class="btn sm" data-act="close">إغلاق</button></div></header>
      <div class="sf-tabs no-print" role="tablist">${tab('info', 'المعلومات الشخصية الرئيسية')}${tab('history', 'التعديلات السابقة')}</div>
      <div class="sf-body">${F.tab === 'history' ? historyTab(d) : infoTab(d)}</div>
    </div></div>`;
    F.fresh = false;
    const sheet = layer.querySelector('.sf-sheet'); if (sheet) sheet.scrollTop = keep;
  }
  async function open(id) {
    F.id = Number(id); F.tab = 'info';
    const [info, full, files] = await Promise.all([api('GET', `/api/students/${F.id}/main-info`), api('GET', `/api/students/${F.id}`), api('GET', `/api/students/${F.id}/files`)]);
    F.data = info; S.stSel = full.student; S.stCert = full.certificate; S.stFiles = files.files;
    if (!S.requests && (can('request:read_all') || can('request:read_unit'))) { try { S.requests = (await api('GET', '/api/requests')).requests; } catch { /* تبقى القائمة فارغة */ } }
    paint();
  }
  // بعد تغيير الصورة تتغير المرفقات أيضاً
  async function repaint() {
    if (!F.id || !document.querySelector('#layer .sf-sheet')) return;
    F.data = await api('GET', `/api/students/${F.id}/main-info`);
    paint();
  }
  UA.studentFile = { open, repaint };
  Object.assign(UA.actions, {
    sftab: (el, d) => { F.tab = d.t === 'history' ? 'history' : 'info'; paint(); },
    sfedit: async (el, d) => { document.getElementById('layer').innerHTML = ''; await UA.actions.sttedit(el, d); },
    sfpw: async () => {
      const st = S.stSel;
      if (!st || !confirm('ستُنشأ كلمة مرور مؤقتة جديدة وتُنهى جلسات الطالب الحالية. متابعة؟')) return;
      const r = await api('POST', `/api/students/${st.id}/reset-password`, {});
      document.getElementById('layer').innerHTML = '';
      S.cred = { ...r.credentials, name: st.name, id: st.id, student: st, files: S.stFiles || [], cert: S.stCert || null }; S.stTab = 'new'; UA.render();
    },
    sfdel: async () => {
      const st = S.stSel;
      if (!st || !confirm(`حذف الطالب «${st.name}» (${st.studentNo}) وكل علاماته وذممه وشكاواه نهائياً؟ لا يمكن التراجع.`)) return;
      await api('DELETE', '/api/students/' + st.id);
      document.getElementById('layer').innerHTML = '';
      S.stSel = null; S.stCert = null; F.id = null;
      toast('حُذف الطالب');
      await UA.studentsTable.reload();
    },
  });
  UA.forms['sf-form'] = async () => {
    const body = { audited: document.getElementById('sf-audited').checked };
    for (const [k] of ITEMS) body[k] = document.getElementById(`sf-${k}`).value;
    const was = F.data.meta.audited;
    try {
      const r = await api('PUT', `/api/students/${F.id}/main-info`, body);
      F.data.meta = r.meta; F.data.history = r.history; F.data.last = r.last;
      F.fresh = !was && r.meta.audited;
      paint();
      toast(F.fresh ? 'حُفظت البنود، وظهر شعار «مدقَّق»' : 'حُفظت البنود');
      if (UA.studentsTable.reload) await UA.studentsTable.reload();
    } catch (e) { if (!e.status) throw e; toast(e.message); }
  };
})();
