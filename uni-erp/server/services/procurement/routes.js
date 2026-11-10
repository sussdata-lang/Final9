import { recheckOrderInvoices } from '../finance/invoices.js';
import { approvedBudgets } from '../finance/budgets.js';
import { HttpError } from '../../http.js';
import * as P from './core.js';
const need = (ctx, perm) => { if (!ctx.user.can(perm)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
export async function registerProcurement(r, deps){
  const { db } = deps;
  const g = (perm, fn, code=200) => async (c) => { need(c, perm); const res = await fn(c, c.body??{}, c.query??{}); if(res==null) return c.json(204,{}); return c.json(code, res); };
  const gc = (perm, fn) => g(perm, fn, 201);
  // مقدّم طلب الشراء يرى الأصناف والمستودعات لتعبئة طلبه، وطلباته هو فقط
  const canSeeAll = (c) => c.user.can('procurement:read');
  const forRequester = (fn) => async (c) => { if (!canSeeAll(c)) need(c, 'procurement:request'); return c.json(200, await fn(c, c.body ?? {}, c.query ?? {})); };
  r.add('GET','/api/procurement/overview', g('procurement:read', ()=>P.overview(db)));
  r.add('GET','/api/procurement/warehouses', forRequester(()=>({warehouses:P.listWarehouses(db)})));
  r.add('POST','/api/procurement/warehouses', gc('procurement:manage', (c,b)=>P.createWarehouse(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/warehouses/:id', g('procurement:manage', (c,b)=>P.updateWarehouse(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/warehouses/:id/toggle', g('procurement:manage', (c,b)=>P.toggleWarehouse(deps,c.user,c.params.id, b?.active!==false, c.ip)));
  r.add('DELETE','/api/procurement/warehouses/:id', g('procurement:manage', (c)=>P.deleteWarehouse(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/suppliers', g('procurement:read', (_c,_b,q)=>({suppliers:P.listSuppliers(db,q)})));
  r.add('POST','/api/procurement/suppliers', gc('procurement:manage', (c,b)=>P.createSupplier(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/suppliers/:id', g('procurement:manage', (c,b)=>P.updateSupplier(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/suppliers/:id/toggle', g('procurement:manage', (c,b)=>P.toggleSupplier(deps,c.user,c.params.id, b?.active!==false, c.ip)));
  r.add('DELETE','/api/procurement/suppliers/:id', g('procurement:manage', (c)=>P.deleteSupplier(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/categories', g('procurement:read', ()=>({categories:P.listCategories(db)})));
  r.add('GET','/api/procurement/items', forRequester((_c,_b,q)=>({items:P.listItems(db,q)})));
  r.add('POST','/api/procurement/items', gc('procurement:manage', (c,b)=>P.createItem(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/items/:id', g('procurement:manage', (c,b)=>P.updateItem(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/items/:id/adjust', g('procurement:stock', (c,b)=>P.adjustItemStock(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/items/:id/toggle', g('procurement:manage', (c,b)=>P.toggleItem(deps,c.user,c.params.id, b?.active!==false, c.ip)));
  r.add('DELETE','/api/procurement/items/:id', g('procurement:manage', (c)=>P.deleteItem(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/requests', forRequester((c,_b,q)=>({requests:P.listRequests(db, canSeeAll(c) ? q : { ...q, mine: c.user.id })})));
  r.add('GET','/api/procurement/requests/:id', forRequester((c)=>{ const out=P.getRequest(db,c.params.id); if(!canSeeAll(c) && out.request.requesterId!==c.user.id) throw new HttpError(404,'طلب الشراء غير موجود.','not_found'); return out; }));
  r.add('POST','/api/procurement/requests', gc('procurement:request', (c,b)=>P.createRequest(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/requests/:id', g('procurement:request', (c,b)=>P.updateRequest(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/requests/:id/submit', g('procurement:request', (c)=>P.submitRequest(deps,c.user,c.params.id,c.ip)));
  r.add('POST','/api/procurement/requests/:id/approve', g('procurement:manage', (c,b)=>P.decideRequest(deps,c.user,c.params.id,'approved', b?.note, c.ip)));
  r.add('POST','/api/procurement/requests/:id/reject', g('procurement:manage', (c,b)=>P.decideRequest(deps,c.user,c.params.id,'rejected', b?.note, c.ip)));
  r.add('POST','/api/procurement/requests/:id/cancel', g('procurement:request', (c)=>P.cancelRequest(deps,c.user,c.params.id,c.ip)));
  r.add('GET','/api/procurement/orders', g('procurement:read', (_c,_b,q)=>({orders:P.listOrders(db,q)})));
  r.add('GET','/api/procurement/orders/:id', g('procurement:read', (c)=>P.getOrder(db,c.params.id)));
  r.add('POST','/api/procurement/orders', gc('procurement:manage', (c,b)=>P.createOrder(deps,c.user,b,c.ip)));
  r.add('POST','/api/procurement/orders/:id/order', g('procurement:manage', (c)=>P.orderAction(deps,c.user,c.params.id,'order',c.ip)));
  r.add('POST','/api/procurement/orders/:id/cancel', g('procurement:manage', (c)=>P.orderAction(deps,c.user,c.params.id,'cancel',c.ip)));
  r.add('GET','/api/procurement/receipts', g('procurement:read', (_c,_b,q)=>({receipts:P.listReceipts(db,q)})));
  // الاستلام اللاحق يعيد مطابقة فواتير الأمر الموقوفة، فتُصدر المطابِقة منها
  r.add('POST','/api/procurement/receipts', gc('procurement:stock', (c,b)=>{ const out=P.createReceipt(deps,c.user,b,c.ip); recheckOrderInvoices(deps,c.user,b?.orderId,c.ip); return out; }));
  r.add('GET','/api/procurement/budgets', g('procurement:manage', ()=>({budgets:approvedBudgets(deps)})));
  r.add('GET','/api/procurement/issues', g('procurement:read', (_c,_b,q)=>({issues:P.listIssues(db,q)})));
  r.add('POST','/api/procurement/issues', gc('procurement:stock', (c,b)=>P.createIssue(deps,c.user,b,c.ip)));
  r.add('GET','/api/procurement/assets', g('procurement:read', (_c,_b,q)=>({assets:P.listAssets(db,q)})));
  r.add('POST','/api/procurement/assets', gc('procurement:assets', (c,b)=>P.createAsset(deps,c.user,b,c.ip)));
  r.add('PUT','/api/procurement/assets/:id', g('procurement:assets', (c,b)=>P.updateAsset(deps,c.user,c.params.id,b,c.ip)));
  r.add('POST','/api/procurement/assets/:id/move', g('procurement:assets', (c,b)=>P.moveAsset(deps,c.user,c.params.id,b,c.ip)));
  r.add('DELETE','/api/procurement/assets/:id', g('procurement:assets', (c)=>P.deleteAsset(deps,c.user,c.params.id,c.ip)));
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
