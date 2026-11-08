/* المراسلات والكتب الرسمية الداخلية — نسخة مؤسسية منظمة (وارد، صادر، مسار اعتماد تسلسلي/متوازٍ، قوالب رسمية، وإشعارات) */
(function () {
  const UA = window.UA, { S, api, esc, fmt, toast, can } = UA;
  const fresh = () => ({
    tab: 'in',
    filter: 'all',
    q: '',
    docs: null,
    sel: null,
    doc: null,
    people: null,
    tpls: null,
    tedit: null,
    notifs: { items: [], unread: 0 },
    form: null,
    err: '',
    busy: false
  });
  const B = fresh();
  UA.corrState = B;
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const $id = (i) => document.getElementById(i);
  const ST = { draft: 'مسودة', pending: 'قيد الاعتماد', approved: 'معتمد وصادر', rejected: 'مرفوض', cancelled: 'ملغى' };
  const CLS = { draft: 'p-review', pending: 'p-review', approved: 'p-approved', rejected: 'p-rejected', cancelled: 'p-rejected' };
  const AST = { pending: 'بانتظار التوقيع', approved: 'تم الاعتماد ✓', rejected: 'رفض ✕' };
  const pill = (s) => `<span class="pill ${CLS[s]}">${ST[s] || s}</span>`;

  const tabs = () => [
    ['in', '📥 البريد الوارد والمحال'],
    ['out', '📤 البريد الصادر مني'],
    ...(can('corr:read_all') ? [['all', '🗂️ الأرشيف العام للمراسلات']] : []),
    ...(can('corr:use') ? [['new', '✍️ تحرير كتاب / مذكرة']] : []),
    ...(can('corr:templates') ? [['tpl', '📋 قوالب المراسلات']] : []),
    ['notifs', '🔔 تنبيهات الاعتماد']
  ];

  async function loadList() {
    if (B.tab === 'new' || B.tab === 'notifs' || B.tab === 'tpl') return;
    const q = new URLSearchParams({ box: B.tab });
    if (B.filter !== 'all') q.set('status', B.filter);
    B.docs = (await api('GET', '/api/corr?' + q)).docs;
  }
  async function loadNotifs() { B.notifs = await api('GET', '/api/corr/notifications'); }
  UA.loaders.corr = async () => {
    if (!can('corr:use') && B.tab !== 'all') B.tab = can('corr:read_all') ? 'all' : 'notifs';
    await Promise.all([loadNotifs(), loadList(), B.doc ? open(B.doc.id, true) : null]);
  };
  async function open(id, silent) {
    try { B.doc = (await api('GET', `/api/corr/${id}`)).doc; B.err = ''; }
    catch (e) { if (!e.status) throw e; B.doc = null; if (!silent) toast(e.message); }
  }

  function renderHeaderBar() {
    const allDocs = B.docs || [];
    const myTurnCount = allDocs.filter((d) => d.mine && d.mine.myTurn).length;
    const pendingCount = allDocs.filter((d) => d.status === 'pending').length;
    const approvedCount = allDocs.filter((d) => d.status === 'approved').length;
    const t = tabs();
    return `
      <section class="card no-print" style="margin-bottom:14px;background:linear-gradient(135deg,#10211D 0%,#054239 100%);color:#fff;border:1px solid #10211D;padding:16px">
        <div class="spread" style="flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <div style="font-size:11px;color:#0A5A4D;font-weight:700;letter-spacing:.4px">الديوان الإلكتروني والمراسلات الرسمية · INTERNAL CORRESPONDENCE & WORKFLOW</div>
            <div style="font-size:16px;font-weight:800;margin-top:2px">منظومة الكتب الرسمية والمذكرات الداخلية ومسارات التوقيع الإلكتروني</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('corr:use') ? `<button class="btn pri sm" data-act="crtab" data-t="new">✍️ تحرير كتاب رسمي جديد</button>` : ''}
            <button class="btn sm" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)" data-act="crtab" data-t="notifs">
              🔔 الإشعارات ${B.notifs.unread ? `(${B.notifs.unread} جديد)` : ''}
            </button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px">
          <div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#DCE3DD">إجمالي المجلد الحالي</div>
            <div style="font-size:18px;font-weight:800">${allDocs.length}</div>
          </div>
          <div style="background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.35);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#E6CB84">بانتظار توقيعك الآن</div>
            <div style="font-size:18px;font-weight:800;color:#C9A24B">${myTurnCount}</div>
          </div>
          <div style="background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.3);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#BFD8CF">قيد مسار الاعتماد</div>
            <div style="font-size:18px;font-weight:800;color:#0A5A4D">${pendingCount}</div>
          </div>
          <div style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:8px 12px">
            <div style="font-size:11px;color:#A8D8BE">معتمدة وصادرة رسمياً</div>
            <div style="font-size:18px;font-weight:800;color:#1B7F4B">${approvedCount}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${t.map((x) => `
            <button class="btn sm ${B.tab === x[0] ? 'pri' : ''}" style="${B.tab === x[0] ? '' : 'background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.18)'}" data-act="crtab" data-t="${x[0]}">
              ${x[1]}${x[0] === 'notifs' && B.notifs.unread ? ` <span class="badge-n">${B.notifs.unread}</span>` : ''}
            </button>
          `).join('')}
        </div>
      </section>`;
  }

  function list() {
    const q = (B.q || '').trim().toLowerCase();
    const filtered = (B.docs || []).filter((d) => {
      if (!q) return true;
      return String(d.no || '').toLowerCase().includes(q) ||
             String(d.title || '').toLowerCase().includes(q) ||
             String(d.subject || '').toLowerCase().includes(q) ||
             String(d.creator?.name || '').toLowerCase().includes(q);
    });
    const rows = filtered.map((d) => {
      const done = d.approvers.filter((a) => a.state === 'approved').length;
      const isSelected = B.doc && B.doc.id === d.id;
      return `<tr class="row" tabindex="0" data-act="cropen" data-id="${d.id}" style="${isSelected ? 'background:#F6F8F5;' : ''}${d.mine.myTurn ? 'border-inline-start:4px solid #C9A24B;' : ''}">
        <td class="mono"><b>${esc(d.no)}</b>${d.outNo ? `<div class="small" style="color:#0d9488">صادر: ${esc(d.outNo)}</div>` : ''}</td>
        <td>
          <b>${esc(d.title)}</b>
          ${d.subject ? `<div class="small">${esc(d.subject)}</div>` : ''}
        </td>
        <td>
          <b>${esc(B.tab === 'out' ? d.approvers.map((a) => a.name).join('، ') : d.creator.name)}</b>
          <div class="small">${esc(B.tab === 'out' ? (d.mode === 'sequential' ? 'مسار تسلسلي' : 'مسار متوازٍ') : (d.creator.unit || ''))}</div>
        </td>
        <td>
          ${pill(d.status)}
          ${d.mine.myTurn ? ' <span class="pill p-review" style="background:#FBEBD0;color:#8A6A1B;border:1px solid #C9A24B">⚡ دورك بالتوقيع</span>' : ''}
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="mono" style="font-weight:700">${done}/${d.approvers.length}</span>
            <div style="width:50px;height:6px;background:#DCE3DD;border-radius:99px;overflow:hidden"><div style="width:${d.approvers.length ? Math.round((done / d.approvers.length) * 100) : 0}%;height:100%;background:#0d9488"></div></div>
          </div>
        </td>
        <td>${fmt(d.createdAt)}</td>
      </tr>`;
    }).join('');

    const chips = ['all', 'pending', 'approved', 'rejected', ...(B.tab === 'out' ? ['draft', 'cancelled'] : [])]
      .map((k) => `<button class="chip" data-act="crfilter" data-k="${k}" aria-pressed="${B.filter === k}">${k === 'all' ? 'كل الحالات' : ST[k]}</button>`).join('');

    return `<section class="card">
      <div class="spread no-print" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="sub-tabs" style="margin:0">${chips}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="cr-search-q" value="${esc(B.q)}" placeholder="بحث برقم الكتاب، العنوان، الموضوع، أو المنشئ..." style="width:260px">
          <button class="btn sm" data-act="crsearch">بحث</button>
          ${B.q ? `<button class="btn sm" data-act="crsearchclear">مسح</button>` : ''}
        </div>
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>الرقم المرجعي</th><th>عنوان الكتاب والموضوع</th><th>${B.tab === 'out' ? 'سلسلة المعتمدين' : 'الجهة المنشئة'}</th><th>حالة الكتاب</th><th>تقدم التواقيع</th><th>تاريخ الإنشاء</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hint">لا توجد مراسلات مطابقة في هذا المجلد.</td></tr>'}</tbody></table></div>
    </section>`;
  }

  function detail() {
    const d = B.doc; if (!d) return '';
    const m = d.mine;
    const appr = d.approvers.map((a, idx) => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border:1px solid ${a.turn && d.status === 'pending' ? '#C9A24B' : 'var(--line,#DCE3DD)'};background:${a.state === 'approved' ? '#F6F8F5' : a.turn && d.status === 'pending' ? '#F6F8F5' : '#F6F8F5'};border-radius:8px;margin-bottom:6px">
        <span style="width:24px;height:24px;border-radius:50%;background:#10211D;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${idx + 1}</span>
        <div style="flex:1">
          <div class="spread" style="flex-wrap:wrap;gap:6px">
            <div><b>${esc(a.name)}</b> <span class="small">${esc(a.unit ? '— ' + a.unit : '')}</span></div>
            <div>
              <span class="pill ${a.state === 'approved' ? 'p-approved' : a.state === 'rejected' ? 'p-rejected' : 'p-review'}">${AST[a.state]}${a.turn && d.status === 'pending' ? ' (صاحب الدور الحالي)' : ''}</span>
              ${a.at ? `<span class="small" style="margin-inline-start:6px">${fmt(a.at)}</span>` : ''}
            </div>
          </div>
          ${a.note ? `<div class="small" style="margin-top:4px;color:#10211D">💬 الملاحظة: ${esc(a.note)}</div>` : ''}
        </div>
      </div>`).join('');

    const actions = [];
    if (m.myTurn) {
      actions.push(`
        <div style="background:#F6F8F5;border:1px solid #C9A24B;border-radius:10px;padding:12px;margin:12px 0">
          <strong style="color:#8A6A1B;display:block;margin-bottom:6px">⚡ هذا الكتاب بانتظار توقيعك واعتمادك الإداري</strong>
          <label>الشرح / الحاشية (إلزامية في حال الرفض)<textarea id="cr-note" rows="2" maxlength="500" placeholder="أوافق على مضمونه ويُحال للتنفيذ..."></textarea></label>
          <div class="actions" style="margin-top:8px">
            <button class="btn pri" data-act="crapprove">✓ توقيع واعتماد الكتاب</button>
            <button class="btn dan" data-act="crreject">✕ رفض وإعادة الكتاب</button>
          </div>
        </div>`);
    }
    if (m.creator && d.status === 'draft') {
      actions.push(`<div class="actions" style="margin:10px 0"><button class="btn pri" data-act="crsend">📤 إرسال لسلسلة الاعتماد</button> <button class="btn" data-act="credit">✏️ تعديل المسودة</button></div>`);
    }
    if (m.creator && ['draft', 'pending'].includes(d.status)) {
      actions.push(`<div class="actions" style="margin:10px 0"><button class="btn" data-act="crcancel">إلغاء الكتاب</button></div>`);
    }

    return `<section class="card" style="border:2px solid #0A5A4D;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--line,#DCE3DD);padding-bottom:10px;margin-bottom:12px">
        <div>
          <span class="mono" style="font-size:12px;color:#0A5A4D;font-weight:700">${esc(d.no)}</span>
          ${d.outNo ? ` · <span class="badge b-ok">رقم الصادر الرسمي: ${esc(d.outNo)}</span>` : ''}
          <h2 style="margin:4px 0 0">${esc(d.title)}</h2>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-start">
          ${d.status === 'approved' ? `<a class="btn pri sm" href="/api/corr/${d.id}/pdf" download>📥 تنزيل الكتاب الموقَّع PDF</a>` : ''}
          <button class="btn sm no-print" data-act="print">🖨️ طباعة</button>
          <button class="btn sm" data-act="crclose">✕ إغلاق المعاينة</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;background:#F6F8F5;padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:13px">
        <div><span class="small">الحالة:</span> ${pill(d.status)}</div>
        <div><span class="small">نمط السير:</span> <b>${d.mode === 'sequential' ? 'اعتماد تسلسلي تراتبي' : 'اعتماد متوازٍ'}</b></div>
        <div><span class="small">الجهة المنشئة:</span> <b>${esc(d.creator.name)}</b> ${d.creator.unit ? `(${esc(d.creator.unit)})` : ''}</div>
        <div><span class="small">تاريخ التحرير:</span> <b>${fmt(d.createdAt)}</b></div>
      </div>

      ${d.subject ? `<div style="font-weight:700;margin-bottom:8px;padding:8px 12px;background:#F6F8F5;border-inline-start:4px solid #10211D;border-radius:4px">الموضوع: ${esc(d.subject)}</div>` : ''}
      <div style="white-space:pre-wrap;line-height:2;border:1px solid var(--line,#DCE3DD);background:#fff;border-radius:10px;padding:18px;margin:10px 0;font-size:14px">${esc(d.body) || '<span class="hint">لا يوجد نص للكتاب.</span>'}</div>

      ${d.files.length ? `<div style="margin:10px 0"><b>📎 المرفقات الرسمية (${d.files.length}):</b> ${d.files.map((f) => `<span class="file-chip"><a class="btn sm" href="/api/corr/files/${f.id}" download>${esc(f.name)}</a>${/^(application\/pdf|image\/(png|jpeg))$/.test(f.mime) ? ` <a class="btn sm" href="/api/corr/files/${f.id}?inline=1" target="_blank" rel="noopener">معاينة</a>` : ''}</span>`).join(' ')}</div>` : ''}

      <h3 style="font-size:15px;margin:14px 0 8px">✒️ سلسلة التواقيع والاعتماد الإداري</h3>
      <div>${appr}</div>

      ${d.cc.length ? `<p class="small" style="margin-top:8px"><b>نسخة للاطلاع (CC) إلى:</b> ${d.cc.map((c) => esc(c.name)).join('، ')}</p>` : ''}
      ${m.cc ? '<p class="small hint">وصلتك نسخة من هذا الكتاب للاطلاع والعلم فقط.</p>' : ''}

      ${actions.join('')}

      ${d.status !== 'draft' ? `
        <div style="margin-top:14px;border-top:1px solid var(--line,#DCE3DD);padding-top:12px">
          <label style="display:block">إضافة حاشية أو تعليق إداري على الكتاب<textarea id="cr-comment" rows="2" maxlength="1000" placeholder="اكتب ملاحظتك أو توجيهك الإداري..."></textarea></label>
          <div class="actions" style="margin-top:6px"><button class="btn sm" data-act="crcomment">💬 إدراج التعليق في السجل</button></div>
        </div>` : ''}

      <details style="margin-top:12px" open>
        <summary style="cursor:pointer;font-weight:700;font-size:14px">📜 السجل الزمني لتداول الكتاب (${d.events.length} حركة)</summary>
        <ol class="small" style="margin-top:8px">${d.events.map((e) => `<li><b>${esc(e.text)}</b> — ${esc(e.actor)} (${fmt(e.at)})</li>`).join('')}</ol>
      </details>
    </section>`;
  }

  function newForm() {
    const f = B.form ?? (B.form = { title: '', subject: '', body: '', mode: 'parallel', approvers: [], cc: [], files: [], keep: [], remove: [] });
    const people = (B.people || []).filter((p) => !f.approvers.includes(p.id));
    const sel = f.approvers.map((id, i) => {
      const p = (B.people || []).find((x) => x.id === id);
      return `<li style="margin-bottom:4px">${f.mode === 'sequential' ? `<b>المرحلة ${i + 1}:</b> ` : ''}${esc(p ? p.name : id)} <span class="small">${esc(p ? p.unit : '')}</span> <button class="btn sm" type="button" data-act="crup" data-i="${i}" aria-label="أعلى">↑</button> <button class="btn sm" type="button" data-act="crdown" data-i="${i}" aria-label="أسفل">↓</button> <button class="btn sm" type="button" data-act="crrm" data-i="${i}">حذف</button></li>`;
    }).join('');
    const ccPeople = (B.people || []).filter((p) => !f.cc.includes(p.id) && !f.approvers.includes(p.id));
    const ccSel = f.cc.map((id, i) => {
      const p = (B.people || []).find((x) => x.id === id);
      return `<li>${esc(p ? p.name : id)} <span class="small">${esc(p ? p.unit : '')}</span> <button class="btn sm" type="button" data-act="crccrm" data-i="${i}">حذف</button></li>`;
    }).join('');
    const kept = f.keep.filter((x) => !f.remove.includes(x.id)).map((x) => `<span class="small">${esc(x.name)} <button class="btn sm" type="button" data-act="crfrm" data-id="${x.id}">إزالة</button></span>`).join(' ');

    return `<section class="card">
      <h2>${f.editId ? '✏️ تعديل مسودة الكتاب الرسمي' : '✍️ تحرير كتاب أو مذكرة داخلية جديدة'}</h2>
      <form id="crform" style="display:grid;gap:12px">
        ${(B.tpls || []).length ? `<label>استخدام قالب رسمي جاهز (يملأ الديباجة تلقائياً ويمكنك التعديل عليها)<select id="cf-tpl"><option value="">— تحرير حر بدون قالب —</option>${[...new Set(B.tpls.map((t) => t.category))].map((g) => `<optgroup label="${esc(g)}">${B.tpls.filter((t) => t.category === g).map((t) => `<option value="${esc(t.code)}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>` : ''}
        <div class="inline-form">
          <label>عنوان الكتاب / نوع المذكرة *<input id="cf-title" maxlength="120" value="${esc(f.title)}" placeholder="مذكرة داخلية / كتاب تكليف / طلب اعتماد" required></label>
          <label>الموضوع المختصر<input id="cf-subject" maxlength="200" value="${esc(f.subject)}" placeholder="بشأن اعتماد خطة القاعات الامتحانية"></label>
          <label>آلية سير التواقيع<select id="cf-mode"><option value="parallel"${f.mode === 'parallel' ? ' selected' : ''}>متوازٍ (يصل لجميع المعتمدين معاً)</option><option value="sequential"${f.mode === 'sequential' ? ' selected' : ''}>تسلسلي تراتبي (واحداً تلو الآخر بالترتيب)</option></select></label>
        </div>
        <label>نص الكتاب والمضمون التفصيلي<textarea id="cf-body" rows="8" maxlength="8000" placeholder="السيد عميد الكلية / مدير المديرية المحترم...">${esc(f.body)}</textarea></label>
        <div class="grid2">
          <div style="border:1px solid var(--line,#DCE3DD);border-radius:8px;padding:12px">
            <b>✒️ أصحاب الصلاحية في سلسلة الاعتماد *</b>
            <ol style="margin:8px 0">${sel || '<li class="hint">لم يُختر أي معتمد بعد.</li>'}</ol>
            <div style="display:flex;gap:6px">
              <select id="cf-person" aria-label="إضافة معتمد" style="flex:1"><option value="">— اختر المسؤول لاعتماد الكتاب —</option>${people.map((p) => `<option value="${p.id}">${esc(p.name)}${p.unit ? ' — ' + esc(p.unit) : ''}</option>`).join('')}</select>
              <button class="btn sm" type="button" data-act="cradd">+ إدراج</button>
            </div>
          </div>
          <div style="border:1px solid var(--line,#DCE3DD);border-radius:8px;padding:12px">
            <b>📨 نسخة للاطلاع والعلم (CC)</b>
            <ul style="margin:8px 0">${ccSel || '<li class="hint">لا يوجد مستلمو نسخة.</li>'}</ul>
            <div style="display:flex;gap:6px">
              <select id="cf-cc" aria-label="إضافة مستلم نسخة" style="flex:1"><option value="">— اختر جهة للاطلاع —</option>${ccPeople.map((p) => `<option value="${p.id}">${esc(p.name)}${p.unit ? ' — ' + esc(p.unit) : ''}</option>`).join('')}</select>
              <button class="btn sm" type="button" data-act="crccadd">+ إدراج</button>
            </div>
          </div>
        </div>
        ${kept ? `<div>المرفقات المحفوظة: ${kept}</div>` : ''}
        <label>إرفاق مستندات مؤيدة (PDF أو صور، حتى 5 ملفات)<input id="cf-files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg">${f.files.length ? `<span class="small">${f.files.map((x) => esc(x.name)).join('، ')}</span>` : ''}</label>
        ${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn pri" type="submit"${B.busy ? ' disabled' : ''}>📤 إصدار وإرسال للاعتماد</button>
          <button class="btn" type="button" data-act="crdraft">💾 حفظ كمسودة</button>
          ${f.editId ? '<button class="btn" type="button" data-act="crcanceledit">تراجع</button>' : ''}
        </div>
      </form>
    </section>`;
  }

  const fill = (s) => String(s || '')
    .replaceAll('{{date}}', new Intl.DateTimeFormat('ar-SY', { dateStyle: 'long', timeZone: 'Asia/Damascus' }).format(new Date()))
    .replaceAll('{{unit}}', (S.me.unit && S.me.unit.name) || '')
    .replaceAll('{{name}}', S.me.name || '');

  const readForm = () => {
    const f = B.form;
    if (!f || !$id('cf-title')) return;
    f.title = $id('cf-title').value;
    f.subject = $id('cf-subject').value;
    f.body = $id('cf-body').value;
    f.mode = $id('cf-mode').value;
    const fi = $id('cf-files');
    if (fi && fi.files.length) f.files = [...fi.files];
  };

  function notifs() {
    const n = B.notifs;
    return `<section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h2 style="margin:0">🔔 تنبيهات المراسلات وحركة الاعتماد</h2>
        ${n.unread ? '<button class="btn sm" data-act="crreadall">✓ تعليم الكل كمقروء</button>' : ''}
      </div>
      <ul style="list-style:none;padding:0;margin:0">
        ${n.items.map((i) => `
          <li style="padding:10px 12px;border-bottom:1px solid var(--line,#DCE3DD);background:${i.read ? 'transparent' : '#F6F8F5'};display:flex;justify-content:space-between;align-items:center;gap:8px">
            <button class="link" data-act="cropen" data-id="${i.docId}" data-n="${i.id}" style="${i.read ? '' : 'font-weight:700'}">${esc(i.text)}</button>
            <span class="small">${fmt(i.at)}</span>
          </li>`).join('') || '<li class="hint">لا توجد إشعارات حالياً.</li>'}
      </ul>
    </section>`;
  }

  function tplTab() {
    const e = B.tedit;
    const rows = (B.tpls || []).map((t) => `<tr>
      <td><b>${esc(t.name)}</b> <span class="mono small">${esc(t.code)}</span></td>
      <td>${esc(t.category)}</td>
      <td>${t.mode === 'sequential' ? 'تسلسلي' : 'متوازٍ'}</td>
      <td>${t.builtin ? 'قياسي' : 'مخصّص'}</td>
      <td>${t.active ? '<span class="ok-t">فعّال</span>' : '<span class="bad-t">معطّل</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn sm" data-act="ctedit" data-c="${esc(t.code)}">تعديل</button>
        <button class="btn sm" data-act="cttoggle" data-c="${esc(t.code)}" data-on="${t.active ? 0 : 1}">${t.active ? 'تعطيل' : 'تفعيل'}</button>
        ${t.builtin ? '' : ` <button class="btn sm" data-act="ctdel" data-c="${esc(t.code)}">حذف</button>`}
      </td>
    </tr>`).join('');

    const form = e ? `<section class="card" style="margin-bottom:14px">
      <h2>${e.isNew ? 'إضافة قالب مراسلات جديد' : 'تعديل القالب: ' + esc(e.name)}</h2>
      <form id="ctform" style="display:grid;gap:10px">
        <div class="inline-form">
          <label>الرمز (لاتيني)<input id="ct-code" class="mono" dir="ltr" maxlength="30" value="${esc(e.code)}"${e.isNew ? '' : ' disabled'} required></label>
          <label>اسم القالب<input id="ct-name" maxlength="80" value="${esc(e.name)}" required></label>
          <label>الفئة<input id="ct-cat" maxlength="60" value="${esc(e.category)}"></label>
          <label>نوع الاعتماد<select id="ct-mode"><option value="parallel"${e.mode === 'parallel' ? ' selected' : ''}>متوازٍ</option><option value="sequential"${e.mode === 'sequential' ? ' selected' : ''}>تسلسلي</option></select></label>
        </div>
        <label>عنوان المستند<input id="ct-title" maxlength="120" value="${esc(e.title)}" required></label>
        <label>الموضوع<input id="ct-subject" maxlength="200" value="${esc(e.subject)}"></label>
        <label>النص <span class="small">(المتغيرات التلقائية: {{date}} التاريخ، {{unit}} اسم الوحدة، {{name}} اسم المحرر)</span><textarea id="ct-body" rows="10" maxlength="8000" required>${esc(e.body)}</textarea></label>
        ${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}
        <div><button class="btn pri" type="submit">حفظ القالب</button> <button class="btn" type="button" data-act="ctcancel">إلغاء</button></div>
      </form>
    </section>` : '';

    return `${form}<section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h2 style="margin:0">📋 قوالب الكتب والمراسلات المعتمدة</h2>
        <button class="btn pri" data-act="ctnew">+ قالب جديد</button>
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>اسم القالب</th><th>الفئة</th><th>الاعتماد</th><th>النوع</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
  }

  UA.views.corr = () => {
    const t = tabs();
    const sideBarHook = `<div class="sub-tabs no-print" role="tablist">${t.map((x) => `<button class="chip" role="tab" data-act="crtab" data-t="${x[0]}" aria-pressed="${B.tab === x[0]}">${x[1]}${x[0] === 'notifs' && B.notifs.unread ? ` <span class="badge-n">${B.notifs.unread}</span>` : ''}</button>`).join('')}</div>`;
    return `${sideBarHook}${renderHeaderBar()}${B.doc ? detail() : ''}${B.tab === 'new' ? newForm() : B.tab === 'notifs' ? notifs() : B.tab === 'tpl' ? tplTab() : list()}`;
  };

  const A = UA.actions;
  const refresh = async () => { await Promise.all([loadNotifs(), loadList(), B.doc ? open(B.doc.id, true) : null]); UA.render(); };
  const loadTpls = async () => { B.tpls = (await api('GET', '/api/corr/templates' + (B.tab === 'tpl' ? '?all=1' : ''))).templates; };

  A.crtab = async (el, d) => {
    readForm(); B.tab = d.t; B.doc = null; B.err = ''; B.tedit = null;
    if (d.t === 'new' && !B.people) B.people = (await api('GET', '/api/corr/people')).people;
    if (d.t === 'new' || d.t === 'tpl') await loadTpls();
    await refresh();
  };
  A.crsearch = () => { B.q = $id('cr-search-q')?.value || ''; UA.render(); };
  A.crsearchclear = () => { B.q = ''; UA.render(); };

  const blank = () => ({ isNew: true, code: '', name: '', category: 'عام', title: '', subject: '', body: '', mode: 'parallel' });
  A.ctnew = () => { B.tedit = blank(); B.err = ''; UA.render(); window.scrollTo(0, 0); };
  A.ctedit = (el, d) => { const t = B.tpls.find((x) => x.code === d.c); if (t) { B.tedit = { ...t, isNew: false }; B.err = ''; UA.render(); window.scrollTo(0, 0); } };
  A.ctcancel = () => { B.tedit = null; B.err = ''; UA.render(); };
  A.cttoggle = async (el, d) => { try { await api('PUT', `/api/corr/templates/${d.c}`, { active: d.on === '1' }); await loadTpls(); UA.render(); } catch (e) { if (!e.status) throw e; toast(e.message); } };
  A.ctdel = async (el, d) => { if (!confirm('حذف هذا القالب نهائياً؟')) return; try { await api('DELETE', `/api/corr/templates/${d.c}`); await loadTpls(); UA.render(); toast('حُذف القالب'); } catch (e) { if (!e.status) throw e; toast(e.message); } };
  UA.forms.ctform = async () => {
    const e = B.tedit, v = (i) => $id(i).value, body = { name: v('ct-name'), category: v('ct-cat'), mode: v('ct-mode'), title: v('ct-title'), subject: v('ct-subject'), body: v('ct-body') };
    try {
      if (e.isNew) await api('POST', '/api/corr/templates', { ...body, code: v('ct-code').trim() });
      else await api('PUT', `/api/corr/templates/${e.code}`, body);
      B.tedit = null; B.err = ''; await loadTpls(); UA.render(); toast('حُفظ القالب');
    } catch (x) { if (!x.status) throw x; B.err = x.message; UA.render(); }
  };

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'cf-tpl' || !B.form) return;
    const t = (B.tpls || []).find((x) => x.code === e.target.value); if (!t) return;
    readForm(); Object.assign(B.form, { title: fill(t.title), subject: fill(t.subject), body: fill(t.body), mode: t.mode }); UA.render();
  });

  A.crfilter = async (el, d) => { B.filter = d.k; await loadList(); UA.render(); };
  A.cropen = async (el, d) => {
    if (d.n) await api('POST', '/api/corr/notifications/read', { ids: [Number(d.n)] });
    await open(Number(d.id));
    if (B.tab === 'notifs') B.tab = 'in';
    await refresh(); window.scrollTo(0, 0);
  };
  A.crclose = () => { B.doc = null; UA.render(); };
  A.crreadall = async () => { await api('POST', '/api/corr/notifications/read', { all: true }); await refresh(); };

  const act = (path, body, msg) => async () => {
    try { B.doc = (await api('POST', `/api/corr/${B.doc.id}/${path}`, body ? body() : {})).doc; await refresh(); toast(msg); }
    catch (e) { if (!e.status) throw e; toast(e.message); }
  };
  A.crapprove = () => act('approve', () => ({ note: $id('cr-note').value }), 'تم توقيع واعتماد الكتاب')();
  A.crreject = () => act('reject', () => ({ note: $id('cr-note').value }), 'تم رفض الكتاب')();
  A.crcomment = () => act('comment', () => ({ text: $id('cr-comment').value }), 'أُضيفت الحاشية / التعليق')();
  A.crsend = act('send', null, 'أُرسل الكتاب لسلسلة الاعتماد');
  A.crcancel = act('cancel', null, 'أُلغي الكتاب');
  A.cradd = () => { readForm(); const v = Number($id('cf-person').value); if (v) B.form.approvers.push(v); UA.render(); };
  A.crccadd = () => { readForm(); const v = Number($id('cf-cc').value); if (v) B.form.cc.push(v); UA.render(); };
  A.crccrm = (el, d) => { readForm(); B.form.cc.splice(Number(d.i), 1); UA.render(); };
  A.crfrm = (el, d) => { readForm(); B.form.remove.push(Number(d.id)); UA.render(); };
  A.credit = async () => {
    const d = B.doc; if (!d) return;
    if (!B.people) B.people = (await api('GET', '/api/corr/people')).people;
    await loadTpls();
    B.form = { editId: d.id, title: d.title, subject: d.subject || '', body: d.body || '', mode: d.mode, approvers: d.approvers.map((a) => a.id), cc: d.cc.map((c) => c.id), files: [], keep: d.files.map((f) => ({ id: f.id, name: f.name })), remove: [] };
    B.tab = 'new'; B.doc = null; B.err = ''; UA.render(); window.scrollTo(0, 0);
  };
  A.crcanceledit = async () => { const id = B.form && B.form.editId; B.form = null; B.tab = 'out'; await refresh(); if (id) await open(id, true); UA.render(); };
  A.crrm = (el, d) => { readForm(); B.form.approvers.splice(Number(d.i), 1); UA.render(); };
  const mv = (i, k) => { readForm(); const a = B.form.approvers, j = i + k; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; UA.render(); };
  A.crup = (el, d) => mv(Number(d.i), -1);
  A.crdown = (el, d) => mv(Number(d.i), 1);

  async function submit(send) {
    readForm(); const f = B.form; if (B.busy) return; B.busy = true; B.err = '';
    try {
      const files = [];
      for (const x of f.files) files.push({ name: x.name, data: await UA.readFile(x) });
      const body = { title: f.title, subject: f.subject, body: f.body, mode: f.mode, approvers: f.approvers, cc: f.cc, files, send };
      const r = f.editId ? await api('PUT', `/api/corr/${f.editId}`, { ...body, removeFiles: f.remove }) : await api('POST', '/api/corr', body);
      B.form = null; B.tab = 'out'; B.doc = r.doc; await refresh(); toast(send ? 'أُرسل الكتاب ' + r.doc.no : 'حُفظت المسودة ' + r.doc.no);
    } catch (e) { if (!e.status) throw e; B.err = e.message; } finally { B.busy = false; }
    if (B.err) UA.render();
  }
  UA.forms.crform = () => submit(true);
  A.crdraft = () => submit(false);
})();
