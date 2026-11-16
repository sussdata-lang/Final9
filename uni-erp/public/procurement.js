/* وحدة المشتريات والمخازن والأصول (5.10) — نسخة مؤسسية معاد هيكلتها بالكامل */
(function () {
  const UA = window.UA;
  if (!UA) return;
  const { api, esc, fmt, toast, S } = UA;
  const money = (n) => Number(n || 0).toLocaleString('en-US') + ' ل.س';
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const P = (S.proc = {
    tab: 'overview',
    cycleMode: 'requests', // requests | orders
    moveMode: 'receipts',  // receipts | issues
    reqStatusFilter: '',
    ordStatusFilter: '',
    itemFilter: { q: '', warehouse: '', category: '', low: '' },
    assetFilter: { q: '', status: '', warehouse: '' },
    supQuery: '',
    ov: null,
    warehouses: [],
    categories: [],
    items: [],
    suppliers: [],
    requests: [],
    orders: [],
    receipts: [],
    issues: [],
    assets: []
  });

  const can = (p) => S.me?.permissions?.includes(p) || S.me?.role === 'admin';
  const REQ_STATUS = {
    draft: ['مسودة', 'b-mut'],
    pending: ['بانتظار الاعتماد', 'b-warn'],
    approved: ['معتمد للشراء', 'b-ok'],
    rejected: ['مرفوض', 'b-err'],
    ordered: ['صدر أمر توريد', 'b-info'],
    cancelled: ['ملغى', 'b-mut']
  };
  const ORD_STATUS = {
    draft: ['مسودة أمر', 'b-mut'],
    ordered: ['مرسل للمورد', 'b-warn'],
    received: ['تم الاستلام المخزني', 'b-ok'],
    cancelled: ['ملغى', 'b-err']
  };
  const ASSET_STATUS = {
    available: ['متاح بالمستودع', 'b-ok'],
    in_use: ['في العهدة / قيد الاستخدام', 'b-info'],
    maintenance: ['تحت الصيانة', 'b-warn'],
    disposed: ['مُتلف / مستبعد', 'b-err']
  };
  const stBadge = (map, s) => {
    const [l, c] = map[s] || [s, 'b-mut'];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };
  // جداول «الحقل: القيمة» لنماذج الجامعة في العرض والطباعة: زوجان في كل صف
  const kv4 = (pairs) => {
    const list = pairs.filter(Boolean); let h = '';
    for (let i = 0; i < list.length; i += 2) {
      const [a, b] = [list[i], list[i + 1]];
      h += `<tr><th>${esc(a[0])}</th><td${b ? '' : ' colspan="3"'}>${esc(a[1] === undefined || a[1] === null || a[1] === '' ? '—' : String(a[1]))}</td>${b ? `<th>${esc(b[0])}</th><td>${esc(b[1] === undefined || b[1] === null || b[1] === '' ? '—' : String(b[1]))}</td>` : ''}</tr>`;
    }
    return `<table class="tbl a4-kv a4-kv2"><tbody>${h}</tbody></table>`;
  };
  const QUALITY = ['مطابق', 'مطابق جزئيًا', 'غير مطابق'];
  const CONDITION = ['جديدة', 'مستعملة', 'تالفة'];
  const THRESHOLDS = ['شراء مباشر', 'استدراج عروض أسعار', 'مناقصة'];

  const TABS = [
    ['overview', '📊 لوحة الإمداد والمخازن'],
    ['stock', '🏭 المستودعات والأصناف والجرد'],
    ['cycle', '🛒 دورة الشراء وأوامر التوريد'],
    ['movements', '📦 الحركة المخزنية (إدخال/صرف)'],
    ['assets', '🏷️ سجل الأصول الثابتة والعهد'],
    ['suppliers', '🤝 الموردون المعتمدون'],
    ['quotes', '💲 عروض الأسعار وتقييم المورّدين']
  ];

  async function loadTab() {
    if (UA.procTab) { P.tab = UA.procTab; UA.procTab = null; }   // دخول من go('quotations')
    if (!can('procurement:read') && P.tab !== 'cycle') P.tab = 'cycle';   // مقدّم الطلب: طلباته فقط
    const t = P.tab;
    if (t === 'quotes') {
      // شاشة عروض الأسعار (operations.js) صارت تبويباً هنا؛ إجراءاتها تعيد تحميل UA.loaders.quotations ثم UA.render
      if (UA.loaders.quotations) await UA.loaders.quotations();
    } else if (t === 'overview') {
      P.ov = await api('GET', '/api/procurement/overview');
    } else if (t === 'stock') {
      const qs = new URLSearchParams();
      if (P.itemFilter.q) qs.set('q', P.itemFilter.q);
      if (P.itemFilter.warehouse) qs.set('warehouse', P.itemFilter.warehouse);
      if (P.itemFilter.category) qs.set('category', P.itemFilter.category);
      if (P.itemFilter.low) qs.set('low', '1');
      const [w, c, it] = await Promise.all([
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/categories'),
        api('GET', '/api/procurement/items?' + qs.toString())
      ]);
      P.warehouses = w.warehouses;
      P.categories = c.categories;
      P.items = it.items;
    } else if (t === 'cycle' && !can('procurement:read')) {
      const [rq, w, it] = await Promise.all([
        api('GET', '/api/procurement/requests' + (P.reqStatusFilter ? `?status=${P.reqStatusFilter}` : '')),
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/items')
      ]);
      P.requests = rq.requests; P.orders = []; P.suppliers = []; P.warehouses = w.warehouses; P.items = it.items;
    } else if (t === 'cycle') {
      const [rq, or, w, it, s] = await Promise.all([
        api('GET', '/api/procurement/requests' + (P.reqStatusFilter ? `?status=${P.reqStatusFilter}` : '')),
        api('GET', '/api/procurement/orders' + (P.ordStatusFilter ? `?status=${P.ordStatusFilter}` : '')),
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/items'),
        api('GET', '/api/procurement/suppliers')
      ]);
      P.requests = rq.requests;
      P.orders = or.orders;
      P.warehouses = w.warehouses;
      P.items = it.items;
      P.suppliers = s.suppliers;
    } else if (t === 'movements') {
      const [rc, is, or, w, it] = await Promise.all([
        api('GET', '/api/procurement/receipts'),
        api('GET', '/api/procurement/issues'),
        api('GET', '/api/procurement/orders?status=ordered'),
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/items')
      ]);
      P.receipts = rc.receipts;
      P.issues = is.issues;
      P.orders = or.orders;
      P.warehouses = w.warehouses;
      P.items = it.items;
    } else if (t === 'assets') {
      const qs = new URLSearchParams();
      if (P.assetFilter.q) qs.set('q', P.assetFilter.q);
      if (P.assetFilter.status) qs.set('status', P.assetFilter.status);
      if (P.assetFilter.warehouse) qs.set('warehouse', P.assetFilter.warehouse);
      const [a, w, s] = await Promise.all([
        api('GET', '/api/procurement/assets?' + qs.toString()),
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/suppliers')
      ]);
      P.assets = a.assets;
      P.warehouses = w.warehouses;
      P.suppliers = s.suppliers;
    } else if (t === 'suppliers') {
      const [s, or] = await Promise.all([
        api('GET', '/api/procurement/suppliers' + (P.supQuery ? `?q=${encodeURIComponent(P.supQuery)}` : '')),
        api('GET', '/api/procurement/orders')
      ]);
      P.suppliers = s.suppliers;
      P.orders = or.orders;
    }
  }

  function renderPipelineBanner(o) {
    if (!o) return '';
    const steps = [
      { n: '1', title: 'طلب شراء (PRQ)', sub: `${num(o.pendingRequests)} قيد المراجعة`, tone: '#0A5A4D', tab: 'cycle', mode: 'requests' },
      { n: '2', title: 'الاعتماد الإداري', sub: `${num(o.approvedRequests)} معتمد للتوريد`, tone: '#0d9488', tab: 'cycle', mode: 'requests' },
      { n: '3', title: 'أمر توريد (PO)', sub: `${num(o.pendingOrders)} مرسل للموردين`, tone: '#8A6A1B', tab: 'cycle', mode: 'orders' },
      { n: '4', title: 'الفحص والاستلام', sub: `${num(o.totalReceipts || o.receivedOrders || 0)} مذكرة إدخال`, tone: '#1B7F4B', tab: 'movements', mode: 'receipts' },
      { n: '5', title: 'الصرف والعهدة', sub: `${num(o.totalIssues || 0)} إذن صرف · ${num(o.totalAssets)} أصل`, tone: '#0A5A4D', tab: 'movements', mode: 'issues' }
    ];
    return `
      <div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#10211D 0%,#10211D 100%);color:#fff;border:1px solid #10211D;padding:16px">
        <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:11px;color:#0A5A4D;font-weight:700;letter-spacing:.4px">منظومة الإمداد المتكاملة · SUPPLY CHAIN & INVENTORY PIPELINE</div>
            <div style="font-size:15px;font-weight:800;margin-top:2px">مسار الرقابة على المشتريات والمخازن والأصول الجامعية</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('procurement:request') ? `<button class="btn pri sm" data-act="proc-new-req">+ طلب شراء جديد</button>` : ''}
            ${can('procurement:manage') ? `<button class="btn sm" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)" data-act="proc-new-order">+ أمر توريد (PO)</button>` : ''}
            ${can('procurement:stock') ? `<button class="btn sm" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)" data-act="proc-new-issue">+ إذن صرف مخزني</button>` : ''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px">
          ${steps.map((s) => `
            <div data-act="proc-pipe-go" data-t="${s.tab}" data-mode="${s.mode}" style="cursor:pointer;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-inline-start:4px solid ${s.tone};border-radius:8px;padding:10px 12px;transition:background .15s">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:11px;color:#8B9591;font-weight:700">المرحلة ${s.n}</span>
                <span style="font-size:11px;color:#0A5A4D">انتقال ←</span>
              </div>
              <div style="font-weight:800;font-size:13px;margin:3px 0">${esc(s.title)}</div>
              <div style="font-size:12px;color:#DCE3DD">${esc(s.sub)}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function viewOverview() {
    const o = P.ov || {};
    const lowList = o.lowStockItems || [];
    const whSum = o.warehouseSummary || [];
    const assetBrk = o.assetBreakdown || [];
    return `
      ${renderPipelineBanner(o)}
      ${lowList.length ? `
        <div class="card" style="margin-bottom:14px;background:#F6F8F5;border:1px solid #C9A24B;border-inline-start:5px solid #8A6A1B;padding:12px 16px">
          <div class="spread" style="flex-wrap:wrap;gap:8px">
            <div>
              <strong style="color:#8A6A1B;font-size:14px">⚠️ تنبيه الحد الأدنى للمخزون (${num(lowList.length)} أصناف بحاجة لإعادة طلب)</strong>
              <div class="mut" style="font-size:12px;color:#8A6A1B;margin-top:2px">الأصناف التالية وصلت أو انخفضت عن نقطة إعادة الطلب المحددة في بطاقة الصنف:</div>
            </div>
            <div style="display:flex;gap:6px">
              ${can('procurement:request') ? `<button class="btn pri sm" data-act="proc-replenish-low">⚡ توليد طلب شراء للنواقص تلقائياً</button>` : ''}
              <button class="btn sm" data-act="proc-go-low">عرض الأصناف الحرجة</button>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
            ${lowList.slice(0, 8).map((x) => `
              <span style="background:#FBEBD0;border:1px solid #C9A24B;color:#8A6A1B;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600">
                <code>${esc(x.code)}</code> ${esc(x.name)} — المتاح: <b>${num(x.qtyOnHand)}</b> / الحد الأدنى: <b>${num(x.minStock)}</b> ${esc(x.unit || '')}
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="kpis" style="margin-bottom:14px">
        <div class="kpi"><div class="k-num">${num(o.warehouses)}</div><div class="k-lbl">المستودعات النشطة</div></div>
        <div class="kpi"><div class="k-num">${num(o.items)}</div><div class="k-lbl">الأصناف المخزنية المعرّفة</div></div>
        <div class="kpi" style="${o.lowStock > 0 ? 'border-color:#C9A24B;background:#F6F8F5' : ''}"><div class="k-num" style="color:${o.lowStock > 0 ? '#8A6A1B' : 'inherit'}">${num(o.lowStock)}</div><div class="k-lbl">أصناف دون الحد الأدنى</div></div>
        <div class="kpi"><div class="k-num" style="color:#0A5A4D">${money(o.totalStockValue)}</div><div class="k-lbl">القيمة الدفترية للمخزون</div></div>
        <div class="kpi"><div class="k-num" style="color:#8A6A1B">${num(o.pendingRequests)}</div><div class="k-lbl">طلبات شراء قيد الاعتماد</div></div>
        <div class="kpi"><div class="k-num" style="color:#0d9488">${num(o.pendingOrders)}</div><div class="k-lbl">أوامر توريد قيد الاستلام</div></div>
        <div class="kpi"><div class="k-num">${num(o.totalAssets)}</div><div class="k-lbl">الأصول الثابتة العاملة</div></div>
        <div class="kpi"><div class="k-num" style="color:#0A5A4D">${money(o.assetsValue)}</div><div class="k-lbl">إجمالي قيمة الأصول الثابتة</div></div>
      </div>

      <div class="grid2" style="margin-bottom:14px">
        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">🏭 توزيع المخزون والأصول حسب المستودعات</h3>
            <button class="btn sm" data-act="proc-tab" data-t="stock">إدارة المستودعات</button>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>المستودع</th><th>الأصناف</th><th>قيمة المخزون</th><th>الأصول</th><th>الحالة</th></tr></thead><tbody>
            ${whSum.map((w) => `<tr>
              <td><code>${esc(w.code)}</code></td>
              <td><b>${esc(w.name)}</b><div class="mut" style="font-size:11px">${esc(w.location || '—')}</div></td>
              <td>${num(w.itemCount)}</td>
              <td><b>${money(w.stockValue)}</b></td>
              <td>${num(w.assetCount)}</td>
              <td><span class="badge ${w.active ? 'b-ok' : 'b-mut'}">${w.active ? 'نشط' : 'معطّل'}</span></td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد مستودعات</td></tr>'}
          </tbody></table></div>
        </div>

        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">🏷️ ملخص حالات الأصول الثابتة والعهد</h3>
            <button class="btn sm" data-act="proc-tab" data-t="assets">سجل الأصول</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:10px">
            ${['available', 'in_use', 'maintenance', 'disposed'].map((stKey) => {
              const row = assetBrk.find((a) => a.status === stKey) || { count: 0, totalCost: 0 };
              const [label, cls] = ASSET_STATUS[stKey] || [stKey, 'b-mut'];
              return `<div style="border:1px solid var(--bd);border-radius:8px;padding:10px 12px;background:#F6F8F5">
                <div class="spread"><span class="badge ${cls}">${esc(label)}</span><b style="font-size:16px">${num(row.count)}</b></div>
                <div class="mut" style="font-size:12px;margin-top:6px">التكلفة: <b>${money(row.totalCost)}</b></div>
              </div>`;
            }).join('')}
          </div>
          <div class="mut" style="font-size:12px">تُتابَع حركات نقل العهدة والصيانة والإتلاف بسجل تدقيق غير قابل للمسح.</div>
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">📝 أحدث طلبات الشراء (PRQ)</h3>
            <button class="btn sm" data-act="proc-pipe-go" data-t="cycle" data-mode="requests">عرض الكل</button>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرقم</th><th>البيان</th><th>مقدم الطلب</th><th>الحالة</th></tr></thead><tbody>
            ${(o.recentRequests || []).map((r) => `<tr>
              <td><code>${esc(r.no)}</code></td>
              <td>${esc(r.title)}</td>
              <td>${esc(r.requester || '—')}</td>
              <td>${stBadge(REQ_STATUS, r.status)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">لا توجد طلبات شراء</td></tr>'}
          </tbody></table></div>
        </div>

        <div class="card">
          <div class="spread" style="margin-bottom:10px">
            <h3 style="margin:0">🚚 أحدث أوامر التوريد (PO) والحركة المخزنية</h3>
            <button class="btn sm" data-act="proc-pipe-go" data-t="cycle" data-mode="orders">عرض الكل</button>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم الأمر</th><th>المورد</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>
            ${(o.recentOrders || []).map((r) => `<tr>
              <td><code>${esc(r.no)}</code></td>
              <td>${esc(r.supplierName)}</td>
              <td>${money(r.totalAmount)}</td>
              <td>${stBadge(ORD_STATUS, r.status)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">لا توجد أوامر توريد</td></tr>'}
          </tbody></table></div>
        </div>
      </div>`;
  }

  function viewStock() {
    const totalVal = P.items.reduce((s, i) => s + Number(i.qtyOnHand || 0) * Number(i.avgCost || 0), 0);
    const lowCount = P.items.filter((i) => i.low).length;
    return `
      <div class="card" style="margin-bottom:14px">
        <div class="spread" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">🏭 المستودعات المعتمدة (${num(P.warehouses.length)})</h3>
            <div class="mut" style="font-size:12px">اضغط على أي مستودع لتصفية الأصناف التابعة له مباشرة</div>
          </div>
          ${can('procurement:manage') ? `<button class="btn pri sm" data-act="proc-new-wh">+ إضافة مستودع جديد</button>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">
          <div data-act="proc-wh-filter" data-id="" style="cursor:pointer;border:2px solid ${!P.itemFilter.warehouse ? '#0A5A4D' : 'var(--bd)'};background:${!P.itemFilter.warehouse ? '#F6F8F5' : '#fff'};border-radius:8px;padding:10px 12px">
            <div class="spread"><b>كل المستودعات</b><span class="badge b-info">${num(P.warehouses.length)}</span></div>
            <div class="mut" style="font-size:12px;margin-top:4px">عرض شامل لكافة الأصناف والأرصدة</div>
          </div>
          ${P.warehouses.map((w) => {
            const sel = String(P.itemFilter.warehouse) === String(w.id);
            return `<div style="border:2px solid ${sel ? '#0A5A4D' : 'var(--bd)'};background:${sel ? '#F6F8F5' : '#fff'};border-radius:8px;padding:10px 12px">
              <div class="spread" style="cursor:pointer" data-act="proc-wh-filter" data-id="${w.id}">
                <div><code>${esc(w.code)}</code> <b>${esc(w.name)}</b></div>
                <span class="badge ${w.active ? 'b-ok' : 'b-mut'}">${w.active ? 'نشط' : 'معطّل'}</span>
              </div>
              <div class="mut" style="font-size:12px;margin-top:4px">الموقع: ${esc(w.location || '—')} · الأمين: ${esc(w.managerName || '—')}</div>
              ${can('procurement:manage') ? `<div style="display:flex;gap:4px;margin-top:8px">
                <button class="btn sm" data-act="proc-edit-wh" data-id="${w.id}">تعديل</button>
                <button class="btn sm" data-act="proc-toggle-wh" data-id="${w.id}" data-on="${w.active ? 0 : 1}">${w.active ? 'تعطيل' : 'تفعيل'}</button>
              </div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">📋 دليل الأصناف المخزنية وبطاقات الجرد (${num(P.items.length)} صنف)</h3>
            <div class="mut" style="font-size:12px">إجمالي القيمة الدفترية للمعروض: <b>${money(totalVal)}</b> · أصناف دون الحد الأدنى: <b style="color:${lowCount ? '#8A6A1B' : 'inherit'}">${num(lowCount)}</b></div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <a class="btn sm" href="/api/procurement/items.xlsx" target="_blank">📥 تصدير الجرد Excel</a>
            ${can('procurement:manage') ? `<button class="btn pri sm" data-act="proc-new-item">+ تعريف صنف جديد</button>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto auto;gap:8px;margin-bottom:12px;align-items:end" class="filter-bar">
          <div><label style="font-size:11px">بحث بالرمز أو الاسم</label><input id="pi-filter-q" value="${esc(P.itemFilter.q)}" placeholder="ابحث عن صنف أو رمز..."></div>
          <div><label style="font-size:11px">التصنيف</label><select id="pi-filter-cat"><option value="">— كل التصنيفات —</option>${P.categories.map((c) => `<option value="${c.id}" ${String(P.itemFilter.category) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div><label style="font-size:11px">حالة الرصيد</label><select id="pi-filter-low"><option value="">كل الأرصدة</option><option value="1" ${P.itemFilter.low === '1' ? 'selected' : ''}>⚠️ دون الحد الأدنى فقط</option></select></div>
          <button class="btn pri sm" data-act="proc-filter-items">تطبيق التصفية</button>
          <button class="btn sm" data-act="proc-reset-items">إعادة ضبط</button>
        </div>

        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>اسم الصنف</th><th>التصنيف</th><th>المستودع</th><th>الوحدة</th><th>الرصيد الفعلي</th><th>الحد الأدنى</th><th>متوسط التكلفة</th><th>القيمة الإجمالية</th><th>الحالة</th><th>إجراءات الجرد</th></tr></thead><tbody>
          ${P.items.map((x) => {
            const lineVal = Number(x.qtyOnHand || 0) * Number(x.avgCost || 0);
            return `<tr style="${x.low ? 'background:#F6F8F5' : ''}">
              <td><code>${esc(x.code)}</code></td>
              <td><b>${esc(x.name)}</b>${x.notes ? `<div class="mut" style="font-size:11px">${esc(x.notes)}</div>` : ''}</td>
              <td>${esc(x.categoryName || '—')}</td>
              <td>${esc(x.warehouseName || '—')}</td>
              <td>${esc(x.unit)}</td>
              <td><b style="font-size:14px;color:${x.low ? '#8A6A1B' : '#10211D'}">${num(x.qtyOnHand)}</b></td>
              <td>${num(x.minStock)}</td>
              <td>${money(x.avgCost)}</td>
              <td><b>${money(lineVal)}</b></td>
              <td>${x.low ? '<span class="badge b-warn">⚠️ نقص مخزون</span>' : '<span class="badge b-ok">متوفر</span>'}</td>
              <td style="white-space:nowrap">
                ${can('procurement:stock') ? `<button class="btn sm" data-act="proc-adjust-item" data-id="${x.id}" title="تسوية جرد فعلي">⚖️ جرد</button>` : ''}
                ${can('procurement:manage') ? `<button class="btn sm" data-act="proc-edit-item" data-id="${x.id}">تعديل</button>` : ''}
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="11" class="empty">لا توجد أصناف مطابقة للبحث</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  function viewCycle() {
    const isReq = P.cycleMode !== 'orders';
    return `
      <div class="card" style="margin-bottom:14px;padding:12px 16px">
        <div class="spread" style="flex-wrap:wrap;gap:10px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn ${isReq ? 'pri' : ''}" data-act="proc-cycle-mode" data-mode="requests">📝 طلبات الشراء الداخلية (${num(P.requests.length)})</button>
            ${can('procurement:read') ? `<button class="btn ${!isReq ? 'pri' : ''}" data-act="proc-cycle-mode" data-mode="orders">🚚 أوامر التوريد للموردين PO (${num(P.orders.length)})</button>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('procurement:request') ? `<button class="btn pri sm" data-act="proc-new-req">+ طلب شراء جديد (PRQ)</button>` : ''}
            ${can('procurement:manage') ? `<button class="btn sm" data-act="proc-new-order">+ إصدار أمر توريد (PO)</button>` : ''}
          </div>
        </div>
      </div>

      ${isReq ? `
        <div class="card">
          <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <h3 style="margin:0">📝 سجل طلبات الشراء والاحتياجات (${num(P.requests.length)})</h3>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              ${[['', 'الكل'], ['pending', 'بانتظار الاعتماد'], ['approved', 'معتمد للشراء'], ['ordered', 'صدر أمر توريد'], ['draft', 'مسودة'], ['rejected', 'مرفوض']].map(([k, lbl]) => `
                <button class="btn sm ${P.reqStatusFilter === k ? 'pri' : ''}" data-act="proc-req-filter" data-st="${k}">${esc(lbl)}</button>
              `).join('')}
            </div>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم الطلب</th><th>عنوان الاحتياج</th><th>مقدم الطلب</th><th>عدد البنود</th><th>التكلفة التقديرية</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
            ${P.requests.map((r) => {
              const estTotal = (r.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.estCost || 0), 0);
              return `<tr>
                <td><code>${esc(r.no)}</code></td>
                <td><b>${esc(r.title)}</b>${r.description ? `<div class="mut" style="font-size:11px">${esc(r.description)}</div>` : ''}</td>
                <td>${esc(r.requesterName || '—')}</td>
                <td>${num((r.lines || []).length)} بنود</td>
                <td><b>${money(estTotal)}</b></td>
                <td>${stBadge(REQ_STATUS, r.status)}${r.stage ? `<div class="small">بانتظار: ${esc(r.stage)}</div>` : ''}</td>
                <td style="white-space:nowrap">
                  <button class="btn sm" data-act="proc-view-req" data-id="${r.id}">التفاصيل</button>
                  ${r.status === 'draft' && can('procurement:request') && (r.requester_id === UA.S.me.id || can('procurement:manage')) ? `<button class="btn pri sm" data-act="proc-sub-req" data-id="${r.id}">إرسال للاعتماد</button>` : ''}
                  ${r.status === 'pending' && (can('procurement:manage') || can('procurement:approve_finance') || can('procurement:approve_top')) ? `<button class="btn pri sm" data-act="proc-app-req" data-id="${r.id}">✓ اعتماد</button> <button class="btn dan sm" data-act="proc-rej-req" data-id="${r.id}">✕ رفض</button>` : ''}
                  ${r.status === 'approved' && can('procurement:manage') ? `<button class="btn pri sm" data-act="proc-req-to-po" data-id="${r.id}">🚚 تحويل لأمر توريد</button>` : ''}
                </td>
              </tr>`;
            }).join('') || '<tr><td colspan="7" class="empty">لا توجد طلبات شراء</td></tr>'}
          </tbody></table></div>
        </div>
      ` : `
        <div class="card">
          <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <h3 style="margin:0">🚚 أوامر التوريد والشراء الصادرة للموردين (${num(P.orders.length)})</h3>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              ${[['', 'الكل'], ['draft', 'مسودة'], ['ordered', 'مرسل للمورد'], ['received', 'تم الاستلام']].map(([k, lbl]) => `
                <button class="btn sm ${P.ordStatusFilter === k ? 'pri' : ''}" data-act="proc-ord-filter" data-st="${k}">${esc(lbl)}</button>
              `).join('')}
            </div>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم الأمر</th><th>طلب الشراء المرتبط</th><th>المورد المعتمد</th><th>إجمالي الأمر</th><th>الحالة</th><th>تاريخ الإصدار</th><th>إجراءات</th></tr></thead><tbody>
            ${P.orders.map((o) => `<tr>
              <td><code>${esc(o.no)}</code></td>
              <td><code>${esc(o.requestNo || 'مباشر')}</code></td>
              <td><b>${esc(o.supplierName)}</b></td>
              <td><b>${money(o.totalAmount)}</b></td>
              <td>${stBadge(ORD_STATUS, o.status)}</td>
              <td>${fmt(o.createdAt)}</td>
              <td style="white-space:nowrap">
                <button class="btn sm" data-act="proc-view-ord" data-id="${o.id}">عرض / طباعة</button>
                ${o.status === 'draft' && can('procurement:manage') ? `<button class="btn pri sm" data-act="proc-send-ord" data-id="${o.id}">اعتماد وإرسال للمورد</button>` : ''}
                ${o.status === 'ordered' && can('procurement:stock') ? `<button class="btn pri sm" data-act="proc-rcv-from-ord" data-id="${o.id}">📥 استلام مخزني</button>` : ''}
                ${['draft', 'ordered'].includes(o.status) && can('procurement:manage') ? `<button class="btn dan sm" data-act="proc-can-ord" data-id="${o.id}">إلغاء</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">لا توجد أوامر توريد</td></tr>'}
          </tbody></table></div>
        </div>
      `}`;
  }

  function viewMovements() {
    const isRcv = P.moveMode !== 'issues';
    return `
      <div class="card" style="margin-bottom:14px;padding:12px 16px">
        <div class="spread" style="flex-wrap:wrap;gap:10px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn ${isRcv ? 'pri' : ''}" data-act="proc-move-mode" data-mode="receipts">📥 مذكرات الإدخال والاستلام المخزني (${num(P.receipts.length)})</button>
            <button class="btn ${!isRcv ? 'pri' : ''}" data-act="proc-move-mode" data-mode="issues">📤 أذونات الصرف والإخراج المخزني (${num(P.issues.length)})</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('procurement:stock') ? `
              <button class="btn pri sm" data-act="proc-new-receipt">+ تسجيل مذكرة استلام توريد</button>
              <button class="btn sm" data-act="proc-new-issue">+ تحرير إذن صرف مخزني</button>
            ` : ''}
          </div>
        </div>
      </div>

      ${isRcv ? `
        <div class="card">
          <h3 style="margin-top:0">📥 سجل مذكرات الاستلام والفحص المخزني (${num(P.receipts.length)})</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم المذكرة</th><th>أمر التوريد (PO)</th><th>المورد</th><th>الأصناف المستلمة</th><th>التاريخ</th><th>ملاحظات الفحص</th><th>طباعة</th></tr></thead><tbody>
            ${P.receipts.map((r) => `<tr>
              <td><code>RCV-${String(r.id).padStart(4, '0')}</code>${r.reversedAt ? ` <span class="pill p-rejected" title="${esc(fmt(r.reversedAt))}">معكوسة</span>` : ''}</td>
              <td><code>${esc(r.orderNo)}</code></td>
              <td><b>${esc(r.supplierName)}</b></td>
              <td>${(r.lines || []).map((l) => `<span class="badge b-ok" style="margin-inline-end:4px">${esc(l.itemName)}: ${num(l.qty)} × ${money(l.unitCost)}</span>`).join(' ')}</td>
              <td>${fmt(r.receivedAt)}</td>
              <td>${esc(r.note || '—')}</td>
              <td><button class="btn sm" data-act="proc-view-rcv" data-id="${r.id}">عرض / طباعة</button></td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">لا توجد مذكرات استلام مسجلة</td></tr>'}
          </tbody></table></div>
        </div>
      ` : `
        <div class="card">
          <h3 style="margin-top:0">📤 سجل أذونات الصرف المخزني للجهات والأقسام (${num(P.issues.length)})</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم إذن الصرف</th><th>المستودع المصدِّر</th><th>الجهة / الموظف المستلم</th><th>الغرض والبيان</th><th>الأصناف المصروفة</th><th>التاريخ</th><th>طباعة</th></tr></thead><tbody>
            ${P.issues.map((i) => `<tr>
              <td><code>${esc(i.no)}</code>${i.reversedAt ? ` <span class="pill p-rejected" title="${esc(fmt(i.reversedAt))}">معكوس</span>` : ''}</td>
              <td>${esc(i.warehouseName)}</td>
              <td><b>${esc(i.issuedTo)}</b></td>
              <td>${esc(i.purpose || '—')}</td>
              <td>${(i.lines || []).map((l) => `<span class="badge b-info" style="margin-inline-end:4px">${esc(l.itemName)} (${num(l.qty)})</span>`).join(' ')}</td>
              <td>${fmt(i.issuedAt)}</td>
              <td><button class="btn sm" data-act="proc-view-iss" data-id="${i.id}">عرض / طباعة</button></td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">لا توجد أذونات صرف مخزني</td></tr>'}
          </tbody></table></div>
        </div>
      `}`;
  }

  function viewAssets() {
    const totalCost = P.assets.reduce((s, a) => s + Number(a.cost || 0), 0);
    return `
      <div class="card">
        <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">🏷️ سجل الأصول الثابتة والعهد الشخصية (${num(P.assets.length)} أصل)</h3>
            <div class="mut" style="font-size:12px">إجمالي القيمة الرأسمالية للأصول المعروضة: <b>${money(totalCost)}</b></div>
          </div>
          ${can('procurement:assets') ? `<button class="btn pri sm" data-act="proc-new-asset">+ تسجيل أصل ثابت جديد</button>` : ''}
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto auto;gap:8px;margin-bottom:12px;align-items:end">
          <div><label style="font-size:11px">بحث بالرمز أو اسم الأصل أو صاحب العهدة</label><input id="pa-filter-q" value="${esc(P.assetFilter.q)}" placeholder="ابحث عن جهاز، أثاث، رمز أصل..."></div>
          <div><label style="font-size:11px">حالة الأصل</label><select id="pa-filter-st"><option value="">— كل الحالات —</option>${Object.entries(ASSET_STATUS).map(([k, [l]]) => `<option value="${k}" ${P.assetFilter.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div><label style="font-size:11px">المستودع / الموقع</label><select id="pa-filter-wh"><option value="">— كل المواقع —</option>${P.warehouses.map((w) => `<option value="${w.id}" ${String(P.assetFilter.warehouse) === String(w.id) ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
          <button class="btn pri sm" data-act="proc-filter-assets">تصفية</button>
          <button class="btn sm" data-act="proc-reset-assets">إعادة ضبط</button>
        </div>

        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رمز الأصل</th><th>اسم الأصل والوصف</th><th>الفئة</th><th>المستودع / الموقع</th><th>العهدة المسندة إلى</th><th>تاريخ الشراء</th><th>التكلفة الرأسمالية</th><th>الحالة</th><th>إجراءات العهدة</th></tr></thead><tbody>
          ${P.assets.map((a) => `<tr>
            <td><code>${esc(a.code)}</code></td>
            <td><b>${esc(a.name)}</b>${a.notes ? `<div class="mut" style="font-size:11px">${esc(a.notes)}</div>` : ''}</td>
            <td>${esc(a.category)}</td>
            <td>${esc(a.warehouseName || '—')}</td>
            <td><b>${esc(a.assignedTo || 'غير مسند')}</b></td>
            <td>${esc(a.purchaseDay || '—')}</td>
            <td><b>${money(a.cost)}</b></td>
            <td>${stBadge(ASSET_STATUS, a.status)}</td>
            <td style="white-space:nowrap">
              ${UA.rowPrintBtn('سند عهدة أصل ثابت', 'المشتريات والمخازن', 'أمين المستودع|مستلم العهدة|مدير الشؤون الإدارية')}
              ${can('procurement:assets') ? `
                <button class="btn sm" data-act="proc-move-asset" data-id="${a.id}">🔄 نقل عهدة / حالة</button>
                <button class="btn sm" data-act="proc-edit-asset" data-id="${a.id}">تعديل</button>
                ${a.status !== 'in_use' ? `<button class="btn dan sm" data-act="proc-del-asset" data-id="${a.id}">حذف</button>` : ''}
              ` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="9" class="empty">لا توجد أصول ثابتة مطابقة</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  function viewSuppliers() {
    return `
      <div class="card">
        <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">🤝 دليل الموردين والمتعهدين المعتمدين (${num(P.suppliers.length)})</h3>
            <div class="mut" style="font-size:12px">سجل الشركات والموردين المؤهلين للتعامل مع الجامعة وأحجام التوريد</div>
          </div>
          <div style="display:flex;gap:6px">
            <input id="ps-filter-q" value="${esc(P.supQuery)}" placeholder="بحث باسم المورد أو الرمز..." style="width:220px">
            <button class="btn sm" data-act="proc-filter-sup">بحث</button>
            ${can('procurement:manage') ? `<button class="btn pri sm" data-act="proc-new-sup">+ تسجيل مورد جديد</button>` : ''}
          </div>
        </div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>اسم المورد / الشركة</th><th>الرقم الضريبي</th><th>الهاتف والبريد</th><th>العنوان</th><th>أوامر التوريد</th><th>إجمالي التعاملات</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
          ${P.suppliers.map((s) => {
            const supOrders = (P.orders || []).filter((o) => o.supplierId === s.id && o.status !== 'cancelled');
            const supVol = supOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
            return `<tr>
              <td><code>${esc(s.code)}</code></td>
              <td><b>${esc(s.name)}</b></td>
              <td><code>${esc(s.taxNo || '—')}</code></td>
              <td>${esc(s.phone || '—')}${s.email ? `<div class="mut" style="font-size:11px">${esc(s.email)}</div>` : ''}</td>
              <td>${esc(s.address || '—')}</td>
              <td><span class="badge b-info">${num(supOrders.length)} أوامر</span></td>
              <td><b>${money(supVol)}</b></td>
              <td><span class="badge ${s.active ? 'b-ok' : 'b-mut'}">${s.active ? 'معتمد' : 'موقوف'}</span></td>
              <td style="white-space:nowrap">
                ${can('procurement:manage') ? `
                  <button class="btn sm" data-act="proc-edit-sup" data-id="${s.id}">تعديل</button>
                  <button class="btn sm" data-act="proc-toggle-sup" data-id="${s.id}" data-on="${s.active ? 0 : 1}">${s.active ? 'إيقاف' : 'تفعيل'}</button>
                ` : ''}
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="9" class="empty">لا يوجد موردون مسجلون</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  function renderBody() {
    if (P.tab === 'overview') return viewOverview();
    if (P.tab === 'stock') return viewStock();
    if (P.tab === 'cycle') return viewCycle();
    if (P.tab === 'movements') return viewMovements();
    if (P.tab === 'assets') return viewAssets();
    if (P.tab === 'suppliers') return viewSuppliers();
    if (P.tab === 'quotes') return UA.views.quotations ? UA.views.quotations() : '';
    return '';
  }

  async function mount(el) {
    await loadTab();
    el.innerHTML = `
      <div class="sub-tabs" style="margin-bottom:14px">
        ${TABS.map(([k, l]) => `<button class="tab ${P.tab === k ? 'on' : ''}" data-act="proc-tab" data-t="${k}" aria-pressed="${P.tab === k}">${l}</button>`).join('')}
      </div>
      <div id="proc-body">${renderBody()}</div>
      <div id="proc-modal"></div>`;
  }

  function showModal(html) {
    const m = document.getElementById('proc-modal');
    if (m) m.innerHTML = `<div class="modal-bg" data-act="proc-close-modal"><div class="modal" style="max-width:700px">${html}</div></div>`;
  }
  const closeModal = () => { const m = document.getElementById('proc-modal'); if (m) m.innerHTML = ''; };
  const refresh = async () => { const el = document.getElementById('ua-view-mount'); if (el) await mount(el); };

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act^="proc-"]');
    if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'proc-tab') { P.tab = b.dataset.t; await refresh(); }
      else if (act === 'proc-pipe-go') {
        P.tab = b.dataset.t;
        if (b.dataset.t === 'cycle') P.cycleMode = b.dataset.mode || 'requests';
        if (b.dataset.t === 'movements') P.moveMode = b.dataset.mode || 'receipts';
        await refresh();
      }
      else if (act === 'proc-go-low') {
        P.tab = 'stock';
        P.itemFilter = { q: '', warehouse: '', category: '', low: '1' };
        await refresh();
      }
      else if (act === 'proc-wh-filter') {
        P.itemFilter.warehouse = b.dataset.id || '';
        await refresh();
      }
      else if (act === 'proc-filter-items') {
        P.itemFilter.q = document.getElementById('pi-filter-q')?.value.trim() || '';
        P.itemFilter.category = document.getElementById('pi-filter-cat')?.value || '';
        P.itemFilter.low = document.getElementById('pi-filter-low')?.value || '';
        await refresh();
      }
      else if (act === 'proc-reset-items') {
        P.itemFilter = { q: '', warehouse: '', category: '', low: '' };
        await refresh();
      }
      else if (act === 'proc-cycle-mode') { P.cycleMode = b.dataset.mode; await refresh(); }
      else if (act === 'proc-req-filter') { P.reqStatusFilter = b.dataset.st || ''; await refresh(); }
      else if (act === 'proc-ord-filter') { P.ordStatusFilter = b.dataset.st || ''; await refresh(); }
      else if (act === 'proc-move-mode') { P.moveMode = b.dataset.mode; await refresh(); }
      else if (act === 'proc-filter-assets') {
        P.assetFilter.q = document.getElementById('pa-filter-q')?.value.trim() || '';
        P.assetFilter.status = document.getElementById('pa-filter-st')?.value || '';
        P.assetFilter.warehouse = document.getElementById('pa-filter-wh')?.value || '';
        await refresh();
      }
      else if (act === 'proc-reset-assets') {
        P.assetFilter = { q: '', status: '', warehouse: '' };
        await refresh();
      }
      else if (act === 'proc-filter-sup') {
        P.supQuery = document.getElementById('ps-filter-q')?.value.trim() || '';
        await refresh();
      }
      else if (act === 'proc-close-modal') { if (b.classList.contains('modal-bg') && e.target.closest('.modal')) return; closeModal(); }

      else if (act === 'proc-replenish-low') {
        const lowItems = P.ov?.lowStockItems || [];
        if (!lowItems.length) { toast('لا توجد أصناف دون الحد الأدنى حالياً'); return; }
        const lines = lowItems.map((x) => ({
          itemId: x.id,
          description: `إعادة تموين مخزني: ${x.name}`,
          qty: Math.max(10, Number(x.minStock || 5) * 2 - Number(x.qtyOnHand || 0)),
          estCost: Number(x.avgCost || 0)
        }));
        await api('POST', '/api/procurement/requests', {
          title: 'طلب إعادة تموين الأصناف الحرجة دون الحد الأدنى',
          description: 'مولّد تلقائياً من تنبيهات الرقابة المخزنية',
          submit: true,
          lines
        });
        toast('تم توليد وإرسال طلب شراء للنواقص بنجاح');
        P.tab = 'cycle'; P.cycleMode = 'requests';
        await refresh();
      }

      else if (act === 'proc-new-wh' || act === 'proc-edit-wh') {
        const cur = act === 'proc-edit-wh' ? P.warehouses.find((x) => x.id === Number(b.dataset.id)) : null;
        showModal(`<h3>${cur ? 'تعديل بيانات المستودع' : 'إضافة مستودع جديد'}</h3>
          <div class="form-grid">
            <label>رمز المستودع<input id="pw-code" value="${esc(cur?.code || '')}" placeholder="WH-03"></label>
            <label>اسم المستودع<input id="pw-name" value="${esc(cur?.name || '')}" placeholder="مستودع الكليات العلمية"></label>
            <label style="grid-column:1/-1">الموقع الجغرافي / المبنى<input id="pw-loc" value="${esc(cur?.location || '')}" placeholder="مبنى الهندسة - الطابق الأرضي"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-wh" data-id="${cur?.id || ''}">حفظ المستودع</button></div>`);
      }
      else if (act === 'proc-save-wh') {
        const id = b.dataset.id;
        const body = { code: document.getElementById('pw-code').value, name: document.getElementById('pw-name').value, location: document.getElementById('pw-loc').value };
        if (id) await api('PUT', `/api/procurement/warehouses/${id}`, body);
        else await api('POST', '/api/procurement/warehouses', body);
        toast('تم حفظ المستودع'); closeModal(); await refresh();
      }
      else if (act === 'proc-toggle-wh') {
        await api('POST', `/api/procurement/warehouses/${b.dataset.id}/toggle`, { active: b.dataset.on === '1' });
        await refresh();
      }

      else if (act === 'proc-new-item' || act === 'proc-edit-item') {
        const cur = act === 'proc-edit-item' ? P.items.find((x) => x.id === Number(b.dataset.id)) : null;
        showModal(`<h3>${cur ? 'تعديل بطاقة صنف مخزني' : 'تعريف صنف مخزني جديد'}</h3>
          <div class="form-grid">
            <label>رمز الصنف<input id="pi-code" value="${esc(cur?.code || '')}" placeholder="ITM-020"></label>
            <label>اسم الصنف<input id="pi-name" value="${esc(cur?.name || '')}"></label>
            <label>التصنيف<select id="pi-cat"><option value="">— اختر —</option>${P.categories.map((c) => `<option value="${c.id}" ${cur?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label>المستودع الافتراضي<select id="pi-wh"><option value="">— اختر —</option>${P.warehouses.filter((w) => w.active).map((w) => `<option value="${w.id}" ${cur?.warehouseId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
            <label>وحدة القياس<input id="pi-unit" value="${esc(cur?.unit || 'قطعة')}"></label>
            <label>الحد الأدنى للتنبيه (نقطة إعادة الطلب)<input id="pi-min" type="number" value="${cur?.minStock ?? 5}"></label>
            <label style="grid-column:1/-1">مواصفات وملاحظات فنية<input id="pi-notes" value="${esc(cur?.notes || '')}"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-item" data-id="${cur?.id || ''}">حفظ البطاقة</button></div>`);
      }
      else if (act === 'proc-save-item') {
        const id = b.dataset.id;
        const body = {
          code: document.getElementById('pi-code').value,
          name: document.getElementById('pi-name').value,
          categoryId: document.getElementById('pi-cat').value || null,
          warehouseId: document.getElementById('pi-wh').value || null,
          unit: document.getElementById('pi-unit').value,
          minStock: Number(document.getElementById('pi-min').value),
          notes: document.getElementById('pi-notes').value
        };
        if (id) await api('PUT', `/api/procurement/items/${id}`, body);
        else await api('POST', '/api/procurement/items', body);
        toast('تم حفظ بطاقة الصنف'); closeModal(); await refresh();
      }
      else if (act === 'proc-adjust-item') {
        const cur = P.items.find((x) => x.id === Number(b.dataset.id));
        if (!cur) return;
        showModal(`<h3>⚖️ تسوية جرد فعلي للصنف: ${esc(cur.name)} (${esc(cur.code)})</h3>
          <div class="form-grid">
            <label>الرصيد الدفتري الحالي<input value="${num(cur.qtyOnHand)} ${esc(cur.unit)}" disabled></label>
            <label>الرصيد الفعلي بعد الجرد<input id="padj-qty" type="number" value="${cur.qtyOnHand}"></label>
            <label>متوسط التكلفة للوحدة (ل.س)<input id="padj-cost" type="number" value="${cur.avgCost || 0}"></label>
            <label>سبب التسوية / رقم محضر الجرد<input id="padj-reason"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-do-adjust" data-id="${cur.id}">اعتماد التسوية الجردية</button></div>`);
      }
      else if (act === 'proc-do-adjust') {
        await api('POST', `/api/procurement/items/${b.dataset.id}/adjust`, {
          qtyOnHand: Number(document.getElementById('padj-qty').value),
          avgCost: Number(document.getElementById('padj-cost').value),
          reason: document.getElementById('padj-reason').value
        });
        toast('تمت تسوية رصيد الصنف وتوثيقها في سجل التدقيق'); closeModal(); await refresh();
      }

      else if (act === 'proc-new-req') {
        if (!P.warehouses.length || !P.items.length) {
          const [w, it] = await Promise.all([api('GET', '/api/procurement/warehouses'), api('GET', '/api/procurement/items')]);
          P.warehouses = w.warehouses; P.items = it.items;
        }
        showModal(UA.formKit.render({
          as: 'div',
          bare: true,
          title: '📝 إنشاء طلب شراء داخلي (PRQ)',
          status: 'draft',
          steps: [{ label: 'مسودة', state: 'cur' }, { label: 'الاعتماد' }, { label: 'أمر التوريد' }, { label: 'الاستلام' }],
          sections: [
            { title: 'تفاصيل الطلب', html: `<label>عنوان طلب الشراء<input id="pr-title" placeholder="تأمين مستلزمات مخبر الشبكات والأمن السيبراني"></label>
            <label>المستودع المستفيد<select id="pr-wh"><option value="">— اختر المستودع —</option>${P.warehouses.filter((w) => w.active).map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></label>
            <label>القسم الطالب<input id="pr-dept" placeholder="المكتبة"></label>
            <label>المسمى الوظيفي لمقدّم الطلب<input id="pr-job" placeholder="سكرتير"></label>
            <label>المسؤول المباشر<input id="pr-mgr" placeholder="رئيس القسم"></label>
            <label>عتبة الشراء<select id="pr-thr"><option value="">— اختر —</option>${THRESHOLDS.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
            <label>تاريخ الحاجة<input id="pr-need" type="date"></label>
            <label>المبلغ الإجمالي كتابةً<input id="pr-words" placeholder="مليونان وسبعمئة ألف ليرة سورية لا غير"></label>` },
            { title: 'البنود المطلوبة', wide: true, html: `<div id="pr-lines">
            <div class="form-grid pr-line" style="margin-bottom:6px;grid-template-columns:1.2fr 1.2fr 1.3fr .8fr .6fr .5fr .7fr">
              <select class="pr-item" aria-label="الصنف"><option value="">— صنف مخزني (اختياري) —</option>${P.items.map((i) => `<option value="${i.id}" data-name="${esc(i.name)}" data-cost="${i.avgCost || 0}" data-unit="${esc(i.unit || '')}">${esc(i.code)} · ${esc(i.name)}</option>`).join('')}</select>
              <input class="pr-ldesc" placeholder="المادة" aria-label="المادة">
              <input class="pr-specs" placeholder="المواصفات" aria-label="المواصفات">
              <input class="pr-budget" placeholder="رمز الموازنة" aria-label="رمز الموازنة">
              <input class="pr-unit" placeholder="الواحدة" aria-label="الواحدة">
              <input class="pr-qty" type="number" value="5" placeholder="العدد" aria-label="العدد المطلوب">
              <input class="pr-cost" type="number" value="0" placeholder="السعر الإفرادي" aria-label="السعر الإفرادي">
            </div>
          </div>
          <button class="btn sm" data-act="proc-add-req-line" style="justify-self:start">+ إضافة بند آخر</button>` },
          ],
          justification: { id: 'pr-desc', label: 'مبرر الطلب وبيانه', max: 500 },
          actions: `<button class="btn pri" data-act="proc-save-req" data-sub="1">حفظ وإرسال للاعتماد</button>
            <button class="btn" data-act="proc-save-req" data-sub="0">حفظ كمسودة</button>
            <button class="btn" data-act="proc-close-modal">إلغاء</button>`,
        }));
      }
      else if (act === 'proc-add-req-line') {
        const c = document.getElementById('pr-lines');
        const first = c?.querySelector('.pr-line');
        if (c && first) {
          const clone = first.cloneNode(true);
          clone.querySelectorAll('input').forEach((i) => (i.value = i.classList.contains('pr-qty') ? '1' : i.classList.contains('pr-cost') ? '0' : ''));
          c.appendChild(clone);
        }
      }
      else if (act === 'proc-save-req') {
        const lines = [...document.querySelectorAll('#pr-lines .pr-line')].map((r) => {
          const sel = r.querySelector('.pr-item');
          const opt = sel.selectedOptions[0];
          const desc = r.querySelector('.pr-ldesc').value.trim() || opt?.dataset?.name || '';
          return {
            itemId: sel.value || null,
            description: desc,
            specs: r.querySelector('.pr-specs').value.trim(),
            budgetCode: r.querySelector('.pr-budget').value.trim(),
            unit: r.querySelector('.pr-unit').value.trim() || opt?.dataset?.unit || '',
            qty: Number(r.querySelector('.pr-qty').value),
            estCost: Number(r.querySelector('.pr-cost').value || opt?.dataset?.cost || 0)
          };
        });
        const val = (id) => document.getElementById(id).value.trim();
        await api('POST', '/api/procurement/requests', {
          title: document.getElementById('pr-title').value,
          description: document.getElementById('pr-desc').value,
          warehouseId: document.getElementById('pr-wh').value || null,
          department: val('pr-dept'), jobTitle: val('pr-job'), directManager: val('pr-mgr'), purchaseThreshold: val('pr-thr'), needDay: val('pr-need'), amountWords: val('pr-words'),
          submit: b.dataset.sub === '1',
          lines
        });
        toast('تم حفظ طلب الشراء'); closeModal(); P.tab = 'cycle'; P.cycleMode = 'requests'; await refresh();
      }
      else if (act === 'proc-view-req') {
        const { request: r } = await api('GET', `/api/procurement/requests/${b.dataset.id}`);
        const total = (r.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.estCost || 0), 0);
        showModal(`<div class="spread"><h3>تفاصيل طلب شراء ${esc(r.no)}</h3>${stBadge(REQ_STATUS, r.status)}</div>
          ${kv4([['الجهة الطالبة', r.department], ['مقدّم الطلب', r.requesterName], ['المسمى الوظيفي', r.jobTitle], ['المسؤول المباشر', r.directManager], ['عتبة الشراء', r.purchaseThreshold], ['تاريخ الحاجة', r.needDay], ['عنوان الطلب', r.title]])}
          <p style="margin:8px 0 4px"><b>طلب التوريد والخدمات اللوجستية:</b> يرجى الموافقة على شراء المواد الآتية:</p>
          <table class="tbl"><thead><tr><th>رقم السطر</th><th>المادة</th><th>الرمز (الموازنة)</th><th>المواصفات</th><th>رصيد المستودع</th><th>الواحدة</th><th>العدد المطلوب</th><th>السعر الإفرادي</th><th>السعر الإجمالي</th><th>ملاحظات</th></tr></thead><tbody>
            ${r.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description || l.itemName || '—')}</td><td>${esc(l.budgetCode || '—')}</td><td>${esc(l.specs || '—')}</td><td>${l.stockBalance === null || l.stockBalance === undefined ? '—' : num(l.stockBalance)}</td><td>${esc(l.unit || '—')}</td><td>${num(l.qty)}</td><td>${num(l.estCost)}</td><td><b>${num(l.qty * l.estCost)}</b></td><td>${esc(l.note || '—')}</td></tr>`).join('')}
          </tbody><tfoot><tr><th colspan="8">الإجمالي (ل.س)</th><th>${num(total)}</th><th></th></tr></tfoot></table>
          ${kv4([['المبلغ كتابةً', r.amountWords], ['سبب الطلب ومبرّراته', r.description]])}
          ${r.decisionNote ? `<p><b>ملاحظة القرار:</b> ${esc(r.decisionNote)}</p>` : ''}
          ${r.approval ? `<p data-print-skip><b>مراحل الاعتماد:</b> ${r.approval.required.map((l) => { const d = r.approval.done.find((x) => x.label === l); return d ? `✓ ${esc(l)} (${esc(d.by || '—')})` : (r.approval.next && r.approval.next.label === l ? `⏳ ${esc(l)}` : esc(l)); }).join(' ← ')}</p>` : ''}
          <div class="row-end" style="margin-top:12px">
            <button class="btn no-print" data-act="print">طباعة</button><span hidden data-doc-title="طلب شراء" data-doc-no="${esc(r.no)}" data-doc-status="${esc((REQ_STATUS[r.status] || [r.status])[0])}" data-doc-dept="المشتريات والمخازن" data-doc-signers="مقدّم الطلب:${esc(r.requesterName || '')}|المسؤول المباشر:${esc(r.directManager || '')}|مسؤول المشتريات|أمين الجامعة"></span>
            ${r.status === 'approved' && can('procurement:manage') ? `<button class="btn pri" data-act="proc-req-to-po" data-id="${r.id}">🚚 تحويل لأمر توريد (PO)</button>` : ''}
            <button class="btn" data-act="proc-close-modal">إغلاق</button>
          </div>`);
      }
      else if (act === 'proc-sub-req') { await api('POST', `/api/procurement/requests/${b.dataset.id}/submit`, {}); toast('أُرسل الطلب للاعتماد'); await refresh(); }
      else if (act === 'proc-app-req') { await api('POST', `/api/procurement/requests/${b.dataset.id}/approve`, { note: 'معتمد أصولاً للسير بإجراءات الشراء' }); toast('تم اعتماد طلب الشراء'); await refresh(); }
      else if (act === 'proc-rej-req') {
        const rId = b.dataset.id;
        showModal(`<h3>رفض طلب الشراء</h3><label>سبب الرفض الإلزامي<input id="prej-note" placeholder="عدم توفر اعتماد مالي / توفر البديل بالمستودع"></label>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn dan" data-act="proc-do-rej-req" data-id="${rId}">تأكيد الرفض</button></div>`);
      }
      else if (act === 'proc-do-rej-req') {
        await api('POST', `/api/procurement/requests/${b.dataset.id}/reject`, { note: document.getElementById('prej-note').value });
        toast('تم رفض الطلب'); closeModal(); await refresh();
      }

      else if (act === 'proc-new-order' || act === 'proc-req-to-po') {
        if (!P.suppliers.length || !P.items.length) {
          const [s, it, rq] = await Promise.all([api('GET', '/api/procurement/suppliers'), api('GET', '/api/procurement/items'), api('GET', '/api/procurement/requests')]);
          P.suppliers = s.suppliers; P.items = it.items; P.requests = rq.requests;
        }
        P.budgets = can('procurement:manage') ? (await api('GET', '/api/procurement/budgets').catch(() => ({ budgets: [] }))).budgets : [];
        const preReqId = act === 'proc-req-to-po' ? Number(b.dataset.id) : null;
        const preReq = preReqId ? P.requests.find((r) => r.id === preReqId) : null;
        const appReqs = P.requests.filter((r) => r.status === 'approved');
        const initLines = preReq?.lines?.length ? preReq.lines : [{ itemId: '', description: '', qty: 5, estCost: 25000 }];
        showModal(`<h3>🚚 إصدار أمر توريد رسمي للمورد (Purchase Order)</h3>
          <div class="form-grid">
            <label>المورد المعتمد<select id="po-sup">${P.suppliers.filter((s) => s.active).map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.code)})</option>`).join('')}</select></label>
            <label>ربط بطلب شراء معتمد<select id="po-req"><option value="">— أمر توريد مباشر —</option>${appReqs.map((r) => `<option value="${r.id}" ${preReqId === r.id ? 'selected' : ''}>${esc(r.no)} · ${esc(r.title)}</option>`).join('')}</select></label>
            <label>بند الموازنة<select id="po-budget" data-no-other="1"><option value="">— دون ربط بالموازنة —</option>${(P.budgets || []).map((x) => `<option value="${x.id}">${esc(x.label)} — المتاح ${Number(x.available).toLocaleString('en-US')}</option>`).join('')}</select></label>
            <label style="grid-column:1/-1">شروط التوريد والتسليم<input id="po-note" value="${preReq ? `توريد بنود الطلب ${preReq.no}` : 'تسليم أرض المستودع المركزي خلال 7 أيام'}"></label>
            <label>طريقة التوصيل<input id="po-dmethod" placeholder="توصيل المورّد"></label>
            <label>تاريخ التوصيل المطلوب<input id="po-dday" type="date"></label>
            <label>شروط الدفع<input id="po-pay" placeholder="نقدًا (كاش)"></label>
            <label>العملة<select id="po-cur"><option>ليرة سورية</option><option>USD</option></select></label>
          </div>
          <h4>عنوان التوصيل / الاستلام وتحرير الفواتير</h4>
          <div class="form-grid">
            <label>شخص التواصل للتوصيل<input id="po-dcon" placeholder="أمين المستودع"></label>
            <label>البريد الإلكتروني للتوصيل<input id="po-dmail" type="email"></label>
            <label style="grid-column:1/-1">عنوان التوصيل<input id="po-daddr" placeholder="المخزن الرئيسي — الجامعة السورية للعلوم الأمنية"></label>
            <label>شخص التواصل للفوترة<input id="po-bcon" placeholder="المحاسب"></label>
            <label>البريد الإلكتروني للفوترة<input id="po-bmail" type="email"></label>
          </div>
          <h4>بنود أمر الشراء</h4>
          <div id="po-lines">
            ${initLines.map((ln) => `
              <div class="form-grid po-line" style="margin-bottom:6px;grid-template-columns:1.3fr 1.6fr .6fr .6fr .9fr">
                <select class="po-item" aria-label="الصنف"><option value="">— اختر الصنف —</option>${P.items.map((i) => `<option value="${i.id}" ${ln.itemId === i.id ? 'selected' : ''}>${esc(i.code)} · ${esc(i.name)}</option>`).join('')}</select>
                <input class="po-desc" value="${esc(ln.description || '')}" placeholder="وصف المواد / الخدمات" aria-label="الوصف">
                <input class="po-unit" value="${esc(ln.unit || '')}" placeholder="الواحدة" aria-label="الواحدة">
                <input class="po-qty" type="number" value="${ln.qty || 1}" placeholder="الكمية" aria-label="الكمية">
                <input class="po-cost" type="number" value="${ln.estCost || ln.unitCost || 25000}" placeholder="سعر الواحدة" aria-label="سعر الواحدة">
              </div>
            `).join('')}
          </div>
          <div class="form-grid">
            <label>ضريبة المبيعات (إن وُجدت)<input id="po-stax" type="number" value="0" min="0"></label>
            <label>ضريبة التوصيل (إن وُجدت)<input id="po-dtax" type="number" value="0" min="0"></label>
            <label>ضرائب أخرى (إن وُجدت)<input id="po-otax" type="number" value="0" min="0"></label>
          </div>
          <div class="row-end" style="margin-top:12px"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-order">إصدار أمر التوريد</button></div>`);
      }
      else if (act === 'proc-save-order') {
        const lines = [...document.querySelectorAll('#po-lines .po-line')].map((r) => ({
          itemId: r.querySelector('.po-item').value || null,
          description: r.querySelector('.po-desc').value,
          unit: r.querySelector('.po-unit').value.trim(),
          qty: Number(r.querySelector('.po-qty').value),
          unitCost: Number(r.querySelector('.po-cost').value)
        }));
        const val = (id) => document.getElementById(id).value.trim();
        await api('POST', '/api/procurement/orders', {
          supplierId: Number(document.getElementById('po-sup').value),
          requestId: document.getElementById('po-req').value || null,
          budgetId: Number(document.getElementById('po-budget')?.value) || null,
          note: document.getElementById('po-note').value,
          deliveryMethod: val('po-dmethod'), deliveryDay: val('po-dday'), paymentTerms: val('po-pay'), currency: val('po-cur'),
          deliveryContact: val('po-dcon'), deliveryEmail: val('po-dmail'), deliveryAddress: val('po-daddr'), billingContact: val('po-bcon'), billingEmail: val('po-bmail'),
          salesTax: Number(val('po-stax') || 0), deliveryTax: Number(val('po-dtax') || 0), otherTax: Number(val('po-otax') || 0),
          lines
        });
        toast('تم إصدار أمر التوريد بنجاح'); closeModal(); P.tab = 'cycle'; P.cycleMode = 'orders'; await refresh();
      }
      else if (act === 'proc-view-ord') {
        const { order: o } = await api('GET', `/api/procurement/orders/${b.dataset.id}`);
        const sp = o.supplier || {};
        showModal(`<div data-doc-title="أمر شراء" data-doc-no="${esc(o.no)}" data-doc-dept="المشتريات والمخازن" data-doc-status="${esc((ORD_STATUS[o.status] || [o.status])[0] || '')}" data-doc-signers="نظّمه (مسؤول المشتريات)|حامل الميزانية (بالتفويض)|الآمر بالصرف|موافقة المورّد وختمه"></div><div class="spread"><h3>أمر شراء رقم ${esc(o.no)}</h3>${stBadge(ORD_STATUS, o.status)}</div>
          <h4 style="margin:8px 0 4px">المورّد</h4>
          ${kv4([['اسم الشركة', o.supplierName], ['شخص التواصل', sp.contactPerson], ['البريد الإلكتروني', sp.email], ['الهاتف', sp.phone], ['الفاكس', sp.fax], ['الموبايل', sp.mobile], ['العنوان', sp.address]])}
          <h4 style="margin:8px 0 4px">عنوان التوصيل / الاستلام وتحرير الفواتير</h4>
          ${kv4([['شخص التواصل للتوصيل', o.deliveryContact], ['البريد الإلكتروني', o.deliveryEmail], ['عنوان التوصيل', o.deliveryAddress], ['جهة الفوترة', 'الجامعة السورية للعلوم الأمنية'], ['شخص التواصل للفوترة', o.billingContact], ['بريد الفوترة', o.billingEmail]])}
          ${kv4([['طريقة التوصيل', o.deliveryMethod], ['تاريخ التوصيل المطلوب', o.deliveryDay], ['شروط الدفع', o.paymentTerms], ['تاريخ الإصدار', fmt(o.createdAt)], ['شروط التوريد', o.note]])}
          <table class="tbl"><thead><tr><th>رقم طلب الشراء</th><th>رقم السطر</th><th>وصف المواد / الخدمات</th><th>الواحدة</th><th>الكمية</th><th>العملة</th><th>سعر الواحدة</th><th>السعر الكامل</th></tr></thead><tbody>
            ${(o.lines || []).map((l, i) => `<tr><td>${esc(o.requestNo || '—')}</td><td>${i + 1}</td><td>${esc(l.description || l.itemName || '—')}</td><td>${esc(l.unit || '—')}</td><td>${num(l.qty)}</td><td>${esc(o.currency || 'ليرة سورية')}</td><td>${num(l.unitCost)}</td><td><b>${num(l.lineTotal)}</b></td></tr>`).join('')}
          </tbody><tfoot>
            <tr><th colspan="7">المجموع</th><th>${num(o.totalAmount)}</th></tr>
            <tr><th colspan="7">ضريبة المبيعات (إن وُجدت)</th><th>${num(o.salesTax)}</th></tr>
            <tr><th colspan="7">ضريبة التوصيل (إن وُجدت)</th><th>${num(o.deliveryTax)}</th></tr>
            <tr><th colspan="7">ضرائب أخرى (إن وُجدت)</th><th>${num(o.otherTax)}</th></tr>
            <tr><th colspan="7">المجموع الكامل</th><th>${num(o.grandTotal ?? o.totalAmount)}</th></tr>
          </tfoot></table>
          <p class="small">يجب ذكر رقم طلب الشراء على جميع المراسلات والوثائق، بما فيها مذكرة التسليم والفاتورة.</p>
          <div class="row-end" style="margin-top:12px">
            <button class="btn no-print" data-act="print">🖨️ طباعة أمر الشراء</button>
            <button class="btn pri" data-act="proc-close-modal">إغلاق</button>
          </div>`);
      }
      else if (act === 'proc-send-ord') { await api('POST', `/api/procurement/orders/${b.dataset.id}/order`, {}); toast('أُرسل أمر التوريد للمورد'); await refresh(); }
      else if (act === 'proc-can-ord') { await api('POST', `/api/procurement/orders/${b.dataset.id}/cancel`, {}); toast('أُلغي أمر التوريد'); await refresh(); }

      else if (act === 'proc-new-receipt' || act === 'proc-rcv-from-ord') {
        if (!P.orders.length || !P.items.length) {
          const [or, it] = await Promise.all([api('GET', '/api/procurement/orders?status=ordered'), api('GET', '/api/procurement/items')]);
          P.orders = or.orders; P.items = it.items;
        }
        const ordList = P.orders.filter((o) => o.status === 'ordered');
        if (!ordList.length) { toast('لا توجد أوامر توريد بحالة «مرسل للمورد» بانتظار الاستلام'); return; }
        const preOrdId = act === 'proc-rcv-from-ord' ? Number(b.dataset.id) : ordList[0].id;
        const selOrd = ordList.find((o) => o.id === preOrdId) || ordList[0];
        // بنود الاستلام من بنود أمر الشراء: الكمية المتوقعة والمستلمة وفحص الجودة لكل بند
        const rcvRows = (o) => (o?.lines || []).filter((l) => l.itemId).map((l) => `
          <div class="form-grid prc-line" data-item="${l.itemId}" data-expected="${l.qty}" style="margin-bottom:6px;grid-template-columns:1.8fr .7fr .8fr 1fr 1.4fr">
            <span style="align-self:center"><b>${esc(l.itemName || l.description)}</b> <span class="small">(${esc(l.unit || '')})</span></span>
            <span style="align-self:center" class="small">المتوقعة: ${num(l.qty)}</span>
            <input class="prc-qty" type="number" min="0" value="${l.qty}" aria-label="الكمية المستلمة">
            <select class="prc-quality" aria-label="فحص الجودة">${QUALITY.map((q) => `<option>${esc(q)}</option>`).join('')}</select>
            <input class="prc-comment" placeholder="تعليقات" aria-label="تعليقات">
          </div>`).join('') || '<p class="small">لا توجد في هذا الأمر بنود مرتبطة بأصناف مخزنية.</p>';
        showModal(`<h3>📥 تسجيل مذكرة فحص واستلام مواد</h3>
          <div class="form-grid">
            <label>أمر الشراء (PO)<select id="prc-ord">${ordList.map((o) => `<option value="${o.id}" ${o.id === selOrd.id ? 'selected' : ''}>${esc(o.no)} · ${esc(o.supplierName)}</option>`).join('')}</select></label>
            <label>تم الاستلام من (المورّد / المتبرع)<input id="prc-from" placeholder="اسم المورّد افتراضيًا"></label>
            <label>رقم بيان الشحنة / مذكرة التسليم<input id="prc-dn" placeholder="DN-0000"></label>
            <label>موقع المستلم<input id="prc-loc" placeholder="المخزن الرئيسي"></label>
          </div>
          <h4>البنود المستلمة</h4>
          <div id="prc-lines">${rcvRows(selOrd)}</div>
          <div class="form-grid">
            <label style="grid-column:1/-1">ملاحظات الفحص<input id="prc-note"></label>
            <label>تتوافق جميع البضائع مع المعايير لتمرير الدفعة<select id="prc-ok"><option value="1">نعم</option><option value="0">لا</option></select></label>
          </div>
          <p class="small">يجب فحص البضاعة مقابل الكميات والمواصفات المدرجة في طلب الشراء، وتُترك مدة بين الاستلام والدفع للتأكد من الجودة.</p>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-receipt">اعتماد الاستلام وتحديث الرصيد</button></div>`);
        document.getElementById('prc-ord')?.addEventListener('change', (e) => {
          const o = ordList.find((x) => x.id === Number(e.target.value));
          document.getElementById('prc-lines').innerHTML = rcvRows(o);
        });
      }
      else if (act === 'proc-save-receipt') {
        const lines = [...document.querySelectorAll('#prc-lines .prc-line')].map((r) => ({
          itemId: Number(r.dataset.item),
          expectedQty: Number(r.dataset.expected),
          qty: Number(r.querySelector('.prc-qty').value),
          quality: r.querySelector('.prc-quality').value,
          comment: r.querySelector('.prc-comment').value.trim()
        })).filter((l) => l.qty > 0);
        if (!lines.length) { toast('أدخل كمية مستلمة لبند واحد على الأقل'); return; }
        await api('POST', '/api/procurement/receipts', {
          orderId: Number(document.getElementById('prc-ord').value),
          note: document.getElementById('prc-note').value,
          receivedFrom: document.getElementById('prc-from').value.trim(),
          deliveryNoteNo: document.getElementById('prc-dn').value.trim(),
          location: document.getElementById('prc-loc').value.trim(),
          compliant: document.getElementById('prc-ok').value === '1',
          lines
        });
        toast('تم استلام التوريد وتحديث المخزون ومتوسط التكلفة المرجح'); closeModal(); P.tab = 'movements'; P.moveMode = 'receipts'; await refresh();
      }

      else if (act === 'proc-new-issue') {
        if (!P.warehouses.length || !P.items.length) {
          const [w, it] = await Promise.all([api('GET', '/api/procurement/warehouses'), api('GET', '/api/procurement/items')]);
          P.warehouses = w.warehouses; P.items = it.items;
        }
        showModal(`<h3>📤 تحرير محضر إخراج / صرف مواد من المستودع</h3>
          <div class="form-grid">
            <label>المستودع المصدِّر<select id="pis-wh">${P.warehouses.filter((w) => w.active).map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></label>
            <label>رقم طلب الصرف / الإخراج<input id="pis-ref" placeholder="SR-2026-0001"></label>
            <label>القسم الطالب<input id="pis-dept" placeholder="المكتبة"></label>
            <label>اسم المستلم<input id="pis-recv" placeholder="اسم الموظف المستلم"></label>
            <label style="grid-column:1/-1">الغرض من الإخراج<input id="pis-purpose" placeholder="تأمين مستلزمات القاعات التدريسية"></label>
          </div>
          <h4>المواد المصروفة</h4>
          <div id="pis-lines">
            <div class="form-grid pis-line" style="margin-bottom:6px;grid-template-columns:1.8fr .7fr .7fr .9fr 1.2fr">
              <select class="pis-item" aria-label="المادة">${P.items.filter((i) => i.qtyOnHand > 0).map((i) => `<option value="${i.id}">${esc(i.code)} · ${esc(i.name)} (المتاح: ${num(i.qtyOnHand)})</option>`).join('')}</select>
              <input class="pis-req" type="number" min="1" value="1" placeholder="المطلوبة" aria-label="الكمية المطلوبة">
              <input class="pis-qty" type="number" min="1" value="1" placeholder="المصروفة" aria-label="الكمية المصروفة">
              <select class="pis-cond" aria-label="حالة المادة">${CONDITION.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
              <input class="pis-note" placeholder="ملاحظات" aria-label="ملاحظات">
            </div>
          </div>
          <button class="btn sm" data-act="proc-add-issue-line">+ إضافة مادة أخرى</button>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-issue">اعتماد الصرف وتخفيض الرصيد</button></div>`);
      }
      else if (act === 'proc-view-rcv') {
        const r = P.receipts.find((x) => x.id === Number(b.dataset.id)); if (!r) return;
        showModal(`<div data-doc-title="مذكرة فحص واستلام مواد" data-doc-no="${esc(r.no)}" data-doc-dept="المشتريات والمخازن" data-doc-signers="أمين المستودع (المستلم)|القسم الطالب|لجنة الفحص والاستلام|مسؤول المشتريات"></div>
          <div class="spread"><h3>مذكرة فحص واستلام مواد ${esc(r.no)}</h3>${r.reversedAt ? '<span class="badge b-err">معكوسة</span>' : ''}</div>
          ${kv4([['تاريخ استلام السلع', fmt(r.receivedAt)], ['رقم أمر الشراء', r.orderNo], ['تم الاستلام من (المورّد / المتبرع)', r.receivedFrom], ['رقم بيان الشحنة / مذكرة التسليم', r.deliveryNoteNo], ['موقع المستلم', r.location], ['رقم طلب الشراء', r.requestNo]])}
          <table class="tbl"><thead><tr><th>رقم طلب الشراء</th><th>رقم العنصر</th><th>وصف المواد</th><th>الواحدة</th><th>الكمية المتوقعة</th><th>الكمية المستلمة</th><th>فحص الجودة</th><th>تعليقات</th></tr></thead><tbody>
            ${(r.lines || []).map((l, i) => `<tr><td>${esc(r.requestNo || '—')}</td><td>${i + 1}</td><td>${esc(l.itemName)}</td><td>${esc(l.unit || '—')}</td><td>${l.expectedQty === null || l.expectedQty === undefined ? '—' : num(l.expectedQty)}</td><td><b>${num(l.qty)}</b></td><td>${esc(l.quality || '—')}</td><td>${esc(l.comment || '—')}</td></tr>`).join('')}
          </tbody></table>
          ${kv4([['ملاحظات الفحص', r.note], ['تتوافق جميع البضائع مع المعايير لتمرير الدفعة', r.compliant === null || r.compliant === undefined ? '—' : r.compliant ? 'نعم' : 'لا']])}
          <p class="small">يجب فحص البضاعة مقابل الكميات والمواصفات المدرجة في طلب الشراء، وتُترك مدة بين الاستلام والدفع للتأكد من الجودة.</p>
          <div class="row-end" style="margin-top:12px"><button class="btn no-print" data-act="print">🖨️ طباعة المذكرة</button><button class="btn pri" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-view-iss') {
        const s = P.issues.find((x) => x.id === Number(b.dataset.id)); if (!s) return;
        showModal(`<div data-doc-title="محضر إخراج / صرف مواد من المستودع" data-doc-no="${esc(s.no)}" data-doc-dept="المشتريات والمخازن" data-doc-orient="landscape" data-doc-signers="أمين المستودع|القسم الطالب|المستلم:${esc(s.receiverName || '')}|المشرف / المسؤول المعتمد"></div>
          <div class="spread"><h3>محضر إخراج / صرف مواد ${esc(s.no)}</h3>${s.reversedAt ? '<span class="badge b-err">معكوس</span>' : ''}</div>
          ${kv4([['تاريخ الإخراج', fmt(s.issuedAt)], ['القسم الطالب', s.department || s.issuedTo], ['رقم طلب الصرف / الإخراج', s.requestRef], ['موقع المستودع', [s.warehouseName, s.warehouseLocation].filter(Boolean).join(' — ')], ['اسم المستلم', s.receiverName], ['الغرض من الإخراج', s.purpose]])}
          <table class="tbl"><thead><tr><th>رقم السطر</th><th>اسم / وصف المادة</th><th>الواحدة</th><th>الكمية المطلوبة</th><th>الكمية المصروفة</th><th>الرصيد بعد الصرف</th><th>حالة المادة</th><th>ملاحظات</th></tr></thead><tbody>
            ${(s.lines || []).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.itemName)}</td><td>${esc(l.unit || '—')}</td><td>${num(l.requestedQty)}</td><td><b>${num(l.qty)}</b></td><td>${l.balanceAfter === null || l.balanceAfter === undefined ? '—' : num(l.balanceAfter)}</td><td>${esc(l.itemCondition || '—')}</td><td>${esc(l.note || '—')}</td></tr>`).join('')}
          </tbody></table>
          <h4 style="margin:8px 0 4px">إقرار الاستلام والإخراج</h4>
          <p>أُقرّ بأن المواد الموضحة أعلاه أُخرجت من المستودع وسُلّمت للجهة أو الشخص المستلم وفق الكميات المسجلة في هذا المحضر، وأنها استُلمت بحالة سليمة ما لم يرد خلاف ذلك في خانة الملاحظات.</p>
          <p class="small">التوزيع المقترح: المالية (أصل) – المستودع (نسخة) – المشتريات (نسخة).</p>
          <div class="row-end" style="margin-top:12px"><button class="btn no-print" data-act="print">🖨️ طباعة المحضر</button><button class="btn pri" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-add-issue-line') {
        const c = document.getElementById('pis-lines'), first = c?.querySelector('.pis-line');
        if (c && first) { const n = first.cloneNode(true); n.querySelectorAll('input').forEach((i) => (i.value = i.type === 'number' ? '1' : '')); c.appendChild(n); }
      }
      else if (act === 'proc-save-issue') {
        const val = (id) => document.getElementById(id).value.trim();
        await api('POST', '/api/procurement/issues', {
          warehouseId: Number(document.getElementById('pis-wh').value),
          requestRef: val('pis-ref'), department: val('pis-dept'), receiverName: val('pis-recv'),
          purpose: document.getElementById('pis-purpose').value,
          lines: [...document.querySelectorAll('#pis-lines .pis-line')].map((r) => ({
            itemId: Number(r.querySelector('.pis-item').value), requestedQty: Number(r.querySelector('.pis-req').value), qty: Number(r.querySelector('.pis-qty').value),
            itemCondition: r.querySelector('.pis-cond').value, note: r.querySelector('.pis-note').value.trim()
          }))
        });
        toast('تم تحرير إذن الصرف وتخفيض الرصيد المخزني'); closeModal(); P.tab = 'movements'; P.moveMode = 'issues'; await refresh();
      }

      else if (act === 'proc-new-asset' || act === 'proc-edit-asset') {
        const cur = act === 'proc-edit-asset' ? P.assets.find((x) => x.id === Number(b.dataset.id)) : null;
        showModal(`<h3>${cur ? 'تعديل بطاقة أصل ثابت' : 'تسجيل أصل ثابت جديد في السجل الرأسمالي'}</h3>
          <div class="form-grid">
            <label>رمز الأصل الثابت<input id="pa-code" value="${esc(cur?.code || '')}" placeholder="AST-010"></label>
            <label>اسم الأصل والوصف<input id="pa-name" value="${esc(cur?.name || '')}" placeholder="حاسوب محمول Dell Latitude"></label>
            <label>الفئة<input id="pa-cat" value="${esc(cur?.category || 'أجهزة حاسوب')}"></label>
            <label>المستودع / الموقع<select id="pa-wh"><option value="">— اختر —</option>${P.warehouses.map((w) => `<option value="${w.id}" ${cur?.warehouseId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
            <label>التكلفة الرأسمالية (ل.س)<input id="pa-cost" type="number" value="${cur?.cost ?? 0}"></label>
            <label>تاريخ الشراء<input id="pa-day" type="date" value="${esc(cur?.purchaseDay || new Date().toISOString().slice(0, 10))}"></label>
            <label>العهدة المسندة إلى (الموظف / القسم)<input id="pa-user" value="${esc(cur?.assignedTo || '')}" placeholder="مخبر الشبكات - قاعة 2"></label>
            <label>حالة الأصل<select id="pa-st">${Object.entries(ASSET_STATUS).map(([k, [l]]) => `<option value="${k}" ${cur?.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          </div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-asset" data-id="${cur?.id || ''}">حفظ الأصل الثابت</button></div>`);
      }
      else if (act === 'proc-save-asset') {
        const id = b.dataset.id;
        const body = {
          code: document.getElementById('pa-code').value,
          name: document.getElementById('pa-name').value,
          category: document.getElementById('pa-cat').value,
          warehouseId: document.getElementById('pa-wh').value || null,
          cost: Number(document.getElementById('pa-cost').value),
          purchaseDay: document.getElementById('pa-day').value,
          assignedTo: document.getElementById('pa-user').value,
          status: document.getElementById('pa-st').value
        };
        if (id) await api('PUT', `/api/procurement/assets/${id}`, body);
        else await api('POST', '/api/procurement/assets', body);
        toast('تم حفظ الأصل الثابت'); closeModal(); await refresh();
      }
      else if (act === 'proc-move-asset') {
        const id = b.dataset.id;
        const cur = P.assets.find((x) => x.id === Number(id));
        showModal(`<h3>🔄 حركة عهدة أصل ثابت: ${esc(cur?.name || '')}</h3>
          <div class="form-grid">
            <label>نوع الحركة<select id="pm-kind"><option value="transfer">نقل عهدة / تغيير موقع</option><option value="maintenance">تحويل للصيانة الفنية</option><option value="return">إرجاع للمستودع (متاح)</option><option value="dispose">إتلاف / شطب بموجب محضر</option></select></label>
            <label>المستودع / الموقع الهدف<select id="pm-wh">${P.warehouses.map((w) => `<option value="${w.id}" ${cur?.warehouseId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
            <label>المستلم الجديد للعهدة<input id="pm-user" value="${esc(cur?.assignedTo || '')}" placeholder="اسم الموظف أو القسم"></label>
            <label>السبب / رقم محضر التسليم<input id="pm-reason" placeholder="محضر تسليم عهدة رسمي"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-do-move-asset" data-id="${id}">تنفيذ وتوثيق الحركة</button></div>`);
      }
      else if (act === 'proc-do-move-asset') {
        await api('POST', `/api/procurement/assets/${b.dataset.id}/move`, {
          kind: document.getElementById('pm-kind').value,
          toWarehouseId: Number(document.getElementById('pm-wh').value),
          toUser: document.getElementById('pm-user').value,
          reason: document.getElementById('pm-reason').value
        });
        toast('تم تسجيل حركة العهدة للأصل الثابت'); closeModal(); await refresh();
      }
      else if (act === 'proc-del-asset') {
        await api('DELETE', `/api/procurement/assets/${b.dataset.id}`);
        toast('تم حذف الأصل'); await refresh();
      }

      else if (act === 'proc-new-sup' || act === 'proc-edit-sup') {
        const cur = act === 'proc-edit-sup' ? P.suppliers.find((x) => x.id === Number(b.dataset.id)) : null;
        showModal(`<h3>${cur ? 'تعديل بيانات المورد' : 'تسجيل مورد معتمد جديد'}</h3>
          <div class="form-grid">
            <label>رمز المورد<input id="ps-code" value="${esc(cur?.code || '')}" placeholder="SUP-03"></label>
            <label>اسم الشركة / المورد<input id="ps-name" value="${esc(cur?.name || '')}"></label>
            <label>رقم الهاتف<input id="ps-phone" value="${esc(cur?.phone || '')}"></label>
            <label>البريد الإلكتروني<input id="ps-email" value="${esc(cur?.email || '')}"></label>
            <label>الرقم الضريبي / السجل التجاري<input id="ps-tax" value="${esc(cur?.taxNo || '')}"></label>
            <label>العنوان التفصيلي<input id="ps-addr" value="${esc(cur?.address || '')}"></label>
            <label>شخص التواصل<input id="ps-contact" value="${esc(cur?.contactPerson || '')}"></label>
            <label>الموبايل<input id="ps-mobile" value="${esc(cur?.mobile || '')}"></label>
            <label>الفاكس<input id="ps-fax" value="${esc(cur?.fax || '')}"></label>
            <label>مجال تخصص المورّد<input id="ps-spec" value="${esc(cur?.specialty || '')}" placeholder="أجهزة ولوازم مكتبية"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-sup" data-id="${cur?.id || ''}">حفظ بيانات المورد</button></div>`);
      }
      else if (act === 'proc-save-sup') {
        const id = b.dataset.id;
        const body = {
          code: document.getElementById('ps-code').value,
          name: document.getElementById('ps-name').value,
          phone: document.getElementById('ps-phone').value,
          email: document.getElementById('ps-email').value,
          taxNo: document.getElementById('ps-tax').value,
          address: document.getElementById('ps-addr').value,
          contactPerson: document.getElementById('ps-contact').value,
          mobile: document.getElementById('ps-mobile').value,
          fax: document.getElementById('ps-fax').value,
          specialty: document.getElementById('ps-spec').value
        };
        if (id) await api('PUT', `/api/procurement/suppliers/${id}`, body);
        else await api('POST', '/api/procurement/suppliers', body);
        toast('تم حفظ بيانات المورد'); closeModal(); await refresh();
      }
      else if (act === 'proc-toggle-sup') {
        await api('POST', `/api/procurement/suppliers/${b.dataset.id}/toggle`, { active: b.dataset.on === '1' });
        await refresh();
      }
    } catch (err) {
      toast(err.message || 'تعذّر تنفيذ الإجراء');
    }
  });

  UA.views.procurement = async function (el) { await mount(el); };
})();
