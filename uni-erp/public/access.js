/* منظومة الحسابات والصلاحيات الشاملة: تأسيس الحسابات مع واجهة متكاملة لتحديد الصلاحيات والسماحيات (عرض / كتابة / تعديل / اعتماد / حذف) لكل قسم، إدارة الأدوار والقوالب، صلاحيات الأقسام، ومصفوفة الصلاحيات */
(function () {
  const UA = window.UA, { S, api, esc, val, toast } = UA;

  // الشكل الموحَّد لحالة «مُنشئ الصلاحيات»، يُستخدم عند تأسيس حساب جديد وعند تعديل حساب قائم معاً،
  // بدل نسختين منفصلتين قد تنحرف إحداهما عن الأخرى كلما أُضيف حقل جديد
  const builderStateShape = (overrides = {}) => ({
    roleKey: 'staff',
    accessMode: 'hybrid',
    dataScope: 'unit',
    scopeFaculty: '',
    customPerms: new Set(),
    revokedPerms: new Set(),
    allowedViews: new Set(),
    hiddenTabs: new Set(),
    showAdvancedCatalog: false,
    viewsGroup: null,
    viewsSearch: '',
    viewsOnlyActive: false,
    viewsSnapshot: null,
    initialized: false,
    ...overrides,
  });

  const fresh = () => ({
    tab: null,
    data: null,
    edit: null,
    cred: null,
    rsel: null,
    unitPermEdit: null,
    userSearch: '',
    userUnitFilter: '',
    userModeFilter: '',
    matrixFilter: '',
    unitsView: 'list',
    // حالة مُنشئ صلاحيات الحساب الجديد (Account Creation Permission Builder)
    builder: builderStateShape(),
    // حالة مُحرّر صلاحيات الحساب القائم (Existing Account Permission Editor)
    editBuilder: null,
  });

  const X = fresh();
  const prevReset = UA.reset;
  UA.reset = () => {
    if (prevReset) prevReset();
    Object.assign(X, fresh());
  };

  const $id = (id) => document.getElementById(id);
  const mine = () => new Set((S.me && S.me.permissions) || []);
  const bar = (tabs, cur, act) =>
    `<div class="sub-tabs no-print" role="tablist">${tabs
      .map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`)
      .join('')}</div>`;
  const unitName = (id) => {
    const u = (X.data?.units || []).find((x) => x.id === id);
    return u ? u.name : '—';
  };
  const covers = (perms) => {
    const m = mine();
    return (perms || []).every((p) => m.has(p));
  };

  const KIND = { university: 'الإدارة العليا', sector: 'قطاع', college: 'كلية', department: 'إدارة / قسم', office: 'مكتب' };
  const SCOPE_LABELS = {
    all: 'شامل — كافة كليات وأقسام الجامعة',
    faculty: 'نطاق الكلية / المعهد الأكاديمي',
    unit: 'نطاق القسم / الوحدة الإدارية فقط',
    own: 'السجلات والمعاملات الشخصية فقط',
    self: 'السجلات والمعاملات الشخصية فقط',
  };
  // 'role' قيمة قديمة محفوظة في قاعدة بيانات بعض الحسابات؛ تُعامَل كمرادف لـ'hybrid' (نفس المنطق فعلياً في الخادم)
  const MODE_LABELS = {
    role: 'موروث من الدور والقسم',
    hybrid: 'موروث من الدور والقسم',
    custom: 'مخصص بالكامل لهذا الحساب',
  };
  const ACTION_META = [
    { key: 'view', label: 'عرض / قراءة', icon: '👁️', badgeCls: 'p-approved' },
    { key: 'write', label: 'إضافة / كتابة', icon: '✍️', badgeCls: 'p-review' },
    { key: 'edit', label: 'تعديل وتحديث', icon: '🛠️', badgeCls: 'p-review' },
    { key: 'approve', label: 'اعتماد وبتّ', icon: '✅', badgeCls: 'p-approved' },
    { key: 'delete', label: 'حذف / تصدير', icon: '🗑️', badgeCls: 'p-rejected' },
  ];

  function genPw() {
    const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', D = '23456789', ALL = L + D;
    const r = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
    const out = [L[r(L.length)], D[r(D.length)], ...Array.from({ length: 10 }, () => ALL[r(ALL.length)])];
    for (let i = out.length - 1; i > 0; i--) {
      const j = r(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.join('');
  }

  function getRolePerms(roleKey) {
    if (!X.data || !X.data.roles) return [];
    const r = X.data.roles.find((x) => x.key === roleKey);
    return r ? r.permissions || [] : [];
  }

  // صلاحيات الحساب قيد التخصيص، لتعليم التبويبات التي لا يملكها
  function builderPerms(bState) {
    const set = new Set([...getRolePerms(bState.roleKey), ...bState.customPerms]);
    for (const p of bState.revokedPerms) set.delete(p);
    return set;
  }
  const keepHybrid = (bState, target) => {
    if (bState.accessMode !== 'role') return;
    bState.accessMode = 'hybrid';
    const mode = $id(target === 'edit' ? 'xe-mode' : 'xn-mode');
    if (mode) mode.value = 'hybrid';
  };

  function ensureBuilderInit() {
    if (!X.data) return;
    if (!X.builder.initialized) {
      const staffPerms = getRolePerms(X.builder.roleKey || 'staff');
      const m = mine();
      X.builder.customPerms = new Set(staffPerms.filter((p) => m.has(p)));
      X.builder.revokedPerms = new Set();
      X.builder.hiddenTabs = new Set();
      X.builder.allowedViews = new Set(['desk', 'overview', 'affairs', 'internal', 'corr', 'dashboard', 'exchange', 'verify']);
      X.builder.initialized = true;
      X.builder.viewsSnapshot = { views: new Set(X.builder.allowedViews), tabs: new Set(X.builder.hiddenTabs) };
    }
  }

  function activeBuilderState(isEdit) {
    ensureBuilderInit();
    return isEdit && X.editBuilder ? X.editBuilder : X.builder;
  }

  function syncBuilderFromRoleAndUnit(bState, roleKey, unitId) {
    const m = mine();
    const rolePerms = getRolePerms(roleKey);
    const unitObj = (X.data?.units || []).find((u) => String(u.id) === String(unitId));
    const unitPerms = (unitObj && unitObj.defaultPermissions) || [];
    const merged = new Set([...rolePerms, ...unitPerms].filter((p) => m.has(p)));
    if (merged.has('request:read_all') && merged.has('request:read_unit')) merged.delete('request:read_unit');
    bState.customPerms = merged;
    bState.revokedPerms = new Set();
    if (unitObj && Array.isArray(unitObj.allowedViews) && unitObj.allowedViews.length > 0) {
      bState.allowedViews = new Set(unitObj.allowedViews);
    }
  }

  function getModuleActionState(bState, mod, actKey) {
    const actDef = mod.actions && mod.actions[actKey];
    if (!actDef || !actDef.perms || !actDef.perms.length) return false;
    return actDef.perms.every((p) => bState.customPerms.has(p));
  }

  function setModuleActionState(bState, mod, actKey, enabled) {
    const m = mine();
    const actDef = mod.actions && mod.actions[actKey];
    if (!actDef || !actDef.perms) return;
    for (const p of actDef.perms) {
      if (!m.has(p)) continue;
      if (enabled) {
        bState.customPerms.add(p);
        bState.revokedPerms.delete(p);
        if (p === 'request:read_all') bState.customPerms.delete('request:read_unit');
        if (p === 'request:read_unit' && bState.customPerms.has('request:read_all')) bState.customPerms.delete('request:read_unit');
      } else {
        bState.customPerms.delete(p);
        bState.revokedPerms.add(p);
      }
    }
    if (enabled && Array.isArray(mod.viewKeys)) {
      for (const vk of mod.viewKeys) bState.allowedViews.add(vk);
    }
  }

  function applyQuickModuleLevel(bState, mod, level) {
    const order = ['view', 'write', 'edit', 'approve', 'delete'];
    const map = {
      none: [],
      read: ['view'],
      write: ['view', 'write'],
      edit: ['view', 'write', 'edit'],
      full: ['view', 'write', 'edit', 'approve', 'delete'],
    };
    const activeActs = new Set(map[level] || []);
    for (const k of order) {
      setModuleActionState(bState, mod, k, activeActs.has(k));
    }
  }

  function getQuickModuleLevel(bState, mod) {
    const v = getModuleActionState(bState, mod, 'view');
    const w = getModuleActionState(bState, mod, 'write');
    const e = getModuleActionState(bState, mod, 'edit');
    const a = getModuleActionState(bState, mod, 'approve');
    const d = getModuleActionState(bState, mod, 'delete');
    if (v && w && e && a && d) return 'full';
    if (v && w && e && !a && !d) return 'edit';
    if (v && w && !e && !a && !d) return 'write';
    if (v && !w && !e && !a && !d) return 'read';
    if (!v && !w && !e && !a && !d) return 'none';
    return 'custom';
  }

  function tabsAvail() {
    const t = [];
    if (X.data.canManageUsers) t.push(['users', '1. الحسابات وتأسيس الصلاحيات']);
    if (X.data.canManageRoles) {
      t.push(['roles', '2. الأدوار والقوالب الوظيفية']);
      t.push(['units', '3. صلاحيات الأقسام والوحدات']);
    }
    t.push(['matrix', '4. مصفوفة الصلاحيات الشاملة']);
    return t;
  }

  const roleOpts = (sel) =>
    X.data.roles
      .filter((r) => r.active && covers(r.permissions))
      .map((r) => `<option value="${esc(r.key)}"${r.key === sel ? ' selected' : ''}>${esc(r.label)}${r.builtin ? '' : ' (مخصّص)'}</option>`)
      .join('');

  const unitOpts = (sel) =>
    `<option value="">— بلا وحدة / الإدارة العامة —</option>` +
    X.data.units
      .filter((u) => u.active)
      .map((u) => `<option value="${u.id}"${String(u.id) === String(sel) ? ' selected' : ''}>${esc(u.name)} (${KIND[u.kind] || u.kind})</option>`)
      .join('');

  /* ---------- قسم «تخصيص الشاشات والتبويبات»: تصميم قائمة/تفاصيل (مجموعات الشاشات يميناً، شاشات المجموعة المختارة وتبويباتها يساراً) ---------- */
  const viewsGroupsOf = (allViews) => {
    const seen = [];
    for (const v of allViews) if (!seen.includes(v.group)) seen.push(v.group);
    return seen;
  };
  const viewsGroupStats = (bState, allViews, group) => {
    const inGroup = allViews.filter((v) => v.group === group);
    const on = inGroup.filter((v) => bState.allowedViews.size === 0 || bState.allowedViews.has(v.key)).length;
    return { total: inGroup.length, on };
  };
  // عدد التغييرات منذ فتح لوحة هذا الحساب (للمقارنة مع لقطة الحفظ الأخيرة)
  function viewsDirtyCount(bState) {
    const snap = bState.viewsSnapshot;
    if (!snap) return 0;
    const symDiff = (a, b) => [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
    return symDiff(bState.allowedViews, snap.views) + symDiff(bState.hiddenTabs || new Set(), snap.tabs);
  }
  // المحتوى القابل لإعادة الرسم وحده (القائمة والتفاصيل وشريط التغييرات) دون شريط الأدوات العلوي،
  // كي لا يفقد حقل البحث التركيز أثناء الكتابة فيه عند كل تبديل
  function renderViewsBody(bState, targetMode) {
    const allViews = X.data.allViews || [];
    const allGroups = viewsGroupsOf(allViews);
    const q = (bState.viewsSearch || '').trim().toLowerCase();
    const matches = (v) => !q || v.label.toLowerCase().includes(q) || v.group.toLowerCase().includes(q);
    const groups = allGroups.filter((g) => {
      const inGroup = allViews.filter((v) => v.group === g);
      if (q && !inGroup.some(matches) && !g.toLowerCase().includes(q)) return false;
      if (bState.viewsOnlyActive) {
        const { on } = viewsGroupStats(bState, allViews, g);
        if (on === 0) return false;
      }
      return true;
    });
    if (!bState.viewsGroup || !groups.includes(bState.viewsGroup)) bState.viewsGroup = groups[0] || allGroups[0] || null;
    const perms = builderPerms(bState), hiddenTabs = bState.hiddenTabs || new Set();
    const totalOn = allViews.filter((v) => bState.allowedViews.size === 0 || bState.allowedViews.has(v.key)).length;
    const dirty = viewsDirtyCount(bState);

    const listRows = groups
      .map((g) => {
        const { total, on } = viewsGroupStats(bState, allViews, g);
        const st = on === 0 ? 'none' : on === total ? 'full' : 'partial';
        return `<button type="button" class="xv-row" aria-current="${g === bState.viewsGroup}" data-act="xviewsgsel" data-target="${targetMode}" data-g="${esc(g)}">
          <span class="xv-tri ${st}"></span><span class="xv-name">${esc(g)}</span><span class="xv-count">${on}/${total}</span>
        </button>`;
      })
      .join('');

    const activeGroup = bState.viewsGroup;
    const activeViews = allViews.filter((v) => v.group === activeGroup && matches(v));
    const itemRows = activeViews
      .map((v) => {
        const isChecked = bState.allowedViews.size === 0 || bState.allowedViews.has(v.key);
        const tabs = (UA.gate && UA.gate.TABS[v.key]) || [];
        const tabBoxes = tabs
          .map(([a, t, label, need]) => {
            const key = `${a}:${t}`, owned = !need || need.some((p) => perms.has(p)), on = owned && !hiddenTabs.has(key);
            if (!owned) return `<div class="xv-sub off"><span class="xv-sw sm" style="filter:grayscale(1);opacity:.5"><input type="checkbox" disabled><span class="xv-track"></span><span class="xv-thumb"></span></span>🔒 ${esc(label)} <span>(بلا صلاحية لهذا التبويب)</span></div>`;
            return `<label class="xv-sub"><span class="xv-sw sm"><input type="checkbox" data-act="xtabchk" data-target="${targetMode}" data-key="${esc(key)}"${on ? ' checked' : ''}><span class="xv-track"></span><span class="xv-thumb"></span></span> ${esc(label)}</label>`;
          })
          .join('');
        return `<div class="xv-item">
          <div class="xv-text"><div class="xv-label">${esc(v.label)}</div>${tabBoxes ? `<div class="xv-subtabs">${tabBoxes}</div>` : ''}</div>
          <label class="xv-sw"><input type="checkbox" data-act="xviewchk" data-target="${targetMode}" data-vk="${esc(v.key)}"${isChecked ? ' checked' : ''}><span class="xv-track"></span><span class="xv-thumb"></span></label>
        </div>`;
      })
      .join('');

    return `<div data-xv-body="${targetMode}">
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px"><span class="small">${totalOn}/${allViews.length} شاشة مسموحة</span></div>
      <p class="small" style="margin:0 0 10px">التخصيص يُضيّق ما تتيحه صلاحيات الحساب ولا يوسّعه: الشاشة أو التبويب بلا صلاحية يبقى مخفياً مهما اخترت.</p>
      <div class="actions" style="margin:0 0 10px">
        <button type="button" class="btn sm" data-act="xviewsall" data-target="${targetMode}" data-on="1">تفعيل كل الشاشات</button>
        <button type="button" class="btn sm" data-act="xviewsall" data-target="${targetMode}" data-on="0">الشاشات المرتبطة بصلاحياته فقط</button>
      </div>
      <div class="xv-shell">
        <nav class="xv-list" aria-label="مجموعات الشاشات">${listRows || '<div class="empty" style="padding:10px">لا نتائج</div>'}</nav>
        <section class="xv-detail">
          <div class="xv-detail-head">
            <h3 style="margin:0;font-size:14px;color:#054239">${esc(activeGroup || '')}</h3>
            <div style="display:flex;gap:10px">
              <button type="button" class="link small" data-act="xviewsgroupall" data-target="${targetMode}" data-g="${esc(activeGroup || '')}" data-on="1">تفعيل الكل</button>
              <button type="button" class="link small" data-act="xviewsgroupall" data-target="${targetMode}" data-g="${esc(activeGroup || '')}" data-on="0">إلغاء الكل</button>
            </div>
          </div>
          ${itemRows || '<div class="empty">لا شاشات في هذه المجموعة.</div>'}
        </section>
      </div>
      ${dirty > 0 ? `<div class="xv-savebar"><b>${dirty} تغييرات غير محفوظة في الشاشات</b><span style="flex:1"></span>
        <button type="button" class="btn sm" data-act="xviewsundo" data-target="${targetMode}">تراجع</button>
        <button type="button" class="btn sm pri" data-act="xviewssave" data-target="${targetMode}">حفظ الحساب الآن ↑</button>
      </div>` : ''}
    </div>`;
  }

  function renderViewsShell(bState, targetMode) {
    const presetOpts = (X.data.rolePresets || [])
      .map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`)
      .join('');
    return `<div data-xv-root="${targetMode}">
      <div class="xv-toolbar">
        <input type="text" class="xv-search" placeholder="ابحث عن وحدة أو شاشة..." value="${esc(bState.viewsSearch || '')}" data-act="xviewssearch" data-target="${targetMode}">
        <button type="button" class="xv-chip" aria-pressed="${!!bState.viewsOnlyActive}" data-act="xviewsonlyactive" data-target="${targetMode}">المفعّل فقط</button>
        <select class="xv-tpl" data-act="xviewstpl" data-target="${targetMode}"><option value="">قالب جاهز (للشاشات فقط)...</option>${presetOpts}</select>
      </div>
      ${renderViewsBody(bState, targetMode)}
    </div>`;
  }

  /* ---------- مكوّن مصفوفة تحديد الصلاحيات والسماحيات المتكاملة (لإنشاء أو تعديل حساب) ---------- */
  function renderGranularPermissionBuilder(targetMode) {
    const isEdit = targetMode === 'edit';
    const bState = activeBuilderState(isEdit);
    const modules = X.data.modulesMatrix || [];
    const presets = X.data.rolePresets || [];
    const m = mine();

    // إحصائيات حية لما تم منحه في هذا الحساب
    let activeModCount = 0;
    let viewCnt = 0, writeCnt = 0, editCnt = 0, approveCnt = 0, deleteCnt = 0;
    for (const mod of modules) {
      const v = getModuleActionState(bState, mod, 'view');
      const w = getModuleActionState(bState, mod, 'write');
      const e = getModuleActionState(bState, mod, 'edit');
      const a = getModuleActionState(bState, mod, 'approve');
      const d = getModuleActionState(bState, mod, 'delete');
      if (v || w || e || a || d) activeModCount++;
      if (v) viewCnt++;
      if (w) writeCnt++;
      if (e) editCnt++;
      if (a) approveCnt++;
      if (d) deleteCnt++;
    }

    const presetButtons = presets
      .map(
        (pr) =>
          `<button type="button" class="btn sm" data-act="xpreset" data-target="${targetMode}" data-pid="${esc(pr.id)}" title="${esc(pr.department)}" style="font-size:12px">${esc(pr.label)}</button>`
      )
      .join('');

    const moduleRows = modules
      .map((mod) => {
        const curLvl = getQuickModuleLevel(bState, mod);
        const actionCells = ACTION_META.map((act) => {
          const actDef = mod.actions[act.key];
          const checked = getModuleActionState(bState, mod, act.key);
          const canGrant = actDef && actDef.perms.every((p) => m.has(p));
          return `<td style="text-align:center;vertical-align:middle">
            <label style="display:inline-flex;flex-direction:column;align-items:center;gap:3px;cursor:${canGrant ? 'pointer' : 'not-allowed'};opacity:${canGrant ? '1' : '0.45'}" title="${esc(actDef?.label || act.label)}: ${esc((actDef?.perms || []).join(', '))}">
              <input type="checkbox" data-act="xmodchk" data-target="${targetMode}" data-mod="${esc(mod.id)}" data-op="${act.key}" ${checked ? 'checked' : ''} ${canGrant ? '' : 'disabled'} style="width:17px;height:17px;accent-color:#054239">
              <span class="small" style="font-size:11px;color:${checked ? '#054239' : '#566660'};font-weight:${checked ? '700' : '400'}">${esc(actDef?.label || act.label)}</span>
            </label>
          </td>`;
        }).join('');

        return `<tr style="background:${curLvl === 'none' ? 'transparent' : 'rgba(5,66,57,0.03)'}">
          <td>
            <div style="font-weight:700;color:#10211D">${esc(mod.title)}</div>
            <div class="small" style="color:#054239;font-weight:600">${esc(mod.department)}</div>
            <div class="small">${esc(mod.description)}</div>
          </td>
          <td style="white-space:nowrap;vertical-align:middle">
            <select data-act="xmodlvl" data-target="${targetMode}" data-mod="${esc(mod.id)}" aria-label="مستوى وصول ${esc(mod.title)}" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid #DCE3DD;background:#fff">
              <option value="none"${curLvl === 'none' ? ' selected' : ''}>🚫 بلا وصول</option>
              <option value="read"${curLvl === 'read' ? ' selected' : ''}>👁️ عرض واطلاع فقط</option>
              <option value="write"${curLvl === 'write' ? ' selected' : ''}>✍️ عرض + إضافة وكتابة</option>
              <option value="edit"${curLvl === 'edit' ? ' selected' : ''}>🛠️ عرض + كتابة + تعديل</option>
              <option value="full"${curLvl === 'full' ? ' selected' : ''}>✅ كامل (مع الاعتماد والحذف)</option>
              ${curLvl === 'custom' ? '<option value="custom" selected>⚙️ مخصص (تحديد يدوي)</option>' : ''}
            </select>
          </td>
          ${actionCells}
        </tr>`;
      })
      .join('');

    const catalogBoxes = bState.showAdvancedCatalog
      ? `<div style="margin-top:12px">${X.data.catalog
          .map(
            (g) =>
              `<fieldset class="perm-g"><legend>${esc(g.group)}</legend>${g.items
                .map((i) => {
                  const ok = m.has(i.key);
                  const isOn = bState.customPerms.has(i.key);
                  return `<label class="perm${ok ? '' : ' off'}"><input type="checkbox" data-act="xrawperm" data-target="${targetMode}" data-perm="${esc(i.key)}"${isOn ? ' checked' : ''}${ok ? '' : ' disabled'}> <span>${esc(i.label)}</span><span class="mono small" dir="ltr">${esc(i.key)}</span></label>`;
                })
                .join('')}</fieldset>`
          )
          .join('')}</div>`
      : '';

    return `<div class="stack" style="margin-top:14px;border:1px solid #DCE3DD;border-radius:12px;padding:16px;background:#F6F8F5">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-bottom:1px solid #DCE3DD;padding-bottom:12px">
        <div>
          <h3 style="margin:0;color:#054239;font-size:16px">🛡️ مصفوفة تحديد الصلاحيات والسماحيات وآلية الوصول والتعديل (${isEdit ? 'تعديل الحساب' : 'عند تأسيس الحساب'})</h3>
          <p class="small" style="margin:4px 0 0">حدّد بدقة الأقسام التي يحق للموظف الوصول إليها، ومستوى السماحية في كل قسم (عرض، كتابة، تعديل، اعتماد، حذف/تصدير).</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="pill p-approved">الأقسام المفعّلة: ${activeModCount} / ${modules.length}</span>
          <span class="pill p-review">إجمالي الصلاحيات الفعلية: ${bState.customPerms.size}</span>
        </div>
      </div>

      <!-- شريط ملخص السماحيات الخمس -->
      <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        <div class="stat" style="padding:10px"><small>👁️ أقسام مسموح عرضها</small><b style="font-size:18px;color:#054239">${viewCnt} / ${modules.length}</b></div>
        <div class="stat" style="padding:10px"><small>✍️ أقسام مسموح الكتابة فيها</small><b style="font-size:18px;color:#0A5A4D">${writeCnt} / ${modules.length}</b></div>
        <div class="stat" style="padding:10px"><small>🛠️ أقسام مسموح تعديلها</small><b style="font-size:18px;color:#8A6A1B">${editCnt} / ${modules.length}</b></div>
        <div class="stat" style="padding:10px"><small>✅ أقسام مسموح الاعتماد فيها</small><b style="font-size:18px;color:#0E4D2E">${approveCnt} / ${modules.length}</b></div>
        <div class="stat" style="padding:10px"><small>🗑️ أقسام مسموح الحذف/التصدير</small><b style="font-size:18px;color:#B3261E">${deleteCnt} / ${modules.length}</b></div>
      </div>

      <!-- إعدادات آلية الوصول ونطاق البيانات -->
      <div class="inline-form" style="background:#fff;padding:12px;border-radius:10px;border:1px solid #DCE3DD">
        <label style="flex:1;min-width:220px">آلية تطبيق الصلاحيات على الحساب
          <select id="${isEdit ? 'xe-mode' : 'xn-mode'}" data-act="xmodechg" data-target="${targetMode}">
            <option value="hybrid"${bState.accessMode !== 'custom' ? ' selected' : ''}>موروث من الدور والقسم (قابل للتخصيص أدناه لهذا الحساب)</option>
            <option value="custom"${bState.accessMode === 'custom' ? ' selected' : ''}>مخصص بالكامل (يعمل فقط بالصلاحيات المحددة أدناه، دون أي وراثة)</option>
          </select>
          <small class="small" style="display:block;margin-top:4px">لإعادة الحساب لصلاحيات دوره وقسمه الافتراضية دون أي تخصيص إضافي: زر «🔄 مطابقة مع الدور والقسم» أدناه.</small>
        </label>
        <label style="flex:1;min-width:220px">نطاق الوصول للبيانات والسجلات (Data Scope)
          <select id="${isEdit ? 'xe-scope' : 'xn-scope'}" data-act="xscopechg" data-target="${targetMode}">
            <option value="all"${bState.dataScope === 'all' ? ' selected' : ''}>🌐 شامل — كافة كليات وأقسام الجامعة</option>
            <option value="faculty"${bState.dataScope === 'faculty' ? ' selected' : ''}>🏛️ نطاق الكلية / المعهد الأكاديمي فقط</option>
            <option value="unit"${bState.dataScope === 'unit' ? ' selected' : ''}>🏢 نطاق القسم / الوحدة الإدارية فقط</option>
            <option value="own"${bState.dataScope === 'own' ? ' selected' : ''}>👤 السجلات والمعاملات الشخصية فقط</option>
          </select>
          <small class="small" style="display:block;margin-top:4px">تنبيه: «نطاق الكلية» مطبَّق فعلياً على سجلات الطلاب فقط حالياً. «القسم» و«الشخصي» توصيف تنظيمي للحساب، وتعتمد التصفية الفعلية للبيانات على الصلاحيات المحددة أدناه لكل قسم.</small>
        </label>
        <label style="flex:1;min-width:200px">الكلية أو المعهد (لنطاق الكلية)
          <input id="${isEdit ? 'xe-scope-fac' : 'xn-scope-fac'}" value="${esc(bState.scopeFaculty || '')}" maxlength="120" placeholder="كما هو في البرامج الدراسية">
        </label>
        <div class="actions" style="margin:0;align-self:flex-end">
          <button type="button" class="btn sm" data-act="xbulk" data-target="${targetMode}" data-op="sync_role">🔄 مطابقة مع الدور والقسم</button>
          <button type="button" class="btn sm" data-act="xbulk" data-target="${targetMode}" data-op="read_all">👁️ عرض فقط لكل المنصة</button>
          <button type="button" class="btn sm pri" data-act="xbulk" data-target="${targetMode}" data-op="full_all">✅ منح كامل الصلاحيات</button>
          <button type="button" class="btn sm bad" data-act="xbulk" data-target="${targetMode}" data-op="clear_all">🚫 تفريغ الكل</button>
        </div>
      </div>

      <!-- قوالب الأقسام الجاهزة -->
      <div style="background:#fff;padding:12px;border-radius:10px;border:1px solid #DCE3DD">
        <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#10211D">⚡ قوالب الصلاحيات الجاهزة حسب الأقسام (اضغط لتعبئة صلاحيات القسم فوراً):</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${presetButtons}</div>
      </div>

      <!-- جدول مصفوفة الأقسام الـ 14 والعمليات الخمس -->
      <div class="tbl-wrap" style="background:#fff;border-radius:10px;border:1px solid #DCE3DD">
        <table>
          <thead>
            <tr>
              <th style="min-width:240px">القسم / جزء المنصة</th>
              <th style="min-width:170px">تحديد سريع للقسم</th>
              <th style="text-align:center">
                <div>👁️ عرض / قراءة</div>
                <button type="button" class="link small" data-act="xcoltoggle" data-target="${targetMode}" data-col="view">تبديل الكل</button>
              </th>
              <th style="text-align:center">
                <div>✍️ إضافة / كتابة</div>
                <button type="button" class="link small" data-act="xcoltoggle" data-target="${targetMode}" data-col="write">تبديل الكل</button>
              </th>
              <th style="text-align:center">
                <div>🛠️ تعديل وتحديث</div>
                <button type="button" class="link small" data-act="xcoltoggle" data-target="${targetMode}" data-col="edit">تبديل الكل</button>
              </th>
              <th style="text-align:center">
                <div>✅ اعتماد وبتّ</div>
                <button type="button" class="link small" data-act="xcoltoggle" data-target="${targetMode}" data-col="approve">تبديل الكل</button>
              </th>
              <th style="text-align:center">
                <div>🗑️ حذف / تصدير</div>
                <button type="button" class="link small" data-act="xcoltoggle" data-target="${targetMode}" data-col="delete">تبديل الكل</button>
              </th>
            </tr>
          </thead>
          <tbody>${moduleRows}</tbody>
        </table>
      </div>

      <!-- تحديد الشاشات المسموح ظهورها في القائمة الجانبية: تصميم قائمة/تفاصيل بدل شبكة بطاقات متساوية -->
      <div style="background:#fff;padding:12px;border-radius:10px;border:1px solid #DCE3DD">${renderViewsShell(bState, targetMode)}</div>

      <!-- الفهرس التفصيلي لكافة الصلاحيات الفردية -->
      <div style="background:#fff;padding:12px;border-radius:10px;border:1px solid #DCE3DD">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <b>🔧 الفهرس التفصيلي للصلاحيات الفردية (${bState.customPerms.size} صلاحية مفعلة)</b>
          <button type="button" class="btn sm" data-act="xtoggleadv" data-target="${targetMode}">
            ${bState.showAdvancedCatalog ? 'إخفاء الفهرس التفصيلي ▲' : 'عرض وتخصيص الصلاحيات الفردية بالمفتاح البرمجي ▼'}
          </button>
        </div>
        ${catalogBoxes}
      </div>
    </div>`;
  }

  /* ---------- تبويب 1: الحسابات الإدارية وتأسيس الصلاحيات ---------- */
  function renderUserCapabilitiesBadges(u) {
    const cap = (u.accessProfile && u.accessProfile.capabilities) || {};
    const badges = [];
    if (cap.viewCount) badges.push(`<span class="pill p-approved" title="عدد الأقسام المسموح عرضها">👁️ عرض (${cap.viewCount})</span>`);
    if (cap.writeCount) badges.push(`<span class="pill p-review" title="عدد الأقسام المسموح الكتابة فيها">✍️ كتابة (${cap.writeCount})</span>`);
    if (cap.editCount) badges.push(`<span class="pill p-review" title="عدد الأقسام المسموح تعديلها">🛠️ تعديل (${cap.editCount})</span>`);
    if (cap.approveCount) badges.push(`<span class="pill p-approved" title="عدد الأقسام المسموح الاعتماد فيها">✅ اعتماد (${cap.approveCount})</span>`);
    if (cap.deleteCount) badges.push(`<span class="pill p-rejected" title="عدد الأقسام المسموح الحذف/التصدير فيها">🗑️ حذف/تصدير (${cap.deleteCount})</span>`);
    return badges.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${badges.join('')}</div>` : '<span class="small hint">بلا صلاحيات</span>';
  }

  function usersTab() {
    ensureBuilderInit();
    const c = X.cred
      ? `<section class="card cred"><h2>كلمة مرور مؤقتة</h2><p class="hint" style="margin-top:0">المستخدم: <b class="mono">${esc(X.cred.username)}</b> · كلمة المرور: <b class="mono" dir="ltr">${esc(X.cred.tempPassword)}</b></p>
        <p class="small">تظهر مرة واحدة فقط. سيُطلب من المستخدم تغييرها عند أول دخول.</p><div class="actions"><button class="btn pri" data-act="xcopy">نسخ</button><button class="btn" data-act="xcredx">إخفاء</button></div></section>`
      : '';

    // نافذة تعديل حساب قائم مع مصفوفة الصلاحيات الكاملة
    let editPanelHtml = '';
    if (X.edit) {
      const eu = X.data.users.find((x) => x.id === X.edit);
      if (eu) {
        editPanelHtml = `<section class="card" id="xedit-panel" style="border:2px solid #054239;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <h2 style="margin:0;color:#054239">⚙️ تعديل الحساب والصلاحيات التفصيلية: ${esc(eu.name)} (<span class="mono">${esc(eu.username)}</span>)</h2>
            <div class="actions" style="margin:0">
              <button class="btn pri" data-act="xusave" data-id="${eu.id}">💾 حفظ التعديلات والصلاحيات</button>
              <button class="btn" data-act="xucancel">إلغاء</button>
            </div>
          </div>
          <div class="inline-form" style="margin-top:12px">
            <label>الاسم الكامل<input id="xe-name" value="${esc(eu.name)}" maxlength="100" aria-label="الاسم"></label>
            <label>الدور الأساسي / القالب<select id="xe-role" data-act="xerolechg" aria-label="الدور">${roleOpts(eu.roleKey)}</select></label>
            <label>القسم / الوحدة الإدارية<select id="xe-unit" data-act="xeunitchg" aria-label="الوحدة">${unitOpts(eu.unit && eu.unit.id)}</select></label>
            <label>نوع العضو<select id="xe-kind" aria-label="النوع"><option value="admin"${eu.staffKind === 'admin' ? ' selected' : ''}>هيئة إدارية</option><option value="faculty"${eu.staffKind === 'faculty' ? ' selected' : ''}>هيئة تدريسية</option></select></label>
            <label>المسمى الوظيفي<input id="xe-title" value="${esc(eu.jobTitle)}" maxlength="80" placeholder="المسمى الوظيفي" aria-label="المسمى الوظيفي"></label>
          </div>
          ${renderGranularPermissionBuilder('edit')}
          <div class="actions" style="margin-top:14px">
            <button class="btn pri" data-act="xusave" data-id="${eu.id}">💾 حفظ التعديلات والصلاحيات</button>
            <button class="btn" data-act="xucancel">إلغاء</button>
          </div>
        </section>`;
      }
    }

    const filteredUsers = X.data.users.filter((u) => {
      if (X.userUnitFilter && String(u.unit?.id || '') !== String(X.userUnitFilter)) return false;
      if (X.userModeFilter) {
        const m = u.accessMode || 'role';
        const bucket = m === 'custom' ? 'custom' : 'hybrid'; // 'role' قيمة قديمة تُعامَل كموروث أيضاً
        if (bucket !== X.userModeFilter) return false;
      }
      if (X.userSearch) {
        const q = X.userSearch.trim().toLowerCase();
        const hay = `${u.username} ${u.name} ${u.roleLabel} ${u.unit?.name || ''} ${u.jobTitle || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const rows = filteredUsers
      .map((u) => {
        const self = S.me && u.id === S.me.id;
        const permCount = u.permissionCount || 0;
        const modeTag = MODE_LABELS[u.accessMode || 'role'] || 'تلقائي';
        const scopeTag = SCOPE_LABELS[u.dataScope || 'unit'] || 'نطاق الوحدة';
        return `<tr${X.edit === u.id ? ' style="background:rgba(5,66,57,0.08)"' : ''}>
          <td class="mono"><b>${esc(u.username)}</b></td>
          <td>
            <b>${esc(u.name)}</b>
            <div class="small">${u.staffKind === 'faculty' ? 'هيئة تدريسية' : 'هيئة إدارية'}${u.jobTitle ? ' · ' + esc(u.jobTitle) : ''}</div>
          </td>
          <td>
            <b>${esc(u.roleLabel)}</b>
            <div class="small" style="color:#054239">${esc(modeTag)}</div>
          </td>
          <td>
            ${u.unit ? `<b>${esc(u.unit.name)}</b>` : '<span class="hint">— الإدارة العامة —</span>'}
            <div class="small">${esc(scopeTag)}</div>
          </td>
          <td>
            <div class="small"><b>${permCount}</b> صلاحية فعّالة · <b>${u.viewCount || 0}</b> شاشة</div>
            ${renderUserCapabilitiesBadges(u)}
          </td>
          <td>
            ${u.active ? '<span class="ok-t">فعّال</span>' : '<span class="bad-t">معطّل</span>'}
            ${u.locked ? ' <span class="small">(مقفل)</span>' : ''}
            ${u.mustChange ? ' <div class="small">(كلمة مرور مؤقتة)</div>' : ''}
          </td>
          <td style="white-space:nowrap">
            <button class="btn sm pri" data-act="xuedit" data-id="${u.id}">تعديل وصلاحيات ⚙️</button>
            <button class="btn sm" data-act="xupw" data-id="${u.id}">كلمة مرور جديدة</button>
            ${u.id !== UA.S.me.id ? `<button class="btn sm" data-act="xumfa" data-id="${u.id}">إعادة ضبط التحقق بخطوتين</button>` : ''}
            ${
              self
                ? ''
                : ` <button class="btn sm" data-act="xuactive" data-id="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm bad" data-act="xudel" data-id="${u.id}">حذف</button>`
            }
          </td>
        </tr>`;
      })
      .join('');

    return `${c}${editPanelHtml}
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <h2 style="margin:0">➕ تأسيس حساب إداري / تدريسي جديد وتحديد صلاحياته</h2>
            <p class="hint" style="margin:4px 0 0">أنشئ الحساب وحدّد القسم والدور ومصفوفة السماحيات التفصيلية (عرض، كتابة، تعديل، اعتماد، حذف/تصدير) لأي جزء من المنصة.</p>
          </div>
        </div>
        <form id="xuser" style="margin-top:12px">
          <div class="inline-form">
            <label>اسم المستخدم (لاتيني)<input id="xn-name" autocomplete="off" dir="ltr" class="mono" placeholder="emp_ahmed" required></label>
            <label>الاسم الكامل للموظف<input id="xn-disp" maxlength="100" placeholder="أحمد محمود العلي" required></label>
            <label>الدور الأساسي<select id="xn-role" data-act="xnrolechg">${roleOpts(X.builder.roleKey)}</select></label>
            <label>القسم / الوحدة الإدارية<select id="xn-unit" data-act="xnunitchg">${unitOpts(null)}</select></label>
            <label>نوع العضو<select id="xn-kind"><option value="admin">هيئة إدارية</option><option value="faculty">هيئة تدريسية</option></select></label>
            <label>المسمى الوظيفي<input id="xn-title" maxlength="80" placeholder="رئيس دائرة / محاسب / مرشد..."></label>
            <label>كلمة مرور مؤقتة<input id="xn-pw" type="text" dir="ltr" class="mono" autocomplete="new-password" required></label>
            <div class="actions" style="margin:0;align-self:flex-end">
              <button class="btn" type="button" data-act="xgen">توليد كلمة مرور</button>
              <button class="btn pri" type="submit">إنشاء الحساب واعتماد الصلاحيات</button>
            </div>
          </div>
          ${renderGranularPermissionBuilder('new')}
          <div class="actions" style="margin-top:14px;justify-content:flex-end">
            <button class="btn pri" type="submit">إنشاء الحساب واعتماد مصفوفة الصلاحيات ✓</button>
          </div>
        </form>
      </section>

      <section class="card" style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h2 style="margin:0">الحسابات الإدارية والتدريسية <span class="small">(${filteredUsers.length} من ${X.data.users.length})</span></h2>
          <div class="inline-form" style="margin:0">
            <input id="xu-q" placeholder="بحث بالاسم أو المستخدم أو المسمى..." value="${esc(X.userSearch)}" data-act="xufFilter" style="min-width:210px">
            <select id="xu-unit-f" data-act="xufFilter"><option value="">كل الأقسام والوحدات</option>${X.data.units.map((u) => `<option value="${u.id}"${String(u.id) === String(X.userUnitFilter) ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
            <select id="xu-mode-f" data-act="xufFilter">
              <option value="">كل أنماط الصلاحيات</option>
              <option value="hybrid"${X.userModeFilter === 'hybrid' ? ' selected' : ''}>موروث من الدور والقسم</option>
              <option value="custom"${X.userModeFilter === 'custom' ? ' selected' : ''}>مخصص بالكامل</option>
            </select>
          </div>
        </div>
        <p class="hint">اضغط على «تعديل وصلاحيات ⚙️» أمام أي موظف لفتح مصفوفة الوصول وتعديل ما يحق له عرضه أو كتابته أو تعديله أو اعتماده في كل قسم.</p>
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>المستخدم</th>
                <th>الاسم والمسمى</th>
                <th>الدور وآلية الوصول</th>
                <th>القسم ونطاق البيانات</th>
                <th>السماحيات الممنوحة (عرض/كتابة/تعديل/اعتماد)</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty">لا توجد حسابات مطابقة للفلتر.</td></tr>'}</tbody>
          </table>
        </div>
      </section>`;
  }

  /* ---------- تبويب 2: الأدوار والقوالب الوظيفية ---------- */
  // شبكة اختيار صلاحيات الفهرس الكامل (15 مجموعة)، مشتركة بين محرر الدور ومحرر صلاحيات القسم بدل تكرارها لكل منهما:
  // sel مصفوفة أو Set، وact اختياري (data-act) لتبديل فوري عند كل نقرة بدل قراءتها عند إرسال النموذج فقط
  function permBoxes(sel, locked, act) {
    const m = mine();
    const has = sel && typeof sel.has === 'function' ? (k) => sel.has(k) : (k) => (sel || []).includes(k);
    return X.data.catalog
      .map(
        (g) =>
          `<fieldset class="perm-g"><legend>${esc(g.group)}</legend>${g.items
            .map((i) => {
              const ok = m.has(i.key) && !locked;
              return `<label class="perm${ok ? '' : ' off'}"><input type="checkbox"${act ? ` data-act="${act}"` : ''} data-perm="${esc(i.key)}"${has(i.key) ? ' checked' : ''}${ok ? '' : ' disabled'}> <span>${esc(i.label)}</span><span class="mono small" dir="ltr">${esc(i.key)}</span></label>`;
            })
            .join('')}</fieldset>`
      )
      .join('');
  }

  function rolesTab() {
    const d = X.data;
    const cur = X.rsel === 'new' ? null : [...d.roles, d.studentRole].find((r) => r.key === X.rsel);
    const rows = [...d.roles, d.studentRole]
      .map(
        (r) =>
          `<tr class="row" tabindex="0" data-act="xrsel" data-k="${esc(r.key)}" aria-selected="${X.rsel === r.key}">
            <td><b>${esc(r.label)}</b> <span class="mono small">${esc(r.key)}</span></td>
            <td>${r.fixed ? 'حساب الطالب (ثابت)' : r.builtin ? 'أساسي' : 'مخصّص / قسم'}</td>
            <td><b>${r.permissions.length}</b> صلاحية</td>
            <td>${r.users}</td>
            <td>${r.active ? '<span class="ok-t">فعّال</span>' : '<span class="bad-t">معطّل</span>'}</td>
          </tr>`
      )
      .join('');

    const presetOptions = (d.rolePresets || [])
      .map((p) => `<button type="button" class="btn sm" data-act="xrolepreset" data-pid="${esc(p.id)}">⚡ ${esc(p.label)}</button>`)
      .join('');

    let side;
    if (X.rsel === 'new') {
      side = `<h2>إنشاء دور وظيفي جديد</h2>
        <div style="margin-bottom:12px;padding:10px;background:#F6F8F5;border:1px solid #DCE3DD;border-radius:8px">
          <div class="small" style="font-weight:700;margin-bottom:6px">تعبئة سريعة من قوالب الأقسام:</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${presetOptions}</div>
        </div>
        <form class="form" id="xrole" style="border:0;margin:0;padding:0">
          <div class="inline-form">
            <label>الرمز اللاتيني للدور<input id="xr-key" dir="ltr" class="mono" maxlength="30" placeholder="admissions_supervisor" required></label>
            <label>اسم الدور بالعربية<input id="xr-label" maxlength="60" placeholder="مشرف القبول والمعادلة" required></label>
          </div>
          <label>الوصف والمسؤوليات<input id="xr-desc" maxlength="200"></label>
          ${permBoxes([], false)}
          <div class="actions" style="margin:0"><button class="btn pri" type="submit">إنشاء الدور</button><button class="btn" type="button" data-act="xrcancel">إلغاء</button></div>
        </form>`;
    } else if (cur && cur.fixed) {
      const canEdit = UA.can('settings:manage');
      const toggle = (item) => `<label class="perm" style="padding:6px 10px;border:1px solid #DCE3DD;border-radius:8px"><input type="checkbox" data-act="xstudtoggle" data-setting="${esc(item.setting)}"${item.enabled ? ' checked' : ''}${canEdit ? '' : ' disabled'}> <span>${esc(item.label)}</span></label>`;
      side = `<h2>${esc(cur.label)}</h2><p class="hint">${esc(cur.description)} الإعدادات هنا تسري على كل حسابات الطلاب.</p>
        <h3 style="margin:14px 0 8px">الشاشات التي يعرضها حساب الطالب</h3>
        <p class="small" style="margin:0 0 8px">«الرئيسية» و«الإرشادات» ظاهرتان دائماً.</p>
        <div style="display:grid;gap:6px">${(cur.views || []).map(toggle).join('')}</div>
        <h3 style="margin:14px 0 8px">صلاحيات الطالب</h3>
        <div style="display:grid;gap:6px">${(cur.allPermissions || []).map(toggle).join('')}</div>
        ${canEdit ? '' : '<p class="small">تعديلها يتطلب صلاحية إدارة الإعدادات.</p>'}`;
    } else if (cur && cur.builtin) {
      side = `<h2>${esc(cur.label)} <span class="small">(دور أساسي، ثابت)</span></h2><p class="hint">${esc(cur.description)}</p>${permBoxes(cur.permissions, true)}`;
    } else if (cur) {
      const ok = covers(cur.permissions);
      side = `<h2>${esc(cur.label)}</h2>
        ${
          ok
            ? `<div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap">${presetOptions}</div>`
            : ''
        }
        <form class="form" id="xrole" style="border:0;margin:0;padding:0">
          <div class="inline-form"><label>الاسم<input id="xr-label" maxlength="60" value="${esc(cur.label)}" required></label><label>الرمز<input value="${esc(cur.key)}" class="mono" dir="ltr" disabled></label></div>
          <label>الوصف<input id="xr-desc" maxlength="200" value="${esc(cur.description)}"></label>
          ${permBoxes(cur.permissions, !ok)}
          <p class="small">تعديل الصلاحيات أو التعطيل يُنهي جلسات أصحاب هذا الدور فيدخلون من جديد بالصلاحيات المحدثة.</p>
          ${
            ok
              ? `<div class="actions" style="margin:0"><button class="btn pri" type="submit">حفظ التعديلات</button><button class="btn" type="button" data-act="xractive" data-k="${esc(cur.key)}" data-on="${cur.active ? 0 : 1}">${cur.active ? 'تعطيل الدور' : 'تفعيل الدور'}</button><button class="btn bad" type="button" data-act="xrdel" data-k="${esc(cur.key)}">حذف</button></div>`
              : '<p class="reason">هذا الدور أوسع من صلاحياتك؛ لا يمكنك تعديله.</p>'
          }
        </form>`;
    } else {
      side = '<h2>تفاصيل الدور</h2><div class="empty">اختر دوراً من الجدول لعرض وتعديل صلاحياته، أو اضغط «دور جديد».</div>';
    }

    return `<div class="grid2">
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">الأدوار الوظيفية (${d.roles.length + 1})</h2>
          <button class="btn pri" data-act="xrnew">+ دور جديد</button>
        </div>
        <p class="small">تشمل الأدوار الأساسية، وأدوار رؤساء الأقسام والوحدات الـ 30، وأي أدوار مخصصة تنشئها.</p>
        <div class="tbl-wrap"><table><thead><tr><th>الدور</th><th>النوع</th><th>الصلاحيات</th><th>الحسابات</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>
      </section>
      <section class="card">${side}</section>
    </div>`;
  }

  /* ---------- تبويب 3: الوحدات الإدارية وصلاحيات الأقسام ---------- */
  // مخطط الهيكل التنظيمي: نفس بيانات الوحدات الحية التي يحرّرها الجدول أدناه، بعرض بصري بدل صفوف جدول
  // الجذر في الأعلى، والإدارات المباشرة تحته في شبكة أعمدة تلتف تلقائياً، وتحت كل إدارة فروعها شجرة رأسية.
  // الشجرة الأفقية الكلاسيكية تصير بعرض آلاف البكسلات حين يتبع الجذرَ عشرات الإدارات، فتضيع الفروع خارج الشاشة.
  function renderOrgChart(units) {
    const kids = (p) => units.filter((u) => (u.parentId ?? null) === p);
    const count = (u) => kids(u.id).reduce((n, c) => n + 1 + count(c), 0);
    const actions = (u) => `<div class="oc-node-actions">
        <button type="button" class="btn sm" data-act="xurename" data-id="${u.id}" title="إعادة تسمية">✏️</button>
        <button type="button" class="btn sm" data-act="xupermedit" data-id="${u.id}" title="صلاحيات القسم">⚙️</button>
        <button type="button" class="btn sm" data-act="xuntoggle" data-id="${u.id}" data-on="${u.active ? 0 : 1}" title="${u.active ? 'تعطيل' : 'تفعيل'}">${u.active ? '⏸️' : '▶️'}</button>
      </div>`;
    const box = (u, cls) => `<div class="oc-box ${cls}${u.active ? '' : ' oc-off'}">
        <div class="oc-node-main">
          <b>${esc(u.name)}</b>
          <span class="small">${KIND[u.kind] || ''}${u.active ? '' : ' · معطّلة'}${(u.heads || []).length ? ' · ' + u.heads.map((h) => esc(h.username)).join('، ') : ''}</span>
        </div>
        ${actions(u)}
      </div>`;
    const branch = (list) => list.length
      ? `<ul class="oc-tree">${list.map((c) => `<li>${box(c, 'oc-leaf')}${branch(kids(c.id))}</li>`).join('')}</ul>`
      : '';

    const roots = kids(null);
    if (!roots.length) return '<div class="empty">لا وحدات بعد.</div>';
    return roots
      .map((r) => {
        const depts = kids(r.id);
        return `<div class="oc-chart">
          <div class="oc-top">${box(r, 'oc-root-box')}<span class="small">${depts.length} إدارة مباشرة · ${count(r)} وحدة إجمالاً</span></div>
          ${depts.length ? `<div class="oc-grid">${depts
            .map((d) => `<section class="oc-dept">${box(d, 'oc-dept-box')}${branch(kids(d.id))}</section>`)
            .join('')}</div>` : ''}
        </div>`;
      })
      .join('');
  }

  function unitsTab() {
    const d = X.data;
    const kids = (p) => d.units.filter((u) => (u.parentId ?? null) === p);

    let unitPermModal = '';
    if (X.unitPermEdit) {
      const uObj = d.units.find((u) => u.id === X.unitPermEdit.id);
      if (uObj) {
        const selSet = X.unitPermEdit.perms;
        const boxes = permBoxes(selSet, false, 'xupermchk');
        unitPermModal = `<section class="card" style="border:2px solid #054239;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <div>
              <h2 style="margin:0;color:#054239">🏢 تخصيص الصلاحيات الافتراضية لقسم: ${esc(uObj.name)}</h2>
              <p class="small" style="margin:4px 0 0">أي موظف يُسنَد إلى هذا القسم سيرث هذه الصلاحيات تلقائياً بالإضافة إلى صلاحيات دوره.</p>
            </div>
            <div class="actions" style="margin:0">
              <button class="btn pri" data-act="xupermsave" data-id="${uObj.id}">💾 حفظ صلاحيات القسم</button>
              <button class="btn" data-act="xupermcancel">إلغاء</button>
            </div>
          </div>
          <div style="margin:10px 0;display:flex;gap:6px;flex-wrap:wrap">
            ${(d.rolePresets || []).map((p) => `<button type="button" class="btn sm" data-act="xunitpreset" data-pid="${esc(p.id)}">⚡ تطبيق قالب: ${esc(p.label)}</button>`).join('')}
          </div>
          ${boxes}
        </section>`;
      }
    }

    const tree = (p, depth) =>
      kids(p)
        .map(
          (u) => `<tr${u.active ? '' : ' style="opacity:.55"'}>
            <td style="padding-inline-start:${12 + depth * 22}px">
              ${depth ? '↳ ' : ''}<b>${esc(u.name)}</b> <span class="small">(${KIND[u.kind] || ''})</span>
              ${u.description ? `<div class="small">${esc(u.description)}</div>` : ''}
              ${u.module ? `<div class="small" style="color:#054239">وحدة النظام: ${esc(u.module)}</div>` : ''}
              ${(u.heads || []).length ? `<div class="small">الحسابات: ${u.heads.map((h) => `<span class="mono">${esc(h.username)}</span>${h.active ? '' : ' (معطّل)'}`).join('، ')}</div>` : ''}
            </td>
            <td>
              <span class="pill ${(u.defaultPermissions || []).length ? 'p-approved' : 'p-review'}">${(u.defaultPermissions || []).length} صلاحية قسم افتراضية</span>
            </td>
            <td>${u.users}</td>
            <td>${u.pending}</td>
            <td style="white-space:nowrap">
              <button class="btn sm pri" data-act="xupermedit" data-id="${u.id}">صلاحيات القسم ⚙️</button>
              <button class="btn sm" data-act="xurename" data-id="${u.id}">إعادة تسمية</button>
              <button class="btn sm" data-act="xuntoggle" data-id="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'تعطيل' : 'تفعيل'}</button>
              <button class="btn sm bad" data-act="xundel" data-id="${u.id}">حذف</button>
            </td>
          </tr>${tree(u.id, depth + 1)}`
        )
        .join('');

    const uOpt = (sel) => d.units.filter((u) => u.active).map((u) => `<option value="${u.id}"${u.id === sel ? ' selected' : ''}>${esc(u.name)}</option>`).join('');
    const links = d.links
      .map(
        (l) =>
          `<li><span><b>${esc(unitName(l.from))}</b> ${l.twoWay ? '↔' : '←'} <b>${esc(unitName(l.to))}</b> <span class="small">${
            l.twoWay ? '(في الاتجاهين)' : `(الإحالة من ${esc(unitName(l.from))} إلى ${esc(unitName(l.to))} فقط)`
          }</span></span> <button class="btn sm bad" data-act="xldel" data-id="${l.id}">حذف</button></li>`
      )
      .join('');

    return `<div class="stack">
      ${unitPermModal}
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h2 style="margin:0">الهيكل التنظيمي للجامعة وصلاحياتها الافتراضية</h2>
          <div class="sub-tabs no-print" role="tablist">
            <button class="chip" role="tab" data-act="xunitsview" data-v="list" aria-pressed="${X.unitsView !== 'chart'}">📋 جدول</button>
            <button class="chip" role="tab" data-act="xunitsview" data-v="chart" aria-pressed="${X.unitsView === 'chart'}">🗂️ مخطط الهيكل</button>
          </div>
        </div>
        <p class="hint" style="margin-top:4px">يمكنك تحديد حزمة صلاحيات افتراضية لكل قسم أو كلية أو مكتب عبر زر «صلاحيات القسم ⚙️»، بحيث تُمنح تلقائياً لموظفي ذلك القسم. أي تعديل هنا (تسمية، تفعيل، صلاحيات، إضافة أو حذف) يسري فوراً على كامل الموقع، لأن كل شاشة تعرض الأقسام تقرأ من نفس هذا الهيكل.</p>
        ${X.unitsView === 'chart'
          ? `<div class="tbl-wrap" style="overflow-x:auto">${renderOrgChart(d.units)}</div>`
          : `<div class="tbl-wrap"><table><thead><tr><th>الوحدة / القسم</th><th>صلاحيات القسم</th><th>الحسابات الفعالة</th><th>طلبات معلّقة</th><th>إجراءات</th></tr></thead><tbody>${tree(null, 0)}</tbody></table></div>`}
        <h2 style="margin-top:18px">إضافة قسم / وحدة إدارية جديدة</h2>
        <form class="inline-form" id="xunit">
          <label>الاسم<input id="xun-name" maxlength="80" required></label>
          <label>النوع<select id="xun-kind"><option value="department">إدارة / قسم</option><option value="office">مكتب</option><option value="college">كلية</option><option value="sector">قطاع</option></select></label>
          <label>تتبع لـ<select id="xun-parent"><option value="">— بلا —</option>${uOpt(null)}</select></label>
          <button class="btn pri" type="submit">إضافة</button>
        </form>
      </section>
      <section class="card">
        <h2>الترابط ومسارات الإحالة بين الأقسام</h2>
        <p class="hint" style="margin-top:0">الرابط يتيح لموظفي وحدة أن <b>يحيلوا الطلبات والمعاملات</b> إلى الوحدة الأخرى (وبالعكس إن كان في الاتجاهين).</p>
        <ul class="mini-list link-list">${links || '<li class="empty">لا روابط.</li>'}</ul>
        <h2 style="margin-top:18px">رابط جديد</h2>
        <form class="inline-form" id="xlink">
          <label>من<select id="xl-from">${uOpt(null)}</select></label>
          <label>إلى<select id="xl-to">${uOpt(null)}</select></label>
          <label class="chk"><input id="xl-two" type="checkbox" checked> في الاتجاهين</label>
          <button class="btn pri" type="submit">ربط</button>
        </form>
      </section>
    </div>`;
  }

  /* ---------- تبويب 4: مصفوفة الصلاحيات الشاملة ---------- */
  function matrixTab() {
    const roles = X.data.roles, st = X.data.studentRole, stKeys = new Set(st.permissions.map((q) => q.key)), cols = roles.length + 2;
    const cell = (on) => `<td class="mx">${on ? '<span class="ok-t" aria-label="مسموح">✓</span>' : '<span class="hint" aria-label="غير مسموح">·</span>'}</td>`;
    const head = `<tr><th>الصلاحية</th>${roles
      .map(
        (r) =>
          `<th class="mx"${r.active ? '' : ' style="opacity:.55"'}>${esc(r.label)}${r.builtin ? '' : '<div class="small">مخصّص</div>'}${
            r.active ? '' : '<div class="small">معطّل</div>'
          }<div class="small">${r.users} حساب</div></th>`
      )
      .join('')}<th class="mx">${esc(st.label)}<div class="small">${st.users} حساب</div></th></tr>`;

    const q = (X.matrixFilter || '').trim().toLowerCase();
    const filteredCatalog = X.data.catalog
      .map((g) => ({
        group: g.group,
        items: g.items.filter((i) => !q || i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0);

    const body =
      filteredCatalog
        .map(
          (g) =>
            `<tr class="mx-g"><td colspan="${cols}">${esc(g.group)}</td></tr>` +
            g.items
              .map(
                (i) =>
                  `<tr><td>${esc(i.label)} <span class="mono small" dir="ltr">${esc(i.key)}</span></td>${roles
                    .map((r) => cell(r.permissions.includes(i.key)))
                    .join('')}${cell(stKeys.has(i.key))}</tr>`
              )
              .join('')
        )
        .join('') +
      (!q
        ? `<tr class="mx-g"><td colspan="${cols}">صلاحيات حساب الطالب (ثابتة)</td></tr>` +
          st.permissions
            .filter((p) => !X.data.catalog.some((g) => g.items.some((i) => i.key === p.key)))
            .map(
              (p) =>
                `<tr><td>${esc(p.label)} <span class="mono small" dir="ltr">${esc(p.key)}</span></td>${roles
                  .map(() => cell(false))
                  .join('')}${cell(true)}</tr>`
            )
            .join('')
        : '');

    const desc = [...roles.filter((r) => r.builtin), st].map((r) => `<li><b>${esc(r.label)}:</b> ${esc(r.description)}</li>`).join('');
    const totalPerms = X.data.catalog.reduce((n, g) => n + g.items.length, 0);

    return `<section class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <h2 style="margin:0">مصفوفة الصلاحيات الشاملة <span class="small">(${roles.length + 1} دوراً · ${totalPerms} صلاحية قابلة للإسناد عبر ${X.data.catalog.length} مجموعة)</span></h2>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="mx-q" placeholder="ابحث عن صلاحية أو قسم..." value="${esc(X.matrixFilter)}" data-act="xmxfilter" style="min-width:220px">
          <a class="btn pri" href="/api/admin/access/matrix.xlsx" download>تصدير المصفوفة (Excel)</a>
        </div>
      </div>
      <ul class="mini-list" style="margin:14px 0">${desc}</ul>
      <div class="tbl-wrap"><table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="small">«عرض كل الطلبات» يتقدّم على «عرض طلبات وحدته فقط». الأدوار المعطّلة تظهر باهتة. أدوار رؤساء الوحدات (head_…) أُنشئت من الهيكل التنظيمي.</p>
    </section>`;
  }

  UA.views.access = () => {
    if (!X.data) return '<div class="empty">جارٍ التحميل…</div>';
    const tabs = tabsAvail();
    if (!tabs.some((t) => t[0] === X.tab)) X.tab = tabs[0][0];
    const totalPerms = X.data.catalog.reduce((n, g) => n + g.items.length, 0);
    const kpiStrip = `<div class="stats no-print" style="margin-bottom:14px">
      <div class="stat"><small>الحسابات الإدارية والتدريسية</small><b>${X.data.users.length}</b></div>
      <div class="stat"><small>الأقسام والوحدات التنظيمية</small><b>${X.data.units.length}</b></div>
      <div class="stat"><small>الأدوار الوظيفية والقوالب</small><b>${X.data.roles.length}</b></div>
      <div class="stat"><small>أقسام المنصة والصلاحيات التفصيلية</small><b>${(X.data.modulesMatrix || []).length} قسم · ${totalPerms} صلاحية</b></div>
    </div>`;
    return kpiStrip + bar(tabs, X.tab, 'xtab') + ({ users: usersTab, roles: rolesTab, units: unitsTab, matrix: matrixTab }[X.tab])();
  };

  UA.loaders.access = async () => {
    X.data = await api('GET', '/api/admin/access');
    ensureBuilderInit();
  };

  const reload = async () => {
    await UA.loaders.access();
    UA.render();
  };
  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      if (!e.status) throw e;
      toast(e.message);
    }
  };
  const checked = () => [...document.querySelectorAll('#xrole input[data-perm]:checked')].map((e) => e.dataset.perm);

  // ربط أحداث التغيير لعناصر select والبحث داخل شاشة الصلاحيات
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || S.view !== 'access') return;
    const act = el.dataset.act;
    if (act === 'xmodlvl') {
      const bState = activeBuilderState(el.dataset.target === 'edit');
      const mod = (X.data.modulesMatrix || []).find((m) => m.id === el.dataset.mod);
      if (mod) {
        if (bState.accessMode === 'role') bState.accessMode = 'hybrid';
        applyQuickModuleLevel(bState, mod, el.value);
        UA.render();
      }
    } else if (act === 'xmodechg') {
      const bState = activeBuilderState(el.dataset.target === 'edit');
      bState.accessMode = el.value;
      UA.render();
    } else if (act === 'xscopechg') {
      const bState = activeBuilderState(el.dataset.target === 'edit');
      bState.dataScope = el.value;
    } else if (act === 'xnrolechg' || act === 'xnunitchg') {
      X.builder.roleKey = val('xn-role') || 'staff';
      const unitId = val('xn-unit');
      if (unitId) X.builder.dataScope = 'unit';
      syncBuilderFromRoleAndUnit(X.builder, X.builder.roleKey, unitId);
      UA.render();
    } else if (act === 'xerolechg' || act === 'xeunitchg') {
      if (X.editBuilder) {
        X.editBuilder.roleKey = val('xe-role') || 'staff';
        syncBuilderFromRoleAndUnit(X.editBuilder, X.editBuilder.roleKey, val('xe-unit'));
        UA.render();
      }
    } else if (act === 'xufFilter') {
      X.userSearch = val('xu-q');
      X.userUnitFilter = val('xu-unit-f');
      X.userModeFilter = val('xu-mode-f');
      UA.render();
    } else if (act === 'xviewstpl') {
      const bState = activeBuilderState(el.dataset.target === 'edit');
      const preset = (X.data.rolePresets || []).find((p) => p.id === el.value);
      if (preset) {
        bState.allowedViews = new Set(preset.allowedViews || []);
        keepHybrid(bState, el.dataset.target);
        el.value = '';
        const body = document.querySelector(`[data-xv-body="${el.dataset.target}"]`);
        if (body) body.outerHTML = renderViewsBody(bState, el.dataset.target);
      }
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || S.view !== 'access') return;
    if (el.dataset.act === 'xmxfilter') {
      X.matrixFilter = el.value;
      UA.render();
      const inp = $id('mx-q');
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    } else if (el.id === 'xu-q') {
      X.userSearch = el.value;
      UA.render();
      const inp = $id('xu-q');
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    } else if (el.dataset.act === 'xviewssearch') {
      const bState = activeBuilderState(el.dataset.target === 'edit');
      bState.viewsSearch = el.value;
      const body = document.querySelector(`[data-xv-body="${el.dataset.target}"]`);
      if (body) body.outerHTML = renderViewsBody(bState, el.dataset.target);
    }
  });

  Object.assign(UA.actions, {
    xtab: async (el, d) => {
      X.tab = d.t;
      X.edit = null;
      X.editBuilder = null;
      UA.render();
    },
    xgen: async () => {
      const pwEl = $id('xn-pw');
      if (pwEl) pwEl.value = genPw();
    },
    xcredx: async () => {
      X.cred = null;
      UA.render();
    },
    xcopy: async () => {
      try {
        await navigator.clipboard.writeText(`${X.cred.username}\n${X.cred.tempPassword}`);
        toast('تم النسخ');
      } catch {
        toast('تعذّر النسخ؛ انسخ يدوياً');
      }
    },
    // تفاعل مصفوفة الصلاحيات عند الإنشاء أو التعديل
    xmodchk: async (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      const mod = (X.data.modulesMatrix || []).find((m) => m.id === d.mod);
      if (!mod) return;
      if (bState.accessMode === 'role') bState.accessMode = 'hybrid';
      setModuleActionState(bState, mod, d.op, el.checked);
      UA.render();
    },
    xcoltoggle: async (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      const modules = X.data.modulesMatrix || [];
      if (bState.accessMode === 'role') bState.accessMode = 'hybrid';
      const allOn = modules.every((mod) => getModuleActionState(bState, mod, d.col));
      for (const mod of modules) {
        setModuleActionState(bState, mod, d.col, !allOn);
      }
      UA.render();
    },
    xpreset: async (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      const preset = (X.data.rolePresets || []).find((p) => p.id === d.pid);
      if (!preset) return;
      const m = mine();
      bState.accessMode = 'custom';
      bState.dataScope = preset.dataScope || 'unit';
      bState.customPerms = new Set((preset.permissions || []).filter((p) => m.has(p)));
      bState.revokedPerms = new Set();
      bState.allowedViews = new Set(preset.allowedViews || []);
      toast(`تم تطبيق قالب: ${preset.label}`);
      UA.render();
    },
    xbulk: async (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      const modules = X.data.modulesMatrix || [];
      if (d.op === 'sync_role') {
        const rKey = d.target === 'edit' ? val('xe-role') || bState.roleKey : val('xn-role') || bState.roleKey;
        const uId = d.target === 'edit' ? val('xe-unit') : val('xn-unit');
        bState.accessMode = 'hybrid';
        syncBuilderFromRoleAndUnit(bState, rKey, uId);
        toast('تمت مطابقة الصلاحيات مع الدور والقسم');
      } else if (d.op === 'read_all') {
        bState.accessMode = 'custom';
        bState.customPerms = new Set();
        for (const mod of modules) applyQuickModuleLevel(bState, mod, 'read');
        toast('تم ضبط الصلاحيات على «عرض واطلاع فقط» لكافة أقسام المنصة');
      } else if (d.op === 'full_all') {
        bState.accessMode = 'custom';
        for (const mod of modules) applyQuickModuleLevel(bState, mod, 'full');
        toast('تم منح كامل الصلاحيات المتاحة لكافة الأقسام');
      } else if (d.op === 'clear_all') {
        bState.accessMode = 'custom';
        bState.customPerms = new Set();
        bState.allowedViews = new Set(['desk', 'verify']);
        toast('تم تفريغ الصلاحيات');
      }
      UA.render();
    },
    // الاختيار لا يعيد رسم الشاشة حتى يبقى موضع التمرير والقسم المفتوح كما هما
    // تخصيص الشاشات: استبدال لوحة الشاشات وحدها (outerHTML) بدل إعادة رسم كامل الصفحة، فلا يفقد المستخدم موضع التمرير داخل نموذج الحساب الطويل
    // تحديث لوحة الشاشات وحدها (data-xv-body)، لا الجذر كله بما فيه حقل البحث، فلا يفقد التركيز أثناء الكتابة فيه
    xviewsgsel: (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      bState.viewsGroup = d.g;
      const body = document.querySelector(`[data-xv-body="${d.target}"]`);
      if (body) body.outerHTML = renderViewsBody(bState, d.target);
    },
    xviewchk: (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      if (bState.allowedViews.size === 0) {
        for (const v of X.data.allViews || []) bState.allowedViews.add(v.key);
      }
      if (el.checked) bState.allowedViews.add(d.vk);
      else bState.allowedViews.delete(d.vk);
      keepHybrid(bState, d.target);
      const body = document.querySelector(`[data-xv-body="${d.target}"]`);
      if (body) body.outerHTML = renderViewsBody(bState, d.target);
    },
    xtabchk: (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      bState.hiddenTabs = bState.hiddenTabs || new Set();
      if (el.checked) bState.hiddenTabs.delete(d.key);
      else bState.hiddenTabs.add(d.key);
      keepHybrid(bState, d.target);
      // إعادة رسم اللوحة لتحديث عدّاد «تغييرات غير محفوظة» فقط؛ تمر بمهلة قصيرة كي لا يُقاطع التبديل نفسه وهو يحدث
      const body = document.querySelector(`[data-xv-body="${d.target}"]`);
      if (body) body.outerHTML = renderViewsBody(bState, d.target);
    },
    // «تفعيل كل الشاشات» تُزيل أي تقييد. «الشاشات المرتبطة بصلاحياته فقط» تحصر الشاشات بما ترتبط فعلاً
    // بأقسام منصة يملك فيها الحساب أي مستوى وصول حالياً (عبر mod.viewKeys)، بدل تفريغها بلا تمييز كما كان سابقاً
    xviewsall: (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      const all = (X.data.allViews || []).map((v) => v.key);
      if (d.on === '1') {
        bState.allowedViews = new Set(all);
      } else {
        const owned = new Set();
        for (const mod of X.data.modulesMatrix || []) {
          const active = ['view', 'write', 'edit', 'approve', 'delete'].some((k) => getModuleActionState(bState, mod, k));
          if (active) for (const vk of mod.viewKeys || []) owned.add(vk);
        }
        bState.allowedViews = owned.size ? owned : new Set(['desk']);
      }
      keepHybrid(bState, d.target);
      const body = document.querySelector(`[data-xv-body="${d.target}"]`);
      if (body) body.outerHTML = renderViewsBody(bState, d.target);
    },
    xviewsgroupall: (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      if (bState.allowedViews.size === 0) {
        for (const v of X.data.allViews || []) bState.allowedViews.add(v.key);
      }
      for (const v of X.data.allViews || []) {
        if (v.group !== d.g) continue;
        if (d.on === '1') bState.allowedViews.add(v.key);
        else bState.allowedViews.delete(v.key);
      }
      keepHybrid(bState, d.target);
      const body = document.querySelector(`[data-xv-body="${d.target}"]`);
      if (body) body.outerHTML = renderViewsBody(bState, d.target);
    },
    xviewsonlyactive: (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      bState.viewsOnlyActive = !bState.viewsOnlyActive;
      el.setAttribute('aria-pressed', String(bState.viewsOnlyActive));
      const body = document.querySelector(`[data-xv-body="${d.target}"]`);
      if (body) body.outerHTML = renderViewsBody(bState, d.target);
    },
    xviewsundo: (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      const snap = bState.viewsSnapshot;
      if (snap) { bState.allowedViews = new Set(snap.views); bState.hiddenTabs = new Set(snap.tabs); }
      const body = document.querySelector(`[data-xv-body="${d.target}"]`);
      if (body) body.outerHTML = renderViewsBody(bState, d.target);
    },
    xviewssave: (el, d) => {
      const saveBtn = document.querySelector(d.target === 'edit' ? '[data-act="xusave"]' : 'form#xuser button[type="submit"]');
      if (!saveBtn) return;
      saveBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      saveBtn.style.outline = '3px solid #C9A24B';
      setTimeout(() => { saveBtn.style.outline = ''; }, 1500);
    },
    // إعدادات بوابة الطالب: تسري على كل حسابات الطلاب
    xstudtoggle: (el, d) =>
      run(async () => {
        await api('PUT', '/api/admin/general', { values: { [d.setting]: el.checked } });
        for (const item of [...(X.data.studentRole.views || []), ...(X.data.studentRole.allPermissions || [])]) if (item.setting === d.setting) item.enabled = el.checked;
        X.data.studentRole.permissions = X.data.studentRole.allPermissions.filter((p) => p.enabled);
        toast('حُفظ إعداد بوابة الطالب');
      }),
    xtoggleadv: async (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      bState.showAdvancedCatalog = !bState.showAdvancedCatalog;
      UA.render();
    },
    xrawperm: async (el, d) => {
      const bState = activeBuilderState(d.target === 'edit');
      if (bState.accessMode === 'role') bState.accessMode = 'hybrid';
      if (el.checked) {
        bState.customPerms.add(d.perm);
        bState.revokedPerms.delete(d.perm);
        if (d.perm === 'request:read_all') bState.customPerms.delete('request:read_unit');
        if (d.perm === 'request:read_unit') bState.customPerms.delete('request:read_all');
      } else {
        bState.customPerms.delete(d.perm);
        bState.revokedPerms.add(d.perm);
      }
      UA.render();
    },
    xuedit: (el, d) => run(async () => {
      const uid = Number(d.id);
      // تفاصيل صلاحيات الحساب لا تأتي مع القائمة
      const { user: u } = await api('GET', `/api/admin/users/${uid}/access`);
      X.edit = uid;
      X.editBuilder = builderStateShape({
        roleKey: u.roleKey || u.role,
        accessMode: u.accessMode || 'role',
        dataScope: u.dataScope || 'unit',
        scopeFaculty: u.scopeFaculty || '',
        customPerms: new Set(u.effectivePermissions || []),
        revokedPerms: new Set(u.revokedPermissions || []),
        allowedViews: new Set(u.explicitAllowedViews && u.explicitAllowedViews.length ? u.explicitAllowedViews : u.allowedViews || []),
        hiddenTabs: new Set(u.hiddenTabs || []),
        viewsSnapshot: { views: new Set(u.explicitAllowedViews && u.explicitAllowedViews.length ? u.explicitAllowedViews : u.allowedViews || []), tabs: new Set(u.hiddenTabs || []) },
        initialized: true,
      });
      UA.render();
      const panel = $id('xedit-panel');
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }),
    xucancel: async () => {
      X.edit = null;
      X.editBuilder = null;
      UA.render();
    },
    xusave: (el, d) =>
      run(async () => {
        const eb = X.editBuilder;
        const payload = {
          displayName: val('xe-name'),
          role: val('xe-role'),
          unitId: val('xe-unit') || null,
          staffKind: val('xe-kind'),
          jobTitle: val('xe-title'),
        };
        if (eb) {
          payload.accessMode = val('xe-mode') || eb.accessMode;
          payload.dataScope = val('xe-scope') || eb.dataScope;
          payload.scopeFaculty = val('xe-scope-fac');
          payload.customPermissions = [...eb.customPerms];
          payload.revokedPermissions = [...eb.revokedPerms];
          payload.allowedViews = [...eb.allowedViews];
          payload.hiddenTabs = [...(eb.hiddenTabs || [])];
        }
        await api('PUT', `/api/admin/users/${d.id}`, payload);
        X.edit = null;
        X.editBuilder = null;
        await reload();
        toast('حُفظ تعديل الحساب ومصفوفة الصلاحيات بنجاح');
      }),
    xumfa: (el, d) =>
      run(async () => {
        if (!confirm('إلغاء التحقق بخطوتين لهذا الحساب وإنهاء جلساته؟')) return;
        await api('POST', `/api/admin/users/${d.id}/mfa-reset`, {});
        toast('أُعيد ضبط التحقق بخطوتين');
      }),
    xupw: (el, d) =>
      run(async () => {
        if (!confirm('ستُنشأ كلمة مرور مؤقتة جديدة وتُنهى جلسات هذا المستخدم. متابعة؟')) return;
        X.cred = (await api('POST', `/api/admin/users/${d.id}/reset-password`, {})).credentials;
        await reload();
        window.scrollTo(0, 0);
      }),
    xuactive: (el, d) =>
      run(async () => {
        await api('POST', `/api/admin/users/${d.id}/active`, { active: d.on === '1' });
        await reload();
      }),
    xudel: (el, d) =>
      run(async () => {
        const u = X.data.users.find((x) => x.id === Number(d.id));
        if (!confirm(`حذف الحساب «${u ? u.username : ''}» نهائياً؟ إن كان مرتبطاً بسجلات فسيُرفض الحذف ويمكنك تعطيله.`)) return;
        await api('DELETE', `/api/admin/users/${d.id}`);
        await reload();
        toast('حُذف الحساب');
      }),
    xundel: (el, d) =>
      run(async () => {
        const u = X.data.units.find((x) => x.id === Number(d.id));
        if (!confirm(`حذف الوحدة «${u ? u.name : ''}» وروابطها نهائياً؟`)) return;
        await api('DELETE', `/api/admin/units/${d.id}`);
        await reload();
        toast('حُذفت الوحدة');
      }),
    xrnew: async () => {
      X.rsel = 'new';
      UA.render();
    },
    xrcancel: async () => {
      X.rsel = null;
      UA.render();
    },
    xrsel: async (el, d) => {
      X.rsel = d.k;
      UA.render();
    },
    xrolepreset: async (el, d) => {
      const preset = (X.data.rolePresets || []).find((p) => p.id === d.pid);
      if (!preset) return;
      const pSet = new Set(preset.permissions || []);
      document.querySelectorAll('#xrole input[data-perm]').forEach((chk) => {
        if (!chk.disabled) chk.checked = pSet.has(chk.dataset.perm);
      });
      const lbl = $id('xr-label');
      if (lbl && !lbl.value) lbl.value = preset.label.slice(0, 60);
      toast(`تم تحديد صلاحيات قالب: ${preset.label}`);
    },
    xractive: (el, d) =>
      run(async () => {
        await api('PUT', `/api/admin/roles/${d.k}`, { active: d.on === '1' });
        await reload();
        toast(d.on === '1' ? 'فُعّل الدور' : 'عُطّل الدور');
      }),
    xrdel: (el, d) =>
      run(async () => {
        if (!confirm('حذف هذا الدور نهائياً؟')) return;
        await api('DELETE', `/api/admin/roles/${d.k}`);
        X.rsel = null;
        await reload();
        toast('حُذف الدور');
      }),
    xupermedit: async (el, d) => {
      const u = X.data.units.find((x) => x.id === Number(d.id));
      if (!u) return;
      X.unitPermEdit = { id: u.id, perms: new Set(u.defaultPermissions || []) };
      UA.render();
    },
    xupermcancel: async () => {
      X.unitPermEdit = null;
      UA.render();
    },
    xupermchk: async (el, d) => {
      if (!X.unitPermEdit) return;
      if (el.checked) X.unitPermEdit.perms.add(d.perm);
      else X.unitPermEdit.perms.delete(d.perm);
    },
    xunitpreset: async (el, d) => {
      if (!X.unitPermEdit) return;
      const preset = (X.data.rolePresets || []).find((p) => p.id === d.pid);
      if (!preset) return;
      const m = mine();
      X.unitPermEdit.perms = new Set((preset.permissions || []).filter((p) => m.has(p)));
      UA.render();
      toast(`تم تطبيق قالب القسم: ${preset.label}`);
    },
    xupermsave: (el, d) =>
      run(async () => {
        if (!X.unitPermEdit) return;
        await api('PUT', `/api/admin/units/${d.id}`, {
          defaultPermissions: [...X.unitPermEdit.perms],
        });
        X.unitPermEdit = null;
        await reload();
        toast('تم حفظ الصلاحيات الافتراضية للقسم');
      }),
    xurename: (el, d) =>
      run(async () => {
        const cur = X.data.units.find((u) => u.id === Number(d.id));
        const name = await askText('تعديل اسم الوحدة', { label: 'الاسم الجديد للوحدة', value: cur.name });
        if (!name || name === cur.name) return;
        await api('PUT', `/api/admin/units/${d.id}`, { name });
        await reload();
      }),
    xuntoggle: (el, d) =>
      run(async () => {
        await api('PUT', `/api/admin/units/${d.id}`, { active: d.on === '1' });
        await reload();
      }),
    xunitsview: async (el, d) => {
      X.unitsView = d.v;
      UA.render();
    },
    xldel: (el, d) =>
      run(async () => {
        if (!confirm('حذف هذا الرابط؟ لن تُحال الطلبات بين الوحدتين بعدها.')) return;
        await api('DELETE', `/api/admin/links/${d.id}`);
        await reload();
      }),
  });

  Object.assign(UA.forms, {
    xuser: () =>
      run(async () => {
        ensureBuilderInit();
        const username = val('xn-name');
        const tempPassword = val('xn-pw');
        const accessMode = val('xn-mode') || X.builder.accessMode || 'role';
        const dataScope = val('xn-scope') || X.builder.dataScope || 'unit';
        const payload = {
          username,
          displayName: val('xn-disp'),
          role: val('xn-role'),
          unitId: val('xn-unit') || null,
          staffKind: val('xn-kind'),
          jobTitle: val('xn-title'),
          password: tempPassword,
          accessMode,
          dataScope,
          scopeFaculty: val('xn-scope-fac'),
          customPermissions: accessMode === 'role' ? [] : [...X.builder.customPerms],
          revokedPermissions: accessMode === 'role' ? [] : [...X.builder.revokedPerms],
          allowedViews: accessMode === 'role' ? [] : [...X.builder.allowedViews],
          hiddenTabs: accessMode === 'role' ? [] : [...(X.builder.hiddenTabs || [])],
        };
        const r = await api('POST', '/api/admin/users', payload);
        X.cred = { username, tempPassword };
        await reload();
        toast('أُنشئ الحساب وتم اعتماد مصفوفة الصلاحيات والسماحيات');
        window.scrollTo(0, 0);
        return r;
      }),
    xrole: () =>
      run(async () => {
        if (X.rsel === 'new') {
          const key = val('xr-key').trim();
          await api('POST', '/api/admin/roles', { key, label: val('xr-label'), description: val('xr-desc'), permissions: checked() });
          X.rsel = key;
          toast('أُنشئ الدور');
        } else {
          await api('PUT', `/api/admin/roles/${X.rsel}`, { label: val('xr-label'), description: val('xr-desc'), permissions: checked() });
          toast('حُفظ الدور');
        }
        await reload();
      }),
    xunit: () =>
      run(async () => {
        await api('POST', '/api/admin/units', { name: val('xun-name'), kind: val('xun-kind'), parentId: val('xun-parent') || null });
        await reload();
        toast('أُضيفت الوحدة');
      }),
    xlink: () =>
      run(async () => {
        await api('POST', '/api/admin/links', { from: Number(val('xl-from')), to: Number(val('xl-to')), twoWay: $id('xl-two').checked });
        await reload();
        toast('رُبطت الوحدتان');
      }),
  });
})();
