/**
 * notify.js — نظام الإشعارات الغنية (Rich Notification Toast)
 * =============================================================
 * أنواع: success | error | warning | info
 * يعوّض toast() البسيط بمستطيل أنيق مع أيقونة + شريط تقدم + إغلاق يدوي
 * متوافق تماماً مع الكود الحالي: window.toast() تُستدعى كالمعتاد
 */

(function () {
  'use strict';

  // ── الثوابت ──────────────────────────────────────────────────
  const DURATION    = 3800;   // مدة العرض الافتراضية (ms)
  const MAX_VISIBLE = 5;      // أقصى عدد إشعارات مرئية في نفس الوقت
  const CONTAINER_ID = 'notify-container';

  // ── الأيقونات ────────────────────────────────────────────────
  const ICONS = {
    success: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8.5"/><path d="M6.5 10.5l2.5 2.5 4.5-5"/></svg>`,
    error:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8.5"/><path d="M10 6.5v4M10 13.5h.01"/></svg>`,
    warning: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5L18 17H2L10 2.5z"/><path d="M10 8.5v3.5M10 14.5h.01"/></svg>`,
    info:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8.5"/><path d="M10 9.5v5M10 6.5h.01"/></svg>`,
  };

  // ── كلمات مفتاحية لاكتشاف النوع تلقائياً من النص ───────────
  function detectType(msg) {
    const m = msg.toLowerCase();
    if (/تعذّر|تعذر|فشل|خطأ|خطا|error|مرفوض|غير صحيح|لم يتم|لا يمكن/.test(m)) return 'error';
    if (/تحذير|warning|انتبه|ملاحظة|تنبيه/.test(m)) return 'warning';
    if (/تم |حُفظ|اعتُمد|نجح|أُضيف|حُذف|استُعيد|أُرسل|أُنجز|تمت |تمّت/.test(m)) return 'success';
    return 'info';
  }

  // ── إنشاء حاوية الإشعارات ────────────────────────────────────
  function getContainer() {
    let c = document.getElementById(CONTAINER_ID);
    if (!c) {
      c = document.createElement('div');
      c.id = CONTAINER_ID;
      c.className = 'notify-container';
      c.setAttribute('aria-live', 'polite');
      c.setAttribute('aria-atomic', 'false');
      c.setAttribute('role', 'region');
      c.setAttribute('aria-label', 'إشعارات النظام');
      document.body.appendChild(c);
    }
    return c;
  }

  // ── إنشاء وعرض إشعار ─────────────────────────────────────────
  function notify(msg, type, duration) {
    if (!msg) return;
    type = type || detectType(msg);
    duration = (duration === undefined) ? DURATION : duration;

    const container = getContainer();

    // إزالة أقدم إشعار إذا وصلنا للحد
    const existing = [...container.querySelectorAll('.notify-item')];
    if (existing.length >= MAX_VISIBLE) {
      dismiss(existing[0]);
    }

    // ── بناء عنصر الإشعار ─────────────────────────────────────
    const item = document.createElement('div');
    item.className = `notify-item notify-item--${type}`;
    item.setAttribute('role', 'alert');
    item.setAttribute('aria-live', 'assertive');
    item.innerHTML = `
      <span class="notify-icon" aria-hidden="true">${ICONS[type]}</span>
      <span class="notify-body">
        <span class="notify-label">${_typeLabel(type)}</span>
        <span class="notify-msg">${_esc(msg)}</span>
      </span>
      <button class="notify-close" type="button" aria-label="إغلاق الإشعار" title="إغلاق">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
      </button>
      <span class="notify-progress" aria-hidden="true"></span>
    `;

    // زر الإغلاق اليدوي
    item.querySelector('.notify-close').addEventListener('click', () => dismiss(item));

    // إيقاف العداد عند التحويم
    item.addEventListener('mouseenter', () => {
      item._paused = true;
      const p = item.querySelector('.notify-progress');
      if (p) p.style.animationPlayState = 'paused';
    });
    item.addEventListener('mouseleave', () => {
      item._paused = false;
      const p = item.querySelector('.notify-progress');
      if (p) p.style.animationPlayState = 'running';
    });

    container.appendChild(item);

    // تشغيل animation الدخول في الإطار التالي
    requestAnimationFrame(() => {
      requestAnimationFrame(() => item.classList.add('notify-item--in'));
    });

    // شريط التقدم + إغلاق تلقائي
    if (duration > 0) {
      const prog = item.querySelector('.notify-progress');
      if (prog) {
        prog.style.animationDuration = duration + 'ms';
        prog.classList.add('notify-progress--run');
      }
      item._timer = setTimeout(() => {
        if (!item._paused) dismiss(item);
        else {
          // إذا كانت مؤقتة بسبب التحويم، انتظر انتهاءه
          const wait = setInterval(() => {
            if (!item._paused) { clearInterval(wait); dismiss(item); }
          }, 300);
        }
      }, duration);
    }

    return item;
  }

  function _typeLabel(type) {
    return { success: 'تم بنجاح', error: 'خطأ', warning: 'تنبيه', info: 'معلومة' }[type] || '';
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function dismiss(item) {
    if (item._dismissed) return;
    item._dismissed = true;
    clearTimeout(item._timer);
    item.classList.remove('notify-item--in');
    item.classList.add('notify-item--out');
    item.addEventListener('animationend', () => item.remove(), { once: true });
    // fallback إذا animation لم تُطلق
    setTimeout(() => item.remove(), 400);
  }

  // ── API العامة ────────────────────────────────────────────────
  const Notify = {
    show:    (msg, type, dur)  => notify(msg, type, dur),
    success: (msg, dur)        => notify(msg, 'success', dur),
    error:   (msg, dur)        => notify(msg, 'error', dur ?? 5000),
    warning: (msg, dur)        => notify(msg, 'warning', dur),
    info:    (msg, dur)        => notify(msg, 'info', dur),
    dismiss,
  };

  // ── تعويض toast() الحالي ──────────────────────────────────────
  // يحافظ على التوافق الكامل مع كل استدعاء toast(msg) في app.js
  window.toast = function (msg, type, dur) {
    return notify(msg, type, dur);
  };

  // إخفاء العنصر القديم #toast إن وُجد
  const oldToast = document.getElementById('toast');
  if (oldToast) oldToast.style.display = 'none';

  // ── تصدير ────────────────────────────────────────────────────
  window.Notify = Notify;

  // ── مراقبة دوام إخفاء #toast القديم ─────────────────────────
  // (بعض ملفات JS قد تُظهره مباشرة)
  const legacyObs = new MutationObserver(() => {
    const t = document.getElementById('toast');
    if (t && !t.hidden && t.firstChild?.textContent) {
      notify(t.firstChild.textContent);
      t.hidden = true;
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const t = document.getElementById('toast');
    if (t) {
      t.style.display = 'none';
      legacyObs.observe(t, { attributes: true, childList: true, subtree: true });
    }
  });

})();
