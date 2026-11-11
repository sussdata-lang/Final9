// المشتريات والمخازن والأصول — النواة
import { getSetting } from '../settings.js';
import { effective } from '../../permissions.js';
import { checkOrderBudget, validBudgetForOrder } from '../finance/budgets.js';
import { tx } from '../../db.js';
import { nextNumber } from '../numbering.js';
import { audit } from '../../audit.js';
import { HttpError } from '../../http.js';
export const bad = (m, s=400, code='validation') => new HttpError(s, m, code);
const clean = (s, max, label, min=1) => {
  const v = String(s??'').replace(/\s+/g,' ').trim();
  if(v.length < min || v.length > max) throw bad(`«${label}» بين ${min} و${max} حرفاً.`);
  if(/[\x00-\x1f<>]/.test(v)) throw bad(`«${label}» يحوي رموزاً غير مسموحة.`);
  return v;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s) => DAY.test(String(s)) && !isNaN(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Damascus'}).format(new Date());
export { clean };
// حقول نماذج الجامعة الاختيارية: الفارغ يُحفظ فارغاً، وغير الفارغ يُنظَّف ويُتحقق منه
const opt = (v, max, label) => (v === undefined || v === null || String(v).trim() === '') ? '' : clean(v, max, label, 0);
const optDay = (v, label) => { const s = String(v ?? '').trim(); if (!s) return ''; if (!isDay(s)) throw bad(`«${label}» بصيغة 2026-12-31.`); return s; };
const optInt = (v, label) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw bad(`«${label}» رقم غير سالب.`); return Math.round(n); };
const nonNeg = (v, label) => optInt(v, label) ?? 0;
const nextNo = (db, prefix, table) => {
  const y = today().slice(0,4);
  const head = `${prefix}-${y}-`;
  const n = nextNumber(db, `${table}:${head}`, `SELECT MAX(CAST(substr(no, ?) AS INTEGER)) FROM ${table} WHERE no LIKE ?`, [head.length + 1, `${head}%`]);
  return `${prefix}-${y}-${String(n).padStart(5,'0')}`;
};
/* Warehouses */
export function listWarehouses(db){ return db.prepare('SELECT w.*, u.display_name manager_name FROM proc_warehouses w LEFT JOIN users u ON u.id=w.manager_id ORDER BY w.code').all().map(r=>({id:r.id,code:r.code,name:r.name,location:r.location,managerId:r.manager_id,managerName:r.manager_name,active:!!r.active,createdAt:r.created_at})); }
export function createWarehouse({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز المخزن'); if(!/^[A-Z0-9.-]+$/i.test(code)) throw bad('رمز المخزن: حروف وأرقام و . - فقط.');
  const name=clean(b?.name,80,'اسم المخزن',2);
  if(db.prepare('SELECT 1 FROM proc_warehouses WHERE code=?').get(code)) throw bad('رمز المخزن مستخدم.',409,'conflict');
  const loc = String(b?.location??'').slice(0,120);
  const mid = b?.managerId ? Number(b.managerId) : null;
  if(mid && !db.prepare('SELECT 1 FROM users WHERE id=?').get(mid)) throw bad('مسؤول المخزن غير موجود.');
  const id=Number(db.prepare('INSERT INTO proc_warehouses (code,name,location,manager_id,created_at) VALUES (?,?,?,?,?)').run(code,name,loc,mid,Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة مخزن',code,ip); return {warehouse: db.prepare('SELECT * FROM proc_warehouses WHERE id=?').get(id)};
}
export function updateWarehouse({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_warehouses WHERE id=?').get(Number(id)); if(!cur) throw bad('المخزن غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز المخزن'):cur.code; const name=b?.name?clean(b.name,80,'اسم المخزن',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_warehouses WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز المخزن مستخدم.',409,'conflict');
  const loc = b?.location!==undefined?String(b.location).slice(0,120):cur.location;
  const mid = b?.managerId!==undefined?(b.managerId?Number(b.managerId):null):cur.manager_id;
  db.prepare('UPDATE proc_warehouses SET code=?,name=?,location=?,manager_id=? WHERE id=?').run(code,name,loc,mid,cur.id);
  audit(db,actor,'تعديل مخزن',code,ip); return {warehouse: db.prepare('SELECT * FROM proc_warehouses WHERE id=?').get(cur.id)};
}
export function toggleWarehouse({db},actor,id,on,ip){
  const r=db.prepare('UPDATE proc_warehouses SET active=? WHERE id=?').run(on?1:0,Number(id)); if(!r.changes) throw bad('المخزن غير موجود.',404,'not_found');
  audit(db,actor,on?'تفعيل مخزن':'تعطيل مخزن',String(id),ip); return {ok:true};
}
export function deleteWarehouse({db},actor,id,ip){
  const cur=db.prepare('SELECT * FROM proc_warehouses WHERE id=?').get(Number(id)); if(!cur) throw bad('المخزن غير موجود.',404,'not_found');
  if(db.prepare('SELECT 1 FROM proc_items WHERE warehouse_id=? LIMIT 1').get(cur.id)) throw bad('المخزن مرتبط بأصناف فلا يُحذف؛ عطّله.',409,'conflict');
  if(db.prepare('SELECT 1 FROM proc_requests WHERE warehouse_id=? LIMIT 1').get(cur.id)) throw bad('المخزن مرتبط بطلبات فلا يُحذف.',409,'conflict');
  db.prepare('DELETE FROM proc_warehouses WHERE id=?').run(cur.id); audit(db,actor,'حذف مخزن',cur.code,ip); return {ok:true};
}
/* Suppliers */
export function listSuppliers(db,q={}){
  const w=[],a=[]; if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(name LIKE ? ESCAPE "\\" OR code LIKE ? ESCAPE "\\")'); a.push(l,l); }
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT * FROM proc_suppliers ${where} ORDER BY name LIMIT 200`).all(...a).map(r=>({id:r.id,code:r.code,name:r.name,phone:r.phone,email:r.email,address:r.address,taxNo:r.tax_no,contactPerson:r.contact_person,fax:r.fax,mobile:r.mobile,specialty:r.specialty,active:!!r.active,createdAt:r.created_at}));
}
const supExtra = (b, cur = {}) => ['contactPerson', 'fax', 'mobile', 'specialty'].map((k, i) => (b?.[k] !== undefined ? opt(b[k], [80, 30, 30, 120][i], ['شخص التواصل', 'الفاكس', 'الموبايل', 'مجال التخصص'][i]) : (cur[['contact_person', 'fax', 'mobile', 'specialty'][i]] ?? '')));
export function createSupplier({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز المورد'); const name=clean(b?.name,80,'اسم المورد',2);
  if(db.prepare('SELECT 1 FROM proc_suppliers WHERE code=?').get(code)) throw bad('رمز المورد مستخدم.',409,'conflict');
  const id=Number(db.prepare('INSERT INTO proc_suppliers (code,name,phone,email,address,tax_no,contact_person,fax,mobile,specialty,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(code,name,b?.phone??null,b?.email??null,b?.address??null,b?.taxNo??null,...supExtra(b),Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة مورد',code,ip); return {supplier: db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(id)};
}
export function updateSupplier({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(Number(id)); if(!cur) throw bad('المورد غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز المورد'):cur.code; const name=b?.name?clean(b.name,80,'اسم المورد',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_suppliers WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز المورد مستخدم.',409,'conflict');
  db.prepare('UPDATE proc_suppliers SET code=?,name=?,phone=?,email=?,address=?,tax_no=?,contact_person=?,fax=?,mobile=?,specialty=? WHERE id=?').run(code,name,b?.phone??cur.phone,b?.email??cur.email,b?.address??cur.address,b?.taxNo??cur.tax_no,...supExtra(b,cur),cur.id);
  audit(db,actor,'تعديل مورد',code,ip); return {supplier: db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(cur.id)};
}
export function toggleSupplier({db},actor,id,on,ip){
  const r=db.prepare('UPDATE proc_suppliers SET active=? WHERE id=?').run(on?1:0,Number(id)); if(!r.changes) throw bad('المورد غير موجود.',404,'not_found');
  audit(db,actor,on?'تفعيل مورد':'تعطيل مورد',String(id),ip); return {ok:true};
}
export function deleteSupplier({db},actor,id,ip){
  const cur=db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(Number(id)); if(!cur) throw bad('المورد غير موجود.',404,'not_found');
  if(db.prepare('SELECT 1 FROM proc_orders WHERE supplier_id=? LIMIT 1').get(cur.id)) throw bad('المورد مرتبط بأوامر توريد فلا يُحذف؛ عطّله.',409,'conflict');
  db.prepare('DELETE FROM proc_suppliers WHERE id=?').run(cur.id); audit(db,actor,'حذف مورد',cur.code,ip); return {ok:true};
}
/* Categories */
export function listCategories(db){ return db.prepare('SELECT * FROM proc_categories ORDER BY code').all().map(r=>({id:r.id,code:r.code,name:r.name,active:!!r.active})); }
/* Items */
export function listItems(db,q={}){
  const w=[],a=[];
  if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(i.name LIKE ? ESCAPE "\\" OR i.code LIKE ? ESCAPE "\\")'); a.push(l,l); }
  if(q.warehouse) { w.push('i.warehouse_id=?'); a.push(Number(q.warehouse)); }
  if(q.category) { w.push('i.category_id=?'); a.push(Number(q.category)); }
  if(q.low==='1') w.push('i.qty_on_hand <= i.min_stock AND i.min_stock > 0');
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT i.*, c.name catName, w.name whName FROM proc_items i LEFT JOIN proc_categories c ON c.id=i.category_id LEFT JOIN proc_warehouses w ON w.id=i.warehouse_id ${where} ORDER BY i.code LIMIT 500`).all(...a).map(r=>({id:r.id,code:r.code,name:r.name,categoryId:r.category_id,categoryName:r.catName,unit:r.unit,warehouseId:r.warehouse_id,warehouseName:r.whName,qtyOnHand:r.qty_on_hand,avgCost:r.avg_cost,minStock:r.min_stock,maxStock:r.max_stock,active:!!r.active,notes:r.notes,low: r.min_stock>0 && r.qty_on_hand<=r.min_stock}));
}
export function createItem({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز الصنف'); const name=clean(b?.name,80,'اسم الصنف',2);
  if(db.prepare('SELECT 1 FROM proc_items WHERE code=?').get(code)) throw bad('رمز الصنف مستخدم.',409,'conflict');
  const catId=b?.categoryId?Number(b.categoryId):null; if(catId && !db.prepare('SELECT 1 FROM proc_categories WHERE id=?').get(catId)) throw bad('التصنيف غير موجود.');
  const whId=b?.warehouseId?Number(b.warehouseId):null; if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=? AND active=1').get(whId)) throw bad('المخزن غير موجود أو معطّل.');
  const unit=clean(b?.unit??'قطعة',20,'الوحدة'); const minS=Number(b?.minStock??0), maxS=Number(b?.maxStock??0);
  const id=Number(db.prepare('INSERT INTO proc_items (code,name,category_id,unit,warehouse_id,min_stock,max_stock,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(code,name,catId,unit,whId,minS,maxS,String(b?.notes??'').slice(0,300),Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة صنف',code,ip); return {item: db.prepare('SELECT * FROM proc_items WHERE id=?').get(id)};
}
export function updateItem({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_items WHERE id=?').get(Number(id)); if(!cur) throw bad('الصنف غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز الصنف'):cur.code; const name=b?.name?clean(b.name,80,'اسم الصنف',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_items WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز الصنف مستخدم.',409,'conflict');
  const catId=b?.categoryId!==undefined?(b.categoryId?Number(b.categoryId):null):cur.category_id;
  const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):cur.warehouse_id;
  const unit=b?.unit?clean(b.unit,20,'الوحدة'):cur.unit;
  const minS=b?.minStock!==undefined?Number(b.minStock):cur.min_stock; const maxS=b?.maxStock!==undefined?Number(b.maxStock):cur.max_stock;
  db.prepare('UPDATE proc_items SET code=?,name=?,category_id=?,unit=?,warehouse_id=?,min_stock=?,max_stock=?,notes=? WHERE id=?').run(code,name,catId,unit,whId,minS,maxS, b?.notes!==undefined?String(b.notes).slice(0,300):cur.notes, cur.id);
  audit(db,actor,'تعديل صنف',code,ip); return {item: db.prepare('SELECT * FROM proc_items WHERE id=?').get(cur.id)};
}
export function toggleItem({db},actor,id,on,ip){
  const r=db.prepare('UPDATE proc_items SET active=? WHERE id=?').run(on?1:0,Number(id)); if(!r.changes) throw bad('الصنف غير موجود.',404,'not_found');
  audit(db,actor,on?'تفعيل صنف':'تعطيل صنف',String(id),ip); return {ok:true};
}
export function deleteItem({db},actor,id,ip){
  const cur=db.prepare('SELECT * FROM proc_items WHERE id=?').get(Number(id)); if(!cur) throw bad('الصنف غير موجود.',404,'not_found');
  if(cur.qty_on_hand>0) throw bad('الصنف به رصيد فلا يُحذف.',409,'conflict');
  if(db.prepare('SELECT 1 FROM proc_request_lines WHERE item_id=? LIMIT 1').get(cur.id) || db.prepare('SELECT 1 FROM proc_order_lines WHERE item_id=? LIMIT 1').get(cur.id)) throw bad('الصنف مستخدم في طلبات أو أوامر فلا يُحذف.',409,'conflict');
  db.prepare('DELETE FROM proc_items WHERE id=?').run(cur.id); audit(db,actor,'حذف صنف',cur.code,ip); return {ok:true};
}
/* Requests */
export function listRequests(db,q={}){
  const w=[],a=[]; if(q.status) { w.push('r.status=?'); a.push(q.status); } if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(r.no LIKE ? ESCAPE "\\" OR r.title LIKE ? ESCAPE "\\")'); a.push(l,l); }
  if(q.mine) { w.push('r.requester_id=?'); a.push(Number(q.mine)); }
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT r.*, u.display_name requester_name FROM proc_requests r LEFT JOIN users u ON u.id=r.requester_id ${where} ORDER BY r.id DESC LIMIT 300`).all(...a).map(r=>({stage: r.status==='pending' ? (approvalStage(db,r).next?.label ?? null) : null, ...reqView(db,r)}));
}
const reqLines = (db, id) => db.prepare('SELECT l.*, i.name itemName, i.code itemCode FROM proc_request_lines l LEFT JOIN proc_items i ON i.id=l.item_id WHERE l.request_id=? ORDER BY l.id').all(id)
  .map(x=>({id:x.id,itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,description:x.description,qty:x.qty,estCost:x.est_cost,note:x.note,budgetCode:x.budget_code,specs:x.specs,unit:x.unit,stockBalance:x.stock_balance==null?null:Number(x.stock_balance)}));
const reqView = (db, r) => ({id:r.id,no:r.no,title:r.title,description:r.description,requesterId:r.requester_id,requesterName:r.requester_name,warehouseId:r.warehouse_id,status:r.status,requestedAt:r.requested_at,decidedBy:r.decided_by,decidedAt:r.decided_at,decisionNote:r.decision_note,createdAt:r.created_at,
  department:r.department,jobTitle:r.job_title,directManager:r.direct_manager,purchaseThreshold:r.purchase_threshold,needDay:r.need_day,amountWords:r.amount_words,lines:reqLines(db,r.id)});
// بيانات رأس طلب الشراء من نموذج الجامعة
const REQ_HEAD = [['department','department',80,'القسم الطالب'],['jobTitle','job_title',80,'المسمى الوظيفي'],['directManager','direct_manager',80,'المسؤول المباشر'],['purchaseThreshold','purchase_threshold',60,'عتبة الشراء'],['amountWords','amount_words',200,'المبلغ كتابةً']];
const reqHead = (b, cur = {}) => [...REQ_HEAD.map(([k, col, max, label]) => (b?.[k] !== undefined ? opt(b[k], max, label) : (cur[col] ?? ''))), b?.needDay !== undefined ? optDay(b.needDay, 'تاريخ الحاجة') : (cur.need_day ?? '')];
// البند يحفظ رصيد المستودع لحظة الطلب، ووحدة الصنف إن لم تُذكر
function insertReqLines(db, id, lines){
  for(const l of lines){
    const item = l.itemId ? db.prepare('SELECT qty_on_hand, unit FROM proc_items WHERE id=?').get(Number(l.itemId)) : null;
    db.prepare('INSERT INTO proc_request_lines (request_id,item_id,description,qty,est_cost,note,budget_code,specs,unit,stock_balance) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, l.itemId?Number(l.itemId):null, clean(l.description,100,'وصف البند',1), Number(l.qty), Number(l.estCost??0), String(l.note??'').slice(0,200),
        opt(l.budgetCode,40,'رمز الموازنة'), opt(l.specs,300,'المواصفات'), opt(l.unit,20,'الواحدة') || item?.unit || '', item ? Number(item.qty_on_hand) : optInt(l.stockBalance,'رصيد المستودع'));
  }
}
export function getRequest(db,id){
  const r=db.prepare('SELECT r.*, u.display_name requester_name FROM proc_requests r LEFT JOIN users u ON u.id=r.requester_id WHERE r.id=?').get(Number(id)); if(!r) throw bad('طلب الشراء غير موجود.',404,'not_found');
  return {request:{approval:approvalStage(db,r),...reqView(db,r)}};
}
export function createRequest({db},actor,b,ip){
  const title=clean(b?.title,100,'عنوان الطلب',3); const desc=String(b?.description??'').slice(0,500);
  const whId=b?.warehouseId?Number(b.warehouseId):null; if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المخزن غير موجود.');
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  if(lines.length>50) throw bad('حتى 50 بنداً للطلب.');
  for(let i=0;i<lines.length;i++){ const l=lines[i]; clean(l?.description,100,`وصف البند ${i+1}`,2); if(Number(l?.qty)<=0) throw bad(`البند ${i+1}: الكمية غير صالحة.`); if(l.itemId && !db.prepare('SELECT 1 FROM proc_items WHERE id=?').get(Number(l.itemId))) throw bad(`البند ${i+1}: الصنف غير موجود.`); }
  const head = reqHead(b);
  return tx(db,()=>{
    const no=nextNo(db,'PRQ','proc_requests');
    const id=Number(db.prepare('INSERT INTO proc_requests (no,title,description,requester_id,warehouse_id,status,created_at,department,job_title,direct_manager,purchase_threshold,amount_words,need_day) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(no,title,desc,actor.id,whId,'draft',Date.now(),...head).lastInsertRowid);
    insertReqLines(db, id, lines);
    if(b?.submit){
      db.prepare("UPDATE proc_requests SET status='pending', requested_at=? WHERE id=?").run(Date.now(),id);
      audit(db,actor,'تقديم طلب شراء',no,ip);
    } else audit(db,actor,'إنشاء طلب شراء',no,ip);
    return getRequest(db,id);
  });
}
export function submitRequest({db},actor,id,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(r.requester_id!==actor.id && !actor.can('procurement:manage')) throw bad('لا تملك صلاحية إرسال هذا الطلب.',403,'forbidden');
  if(r.status!=='draft') throw bad('الطلب ليس مسودة.',409,'conflict');
  db.prepare("UPDATE proc_requests SET status='pending', requested_at=? WHERE id=?").run(Date.now(),r.id); audit(db,actor,'إرسال طلب شراء',r.no,ip); return getRequest(db,r.id);
}
/* مراحل اعتماد طلب الشراء: إدارة المشتريات دائماً، ثم المالية ورئاسة الجامعة فوق حدودهما في الإعدادات.
   كل مرحلة بيد شخص مختلف، ولا يعتمد مقدّم الطلب طلبه. */
const LEVELS = { 1: ['procurement:manage', 'إدارة المشتريات'], 2: ['procurement:approve_finance', 'الاعتماد المالي'], 3: ['procurement:approve_top', 'رئاسة الجامعة'] };
export function approvalStage(db, r) {
  const total = Number(db.prepare('SELECT COALESCE(SUM(qty * est_cost), 0) AS v FROM proc_request_lines WHERE request_id = ?').get(r.id).v);
  const fin = Number(getSetting(db, 'procurement.approval_finance_above')), top = Number(getSetting(db, 'procurement.approval_top_above'));
  const required = [1, ...(fin > 0 && total > fin ? [2] : []), ...(top > 0 && total > top ? [3] : [])];
  const done = db.prepare('SELECT a.*, u.display_name AS by_name FROM proc_request_approvals a LEFT JOIN users u ON u.id = a.user_id WHERE a.request_id = ? ORDER BY a.level').all(r.id);
  const next = r.status === 'pending' ? required.find((l) => !done.some((d) => Number(d.level) === l)) : undefined;
  return {
    total, required: required.map((l) => LEVELS[l][1]),
    done: done.map((d) => ({ level: Number(d.level), label: LEVELS[d.level][1], userId: Number(d.user_id), by: d.by_name, at: Number(d.decided_at), note: d.note })),
    next: next ? { level: next, label: LEVELS[next][1], perm: LEVELS[next][0], last: next === required[required.length - 1] } : null,
  };
}
const holdersOf = (db, perm) => db.prepare("SELECT * FROM users WHERE role <> 'student' AND active = 1").all().filter((u) => effective(db, u).includes(perm)).map((u) => u.id);

export function decideRequest({db},actor,id,decision,note,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(r.status!=='pending') throw bad('الطلب ليس قيد المراجعة.',409,'conflict');
  if(!['approved','rejected'].includes(decision)) throw bad('قرار غير صالح.');
  const st=approvalStage(db,r), next=st.next;
  if(!actor.can(next.perm)) throw bad(`هذه المرحلة تخص: ${next.label}.`,403,'forbidden');
  if(decision==='approved' && r.requester_id && Number(r.requester_id)===Number(actor?.id)) throw bad('خرق سياسة فصل المهام (SoD): لا يجوز لمقدم طلب الشراء اعتماده بنفسه.',403,'sod_violation');
  if(decision==='approved' && st.done.some((d)=>d.userId===Number(actor.id))) throw bad('اعتمدت مرحلة سابقة من هذا الطلب؛ تعتمد كل مرحلة يدٌ مختلفة.',403,'sod_violation');
  const n=String(note??'').slice(0,300); if(decision==='rejected' && !n.trim()) throw bad('سبب الرفض مطلوب.');
  return tx(db,()=>{
    if(decision==='approved') db.prepare('INSERT INTO proc_request_approvals (request_id,level,user_id,note,decided_at) VALUES (?,?,?,?,?)').run(r.id,next.level,actor.id,n,Date.now());
    if(decision==='rejected' || next.last){
      db.prepare('UPDATE proc_requests SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?').run(decision,actor.id,Date.now(),n,r.id);
      audit(db,actor,decision==='approved'?'اعتماد طلب شراء':`رفض طلب شراء (${next.label})`,r.no,ip);
    } else {
      const after=approvalStage(db,r).next;
      audit(db,actor,`اعتماد مرحلي لطلب شراء (${next.label})`,r.no,ip);
      const ins=db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING");
      for(const u of holdersOf(db,after.perm)) if(Number(u)!==Number(r.requester_id)) ins.run(u,`proc_request_${after.level}`,r.id,`طلب الشراء ${r.no} (${r.title}) بانتظار ${after.label}.`,Date.now());
    }
    return getRequest(db,r.id);
  });
}
export function cancelRequest({db},actor,id,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(!['draft','pending'].includes(r.status)) throw bad('لا يمكن إلغاء الطلب في حالته الحالية.',409,'conflict');
  if(r.requester_id!==actor.id && !actor.can('procurement:manage')) throw bad('لا تملك صلاحية الإلغاء.',403,'forbidden');
  db.prepare("UPDATE proc_requests SET status='cancelled' WHERE id=?").run(r.id); audit(db,actor,'إلغاء طلب شراء',r.no,ip); return {ok:true};
}
export function updateRequest({db},actor,id,b,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(r.status!=='draft') throw bad('لا يمكن تعديل الطلب بعد إرساله.',409,'conflict');
  if(r.requester_id!==actor.id && !actor.can('procurement:manage')) throw bad('لا تملك صلاحية التعديل.',403,'forbidden');
  return tx(db,()=>{
    const title=b?.title?clean(b.title,100,'عنوان الطلب',3):r.title;
    const desc=b?.description!==undefined?String(b.description).slice(0,500):r.description;
    const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):r.warehouse_id;
    db.prepare('UPDATE proc_requests SET title=?,description=?,warehouse_id=?,department=?,job_title=?,direct_manager=?,purchase_threshold=?,amount_words=?,need_day=? WHERE id=?').run(title,desc,whId,...reqHead(b,r),r.id);
    if(Array.isArray(b?.lines)){
      db.prepare('DELETE FROM proc_request_lines WHERE request_id=?').run(r.id);
      insertReqLines(db, r.id, b.lines);
    }
    if(b?.submit){ db.prepare("UPDATE proc_requests SET status='pending', requested_at=? WHERE id=?").run(Date.now(),r.id); audit(db,actor,'تعديل وإرسال طلب شراء',r.no,ip); } else audit(db,actor,'تعديل طلب شراء',r.no,ip);
    return getRequest(db,r.id);
  });
}
/* Orders */
export function listOrders(db,q={}){
  const w=[],a=[]; if(q.status){w.push('o.status=?');a.push(q.status);} if(q.supplier){w.push('o.supplier_id=?');a.push(Number(q.supplier));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`${ORDER_SELECT} ${where} ORDER BY o.id DESC LIMIT 300`).all(...a).map(r=>orderView(db,r));
}
const ORDER_SELECT = `SELECT o.*, s.name supplierName, s.contact_person sup_contact, s.email sup_email, s.phone sup_phone, s.fax sup_fax, s.mobile sup_mobile, s.address sup_address, r.no requestNo
  FROM proc_orders o JOIN proc_suppliers s ON s.id=o.supplier_id LEFT JOIN proc_requests r ON r.id=o.request_id`;
// أمر الشراء ببيانات المورّد والتوصيل والفوترة والضرائب كما في نموذج الجامعة
const orderView = (db, r) => {
  const taxes = Number(r.sales_tax||0) + Number(r.delivery_tax||0) + Number(r.other_tax||0);
  return {id:r.id,no:r.no,requestId:r.request_id,requestNo:r.requestNo,supplierId:r.supplier_id,supplierName:r.supplierName,status:r.status,totalAmount:r.total_amount,orderedAt:r.ordered_at,receivedAt:r.received_at,note:r.note,createdBy:r.created_by,createdAt:r.created_at,
    supplier:{contactPerson:r.sup_contact??'',email:r.sup_email??'',phone:r.sup_phone??'',fax:r.sup_fax??'',mobile:r.sup_mobile??'',address:r.sup_address??''},
    deliveryMethod:r.delivery_method,deliveryDay:r.delivery_day,paymentTerms:r.payment_terms,currency:r.currency,
    deliveryContact:r.delivery_contact,deliveryEmail:r.delivery_email,deliveryAddress:r.delivery_address,billingContact:r.billing_contact,billingEmail:r.billing_email,
    salesTax:Number(r.sales_tax||0),deliveryTax:Number(r.delivery_tax||0),otherTax:Number(r.other_tax||0),grandTotal:Number(r.total_amount||0)+taxes,
    lines:db.prepare('SELECT l.*, i.name itemName, i.code itemCode FROM proc_order_lines l LEFT JOIN proc_items i ON i.id=l.item_id WHERE l.order_id=? ORDER BY l.id').all(r.id).map(x=>({id:x.id,itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,description:x.description,qty:x.qty,unitCost:x.unit_cost,lineTotal:x.line_total,unit:x.unit}))};
};
const ORDER_HEAD = [['deliveryMethod','delivery_method',60,'طريقة التوصيل'],['paymentTerms','payment_terms',120,'شروط الدفع'],['currency','currency',20,'العملة'],['deliveryContact','delivery_contact',80,'شخص التواصل للتوصيل'],['deliveryEmail','delivery_email',120,'بريد التوصيل'],['deliveryAddress','delivery_address',160,'عنوان التوصيل'],['billingContact','billing_contact',80,'شخص التواصل للفوترة'],['billingEmail','billing_email',120,'بريد الفوترة']];
const orderHead = (b) => [...ORDER_HEAD.map(([k, , max, label]) => opt(b?.[k], max, label)), optDay(b?.deliveryDay, 'تاريخ التوصيل المطلوب'), nonNeg(b?.salesTax, 'ضريبة المبيعات'), nonNeg(b?.deliveryTax, 'ضريبة التوصيل'), nonNeg(b?.otherTax, 'الضرائب الأخرى')];
export function getOrder(db,id){
  const r=db.prepare(`${ORDER_SELECT} WHERE o.id=?`).get(Number(id)); if(!r) throw bad('أمر التوريد غير موجود.',404,'not_found');
  return {order:orderView(db,r)};
}
export function createOrder({db},actor,b,ip){
  const supId=Number(b?.supplierId); if(!supId || !db.prepare('SELECT 1 FROM proc_suppliers WHERE id=? AND active=1').get(supId)) throw bad('المورد غير موجود أو معطّل.');
  const reqId=b?.requestId?Number(b.requestId):null;
  const budgetId=validBudgetForOrder(db, b?.budgetId?Number(b.budgetId):null);
  if(reqId){ const rq=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(reqId); if(!rq) throw bad('طلب الشراء غير موجود.',404,'not_found'); if(rq.status!=='approved') throw bad('طلب الشراء ليس معتمداً.',409,'conflict'); if(db.prepare("SELECT 1 FROM proc_orders WHERE request_id=? AND status!='cancelled' LIMIT 1").get(reqId)) throw bad('يوجد أمر توريد مرتبط بهذا الطلب.',409,'conflict'); }
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  for(let i=0;i<lines.length;i++){ const l=lines[i]; clean(l?.description,100,`وصف البند ${i+1}`,2); if(Number(l?.qty)<=0) throw bad(`البند ${i+1}: الكمية غير صالحة.`); if(Number(l?.unitCost)<0) throw bad(`البند ${i+1}: سعر الوحدة غير صالح.`); }
  const head = orderHead(b); if (!head[2]) head[2] = 'ليرة سورية';
  return tx(db,()=>{
    const no=nextNo(db,'PO','proc_orders');
    const total=lines.reduce((s,l)=>s+Number(l.qty)*Number(l.unitCost||0),0);
    const id=Number(db.prepare('INSERT INTO proc_orders (no,request_id,supplier_id,status,total_amount,note,created_by,created_at,budget_id,delivery_method,payment_terms,currency,delivery_contact,delivery_email,delivery_address,billing_contact,billing_email,delivery_day,sales_tax,delivery_tax,other_tax) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(no,reqId,supId,'draft',total,String(b?.note??'').slice(0,300),actor.id,Date.now(),budgetId,...head).lastInsertRowid);
    for(const l of lines){
      const unit = opt(l.unit,20,'الواحدة') || (l.itemId ? (db.prepare('SELECT unit FROM proc_items WHERE id=?').get(Number(l.itemId))?.unit ?? '') : '');
      db.prepare('INSERT INTO proc_order_lines (order_id,item_id,description,qty,unit_cost,line_total,unit) VALUES (?,?,?,?,?,?,?)').run(id,l.itemId?Number(l.itemId):null,clean(l.description,100,'وصف البند',1),Number(l.qty),Number(l.unitCost||0),Number(l.qty)*Number(l.unitCost||0),unit);
    }
    if(reqId) db.prepare("UPDATE proc_requests SET status='ordered' WHERE id=?").run(reqId);
    audit(db,actor,'إنشاء أمر توريد',no,ip); return getOrder(db,id);
  });
}
export function orderAction({db},actor,id,action,ip){
  const o=db.prepare('SELECT * FROM proc_orders WHERE id=?').get(Number(id)); if(!o) throw bad('أمر التوريد غير موجود.',404,'not_found');
  if(action==='order'){ if(o.status!=='draft') throw bad('الأمر ليس مسودة.',409,'conflict'); const warn=checkOrderBudget(db,o); if(warn) audit(db,actor,'تجاوز موازنة بأمر توريد (تحذير)',`${o.no}: ${warn}`,ip); db.prepare("UPDATE proc_orders SET status='ordered', ordered_at=? WHERE id=?").run(Date.now(),o.id); audit(db,actor,'إرسال أمر توريد',o.no,ip); }
  else if(action==='cancel'){ if(!['draft','ordered'].includes(o.status)) throw bad('لا يمكن الإلغاء.',409,'conflict'); db.prepare("UPDATE proc_orders SET status='cancelled' WHERE id=?").run(o.id); audit(db,actor,'إلغاء أمر توريد',o.no,ip); }
  else throw bad('إجراء غير صالح.');
  return getOrder(db,o.id);
}
/* Receipts */
export function createReceipt({db},actor,b,ip){
  const orderId=Number(b?.orderId); const o=db.prepare('SELECT * FROM proc_orders WHERE id=?').get(orderId); if(!o) throw bad('أمر التوريد غير موجود.',404,'not_found');
  if(o.status!=='ordered') throw bad('أمر التوريد ليس مرسلاً.',409,'conflict');
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  const orderLines=db.prepare('SELECT * FROM proc_order_lines WHERE order_id=?').all(orderId);
  const prevRows=db.prepare('SELECT rl.item_id, COALESCE(SUM(rl.qty),0) AS r_qty FROM proc_receipt_lines rl JOIN proc_receipts r ON r.id=rl.receipt_id WHERE r.order_id=? AND r.reversed_at IS NULL GROUP BY rl.item_id').all(orderId);
  const prevByItem=new Map(prevRows.map(x=>[Number(x.item_id),Number(x.r_qty)]));
  // بيانات مذكرة فحص واستلام المواد من نموذج الجامعة
  const supName = db.prepare('SELECT name FROM proc_suppliers WHERE id=?').get(o.supplier_id)?.name ?? '';
  const rHead = [opt(b?.receivedFrom,120,'تم الاستلام من') || supName, opt(b?.deliveryNoteNo,60,'رقم بيان الشحنة / مذكرة التسليم'), opt(b?.location,120,'موقع المستلم'), b?.compliant === true ? 1 : b?.compliant === false ? 0 : null];
  return tx(db,()=>{
    const rid=Number(db.prepare('INSERT INTO proc_receipts (order_id,received_at,note,created_by,created_at,received_from,delivery_note_no,location,compliant) VALUES (?,?,?,?,?,?,?,?,?)').run(orderId,Date.now(),String(b?.note??'').slice(0,300),actor.id,Date.now(),...rHead).lastInsertRowid);
    let receiptTotal=0;
    for(const l of lines){
      const itemId=Number(l.itemId); if(!itemId || !db.prepare('SELECT 1 FROM proc_items WHERE id=?').get(itemId)) throw bad('الصنف غير موجود.');
      const qty=Number(l.qty); if(qty<=0) throw bad('الكمية غير صالحة.');
      const ol=orderLines.find(x=>Number(x.item_id)===itemId);
      if(orderLines.length && !ol) throw bad(`الصنف #${itemId} غير مدرج في أمر الشراء ${o.no}.`,400,'item_not_in_order');
      const alreadyReceived=prevByItem.get(itemId)||0;
      if(ol && alreadyReceived+qty > Number(ol.qty)+1e-6){
        throw bad(`الكمية المستلمة (${qty}) تتجاوز الكمية المتبقية في أمر الشراء (المطلوب: ${ol.qty}، المستلم سابقاً: ${alreadyReceived}).`,409,'over_receipt_qty');
      }
      const hasCustomCost = l.unitCost !== undefined && l.unitCost !== null && l.unitCost !== '';
      const cost = hasCustomCost ? Number(l.unitCost) : Number(ol?.unit_cost ?? 0);
      if(cost < 0) throw bad('سعر الوحدة غير صالح.');
      if(ol && Number(ol.unit_cost) > 0 && cost > Number(ol.unit_cost) + 1e-4){
        throw bad(`سعر الوحدة المستلم (${cost}) يتجاوز السعر المعتمد في أمر الشراء (${ol.unit_cost}).`,409,'over_receipt_cost');
      }
      prevByItem.set(itemId, alreadyReceived+qty);
      receiptTotal += qty * cost;
      const expected = l.expectedQty !== undefined && l.expectedQty !== null && l.expectedQty !== '' ? optInt(l.expectedQty,'الكمية المتوقعة') : (ol ? Number(ol.qty) : null);
      db.prepare('INSERT INTO proc_receipt_lines (receipt_id,item_id,qty,unit_cost,expected_qty,quality,comment) VALUES (?,?,?,?,?,?,?)').run(rid,itemId,qty,cost,expected,opt(l.quality,30,'فحص الجودة'),opt(l.comment,200,'التعليقات'));
      const it=db.prepare('SELECT qty_on_hand, avg_cost FROM proc_items WHERE id=?').get(itemId);
      const newQty=it.qty_on_hand+qty;
      const newAvg=newQty>0?Math.round((it.avg_cost*it.qty_on_hand + cost*qty)/newQty):cost;
      db.prepare('UPDATE proc_items SET qty_on_hand=?, avg_cost=? WHERE id=?').run(newQty,newAvg,itemId);
    }
    const allReceived = !orderLines.length || orderLines.every(ol => !ol.item_id || (prevByItem.get(Number(ol.item_id)) || 0) >= Number(ol.qty) - 1e-6);
    if (allReceived) {
      db.prepare("UPDATE proc_orders SET status='received', received_at=? WHERE id=?").run(Date.now(),orderId);
    }
    let journalEntryId = null;
    if (receiptTotal > 0) {
      try {
        const invAcc = db.prepare("SELECT id FROM fin_accounts WHERE system_key='inventory' OR code='1301' LIMIT 1").get();
        const supAcc = db.prepare("SELECT id FROM fin_accounts WHERE system_key='suppliers' OR code='2101' LIMIT 1").get();
        const openYear = db.prepare("SELECT id, name FROM fin_years WHERE status='open' ORDER BY start_day DESC LIMIT 1").get();
        if (invAcc && supAcc && openYear) {
          const minorAmt = Math.round(receiptTotal * 100);
          const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());
          const seq = nextNumber(db, `fin:${openYear.id}:JV`, "SELECT MAX(seq) FROM fin_entries WHERE year_id = ? AND type = 'JV'", [openYear.id]);
          const jvNo = `JV-${openYear.name}-${String(seq).padStart(5, '0')}`;
          const desc = `قيد استحقاق استلام مخزني (أمر شراء ${o.no} — سند استلام #${rid})`;
          journalEntryId = Number(db.prepare("INSERT INTO fin_entries (year_id, seq, no, type, entry_day, description, reference, status, source, created_by, created_at, posted_by, posted_at) VALUES (?,?,?,'JV',?,?,?,'posted',?,?,?,?,?)")
            .run(openYear.id, seq, jvNo, day, desc, o.no, `proc_receipt:${rid}`, actor?.id ?? null, Date.now(), actor?.id ?? null, Date.now()).lastInsertRowid);
          db.prepare('INSERT INTO fin_lines (entry_id, line_no, account_id, debit, credit, note) VALUES (?,?,?,?,?,?)').run(journalEntryId, 1, invAcc.id, minorAmt, 0, desc);
          db.prepare('INSERT INTO fin_lines (entry_id, line_no, account_id, debit, credit, note) VALUES (?,?,?,?,?,?)').run(journalEntryId, 2, supAcc.id, 0, minorAmt, desc);
        }
      } catch { /* ignore if finance tables not initialized */ }
    }
    audit(db,actor,'استلام توريد',o.no,ip); return {receiptId:rid, journalEntryId, status: allReceived ? 'received' : 'ordered'};
  });
}
export function listReceipts(db,q={}){
  const where=q.orderId?'WHERE r.order_id=?':''; const a=q.orderId?[Number(q.orderId)]:[];
  return db.prepare(`SELECT r.*, o.no orderNo, s.name supplierName, rq.no requestNo FROM proc_receipts r JOIN proc_orders o ON o.id=r.order_id JOIN proc_suppliers s ON s.id=o.supplier_id LEFT JOIN proc_requests rq ON rq.id=o.request_id ${where} ORDER BY r.id DESC LIMIT 200`).all(...a).map(r=>({id:r.id,no:`RCV-${String(r.id).padStart(4,'0')}`,orderId:r.order_id,orderNo:r.orderNo,requestNo:r.requestNo,supplierName:r.supplierName,receivedAt:r.received_at,note:r.note,reversedAt:r.reversed_at,
    receivedFrom:r.received_from||r.supplierName,deliveryNoteNo:r.delivery_note_no,location:r.location,compliant:r.compliant==null?null:!!Number(r.compliant),
    lines:db.prepare('SELECT l.*, i.name itemName, i.code itemCode, i.unit unit FROM proc_receipt_lines l JOIN proc_items i ON i.id=l.item_id WHERE l.receipt_id=? ORDER BY l.id').all(r.id).map(x=>({itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,unit:x.unit,qty:x.qty,unitCost:x.unit_cost,expectedQty:x.expected_qty==null?null:Number(x.expected_qty),quality:x.quality,comment:x.comment}))}));
}
/* Issues */
export function createIssue({db},actor,b,ip){
  const whId=Number(b?.warehouseId); if(!whId || !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المخزن غير موجود.');
  // محضر إخراج / صرف المواد: القسم الطالب واسم المستلم ورقم طلب الصرف، والمستلم يكفي أحدهما
  const department=opt(b?.department,80,'القسم الطالب'), receiver=opt(b?.receiverName,80,'اسم المستلم'), requestRef=opt(b?.requestRef,40,'رقم طلب الصرف');
  const to=clean(b?.issuedTo || [department, receiver].filter(Boolean).join(' — '),60,'الجهة المستلمة',2); const purpose=String(b?.purpose??'').slice(0,200);
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  for(const l of lines){ const rq=optInt(l.requestedQty,'الكمية المطلوبة'); if(Number(l.qty)<=0) throw bad('الكمية المصروفة غير صالحة.'); if(rq!==null && Number(l.qty)>rq) throw bad('الكمية المصروفة أكبر من المطلوبة.'); }
  return tx(db,()=>{
    for(const l of lines){ const it=db.prepare('SELECT qty_on_hand FROM proc_items WHERE id=?').get(Number(l.itemId)); if(!it) throw bad('الصنف غير موجود.'); if(Number(l.qty)>it.qty_on_hand) throw bad(`الصنف ${l.itemId}: الرصيد لا يكفي (${it.qty_on_hand} متاح).`); }
    const no=nextNo(db,'IS','proc_issues');
    const id=Number(db.prepare('INSERT INTO proc_issues (no,warehouse_id,issued_to,purpose,issued_at,created_by,created_at,request_ref,department,receiver_name) VALUES (?,?,?,?,?,?,?,?,?,?)').run(no,whId,to,purpose,Date.now(),actor.id,Date.now(),requestRef,department,receiver).lastInsertRowid);
    for(const l of lines){
      db.prepare('UPDATE proc_items SET qty_on_hand = qty_on_hand - ? WHERE id=?').run(Number(l.qty),Number(l.itemId));
      const after=Number(db.prepare('SELECT qty_on_hand FROM proc_items WHERE id=?').get(Number(l.itemId)).qty_on_hand);
      db.prepare('INSERT INTO proc_issue_lines (issue_id,item_id,qty,requested_qty,balance_after,item_condition,note) VALUES (?,?,?,?,?,?,?)').run(id,Number(l.itemId),Number(l.qty),optInt(l.requestedQty,'الكمية المطلوبة') ?? Number(l.qty),after,opt(l.itemCondition,30,'حالة المادة'),opt(l.note,200,'الملاحظات'));
    }
    audit(db,actor,'صرف مخزني',no,ip); return {issueId:id,no};
  });
}
export function listIssues(db,q={}){
  const w=[],a=[]; if(q.warehouse){w.push('i.warehouse_id=?');a.push(Number(q.warehouse));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT i.*, w.name whName, w.location whLocation FROM proc_issues i JOIN proc_warehouses w ON w.id=i.warehouse_id ${where} ORDER BY i.id DESC LIMIT 200`).all(...a).map(r=>({id:r.id,no:r.no,warehouseId:r.warehouse_id,warehouseName:r.whName,warehouseLocation:r.whLocation,issuedTo:r.issued_to,purpose:r.purpose,issuedAt:r.issued_at,reversedAt:r.reversed_at,requestRef:r.request_ref,department:r.department,receiverName:r.receiver_name,
    lines:db.prepare('SELECT l.*, it.name itemName, it.code itemCode, it.unit unit FROM proc_issue_lines l JOIN proc_items it ON it.id=l.item_id WHERE l.issue_id=? ORDER BY l.id').all(r.id).map(x=>({itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,unit:x.unit,qty:x.qty,requestedQty:x.requested_qty==null?Number(x.qty):Number(x.requested_qty),balanceAfter:x.balance_after==null?null:Number(x.balance_after),itemCondition:x.item_condition,note:x.note}))}));
}
/* Assets */
export function listAssets(db,q={}){
  const w=[],a=[]; if(q.status){w.push('a.status=?');a.push(q.status);} if(q.q){const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(a.name LIKE ? ESCAPE "\\" OR a.code LIKE ? ESCAPE "\\")'); a.push(l,l);} if(q.warehouse){w.push('a.warehouse_id=?');a.push(Number(q.warehouse));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT a.*, w.name whName, s.name supName FROM proc_assets a LEFT JOIN proc_warehouses w ON w.id=a.warehouse_id LEFT JOIN proc_suppliers s ON s.id=a.supplier_id ${where} ORDER BY a.id DESC LIMIT 500`).all(...a).map(r=>({id:r.id,code:r.code,name:r.name,category:r.category,warehouseId:r.warehouse_id,warehouseName:r.whName,status:r.status,purchaseDay:r.purchase_day,cost:r.cost,supplierId:r.supplier_id,supplierName:r.supName,assignedTo:r.assigned_to,notes:r.notes,createdAt:r.created_at}));
}
export function createAsset({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز الأصل'); const name=clean(b?.name,80,'اسم الأصل',2);
  if(db.prepare('SELECT 1 FROM proc_assets WHERE code=?').get(code)) throw bad('رمز الأصل مستخدم.',409,'conflict');
  const whId=b?.warehouseId?Number(b.warehouseId):null; if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المخزن غير موجود.');
  const supId=b?.supplierId?Number(b.supplierId):null; if(supId && !db.prepare('SELECT 1 FROM proc_suppliers WHERE id=?').get(supId)) throw bad('المورد غير موجود.');
  const day=b?.purchaseDay?String(b.purchaseDay):null; if(day && !isDay(day)) throw bad('تاريخ الشراء غير صالح.');
  const id=Number(db.prepare('INSERT INTO proc_assets (code,name,category,warehouse_id,status,purchase_day,cost,supplier_id,assigned_to,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(code,name,String(b?.category??'عام').slice(0,30),whId,String(b?.status??'available'),day,Number(b?.cost??0),supId,String(b?.assignedTo??'').slice(0,80),String(b?.notes??'').slice(0,300),Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة أصل',code,ip); return {asset: db.prepare('SELECT * FROM proc_assets WHERE id=?').get(id)};
}
export function updateAsset({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_assets WHERE id=?').get(Number(id)); if(!cur) throw bad('الأصل غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز الأصل'):cur.code; const name=b?.name?clean(b.name,80,'اسم الأصل',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_assets WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز الأصل مستخدم.',409,'conflict');
  const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):cur.warehouse_id;
  const status=b?.status??cur.status; if(!['available','in_use','maintenance','disposed'].includes(status)) throw bad('حالة الأصل غير صالحة.');
  db.prepare('UPDATE proc_assets SET code=?,name=?,category=?,warehouse_id=?,status=?,purchase_day=?,cost=?,supplier_id=?,assigned_to=?,notes=? WHERE id=?').run(code,name,String(b?.category??cur.category).slice(0,30),whId,status,b?.purchaseDay??cur.purchase_day, b?.cost!==undefined?Number(b.cost):cur.cost, b?.supplierId!==undefined?(b.supplierId?Number(b.supplierId):null):cur.supplier_id, String(b?.assignedTo??cur.assigned_to).slice(0,80), String(b?.notes??cur.notes).slice(0,300), cur.id);
  audit(db,actor,'تعديل أصل',code,ip); return {asset: db.prepare('SELECT * FROM proc_assets WHERE id=?').get(cur.id)};
}
export function moveAsset({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_assets WHERE id=?').get(Number(id)); if(!cur) throw bad('الأصل غير موجود.',404,'not_found');
  const kind=String(b?.kind??'transfer'); if(!['transfer','dispose','maintenance','return'].includes(kind)) throw bad('نوع الحركة غير صالح.');
  const toWh=b?.toWarehouseId?Number(b.toWarehouseId):null; const toUser=String(b?.toUser??'').slice(0,80); const reason=String(b?.reason??'').slice(0,200);
  if(kind==='transfer' && !toWh) throw bad('حدد المخزن الهدف للنقل.');
  const newStatus=kind==='dispose'?'disposed':kind==='maintenance'?'maintenance':kind==='return'?'available':cur.status;
  const finalWh=kind==='transfer'?toWh:cur.warehouse_id;
  const finalUser=kind==='transfer'?toUser:cur.assigned_to;
  tx(db,()=>{
    db.prepare('INSERT INTO proc_asset_moves (asset_id,kind,from_wh,to_wh,to_user,reason,moved_at,moved_by) VALUES (?,?,?,?,?,?,?,?)').run(cur.id,kind,cur.warehouse_id,toWh,toUser,reason,Date.now(),actor.id);
    db.prepare('UPDATE proc_assets SET warehouse_id=?, assigned_to=?, status=? WHERE id=?').run(finalWh,finalUser,newStatus,cur.id);
  });
  audit(db,actor,'حركة أصل',`${cur.code}:${kind}`,ip); return {asset: db.prepare('SELECT * FROM proc_assets WHERE id=?').get(cur.id)};
}
export function deleteAsset({db},actor,id,ip){
  const a=db.prepare('SELECT * FROM proc_assets WHERE id=?').get(Number(id)); if(!a) throw bad('الأصل غير موجود.',404,'not_found');
  if(a.status==='in_use') throw bad('الأصل قيد الاستخدام فلا يُحذف.',409,'conflict');
  db.prepare('DELETE FROM proc_asset_moves WHERE asset_id=?').run(a.id); db.prepare('DELETE FROM proc_assets WHERE id=?').run(a.id); audit(db,actor,'حذف أصل',a.code,ip); return {ok:true};
}
export function adjustItemStock({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_items WHERE id=?').get(Number(id)); if(!cur) throw bad('الصنف غير موجود.',404,'not_found');
  const newQty=Number(b?.qtyOnHand); if(!Number.isFinite(newQty) || newQty<0) throw bad('الرصيد الفعلي غير صالح.');
  const newCost=b?.avgCost!==undefined ? Number(b.avgCost) : cur.avg_cost;
  if(!Number.isFinite(newCost) || newCost<0) throw bad('متوسط التكلفة غير صالح.');
  const reason=clean(b?.reason??'تسوية جرد مخزني',120,'سبب التسوية',3);
  db.prepare('UPDATE proc_items SET qty_on_hand=?, avg_cost=? WHERE id=?').run(newQty,newCost,cur.id);
  audit(db,actor,'تسوية جرد صنف',`${cur.code}: ${cur.qty_on_hand} -> ${newQty} (${reason})`,ip);
  return {item: db.prepare('SELECT * FROM proc_items WHERE id=?').get(cur.id)};
}
/* Overview */
export function overview(db){
  return {
    warehouses: db.prepare('SELECT COUNT(*) c FROM proc_warehouses WHERE active=1').get().c,
    suppliers: db.prepare('SELECT COUNT(*) c FROM proc_suppliers WHERE active=1').get().c,
    items: db.prepare('SELECT COUNT(*) c FROM proc_items WHERE active=1').get().c,
    lowStock: db.prepare('SELECT COUNT(*) c FROM proc_items WHERE active=1 AND min_stock>0 AND qty_on_hand<=min_stock').get().c,
    totalStockValue: db.prepare('SELECT COALESCE(SUM(qty_on_hand*avg_cost),0) c FROM proc_items').get().c,
    pendingRequests: db.prepare("SELECT COUNT(*) c FROM proc_requests WHERE status='pending'").get().c,
    approvedRequests: db.prepare("SELECT COUNT(*) c FROM proc_requests WHERE status='approved'").get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) c FROM proc_orders WHERE status='ordered'").get().c,
    receivedOrders: db.prepare("SELECT COUNT(*) c FROM proc_orders WHERE status='received'").get().c,
    totalIssues: db.prepare("SELECT COUNT(*) c FROM proc_issues").get().c,
    totalReceipts: db.prepare("SELECT COUNT(*) c FROM proc_receipts").get().c,
    totalAssets: db.prepare("SELECT COUNT(*) c FROM proc_assets WHERE status!='disposed'").get().c,
    assetsValue: db.prepare("SELECT COALESCE(SUM(cost),0) c FROM proc_assets WHERE status!='disposed'").get().c,
    lowStockItems: db.prepare(`SELECT i.id, i.code, i.name, i.unit, i.qty_on_hand qtyOnHand, i.min_stock minStock, i.avg_cost avgCost, w.name whName
      FROM proc_items i LEFT JOIN proc_warehouses w ON w.id=i.warehouse_id
      WHERE i.active=1 AND i.min_stock>0 AND i.qty_on_hand<=i.min_stock ORDER BY (i.qty_on_hand - i.min_stock) ASC LIMIT 12`).all(),
    warehouseSummary: db.prepare(`SELECT w.id, w.code, w.name, w.location, w.active, u.display_name managerName,
      (SELECT COUNT(*) FROM proc_items i WHERE i.warehouse_id=w.id) itemCount,
      (SELECT COALESCE(SUM(i.qty_on_hand*i.avg_cost),0) FROM proc_items i WHERE i.warehouse_id=w.id) stockValue,
      (SELECT COUNT(*) FROM proc_assets a WHERE a.warehouse_id=w.id AND a.status!='disposed') assetCount
      FROM proc_warehouses w LEFT JOIN users u ON u.id=w.manager_id ORDER BY w.code`).all(),
    assetBreakdown: db.prepare(`SELECT status, COUNT(*) count, COALESCE(SUM(cost),0) totalCost FROM proc_assets GROUP BY status`).all(),
    recentRequests: db.prepare('SELECT r.id, r.no, r.title, r.status, r.created_at createdAt, u.display_name requester FROM proc_requests r LEFT JOIN users u ON u.id=r.requester_id ORDER BY r.id DESC LIMIT 6').all(),
    recentOrders: db.prepare('SELECT o.id, o.no, o.total_amount totalAmount, s.name supplierName, o.status, o.created_at createdAt FROM proc_orders o JOIN proc_suppliers s ON s.id=o.supplier_id ORDER BY o.id DESC LIMIT 6').all(),
    recentIssues: db.prepare('SELECT i.id, i.no, i.issued_to issuedTo, i.purpose, i.issued_at issuedAt, w.name whName FROM proc_issues i JOIN proc_warehouses w ON w.id=i.warehouse_id ORDER BY i.id DESC LIMIT 5').all(),
    recentReceipts: db.prepare('SELECT r.id, o.no orderNo, s.name supplierName, r.received_at receivedAt, r.note FROM proc_receipts r JOIN proc_orders o ON o.id=r.order_id JOIN proc_suppliers s ON s.id=o.supplier_id ORDER BY r.id DESC LIMIT 5').all()
  };
}
