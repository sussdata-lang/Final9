/* user_notifs.js — إشعارات داخل الموقع في جرس الشريط العلوي، وفتح الصفحة المقصودة من الإشعار أو من رابط تنبيه الجوال. */
'use strict';
(function () {
  const UA = window.UA = window.UA || {};
  const POLL_MS = 120000;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (t) => { try { return new Date(t).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };
  let state = { items: [], unread: 0 }, userId = null, painted = '', queued = false;

  async function refresh() {
    if (!UA.S || !UA.S.me) return;
    try {
      const r = await fetch('/api/notifications', { credentials: 'same-origin' });
      if (r.ok) { state = await r.json(); painted = ''; paint(); }
    } catch { /* الجرس لا يعطّل الصفحة عند انقطاع الاتصال */ }
  }
  const markRead = (body) => fetch('/api/notifications/read', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});

  function paint() {
    const pop = document.getElementById('sx-notif'), bell = document.querySelector('[data-sx="notif"]');
    if (!pop || !bell) return;
    const box = pop.querySelector('#un-box'), key = JSON.stringify([state.unread, state.items.map((n) => [n.id, n.read])]);
    if (box && painted === key && (!state.unread || bell.querySelector('.sx-dot'))) return;
    painted = key;
    if (box) box.remove();
    if (state.items.length) {
      pop.querySelector('strong').insertAdjacentHTML('afterend', `<div id="un-box" style="max-height:260px;overflow:auto;margin:.4rem 0">
        ${state.unread ? '<button type="button" class="btn sm" data-un-all="1" style="margin-bottom:.3rem">تحديد الكل كمقروء</button>' : ''}
        ${state.items.map((n) => `<button type="button" data-un="${n.id}" style="display:block;width:100%;text-align:start;background:none;border:0;border-bottom:1px solid var(--border,#DCE3DD);padding:.4rem .2rem;cursor:pointer;color:inherit;font:inherit${n.read ? ';opacity:.65' : ';font-weight:700'}">${esc(n.text)}<small style="display:block;font-weight:400;opacity:.7">${when(n.at)}</small></button>`).join('')}
      </div>`);
    }
    if (state.unread && !bell.querySelector('.sx-dot')) bell.insertAdjacentHTML('beforeend', '<i class="sx-dot"></i>');
  }

  // زر «النقاش» في أي شاشة: يفتح سجل النقاش والأنشطة في مركز العمل (platform.js يُحمَّل عند فتحه)
  UA.actions = UA.actions || {};
  UA.actions.recthread = (_el, d) => { UA.hubDeepLink = `?view=hub&rec=${d.m}:${d.id}`; return UA.go('hub'); };

  function openTarget(url) {
    const m = /[?&]view=lms&tab=assignments&id=(\d+)/.exec(url || '');
    if (m) { UA.lmsDeepLink = { id: Number(m[1]) }; return UA.go('lms'); }
    // تنبيهات مركز الأمان تفتح تبويبه في شاشة التدقيق
    if (/[?&]view=audit&tab=siem/.test(url || '')) { if (UA.S) UA.S.auditTab = 'siem'; return UA.go('audit'); }
    // مركز العمل: طلب موافقة أو نقاش سجل أو أنشطتي
    if (/[?&]view=hub/.test(url || '')) { UA.hubDeepLink = url; return UA.go('hub'); }
    return undefined;
  }

  document.addEventListener('click', (e) => {
    const all = e.target.closest && e.target.closest('[data-un-all]');
    if (all) { markRead({ all: true }).then(refresh); return; }
    const b = e.target.closest && e.target.closest('[data-un]');
    if (!b) return;
    const n = state.items.find((x) => String(x.id) === b.dataset.un);
    if (!n) return;
    markRead({ ids: [n.id] }).then(refresh);
    const pop = document.getElementById('sx-notif');
    if (pop) pop.hidden = true;
    openTarget(n.url);
  });

  // أول ظهور للمستخدم: جلب الإشعارات وتنفيذ رابط التنبيه إن فُتح التطبيق منه
  function onUser() {
    const me = UA.S && UA.S.me;
    if (!me) { userId = null; state = { items: [], unread: 0 }; return; }
    if (userId === me.id) return;
    userId = me.id;
    refresh();
    if (/[?&]view=(lms&tab=assignments&id=\d+|audit&tab=siem)/.test(location.search) && UA.go) {
      const url = location.search;
      history.replaceState(null, '', location.pathname);
      openTarget(url);
    }
  }

  function start() {
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; onUser(); paint(); });
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    onUser();
  }
  if (typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
  UA.userNotifs = { refresh };
})();
