/**
 * ux_enhancements.js — حزمة تحسينات تجربة المستخدم الشاملة v1.0
 * ================================================================
 * 1. Sticky Sub-Tabs Bar          — تثبيت شريط التبويبات الفرعية
 * 2. Workspace Tabs Bar + Pinning — شريط التبويبات المفتوحة والمثبتة
 * 3. Live Action Badges           — شارات العدّ التنبيهية الحية
 * 4. Ctrl+K Command Palette       — نافذة الأوامر والوصول السريع
 * 5. Collapsible Sidebar          — طي/توسيع القائمة الجانبية
 * 6. Accessibility Controls       — أزرار A+/A- وكثافة الجداول
 * 7. Keyboard Navigation          — Alt+1..9 والأسهم بين التبويبات
 * 8. Auto-Save Form Drafts        — حفظ مسودات النماذج تلقائياً
 * 9. Smooth Micro-Transitions     — انتقالات ناعمة وSkeleton Loaders
 * 10. Sticky Table Headers        — تثبيت ترويسات الجداول الطويلة
 */

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════
  // § أدوات مساعدة
  // ════════════════════════════════════════════════════════════
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const LS = {
    get: (k, def) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ════════════════════════════════════════════════════════════
  // § 1. Sticky Sub-Tabs Bar
  // تثبيت شريط التبويبات الفرعية مع خلفية ضبابية
  // ════════════════════════════════════════════════════════════
  function initStickySubTabs() {
    const obs = new MutationObserver(() => {
      $$('.sub-tabs').forEach(bar => {
        if (bar.dataset.sticky) return;
        bar.dataset.sticky = '1';
        bar.classList.add('sub-tabs--sticky');
        // حساب top ديناميكي بعد رسم الـ .top header
        requestAnimationFrame(() => {
          const top = $('.top');
          if (top) {
            const h = top.getBoundingClientRect().height;
            bar.style.setProperty('--sticky-top', h + 'px');
          }
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ════════════════════════════════════════════════════════════
  // § 2. Workspace Tabs Bar + Pinning
  // شريط التبويبات المفتوحة أعلى الشاشة مع حفظ موضع التمرير والفلاتر
  // ════════════════════════════════════════════════════════════
  const WorkspaceTabs = (() => {
    const MAX_RECENT = 8;
    let recent = LS.get('ws_recent_tabs', []);
    let pinned = LS.get('ws_pinned_tabs', []);
    let scrollPos = LS.get('ws_scroll_pos', {});
    let filterState = LS.get('ws_filter_state', {});
    let bar = null;

    // معلومات التبويبات المعروفة
    const TAB_LABELS = {
      desk:      { label: 'الديوان', icon: '📋', sub: 'وارد' },
      student:   { label: 'الطلاب', icon: '🎓', sub: 'سجل 360' },
      finance:   { label: 'المالية', icon: '💰', sub: 'سندات' },
      staff:     { label: 'الموظفون', icon: '👤', sub: '' },
      payroll:   { label: 'الرواتب', icon: '💵', sub: '' },
      corr:      { label: 'المراسلات', icon: '✉️', sub: '' },
      general:   { label: 'الخدمات', icon: '⚙️', sub: '' },
      admin:     { label: 'الإدارة', icon: '🛡️', sub: '' },
    };

    function addRecent(tabId, subTab = '') {
      const key = subTab ? `${tabId}:${subTab}` : tabId;
      recent = [key, ...recent.filter(k => k !== key)].slice(0, MAX_RECENT);
      LS.set('ws_recent_tabs', recent);
      render();
    }

    function togglePin(key) {
      if (pinned.includes(key)) {
        pinned = pinned.filter(k => k !== key);
      } else {
        pinned = [key, ...pinned].slice(0, 6);
      }
      LS.set('ws_pinned_tabs', pinned);
      render();
    }

    function saveScroll(key) {
      scrollPos[key] = window.scrollY;
      LS.set('ws_scroll_pos', scrollPos);
    }

    function restoreScroll(key) {
      const y = scrollPos[key];
      if (y !== undefined) setTimeout(() => window.scrollTo({ top: y, behavior: 'instant' }), 80);
    }

    function saveFilters(key, state) {
      filterState[key] = state;
      LS.set('ws_filter_state', filterState);
    }

    function getFilters(key) {
      return filterState[key] || null;
    }

    function getLabelInfo(key) {
      const [tabId] = key.split(':');
      const info = TAB_LABELS[tabId] || { label: tabId, icon: '📄', sub: '' };
      return info;
    }

    function render() {
      if (!bar) return;
      const allKeys = [...new Set([...pinned, ...recent])];
      if (allKeys.length === 0) { bar.style.display = 'none'; return; }
      bar.style.display = '';

      const list = bar.querySelector('.ws-tabs__list');
      list.innerHTML = '';

      allKeys.forEach(key => {
        const isPinned = pinned.includes(key);
        const info = getLabelInfo(key);
        const [tabId, subTab] = key.split(':');
        const li = document.createElement('li');
        li.className = 'ws-tab' + (isPinned ? ' ws-tab--pinned' : '');
        li.setAttribute('title', `${info.label}${subTab ? ' · ' + subTab : ''}`);
        li.innerHTML = `
          <button class="ws-tab__btn" data-tab="${tabId}" data-sub="${subTab || ''}">
            <span class="ws-tab__icon">${info.icon}</span>
            <span class="ws-tab__label">${info.label}${subTab ? ' <small>' + subTab + '</small>' : ''}</span>
            <span class="ws-tab__badge" data-badge-key="${key}" hidden></span>
          </button>
          <button class="ws-tab__pin" title="${isPinned ? 'إلغاء التثبيت' : 'تثبيت'}" data-key="${key}">
            ${isPinned ? '📌' : '📍'}
          </button>
        `;
        list.appendChild(li);
      });

      // حدث التنقل
      list.onclick = (e) => {
        const tabBtn = e.target.closest('.ws-tab__btn');
        const pinBtn = e.target.closest('.ws-tab__pin');
        if (tabBtn) {
          const { tab, sub } = tabBtn.dataset;
          const currentKey = LS.get('ws_current', '');
          if (currentKey) saveScroll(currentKey);
          navigateTo(tab, sub);
        }
        if (pinBtn) {
          togglePin(pinBtn.dataset.key);
        }
      };
    }

    function navigateTo(tabId, subTab) {
      // استدعاء نظام التنقل الموجود في التطبيق
      if (window.UA?.nav) {
        window.UA.nav(tabId);
        if (subTab && window.UA?.setSubTab) {
          setTimeout(() => window.UA.setSubTab(subTab), 100);
        }
      } else {
        // fallback: محاكاة النقر على .tab
        const tabEl = $$(`.tab[data-tab="${tabId}"],.tab[data-section="${tabId}"]`)[0];
        if (tabEl) tabEl.click();
      }
      const key = subTab ? `${tabId}:${subTab}` : tabId;
      LS.set('ws_current', key);
      restoreScroll(key);
    }

    function mount() {
      if ($('#ws-tabs-bar')) return;
      bar = document.createElement('nav');
      bar.id = 'ws-tabs-bar';
      bar.className = 'ws-tabs-bar';
      bar.setAttribute('aria-label', 'التبويبات المفتوحة والمثبتة');
      bar.innerHTML = `
        <div class="ws-tabs__inner">
          <span class="ws-tabs__label">⚡</span>
          <ul class="ws-tabs__list"></ul>
        </div>
      `;
      bar.style.display = 'none';
      // إدخال بعد .top مباشرة
      const top = $('.top');
      if (top) top.after(bar);
      else document.body.prepend(bar);
      render();
    }

    // الاستماع لأحداث تغيير التبويب
    document.addEventListener('ua:tabchange', (e) => {
      const { tab, sub } = e.detail || {};
      if (tab) {
        const key = sub ? `${tab}:${sub}` : tab;
        LS.set('ws_current', key);
        addRecent(tab, sub);
      }
    });

    // مراقبة النقر على .tab لاكتشاف التنقل
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="view"],[data-act="sttab"],[data-act="atab"],[data-act="audtab"],.tab[data-tab],.tab[data-section]');
      if (btn) {
        const tabId = btn.dataset.tab || btn.dataset.section || btn.dataset.act;
        const subTab = btn.dataset.sub || '';
        if (tabId && tabId !== 'view') addRecent(tabId, subTab);
      }
    }, true);

    return { mount, addRecent, togglePin, saveFilters, getFilters, navigateTo };
  })();

  // ════════════════════════════════════════════════════════════
  // § 4. Ctrl+K Command Palette
  // نافذة الأوامر والبحث الشامل
  // ════════════════════════════════════════════════════════════
  const CommandPalette = (() => {
    // قاموس الأوامر والتنقل
    const COMMANDS = [
      // تنقل رئيسي
      { id: 'desk',      label: 'الديوان',            icon: '📋', keywords: 'ديوان وارد صادر مراسلة', action: () => goto('desk') },
      { id: 'desk-in',   label: 'الديوان ← الوارد',   icon: '📥', keywords: 'وارد ديوان', action: () => goto('desk', 'in') },
      { id: 'desk-out',  label: 'الديوان ← الصادر',   icon: '📤', keywords: 'صادر ديوان', action: () => goto('desk', 'out') },
      { id: 'student',   label: 'شؤون الطلاب',         icon: '🎓', keywords: 'طالب قبول تسجيل شؤون', action: () => goto('student') },
      { id: 'student-360', label: 'الطلاب ← السجل 360', icon: '🔍', keywords: 'سجل 360 طالب بحث', action: () => goto('student', '360') },
      { id: 'finance',   label: 'المالية',             icon: '💰', keywords: 'مالية سند قيد رسوم', action: () => goto('finance') },
      { id: 'finance-voucher', label: 'المالية ← سندات القيد', icon: '📄', keywords: 'سند قيد مالية محاسبة', action: () => goto('finance', 'voucher') },
      { id: 'payroll',   label: 'الرواتب',             icon: '💵', keywords: 'راتب مرتب بدل مسير', action: () => goto('payroll') },
      { id: 'staff',     label: 'الكوادر',             icon: '👤', keywords: 'موظف كادر إجازة بصمة حضور', action: () => goto('staff') },
      { id: 'corr',      label: 'المراسلات',           icon: '✉️', keywords: 'مراسلة رسالة اعتماد', action: () => goto('corr') },
      { id: 'general',   label: 'الخدمات العامة',      icon: '⚙️', keywords: 'خدمة مصدقة وثيقة', action: () => goto('general') },
      { id: 'admin',     label: 'الإعدادات والإدارة',  icon: '🛡️', keywords: 'إعداد نظام مستخدم صلاحية', action: () => goto('admin') },
      // إجراءات سريعة
      { id: 'theme-dark',  label: 'تفعيل الوضع الليلي',  icon: '🌙', keywords: 'ليلي داكن وضع', action: () => setTheme('dark') },
      { id: 'theme-light', label: 'تفعيل الوضع النهاري', icon: '☀️', keywords: 'نهاري فاتح وضع', action: () => setTheme('light') },
      { id: 'sidebar-toggle', label: 'طي/توسيع القائمة الجانبية', icon: '◀', keywords: 'قائمة طي توسيع جانب', action: () => SidebarCtrl.toggle() },
    ];

    let overlay = null, input = null, listEl = null;
    let active = -1, filtered = [];

    function goto(tab, sub) {
      WorkspaceTabs.navigateTo(tab, sub);
      close();
    }

    function setTheme(t) {
      document.documentElement.dataset.theme = t;
      LS.set('theme', t);
      close();
    }


    function mount() {
      if ($('#cmd-palette')) return;
      overlay = document.createElement('div');
      overlay.id = 'cmd-palette';
      overlay.className = 'cmd-palette';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'نافذة الأوامر السريعة');
      overlay.hidden = true;
      overlay.innerHTML = `
        <div class="cmd-palette__box">
          <div class="cmd-palette__header">
            <span class="cmd-palette__icon">⌘</span>
            <input class="cmd-palette__input" type="search" placeholder="ابحث عن قسم أو إجراء…" autocomplete="off" spellcheck="false" dir="auto">
            <kbd class="cmd-palette__esc">Esc</kbd>
          </div>
          <ul class="cmd-palette__list" role="listbox"></ul>
          <div class="cmd-palette__hint">↑↓ للتنقل &nbsp;·&nbsp; Enter للتنفيذ &nbsp;·&nbsp; Esc للإغلاق</div>
        </div>
      `;
      document.body.appendChild(overlay);
      input = overlay.querySelector('.cmd-palette__input');
      listEl = overlay.querySelector('.cmd-palette__list');

      input.addEventListener('input', () => { filter(input.value); });
      input.addEventListener('keydown', onKey);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      overlay.querySelector('.cmd-palette__esc').addEventListener('click', close);
    }

    function filter(q) {
      const sq = q.trim().toLowerCase();
      filtered = sq
        ? COMMANDS.filter(c =>
            c.label.includes(sq) || c.keywords.includes(sq) || c.id.includes(sq)
          )
        : COMMANDS;
      active = filtered.length > 0 ? 0 : -1;
      renderList();
    }

    function renderList() {
      listEl.innerHTML = filtered.slice(0, 12).map((c, i) => `
        <li class="cmd-palette__item${i === active ? ' cmd-palette__item--active' : ''}"
            role="option" aria-selected="${i === active}" data-idx="${i}">
          <span class="cmd-palette__item-icon">${c.icon}</span>
          <span class="cmd-palette__item-label">${c.label}</span>
        </li>
      `).join('');

      listEl.querySelectorAll('.cmd-palette__item').forEach(li => {
        li.addEventListener('click', () => execute(+li.dataset.idx));
        li.addEventListener('mouseenter', () => {
          active = +li.dataset.idx;
          updateActive();
        });
      });
    }

    function updateActive() {
      listEl.querySelectorAll('.cmd-palette__item').forEach((li, i) => {
        const a = i === active;
        li.classList.toggle('cmd-palette__item--active', a);
        li.setAttribute('aria-selected', a);
        if (a) li.scrollIntoView({ block: 'nearest' });
      });
    }

    function onKey(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); updateActive(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); updateActive(); }
      else if (e.key === 'Enter') { e.preventDefault(); execute(active); }
      else if (e.key === 'Escape') close();
    }

    function execute(idx) {
      if (filtered[idx]) { filtered[idx].action(); close(); }
    }

    function open() {
      overlay.hidden = false;
      filter('');
      requestAnimationFrame(() => input.focus());
    }

    function close() {
      overlay.hidden = true;
      input.value = '';
    }

    // اختصارات لوحة المفاتيح
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay?.hidden) close();
    });

    return { mount, open, close };
  })();

  // ════════════════════════════════════════════════════════════
  // § 5. Collapsible Sidebar + تثبيت ترويسات الجداول
  // ════════════════════════════════════════════════════════════
  const SidebarCtrl = (() => {
    let collapsed = LS.get('sidebar_collapsed', false);

    function apply() {
      document.documentElement.classList.toggle('sidebar--collapsed', collapsed);
      LS.set('sidebar_collapsed', collapsed);
      // تحديث زر التبديل
      $$('.sidebar-toggle-btn').forEach(btn => {
        btn.setAttribute('aria-pressed', collapsed);
        btn.setAttribute('title', collapsed ? 'توسيع القائمة (Ctrl+B)' : 'طي القائمة (Ctrl+B)');
        btn.textContent = collapsed ? '▶' : '◀';
      });
    }

    function toggle() {
      collapsed = !collapsed;
      apply();
    }

    function injectButton() {
      if ($('.sidebar-toggle-btn')) return;
      const nav = $('.top .tabs, .top nav, nav.tabs');
      if (!nav) return;
      const btn = document.createElement('button');
      btn.className = 'btn sm sidebar-toggle-btn';
      btn.setAttribute('aria-pressed', collapsed);
      btn.setAttribute('title', collapsed ? 'توسيع القائمة (Ctrl+B)' : 'طي القائمة (Ctrl+B)');
      btn.textContent = collapsed ? '▶' : '◀';
      btn.addEventListener('click', toggle);
      nav.parentElement.insertBefore(btn, nav.nextSibling);
    }

    // اختصار Ctrl+B
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); toggle(); }
    });

    // تهيئة
    function init() {
      apply();
      // حقن الزر عند جاهزية الـ DOM
      const obs = new MutationObserver(() => injectButton());
      obs.observe(document.body, { childList: true, subtree: true });
    }

    return { toggle, init };
  })();

  // ════════════════════════════════════════════════════════════
  // § 7. Keyboard Navigation
  // Alt+1..9 للتبويبات + أسهم بين التبويبات الفرعية
  // ════════════════════════════════════════════════════════════
  function initKeyboardNav() {
    document.addEventListener('keydown', (e) => {
      // Alt+1..9 للتبويبات الرئيسية
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const tabs = $$('.tab[role="tab"],.tab[data-tab],.tab[data-section]');
        if (tabs[idx]) tabs[idx].click();
        return;
      }

      // أسهم يمين/يسار داخل شريط التبويبات الفرعية
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest('input,textarea,select')) {
        const subBar = e.target.closest('.sub-tabs');
        if (!subBar) return;
        const btns = $$('.btn, button', subBar);
        const idx = btns.indexOf(e.target);
        if (idx === -1) return;
        e.preventDefault();
        const next = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
        const target = btns[(next + btns.length) % btns.length];
        if (target) { target.focus(); target.click(); }
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  // § 8. Auto-Save Form Drafts
  // حفظ مسودات النماذج تلقائياً في localStorage
  // ════════════════════════════════════════════════════════════
  const FormDrafts = (() => {
    const SAVE_INTERVAL = 2000;
    const DRAFT_PREFIX = 'form_draft_';
    let timers = new Map();

    function getFormKey(form) {
      // مفتاح فريد بناءً على id النموذج أو أسماء الحقول
      if (form.id) return DRAFT_PREFIX + form.id;
      const fields = $$('input[name],select[name],textarea[name]', form).map(f => f.name).join(',');
      if (!fields) return null;
      return DRAFT_PREFIX + btoa(fields).slice(0, 20);
    }

    function saveDraft(form) {
      const key = getFormKey(form);
      if (!key) return;
      const data = {};
      $$('input[name],select[name],textarea[name]', form).forEach(f => {
        if (f.type === 'password') return; // لا نحفظ كلمات المرور
        if (f.type === 'file') return;
        if (f.type === 'checkbox' || f.type === 'radio') data[f.name] = f.checked;
        else data[f.name] = f.value;
      });
      LS.set(key, data);
    }

    function restoreDraft(form) {
      const key = getFormKey(form);
      if (!key) return;
      const data = LS.get(key, null);
      if (!data) return;
      $$('input[name],select[name],textarea[name]', form).forEach(f => {
        if (f.type === 'password' || f.type === 'file') return;
        if (!(f.name in data)) return;
        if (f.type === 'checkbox' || f.type === 'radio') f.checked = data[f.name];
        else f.value = data[f.name];
      });
      // إشعار صغير
      const hint = document.createElement('div');
      hint.className = 'draft-hint';
      hint.innerHTML = `<span>📝 تم استعادة المسودة</span><button type="button" class="draft-discard">تجاهل</button>`;
      hint.style.cssText = 'font-size:12.5px;color:var(--muted);display:flex;gap:10px;align-items:center;margin-bottom:8px;padding:6px 10px;background:var(--surface2);border-radius:8px;border:1px solid var(--line)';
      hint.querySelector('.draft-discard').onclick = () => { clearDraft(form); hint.remove(); };
      form.prepend(hint);
      setTimeout(() => hint.remove(), 8000);
    }

    function clearDraft(form) {
      const key = getFormKey(form);
      if (key) { try { localStorage.removeItem(key); } catch {} }
    }

    function attachToForm(form) {
      if (form.dataset.draftAttached) return;
      form.dataset.draftAttached = '1';

      // استعادة المسودة عند ظهور النموذج
      restoreDraft(form);

      // حفظ تلقائي عند الكتابة
      form.addEventListener('input', () => {
        const t = timers.get(form);
        if (t) clearTimeout(t);
        timers.set(form, setTimeout(() => saveDraft(form), SAVE_INTERVAL));
      });

      // مسح المسودة عند الإرسال الناجح
      form.addEventListener('submit', () => {
        setTimeout(() => clearDraft(form), 500);
      });

      // مسح مؤجل عند الإغلاق بزر إلغاء
      form.querySelectorAll('[data-act="close"],[data-dismiss],[type="reset"]').forEach(btn => {
        btn.addEventListener('click', () => clearDraft(form));
      });
    }

    function watchForms() {
      const obs = new MutationObserver(() => {
        $$('form.auto-draft, form[data-auto-draft]').forEach(f => attachToForm(f));
        // أيضاً: كل نموذج داخل .overlay أو .sheet
        $$('.overlay form, .sheet form, #layer form').forEach(f => attachToForm(f));
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    return { watchForms };
  })();

  // ════════════════════════════════════════════════════════════
  // § 9. Skeleton Loaders & Micro-Transitions
  // ════════════════════════════════════════════════════════════
  function initSkeletonLoaders() {
    // حقن مؤشر تحميل هيكلي عند إخفاء محتوى ثم إظهاره
    document.addEventListener('ua:loading', (e) => {
      const target = e.detail?.target || $('#main-content, .wrap');
      if (!target) return;
      const sk = document.createElement('div');
      sk.className = 'skeleton-block';
      sk.setAttribute('aria-hidden', 'true');
      sk.innerHTML = `
        <div class="sk-line sk-line--lg"></div>
        <div class="sk-line"></div>
        <div class="sk-line sk-line--sm"></div>
        <div class="sk-line"></div>
      `;
      target._skeleton = sk;
      target.parentNode?.insertBefore(sk, target.nextSibling);
    });

    document.addEventListener('ua:loaded', (e) => {
      const target = e.detail?.target;
      if (target?._skeleton) { target._skeleton.remove(); delete target._skeleton; }
    });
  }

  // ════════════════════════════════════════════════════════════
  // § 10. Sticky Table Headers
  // تثبيت ترويسات الجداول الطويلة
  // ════════════════════════════════════════════════════════════
  function initStickyTableHeaders() {
    const obs = new MutationObserver(() => {
      $$('table:not([data-sticky-h])').forEach(tbl => {
        // اشتراط وجود تعليق في تعريف البيانات أو جدول طويل
        if (tbl.rows.length < 8) return;
        if (tbl.closest('.tbl-wrap')) return;   // الجداول داخل حاوية تمرير تلتصق ترويستها بالـCSS (top:0)؛ الإزاحة المحسوبة كانت تُنزل الترويسة فوق الصفوف
        tbl.dataset.stickyH = '1';
        const top = $('.top');
        const topH = top ? top.getBoundingClientRect().height : 56;
        const wsBar = $('#ws-tabs-bar');
        const wsH = wsBar ? wsBar.getBoundingClientRect().height : 0;
        const subBar = tbl.closest('[class*="content"]')?.querySelector('.sub-tabs--sticky');
        const subH = subBar ? subBar.getBoundingClientRect().height : 0;
        const stickyTop = topH + wsH + subH;
        $$('thead th', tbl).forEach(th => {
          th.style.position = 'sticky';
          th.style.top = stickyTop + 'px';
          th.style.background = 'var(--surface)';
          th.style.zIndex = '3';
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ════════════════════════════════════════════════════════════
  // § تمهيد وتشغيل
  // ════════════════════════════════════════════════════════════
  function run() {
    // استعادة حالة إمكانية الوصول المحفوظة

    // تهيئة أدوات بعد اكتمال DOM
    SidebarCtrl.init();
    initStickySubTabs();
    initKeyboardNav();
    initStickyTableHeaders();
    FormDrafts.watchForms();
    initSkeletonLoaders();

    // تثبيت العناصر التي تحتاج DOM
    CommandPalette.mount();

    // كشف الحزمة على window للتكامل
    window.UA = window.UA || {};
    window.UA.ux = {
      commandPalette: CommandPalette,
      sidebar:        SidebarCtrl,
    };

    console.info('[UX Enhancements v1.0] ✅ جميع التحسينات نشطة');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
