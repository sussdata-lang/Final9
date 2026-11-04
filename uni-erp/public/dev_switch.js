/* تبويب تبديل الحساب للرابط المحلي فقط: لا يظهر إلا على عنوان محلي وإذا وُجد مساره في الخادم (لا يُسجَّل المسار في أي نشر). */
(function () {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let accounts = null, open = false;
  const paint = () => {
    let bar = document.getElementById('ux-dev-switch');
    if (!bar) { bar = document.createElement('div'); bar.id = 'ux-dev-switch'; bar.className = 'ux-dev-switch no-print'; document.body.appendChild(bar); }
    const me = window.UA && window.UA.S && window.UA.S.me;
    bar.innerHTML = `<button type="button" class="ux-dev-toggle" data-dev-toggle aria-expanded="${open}">تبديل الحساب (محلي)</button>${open ? `<div class="ux-dev-tabs" role="tablist" aria-label="تبديل الحساب">${accounts.map((a) => `<button type="button" role="tab" data-dev-key="${esc(a.key)}" aria-selected="${!!me && me.username === a.username}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
  };
  async function start() {
    try {
      const r = await fetch('/api/local-accounts', { credentials: 'same-origin' });
      if (!r.ok) return;
      accounts = (await r.json()).accounts;
      if (accounts.length) paint();
    } catch { /* المسار غير موجود: لا تبويب */ }
  }
  document.addEventListener('click', async (e) => {
    const toggle = e.target.closest && e.target.closest('[data-dev-toggle]');
    if (toggle) { open = !open; paint(); return; }
    const b = e.target.closest && e.target.closest('[data-dev-key]');
    if (!b) return;
    b.disabled = true;
    const r = await fetch('/api/local-switch', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: b.dataset.devKey }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { b.disabled = false; window.alert((j && j.message) || 'تعذّر تبديل الحساب.'); return; }
    try { sessionStorage.setItem('uni_sid', j.token); } catch { /* غير متاح */ }
    location.replace(`${location.pathname}${location.search}`);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
