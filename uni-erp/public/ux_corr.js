/* الديوان والمراسلات والطلبات الداخلية (مفصول من ux_restructure.js) */
(function () {
  'use strict';
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, fmt, toast, can } = UA;
  const U = UA.uxState;

  /* ==========================================================================
     7. المنظومة الموحدة للديوان والمراسلات والطلبات والمعاملات الداخلية
     (دمج المراسلات مع الطلبات الداخلية في مساحة عمل مشتركة واحدة)
     ========================================================================== */
  const origCorrLoader = UA.loaders.corr;
  const origCorrView = UA.views.corr;
  const origInternalLoader = UA.loaders.internal;
  const origInternalView = UA.views.internal;

  UA.loaders.corr = async () => {
    await Promise.all([
      origCorrLoader ? origCorrLoader().catch(() => {}) : Promise.resolve(),
      origInternalLoader ? origInternalLoader().catch(() => {}) : Promise.resolve(),
    ]);
  };
  UA.loaders.internal = UA.loaders.corr;

  function getCleanCorrHtml() {
    if (!origCorrView) return '<section class="card"><p class="hint">الديوان والمراسلات</p></section>';
    return (origCorrView() || '')
      .replace(/<div class="sub-tabs[^"]*"[^>]*>[\s\S]*?<\/div>/, '')
      .replace(/<section class="card no-print"[^>]*background:linear-gradient\(135deg,#0f172a[\s\S]*?<\/section>/, '');
  }

  function getCleanInternalHtml() {
    if (!origInternalView) return '<section class="card"><p class="hint">بوابة الطلبات الداخلية</p></section>';
    return (origInternalView() || '')
      .replace(/<section class="card no-print"[^>]*background:linear-gradient\(135deg,#0f172a[\s\S]*?<\/section>/, '');
  }

  function renderUnifiedCorrespondenceHub() {
    if (S.corrUnifiedTab) {
      U.corrUnifiedTab = S.corrUnifiedTab;
      S.corrUnifiedTab = null;
    }
    const tab = U.corrUnifiedTab || 'in';

    // استخراج بيانات المراسلات والطلبات الداخلية من الحالة الحية
    const corrB = (window.UA && UA.corrState) || null;
    const intB = (window.UA && UA.internalState) || null;
    const allDocs = (corrB && Array.isArray(corrB.docs) ? corrB.docs : null) || (S.corrDocs || []);
    const myTurnDocs = allDocs.filter((d) => d.mine && d.mine.myTurn);
    const intList = (intB && Array.isArray(intB.list) && intB.list.length ? intB.list : null) || (S.requests || []);
    const myUnitPendingReqs = intList.filter((r) => r.status === 'review' && can('request:decide'));
    const totalPendingItems = myTurnDocs.length + myUnitPendingReqs.length;
    const svcsList = (intB && Array.isArray(intB.svcs) ? intB.svcs : null) || (S.services || []);
    const unreadNotifs = (corrB && corrB.notifs && corrB.notifs.unread) || (S.corrNotifs && S.corrNotifs.unread) || 0;

    // مزامنة التبويب الداخلي بدون أي استدعاء غير متزامن أو setTimeout داخل دالة العرض
    if (intB) {
      if (tab === 'internal_requests') {
        intB.tab = 'mine';
        intB.k = null;
      } else if (tab === 'internal_new') {
        intB.tab = 'catalog';
      }
    }
    if (corrB) {
      const crMap = { in: 'in', out: 'out', new_corr: 'new', tpl: 'tpl', notifs: 'notifs' };
      if (crMap[tab]) corrB.tab = crMap[tab];
    }

    const tabs = [
      ['in', '📥 البريد والمذكرات الواردة', allDocs.filter((d) => d.box === 'in' || !d.mine?.creator).length],
      ['out', '📤 البريد الصادر مني', allDocs.filter((d) => d.mine?.creator || corrB?.tab === 'out').length],
      ['internal_requests', '📋 سجل الطلبات والمعاملات الداخلية', intList.length],
      ['internal_new', '➕ تقديم طلب داخلي جديد (دليل الخدمات)', svcsList.length],
      ['pending_all', '⚡ بانتظار توقيعي وموافقتي', totalPendingItems],
      ...(can('corr:use') ? [['new_corr', '✍️ تحرير كتاب رسمي جديد', 0]] : []),
      ...(can('corr:templates') ? [['tpl', '📋 قوالب المراسلات الرسمية', 0]] : []),
      ['notifs', '🔔 تنبيهات الاعتماد والتوقيع', unreadNotifs],
    ];

    const topSubTabsBar = `<div class="sub-tabs no-print" role="tablist" style="margin-bottom:14px">
      ${tabs.map((t) => `
        <button type="button" class="chip" role="tab" data-act="corrunified" data-t="${t[0]}" aria-pressed="${tab === t[0]}">
          ${esc(t[1])}${t[2] ? ` <span class="badge-n">${t[2]}</span>` : ''}
        </button>
      `).join('')}
    </div>`;

    const statsHeader = `${topSubTabsBar}
      <section class="card no-print" style="margin-bottom:14px;background:linear-gradient(135deg,#054239 0%,#0f332d 100%);color:#fff;border:1px solid #115e59;padding:18px;border-radius:14px">
        <div class="spread" style="flex-wrap:wrap;gap:12px;margin-bottom:14px">
          <div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(213,182,93,.2);color:#fde047;border:1px solid rgba(213,182,93,.4);padding:2px 10px;border-radius:20px;font-size:11.5px;font-weight:700">
              <span>🏛️ المنظومة الإدارية الموحدة</span> · <span>CORRESPONDENCE & INTERNAL REQUESTS HUB</span>
            </div>
            <h1 style="margin:6px 0 2px;font-size:20px;font-weight:800;color:#fff">الديوان والمراسلات والطلبات والمعاملات الداخلية</h1>
            <p style="margin:0;opacity:.9;font-size:13px">منصة موحدة لإدارة الكتب الرسمية والمذكرات ومسارات التوقيع الإلكتروني والطلبات الإدارية والفنية للعاملين.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${can('corr:use') ? `<button type="button" class="btn sm" data-act="corrunified" data-t="new_corr" style="background:#D5B65D;color:#042f28;font-weight:800;border:none">✍️ تحرير كتاب رسمي</button>` : ''}
            <button type="button" class="btn sm" data-act="corrunified" data-t="internal_new" style="background:#fff;color:#054239;font-weight:700">➕ تقديم طلب خدمة داخلي</button>
            <button type="button" class="btn sm" data-act="view" data-v="guidelines" style="background:rgba(255,255,255,.15);color:#fff;border-color:rgba(255,255,255,.25)">📖 دليل المراسلات والـ SLA</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
          <div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 14px">
            <div style="font-size:11.5px;color:#cbd5e1">المراسلات والكتب الرسمية</div>
            <div style="font-size:20px;font-weight:800;color:#fff">${allDocs.length} <small style="font-size:11px;font-weight:400">كتاباً</small></div>
          </div>
          <div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 14px">
            <div style="font-size:11.5px;color:#cbd5e1">الطلبات والمعاملات الداخلية</div>
            <div style="font-size:20px;font-weight:800;color:#fff">${intList.length} <small style="font-size:11px;font-weight:400">طلباً</small></div>
          </div>
          <div style="background:${totalPendingItems ? 'rgba(245,158,11,.22)' : 'rgba(255,255,255,.07)'};border:1px solid ${totalPendingItems ? '#f59e0b' : 'rgba(255,255,255,.12)'};border-radius:10px;padding:10px 14px">
            <div style="font-size:11.5px;color:#fde68a;font-weight:700">بانتظار توقيعك وموافقتك الآن</div>
            <div style="font-size:20px;font-weight:800;color:#fbbf24">${totalPendingItems} <small style="font-size:11px;font-weight:400">معاملة</small></div>
          </div>
          <div style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.35);border-radius:10px;padding:10px 14px">
            <div style="font-size:11.5px;color:#bbf7d0">الصادرة والمعتمدة رسمياً</div>
            <div style="font-size:20px;font-weight:800;color:#4ade80">${allDocs.filter((d) => d.status === 'approved').length + intList.filter((r) => r.status === 'approved').length}</div>
          </div>
        </div>
      </section>`;

    // التبويب الموحد: بانتظار توقيعي وموافقتي
    if (tab === 'pending_all') {
      const docRows = myTurnDocs.map((d) => `<tr>
        <td class="mono"><b>${esc(d.no || d.code || `COR-${d.id}`)}</b></td>
        <td><b>${esc(d.title)}</b><div class="small" style="color:#64748b">من: ${esc(d.creator?.name || d.author?.name || 'زميل')} · ${fmt(d.createdAt)}</div></td>
        <td><span class="pill p-review">${esc(d.typeLabel || 'كتاب رسمي')}</span></td>
        <td><span class="pill p-review">دورك في التوقيع الآن</span></td>
        <td style="white-space:nowrap">
          <button type="button" class="btn sm pri" data-act="cropen" data-id="${d.id}">معاينة وتوقيع ✍️</button>
        </td>
      </tr>`).join('');

      const reqRows = myUnitPendingReqs.map((r) => `<tr>
        <td class="mono"><b>${esc(r.no)}</b></td>
        <td><b>${esc(r.service?.label || 'طلب خدمة')}</b><div class="small" style="color:#64748b">مقدم من: ${esc(r.student?.name || r.requester?.name || 'موظف')} · ${fmt(r.createdAt)}</div></td>
        <td>${r.unit ? esc(r.unit.name) : 'الوحدة المركزية'}</td>
        <td><span class="pill p-review">قيد المراجعة</span></td>
        <td style="white-space:nowrap">
          <button type="button" class="btn sm pri" data-act="reqopen" data-id="${r.id}">فحص واعتماد ✓</button>
        </td>
      </tr>`).join('');

      return statsHeader + `<div class="grid2">
        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
            <h2 style="margin:0">الكتب الرسمية بانتظار توقيعك (${myTurnDocs.length})</h2>
            <button type="button" class="btn sm" data-act="corrunified" data-t="in">عرض كل الوارد ←</button>
          </div>
          <div class="tbl-wrap"><table><thead><tr><th>الرمز</th><th>الموضوع</th><th>النوع</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
            ${docRows || '<tr><td colspan="5" class="empty">لا توجد كتب رسمية بانتظار توقيعك حالياً.</td></tr>'}
          </tbody></table></div>
        </section>

        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
            <h2 style="margin:0">الطلبات الداخلية المحالة لوحدتك للبت (${myUnitPendingReqs.length})</h2>
            <button type="button" class="btn sm" data-act="corrunified" data-t="internal_requests">عرض كل الطلبات ←</button>
          </div>
          <div class="tbl-wrap"><table><thead><tr><th>رقم الطلب</th><th>الخدمة</th><th>الجهة</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
            ${reqRows || '<tr><td colspan="5" class="empty">لا توجد طلبات داخلية تنتظر موافقة وحدتك حالياً.</td></tr>'}
          </tbody></table></div>
        </section>
      </div>`;
    }

    // عرض الطلبات والمعاملات الداخلية
    if (tab === 'internal_requests' || tab === 'internal_new') {
      return statsHeader + getCleanInternalHtml();
    }

    // عرض المراسلات والكتب الرسمية
    return statsHeader + getCleanCorrHtml();
  }

  UA.views.corr = renderUnifiedCorrespondenceHub;
  UA.views.internal = renderUnifiedCorrespondenceHub;

})();
