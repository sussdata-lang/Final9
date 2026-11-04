/* شاشة قواعد الفحص الآلي: إنشاء وتعديل من حقول واضحة بحسب نوع القاعدة بدل كتابة JSON. */
(function () {
  const UA = window.UA, { esc, api, toast } = UA;
  const state = { kinds: null, services: [], form: null };

  const kindOf = (k) => (state.kinds || []).find((x) => x.kind === k);
  // وصف مقروء لمعاملات القاعدة
  function describe(rule) {
    const def = kindOf(rule.kind);
    if (!def) return esc(rule.kind);
    let params = {}; try { params = JSON.parse(rule.params || '{}'); } catch { /* تُعرض بلا معاملات */ }
    const parts = def.fields.map((f) => {
      const v = params[f.name];
      if (f.type === 'select') return f.options[v] ?? v;
      if (f.type === 'multi') return (v || []).map((x) => f.options[x] ?? x).join('، ');
      return `${f.label}: ${v}`;
    });
    return `<b>${esc(def.label)}</b>${parts.length ? `<div class="small">${esc(parts.join(' · '))}</div>` : ''}`;
  }
  function fieldHtml(f, value) {
    const id = `rl-f-${f.name}`;
    if (f.type === 'select') return `<label>${esc(f.label)}<select id="${id}" data-no-other="1">${Object.entries(f.options).map(([k, l]) => `<option value="${esc(k)}"${value === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    if (f.type === 'multi') return `<fieldset class="perm-g" style="margin:0"><legend>${esc(f.label)}</legend>${Object.entries(f.options).map(([k, l]) => `<label class="perm"><input type="checkbox" data-rl-multi="${esc(f.name)}" value="${esc(k)}"${(value || []).includes(k) ? ' checked' : ''}> <span>${esc(l)}</span></label>`).join('')}</fieldset>`;
    return `<label>${esc(f.label)}<input id="${id}" type="number" min="${f.min}" max="${f.max}" step="${f.type === 'int' ? 1 : 'any'}" value="${value ?? ''}" required></label>`;
  }
  function formHtml() {
    const fm = state.form;
    if (!fm) return '';
    const def = kindOf(fm.kind), editing = !!fm.id;
    return `<section class="card" id="rl-editor"><h3 style="margin-top:0">${editing ? 'تعديل قاعدة' : 'قاعدة جديدة'}</h3>
      <form class="form" id="rule-form" style="border:0;margin:0;padding:0">
        <div class="inline-form">
          <label>نوع القاعدة<select id="rl-kind" data-chg="rl-kind" data-no-other="1"${editing ? ' disabled' : ''}>${state.kinds.map((k) => `<option value="${esc(k.kind)}"${k.kind === fm.kind ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
          <label>الخدمة<select id="rl-service" data-no-other="1"${editing ? ' disabled' : ''}><option value="">كل الخدمات</option>${state.services.map((s) => `<option value="${esc(s.code)}"${s.code === fm.service ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
        </div>
        ${def ? `<p class="hint" style="margin:6px 0">${esc(def.desc)}</p>${def.fields.map((f) => fieldHtml(f, fm.params[f.name])).join('')}` : ''}
        <label>رسالة الرفض التي تظهر لمقدم الطلب<input id="rl-message" maxlength="300" required value="${esc(fm.message || '')}"></label>
        <div class="actions" style="margin:0"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="rl-cancel">إلغاء</button></div>
      </form></section>`;
  }

  UA.rulesAdminView = (rules) => {
    if (!state.kinds) { loadMeta(); return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>'; }
    const row = (r) => `<tr><td>${describe(r)}</td><td>${esc(state.services.find((s) => s.code === r.service)?.label ?? r.service ?? 'كل الخدمات')}</td><td>${esc(r.message)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="rule" data-id="${r.id}" data-on="${r.enabled ? 0 : 1}">${r.enabled ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm" data-act="rl-edit" data-id="${r.id}">تعديل</button> <button class="btn sm bad" data-act="delrule" data-id="${r.id}">حذف</button></td></tr>`;
    return `${formHtml()}<section class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">قواعد الفحص الآلي</h2><p class="hint" style="margin:4px 0 0">تُطبَّق على كل طلب قبل وصوله للموظف، بالترتيب، وأول قاعدة مخالفة ترفض الطلب برسالتها. كل تغيير يُسجَّل في سجل التدقيق.</p></div>
        <button class="btn pri" type="button" data-act="rl-new">＋ قاعدة جديدة</button>
      </div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>القاعدة</th><th>الخدمة</th><th>رسالة الرفض</th><th></th></tr></thead><tbody>${(rules || []).map(row).join('') || '<tr><td colspan="4" class="hint">لا توجد قواعد.</td></tr>'}</tbody></table></div>
    </section>`;
  };
  async function loadMeta() {
    try {
      const [k, s] = await Promise.all([api('GET', '/api/admin/rules/kinds'), api('GET', '/api/admin/services')]);
      state.kinds = k.kinds; state.services = s.services || [];
    } catch (e) { if (!e.status) throw e; state.kinds = []; toast(e.message); }
    UA.render();
  }
  const readParams = (def) => {
    const out = {};
    for (const f of def.fields) {
      if (f.type === 'multi') out[f.name] = [...document.querySelectorAll(`[data-rl-multi="${f.name}"]:checked`)].map((b) => b.value);
      else out[f.name] = (document.getElementById(`rl-f-${f.name}`) || {}).value;
    }
    return out;
  };

  UA.forms['rule-form'] = async () => {
    const fm = state.form, def = kindOf(fm.kind), params = readParams(def), message = document.getElementById('rl-message').value;
    if (fm.id) await api('PUT', `/api/admin/rules/${fm.id}`, { message, params });
    else await api('POST', '/api/admin/rules', { kind: fm.kind, service: document.getElementById('rl-service').value || null, message, params });
    state.form = null;
    await UA.loaders.admin();
    UA.render();
    toast('حُفظت القاعدة');
  };
  Object.assign(UA.actions, {
    'rl-new': () => { state.form = { kind: state.kinds[0].kind, service: '', params: {}, message: '' }; UA.render(); document.getElementById('rl-editor')?.scrollIntoView({ block: 'start' }); },
    'rl-edit': (el, d) => {
      const r = (UA.S.admin.rules || []).find((x) => x.id === Number(d.id)); if (!r) return;
      let params = {}; try { params = JSON.parse(r.params || '{}'); } catch { /* تبقى الحقول فارغة */ }
      state.form = { id: r.id, kind: r.kind, service: r.service || '', params, message: r.message };
      UA.render(); document.getElementById('rl-editor')?.scrollIntoView({ block: 'start' });
    },
    'rl-cancel': () => { state.form = null; UA.render(); },
  });
  document.addEventListener('change', (e) => {
    if (e.target && e.target.dataset && e.target.dataset.chg === 'rl-kind' && state.form) { state.form = { ...state.form, kind: e.target.value, params: {}, message: document.getElementById('rl-message').value }; UA.render(); }
  });
})();
