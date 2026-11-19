import { recheckOrderInvoices } from '../finance/invoices.js';
import { approvedBudgets } from '../finance/budgets.js';
import { HttpError } from '../../http.js';
import * as P from './core.js';
import * as X from './extras.js';
import { stageFiles, removeStaged } from '../staging.js';
import { sendRaw } from '../../http.js';
const need = (ctx, perm) => { if (!ctx.user.can(perm)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
export async function registerProcurement(r, deps){
  const { db } = deps;
  const g = (perm, fn, code=200) => async (c) => { need(c, perm); const res = await fn(c, c.body??{}, c.query??{}); if(res==null) return c.json(204,{}); return c.json(code, res); };
  const gc = (perm, fn) => g(perm, fn, 201);
  // مقدّم طلب الشراء يرى الأصناف والمستودعات لتعبئة طلبه، وطلباته هو فقط
  // معتمدو المراحل المالية والعليا يطّلعون على الطلبات ليبتّوا فيها
  const canSeeAll = (c) => c.user.can('procurement:read') || c.user.can('procurement:approve_finance') || c.user.can('procurement:approve_top');
  const forRequester = (fn) => async (c) => { if (!canSeeAll(c)) need(c, 'procurement:request'); return c.json(200, await fn(c, c.body ?? {}, c.query ?? {})); };
  r.add('GET','/api/procurement/overview', g('procurement:read', ()=>P.overview(db)));
  // دفتر الحركات: بطاقة الصنف، والرصيد بتاريخ، ومطابقة الدفتر مع الأرصدة
  r.add('GET','/api/procurement/items/:id/card', g('procurement:read', (c,_b,q)=>P.itemCard(db,c.params.id,q)));
  r.add('GET','/api/procurement/transfers', g('procurement:read', (_c,_b,q)=>({transfers:P.listTransfers(db,q), inTransit:P.inTransit(db)})));
  r.add('POST','/api/procurement/transfers', gc('procurement:stock', (c,b)=>P.createTransfer(deps,c.user,b,c.ip)));
  r.add('POST','/api/procurement/transfers/:id/receive', g('procurement:stock', (c,b)=>P.receiveTransfer(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/transfers/:id/cancel', g('procurement:stock', (c,b)=>P.cancelTransfer(deps,c.user,c.params.id,b,c.ip)));
  // قيود المخزون: ما لم يُرحَّل قيده، وإعادة ترحيله، ومطابقة المخزون مع حساب المخزون
  r.add('GET','/api/procurement/unposted', g('procurement:read', ()=>P.unpostedStock(db)));
  r.add('POST','/api/procurement/unposted/:kind/:id/post', g('finance:post', (c)=>P.repostStockJournal(deps,c.user,c.params.kind,c.params.id,c.ip)));
  r.add('GET','/api/procurement/gl-reconcile', g('procurement:read', ()=>P.glReconcile(db)));
  r.add('GET','/api/procurement/stock-at', g('procurement:read', (_c,_b,q)=>P.stockAt(db,q)));
  r.add('GET','/api/procurement/ledger-check', g('procurement:read', ()=>P.ledgerCheck(db)));
  r.add('GET','/api/procurement/stock-staff', g('procurement:manage', ()=>({staff:P.stockStaff(db)})));
  r.add('GET','/api/procurement/warehouses', forRequester(()=>({warehouses:P.listWarehouses(db)})));
  r.add('POST','/api/procurement/warehouses', gc('procurement:manage', (c,b)=>P.createWarehouse(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/warehouses/:id', g('procurement:manage', (c,b)=>P.updateWarehouse(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/warehouses/:id/toggle', g('procurement:manage', (c,b)=>P.toggleWarehouse(deps,c.user,c.params.id, b?.active!==false, c.ip)));
  r.add('DELETE','/api/procurement/warehouses/:id', g('procurement:manage', (c)=>P.deleteWarehouse(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/suppliers', g('procurement:read', (_c,_b,q)=>{ const m={}; const suppliers=P.listSuppliers(db,q,m); return {suppliers, total:m.total, page:Number(q.page)||1}; }));
  r.add('POST','/api/procurement/suppliers', gc('procurement:manage', (c,b)=>P.createSupplier(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/suppliers/:id', g('procurement:manage', (c,b)=>P.updateSupplier(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/suppliers/:id/toggle', g('procurement:manage', (c,b)=>P.toggleSupplier(deps,c.user,c.params.id, b?.active!==false, c.ip)));
  r.add('DELETE','/api/procurement/suppliers/:id', g('procurement:manage', (c)=>P.deleteSupplier(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/categories', forRequester(()=>({categories:P.listCategories(db)})));
  r.add('POST','/api/procurement/categories', g('procurement:manage', (c,b)=>P.saveCategory(deps,c.user,b,c.ip)));
  // دليل الوحدات وتحويلات الصنف الخاصة
  r.add('GET','/api/procurement/units', forRequester(()=>({units:P.listUnits(db)})));
  r.add('POST','/api/procurement/units', g('procurement:manage', (c,b)=>P.saveUnit(deps,c.user,b,c.ip)));
  r.add('GET','/api/procurement/items/:id/units', g('procurement:read', (c)=>({units:P.itemUnitsOf(db,c.params.id)})));
  r.add('PUT','/api/procurement/items/:id/units', g('procurement:manage', (c,b)=>P.setItemUnits(deps,c.user,c.params.id,b,c.ip)));
  r.add('GET','/api/procurement/items', forRequester((_c,_b,q)=>{ const m={}; const items=P.listItems(db,q,m); return {items, total:m.total, page:Number(q.page)||1}; }));
  r.add('POST','/api/procurement/items', gc('procurement:manage', (c,b)=>P.createItem(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/items/:id', g('procurement:manage', (c,b)=>P.updateItem(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/items/:id/adjust', g('procurement:adjust', (c,b)=>P.adjustItemStock(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/items/:id/toggle', g('procurement:manage', (c,b)=>P.toggleItem(deps,c.user,c.params.id, b?.active!==false, c.ip)));
  r.add('DELETE','/api/procurement/items/:id', g('procurement:manage', (c)=>P.deleteItem(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/requests', forRequester((c,_b,q)=>{ const m={}; const requests=P.listRequests(db, canSeeAll(c) ? q : { ...q, mine: c.user.id }, m); return {requests, total:m.total, page:Number(q.page)||1}; }));
  r.add('GET','/api/procurement/requests/:id', forRequester((c)=>{ const out=P.getRequest(db,c.params.id); if(!canSeeAll(c) && out.request.requesterId!==c.user.id) throw new HttpError(404,'طلب الشراء غير موجود.','not_found'); return out; }));
  r.add('POST','/api/procurement/requests', gc('procurement:request', (c,b)=>P.createRequest(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/requests/:id', g('procurement:request', (c,b)=>P.updateRequest(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/requests/:id/submit', g('procurement:request', (c)=>P.submitRequest(deps,c.user,c.params.id,c.ip)));
  // كل مرحلة اعتماد تتحقق من صلاحيتها داخل decideRequest
  const approver = (perm, fn) => async (c) => { if (!['procurement:manage', 'procurement:approve_finance', 'procurement:approve_top'].some((p) => c.user.can(p))) throw new HttpError(403, 'لا تملك صلاحية اعتماد طلبات الشراء.', 'forbidden'); return c.json(200, await fn(c, c.body ?? {})); };
  r.add('POST','/api/procurement/requests/:id/approve', approver('procurement:manage', (c,b)=>P.decideRequest(deps,c.user,c.params.id,'approved', b?.note, c.ip)));
  r.add('POST','/api/procurement/requests/:id/reject', approver('procurement:manage', (c,b)=>P.decideRequest(deps,c.user,c.params.id,'rejected', b?.note, c.ip)));
  r.add('POST','/api/procurement/requests/replenish', gc('procurement:request', (c)=>P.replenishRequest(deps,c.user,c.ip)));
  r.add('POST','/api/procurement/requests/:id/return', approver('procurement:manage', (c,b)=>P.returnRequest(deps,c.user,c.params.id,b?.note,c.ip)));
  r.add('POST','/api/procurement/requests/:id/cancel', g('procurement:request', (c)=>P.cancelRequest(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/orders', g('procurement:read', (_c,_b,q)=>{ const m={}; const orders=P.listOrders(db,q,m); return {orders, total:m.total, page:Number(q.page)||1}; }));
  r.add('GET','/api/procurement/orders/:id', g('procurement:read', (c)=>P.getOrder(db,c.params.id)));
  r.add('POST','/api/procurement/orders', gc('procurement:manage', (c,b)=>P.createOrder(deps,c.user,b,c.ip)));
  r.add('POST','/api/procurement/orders/:id/order', g('procurement:manage', (c)=>P.orderAction(deps,c.user,c.params.id,'order',c.ip)));
  r.add('POST','/api/procurement/orders/:id/cancel', g('procurement:manage', (c)=>P.orderAction(deps,c.user,c.params.id,'cancel',c.ip)));
  r.add('GET','/api/procurement/receipts', g('procurement:read', (_c,_b,q)=>{ const m={}; const receipts=P.listReceipts(db,q,m); return {receipts, total:m.total, page:Number(q.page)||1}; }));
  // الاستلام اللاحق يعيد مطابقة فواتير الأمر الموقوفة، فتُصدر المطابِقة منها
  r.add('POST','/api/procurement/receipts', gc('procurement:stock', (c,b)=>{ const out=P.createReceipt(deps,c.user,b,c.ip); recheckOrderInvoices(deps,c.user,b?.orderId,c.ip); return out; }));
  // سند استلام دخل المخزون بلا قيد (حساب أو سنة مالية ناقصة): يُعاد ترحيله بعد معالجة السبب
  r.add('POST','/api/procurement/receipts/:id/post-journal', g('finance:post', (c)=>P.repostReceiptJournal(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/budgets', g('procurement:manage', ()=>({budgets:approvedBudgets(deps)})));
  r.add('GET','/api/procurement/issues', g('procurement:read', (_c,_b,q)=>{ const m={}; const issues=P.listIssues(db,q,m); return {issues, total:m.total, page:Number(q.page)||1}; }));
  r.add('POST','/api/procurement/issues', gc('procurement:stock', (c,b)=>P.createIssue(deps,c.user,b,c.ip)));
  r.add('GET','/api/procurement/assets', g('procurement:read', (_c,_b,q)=>{ const m={}; const assets=P.listAssets(db,q,m); return {assets, total:m.total, page:Number(q.page)||1}; }));
  r.add('POST','/api/procurement/assets', gc('procurement:assets', (c,b)=>P.createAsset(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/assets/:id', g('procurement:assets', (c,b)=>P.updateAsset(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/assets/:id/move', g('procurement:assets', (c,b)=>P.moveAsset(deps,c.user,c.params.id,b,c.ip)));
  r.add('DELETE','/api/procurement/assets/:id', g('procurement:assets', (c)=>P.deleteAsset(deps,c.user,c.params.id,c.ip)));
  // إرسال أمر الشراء إلى المورد (يعتمد المسودة)، ومرفقات الأمر (الفاتورة وغيرها)
  r.add('POST','/api/procurement/orders/:id/dispatch', g('procurement:manage', (c,b)=>X.dispatchOrder(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/orders/:id/files', async (c)=>{
    if (!c.user.can('procurement:manage') && !c.user.can('procurement:stock')) need(c,'procurement:manage');
    const staged = await stageFiles(deps.cfg, c.body?.files);
    try { c.json(201, X.addOrderFiles(deps,c.user,c.params.id,c.body??{},c.ip)); } finally { await removeStaged(staged); }
  });
  r.add('GET','/api/procurement/order-files/:fid', async (c)=>{
    need(c,'procurement:read');
    const f = await X.readOrderFile(deps,c.params.fid);
    sendRaw(c.res, 200, { 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'Cache-Control': 'private, no-store' }, f.buf);
  });
  r.add('DELETE','/api/procurement/order-files/:fid', g('procurement:manage', (c)=>X.deleteOrderFile(deps,c.user,c.params.fid,c.ip)));
  // رمز QR للصنف: توليد أو حفظ رمز مقروء، وصورته، والبحث بالرمز
  r.add('POST','/api/procurement/items/:id/qr', g('procurement:manage', (c,b)=>X.setItemQr(deps,c.user,c.params.id,b,c.ip)));
  r.add('GET','/api/procurement/items/:id/qr.svg', (c)=>{ need(c,'procurement:read'); sendRaw(c.res, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store' }, X.itemQrSvg(deps,c.params.id)); });
  r.add('GET','/api/procurement/item-by-qr', forRequester((_c,_b,q)=>X.itemByQr(deps,q.code)));
  // تصدير Excel للمخزون
  r.add('GET','/api/procurement/items.xlsx', async (c)=>{
    need(c,'procurement:read');
    const items=P.listItems(db, c.query);
    const { writeXlsx } = await import('../../lib/xlsx.js');
    const buf = await writeXlsx([{name:'المخزون', rows: items.map(x=>[x.code,x.name,x.categoryName??'',x.warehouseName??'',x.unit,x.qtyOnHand,x.avgCost,x.minStock]), headers:['الرمز','الصنف','التصنيف','المخزن','الوحدة','الرصيد','متوسط التكلفة','الحد الأدنى']}]);
    c.res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.res.setHeader('Content-Disposition','attachment; filename="stock.xlsx"');
    c.res.end(buf);
  });
}
