/* التعبئة التلقائية في القوائم المنسدلة: كل قائمة من 4 خيارات فأكثر تصير حقلاً يُكتب فيه للبحث، وتبقى القائمة الأصلية مخفية هي مصدر القيمة،
   فلا يتغير شيء في النماذج التي تقرأ منها. القائمة تُستثنى بـ data-no-combo. */
(function () {
  const UA = window.UA;
  const MIN_OPTIONS = 4;
  const fold = (s) => String(s ?? '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
  UA.comboFold = fold;
  let open = null, seq = 0;
  const bound = new WeakSet();   // cloneNode ينسخ العلامة والحقل بلا مستمعاته، فلا تكفي العلامة وحدها

  const tr = (s) => (UA.i18n ? UA.i18n.tr(s) : s);
  const labelOf = (sel) => { const o = sel.options[sel.selectedIndex]; return o && o.value !== '' ? tr(o.textContent.trim()) : ''; };
  const eligible = (sel) => !sel.multiple && !bound.has(sel) && !sel.dataset.noCombo && !sel.classList.contains('tf-ps') && sel.options.length >= MIN_OPTIONS && !sel.closest('.no-print-combo');

  function closeList(restore = true) {
    if (!open) return;
    const { list, input, sel } = open;
    list.remove();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (restore) input.value = labelOf(sel);
    open = null;
  }
  function choose(sel, input, option) {
    const changed = sel.value !== option.value;
    sel.value = option.value;
    input.value = labelOf(sel);
    closeList(false);
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function place(list, input) {
    const r = input.getBoundingClientRect(), below = window.innerHeight - r.bottom;
    list.style.width = `${r.width}px`;
    list.style.left = `${r.left}px`;
    if (below < 200 && r.top > below) { list.style.top = ''; list.style.bottom = `${window.innerHeight - r.top + 2}px`; list.style.maxHeight = `${Math.max(120, r.top - 12)}px`; }
    else { list.style.bottom = ''; list.style.top = `${r.bottom + 2}px`; list.style.maxHeight = `${Math.max(120, Math.min(280, below - 12))}px`; }
  }
  function draw(q) {
    const { list, sel, input } = open, needle = fold(q);
    list.innerHTML = '';
    open.items = [];
    let lastGroup = null;
    for (const o of sel.options) {
      if (o.hidden || o.disabled || (needle && !fold(tr(o.textContent)).includes(needle))) continue;
      const group = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? tr(o.parentElement.label) : null;
      if (group && group !== lastGroup) { const g = document.createElement('li'); g.className = 'ua-combo-group'; g.textContent = group; g.setAttribute('role', 'presentation'); list.appendChild(g); }
      lastGroup = group;
      const li = document.createElement('li');
      li.id = `ua-combo-opt-${++seq}`;
      li.className = 'ua-combo-opt';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(o.selected));
      li.textContent = tr(o.textContent.trim()) || '—';
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(sel, input, o); });
      list.appendChild(li);
      open.items.push({ li, o });
    }
    if (!open.items.length) { const e = document.createElement('li'); e.className = 'ua-combo-empty'; e.textContent = tr('لا نتائج'); list.appendChild(e); }
    open.active = -1;
    place(list, input);
  }
  function openList(sel, input, q = '') {
    if (open && open.input === input) { draw(q); return; }
    closeList();
    const list = document.createElement('ul');
    list.className = 'ua-combo-list';
    list.id = 'ua-combo-list';
    list.setAttribute('role', 'listbox');
    // داخل النافذة المنبثقة حتى يظهر فوقها
    (input.closest('dialog') || document.body).appendChild(list);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', list.id);
    open = { list, input, sel, items: [], active: -1 };
    draw(q);
  }
  function move(delta) {
    const { items } = open; if (!items.length) return;
    if (items[open.active]) items[open.active].li.classList.remove('on');
    open.active = (open.active + delta + items.length) % items.length;
    const cur = items[open.active];
    cur.li.classList.add('on');
    cur.li.scrollIntoView({ block: 'nearest' });
    open.input.setAttribute('aria-activedescendant', cur.li.id);
  }

  function enhance(sel) {
    if (sel.dataset.combo && sel.previousElementSibling && sel.previousElementSibling.classList.contains('ua-combo')) sel.previousElementSibling.remove();
    bound.add(sel);
    sel.dataset.combo = '1';
    const wrap = document.createElement('span');
    wrap.className = 'ua-combo';
    if (sel.style.minWidth) wrap.style.minWidth = sel.style.minWidth;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ua-combo-input';
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.placeholder = sel.options[0] && sel.options[0].value === '' ? tr(sel.options[0].textContent.trim()) : tr('اكتب للبحث أو اختر…');
    input.value = labelOf(sel);
    input.disabled = sel.disabled;
    if (sel.required || sel.dataset.comboReq) { input.required = true; sel.required = false; sel.dataset.comboReq = '1'; }   // الحقل المخفي الإلزامي يمنع إرسال النموذج بلا رسالة
    wrap.appendChild(input);
    sel.before(wrap);
    sel.style.display = 'none';
    input.addEventListener('focus', () => { input.select(); openList(sel, input); });
    input.addEventListener('click', () => { if (!open || open.input !== input) openList(sel, input); });
    input.addEventListener('input', () => openList(sel, input, input.value));
    input.addEventListener('blur', () => closeList());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) openList(sel, input); move(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter' && open) { e.preventDefault(); const it = open.items[open.active] || (open.items.length === 1 ? open.items[0] : null); if (it) choose(sel, input, it.o); }
      else if (e.key === 'Escape' && open) { e.stopPropagation(); closeList(); }
    });
    sel.addEventListener('change', () => { if (document.activeElement !== input) input.value = labelOf(sel); });
  }

  function scan(root = document) {
    root.querySelectorAll('select').forEach((sel) => {
      if (eligible(sel)) enhance(sel);
      else if (sel.dataset.combo) {
        // تغيير القيمة أو الخيارات برمجياً يظهر في الحقل
        const input = sel.previousElementSibling && sel.previousElementSibling.querySelector('.ua-combo-input');
        if (input && document.activeElement !== input) { input.value = labelOf(sel); input.disabled = sel.disabled; }
      }
    });
  }
  UA.enhanceCombos = scan;

  let queued = false;
  const queue = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; scan(); }); };
  const start = () => { scan(); new MutationObserver(queue).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('scroll', (e) => { if (open && !(e.target && open.list.contains && e.target === open.list)) closeList(); }, true);
  window.addEventListener('resize', () => closeList());
})();
