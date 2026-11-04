/* القالب الموحد لشاشات الإدخال والطلبات: رأس، حالة الاعتماد، تفاصيل الطلب، التبرير، ثم أزرار الإجراء، بالترتيب نفسه في كل شاشة.
   UA.formKit.render({ id, title, hint, status, steps, sections, justification, actions, as, bare }) يعيد HTML، والحقول HTML جاهز من الشاشة.
   as: 'div' حين تتولى الأزرار الحفظ بلا إرسال نموذج، وbare داخل النوافذ المنبثقة، وwide في القسم لعرضه بلا أعمدة. */
(function () {
  const UA = window.UA, { esc } = UA;
  const STATUS = { draft: ['مسودة', 'p-review'], pending: ['قيد الاعتماد', 'p-review'], review: ['قيد المراجعة', 'p-review'], approved: ['معتمد', 'p-approved'], rejected: ['مرفوض', 'p-rejected'], cancelled: ['ملغى', 'p-rejected'] };
  function steps(list) {
    if (!list || !list.length) return '';
    return `<ol class="uf-steps" aria-label="حالة الاعتماد">${list.map((s) => `<li class="${esc(s.state || '')}"${s.state === 'cur' ? ' aria-current="step"' : ''}>${esc(s.label)}</li>`).join('')}</ol>`;
  }
  function render({ id, title, hint, status, steps: flow, sections = [], justification, actions = '', as = 'form', bare = false }) {
    const st = STATUS[status];
    const tag = as === 'div' ? 'div' : 'form';
    return `<${tag} class="uf${bare ? ' bare' : ''}"${id ? ` id="${esc(id)}"` : ''}>
      ${title || hint || st ? `<div class="uf-head"><div>${title ? `<h3>${esc(title)}</h3>` : ''}${hint ? `<p class="hint" style="margin:4px 0 0">${esc(hint)}</p>` : ''}</div>${st ? `<span class="pill ${st[1]}">${esc(st[0])}</span>` : ''}</div>` : ''}
      ${flow && flow.length ? `<fieldset class="uf-sec"><legend>حالة الاعتماد</legend>${steps(flow)}</fieldset>` : ''}
      ${sections.map((s) => `<fieldset class="uf-sec">${s.title ? `<legend>${esc(s.title)}</legend>` : ''}${s.wide ? s.html : `<div class="uf-grid">${s.html}</div>`}</fieldset>`).join('')}
      ${justification ? `<fieldset class="uf-sec"><legend>التبرير</legend><label>${esc(justification.label || 'سبب الطلب')}<textarea id="${esc(justification.id)}" rows="2" maxlength="${justification.max || 500}"${justification.required ? ' required' : ''}>${esc(justification.value || '')}</textarea></label></fieldset>` : ''}
      <div class="uf-actions">${actions}</div>
    </${tag}>`;
  }
  UA.formKit = { render, steps };
})();
