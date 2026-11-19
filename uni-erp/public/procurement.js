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
  const CH = { whatsapp: 'واتساب', email: 'البريد الإلكتروني', print: 'طباعة وتسليم', hand: 'تسليم باليد', fax: 'الفاكس' };
  const FILE_KIND = { invoice: 'فاتورة المورد', delivery: 'مذكرة التسليم', quote: 'عرض السعر', other: 'مرفق آخر' };
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);
  // قراءة رمز QR بالكاميرا (BarcodeDetector)؛ وإلا فقارئ الباركود USB يكتب في الحقل مباشرة
  async function scanQr(targetId) {
    const inp = document.getElementById(targetId);
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { toast('المتصفح لا يدعم القراءة بالكاميرا؛ اضغط داخل الحقل وامسح الملصق بقارئ الباركود.'); if (inp) inp.focus(); return; }
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    host.innerHTML = '<div class="modal" style="max-width:420px;width:100%;margin:0"><h3>قراءة رمز QR</h3><video playsinline muted style="width:100%;border-radius:8px;background:#000"></video><p class="small">وجّه الكاميرا إلى ملصق الصنف.</p><div class="row-end"><button type="button" class="btn">إلغاء</button></div></div>';
    document.body.appendChild(host);
    let stream = null;
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); host.remove(); };
    host.querySelector('button').onclick = stop;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { stop(); toast('تعذّر فتح الكاميرا.'); return; }
    const v = host.querySelector('video'); v.srcObject = stream; await v.play().catch(() => {});
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!host.isConnected) return;
      try { const r = await det.detect(v); if (r[0]) { if (inp) { inp.value = r[0].rawValue; inp.dispatchEvent(new Event('input', { bubbles: true })); } stop(); toast('قُرئ الرمز'); return; } } catch { /* إطار غير جاهز */ }
      requestAnimationFrame(tick);
    };
    tick();
  }
  const readB64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('تعذّرت قراءة الملف')); r.readAsDataURL(f); });
  // يعيد فتح نافذة عرض أمر الشراء بعد رفع مرفق أو إرسال
  const reopenOrder = (id) => { const t = document.createElement('button'); t.dataset.act = 'proc-view-ord'; t.dataset.id = String(id); t.hidden = true; document.body.appendChild(t); t.click(); t.remove(); };
  const CONDITION = ['جديدة', 'مستعملة', 'تالفة'];
  const THRESHOLDS = ['شراء مباشر', 'استدراج عروض أسعار', 'مناقصة'];

  const TABS = [
    ['overview', '📊 لوحة الإمداد والمخازن'],
    ['stock', '🏭 المستودعات والأصناف والجرد'],
    ['cycle', '🛒 دورة الشراء وأوامر التوريد'],
    ['movements', '📦 الحركة المخزنية (إدخال/صرف)'],
    ['isreq', '📋 طلبات صرف المواد والمرتجعات'],
    ['reports', '📈 تقارير المخازن'],
    ['assets', '🏷️ سجل الأصول الثابتة والعهد'],
    ['suppliers', '🤝 الموردون المعتمدون'],
    ['quotes', '💲 عروض الأسعار وتقييم المورّدين']
  ];

  /* ترقيم الصفحات من الخادم: الجداول الكبيرة تُجلب صفحةً صفحة مع العدد الكلي، فلا يختفي ما بعد الحد */
  const PAGE_SIZE = 100;
  P.pg = P.pg || {}; P.tot = P.tot || {};
  const withPg = (url, key) => `${url}${url.includes('?') ? '&' : '?'}page=${P.pg[key] || 1}&size=${PAGE_SIZE}`;
  const keepTot = (key, res) => { P.tot[key] = Number(res.total ?? 0); return res; };
  const pager = (key) => {
    const total = P.tot[key] || 0, pages = Math.max(1, Math.ceil(total / PAGE_SIZE)), cur = Math.min(P.pg[key] || 1, pages);
    if (pages <= 1) return total > 0 ? `<div class="small muted" style="margin-top:6px">${num(total)} سجل</div>` : '';
    return `<div class="spread small" style="margin-top:8px;gap:8px;flex-wrap:wrap"><span>${num(total)} سجل · صفحة ${num(cur)} من ${num(pages)}</span>
      <span style="display:flex;gap:4px"><button class="btn sm" data-act="proc-page" data-k="${key}" data-p="1" ${cur === 1 ? 'disabled' : ''}>الأولى</button><button class="btn sm" data-act="proc-page" data-k="${key}" data-p="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>السابقة</button>
      <button class="btn sm" data-act="proc-page" data-k="${key}" data-p="${cur + 1}" ${cur === pages ? 'disabled' : ''}>التالية</button><button class="btn sm" data-act="proc-page" data-k="${key}" data-p="${pages}" ${cur === pages ? 'disabled' : ''}>الأخيرة</button></span></div>`;
  };

  async function loadTab() {
    if (UA.procTab) { P.tab = UA.procTab; UA.procTab = null; }   // دخول من go('quotations')
    if (!can('procurement:read') && !['cycle', 'isreq'].includes(P.tab)) P.tab = 'cycle';   // مقدّم الطلب: طلبات الشراء وطلبات الصرف فقط
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
        api('GET', withPg('/api/procurement/items?' + qs.toString(), 'items')).then((x) => keepTot('items', x))
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
        api('GET', withPg('/api/procurement/requests' + (P.reqStatusFilter ? `?status=${P.reqStatusFilter}` : ''), 'requests')).then((x) => keepTot('requests', x)),
        api('GET', withPg('/api/procurement/orders' + (P.ordStatusFilter ? `?status=${P.ordStatusFilter}` : ''), 'orders')).then((x) => keepTot('orders', x)),
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/items'),
        api('GET', '/api/procurement/suppliers')
      ]);
      P.requests = rq.requests;
      P.orders = or.orders;
      P.warehouses = w.warehouses;
      P.items = it.items;
      P.suppliers = s.suppliers;
    } else if (t === 'reports') {
      P.rep = P.rep || { kind: 'stagnant', days: 180, from: '', to: '' };
      const q = new URLSearchParams(); if (P.rep.days) q.set('days', P.rep.days); if (P.rep.from) q.set('from', P.rep.from); if (P.rep.to) q.set('to', P.rep.to);
      P.repData = await api('GET', `/api/procurement/reports/${P.rep.kind}?${q.toString()}`);
    } else if (t === 'isreq') {
      const [rq, w, it, rt] = await Promise.all([
        api('GET', '/api/procurement/issue-requests'),
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/items'),
        can('procurement:read') || can('procurement:stock') ? api('GET', '/api/procurement/returns') : { returns: [] }
      ]);
      P.isreqs = rq.requests; P.warehouses = w.warehouses; P.items = it.items; P.returns = rt.returns;
    } else if (t === 'movements') {
      const [rc, is, or, w, it, tr] = await Promise.all([
        api('GET', withPg('/api/procurement/receipts', 'receipts')).then((x) => keepTot('receipts', x)),
        api('GET', withPg('/api/procurement/issues', 'issues')).then((x) => keepTot('issues', x)),
        api('GET', '/api/procurement/orders?status=ordered'),
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/items'),
        api('GET', '/api/procurement/transfers')
      ]);
      P.receipts = rc.receipts;
      P.issues = is.issues;
      P.transfers = tr.transfers; P.inTransit = tr.inTransit;
      P.orders = or.orders;
      P.warehouses = w.warehouses;
      P.items = it.items;
    } else if (t === 'assets') {
      const qs = new URLSearchParams();
      if (P.assetFilter.q) qs.set('q', P.assetFilter.q);
      if (P.assetFilter.status) qs.set('status', P.assetFilter.status);
      if (P.assetFilter.warehouse) qs.set('warehouse', P.assetFilter.warehouse);
      const [a, w, s] = await Promise.all([
        api('GET', withPg('/api/procurement/assets?' + qs.toString(), 'assets')).then((x) => keepTot('assets', x)),
        api('GET', '/api/procurement/warehouses'),
        api('GET', '/api/procurement/suppliers')
      ]);
      P.assets = a.assets;
      P.warehouses = w.warehouses;
      P.suppliers = s.suppliers;
    } else if (t === 'suppliers') {
      const [s, or] = await Promise.all([
        api('GET', withPg('/api/procurement/suppliers' + (P.supQuery ? `?q=${encodeURIComponent(P.supQuery)}` : ''), 'suppliers')).then((x) => keepTot('suppliers', x)),
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
                <button class="btn sm dan" data-act="proc-del" data-kind="warehouses" data-id="${w.id}" data-name="${esc(w.name)}">حذف</button>
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
            <button class="btn sm" data-act="proc-stock-at">📅 الرصيد بتاريخ</button>
            <button class="btn sm" data-act="proc-cats">🗂️ التصنيفات</button>
            <button class="btn sm" data-act="proc-units">📏 الوحدات</button>
            <button class="btn sm" data-act="proc-gl-rec">🧾 مطابقة المخزون مع الحسابات</button>
            ${can('procurement:manage') ? `<button class="btn pri sm" data-act="proc-new-item">+ تعريف صنف جديد</button>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto auto;gap:8px;margin-bottom:12px;align-items:end" class="filter-bar">
          <div><label style="font-size:11px">بحث بالرمز أو الاسم</label><span style="display:flex;gap:4px"><input id="pi-filter-q" value="${esc(P.itemFilter.q)}" placeholder="ابحث عن صنف أو رمز أو امسح QR..."><button class="btn sm" type="button" data-act="proc-qr-scan" data-target="pi-filter-q" title="قراءة رمز QR بالكاميرا">📷</button></span></div>
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
              <td><b style="font-size:14px;color:${x.low ? '#8A6A1B' : '#10211D'}">${num(x.qtyOnHand)}</b>${(x.stocks || []).length > 1 || ((x.stocks || [])[0] && Number(x.stocks[0].warehouseId) !== Number(x.warehouseId)) ? `<div class="small">${x.stocks.map((st) => `${esc(st.name)}: ${num(st.qty)}`).join(' · ')}</div>` : ''}</td>
              <td>${num(x.minStock)}</td>
              <td>${money(x.avgCost)}</td>
              <td><b>${money(lineVal)}</b></td>
              <td>${x.low ? '<span class="badge b-warn">⚠️ نقص مخزون</span>' : '<span class="badge b-ok">متوفر</span>'}</td>
              <td style="white-space:nowrap">
                <button class="btn sm" data-act="proc-item-card" data-id="${x.id}" title="بطاقة الصنف: كل حركاته والرصيد بعد كل حركة">📒 بطاقة</button>
                ${can('procurement:adjust') ? `<button class="btn sm" data-act="proc-adjust-item" data-id="${x.id}" title="تسوية جرد فعلي">⚖️ جرد</button>` : ''}
                ${can('procurement:manage') ? `<button class="btn sm" data-act="proc-edit-item" data-id="${x.id}">تعديل</button>` : ''}
                ${can('procurement:manage') && !Number(x.qtyOnHand) ? `<button class="btn sm dan" data-act="proc-del" data-kind="items" data-id="${x.id}" data-name="${esc(x.name)}">حذف</button>` : ''}
                ${x.qrCode ? `<button class="btn sm" data-act="proc-qr-show" data-id="${x.id}" title="${esc(x.qrCode)}">▦ QR</button>` : can('procurement:manage') ? `<button class="btn sm" data-act="proc-qr-gen" data-id="${x.id}">▦ توليد QR</button>` : ''}
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="11" class="empty">لا توجد أصناف مطابقة للبحث</td></tr>'}
        </tbody></table></div>${pager('items')}
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
                <td>${stBadge(REQ_STATUS, r.status)}${r.status === 'draft' && r.returnedAt ? ` <span class="badge b-warn" title="${esc(r.returnReason || '')}">معاد للتعديل</span><div class="small">${esc(r.returnReason || '')}</div>` : ''}${r.stage ? `<div class="small">بانتظار: ${esc(r.stage)}</div>` : ''}</td>
                <td style="white-space:nowrap">
                  <button class="btn sm" data-act="proc-view-req" data-id="${r.id}">التفاصيل</button> <button type="button" class="btn sm" data-act="recthread" data-m="proc_request" data-id="${r.id}">النقاش</button>
                  ${r.status === 'draft' && can('procurement:request') && (Number(r.requesterId) === Number(UA.S.me.id) || can('procurement:manage')) ? `<button class="btn pri sm" data-act="proc-sub-req" data-id="${r.id}">إرسال للاعتماد</button>` : ''}
                  ${r.status === 'pending' ? (r.stagePerm && can(r.stagePerm) && Number(r.requesterId) !== Number(UA.S.me.id) && !(r.approvedBy || []).includes(Number(UA.S.me.id)) ? `<button class="btn pri sm" data-act="proc-app-req" data-id="${r.id}" data-no="${esc(r.no)}" data-stage="${esc(r.stage || '')}">⚖️ قرار الاعتماد</button>` : '<span class="small muted">بانتظار طرف آخر</span>') : ''}
                  ${r.status === 'draft' && (Number(r.requesterId) === Number(UA.S.me.id) || can('procurement:manage')) ? `<button class="btn sm" data-act="proc-edit-req" data-id="${r.id}">✏️ تعديل</button>` : ''}
                  ${['draft', 'pending'].includes(r.status) && (Number(r.requesterId) === Number(UA.S.me.id) || can('procurement:manage')) ? `<button class="btn dan sm" data-act="proc-can-req" data-id="${r.id}">إلغاء الطلب</button>` : ''}
                  ${r.status === 'approved' && can('procurement:manage') ? `<button class="btn pri sm" data-act="proc-req-to-po" data-id="${r.id}">🚚 تحويل لأمر توريد</button>` : ''}
                </td>
              </tr>`;
            }).join('') || '<tr><td colspan="7" class="empty">لا توجد طلبات شراء</td></tr>'}
          </tbody></table></div>${pager('requests')}
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
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم الأمر</th><th>طلب الشراء المرتبط</th><th>المورد</th><th>إجمالي الأمر</th><th>الحالة</th><th>تاريخ الإصدار</th><th>إجراءات</th></tr></thead><tbody>
            ${P.orders.map((o) => `<tr>
              <td><code>${esc(o.no)}</code></td>
              <td>${o.requestNo ? `<code>${esc(o.requestNo)}</code>` : `<span class="badge b-warn" title="${esc(o.directReason || '')}">مباشر (استثناء)</span>`}</td>
              <td><b>${esc(o.supplierName)}</b>${o.supplierApproved === false ? ' <span class="badge b-warn">غير معتمد</span>' : ''}</td>
              <td><b>${money(o.totalAmount)}</b></td>
              <td>${stBadge(ORD_STATUS, o.status)}${o.status === 'ordered' && (o.lines || []).some((l) => l.receivedQty > 0) ? ' <span class="badge b-info">مستلم جزئياً</span>' : ''}</td>
              <td>${fmt(o.createdAt)}</td>
              <td style="white-space:nowrap">
                <button class="btn sm" data-act="proc-view-ord" data-id="${o.id}">عرض / طباعة</button>
                ${o.status === 'draft' && can('procurement:manage') ? (!o.requestId && Number(o.createdBy) === Number(UA.S.me.id) ? '<span class="small muted">بانتظار اعتماد شخص آخر</span>' : `<button class="btn pri sm" data-act="proc-send-ord" data-id="${o.id}">📤 اعتماد وإرسال للمورد</button>`) : ''}
                ${o.status === 'ordered' && can('procurement:manage') ? `<button class="btn sm" data-act="proc-send-ord" data-id="${o.id}">📤 إرسال للمورد</button>` : ''}
                ${o.status === 'ordered' && can('procurement:stock') ? (Number(o.createdBy) === Number(UA.S.me.id) ? '<span class="small muted">يستلمه أمين المستودع</span>' : `<button class="btn pri sm" data-act="proc-rcv-from-ord" data-id="${o.id}">📥 استلام مخزني</button>`) : ''}
                ${['draft', 'ordered'].includes(o.status) && can('procurement:manage') && !(o.lines || []).some((l) => l.receivedQty > 0) ? `<button class="btn dan sm" data-act="proc-can-ord" data-id="${o.id}">إلغاء</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">لا توجد أوامر توريد</td></tr>'}
          </tbody></table></div>${pager('orders')}
        </div>
      `}`;
  }

  const ISR_BADGE = { pending: 'b-warn', approved: 'b-info', partial: 'b-info', issued: 'b-ok', received: 'b-ok', rejected: 'b-err', cancelled: 'b-mut' };
  function viewIssueRequests() {
    const me = Number(UA.S.me.id);
    return `
      <div class="card">
        <div class="spread" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div><h3 style="margin:0">📋 طلبات صرف المواد من المستودع (${num((P.isreqs || []).length)})</h3>
          <p class="small" style="margin:2px 0 0">يقدّم القسم الطلب ← يعتمده رئيس الوحدة ← يصرفه أمين المستودع ← يؤكد القسم الاستلام.</p></div>
          ${can('procurement:request') ? '<button class="btn pri sm" data-act="proc-new-isreq">+ طلب صرف مواد</button>' : ''}
        </div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرقم</th><th>القسم ومقدّم الطلب</th><th>المستودع</th><th>المواد (المطلوب / المصروف)</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
          ${(P.isreqs || []).map((r) => `<tr>
            <td><code>${esc(r.no)}</code><div class="small">${fmt(r.createdAt)}</div></td>
            <td><b>${esc(r.department)}</b><div class="small">${esc(r.requesterName)}</div>${r.purpose ? `<div class="small muted">${esc(r.purpose)}</div>` : ''}</td>
            <td>${esc(r.warehouseName)}</td>
            <td>${r.lines.map((l) => `<span class="badge b-info" style="margin-inline-end:4px">${esc(l.name)}: ${num(l.qty)} / ${num(l.issuedQty)}</span>`).join(' ')}</td>
            <td><span class="badge ${ISR_BADGE[r.status] || 'b-mut'}">${esc(r.statusLabel)}</span>${r.decisionNote ? `<div class="small">${esc(r.decisionNote)}</div>` : ''}${r.receivedAt ? `<div class="small">استلمه: ${esc(r.receivedBy)}</div>` : ''}</td>
            <td style="white-space:nowrap">
              ${r.status === 'pending' && r.requesterId !== me && (can('procurement:issue_approve') || can('procurement:manage')) ? `<button class="btn pri sm" data-act="proc-isreq-dec" data-dec="approve" data-id="${r.id}">✓ اعتماد</button> <button class="btn dan sm" data-act="proc-isreq-dec" data-dec="reject" data-id="${r.id}">✕ رفض</button>` : ''}
              ${['approved', 'partial'].includes(r.status) && can('procurement:stock') ? `<button class="btn pri sm" data-act="proc-isreq-issue" data-id="${r.id}">📤 صرف</button>` : ''}
              ${['issued', 'partial'].includes(r.status) && (r.requesterId === me || can('procurement:issue_approve')) ? `<button class="btn pri sm" data-act="proc-isreq-confirm" data-id="${r.id}">✍️ تأكيد الاستلام</button>` : ''}
              ${['pending', 'approved'].includes(r.status) && (r.requesterId === me || can('procurement:manage')) ? `<button class="btn sm" data-act="proc-isreq-cancel" data-id="${r.id}">إلغاء</button>` : ''}
            </td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا طلبات صرف</td></tr>'}
        </tbody></table></div>
      </div>
      ${can('procurement:read') || can('procurement:stock') ? `
      <div class="card" style="margin-top:14px">
        <div class="spread" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <h3 style="margin:0">↩️ المرتجعات إلى المستودع (${num((P.returns || []).length)})</h3>
          ${can('procurement:stock') ? '<button class="btn sm" data-act="proc-new-return">+ تسجيل مرتجع</button>' : ''}
        </div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرقم</th><th>من القسم</th><th>إلى المستودع</th><th>إذن الصرف</th><th>المواد</th><th>السبب</th><th>القيد</th></tr></thead><tbody>
          ${(P.returns || []).map((r) => `<tr><td><code>${esc(r.no)}</code><div class="small">${fmt(r.at)}</div></td><td>${esc(r.department)}${r.returnedBy ? `<div class="small">${esc(r.returnedBy)}</div>` : ''}</td><td>${esc(r.warehouseName)}</td><td>${r.issueNo ? `<code>${esc(r.issueNo)}</code>` : '—'}</td>
            <td>${r.lines.map((l) => `<span class="badge b-ok" style="margin-inline-end:4px">${esc(l.name)} (${num(l.qty)})</span>`).join(' ')}</td><td>${esc(r.reason)}</td>
            <td>${r.journalEntryId ? '✓' : r.journalError ? `<span class="badge b-warn" title="${esc(r.journalError)}">بلا قيد</span>` : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا مرتجعات</td></tr>'}
        </tbody></table></div>
      </div>` : ''}`;
  }

  const REPORTS = { stagnant: 'الأصناف الراكدة', consumption: 'الاستهلاك حسب القسم', delayed: 'الأوامر المتأخرة', suppliers: 'أداء الموردين' };
  function viewReports() {
    const r = P.rep, d = P.repData || {}, days = r.kind === 'stagnant' || r.kind === 'delayed', period = r.kind === 'consumption' || r.kind === 'suppliers';
    let body = '';
    if (r.kind === 'stagnant') body = `<p class="small">أصناف لها رصيد ولم يُصرف أو يُحوَّل منها شيء منذ ${num(d.days)} يوماً. القيمة المجمّدة: <b>${money(d.totalValue)}</b></p>
      <table class="tbl"><thead><tr><th>الرمز</th><th>الصنف</th><th>الرصيد</th><th>القيمة</th><th>آخر صرف</th><th>آخر استلام</th><th>أيام الركود</th></tr></thead><tbody>
      ${(d.items || []).map((x) => `<tr><td><code>${esc(x.code)}</code></td><td>${esc(x.name)}</td><td>${num(x.qty)} ${esc(x.unit || '')}</td><td>${money(x.value)}</td><td>${x.lastOut ? fmt(x.lastOut) : 'لم يُصرف'}</td><td>${x.lastIn ? fmt(x.lastIn) : '—'}</td><td>${x.idleDays ?? '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا أصناف راكدة</td></tr>'}</tbody></table>`;
    if (r.kind === 'consumption') body = `<p class="small">المصروف بمتوسط تكلفته ناقص المرتجع، من ${esc(d.from)} إلى ${esc(d.to)}. الإجمالي: <b>${money(d.totalValue)}</b></p>
      <table class="tbl"><thead><tr><th>القسم</th><th>عدد المواد</th><th>القيمة</th></tr></thead><tbody>${(d.departments || []).map((x) => `<tr><td><b>${esc(x.department)}</b></td><td>${num(x.items)}</td><td>${money(x.value)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">لا صرف في الفترة</td></tr>'}</tbody></table>
      <h4>التفصيل</h4><table class="tbl"><thead><tr><th>القسم</th><th>المادة</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>${(d.lines || []).map((x) => `<tr><td>${esc(x.department)}</td><td><code>${esc(x.code)}</code> ${esc(x.name)}</td><td>${num(x.qty)} ${esc(x.unit || '')}</td><td>${money(x.value)}</td></tr>`).join('')}</tbody></table>`;
    if (r.kind === 'delayed') body = `<p class="small">أوامر مرسلة تجاوزت تاريخ التوصيل المطلوب، أو مضى على إرسالها أكثر من ${num(d.days)} يوماً دون اكتمال الاستلام.</p>
      <table class="tbl"><thead><tr><th>الأمر</th><th>المورد</th><th>القيمة</th><th>تاريخ التوصيل</th><th>تأخر (يوم)</th><th>عمر الأمر (يوم)</th><th>المستلم</th></tr></thead><tbody>
      ${(d.orders || []).map((x) => `<tr><td><code>${esc(x.no)}</code></td><td>${esc(x.supplier)}</td><td>${money(x.total)}</td><td>${esc(x.deliveryDay || '—')}</td><td>${x.lateDays ?? '—'}</td><td>${x.ageDays ?? '—'}</td><td>${num(x.receivedPct)}%</td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا أوامر متأخرة</td></tr>'}</tbody></table>`;
    if (r.kind === 'suppliers') body = `<p class="small">من ${esc(d.from)} إلى ${esc(d.to)}. مدة التوريد من الإرسال إلى اكتمال الاستلام؛ الالتزام بالموعد من الأوامر ذات تاريخ توصيل.</p>
      <table class="tbl"><thead><tr><th>المورد</th><th>الأوامر</th><th>الحجم</th><th>المكتملة</th><th>متوسط مدة التوريد (يوم)</th><th>الالتزام بالموعد</th><th>استلامات غير مطابقة</th><th>التقييم</th></tr></thead><tbody>
      ${(d.suppliers || []).map((x) => `<tr><td><b>${esc(x.name)}</b> <span class="small">${esc(x.code)}</span></td><td>${num(x.orders)}</td><td>${money(x.volume)}</td><td>${num(x.completed)}</td><td>${x.avgLeadDays ?? '—'}</td><td>${x.onTimePct == null ? '—' : `${x.onTimePct}%`}</td><td>${num(x.nonCompliant)}</td><td>${x.rating ? `${x.rating}/5 (${num(x.ratings)})` : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">لا أوامر في الفترة</td></tr>'}</tbody></table>`;
    return `<div class="card" data-doc-title="تقرير المخازن: ${esc(REPORTS[r.kind])}" data-doc-dept="المشتريات والمخازن" data-doc-signers="أمين المستودع|مدير المشتريات">
      <div class="spread no-print" data-print-skip style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <div style="display:flex;gap:4px;flex-wrap:wrap">${Object.entries(REPORTS).map(([k, l]) => `<button class="btn sm ${r.kind === k ? 'pri' : ''}" data-act="proc-rep" data-k="${k}">${esc(l)}</button>`).join('')}</div>
        <div style="display:flex;gap:6px;align-items:end;flex-wrap:wrap">
          ${days ? `<label class="small">أيام<input id="prep-days" type="number" min="1" step="1" value="${esc(r.days || (r.kind === 'delayed' ? 30 : 180))}" style="width:80px"></label>` : ''}
          ${period ? `<label class="small">من<input id="prep-from" type="date" value="${esc(r.from || '')}"></label><label class="small">إلى<input id="prep-to" type="date" value="${esc(r.to || '')}"></label>` : ''}
          <button class="btn sm" data-act="proc-rep-go">عرض</button><button class="btn sm" data-act="print">🖨️ طباعة</button>
        </div>
      </div>
      <h3 style="margin-top:0">📈 ${esc(REPORTS[r.kind])}</h3>
      <div class="tbl-wrap">${body}</div></div>`;
  }

  function viewMovements() {
    const isRcv = P.moveMode !== 'issues' && P.moveMode !== 'transfers', isTr = P.moveMode === 'transfers';
    return `
      <div class="card" style="margin-bottom:14px;padding:12px 16px">
        <div class="spread" style="flex-wrap:wrap;gap:10px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn ${isRcv ? 'pri' : ''}" data-act="proc-move-mode" data-mode="receipts">📥 مذكرات الإدخال والاستلام المخزني (${num(P.receipts.length)})</button>
            <button class="btn ${P.moveMode === 'issues' ? 'pri' : ''}" data-act="proc-move-mode" data-mode="issues">📤 أذونات الصرف والإخراج المخزني (${num(P.issues.length)})</button>
            <button class="btn ${isTr ? 'pri' : ''}" data-act="proc-move-mode" data-mode="transfers">🔁 التحويل بين المستودعات (${num((P.transfers || []).length)})${P.inTransit && P.inTransit.count ? ` · قيد النقل ${num(P.inTransit.count)}` : ''}</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('procurement:stock') ? `
              <button class="btn pri sm" data-act="proc-new-receipt">+ تسجيل مذكرة استلام توريد</button>
              <button class="btn sm" data-act="proc-new-issue">+ تحرير إذن صرف مخزني</button>
              <button class="btn sm" data-act="proc-new-transfer">+ سند تحويل بين مستودعين</button>
            ` : ''}
          </div>
        </div>
      </div>

      ${isTr ? `
        <div class="card">
          <h3 style="margin-top:0">🔁 سندات التحويل بين المستودعات</h3>
          ${P.inTransit && P.inTransit.count ? `<p class="small" style="margin-top:0">قيد النقل الآن: ${num(P.inTransit.count)} سند بقيمة ${money(P.inTransit.value)} (أُخرجت من المرسِل ولم تُستلم بعد).</p>` : ''}
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم السند</th><th>من</th><th>إلى</th><th>المواد</th><th>الحالة</th><th>أرسله</th><th>استلمه</th><th>إجراءات</th></tr></thead><tbody>
            ${(P.transfers || []).map((t) => `<tr>
              <td><code>${esc(t.no)}</code></td><td>${esc(t.fromName)}</td><td>${esc(t.toName)}</td>
              <td>${t.lines.map((l) => `<span class="badge b-info" style="margin-inline-end:4px">${esc(l.name)} (${num(l.qty)})</span>`).join(' ')}</td>
              <td>${t.status === 'sent' ? '<span class="badge b-warn">قيد النقل</span>' : t.status === 'received' ? '<span class="badge b-ok">مستلم</span>' : `<span class="badge b-mut" title="${esc(t.receiveNote)}">ملغى</span>`}</td>
              <td>${esc(t.sentBy)}<div class="small">${fmt(t.sentAt)}</div></td>
              <td>${t.receivedAt ? `${esc(t.receivedBy)}<div class="small">${fmt(t.receivedAt)}</div>` : '—'}</td>
              <td style="white-space:nowrap">${t.status === 'sent' && can('procurement:stock') ? `${Number(t.sentById) === Number(UA.S.me.id) ? '<span class="small muted">يستلمه أمين المستودع المستلِم</span>' : `<button class="btn pri sm" data-act="proc-tr-receive" data-id="${t.id}">📥 استلام</button>`} <button class="btn dan sm" data-act="proc-tr-cancel" data-id="${t.id}">إلغاء</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty">لا سندات تحويل</td></tr>'}
          </tbody></table></div>
        </div>
      ` : isRcv ? `
        <div class="card">
          <h3 style="margin-top:0">📥 سجل مذكرات الاستلام والفحص المخزني (${num(P.receipts.length)})</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم المذكرة</th><th>أمر التوريد (PO)</th><th>المورد</th><th>الأصناف المستلمة</th><th>التاريخ</th><th>ملاحظات الفحص</th><th>طباعة</th></tr></thead><tbody>
            ${P.receipts.map((r) => `<tr>
              <td><code>RCV-${String(r.id).padStart(4, '0')}</code>${r.reversedAt ? ` <span class="pill p-rejected" title="${esc(fmt(r.reversedAt))}">معكوسة</span>` : ''}${r.journalError && !r.reversedAt ? ` <span class="badge b-warn" title="${esc(r.journalError)}">بلا قيد محاسبي</span>${can('finance:post') ? ` <button class="btn sm" data-act="proc-rcv-journal" data-id="${r.id}">ترحيل القيد</button>` : ''}` : ''}</td>
              <td><code>${esc(r.orderNo)}</code></td>
              <td><b>${esc(r.supplierName)}</b></td>
              <td>${(r.lines || []).map((l) => `<span class="badge b-ok" style="margin-inline-end:4px">${esc(l.itemName)}: ${num(l.qty)} × ${money(l.unitCost)}</span>`).join(' ')}</td>
              <td>${fmt(r.receivedAt)}</td>
              <td>${esc(r.note || '—')}</td>
              <td><button class="btn sm" data-act="proc-view-rcv" data-id="${r.id}">عرض / طباعة</button></td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">لا توجد مذكرات استلام مسجلة</td></tr>'}
          </tbody></table></div>${pager('receipts')}
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
          </tbody></table></div>${pager('issues')}
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
            <div class="mut" style="font-size:12px">التكلفة: <b>${money(totalCost)}</b> · مجمع الإهلاك: <b>${money(P.assets.reduce((s, a) => s + Number(a.accumulated || 0), 0))}</b> · القيمة الدفترية: <b>${money(P.assets.filter((a) => a.status !== 'disposed').reduce((s, a) => s + Number(a.bookValue || 0), 0))}</b></div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${can('procurement:assets') ? `<button class="btn sm" data-act="proc-dep-run">📉 تشغيل إهلاك شهر</button>` : ''}
            <button class="btn sm" data-act="proc-unchecked">🔍 أصول لم تُجرد</button>
            ${can('procurement:assets') ? `<button class="btn pri sm" data-act="proc-new-asset">+ تسجيل أصل ثابت جديد</button>` : ''}
          </div>
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
            <td><b>${money(a.cost)}</b>${a.accumulated ? `<div class="small">دفترية: ${money(a.bookValue)}</div>` : ''}</td>
            <td>${stBadge(ASSET_STATUS, a.status)}${a.disposalRequested && a.status !== 'disposed' ? `<div><span class="badge b-warn" title="${esc(a.disposalReason)}">طلب إتلاف</span></div>` : ''}</td>
            <td style="white-space:nowrap">
              ${UA.rowPrintBtn('سند عهدة أصل ثابت', 'المشتريات والمخازن', 'أمين المستودع|مستلم العهدة|مدير الشؤون الإدارية')}
              <button class="btn sm" data-act="proc-asset-hist" data-id="${a.id}">📜 السجل</button>
              ${a.disposalRequested && a.status !== 'disposed' && can('procurement:manage') && Number(a.disposalRequestedBy) !== Number(UA.S.me.id) ? `<button class="btn dan sm" data-act="proc-dispose-dec" data-ok="1" data-id="${a.id}">اعتماد الإتلاف</button> <button class="btn sm" data-act="proc-dispose-dec" data-ok="0" data-id="${a.id}">رفض الإتلاف</button>` : ''}
              ${a.status !== 'disposed' && (can('procurement:assets') || can('procurement:stock')) ? `<button class="btn sm" data-act="proc-asset-verify" data-id="${a.id}">✓ جرد</button>` : ''}
              ${can('procurement:assets') ? `
                <button class="btn sm" data-act="proc-move-asset" data-id="${a.id}">🔄 نقل عهدة / حالة</button>
                <button class="btn sm" data-act="proc-edit-asset" data-id="${a.id}">تعديل</button>
                ${a.status !== 'in_use' ? `<button class="btn dan sm" data-act="proc-del-asset" data-id="${a.id}">حذف</button>` : ''}
              ` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="9" class="empty">لا توجد أصول ثابتة مطابقة</td></tr>'}
        </tbody></table></div>${pager('assets')}
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
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>اسم المورد / الشركة</th><th>الرقم الضريبي</th><th>الهاتف والبريد</th><th>العنوان</th><th>أوامر التوريد</th><th>إجمالي التعاملات</th><th>التقييم</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>
          ${P.suppliers.map((s) => {
            const supOrders = (P.orders || []).filter((o) => o.supplierId === s.id && o.status !== 'cancelled');
            const supVol = supOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
            return `<tr>
              <td><code>${esc(s.code)}</code></td>
              <td><b>${esc(s.name)}</b>${s.approved === false ? ' <span class="badge b-warn">غير معتمد</span>' : ''}</td>
              <td><code>${esc(s.taxNo || '—')}</code></td>
              <td>${esc(s.phone || '—')}${s.email ? `<div class="mut" style="font-size:11px">${esc(s.email)}</div>` : ''}</td>
              <td>${esc(s.address || '—')}</td>
              <td><span class="badge b-info">${num(supOrders.length)} أوامر</span></td>
              <td><b>${money(supVol)}</b></td>
              <td>${s.rating ? `<b>${s.rating}</b>/5 <span class="small">(${num(s.ratings)})</span>` : '<span class="small muted">لم يُقيَّم</span>'}</td>
              <td><span class="badge ${s.active ? 'b-ok' : 'b-mut'}">${s.active ? 'فعّال' : 'موقوف'}</span></td>
              <td style="white-space:nowrap">
                ${can('procurement:manage') ? `
                  ${s.approved === false ? `<button class="btn pri sm" data-act="proc-approve-sup" data-id="${s.id}">✓ اعتماد</button>` : ''}
                  <button class="btn sm" data-act="proc-edit-sup" data-id="${s.id}">تعديل</button>
                  <button class="btn sm" data-act="proc-toggle-sup" data-id="${s.id}" data-on="${s.active ? 0 : 1}">${s.active ? 'إيقاف' : 'تفعيل'}</button>
                  ${supOrders.length ? '' : `<button class="btn sm dan" data-act="proc-del" data-kind="suppliers" data-id="${s.id}" data-name="${esc(s.name)}">حذف</button>`}
                ` : ''}
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="10" class="empty">لا يوجد موردون مسجلون</td></tr>'}
        </tbody></table></div>${pager('suppliers')}
      </div>`;
  }

  function renderBody() {
    if (P.tab === 'overview') return viewOverview();
    if (P.tab === 'stock') return viewStock();
    if (P.tab === 'cycle') return viewCycle();
    if (P.tab === 'movements') return viewMovements();
    if (P.tab === 'isreq') return viewIssueRequests();
    if (P.tab === 'reports') return viewReports();
    if (P.tab === 'assets') return viewAssets();
    if (P.tab === 'suppliers') return viewSuppliers();
    if (P.tab === 'quotes') return UA.views.quotations ? UA.views.quotations() : '';
    return '';
  }

  async function mount(el) {
    await loadTab();
    el.innerHTML = `
      <div class="sub-tabs" style="margin-bottom:14px">
        ${TABS.filter(([k]) => can('procurement:read') || ['cycle', 'isreq'].includes(k)).map(([k, l]) => `<button class="tab ${P.tab === k ? 'on' : ''}" data-act="proc-tab" data-t="${k}" aria-pressed="${P.tab === k}">${l}</button>`).join('')}
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

  /* بنود نافذتي الطلب والأمر: اختيار الصنف يملأ الوصف والوحدة والسعر، والإجمالي يُحسب لحظياً */
  const lineTotal = (box, qSel, cSel, out) => {
    const t = [...document.querySelectorAll(`${box} > div:not(.pr-head):not(.po-head)`)].reduce((s, r) => s + Number(r.querySelector(qSel)?.value || 0) * Number(r.querySelector(cSel)?.value || 0), 0);
    const el = document.getElementById(out); if (el) el.textContent = `الإجمالي التقديري: ${num(t)}`;
  };
  const recalc = () => { lineTotal('#pr-lines', '.pr-qty', '.pr-cost', 'pr-total'); lineTotal('#po-lines', '.po-qty', '.po-cost', 'po-total'); };
  document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('#pr-lines, #po-lines')) recalc(); });
  document.addEventListener('change', (e) => {
    const sel = e.target;
    if (sel.matches && sel.matches('.po-kind')) { if (sel.value === 'service' || sel.value === 'asset') { const it = sel.closest('.po-line')?.querySelector('.po-item'); if (it) it.value = ''; } return; }
    if (!sel.matches || !sel.matches('.pr-item, .po-item')) return;
    const row = sel.closest('.pr-line, .po-line'), it = P.items.find((x) => String(x.id) === sel.value);
    if (!row || !it) { recalc(); return; }
    const pre = sel.classList.contains('pr-item') ? 'pr' : 'po';
    const d = row.querySelector(pre === 'pr' ? '.pr-ldesc' : '.po-desc'), u = row.querySelector(`.${pre}-unit`), c = row.querySelector(`.${pre}-cost`);
    if (d && !d.value.trim()) d.value = it.name;
    if (u && !u.value.trim()) u.value = it.unit || '';
    if (c && !(Number(c.value) > 0) && Number(it.avgCost) > 0) c.value = it.avgCost;
    const k = row.querySelector('.po-kind'); if (k) k.value = 'stock';
    recalc();
  });

  // خيارات المواد الموجودة في مستودع برصيدها فيه
  const whQtyOf = (it, whId) => Number(((it.stocks || []).find((s) => Number(s.warehouseId) === Number(whId)) || {}).qty || 0);
  const whItemOptions = (whId) => {
    const list = P.items.filter((i) => whQtyOf(i, whId) > 0);
    return list.length ? list.map((i) => `<option value="${i.id}">${esc(i.code)} · ${esc(i.name)} (المتاح هنا: ${num(whQtyOf(i, whId))} ${esc(i.unit || '')})</option>`).join('') : '<option value="">— لا مواد برصيد في هذا المستودع —</option>';
  };

  /* تعبئة نافذة الطلب بمسودة قائمة (تعديل أو طلب نواقص مولّد) */
  function fillReqForm(r) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    const h = document.querySelector('.modal h2, .modal h3, .fk-title'); if (h) h.textContent = `✏️ تعديل طلب الشراء ${r.no}`;
    set('pr-title', r.title); set('pr-wh', r.warehouseId || ''); set('pr-dept', r.department); set('pr-job', r.jobTitle); set('pr-mgr', r.directManager);
    set('pr-thr', r.purchaseThreshold); set('pr-need', r.needDay); set('pr-words', r.amountWords); set('pr-sup', r.supplierName); set('pr-desc', r.description);
    const box = document.getElementById('pr-lines'), first = box && box.querySelector('.pr-line');
    if (!first) return;
    (r.lines || []).forEach((l, i) => {
      const row = i === 0 ? first : box.appendChild(first.cloneNode(true));
      const v = (sel, val) => { const el = row.querySelector(sel); if (el) el.value = val ?? ''; };
      v('.pr-item', l.itemId || ''); v('.pr-ldesc', l.description); v('.pr-specs', l.specs); v('.pr-budget', l.budgetCode); v('.pr-unit', l.unit); v('.pr-qty', l.qty); v('.pr-cost', l.estCost);
    });
    if (r.returnReason) box.insertAdjacentHTML('beforebegin', `<p class="badge b-warn" style="display:block;margin:0 0 6px">أُعيد للتعديل: ${esc(r.returnReason)}</p>`);
    recalc();
  }

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
      else if (act === 'proc-filter-items') { P.pg.items = 1;
        P.itemFilter.q = document.getElementById('pi-filter-q')?.value.trim() || '';
        P.itemFilter.category = document.getElementById('pi-filter-cat')?.value || '';
        P.itemFilter.low = document.getElementById('pi-filter-low')?.value || '';
        await refresh();
      }
      else if (act === 'proc-reset-items') { P.pg.items = 1;
        P.itemFilter = { q: '', warehouse: '', category: '', low: '' };
        await refresh();
      }
      else if (act === 'proc-cycle-mode') { P.cycleMode = b.dataset.mode; await refresh(); }
      else if (act === 'proc-req-filter') { P.pg.requests = 1; P.reqStatusFilter = b.dataset.st || ''; await refresh(); }
      else if (act === 'proc-ord-filter') { P.pg.orders = 1; P.ordStatusFilter = b.dataset.st || ''; await refresh(); }
      else if (act === 'proc-move-mode') { P.moveMode = b.dataset.mode; await refresh(); }
      else if (act === 'proc-filter-assets') { P.pg.assets = 1;
        P.assetFilter.q = document.getElementById('pa-filter-q')?.value.trim() || '';
        P.assetFilter.status = document.getElementById('pa-filter-st')?.value || '';
        P.assetFilter.warehouse = document.getElementById('pa-filter-wh')?.value || '';
        await refresh();
      }
      else if (act === 'proc-reset-assets') { P.pg.assets = 1;
        P.assetFilter = { q: '', status: '', warehouse: '' };
        await refresh();
      }
      else if (act === 'proc-filter-sup') { P.pg.suppliers = 1;
        P.supQuery = document.getElementById('ps-filter-q')?.value.trim() || '';
        await refresh();
      }
      else if (act === 'proc-close-modal') { if (b.classList.contains('modal-bg') && e.target.closest('.modal')) return; closeModal(); }

      else if (act === 'proc-replenish-low') {
        const out = await api('POST', '/api/procurement/requests/replenish', {});
        if (!out.request) { toast(out.skipped && out.skipped.length ? `لا أصناف جديدة للطلب: ${out.skipped.slice(0, 3).join('، ')}` : 'لا توجد أصناف دون الحد الأدنى حالياً'); return; }
        toast(`أُنشئت مسودة طلب بـ ${out.request.lines.length} صنفاً${out.skipped.length ? ` (تُخطّي ${out.skipped.length})` : ''}؛ راجعها ثم أرسلها`);
        P.editReq = out.request; P.tab = 'cycle'; P.cycleMode = 'requests'; await refresh();
        const t = document.createElement('button'); t.dataset.act = 'proc-new-req'; t.hidden = true; document.body.appendChild(t); t.click(); t.remove();
      }
      else if (act === 'proc-new-wh' || act === 'proc-edit-wh') {
        const cur = act === 'proc-edit-wh' ? P.warehouses.find((x) => x.id === Number(b.dataset.id)) : null;
        const staff = (await api('GET', '/api/procurement/stock-staff').catch(() => ({ staff: [] }))).staff;
        showModal(`<h3>${cur ? 'تعديل بيانات المستودع' : 'إضافة مستودع جديد'}</h3>
          <div class="form-grid">
            <label>رمز المستودع<input id="pw-code" value="${esc(cur?.code || '')}" placeholder="WH-03"></label>
            <label>اسم المستودع<input id="pw-name" value="${esc(cur?.name || '')}" placeholder="مستودع الكليات العلمية"></label>
            <label style="grid-column:1/-1">الموقع الجغرافي / المبنى<input id="pw-loc" value="${esc(cur?.location || '')}" placeholder="مبنى الهندسة - الطابق الأرضي"></label>
            <label style="grid-column:1/-1">أمين المستودع<select id="pw-mgr" data-no-other="1"><option value="">— غير محدد —</option>${staff.map((u) => `<option value="${u.id}" ${Number(cur?.managerId) === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select><span class="small">من يملك صلاحية الاستلام والصرف.</span></label>
          </div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-wh" data-id="${cur?.id || ''}">حفظ المستودع</button></div>`);
      }
      else if (act === 'proc-save-wh') {
        const id = b.dataset.id;
        const body = { code: document.getElementById('pw-code').value, name: document.getElementById('pw-name').value, location: document.getElementById('pw-loc').value, managerId: Number(document.getElementById('pw-mgr')?.value) || null };
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
        P.units = (await api('GET', '/api/procurement/units')).units;
        const conv = cur ? (await api('GET', `/api/procurement/items/${cur.id}/units`)).units : [];
        showModal(`<h3>${cur ? 'تعديل بطاقة صنف مخزني' : 'تعريف صنف مخزني جديد'}</h3>
          <div class="form-grid">
            <label>رمز الصنف${cur ? '' : ' (اتركه فارغاً للترقيم التلقائي من التصنيف)'}<input id="pi-code" value="${esc(cur?.code || '')}" placeholder="تلقائي: CAT-IT-0001"></label>
            <label>اسم الصنف<input id="pi-name" value="${esc(cur?.name || '')}"></label>
            <label>التصنيف<select id="pi-cat"><option value="">— اختر —</option>${P.categories.map((c) => `<option value="${c.id}" ${cur?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label>المستودع الافتراضي<select id="pi-wh"><option value="">— اختر —</option>${P.warehouses.filter((w) => w.active).map((w) => `<option value="${w.id}" ${cur?.warehouseId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
            <label>وحدة التخزين<input id="pi-unit" list="pi-unit-list" value="${esc(cur?.unit || 'قطعة')}"><datalist id="pi-unit-list">${(P.units || []).filter((u) => u.active).map((u) => `<option value="${esc(u.name)}">${u.fractional ? 'تقبل الكسور' : 'عدد صحيح'}</option>`).join('')}</datalist></label>
            <label>الحد الأدنى للتنبيه (نقطة إعادة الطلب)<input id="pi-min" type="number" min="0" value="${cur?.minStock ?? 5}"></label>
            <label>الحد الأعلى للتخزين (0 = بلا حد)<input id="pi-max" type="number" min="0" value="${cur?.maxStock ?? 0}"></label>
            ${cur ? `<div style="grid-column:1/-1"><b class="small">تحويلات الشراء إلى وحدة التخزين</b> <span class="small muted">(مثال: 1 علبة = 12 ${esc(cur.unit || '')})</span>
              <div id="pi-conv">${[...conv, { unitName: '', factor: '' }].map((u) => `<div class="pi-conv" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px"><input class="pi-conv-u" list="pi-unit-list" value="${esc(u.unitName)}" placeholder="وحدة الشراء: علبة"><input class="pi-conv-f" type="number" min="0" value="${u.factor}" placeholder="تساوي كم ${esc(cur.unit || '')}"></div>`).join('')}</div>
              <button type="button" class="btn sm" data-act="proc-conv-add" style="margin-top:4px">+ تحويل</button></div>` : ''}
            <label style="grid-column:1/-1">مواصفات وملاحظات فنية<input id="pi-notes" value="${esc(cur?.notes || '')}"></label>
            <label style="grid-column:1/-1">رمز QR للصنف (اختياري)<span style="display:flex;gap:6px"><input id="pi-qr" value="${esc(cur?.qrCode || '')}" placeholder="امسح ملصقاً موجوداً بالقارئ أو الكاميرا، أو ولّد رمزاً جديداً" style="flex:1"><button class="btn sm" type="button" data-act="proc-qr-scan" data-target="pi-qr">📷 قراءة</button>${cur ? `<button class="btn sm" type="button" data-act="proc-qr-gen" data-id="${cur.id}">توليد</button>` : ''}</span></label>
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
          maxStock: Number(document.getElementById('pi-max').value || 0),
          notes: document.getElementById('pi-notes').value,
          qrCode: document.getElementById('pi-qr').value.trim()
        };
        if (id) {
          await api('PUT', `/api/procurement/items/${id}`, body);
          const units = [...document.querySelectorAll('#pi-conv .pi-conv')].map((r) => ({ unitName: r.querySelector('.pi-conv-u').value.trim(), factor: Number(r.querySelector('.pi-conv-f').value) })).filter((u) => u.unitName && u.factor > 0);
          await api('PUT', `/api/procurement/items/${id}/units`, { units });
        }
        else {
          try { await api('POST', '/api/procurement/items', body); }
          catch (err) {
            if (!/الاسم نفسه/.test(String(err && err.message))) throw err;
            if (!confirm(`${err.message}\n\nهل هو صنف مختلف فعلاً؟`)) return;
            await api('POST', '/api/procurement/items', { ...body, allowDuplicate: true });
          }
        }
        toast('تم حفظ بطاقة الصنف'); closeModal(); await refresh();
      }
      else if (act === 'proc-adjust-item') {
        const cur = P.items.find((x) => x.id === Number(b.dataset.id));
        if (!cur) return;
        if (!P.warehouses.length) P.warehouses = (await api('GET', '/api/procurement/warehouses')).warehouses;
        showModal(`<h3>⚖️ تسوية جرد فعلي للصنف: ${esc(cur.name)} (${esc(cur.code)})</h3>
          <div class="form-grid">
            <label>مستودع الجرد<select id="padj-wh" data-no-other="1">${P.warehouses.filter((w) => w.active || whQtyOf(cur, w.id) > 0).map((w) => `<option value="${w.id}" data-qty="${whQtyOf(cur, w.id)}" ${(cur.stocks || []).length ? (Number(cur.stocks[0].warehouseId) === w.id ? 'selected' : '') : (Number(cur.warehouseId) === w.id ? 'selected' : '')}>${esc(w.name)} (الدفتري: ${num(whQtyOf(cur, w.id))})</option>`).join('')}</select></label>
            <label>الرصيد الفعلي المعدود في هذا المستودع<input id="padj-qty" type="number" min="0" value="${(cur.stocks || [])[0] ? cur.stocks[0].qty : cur.qtyOnHand}"></label>
            <label>متوسط التكلفة للوحدة (ل.س)<input id="padj-cost" type="number" value="${cur.avgCost || 0}"></label>
            <label style="grid-column:1/-1">سبب التسوية ورقم محضر الجرد (إلزامي، 10 أحرف على الأقل)<input id="padj-reason" maxlength="120" placeholder="مثال: محضر جرد لجنة المخازن رقم 14/2026 — عجز تلف رطوبة"></label>
          </div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-do-adjust" data-id="${cur.id}">اعتماد التسوية الجردية</button></div>`);
      }
      else if (act === 'proc-do-adjust') {
        const adj = await api('POST', `/api/procurement/items/${b.dataset.id}/adjust`, {
          qtyOnHand: Number(document.getElementById('padj-qty').value),
          avgCost: Number(document.getElementById('padj-cost').value),
          reason: document.getElementById('padj-reason').value,
          warehouseId: Number(document.getElementById('padj-wh').value) || null,
          expectedQty: Number(document.getElementById('padj-wh').selectedOptions[0]?.dataset.qty ?? 0)
        });
        toast(adj && adj.journalError ? `سُوّي الرصيد، لكن تعذّر قيد الفرق: ${adj.journalError} (أُبلغت المالية)` : 'تمت تسوية الرصيد وترحيل قيد الفرق'); closeModal(); await refresh();
      }

      else if (act === 'proc-new-req') {
        const ed = P.editReq; P.editReq = null;
        if (!P.warehouses.length || !P.items.length) {
          const [w, it] = await Promise.all([api('GET', '/api/procurement/warehouses'), api('GET', '/api/procurement/items')]);
          P.warehouses = w.warehouses; P.items = it.items;
        }
        // قائمة الموردين للاقتراح فقط (مقدّم الطلب قد لا يملك الاطلاع عليها فيكتب الاسم)
        if (!P.suppliers.length) P.suppliers = (await api('GET', '/api/procurement/suppliers').catch(() => ({ suppliers: [] }))).suppliers;
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
            <label>المبلغ الإجمالي كتابةً<input id="pr-words" placeholder="مليونان وسبعمئة ألف ليرة سورية لا غير"></label>
            <label>المورد المقترح (اختياري)<input id="pr-sup" list="pr-sup-list" maxlength="80" placeholder="من قائمة الموردين أو اكتب اسم المحل أو الشركة"><datalist id="pr-sup-list">${P.suppliers.filter((x) => x.active).map((x) => `<option value="${esc(x.name)}"></option>`).join('')}</datalist></label>` },
            { title: 'البنود المطلوبة', wide: true, html: `<div id="pr-lines">
            <div class="form-grid pr-head small" style="margin-bottom:2px;grid-template-columns:1.2fr 1.2fr 1.3fr .8fr .6fr .5fr .7fr 32px;font-weight:700;color:var(--muted)"><span>الصنف المخزني</span><span>المادة</span><span>المواصفات</span><span>رمز الموازنة</span><span>الواحدة</span><span>العدد</span><span>السعر الإفرادي</span><span></span></div>
            <div class="form-grid pr-line" style="margin-bottom:6px;grid-template-columns:1.2fr 1.2fr 1.3fr .8fr .6fr .5fr .7fr 32px">
              <select class="pr-item" aria-label="الصنف"><option value="">— صنف مخزني (اختياري) —</option>${P.items.map((i) => `<option value="${i.id}" data-name="${esc(i.name)}" data-cost="${i.avgCost || 0}" data-unit="${esc(i.unit || '')}">${esc(i.code)} · ${esc(i.name)}</option>`).join('')}</select>
              <input class="pr-ldesc" placeholder="المادة" aria-label="المادة">
              <input class="pr-specs" placeholder="المواصفات" aria-label="المواصفات">
              <input class="pr-budget" placeholder="رمز الموازنة" aria-label="رمز الموازنة">
              <input class="pr-unit" placeholder="الواحدة" aria-label="الواحدة">
              <input class="pr-qty" type="number" min="1" value="1" placeholder="العدد" aria-label="العدد المطلوب">
              <input class="pr-cost" type="number" min="1" placeholder="مثال: 25000" aria-label="السعر الإفرادي" required>
              <button type="button" class="btn sm dan" data-act="proc-del-line" title="حذف البند" aria-label="حذف البند">✕</button>
            </div>
          </div>
          <div class="spread"><button class="btn sm" data-act="proc-add-req-line" style="justify-self:start">+ إضافة بند آخر</button><b id="pr-total" class="small">الإجمالي التقديري: 0</b></div>
          <p class="small" style="margin:4px 0 0">السعر التقديري إلزامي: منه يُحسب الإجمالي الذي يحدد مراحل الاعتماد (المالية ورئاسة الجامعة). اختيار صنف مخزني يملأ الوصف والوحدة ومتوسط التكلفة.</p>` },
          ],
          justification: { id: 'pr-desc', label: 'مبرر الطلب وبيانه', max: 500 },
          actions: `<button class="btn pri" data-act="proc-save-req" data-sub="1"${ed ? ` data-edit="${ed.id}"` : ''}>حفظ وإرسال للاعتماد</button>
            <button class="btn" data-act="proc-save-req" data-sub="0"${ed ? ` data-edit="${ed.id}"` : ''}>حفظ كمسودة</button>
            <button class="btn" data-act="proc-close-modal">إلغاء</button>`,
        }));
        if (ed) fillReqForm(ed);
      }
      else if (act === 'proc-add-req-line') {
        const c = document.getElementById('pr-lines');
        const first = c?.querySelector('.pr-line');
        if (c && first) {
          const clone = first.cloneNode(true);
          clone.querySelectorAll('input').forEach((i) => (i.value = i.classList.contains('pr-qty') ? '1' : '')); clone.querySelector('select').value = '';
          c.appendChild(clone);
        }
      }
      else if (act === 'proc-rcv-journal') {
        const r = await api('POST', `/api/procurement/receipts/${b.dataset.id}/post-journal`, {});
        if (r.journalEntryId) toast('رُحّل قيد الاستلام'); else toast(`ما زال القيد متعذراً: ${r.journalError}`);
        await refresh();
      }
      else if (act === 'proc-item-card' || act === 'proc-card-filter') {
        const id = b.dataset.id, from = document.getElementById('pcard-from')?.value || '', to = document.getElementById('pcard-to')?.value || '';
        const c = await api('GET', `/api/procurement/items/${id}/card${act === 'proc-card-filter' ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : ''}`);
        const it = c.item;
        showModal(`<div data-doc-title="بطاقة صنف مخزني" data-doc-no="${esc(it.code)}" data-doc-dept="المشتريات والمخازن" data-doc-signers="أمين المستودع|مدقق المخازن|مدير المشتريات"></div>
          <h3>📒 بطاقة الصنف ${esc(it.code)} · ${esc(it.name)}</h3>
          ${kv4([['الوحدة', it.unit], ['المستودع', it.warehouse || '—'], ['الرصيد الحالي', num(it.qtyOnHand)], ['متوسط التكلفة', money(it.avgCost)], ['الفترة', c.from || c.to ? `${c.from || 'البداية'} ← ${c.to || 'اليوم'}` : 'كل الحركات']])}
          ${c.consistent ? '' : `<p class="badge b-err" style="display:block">تنبيه: رصيد البطاقة (${num(it.qtyOnHand)}) يختلف عن آخر رصيد في الدفتر (${num(c.ledgerBalance)}).</p>`}
          <div class="form-grid no-print" data-print-skip style="grid-template-columns:1fr 1fr auto;align-items:end;margin:6px 0">
            <label>من تاريخ<input id="pcard-from" type="date" value="${esc(c.from || '')}"></label>
            <label>إلى تاريخ<input id="pcard-to" type="date" value="${esc(c.to || '')}"></label>
            <button class="btn sm" data-act="proc-card-filter" data-id="${it.id}">عرض الفترة</button>
          </div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>التاريخ</th><th>الحركة</th><th>المرجع</th><th>وارد</th><th>صادر</th><th>الرصيد</th><th>سعر الوحدة</th><th>البيان</th><th>بواسطة</th></tr></thead><tbody>
            ${c.from ? `<tr><td colspan="5"><b>رصيد أول المدة</b></td><td><b>${num(c.opening)}</b></td><td colspan="3"></td></tr>` : ''}
            ${c.moves.map((m) => `<tr><td>${fmt(m.at)}</td><td>${esc(m.kindLabel)}</td><td><code>${esc(m.refNo || '—')}</code></td><td>${m.in ? num(m.in) : ''}</td><td>${m.out ? num(m.out) : ''}</td><td><b>${num(m.balance)}</b></td><td>${num(m.unitCost)}</td><td>${esc(m.note || '')}</td><td>${esc(m.by || '—')}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">لا حركات في الفترة</td></tr>'}
          </tbody><tfoot><tr><th colspan="3">مجموع الفترة</th><th>${num(c.totals.in)}</th><th>${num(c.totals.out)}</th><th colspan="4"></th></tr></tfoot></table></div>
          <div class="row-end" style="margin-top:10px"><button class="btn no-print" data-act="print">🖨️ طباعة البطاقة</button><button class="btn pri" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-stock-at' || act === 'proc-stock-at-go') {
        const day = document.getElementById('psa-day')?.value || '';
        const [r, chk] = await Promise.all([api('GET', `/api/procurement/stock-at${day ? `?day=${encodeURIComponent(day)}` : ''}`), api('GET', '/api/procurement/ledger-check')]);
        showModal(`<div data-doc-title="رصيد المخزون بتاريخ" data-doc-no="${esc(r.day)}" data-doc-dept="المشتريات والمخازن" data-doc-signers="أمين المستودع|مدقق المخازن|مدير المشتريات"></div>
          <h3>📅 رصيد المخزون في ${esc(r.day)}</h3>
          <div class="form-grid no-print" data-print-skip style="grid-template-columns:1fr auto;align-items:end"><label>التاريخ<input id="psa-day" type="date" value="${esc(r.day)}"></label><button class="btn sm" data-act="proc-stock-at-go">عرض</button></div>
          ${chk.ok ? '<p class="small no-print" data-print-skip>✓ الدفتر مطابق لأرصدة كل الأصناف.</p>' : `<p class="badge b-err no-print" data-print-skip style="display:block">أصناف يختلف رصيدها عن دفترها: ${chk.diffs.slice(0, 8).map((d) => `${esc(d.code)} (${num(d.qtyOnHand)} / ${num(d.ledger)})`).join('، ')}</p>`}
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>الصنف</th><th>المستودع</th><th>الوحدة</th><th>الرصيد</th><th>القيمة بمتوسط التكلفة الحالي</th></tr></thead><tbody>
            ${r.items.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td>${esc(x.name)}</td><td>${esc(x.warehouse || '—')}</td><td>${esc(x.unit || '')}</td><td><b>${num(x.qty)}</b></td><td>${money(x.value)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا أرصدة في هذا التاريخ</td></tr>'}
          </tbody><tfoot><tr><th colspan="5">القيمة الإجمالية</th><th>${money(r.totalValue)}</th></tr></tfoot></table></div>
          <p class="small">الكميات من دفتر الحركات حتى نهاية اليوم المحدد؛ القيمة تقديرية بمتوسط التكلفة الحالي.</p>
          <div class="row-end"><button class="btn no-print" data-act="print">🖨️ طباعة</button><button class="btn pri" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-new-transfer') {
        if (!P.warehouses.length || !P.items.length) {
          const [w, it] = await Promise.all([api('GET', '/api/procurement/warehouses'), api('GET', '/api/procurement/items')]);
          P.warehouses = w.warehouses; P.items = it.items;
        }
        const act2 = P.warehouses.filter((w) => w.active);
        if (act2.length < 2) { toast('يلزم مستودعان فعّالان على الأقل للتحويل'); return; }
        const whOpts = (sel) => act2.map((w) => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
        showModal(`<h3>🔁 سند تحويل بين مستودعين</h3>
          <p class="small" style="margin-top:0">الخطوة الأولى تُخرج المواد من المستودع المرسِل فتصير «قيد النقل»، ويستلمها أمين المستودع المستلِم في الخطوة الثانية.</p>
          <div class="form-grid">
            <label>من المستودع<select id="ptr-from" data-no-other="1">${whOpts(act2[0].id)}</select></label>
            <label>إلى المستودع<select id="ptr-to" data-no-other="1">${whOpts(act2[1].id)}</select></label>
            <label style="grid-column:1/-1">ملاحظة (اختياري)<input id="ptr-note" maxlength="300" placeholder="مثال: نقل لتجهيز مخبر الشبكات"></label>
          </div>
          <div id="ptr-lines">
            <div class="ptr-line" style="display:grid;grid-template-columns:2fr .7fr 32px;gap:6px;margin-bottom:6px">
              <select class="ptr-item" aria-label="المادة">${whItemOptions(act2[0].id)}</select>
              <input class="ptr-qty" type="number" min="1" value="1" aria-label="الكمية">
              <button type="button" class="btn sm dan" data-act="proc-tr-del-line" aria-label="حذف">✕</button>
            </div>
          </div>
          <button class="btn sm" data-act="proc-tr-add-line">+ إضافة مادة</button>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-tr-save">إرسال (إخراج من المرسِل)</button></div>`);
        document.getElementById('ptr-from')?.addEventListener('change', (ev) => { document.querySelectorAll('#ptr-lines .ptr-item').forEach((sel) => { sel.innerHTML = whItemOptions(ev.target.value); }); });
      }
      else if (act === 'proc-tr-add-line') { const c = document.getElementById('ptr-lines'), f = c?.querySelector('.ptr-line'); if (f) { const n = f.cloneNode(true); n.querySelector('.ptr-qty').value = '1'; c.appendChild(n); } }
      else if (act === 'proc-tr-del-line') { const rows = document.querySelectorAll('#ptr-lines .ptr-line'); if (rows.length > 1) b.closest('.ptr-line').remove(); }
      else if (act === 'proc-tr-save') {
        const lines = [...document.querySelectorAll('#ptr-lines .ptr-line')].map((r) => ({ itemId: Number(r.querySelector('.ptr-item').value), qty: Number(r.querySelector('.ptr-qty').value) })).filter((l) => l.itemId && l.qty > 0);
        if (!lines.length) { toast('اختر مادة وكمية'); return; }
        const r = await api('POST', '/api/procurement/transfers', { fromWarehouseId: Number(document.getElementById('ptr-from').value), toWarehouseId: Number(document.getElementById('ptr-to').value), note: document.getElementById('ptr-note').value, lines });
        toast(`أُرسل سند التحويل ${r.transfer.no}؛ بانتظار استلامه`); closeModal(); P.tab = 'movements'; P.moveMode = 'transfers'; await refresh();
      }
      else if (act === 'proc-tr-receive') {
        if (!confirm('تأكيد استلام كل مواد السند في المستودع المستلِم؟')) return;
        await api('POST', `/api/procurement/transfers/${b.dataset.id}/receive`, {}); toast('استُلم التحويل وأُضيف إلى رصيد المستودع'); await refresh();
      }
      else if (act === 'proc-tr-cancel') {
        const reason = prompt('سبب إلغاء التحويل (تعود المواد إلى المستودع المرسِل):'); if (!reason) return;
        await api('POST', `/api/procurement/transfers/${b.dataset.id}/cancel`, { reason }); toast('أُلغي التحويل وأُعيدت المواد'); await refresh();
      }
      else if (act === 'proc-gl-rec') {
        const [r, u] = await Promise.all([api('GET', '/api/procurement/gl-reconcile'), api('GET', '/api/procurement/unposted')]);
        const rows = [['receipts', 'استلام', u.receipts], ['issues', 'صرف', u.issues], ['adjustments', 'تسوية جرد', u.adjustments]].flatMap(([k, l, list]) => list.map((x) => ({ k, l, ...x })));
        showModal(`<div data-doc-title="مطابقة المخزون مع حساب المخزون" data-doc-dept="المشتريات والمخازن" data-doc-signers="أمين المستودع|المحاسب|المدير المالي"></div>
          <h3>🧾 مطابقة المخزون مع الدفتر المحاسبي</h3>
          ${kv4([['قيمة المخزون (الرصيد × متوسط التكلفة + قيد النقل)', money(r.stockValue)], [`رصيد ${r.account || 'حساب المخزون'} المرحّل`, money(r.glBalance)], ['الفرق', `${money(r.difference)}${r.difference ? ' ⚠️' : ' ✓'}`], ['مستندات بلا قيد', num(r.unposted)]])}
          <p class="small">الفرق ينشأ عادةً من مستندات بلا قيد (أدناه)، أو أرصدة افتتاحية وتسويات أُدخلت قبل تفعيل قيود المخزون، أو قيود يدوية على حساب المخزون.</p>
          ${rows.length ? `<h4>مستندات حرّكت المخزون بلا قيد محاسبي</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th>النوع</th><th>المستند</th><th>التاريخ</th><th>سبب التعذّر</th><th></th></tr></thead><tbody>
            ${rows.map((x) => `<tr><td>${esc(x.l)}</td><td><code>${esc(x.no)}</code>${x.ref ? ` <span class="small">${esc(x.ref)}</span>` : ''}</td><td>${fmt(x.at)}</td><td>${esc(x.error)}</td><td>${can('finance:post') ? `<button class="btn sm no-print" data-act="proc-repost" data-k="${x.k}" data-id="${x.id}">ترحيل القيد</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="small">✓ كل حركات المخزون مرحّلة بقيودها.</p>'}
          <div class="row-end"><button class="btn no-print" data-act="print">🖨️ طباعة</button><button class="btn pri" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-repost') {
        const r = await api('POST', `/api/procurement/unposted/${b.dataset.k}/${b.dataset.id}/post`, {});
        toast(r.journalEntryId ? 'رُحّل القيد' : `ما زال القيد متعذراً: ${r.journalError}`);
        const t = document.createElement('button'); t.dataset.act = 'proc-gl-rec'; t.hidden = true; document.body.appendChild(t); t.click(); t.remove();
      }
      else if (act === 'proc-new-isreq') {
        const whs = P.warehouses.filter((w) => w.active);
        showModal(`<h3>📋 طلب صرف مواد من المستودع</h3>
          <div class="form-grid">
            <label>المستودع<select id="isr-wh" data-no-other="1">${whs.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></label>
            <label>القسم الطالب (اختياري: من وحدتك)<input id="isr-dept" maxlength="80" placeholder="مثال: المكتبة"></label>
            <label style="grid-column:1/-1">الغرض من الطلب<input id="isr-purpose" maxlength="300" placeholder="مثال: تجهيز قاعة الامتحانات للفصل الثاني"></label>
          </div>
          <div id="isr-lines"><div class="isr-line" style="display:grid;grid-template-columns:2fr .7fr 32px;gap:6px;margin-bottom:6px">
            <select class="isr-item" aria-label="المادة">${whItemOptions(whs[0]?.id)}</select>
            <input class="isr-qty" type="number" min="1" value="1" aria-label="الكمية المطلوبة">
            <button type="button" class="btn sm dan" data-act="proc-isr-del-line" aria-label="حذف">✕</button>
          </div></div>
          <button class="btn sm" data-act="proc-isr-add-line">+ إضافة مادة</button>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-isr-save">إرسال لاعتماد رئيس القسم</button></div>`);
        document.getElementById('isr-wh')?.addEventListener('change', (ev) => { document.querySelectorAll('#isr-lines .isr-item').forEach((sel) => { sel.innerHTML = whItemOptions(ev.target.value); }); });
      }
      else if (act === 'proc-isr-add-line') { const c = document.getElementById('isr-lines'), f = c?.querySelector('.isr-line'); if (f) { const n = f.cloneNode(true); n.querySelector('.isr-qty').value = '1'; c.appendChild(n); } }
      else if (act === 'proc-isr-del-line') { if (document.querySelectorAll('#isr-lines .isr-line').length > 1) b.closest('.isr-line').remove(); }
      else if (act === 'proc-isr-save') {
        const lines = [...document.querySelectorAll('#isr-lines .isr-line')].map((r) => ({ itemId: Number(r.querySelector('.isr-item').value), qty: Number(r.querySelector('.isr-qty').value) })).filter((l) => l.itemId && l.qty > 0);
        if (!lines.length) { toast('اختر مادة وكمية'); return; }
        const r = await api('POST', '/api/procurement/issue-requests', { warehouseId: Number(document.getElementById('isr-wh').value), department: document.getElementById('isr-dept').value.trim(), purpose: document.getElementById('isr-purpose').value.trim(), lines });
        toast(`أُرسل طلب الصرف ${r.request.no} لاعتماد رئيس القسم`); closeModal(); P.tab = 'isreq'; await refresh();
      }
      else if (act === 'proc-isreq-dec') {
        const dec = b.dataset.dec, note = dec === 'reject' ? prompt('سبب الرفض:') : (prompt('ملاحظة الاعتماد (اختياري):') ?? '');
        if (dec === 'reject' && !note) return;
        await api('POST', `/api/procurement/issue-requests/${b.dataset.id}/${dec}`, { note }); toast(dec === 'approve' ? 'اعتُمد وأُحيل إلى المستودع' : 'رُفض الطلب'); await refresh();
      }
      else if (act === 'proc-isreq-cancel') { if (!confirm('إلغاء طلب الصرف؟')) return; await api('POST', `/api/procurement/issue-requests/${b.dataset.id}/cancel`, {}); toast('أُلغي'); await refresh(); }
      else if (act === 'proc-isreq-confirm') { if (!confirm('أؤكد استلام المواد المصروفة كاملة وبحالة سليمة.')) return; await api('POST', `/api/procurement/issue-requests/${b.dataset.id}/confirm`, {}); toast('سُجّل استلامك إلكترونياً'); await refresh(); }
      else if (act === 'proc-isreq-issue') {
        const r = (P.isreqs || []).find((x) => x.id === Number(b.dataset.id)); if (!r) return;
        const open = r.lines.filter((l) => l.remaining > 0);
        showModal(`<h3>📤 صرف طلب ${esc(r.no)} — ${esc(r.department)}</h3>
          <p class="small" style="margin-top:0">من ${esc(r.warehouseName)}. الكمية الافتراضية المتبقي المعتمد ومحدودة برصيد المستودع.</p>
          <div id="isri-lines">${open.map((l) => { const it = P.items.find((x) => x.id === l.itemId); const have = it ? whQtyOf(it, r.warehouseId) : 0; return `<div class="isri-line" data-item="${l.itemId}" style="display:grid;grid-template-columns:2fr .9fr .7fr;gap:6px;align-items:center;margin-bottom:6px">
            <span><b>${esc(l.name)}</b><div class="small">المعتمد ${num(l.qty)} · صُرف ${num(l.issuedQty)} · في المستودع ${num(have)}</div></span>
            <span class="small">المتبقي ${num(l.remaining)}</span>
            <input class="isri-qty" type="number" min="0" max="${Math.min(l.remaining, have)}" value="${Math.min(l.remaining, have)}" aria-label="الكمية المصروفة"></div>`; }).join('')}</div>
          <div class="form-grid"><label>اسم المستلم<input id="isri-recv" maxlength="80" value="${esc(r.requesterName)}"></label></div>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-isreq-do-issue" data-id="${r.id}" data-wh="${r.warehouseId}">اعتماد الصرف</button></div>`);
      }
      else if (act === 'proc-isreq-do-issue') {
        const lines = [...document.querySelectorAll('#isri-lines .isri-line')].map((x) => ({ itemId: Number(x.dataset.item), qty: Number(x.querySelector('.isri-qty').value) })).filter((l) => l.qty > 0);
        if (!lines.length) { toast('لا كميات للصرف'); return; }
        const r = await api('POST', '/api/procurement/issues', { warehouseId: Number(b.dataset.wh), issueRequestId: Number(b.dataset.id), receiverName: document.getElementById('isri-recv').value.trim(), lines });
        toast(r.journalError ? `صُرفت المواد، لكن تعذّر قيدها: ${r.journalError}` : `صُرف بإذن ${r.no}؛ بانتظار تأكيد القسم`); closeModal(); await refresh();
      }
      else if (act === 'proc-new-return') {
        const whs = P.warehouses.filter((w) => w.active);
        showModal(`<h3>↩️ تسجيل مرتجع مواد إلى المستودع</h3>
          <p class="small" style="margin-top:0">مواد صُرفت ولم تُستهلك تعود إلى الرصيد بقيد عكسي لقيد الصرف. ربطها بإذن الصرف يمنع إرجاع أكثر مما صُرف.</p>
          <div class="form-grid">
            <label>إلى المستودع<select id="ret-wh" data-no-other="1">${whs.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></label>
            <label>رقم إذن الصرف (اختياري)<input id="ret-issue" maxlength="30" placeholder="IS-2026-00001"></label>
            <label>القسم المُرجِع<input id="ret-dept" maxlength="80" placeholder="مثال: المكتبة"></label>
            <label>اسم من سلّم المرتجع<input id="ret-by" maxlength="80"></label>
            <label style="grid-column:1/-1">سبب الإرجاع (إلزامي)<input id="ret-reason" maxlength="300" placeholder="مثال: فائض عن حاجة الفصل"></label>
          </div>
          <div id="ret-lines"><div class="ret-line" style="display:grid;grid-template-columns:2fr .7fr 1fr;gap:6px;margin-bottom:6px">
            <select class="ret-item" aria-label="المادة">${P.items.map((i) => `<option value="${i.id}">${esc(i.code)} · ${esc(i.name)}</option>`).join('')}</select>
            <input class="ret-qty" type="number" min="1" value="1" aria-label="الكمية">
            <select class="ret-cond" aria-label="حالة المادة">${CONDITION.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
          </div></div>
          <button class="btn sm" data-act="proc-ret-add-line">+ إضافة مادة</button>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-ret-save">تسجيل المرتجع</button></div>`);
      }
      else if (act === 'proc-ret-add-line') { const c = document.getElementById('ret-lines'), f = c?.querySelector('.ret-line'); if (f) { const n = f.cloneNode(true); n.querySelector('.ret-qty').value = '1'; c.appendChild(n); } }
      else if (act === 'proc-ret-save') {
        const issueNo = document.getElementById('ret-issue').value.trim();
        let issueId = null;
        if (issueNo) { const iss = ((await api('GET', '/api/procurement/issues')).issues || []).find((x) => x.no === issueNo); if (!iss) { toast('لم يُعثر على إذن الصرف بهذا الرقم'); return; } issueId = iss.id; }
        const lines = [...document.querySelectorAll('#ret-lines .ret-line')].map((r) => ({ itemId: Number(r.querySelector('.ret-item').value), qty: Number(r.querySelector('.ret-qty').value), itemCondition: r.querySelector('.ret-cond').value })).filter((l) => l.qty > 0);
        const r = await api('POST', '/api/procurement/returns', { warehouseId: Number(document.getElementById('ret-wh').value), issueId, department: document.getElementById('ret-dept').value.trim(), returnedBy: document.getElementById('ret-by').value.trim(), reason: document.getElementById('ret-reason').value.trim(), lines });
        toast(r.journalError ? `سُجّل المرتجع ${r.no}، لكن تعذّر قيده: ${r.journalError}` : `سُجّل المرتجع ${r.no} وقيده`); closeModal(); await refresh();
      }
      else if (act === 'proc-conv-add') { const c = document.getElementById('pi-conv'), f = c?.querySelector('.pi-conv'); if (f) { const n = f.cloneNode(true); n.querySelectorAll('input').forEach((i) => (i.value = '')); c.appendChild(n); } }
      else if (act === 'proc-cats') {
        P.categories = (await api('GET', '/api/procurement/categories')).categories;
        const kids = (pid) => P.categories.filter((c) => (c.parentId ?? null) === pid);
        const tree = (pid, depth) => kids(pid).map((c) => `<tr><td style="padding-inline-start:${8 + depth * 18}px">${depth ? '↳ ' : ''}<code>${esc(c.code)}</code></td><td>${esc(c.name)}</td><td>${num(c.items)}</td><td>${c.active ? 'فعّال' : 'موقوف'}</td>
          <td>${can('procurement:manage') ? `<button class="btn sm" data-act="proc-cat-edit" data-id="${c.id}">تعديل</button>` : ''}</td></tr>${tree(c.id, depth + 1)}`).join('');
        showModal(`<h3>🗂️ تصنيفات الأصناف</h3>
          <p class="small" style="margin-top:0">رمز التصنيف بادئة لترقيم أصنافه تلقائياً (CAT-IT-0001). التصنيف الفرعي يتبع أباه.</p>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>الأصناف</th><th>الحالة</th><th></th></tr></thead><tbody>${tree(null, 0) || '<tr><td colspan="5" class="empty">لا تصنيفات</td></tr>'}</tbody></table></div>
          ${can('procurement:manage') ? `<h4>${'إضافة / تعديل تصنيف'}</h4><div class="form-grid">
            <input type="hidden" id="pc-id"><label>الرمز<input id="pc-code" maxlength="16" placeholder="CAT-NET" dir="ltr"></label><label>الاسم<input id="pc-name" maxlength="60" placeholder="مثال: معدات الشبكات"></label>
            <label>التصنيف الأب (اختياري)<select id="pc-parent" data-no-other="1"><option value="">— تصنيف رئيسي —</option>${P.categories.map((c) => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select></label>
            <label>الحالة<select id="pc-active" data-no-other="1"><option value="1">فعّال</option><option value="0">موقوف</option></select></label></div>
            <div class="row-end"><button class="btn pri" data-act="proc-cat-save">حفظ التصنيف</button></div>` : ''}
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-cat-edit') {
        const c = P.categories.find((x) => x.id === Number(b.dataset.id)); if (!c) return;
        document.getElementById('pc-id').value = c.id; document.getElementById('pc-code').value = c.code; document.getElementById('pc-name').value = c.name;
        document.getElementById('pc-parent').value = c.parentId ?? ''; document.getElementById('pc-active').value = c.active ? '1' : '0'; document.getElementById('pc-code').focus();
      }
      else if (act === 'proc-cat-save') {
        await api('POST', '/api/procurement/categories', { id: Number(document.getElementById('pc-id').value) || null, code: document.getElementById('pc-code').value.trim(), name: document.getElementById('pc-name').value.trim(), parentId: Number(document.getElementById('pc-parent').value) || null, active: document.getElementById('pc-active').value === '1' });
        toast('حُفظ التصنيف'); const t = document.createElement('button'); t.dataset.act = 'proc-cats'; t.hidden = true; document.body.appendChild(t); t.click(); t.remove();
      }
      else if (act === 'proc-units') {
        P.units = (await api('GET', '/api/procurement/units')).units;
        showModal(`<h3>📏 دليل وحدات القياس</h3>
          <p class="small" style="margin-top:0">الوحدة «تقبل الكسور» تسمح بكميات عشرية (2.5 كغ). التحويل العام اختياري (1 غرام = 0.001 كغ)؛ وتحويل صنف بعينه (العلبة = 12 قطعة) من بطاقة الصنف.</p>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الوحدة</th><th>الكسور</th><th>التحويل العام</th><th></th></tr></thead><tbody>
            ${P.units.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="small muted">(موقوفة)</span>'}</td><td>${u.fractional ? '✓ تقبل الكسور' : 'عدد صحيح'}</td><td>${u.baseName ? `1 ${esc(u.name)} = ${num(u.factor)} ${esc(u.baseName)}` : '—'}</td>
              <td>${can('procurement:manage') ? `<button class="btn sm" data-act="proc-unit-edit" data-id="${u.id}">تعديل</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>
          ${can('procurement:manage') ? `<h4>إضافة / تعديل وحدة</h4><div class="form-grid"><input type="hidden" id="pu-id">
            <label>اسم الوحدة<input id="pu-name" maxlength="20" placeholder="مثال: غالون"></label>
            <label>الكسور<select id="pu-frac" data-no-other="1"><option value="0">عدد صحيح</option><option value="1">تقبل الكسور</option></select></label>
            <label>وحدة الأساس (اختياري)<select id="pu-base" data-no-other="1"><option value="">— بلا تحويل عام —</option>${P.units.map((u) => `<option>${esc(u.name)}</option>`).join('')}</select></label>
            <label>1 من هذه الوحدة = ؟ من الأساس<input id="pu-factor" type="number" min="0" value="1"></label></div>
            <div class="row-end"><button class="btn pri" data-act="proc-unit-save">حفظ الوحدة</button></div>` : ''}
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-unit-edit') {
        const u = P.units.find((x) => x.id === Number(b.dataset.id)); if (!u) return;
        document.getElementById('pu-id').value = u.id; document.getElementById('pu-name').value = u.name; document.getElementById('pu-frac').value = u.fractional ? '1' : '0';
        document.getElementById('pu-base').value = u.baseName || ''; document.getElementById('pu-factor').value = u.factor; document.getElementById('pu-name').focus();
      }
      else if (act === 'proc-unit-save') {
        await api('POST', '/api/procurement/units', { id: Number(document.getElementById('pu-id').value) || null, name: document.getElementById('pu-name').value.trim(), fractional: document.getElementById('pu-frac').value === '1', baseName: document.getElementById('pu-base').value, factor: Number(document.getElementById('pu-factor').value) || 1 });
        toast('حُفظت الوحدة'); const t = document.createElement('button'); t.dataset.act = 'proc-units'; t.hidden = true; document.body.appendChild(t); t.click(); t.remove();
      }
      else if (act === 'proc-asset-hist') {
        const h = await api('GET', `/api/procurement/assets/${b.dataset.id}/history`), a = h.asset;
        showModal(`<div data-doc-title="بطاقة أصل ثابت" data-doc-no="${esc(a.code)}" data-doc-dept="المشتريات والمخازن" data-doc-signers="أمين المستودع|مدقق الأصول|مدير المشتريات"></div>
          <h3>📜 سجل الأصل ${esc(a.code)} · ${esc(a.name)}</h3>
          <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <img src="/api/procurement/assets/${a.id}/qr.svg" alt="رمز QR للأصل" style="width:110px;height:110px;image-rendering:pixelated">
            <div style="flex:1">${kv4([['الرقم التسلسلي', a.serialNo || '—'], ['من أمر الشراء', a.orderNo || '—'], ['المورد', a.supplier || '—'], ['التكلفة', money(a.cost)], ['مجمع الإهلاك', money(a.accumulated)], ['القيمة الدفترية', money(a.bookValue)], ['العمر الإنتاجي', a.usefulLifeMonths ? `${a.usefulLifeMonths} شهراً` : 'بلا إهلاك'], ['بدء الإهلاك', a.depreciationStart || '—']])}</div>
          </div>
          ${a.disposalRequested ? `<p class="badge b-warn" style="display:block">طلب إتلاف بانتظار الاعتماد: ${esc(a.disposalReason)}</p>` : ''}
          <h4>الحركات والعهد</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th>التاريخ</th><th>الحركة</th><th>من</th><th>إلى</th><th>المستلم</th><th>السبب</th><th>بواسطة</th></tr></thead><tbody>
            ${h.moves.map((m) => `<tr><td>${fmt(m.at)}</td><td>${esc(m.kind)}</td><td>${esc(m.from || '—')}</td><td>${esc(m.to || '—')}</td><td>${esc(m.toUser || '—')}</td><td>${esc(m.reason || '')}</td><td>${esc(m.by)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا حركات</td></tr>'}
          </tbody></table></div>
          <h4>أقساط الإهلاك</h4><p class="small">${h.depreciation.length ? h.depreciation.map((d) => `${esc(d.period)}: ${money(d.amount)}`).join(' · ') : 'لا أقساط بعد.'}</p>
          <h4>محاضر الجرد</h4><p class="small">${h.checks.length ? h.checks.map((c) => `${fmt(c.at)}: ${c.found ? (c.locationOk ? 'موجود في موقعه' : 'موجود في غير موقعه') : 'مفقود'}${c.note ? ` (${esc(c.note)})` : ''} — ${esc(c.by)}`).join('<br>') : 'لم يُجرد بعد.'}</p>
          <div class="row-end"><button class="btn no-print" data-act="print">🖨️ طباعة البطاقة</button><button class="btn pri" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-dispose-dec') {
        const ok = b.dataset.ok === '1';
        if (ok && !confirm('اعتماد إتلاف الأصل نهائياً وترحيل قيده؟')) return;
        const note = ok ? '' : prompt('سبب رفض الإتلاف:'); if (!ok && !note) return;
        const r = await api('POST', `/api/procurement/assets/${b.dataset.id}/dispose-${ok ? 'approve' : 'reject'}`, { note });
        toast(ok ? (r.journalError ? `أُتلف الأصل، لكن تعذّر قيده: ${r.journalError}` : 'أُتلف الأصل ورُحّل قيده') : 'رُفض طلب الإتلاف'); await refresh();
      }
      else if (act === 'proc-asset-verify') {
        const found = confirm('هل الأصل موجود فعلاً؟ (موافق = موجود، إلغاء = مفقود)');
        const locOk = found ? confirm('هل هو في موقعه المسجّل؟') : false;
        const note = found && locOk ? (prompt('ملاحظة (اختياري):') || '') : prompt(found ? 'أين وُجد؟' : 'ملاحظة عن فقدان الأصل:');
        if ((!found || !locOk) && !note) return;
        await api('POST', `/api/procurement/assets/${b.dataset.id}/verify`, { found, locationOk: locOk, note }); toast('سُجّل محضر الجرد'); await refresh();
      }
      else if (act === 'proc-unchecked') {
        const r = await api('GET', '/api/procurement/assets/unchecked?months=12');
        showModal(`<div data-doc-title="أصول لم تُجرد" data-doc-dept="المشتريات والمخازن" data-doc-signers="لجنة الجرد|مدير المشتريات"></div><h3>🔍 أصول لم تُجرد منذ ${r.months} شهراً (${num(r.assets.length)})</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>الأصل</th><th>العهدة</th><th>آخر جرد</th></tr></thead><tbody>
            ${r.assets.map((a) => `<tr><td><code>${esc(a.code)}</code></td><td>${esc(a.name)}</td><td>${esc(a.assignedTo || '—')}</td><td>${a.lastVerifiedAt ? fmt(a.lastVerifiedAt) : 'لم يُجرد'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">✓ كل الأصول جُردت</td></tr>'}
          </tbody></table></div><div class="row-end"><button class="btn no-print" data-act="print">🖨️ طباعة</button><button class="btn pri" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-dep-run') {
        const def = new Date(); def.setMonth(def.getMonth() - 1);
        const period = prompt('شهر الإهلاك (YYYY-MM):', def.toISOString().slice(0, 7)); if (!period) return;
        const r = await api('POST', '/api/procurement/assets/depreciation', { period: period.trim() });
        toast(r.assets ? `أُهلك ${r.assets} أصل لشهر ${r.period} بمبلغ ${num(r.total)}${r.journalError ? ` — تعذّر القيد: ${r.journalError}` : ''}` : `لا أقساط جديدة لشهر ${r.period}`); await refresh();
      }
      else if (act === 'proc-page') { P.pg[b.dataset.k] = Math.max(1, Number(b.dataset.p) || 1); await refresh(); }
      else if (act === 'proc-rep') { P.rep = { kind: b.dataset.k, days: b.dataset.k === 'delayed' ? 30 : b.dataset.k === 'stagnant' ? 180 : '', from: '', to: '' }; await refresh(); }
      else if (act === 'proc-rep-go') { P.rep = { ...P.rep, days: document.getElementById('prep-days')?.value || '', from: document.getElementById('prep-from')?.value || '', to: document.getElementById('prep-to')?.value || '' }; await refresh(); }
      else if (act === 'proc-del') {
        // الخادم يرفض حذف ما له حركات أو روابط ويقترح التعطيل
        if (!confirm(`حذف «${b.dataset.name}» نهائياً؟`)) return;
        await api('DELETE', `/api/procurement/${b.dataset.kind}/${b.dataset.id}`); toast('حُذف'); await refresh();
      }
      else if (act === 'proc-del-line') {
        const row = b.closest('.pr-line, .po-line'), box = row && row.parentElement;
        if (!row) return;
        if (box.querySelectorAll('.pr-line, .po-line').length <= 1) { toast('يبقى بند واحد على الأقل'); return; }
        row.remove(); recalc();
      }
      else if (act === 'proc-add-po-line') {
        const c = document.getElementById('po-lines'), first = c?.querySelector('.po-line');
        if (c && first) {
          const clone = first.cloneNode(true);
          clone.querySelectorAll('input').forEach((i) => (i.value = i.classList.contains('po-qty') ? '1' : ''));
          clone.querySelectorAll('select').forEach((s) => (s.value = s.classList.contains('po-kind') ? 'stock' : ''));
          c.appendChild(clone); recalc();
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
        const noCost = lines.findIndex((l) => !(l.estCost > 0));
        if (noCost >= 0) { toast(`البند ${noCost + 1}: أدخل السعر التقديري (أكبر من صفر).`); document.querySelectorAll('#pr-lines .pr-cost')[noCost]?.focus(); return; }
        const val = (id) => document.getElementById(id).value.trim();
        const supTyped = val('pr-sup'), supHit = P.suppliers.find((x) => x.name === supTyped);
        await api(b.dataset.edit ? 'PUT' : 'POST', b.dataset.edit ? `/api/procurement/requests/${b.dataset.edit}` : '/api/procurement/requests', {
          supplierId: supHit ? supHit.id : null, supplierName: supHit ? '' : supTyped,
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
          ${kv4([['الجهة الطالبة', r.department], ['مقدّم الطلب', r.requesterName], ['المسمى الوظيفي', r.jobTitle], ['المسؤول المباشر', r.directManager], ['عتبة الشراء', r.purchaseThreshold], ['تاريخ الحاجة', r.needDay], ['عنوان الطلب', r.title], ['المورد المقترح', r.supplierName]])}
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
      else if (act === 'proc-app-req' || act === 'proc-rej-req') {
        const rId = b.dataset.id;
        showModal(`<h3>⚖️ قرار طلب الشراء ${esc(b.dataset.no || '')}</h3>${b.dataset.stage ? `<p class="small" style="margin-top:0">المرحلة: ${esc(b.dataset.stage)}</p>` : ''}
          <label>الملاحظة أو الشرط (إلزامية للإعادة والرفض)<textarea id="prej-note" rows="3" maxlength="300" placeholder="مثال: يُعتمد بشرط التوريد قبل بدء الفصل / خفّض الكمية إلى 10"></textarea></label>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إغلاق</button>
            <button class="btn dan" data-act="proc-do-dec-req" data-dec="reject" data-id="${rId}">✕ رفض نهائي</button>
            <button class="btn" data-act="proc-do-dec-req" data-dec="return" data-id="${rId}">↩️ إعادة للتعديل</button>
            <button class="btn pri" data-act="proc-do-dec-req" data-dec="approve" data-id="${rId}">✓ اعتماد</button></div>`);
      }
      else if (act === 'proc-do-dec-req') {
        const note = document.getElementById('prej-note').value.trim(), dec = b.dataset.dec;
        if (dec !== 'approve' && note.length < 5) { toast(dec === 'return' ? 'اكتب ما يجب تعديله في الطلب.' : 'سبب الرفض إلزامي.'); document.getElementById('prej-note').focus(); return; }
        await api('POST', `/api/procurement/requests/${b.dataset.id}/${dec}`, { note: note || 'معتمد أصولاً للسير بإجراءات الشراء' });
        toast(dec === 'approve' ? 'تم الاعتماد' : dec === 'return' ? 'أُعيد الطلب لمقدّمه للتعديل' : 'تم رفض الطلب'); closeModal(); await refresh();
      }
      else if (act === 'proc-can-req') {
        if (!confirm('إلغاء طلب الشراء؟ لا يمكن التراجع.')) return;
        await api('POST', `/api/procurement/requests/${b.dataset.id}/cancel`, {}); toast('أُلغي الطلب'); await refresh();
      }
      else if (act === 'proc-edit-req') {
        const { request: r } = await api('GET', `/api/procurement/requests/${b.dataset.id}`);
        P.editReq = r;
        const t = document.createElement('button'); t.dataset.act = 'proc-new-req'; t.hidden = true; document.body.appendChild(t); t.click(); t.remove();
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
        const initLines = preReq?.lines?.length ? preReq.lines : [{ itemId: '', description: '', qty: 1, estCost: '' }];
        const supNew = !P.suppliers.some((s) => s.active) || !!(preReq && !preReq.supplierId && preReq.supplierName);
        showModal(`<h3>🚚 إصدار أمر توريد رسمي للمورد (Purchase Order)</h3>
          <div class="form-grid">
            <label>المورد<select id="po-sup" data-no-other="1">${P.suppliers.filter((s) => s.active).map((s) => `<option value="${s.id}"${preReq && preReq.supplierId === s.id ? ' selected' : ''}>${esc(s.name)} (${esc(s.code)})${s.approved === false ? ' — غير معتمد' : ''}</option>`).join('')}<option value="__new"${supNew ? ' selected' : ''}>— مورد غير مدرج في القائمة: اكتب اسمه —</option></select></label>
            <div id="po-sup-new" class="form-grid" style="grid-column:1/-1"${supNew ? '' : ' hidden'}>
              <label>اسم المورد<input id="po-sup-name" maxlength="80" value="${esc(preReq && !preReq.supplierId ? preReq.supplierName || '' : '')}" placeholder="اسم المحل أو الشركة كما في الفاتورة"></label>
              <label>موبايل المورد (اختياري)<input id="po-sup-mob" inputmode="tel" maxlength="30" placeholder="0944123456"></label>
              <label>بريد المورد (اختياري)<input id="po-sup-mail" type="email" maxlength="120" placeholder="sales@example.com"></label>
              <p class="small" style="grid-column:1/-1;margin:0">يُسجَّل مورداً «غير معتمد» في قائمة الموردين ليُراجَع ويُعتمد لاحقاً.</p>
            </div>
            <label>ربط بطلب شراء معتمد<select id="po-req"><option value="">— أمر توريد مباشر (استثناء) —</option>${appReqs.map((r) => `<option value="${r.id}" ${preReqId === r.id ? 'selected' : ''}>${esc(r.no)} · ${esc(r.title)}</option>`).join('')}</select></label>
            <label id="po-direct-box" style="grid-column:1/-1"${preReqId ? ' hidden' : ''}>سبب الشراء المباشر دون طلب معتمد (إلزامي)<input id="po-direct" maxlength="300" placeholder="مثال: إصلاح عاجل لمولّدة المبنى A لا يحتمل دورة الطلب"><span class="small">الأمر المباشر استثناء: يعتمده ويرسله للمورد شخص غير منشئه.</span></label>
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
            <div class="form-grid po-head small" style="margin-bottom:2px;grid-template-columns:.8fr 1.3fr 1.6fr .6fr .6fr .9fr 32px;font-weight:700;color:var(--muted)"><span>النوع</span><span>الصنف المخزني</span><span>الوصف</span><span>الواحدة</span><span>الكمية</span><span>سعر الواحدة</span><span></span></div>
            ${initLines.map((ln) => `
              <div class="form-grid po-line" style="margin-bottom:6px;grid-template-columns:.8fr 1.3fr 1.6fr .6fr .6fr .9fr 32px">
                <select class="po-kind" data-no-other="1" aria-label="نوع البند"><option value="stock">مادة مخزنية</option><option value="service">خدمة / أعمال</option><option value="asset">أصل ثابت</option></select>
                <select class="po-item" aria-label="الصنف"><option value="">— صنف مخزني (أو مادة جديدة) —</option>${P.items.map((i) => `<option value="${i.id}" ${ln.itemId === i.id ? 'selected' : ''}>${esc(i.code)} · ${esc(i.name)}</option>`).join('')}</select>
                <input class="po-desc" value="${esc(ln.description || '')}" placeholder="وصف المواد / الخدمات" aria-label="الوصف">
                <input class="po-unit" value="${esc(ln.unit || '')}" placeholder="الواحدة" aria-label="الواحدة">
                <input class="po-qty" type="number" min="1" value="${ln.qty || 1}" placeholder="الكمية" aria-label="الكمية">
                <input class="po-cost" type="number" min="1" value="${ln.estCost || ln.unitCost || ''}" placeholder="مثال: 25000" aria-label="سعر الواحدة">
                <button type="button" class="btn sm dan" data-act="proc-del-line" title="حذف البند" aria-label="حذف البند">✕</button>
              </div>
            `).join('')}
          </div>
          <div class="spread"><button class="btn sm" data-act="proc-add-po-line">+ إضافة بند</button><b id="po-total" class="small">الإجمالي التقديري: ${num(initLines.reduce((t, l) => t + Number(l.qty || 0) * Number(l.estCost || l.unitCost || 0), 0))}</b></div>
          ${preReq ? `<p class="small" style="margin:4px 0 0">البنود مقيّدة بالطلب المعتمد ${esc(preReq.no)}: لا صنف خارجه ولا كمية فوقه، والسعر ضمن هامش الإعدادات.</p>` : ''}
          <div class="form-grid">
            <label>ضريبة المبيعات (إن وُجدت)<input id="po-stax" type="number" value="0" min="0"></label>
            <label>ضريبة التوصيل (إن وُجدت)<input id="po-dtax" type="number" value="0" min="0"></label>
            <label>ضرائب أخرى (إن وُجدت)<input id="po-otax" type="number" value="0" min="0"></label>
          </div>
          <div class="row-end" style="margin-top:12px"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-order">إصدار أمر التوريد</button></div>`);
        document.getElementById('po-req')?.addEventListener('change', (e) => { const box = document.getElementById('po-direct-box'); if (box) box.hidden = !!e.target.value; });
        document.getElementById('po-sup')?.addEventListener('change', (e) => { const box = document.getElementById('po-sup-new'); if (box) box.hidden = e.target.value !== '__new'; if (e.target.value === '__new') document.getElementById('po-sup-name')?.focus(); });
      }
      else if (act === 'proc-save-order') {
        const lines = [...document.querySelectorAll('#po-lines .po-line')].map((r) => ({
          kind: ['service', 'asset'].includes(r.querySelector('.po-kind')?.value) ? r.querySelector('.po-kind').value : 'stock',
          itemId: ['service', 'asset'].includes(r.querySelector('.po-kind')?.value) ? null : (r.querySelector('.po-item').value || null),
          description: r.querySelector('.po-desc').value,
          unit: r.querySelector('.po-unit').value.trim(),
          qty: Number(r.querySelector('.po-qty').value),
          unitCost: Number(r.querySelector('.po-cost').value)
        }));
        const val = (id) => document.getElementById(id).value.trim();
        const supSel = document.getElementById('po-sup').value, typedSup = supSel === '__new';
        if (typedSup && !val('po-sup-name')) { toast('اكتب اسم المورد أو اختره من القائمة.'); return; }
        const badLine = lines.findIndex((l) => !(l.qty > 0) || !(l.unitCost > 0) || !l.description.trim());
        if (badLine >= 0) { toast(`البند ${badLine + 1}: أدخل الوصف والكمية وسعر الواحدة.`); return; }
        if (!document.getElementById('po-req').value && val('po-direct').length < 10) { toast('أمر بلا طلب معتمد: اكتب سبب الشراء المباشر (10 أحرف على الأقل).'); document.getElementById('po-direct')?.focus(); return; }
        await api('POST', '/api/procurement/orders', {
          supplierId: typedSup ? null : Number(supSel),
          supplierName: typedSup ? val('po-sup-name') : '', supplierMobile: typedSup ? val('po-sup-mob') : '', supplierEmail: typedSup ? val('po-sup-mail') : '',
          requestId: document.getElementById('po-req').value || null,
          directReason: document.getElementById('po-req').value ? '' : val('po-direct'),
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
          <h4 style="margin:8px 0 4px">المورّد${o.supplierApproved === false ? ' <span class="badge b-warn">غير معتمد</span>' : ''}</h4>
          ${kv4([['اسم الشركة', o.supplierName], ['شخص التواصل', sp.contactPerson], ['البريد الإلكتروني', sp.email], ['الهاتف', sp.phone], ['الفاكس', sp.fax], ['الموبايل', sp.mobile], ['العنوان', sp.address]])}
          <h4 style="margin:8px 0 4px">عنوان التوصيل / الاستلام وتحرير الفواتير</h4>
          ${kv4([['شخص التواصل للتوصيل', o.deliveryContact], ['البريد الإلكتروني', o.deliveryEmail], ['عنوان التوصيل', o.deliveryAddress], ['جهة الفوترة', 'الجامعة السورية للعلوم الأمنية'], ['شخص التواصل للفوترة', o.billingContact], ['بريد الفوترة', o.billingEmail]])}
          ${kv4([['طريقة التوصيل', o.deliveryMethod], ['تاريخ التوصيل المطلوب', o.deliveryDay], ['شروط الدفع', o.paymentTerms], ['تاريخ الإصدار', fmt(o.createdAt)], ['شروط التوريد', o.note], ...(o.requestId ? [] : [['سبب الشراء المباشر', o.directReason || '—']])])}
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
          <div class="no-print" data-print-skip>
            ${(o.dispatches || []).length ? `<h4 style="margin:10px 0 4px">إرسال الأمر إلى المورد</h4><ul class="small" style="margin:0">${o.dispatches.map((d) => `<li>${esc(CH[d.channel] || d.channel)}${d.recipient ? ` ← ${esc(d.recipient)}` : ''} · ${fmt(d.at)} · ${esc(d.by)}${d.note ? ` · ${esc(d.note)}` : ''}</li>`).join('')}</ul>` : ''}
            <h4 style="margin:10px 0 4px">المرفقات (فاتورة المورد ومذكرة التسليم)</h4>
            ${(o.files || []).length ? `<ul class="small" style="margin:0">${o.files.map((f) => `<li><a href="/api/procurement/order-files/${f.id}" target="_blank" rel="noopener">${esc(f.name)}</a> · ${esc(FILE_KIND[f.kind] || f.kind)} · ${kb(f.size)} · ${esc(f.by)}${can('procurement:manage') ? ` <button class="btn sm dan" data-act="proc-del-file" data-id="${f.id}" data-ord="${o.id}">حذف</button>` : ''}</li>`).join('')}</ul>` : '<p class="small" style="margin:0">لا مرفقات بعد.</p>'}
            ${can('procurement:manage') || can('procurement:stock') ? `<div class="form-grid" style="margin-top:6px">
              <label>نوع المرفق<select id="pof-kind" data-no-other="1">${Object.entries(FILE_KIND).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
              <label>ملف PDF أو صورة (ممسوحة بالسكانر)<input id="pof-file" type="file" accept="application/pdf,image/png,image/jpeg" multiple></label>
              <label>أو تصوير بالكاميرا<input id="pof-cam" type="file" accept="image/*" capture="environment"></label>
            </div>
            <p class="small" style="margin:2px 0 6px">للسكانر: امسح الفاتورة ببرنامج السكانر واحفظها PDF أو صورة ثم اخترها هنا. على الجوال: «تصوير بالكاميرا».</p>
            <button class="btn sm" data-act="proc-up-file" data-id="${o.id}">📎 رفع المرفق</button>` : ''}
          </div>
          <div class="row-end" style="margin-top:12px">
            ${['draft', 'ordered'].includes(o.status) && can('procurement:manage') ? `<button class="btn pri no-print" data-act="proc-send-ord" data-id="${o.id}">📤 ${o.status === 'draft' ? 'اعتماد وإرسال للمورد' : 'إرسال للمورد'}</button>` : ''}
            <button class="btn no-print" data-act="print">🖨️ طباعة أمر الشراء</button>
            <button class="btn pri" data-act="proc-close-modal">إغلاق</button>
          </div>`);
      }
      else if (act === 'proc-send-ord') {
        const { order: o } = await api('GET', `/api/procurement/orders/${b.dataset.id}`);
        const sp = o.supplier || {}, def = { whatsapp: sp.mobile || sp.phone || '', email: sp.email || '', fax: sp.fax || '', print: '', hand: '' };
        showModal(`<h3>📤 إرسال أمر الشراء ${esc(o.no)} إلى المورد</h3>
          <p class="hint" style="margin-top:0">لا يوجد خادم بريد في النظام: يُجهَّز نص الأمر ويُفتح واتساب أو البريد من جهازك لترسله، أو اطبعه وسلّمه. يُسجَّل كل إرسال${o.status === 'draft' ? '، ويُعتمد الأمر بإرساله' : ''}.</p>
          <div class="form-grid">
            <label>المورد<input value="${esc(o.supplierName)}" disabled></label>
            <label>قناة الإرسال<select id="pd-ch" data-no-other="1">${Object.entries(CH).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
            <label>الجهة (رقم أو بريد)<input id="pd-to" maxlength="120" value="${esc(def.whatsapp)}" placeholder="0944123456 أو sales@example.com"></label>
            <label style="grid-column:1/-1">ملاحظة (اختياري)<input id="pd-note" maxlength="300"></label>
          </div>
          ${(o.dispatches || []).length ? `<p class="small">أُرسل سابقاً: ${o.dispatches.map((d) => `${esc(CH[d.channel] || d.channel)} (${fmt(d.at)})`).join('، ')}</p>` : ''}
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-do-dispatch" data-id="${o.id}">${o.status === 'draft' ? 'اعتماد وإرسال' : 'إرسال'}</button></div>`);
        document.getElementById('pd-ch')?.addEventListener('change', (e) => { const to = document.getElementById('pd-to'); if (to) { to.value = def[e.target.value] || ''; to.disabled = ['print', 'hand'].includes(e.target.value); } });
      }
      else if (act === 'proc-do-dispatch') {
        const id = b.dataset.id, ch = document.getElementById('pd-ch').value;
        const r = await api('POST', `/api/procurement/orders/${id}/dispatch`, { channel: ch, recipient: document.getElementById('pd-to').value.trim(), note: document.getElementById('pd-note').value.trim() });
        await refresh();
        if (ch === 'print' || ch === 'hand') { toast(r.approvedNow ? 'اعتُمد الأمر وسُجّل التسليم؛ اطبعه من نافذة العرض' : 'سُجّل التسليم؛ اطبع الأمر من نافذة العرض'); reopenOrder(id); return; }
        // فتح واتساب/البريد يحتاج نقرة من المستخدم (المتصفح يمنع الفتح التلقائي بعد الانتظار)
        showModal(`<h3>✓ ${r.approvedNow ? 'اعتُمد الأمر و' : ''}جُهّز الإرسال عبر ${esc(CH[ch])}</h3>
          ${r.link ? `<p><a class="btn pri" href="${esc(r.link)}" target="_blank" rel="noopener">${ch === 'email' ? '✉️ فتح البريد برسالة الأمر' : '💬 فتح واتساب برسالة الأمر'}</a></p>` : '<p class="small">أرسل النص أدناه بالفاكس أو انسخه.</p>'}
          <label>نص الأمر<textarea id="pd-text" rows="10" readonly style="width:100%">${esc(r.text)}</textarea></label>
          <div class="row-end"><button class="btn" data-act="proc-copy-text">نسخ النص</button><button class="btn" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-copy-text') { try { await navigator.clipboard.writeText(document.getElementById('pd-text').value); toast('نُسخ النص'); } catch { document.getElementById('pd-text').select(); toast('حدّد النص وانسخه يدوياً'); } }
      else if (act === 'proc-up-file') {
        const files = [...(document.getElementById('pof-file')?.files || []), ...(document.getElementById('pof-cam')?.files || [])];
        if (!files.length) { toast('اختر ملفاً أو صوّر الفاتورة أولاً.'); return; }
        const payload = await Promise.all(files.map(async (f) => ({ name: f.name || 'scan.jpg', data: await readB64(f) })));
        await api('POST', `/api/procurement/orders/${b.dataset.id}/files`, { kind: document.getElementById('pof-kind').value, files: payload });
        toast(`رُفع ${files.length} مرفق`); reopenOrder(b.dataset.id);
      }
      else if (act === 'proc-del-file') {
        if (!confirm('حذف هذا المرفق نهائياً؟')) return;
        await api('DELETE', `/api/procurement/order-files/${b.dataset.id}`); toast('حُذف المرفق'); reopenOrder(b.dataset.ord);
      }
      else if (act === 'proc-qr-scan') { await scanQr(b.dataset.target); }
      else if (act === 'proc-qr-gen') {
        const r = await api('POST', `/api/procurement/items/${b.dataset.id}/qr`, { generate: true });
        const i = P.items.find((x) => x.id === Number(b.dataset.id)); if (i) i.qrCode = r.item.qrCode;
        const fld = document.getElementById('pi-qr'); if (fld) { fld.value = r.item.qrCode; toast('وُلّد الرمز وحُفظ'); return; }
        toast('وُلّد رمز QR للصنف'); await refresh();
        const t = document.createElement('button'); t.dataset.act = 'proc-qr-show'; t.dataset.id = b.dataset.id; t.hidden = true; document.body.appendChild(t); t.click(); t.remove();
      }
      else if (act === 'proc-qr-show') {
        const i = P.items.find((x) => x.id === Number(b.dataset.id));
        showModal(`<div data-doc-title="ملصق صنف" data-doc-no="${esc(i ? i.code : '')}"></div><h3>رمز QR للصنف ${esc(i ? `${i.code} · ${i.name}` : '')}</h3>
          <div style="text-align:center"><img src="/api/procurement/items/${b.dataset.id}/qr.svg?t=${Date.now()}" alt="رمز QR" style="width:220px;height:220px;image-rendering:pixelated"><div class="mono small">${esc(i ? i.qrCode : '')}</div></div>
          <div class="row-end"><button class="btn no-print" data-act="print">🖨️ طباعة الملصق</button><button class="btn" data-act="proc-close-modal">إغلاق</button></div>`);
      }
      else if (act === 'proc-approve-sup') {
        await api('PUT', `/api/procurement/suppliers/${b.dataset.id}`, { approved: true }); toast('اعتُمد المورد'); await refresh();
      }
      else if (act === 'proc-can-ord') { if (!confirm('إلغاء أمر التوريد؟ إن كان ناتجاً عن طلب شراء يعود الطلب «معتمداً» ليُصدر له أمر جديد.')) return; await api('POST', `/api/procurement/orders/${b.dataset.id}/cancel`, {}); toast('أُلغي أمر التوريد'); await refresh(); }

      else if (act === 'proc-new-receipt' || act === 'proc-rcv-from-ord') {
        {
          const [or, it] = await Promise.all([api('GET', '/api/procurement/orders?status=ordered'), P.items.length ? { items: P.items } : api('GET', '/api/procurement/items')]);
          P.orders = [...or.orders, ...P.orders.filter((x) => x.status !== 'ordered')]; P.items = it.items;
        }
        if (!P.warehouses.length) P.warehouses = (await api('GET', '/api/procurement/warehouses')).warehouses;
        const ordList = P.orders.filter((o) => o.status === 'ordered');
        if (!ordList.length) { toast('لا توجد أوامر توريد بحالة «مرسل للمورد» بانتظار الاستلام'); return; }
        const preOrdId = act === 'proc-rcv-from-ord' ? Number(b.dataset.id) : ordList[0].id;
        const selOrd = ordList.find((o) => o.id === preOrdId) || ordList[0];
        // بنود الاستلام من بنود أمر الشراء: الكمية المتوقعة والمستلمة وفحص الجودة لكل بند
        // بند بلا صنف مخزني (مادة جديدة): يُعرَّف صنفاً عند استلامه باسمه ووحدته ومستودعه
        const left = (l) => Math.max(0, Number(l.remainingQty ?? (Number(l.qty) - Number(l.receivedQty || 0))));
        const qtyCell = (l) => `<span style="align-self:center" class="small">المطلوب ${num(l.qty)}<br>المستلم سابقاً ${num(l.receivedQty || 0)}<br><b>المتبقي ${num(left(l))}</b></span>`;
        const newRow = (l) => `
          <div class="form-grid prc-line prc-new" data-line="${l.id}" data-expected="${l.qty}" style="margin-bottom:8px;grid-template-columns:1.8fr .9fr .8fr 1fr 1.4fr;border:1px dashed #C9A24B;border-radius:8px;padding:6px">
            <span style="align-self:center"><b>${esc(l.description)}</b> <span class="badge b-warn">صنف جديد</span><div class="small">يُعرَّف في المخزون عند الاستلام</div></span>
            ${qtyCell(l)}
            <input class="prc-qty" type="number" min="0" max="${left(l)}" value="${left(l)}" aria-label="الكمية المستلمة">
            <select class="prc-quality" aria-label="فحص الجودة">${QUALITY.map((q) => `<option>${esc(q)}</option>`).join('')}</select>
            <input class="prc-comment" placeholder="تعليقات" aria-label="تعليقات">
            <input class="prc-nname" value="${esc(l.description)}" maxlength="80" placeholder="اسم الصنف" aria-label="اسم الصنف الجديد">
            <input class="prc-nunit" value="${esc(l.unit || 'قطعة')}" maxlength="20" placeholder="الوحدة" aria-label="وحدة الصنف الجديد">
            <input class="prc-ncode" maxlength="20" placeholder="رمز الصنف (تلقائي إن تُرك)" aria-label="رمز الصنف الجديد">
            <select class="prc-nwh" data-no-other="1" aria-label="مستودع الصنف الجديد"><option value="">المستودع: من طلب الشراء</option>${P.warehouses.filter((w) => w.active).map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
          </div>`;
        const svcRow = (l) => `
          <div class="form-grid prc-line prc-svc" data-line="${l.id}" data-expected="${l.qty}" style="margin-bottom:6px;grid-template-columns:1.8fr .9fr .8fr 1fr 1.4fr">
            <span style="align-self:center"><b>${esc(l.description)}</b> ${l.kind === 'asset' ? '<span class="badge b-ok">أصل ثابت</span><div class="small">يُسجَّل أصلاً لكل وحدة برمز تلقائي</div>' : '<span class="badge b-info">خدمة / أعمال</span><div class="small">تُستلم بالإنجاز دون حركة مخزن</div>'}</span>
            ${qtyCell(l)}
            <input class="prc-qty" type="number" min="0" max="${left(l)}" value="${left(l)}" aria-label="الكمية المنجزة">
            <select class="prc-quality" aria-label="فحص الجودة">${QUALITY.map((q) => `<option>${esc(q)}</option>`).join('')}</select>
            <input class="prc-comment" placeholder="تعليقات" aria-label="تعليقات">
          </div>`;
        const rcvRows = (o) => {
          const open = (o?.lines || []).filter((l) => left(l) > 0);
          if (!open.length) return '<p class="small">استُلمت كل بنود هذا الأمر.</p>';
          return open.filter((l) => l.kind === 'service' || l.kind === 'asset').map(svcRow).join('') + open.filter((l) => l.kind === 'stock' && !l.itemId).map(newRow).join('') + open.filter((l) => l.kind === 'stock' && l.itemId).map((l) => `
          <div class="form-grid prc-line" data-item="${l.itemId}" data-expected="${l.qty}" style="margin-bottom:6px;grid-template-columns:1.8fr .9fr .8fr 1fr 1.4fr">
            <span style="align-self:center"><b>${esc(l.itemName || l.description)}</b> <span class="small">(${esc(l.unit || '')})</span></span>
            ${qtyCell(l)}
            <input class="prc-qty" type="number" min="0" max="${left(l)}" value="${left(l)}" aria-label="الكمية المستلمة">
            <select class="prc-quality" aria-label="فحص الجودة">${QUALITY.map((q) => `<option>${esc(q)}</option>`).join('')}</select>
            <input class="prc-comment" placeholder="تعليقات" aria-label="تعليقات">
          </div>`).join('');
        };
        showModal(`<h3>📥 تسجيل مذكرة فحص واستلام مواد</h3>
          <div class="form-grid">
            <label>أمر الشراء (PO)<select id="prc-ord">${ordList.map((o) => `<option value="${o.id}" ${o.id === selOrd.id ? 'selected' : ''}>${esc(o.no)} · ${esc(o.supplierName)}</option>`).join('')}</select></label>
            <label>تم الاستلام من (المورّد / المتبرع)<input id="prc-from" placeholder="اسم المورّد افتراضيًا"></label>
            <label>رقم بيان الشحنة / مذكرة التسليم<input id="prc-dn" placeholder="DN-0000"></label>
            <label>موقع المستلم<input id="prc-loc" placeholder="المخزن الرئيسي"></label>
            <label>مستودع الاستلام<select id="prc-wh" data-no-other="1"><option value="">— مستودع الطلب أو مستودع كل صنف —</option>${P.warehouses.filter((w) => w.active).map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></label>
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
          ...(r.classList.contains('prc-svc') ? { orderLineId: Number(r.dataset.line) } : r.classList.contains('prc-new')
            ? { orderLineId: Number(r.dataset.line), newItem: { name: r.querySelector('.prc-nname').value.trim(), unit: r.querySelector('.prc-nunit').value.trim(), code: r.querySelector('.prc-ncode').value.trim(), warehouseId: r.querySelector('.prc-nwh').value || null } }
            : { itemId: Number(r.dataset.item) }),
          expectedQty: Number(r.dataset.expected),
          qty: Number(r.querySelector('.prc-qty').value),
          quality: r.querySelector('.prc-quality').value,
          comment: r.querySelector('.prc-comment').value.trim()
        })).filter((l) => l.qty > 0);
        if (!lines.length) { toast('أدخل كمية مستلمة لبند واحد على الأقل'); return; }
        const rcv = await api('POST', '/api/procurement/receipts', {
          orderId: Number(document.getElementById('prc-ord').value),
          note: document.getElementById('prc-note').value,
          receivedFrom: document.getElementById('prc-from').value.trim(),
          deliveryNoteNo: document.getElementById('prc-dn').value.trim(),
          location: document.getElementById('prc-loc').value.trim(),
          warehouseId: Number(document.getElementById('prc-wh')?.value) || null,
          compliant: document.getElementById('prc-ok').value === '1',
          lines
        });
        closeModal(); P.tab = 'movements'; P.moveMode = 'receipts'; await refresh();
        if (rcv && rcv.journalError) showModal(`<h3>⚠️ استُلمت البضاعة ودخلت المخزون بلا قيد محاسبي</h3><p>${esc(rcv.journalError)}</p><p class="small">أُبلغ من يملك ترحيل القيود. بعد معالجة السبب يُرحَّل القيد من سجل مذكرات الاستلام بزر «ترحيل القيد».</p><div class="row-end"><button class="btn pri" data-act="proc-close-modal">فهمت</button></div>`);
        else toast(rcv && rcv.status === 'received' ? 'استُلم الأمر كاملاً وحُدّث المخزون' : 'سُجّل استلام جزئي؛ الأمر بانتظار باقي الكميات');
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
              <select class="pis-item" aria-label="المادة">${whItemOptions(P.warehouses.filter((w) => w.active)[0]?.id)}</select>
              <input class="pis-req" type="number" min="1" value="1" placeholder="المطلوبة" aria-label="الكمية المطلوبة">
              <input class="pis-qty" type="number" min="1" value="1" placeholder="المصروفة" aria-label="الكمية المصروفة">
              <select class="pis-cond" aria-label="حالة المادة">${CONDITION.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
              <input class="pis-note" placeholder="ملاحظات" aria-label="ملاحظات">
            </div>
          </div>
          <button class="btn sm" data-act="proc-add-issue-line">+ إضافة مادة أخرى</button>
          <p class="small">تظهر المواد الموجودة في المستودع المصدِّر فقط، برصيدها فيه.</p>
          <div class="row-end"><button class="btn" data-act="proc-close-modal">إلغاء</button><button class="btn pri" data-act="proc-save-issue">اعتماد الصرف وتخفيض الرصيد</button></div>`);
        document.getElementById('pis-wh')?.addEventListener('change', (ev) => { document.querySelectorAll('#pis-lines .pis-item').forEach((sel) => { sel.innerHTML = whItemOptions(ev.target.value); }); });
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
        const isr = await api('POST', '/api/procurement/issues', {
          warehouseId: Number(document.getElementById('pis-wh').value),
          requestRef: val('pis-ref'), department: val('pis-dept'), receiverName: val('pis-recv'),
          purpose: document.getElementById('pis-purpose').value,
          lines: [...document.querySelectorAll('#pis-lines .pis-line')].map((r) => ({
            itemId: Number(r.querySelector('.pis-item').value), requestedQty: Number(r.querySelector('.pis-req').value), qty: Number(r.querySelector('.pis-qty').value),
            itemCondition: r.querySelector('.pis-cond').value, note: r.querySelector('.pis-note').value.trim()
          }))
        });
        closeModal(); P.tab = 'movements'; P.moveMode = 'issues'; await refresh();
        toast(isr && isr.journalError ? `صُرفت المواد، لكن تعذّر قيدها المحاسبي: ${isr.journalError} (أُبلغت المالية)` : 'تم تحرير إذن الصرف وترحيل قيده');
      }

      else if (act === 'proc-new-asset' || act === 'proc-edit-asset') {
        const cur = act === 'proc-edit-asset' ? P.assets.find((x) => x.id === Number(b.dataset.id)) : null;
        showModal(`<h3>${cur ? 'تعديل بطاقة أصل ثابت' : 'تسجيل أصل ثابت جديد في السجل الرأسمالي'}</h3>
          <div class="form-grid">
            <label>رمز الأصل الثابت${cur ? '' : ' (فارغ = تلقائي)'}<input id="pa-code" value="${esc(cur?.code || '')}" placeholder="تلقائي: AST-2026-00001"></label>
            <label>الرقم التسلسلي للجهاز<input id="pa-serial" maxlength="60" value="${esc(cur?.serialNo || '')}" placeholder="مثال: 5CG1234XYZ" dir="ltr"></label>
            <label>اسم الأصل والوصف<input id="pa-name" value="${esc(cur?.name || '')}" placeholder="حاسوب محمول Dell Latitude"></label>
            <label>الفئة<input id="pa-cat" value="${esc(cur?.category || 'أجهزة حاسوب')}"></label>
            <label>المستودع / الموقع<select id="pa-wh"><option value="">— اختر —</option>${P.warehouses.map((w) => `<option value="${w.id}" ${cur?.warehouseId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
            <label>التكلفة الرأسمالية (ل.س)<input id="pa-cost" type="number" value="${cur?.cost ?? 0}"></label>
            <label>تاريخ الشراء<input id="pa-day" type="date" value="${esc(cur?.purchaseDay || new Date().toISOString().slice(0, 10))}"></label>
            <label>العهدة المسندة إلى (الموظف / القسم)<input id="pa-user" value="${esc(cur?.assignedTo || '')}" placeholder="مخبر الشبكات - قاعة 2"></label>
            <label>العمر الإنتاجي (أشهر، 0 = بلا إهلاك)<input id="pa-life" type="number" min="0" max="600" step="1" value="${cur?.usefulLifeMonths ?? 60}"${cur?.accumulated ? ' disabled' : ''}></label>
            <label>القيمة التخريدية (ل.س)<input id="pa-salvage" type="number" min="0" value="${cur?.salvageValue ?? 0}"${cur?.accumulated ? ' disabled' : ''}></label>
            <label>بدء الإهلاك<input id="pa-depstart" type="date" value="${esc(cur?.depreciationStart || '')}"></label>
            ${cur?.accumulated ? `<p class="small" style="grid-column:1/-1">أُهلك منه ${money(cur.accumulated)}؛ القيمة الدفترية ${money(cur.bookValue)}. لا يُغيَّر عمره ولا قيمته التخريدية بعد بدء الإهلاك.</p>` : ''}
            <label>حالة الأصل<select id="pa-st"${cur?.status === 'disposed' ? ' disabled' : ''}>${Object.entries(ASSET_STATUS).filter(([k]) => k !== 'disposed' || cur?.status === 'disposed').map(([k, [l]]) => `<option value="${k}" ${cur?.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><span class="small">الإتلاف بحركة «إتلاف» موثقة بسبب.</span></label>
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
          status: document.getElementById('pa-st').value,
          serialNo: document.getElementById('pa-serial').value.trim(),
          ...(document.getElementById('pa-life').disabled ? {} : { usefulLifeMonths: Number(document.getElementById('pa-life').value || 0), salvageValue: Number(document.getElementById('pa-salvage').value || 0) }),
          depreciationStart: document.getElementById('pa-depstart').value
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
