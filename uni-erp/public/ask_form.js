/* نموذج منبثق موحّد بدل نوافذ المتصفح: يعرض كل الحقول معًا، ويعيد القيم أو null عند الإلغاء.
   askForm({ title, submit, fields: [{ name, label, type, value, options, required, min, max, minLength, hint, placeholder }] }) */
import { html, render, useEffect, useRef } from './ui/core.js';

function Field({ f }) {
  const id = `ask-${f.name}`;
  const common = { id, name: f.name, required: !!f.required };
  let control;
  if (f.type === 'select') {
    control = html`<select ...${common}>
      ${f.options.map((o) => { const v = o.value ?? o; return html`<option value=${v} selected=${String(v) === String(f.value ?? '')}>${o.label ?? o}</option>`; })}
    </select>`;
  } else if (f.type === 'textarea') {
    control = html`<textarea ...${common} rows="3" minlength=${f.minLength} placeholder=${f.placeholder}>${f.value ?? ''}</textarea>`;
  } else {
    control = html`<input ...${common} type=${f.type || 'text'} value=${f.value ?? ''} minlength=${f.minLength} min=${f.min} max=${f.max} placeholder=${f.placeholder} dir=${f.dir} />`;
  }
  return html`<label for=${id}>${f.label}${control}${f.hint ? html`<small class="hint">${f.hint}</small>` : null}</label>`;
}

function AskDialog({ title, submit, fields, onDone }) {
  const dlg = useRef(null), result = useRef(null);
  useEffect(() => { dlg.current.showModal(); }, []);
  const send = (e) => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const v = e.target.elements[f.name].value;
      out[f.name] = f.type === 'number' ? Number(v) : v.trim();
    }
    result.current = out;
    dlg.current.close();
  };
  // زر الهروب يغلق هذا النموذج فقط، لا النافذة التي تحته
  return html`<dialog ref=${dlg} class="ask-dialog" dir="rtl" onKeyDown=${(e) => { if (e.key === 'Escape') e.stopPropagation(); }} onClose=${() => onDone(result.current)}>
    <form class="ask-form" onSubmit=${send}>
      <h2>${title}</h2>
      ${fields.map((f) => html`<${Field} key=${f.name} f=${f} />`)}
      <div class="ask-actions">
        <button type="submit" class="btn pri">${submit}</button>
        <button type="button" class="btn" data-ask-cancel onClick=${() => dlg.current.close()}>إلغاء</button>
      </div>
    </form>
  </dialog>`;
}

window.askForm = ({ title, submit = 'حفظ', fields }) => new Promise((resolve) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(html`<${AskDialog} title=${title} submit=${submit} fields=${fields} onDone=${(v) => { render(null, host); host.remove(); resolve(v); }} />`, host);
});

// حقل واحد: يعيد النص أو null
window.askText = async (title, opts = {}) => {
  const r = await window.askForm({ title, submit: opts.submit, fields: [{ name: 'v', label: opts.label ?? title, required: true, ...opts }] });
  return r ? r.v : null;
};
