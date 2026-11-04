/**
 * Hover Prefetching — يُحمِّل بيانات التبويب مسبقاً عند التحويم لمدة 120ms
 * يُقلل وقت الاستجابة الظاهري بشكل ملحوظ عند التنقل بين الأقسام
 */
(function () {
  'use strict';

  const HOVER_DELAY_MS = 120;       // مدة الانتظار قبل الجلب المسبق
  const PREFETCH_TTL_MS = 30_000;   // صلاحية الكاش (30 ثانية)
  const MAX_CACHE_SIZE = 20;        // حد أقصى للعناصر المخزنة

  const prefetchCache = new Map();  // key → { data, ts }
  let hoverTimer = null;
  let currentHoverKey = null;

  // خريطة التبويب → نقطة نهاية API المقابلة
  const TAB_API_MAP = {
    dashboard:       '/api/dashboard',
    student:         '/api/students?limit=30',
    staff:           '/api/staff?limit=30',
    finance:         '/api/finance/summary',
    audit:           '/api/audit?limit=50',
    settings:        '/api/settings/general',
    faculty:         '/api/faculty',
    units:           '/api/units',
    payroll:         '/api/payroll/summary',
    attendance:      '/api/attendance/summary',
    procurement:     '/api/procurement/summary',
    correspondence:  '/api/correspondence?limit=20',
  };

  function getCacheKey(view, sub) {
    return sub ? `${view}:${sub}` : view;
  }

  function isFresh(entry) {
    return entry && (Date.now() - entry.ts) < PREFETCH_TTL_MS;
  }

  function evictOldest() {
    if (prefetchCache.size >= MAX_CACHE_SIZE) {
      const oldest = prefetchCache.keys().next().value;
      if (oldest) prefetchCache.delete(oldest);
    }
  }

  async function prefetchView(view, sub) {
    const key = getCacheKey(view, sub);
    if (isFresh(prefetchCache.get(key))) return; // مخزن مسبقاً وطازج

    const endpoint = TAB_API_MAP[view];
    if (!endpoint) return;

    // تجنب الجلب إذا كانت الجلسة منتهية
    const token = window.UA?.S?.token;
    if (!token) return;

    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers: { 'X-Prefetch': '1' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const data = await res.json();
      evictOldest();
      prefetchCache.set(key, { data, ts: Date.now() });
    } catch {
      // الجلب المسبق اختياري — تجاهل أي خطأ
    }
  }

  /**
   * هل البيانات المخزنة مسبقاً متاحة لهذا التبويب؟
   * يُستخدم من قِبَل UA.api لتسريع التحميل
   */
  function getPrefetched(view, sub) {
    const key = getCacheKey(view, sub);
    const entry = prefetchCache.get(key);
    if (isFresh(entry)) {
      prefetchCache.delete(key); // استخدام مرة واحدة
      return entry.data;
    }
    return null;
  }

  /** مسح كاش تبويب معين (بعد أي كتابة/تعديل) */
  function invalidatePrefetch(view) {
    for (const key of prefetchCache.keys()) {
      if (key === view || key.startsWith(view + ':')) {
        prefetchCache.delete(key);
      }
    }
  }

  /** تركيب مستمعات التحويم على الوثيقة بأسلوب التفويض */
  function attachHoverListeners() {
    document.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('[data-act="view"],[data-act="sttab"],[data-act="atab"],[data-act="audtab"]');
      if (!btn) return;

      const view = btn.dataset.v || btn.dataset.t;
      if (!view) return;

      const key = getCacheKey(view);
      if (isFresh(prefetchCache.get(key))) return; // طازج بالفعل

      if (currentHoverKey === key) return; // نفس العنصر
      currentHoverKey = key;

      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => prefetchView(view), HOVER_DELAY_MS);
    }, { passive: true });

    document.addEventListener('mouseout', (e) => {
      const btn = e.target.closest('[data-act="view"],[data-act="sttab"],[data-act="atab"],[data-act="audtab"]');
      if (!btn) return;
      clearTimeout(hoverTimer);
      currentHoverKey = null;
    }, { passive: true });
  }

  // انتظر اكتمال تحميل UA ثم ركِّب
  function init() {
    attachHoverListeners();

    // تصدير للاستخدام من UA.api
    if (window.UA) {
      window.UA.prefetch = { getPrefetched, invalidatePrefetch, prefetchView };
    } else {
      // UA لم يتهيأ بعد — أضِف بعد تهيؤه
      const origDefine = Object.getOwnPropertyDescriptor(window, 'UA');
      let _ua = window.UA;
      Object.defineProperty(window, 'UA', {
        configurable: true,
        enumerable: true,
        get() { return _ua; },
        set(v) {
          _ua = v;
          if (v && !v.prefetch) {
            v.prefetch = { getPrefetched, invalidatePrefetch, prefetchView };
          }
          // استعادة الخاصية العادية
          try {
            Object.defineProperty(window, 'UA', { configurable: true, enumerable: true, writable: true, value: _ua });
          } catch {}
        },
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
