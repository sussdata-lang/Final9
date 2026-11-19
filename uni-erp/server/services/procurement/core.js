// المشتريات والمخازن والأصول — النواة
import { getSetting } from '../settings.js';
import { effective } from '../../permissions.js';
import { checkOrderBudget, validBudgetForOrder } from '../finance/budgets.js';
import { tx } from '../../db.js';
import { nextNumber } from '../numbering.js';
import { audit } from '../../audit.js';
import { HttpError } from '../../http.js';
import { applyIssueToRequest } from './issue_flow.js';
import { assetsFromReceipt, postAssetAcquisition, saveAssetExtra, assetCode, requestDisposal } from './assets.js';
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
/* ترقيم الصفحات من الخادم (تقرير المشتريات 8.1): ?page=&size= يعيد صفحة والعدد الكلي؛ بلا page يبقى الحد القديم للمستدعين الداخليين */
export const pageArgs = (q, cap) => { const page = Math.max(1, Math.floor(Number(q?.page) || 0)); if (!q?.page) return [Number(cap), 0]; const size = Math.min(200, Math.max(10, Math.floor(Number(q.size) || 50))); return [size, (page - 1) * size]; };
export const nextNo = (db, prefix, table) => {
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
export function listSuppliers(db,q={},meta={}){
  const w=[],a=[]; if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(name LIKE ? ESCAPE \'\\\' OR code LIKE ? ESCAPE \'\\\')'); a.push(l,l); }
  const where=w.length?'WHERE '+w.join(' AND '):'';
  const rt=new Map(db.prepare('SELECT supplier_id, COUNT(*) n, AVG((quality+timeliness+price)/3.0) s FROM proc_supplier_ratings GROUP BY supplier_id').all().map((x)=>[Number(x.supplier_id),{n:Number(x.n),s:Math.round(Number(x.s)*10)/10}]));
  const _rows=db.prepare(`SELECT COUNT(*) OVER() AS _total, * FROM proc_suppliers ${where} ORDER BY name LIMIT ? OFFSET ?`).all(...a, ...pageArgs(q,200)); meta.total=Number(_rows[0]?._total ?? _rows.length); return _rows.map(r=>({rating:rt.get(Number(r.id))?.s??null,ratings:rt.get(Number(r.id))?.n??0,id:r.id,code:r.code,name:r.name,phone:r.phone,email:r.email,address:r.address,taxNo:r.tax_no,contactPerson:r.contact_person,fax:r.fax,mobile:r.mobile,specialty:r.specialty,active:!!r.active,approved:r.approved==null?true:!!Number(r.approved),createdAt:r.created_at}));
}
const supExtra = (b, cur = {}) => ['contactPerson', 'fax', 'mobile', 'specialty'].map((k, i) => (b?.[k] !== undefined ? opt(b[k], [80, 30, 30, 120][i], ['شخص التواصل', 'الفاكس', 'الموبايل', 'مجال التخصص'][i]) : (cur[['contact_person', 'fax', 'mobile', 'specialty'][i]] ?? '')));
const taxUnique=(db,tax,exceptId)=>{ const t=String(tax??'').trim(); if(!t) return; const d=db.prepare("SELECT code, name FROM proc_suppliers WHERE TRIM(COALESCE(tax_no,''))=? AND id<>?").get(t,exceptId); if(d) throw bad(`الرقم الضريبي ${t} مسجّل للمورد ${d.code} · ${d.name}.`,409,'duplicate_tax_no'); };
export function createSupplier({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز المورد'); const name=clean(b?.name,80,'اسم المورد',2);
  if(db.prepare('SELECT 1 FROM proc_suppliers WHERE code=?').get(code)) throw bad('رمز المورد مستخدم.',409,'conflict');
  taxUnique(db,b?.taxNo,-1);
  const id=Number(db.prepare('INSERT INTO proc_suppliers (code,name,phone,email,address,tax_no,contact_person,fax,mobile,specialty,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(code,name,b?.phone??null,b?.email??null,b?.address??null,b?.taxNo??null,...supExtra(b),Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة مورد',code,ip); return {supplier: db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(id)};
}
export function updateSupplier({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(Number(id)); if(!cur) throw bad('المورد غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز المورد'):cur.code; const name=b?.name?clean(b.name,80,'اسم المورد',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_suppliers WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز المورد مستخدم.',409,'conflict');
  if(b?.taxNo!==undefined) taxUnique(db,b.taxNo,cur.id);
  const approved = b?.approved === undefined ? (cur.approved ?? 1) : (b.approved ? 1 : 0);
  db.prepare('UPDATE proc_suppliers SET code=?,name=?,phone=?,email=?,address=?,tax_no=?,contact_person=?,fax=?,mobile=?,specialty=?,approved=? WHERE id=?').run(code,name,b?.phone??cur.phone,b?.email??cur.email,b?.address??cur.address,b?.taxNo??cur.tax_no,...supExtra(b,cur),approved,cur.id);
  audit(db,actor,Number(cur.approved??1)!==approved?(approved?'اعتماد مورد':'إلغاء اعتماد مورد'):'تعديل مورد',code,ip); return {supplier: db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(cur.id)};
}
export function toggleSupplier({db},actor,id,on,ip){
  if(!on){ const o=db.prepare("SELECT no FROM proc_orders WHERE supplier_id=? AND status IN ('draft','ordered') LIMIT 1").get(Number(id)); if(o) throw bad(`للمورد أمر توريد مفتوح (${o.no})؛ أنهِه أو ألغِه قبل الإيقاف.`,409,'open_orders'); }
  const r=db.prepare('UPDATE proc_suppliers SET active=? WHERE id=?').run(on?1:0,Number(id)); if(!r.changes) throw bad('المورد غير موجود.',404,'not_found');
  audit(db,actor,on?'تفعيل مورد':'تعطيل مورد',String(id),ip); return {ok:true};
}
export function deleteSupplier({db},actor,id,ip){
  const cur=db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(Number(id)); if(!cur) throw bad('المورد غير موجود.',404,'not_found');
  if(db.prepare('SELECT 1 FROM proc_orders WHERE supplier_id=? LIMIT 1').get(cur.id)) throw bad('المورد مرتبط بأوامر توريد فلا يُحذف؛ عطّله.',409,'conflict');
  db.prepare('DELETE FROM proc_suppliers WHERE id=?').run(cur.id); audit(db,actor,'حذف مورد',cur.code,ip); return {ok:true};
}
// مورد أمر الشراء: من القائمة (supplierId)، أو اسم مكتوب يُطابق مورداً قائماً بالاسم، وإلا يُسجَّل مورداً «غير معتمد»
// (ADH-xxxxx) ليُراجَع ويُعتمد لاحقاً — المشتريات ليست دائماً من موردين معتمدين. يُستدعى داخل معاملة.
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function resolveSupplier(db, actor, b, ip) {
  if (b?.supplierId) {
    const s = db.prepare('SELECT * FROM proc_suppliers WHERE id=? AND active=1').get(Number(b.supplierId));
    if (!s) throw bad('المورد غير موجود أو معطّل.');
    return s;
  }
  const name = clean(b?.supplierName, 80, 'اسم المورد', 2);
  const ex = db.prepare('SELECT * FROM proc_suppliers WHERE lower(name) = lower(?) ORDER BY active DESC, id LIMIT 1').get(name);
  if (ex) { if (!ex.active) throw bad(`المورد «${ex.name}» معطّل في القائمة؛ فعّله أو اختر غيره.`, 409, 'conflict'); return ex; }
  const email = opt(b?.supplierEmail, 120, 'بريد المورد');
  if (email && !EMAIL_RE.test(email)) throw bad('بريد المورد غير صالح.');
  const n = nextNumber(db, 'proc_suppliers:adhoc', "SELECT MAX(CAST(substr(code, 5) AS INTEGER)) FROM proc_suppliers WHERE code ~ '^ADH-[0-9]+$'");
  const code = `ADH-${String(n).padStart(5, '0')}`;
  const id = Number(db.prepare('INSERT INTO proc_suppliers (code,name,phone,email,mobile,contact_person,approved,created_at) VALUES (?,?,?,?,?,?,0,?)')
    .run(code, name, opt(b?.supplierPhone, 30, 'هاتف المورد') || null, email || null, opt(b?.supplierMobile, 30, 'موبايل المورد'), opt(b?.supplierContact, 80, 'شخص التواصل لدى المورد'), Date.now()).lastInsertRowid);
  audit(db, actor, 'تسجيل مورد غير معتمد من أمر شراء', `${code} ${name}`, ip);
  return db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(id);
}
// المورد المقترح في طلب الشراء: من القائمة أو اسم مكتوب فقط (لا سجل مورد قبل أمر الشراء)
const reqSupplier = (db, b, cur = {}) => {
  if (b?.supplierId === undefined && b?.supplierName === undefined) return [cur.supplier_id ?? null, cur.supplier_name ?? null];
  const sid = b?.supplierId ? Number(b.supplierId) : null;
  if (sid && !db.prepare('SELECT 1 FROM proc_suppliers WHERE id=?').get(sid)) throw bad('المورد المقترح غير موجود.');
  return [sid, sid ? null : (opt(b?.supplierName, 80, 'اسم المورد المقترح') || null)];
};
// رمز QR للصنف: نص قابل للطباعة، فريد بين الأصناف
export function itemQr(db, v, exceptId = -1) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > 200 || /[\x00-\x1f<>]/.test(s)) throw bad('رمز QR غير صالح (حتى 200 محرف قابل للطباعة).');
  const other = db.prepare('SELECT code FROM proc_items WHERE qr_code=? AND id!=?').get(s, Number(exceptId));
  if (other) throw bad(`رمز QR مستخدم للصنف «${other.code}».`, 409, 'conflict');
  return s;
}
// رمز صنف تلقائي (ITM-00001…) لصنف يُعرَّف عند الاستلام
const autoItemCode = (db) => `ITM-${String(nextNumber(db, 'proc_items:auto', "SELECT MAX(CAST(substr(code, 5) AS INTEGER)) FROM proc_items WHERE code ~ '^ITM-[0-9]+$'")).padStart(5, '0')}`;
/* Categories */
/* ===== الوحدات والكميات العشرية =====
   الوحدة في الدليل تقرر هل تقبل الكسور (كغ، ليتر، متر)؛ وحدة غير معرَّفة تُعامل عدداً صحيحاً. */
export const unitInfo = (db, name) => db.prepare('SELECT * FROM proc_units WHERE name = ?').get(String(name ?? '').trim());
export const itemUnitOf = (db, itemId) => db.prepare('SELECT unit FROM proc_items WHERE id = ?').get(Number(itemId))?.unit ?? '';
export function checkQty(db, unitName, q, label, { zero = false } = {}) {
  const n = Number(q);
  if (!Number.isFinite(n) || (zero ? n < 0 : n <= 0)) throw bad(`${label}: الكمية غير صالحة.`);
  if (!Number.isInteger(n) && !Number(unitInfo(db, unitName)?.fractional)) throw bad(`${label}: الوحدة «${unitName || '—'}» لا تقبل الكسور؛ أدخل عدداً صحيحاً.`, 400, 'fraction_not_allowed');
  return Math.round(n * 1000) / 1000;
}
/* معامل التحويل من وحدة الشراء إلى وحدة تخزين الصنف: تحويل الصنف الخاص («علبة = 12 قطعة»)، ثم التحويل العام في الدليل.
   وحدة مطابقة أو فارغة = 1؛ وحدة بلا تحويل معرَّف = 1 كما كان (ويظهر تنبيه في الواجهة). */
export function unitFactor(db, itemId, fromUnit) {
  const from = String(fromUnit ?? '').trim(), to = String(itemUnitOf(db, itemId)).trim();
  if (!from || !to || from === to) return 1;
  const own = db.prepare('SELECT factor FROM proc_item_units WHERE item_id = ? AND unit_name = ?').get(Number(itemId), from);
  if (own) return Number(own.factor);
  const g = unitInfo(db, from);
  if (g && g.base_name === to) return Number(g.factor);
  const back = unitInfo(db, to);
  if (back && back.base_name === from) return 1 / Number(back.factor);
  return 1;
}
export function listUnits(db) { return db.prepare('SELECT * FROM proc_units ORDER BY fractional, name').all().map((u) => ({ id: Number(u.id), name: u.name, fractional: !!Number(u.fractional), baseName: u.base_name ?? '', factor: Number(u.factor), active: !!Number(u.active) })); }
export function saveUnit({ db }, actor, b, ip) {
  const name = clean(b?.name, 20, 'اسم الوحدة', 1), base = String(b?.baseName ?? '').trim(), factor = Number(b?.factor ?? 1);
  if (base && !unitInfo(db, base)) throw bad('وحدة الأساس غير موجودة في الدليل.');
  if (base === name) throw bad('وحدة الأساس هي الوحدة نفسها.');
  if (!(factor > 0)) throw bad('معامل التحويل رقم موجب.');
  const cur = b?.id ? db.prepare('SELECT * FROM proc_units WHERE id = ?').get(Number(b.id)) : null;
  if (cur) {
    if (name !== cur.name && db.prepare('SELECT 1 FROM proc_items WHERE unit = ?').get(cur.name)) throw bad('الوحدة مستخدمة في أصناف فلا يُغيَّر اسمها.', 409, 'conflict');
    db.prepare('UPDATE proc_units SET name = ?, fractional = ?, base_name = ?, factor = ?, active = ? WHERE id = ?').run(name, b?.fractional ? 1 : 0, base || null, factor, b?.active === false ? 0 : 1, cur.id);
  } else {
    if (unitInfo(db, name)) throw bad('الوحدة موجودة.', 409, 'conflict');
    db.prepare('INSERT INTO proc_units (name, fractional, base_name, factor) VALUES (?,?,?,?)').run(name, b?.fractional ? 1 : 0, base || null, factor);
  }
  audit(db, actor, cur ? 'تعديل وحدة قياس' : 'إضافة وحدة قياس', name, ip);
  return { units: listUnits(db) };
}
// تحويلات الصنف الخاصة: [{unitName, factor}] تستبدل السابقة
export function setItemUnits({ db }, actor, itemId, b, ip) {
  const it = db.prepare('SELECT * FROM proc_items WHERE id = ?').get(Number(itemId)); if (!it) throw bad('الصنف غير موجود.', 404, 'not_found');
  const list = Array.isArray(b?.units) ? b.units : [];
  for (const u of list) { const n = String(u?.unitName ?? '').trim(); if (!n || n === it.unit) throw bad('وحدة التحويل غير صالحة أو هي وحدة الصنف نفسها.'); if (!(Number(u.factor) > 0)) throw bad(`معامل «${n}» رقم موجب.`); }
  tx(db, () => {
    db.prepare('DELETE FROM proc_item_units WHERE item_id = ?').run(it.id);
    for (const u of list) db.prepare('INSERT INTO proc_item_units (item_id, unit_name, factor) VALUES (?,?,?)').run(it.id, String(u.unitName).trim(), Number(u.factor));
  });
  audit(db, actor, 'تحويلات وحدات صنف', `${it.code}: ${list.map((u) => `${u.unitName}=${u.factor}`).join('، ')}`.slice(0, 200), ip);
  return { units: itemUnitsOf(db, it.id) };
}
export const itemUnitsOf = (db, itemId) => db.prepare('SELECT unit_name, factor FROM proc_item_units WHERE item_id = ? ORDER BY unit_name').all(Number(itemId)).map((x) => ({ unitName: x.unit_name, factor: Number(x.factor) }));

/* ===== شجرة التصنيفات والترقيم التلقائي ===== */
export function saveCategory({ db }, actor, b, ip) {
  const code = clean(b?.code, 16, 'رمز التصنيف', 2).toUpperCase(), name = clean(b?.name, 60, 'اسم التصنيف', 2);
  if (!/^[A-Z0-9-]+$/.test(code)) throw bad('رمز التصنيف أحرف لاتينية كبيرة وأرقام وشرطة، مثال: CAT-IT.');
  const parent = b?.parentId ? Number(b.parentId) : null;
  if (parent && !db.prepare('SELECT 1 FROM proc_categories WHERE id = ?').get(parent)) throw bad('التصنيف الأب غير موجود.');
  const cur = b?.id ? db.prepare('SELECT * FROM proc_categories WHERE id = ?').get(Number(b.id)) : null;
  if (cur) {
    // لا حلقة في الشجرة: الأب لا يكون التصنيف نفسه ولا أحد فروعه
    for (let p = parent; p; p = db.prepare('SELECT parent_id FROM proc_categories WHERE id = ?').get(p)?.parent_id) if (Number(p) === Number(cur.id)) throw bad('لا يكون التصنيف أباً لنفسه أو لأحد أصوله.');
    if (code !== cur.code && db.prepare('SELECT 1 FROM proc_items WHERE category_id = ?').get(cur.id)) throw bad('للتصنيف أصناف مرقّمة برمزه فلا يُغيَّر رمزه.', 409, 'code_locked');
    if (code !== cur.code && db.prepare('SELECT 1 FROM proc_categories WHERE code = ? AND id <> ?').get(code, cur.id)) throw bad('رمز التصنيف مستخدم.', 409, 'conflict');
    db.prepare('UPDATE proc_categories SET code = ?, name = ?, parent_id = ?, active = ? WHERE id = ?').run(code, name, parent, b?.active === false ? 0 : 1, cur.id);
  } else {
    if (db.prepare('SELECT 1 FROM proc_categories WHERE code = ?').get(code)) throw bad('رمز التصنيف مستخدم.', 409, 'conflict');
    db.prepare('INSERT INTO proc_categories (code, name, parent_id) VALUES (?,?,?)').run(code, name, parent);
  }
  audit(db, actor, cur ? 'تعديل تصنيف أصناف' : 'إضافة تصنيف أصناف', `${code} ${name}`, ip);
  return { categories: listCategories(db) };
}
// رمز صنف تلقائي من رمز تصنيفه: CAT-IT-0001، أو ITM-00001 بلا تصنيف
export function categoryItemCode(db, catId) {
  const cat = catId ? db.prepare('SELECT code FROM proc_categories WHERE id = ?').get(Number(catId)) : null;
  if (!cat) return autoItemCode(db);
  const head = `${cat.code}-`;
  const n = nextNumber(db, `proc_items:${head}`, `SELECT MAX(CAST(substr(code, ?) AS INTEGER)) FROM proc_items WHERE code LIKE ? AND substr(code, ?) ~ '^[0-9]+$'`, [head.length + 1, `${head}%`, head.length + 1]);
  return `${head}${String(n).padStart(4, '0')}`;
}
export function listCategories(db){ return db.prepare('SELECT c.*, (SELECT COUNT(*) FROM proc_items i WHERE i.category_id = c.id) n FROM proc_categories c ORDER BY c.code').all().map(r=>({id:r.id,code:r.code,name:r.name,parentId:r.parent_id??null,active:!!r.active,items:Number(r.n)})); }
/* Items */
export function listItems(db,q={},meta={}){
  const w=[],a=[];
  if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(i.name LIKE ? ESCAPE \'\\\' OR i.code LIKE ? ESCAPE \'\\\' OR i.qr_code = ?)'); a.push(l,l,String(q.q).trim()); }
  if(q.qr) { w.push('i.qr_code=?'); a.push(String(q.qr).trim()); }
  if(q.warehouse) { w.push('(i.warehouse_id=? OR EXISTS (SELECT 1 FROM proc_item_stock s WHERE s.item_id=i.id AND s.warehouse_id=? AND s.qty>0))'); a.push(Number(q.warehouse),Number(q.warehouse)); }
  if(q.category) { w.push('i.category_id=?'); a.push(Number(q.category)); }
  if(q.low==='1') w.push('i.qty_on_hand <= i.min_stock AND i.min_stock > 0');
  const where=w.length?'WHERE '+w.join(' AND '):'';
  const st=new Map(); for(const x of db.prepare('SELECT s.item_id, s.warehouse_id, s.qty, w.name FROM proc_item_stock s JOIN proc_warehouses w ON w.id=s.warehouse_id WHERE s.qty<>0 ORDER BY w.code').all()){ const k=Number(x.item_id); if(!st.has(k)) st.set(k,[]); st.get(k).push({warehouseId:Number(x.warehouse_id),name:x.name,qty:Number(x.qty)}); }
  const _rows=db.prepare(`SELECT COUNT(*) OVER() AS _total, i.*, c.name catName, w.name whName FROM proc_items i LEFT JOIN proc_categories c ON c.id=i.category_id LEFT JOIN proc_warehouses w ON w.id=i.warehouse_id ${where} ORDER BY i.code LIMIT ? OFFSET ?`).all(...a, ...pageArgs(q,500)); meta.total=Number(_rows[0]?._total ?? _rows.length); return _rows.map(r=>({stocks:st.get(Number(r.id))||[],id:r.id,code:r.code,name:r.name,categoryId:r.category_id,categoryName:r.catName,unit:r.unit,warehouseId:r.warehouse_id,warehouseName:r.whName,qtyOnHand:r.qty_on_hand,avgCost:r.avg_cost,minStock:r.min_stock,maxStock:r.max_stock,active:!!r.active,notes:r.notes,qrCode:r.qr_code??'',low: r.min_stock>0 && r.qty_on_hand<=r.min_stock}));
}
/* حدّا الصنف: عددان صحيحان غير سالبين، والأعلى (إن حُدد) لا يقل عن الأدنى؛ وإلا رسالة واضحة لا خطأ خادم */
function stockLimits(minRaw, maxRaw, frac=false){
  const num=(v,label)=>{ if(v===undefined||v===null||v==='') return 0; const n=Number(v); if(!Number.isFinite(n)||n<0||(!frac&&!Number.isInteger(n))) throw bad(`«${label}» ${frac?'رقم':'عدد صحيح'} غير سالب.`); return n; };
  const minS=num(minRaw,'الحد الأدنى'), maxS=num(maxRaw,'الحد الأعلى');
  if(maxS>0 && maxS<minS) throw bad(`الحد الأعلى (${maxS}) أصغر من الحد الأدنى (${minS}).`);
  return [minS,maxS];
}
const normName=(s)=>String(s??'').replace(/[\u064B-\u0652\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ').trim().toLowerCase();
const hasMoves=(db,itemId)=>!!(db.prepare('SELECT 1 FROM proc_receipt_lines WHERE item_id=? LIMIT 1').get(itemId) || db.prepare('SELECT 1 FROM proc_issue_lines WHERE item_id=? LIMIT 1').get(itemId));
const ensureUnit=(db,unit)=>{ if(unit && !unitInfo(db,unit)) db.prepare('INSERT INTO proc_units (name, fractional) VALUES (?, 0) ON CONFLICT DO NOTHING').run(unit); };
export function createItem({db},actor,b,ip){
  // الرمز اختياري: يُرقَّم تلقائياً من رمز التصنيف (CAT-IT-0001)
  const code=String(b?.code??'').trim()?clean(b.code,20,'رمز الصنف'):categoryItemCode(db,b?.categoryId); const name=clean(b?.name,80,'اسم الصنف',2);
  if(db.prepare('SELECT 1 FROM proc_items WHERE code=?').get(code)) throw bad('رمز الصنف مستخدم.',409,'conflict');
  const catId=b?.categoryId?Number(b.categoryId):null; if(catId && !db.prepare('SELECT 1 FROM proc_categories WHERE id=?').get(catId)) throw bad('التصنيف غير موجود.');
  const whId=b?.warehouseId?Number(b.warehouseId):null; if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=? AND active=1').get(whId)) throw bad('المخزن غير موجود أو معطّل.');
  const unit=clean(b?.unit??'قطعة',20,'الوحدة'); const [minS,maxS]=stockLimits(b?.minStock,b?.maxStock,!!Number(unitInfo(db,unit)?.fractional)); ensureUnit(db,unit);
  // صنف بالاسم نفسه (بعد توحيد الهمزات والتاء المربوطة) برمز مختلف: تكرار غالباً، يُقبل فقط بتأكيد صريح
  if(!b?.allowDuplicate){ const n=normName(name); const dup=db.prepare('SELECT code, name FROM proc_items').all().find((x)=>normName(x.name)===n); if(dup) throw bad(`يوجد صنف بالاسم نفسه: ${dup.code} · ${dup.name}. استخدمه، أو أكّد إنشاء صنف مختلف.`,409,'duplicate_name'); }
  const qr=itemQr(db,b?.qrCode);
  const id=Number(db.prepare('INSERT INTO proc_items (code,name,category_id,unit,warehouse_id,min_stock,max_stock,notes,created_at,qr_code) VALUES (?,?,?,?,?,?,?,?,?,?)').run(code,name,catId,unit,whId,minS,maxS,String(b?.notes??'').slice(0,300),Date.now(),qr).lastInsertRowid);
  audit(db,actor,'إضافة صنف',code,ip); return {item: db.prepare('SELECT * FROM proc_items WHERE id=?').get(id)};
}
export function updateItem({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_items WHERE id=?').get(Number(id)); if(!cur) throw bad('الصنف غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز الصنف'):cur.code; const name=b?.name?clean(b.name,80,'اسم الصنف',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_items WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز الصنف مستخدم.',409,'conflict');
  // الرمز يُقفل بعد أول حركة كي لا يتغير ما في المستندات المطبوعة
  if(code!==cur.code && hasMoves(db,cur.id)) throw bad('لا يُغيَّر رمز صنف له حركات استلام أو صرف.',409,'code_locked');
  const catId=b?.categoryId!==undefined?(b.categoryId?Number(b.categoryId):null):cur.category_id;
  const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):cur.warehouse_id;
  const unit=b?.unit?clean(b.unit,20,'الوحدة'):cur.unit;
  const [minS,maxS]=stockLimits(b?.minStock!==undefined?b.minStock:cur.min_stock, b?.maxStock!==undefined?b.maxStock:cur.max_stock, !!Number(unitInfo(db,unit)?.fractional)); ensureUnit(db,unit);
  const qr=b?.qrCode!==undefined?itemQr(db,b.qrCode,cur.id):cur.qr_code;
  db.prepare('UPDATE proc_items SET code=?,name=?,category_id=?,unit=?,warehouse_id=?,min_stock=?,max_stock=?,notes=?,qr_code=? WHERE id=?').run(code,name,catId,unit,whId,minS,maxS, b?.notes!==undefined?String(b.notes).slice(0,300):cur.notes, qr, cur.id);
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
export function listRequests(db,q={},meta={}){
  const w=[],a=[]; if(q.status) { w.push('r.status=?'); a.push(q.status); } if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(r.no LIKE ? ESCAPE \'\\\' OR r.title LIKE ? ESCAPE \'\\\')'); a.push(l,l); }
  if(q.mine) { w.push('r.requester_id=?'); a.push(Number(q.mine)); }
  const where=w.length?'WHERE '+w.join(' AND '):'';
  const _rows=db.prepare(`SELECT COUNT(*) OVER() AS _total, r.*, u.display_name requester_name FROM proc_requests r LEFT JOIN users u ON u.id=r.requester_id ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...a, ...pageArgs(q,300)); meta.total=Number(_rows[0]?._total ?? _rows.length); return _rows.map(r=>{ const st=r.status==='pending'?approvalStage(db,r):null; return {stage: st?.next?.label ?? null, stagePerm: st?.next?.perm ?? null, approvedBy: st ? st.done.map((d)=>d.userId) : [], ...reqView(db,r)}; });
}
const reqLines = (db, id) => db.prepare('SELECT l.*, i.name itemName, i.code itemCode FROM proc_request_lines l LEFT JOIN proc_items i ON i.id=l.item_id WHERE l.request_id=? ORDER BY l.id').all(id)
  .map(x=>({id:x.id,itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,description:x.description,qty:x.qty,estCost:x.est_cost,note:x.note,budgetCode:x.budget_code,specs:x.specs,unit:x.unit,stockBalance:x.stock_balance==null?null:Number(x.stock_balance)}));
const reqView = (db, r) => ({supplierId:r.supplier_id??null,supplierName:r.supplier_name||(r.supplier_id?(db.prepare('SELECT name FROM proc_suppliers WHERE id=?').get(r.supplier_id)?.name??''):''),id:r.id,no:r.no,title:r.title,description:r.description,requesterId:r.requester_id,requesterName:r.requester_name,warehouseId:r.warehouse_id,status:r.status,requestedAt:r.requested_at,decidedBy:r.decided_by,decidedAt:r.decided_at,decisionNote:r.decision_note,createdAt:r.created_at,
  returnedAt:r.returned_at??null,returnReason:r.return_reason??null,department:r.department,jobTitle:r.job_title,directManager:r.direct_manager,purchaseThreshold:r.purchase_threshold,needDay:r.need_day,amountWords:r.amount_words,lines:reqLines(db,r.id)});
// بيانات رأس طلب الشراء من نموذج الجامعة
const REQ_HEAD = [['department','department',80,'القسم الطالب'],['jobTitle','job_title',80,'المسمى الوظيفي'],['directManager','direct_manager',80,'المسؤول المباشر'],['purchaseThreshold','purchase_threshold',60,'عتبة الشراء'],['amountWords','amount_words',200,'المبلغ كتابةً']];
const reqHead = (b, cur = {}) => [...REQ_HEAD.map(([k, col, max, label]) => (b?.[k] !== undefined ? opt(b[k], max, label) : (cur[col] ?? ''))), b?.needDay !== undefined ? optDay(b.needDay, 'تاريخ الحاجة') : (cur.need_day ?? '')];
/* بنود الطلب: السعر التقديري يحدد مراحل الاعتماد، فلا يُقبل صفراً. بند لصنف مخزني بلا سعر يأخذ متوسط تكلفته؛
   وإلا يُرفض البند كي لا يمر طلب كبير بسعر صفر على مرحلة اعتماد واحدة. */
function checkReqLines(db, lines){
  if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  if(lines.length>50) throw bad('حتى 50 بنداً للطلب.');
  lines.forEach((l,i)=>{
    clean(l?.description,100,`وصف البند ${i+1}`,2);
    const it = l.itemId ? db.prepare('SELECT avg_cost, unit FROM proc_items WHERE id=?').get(Number(l.itemId)) : null;
    l.qty = checkQty(db, String(l.unit ?? '').trim() || it?.unit || '', l?.qty, `البند ${i+1}`);
    if(l.itemId && !it) throw bad(`البند ${i+1}: الصنف غير موجود.`);
    let cost = Number(l.estCost);
    if(!(cost>0) && it && Number(it.avg_cost)>0) cost = Number(it.avg_cost);
    if(!Number.isFinite(cost) || cost<=0) throw bad(`البند ${i+1}: السعر التقديري مطلوب وأكبر من صفر (يحدد مراحل الاعتماد).`,400,'est_cost_required');
    l.estCost = cost;
  });
}
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
  const lines=b?.lines; checkReqLines(db, lines);
  const head = reqHead(b), sup = reqSupplier(db, b);
  return tx(db,()=>{
    const no=nextNo(db,'PRQ','proc_requests');
    const id=Number(db.prepare('INSERT INTO proc_requests (no,title,description,requester_id,warehouse_id,status,created_at,department,job_title,direct_manager,purchase_threshold,amount_words,need_day,supplier_id,supplier_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(no,title,desc,actor.id,whId,'draft',Date.now(),...head,...sup).lastInsertRowid);
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
  if(db.prepare('SELECT 1 FROM proc_request_lines WHERE request_id=? AND NOT (est_cost > 0) LIMIT 1').get(r.id)) throw bad('في الطلب بند بلا سعر تقديري؛ عدّل المسودة وأدخل السعر قبل الإرسال.',400,'est_cost_required');
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
export const holdersOf = (db, perm) => db.prepare("SELECT * FROM users WHERE role <> 'student' AND active = 1").all().filter((u) => effective(db, u).includes(perm)).map((u) => u.id);

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
/* إعادة الطلب لمقدّمه للتعديل بدل رفضه نهائياً: يعود مسودة تحت رقمه، وتُمحى اعتماداته المرحلية فيُعتمد من أوله بعد التعديل */
export function returnRequest({db},actor,id,note,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(r.status!=='pending') throw bad('الطلب ليس قيد المراجعة.',409,'conflict');
  const next=approvalStage(db,r).next;
  if(!next || !actor.can(next.perm)) throw bad(`هذه المرحلة تخص: ${next?next.label:'—'}.`,403,'forbidden');
  const why=String(note??'').replace(/\s+/g,' ').trim().slice(0,300);
  if(why.length<5) throw bad('اكتب ما يجب تعديله في الطلب.',400,'reason_required');
  return tx(db,()=>{
    db.prepare('DELETE FROM proc_request_approvals WHERE request_id=?').run(r.id);
    db.prepare("UPDATE proc_requests SET status='draft', returned_at=?, returned_by=?, return_reason=? WHERE id=?").run(Date.now(),actor.id,why,r.id);
    if(r.requester_id) db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'proc_request_returned', ?, ?, '', ?) ON CONFLICT DO NOTHING").run(r.requester_id,r.id,`أُعيد طلب الشراء ${r.no} للتعديل: ${why}`,Date.now());
    audit(db,actor,`إعادة طلب شراء للتعديل (${next.label})`,`${r.no}: ${why}`.slice(0,300),ip);
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
  if(Array.isArray(b?.lines)) checkReqLines(db, b.lines);
  return tx(db,()=>{
    const title=b?.title?clean(b.title,100,'عنوان الطلب',3):r.title;
    const desc=b?.description!==undefined?String(b.description).slice(0,500):r.description;
    const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):r.warehouse_id;
    db.prepare('UPDATE proc_requests SET title=?,description=?,warehouse_id=?,department=?,job_title=?,direct_manager=?,purchase_threshold=?,amount_words=?,need_day=?,supplier_id=?,supplier_name=? WHERE id=?').run(title,desc,whId,...reqHead(b,r),...reqSupplier(db,b,r),r.id);
    if(Array.isArray(b?.lines)){
      db.prepare('DELETE FROM proc_request_lines WHERE request_id=?').run(r.id);
      insertReqLines(db, r.id, b.lines);
    }
    if(b?.submit){ db.prepare("UPDATE proc_requests SET status='pending', requested_at=? WHERE id=?").run(Date.now(),r.id); audit(db,actor,'تعديل وإرسال طلب شراء',r.no,ip); } else audit(db,actor,'تعديل طلب شراء',r.no,ip);
    return getRequest(db,r.id);
  });
}
/* Orders */
export function listOrders(db,q={},meta={}){
  const w=[],a=[]; if(q.status){w.push('o.status=?');a.push(q.status);} if(q.supplier){w.push('o.supplier_id=?');a.push(Number(q.supplier));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  const _rows=db.prepare(`${ORDER_SELECT} ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...a, ...pageArgs(q,300)); meta.total=Number(_rows[0]?._total ?? _rows.length); return _rows.map(r=>orderView(db,r));
}
const ORDER_SELECT = `SELECT COUNT(*) OVER() AS _total, o.*, s.name supplierName, s.approved sup_approved, s.code sup_code, s.contact_person sup_contact, s.email sup_email, s.phone sup_phone, s.fax sup_fax, s.mobile sup_mobile, s.address sup_address, r.no requestNo
  FROM proc_orders o JOIN proc_suppliers s ON s.id=o.supplier_id LEFT JOIN proc_requests r ON r.id=o.request_id`;
// أمر الشراء ببيانات المورّد والتوصيل والفوترة والضرائب كما في نموذج الجامعة
/* بنود الأمر مع المستلم منها (غير المعكوس): الخدمة ببند الأمر، والمخزني بصنفه موزعاً على بنوده بالترتيب */
function orderLinesView(db, orderId){
  const ls = db.prepare('SELECT l.*, i.name itemName, i.code itemCode FROM proc_order_lines l LEFT JOIN proc_items i ON i.id=l.item_id WHERE l.order_id=? ORDER BY l.id').all(orderId);
  const rec = db.prepare('SELECT rl.item_id, rl.order_line_id, COALESCE(SUM(rl.qty),0) q FROM proc_receipt_lines rl JOIN proc_receipts r ON r.id=rl.receipt_id WHERE r.order_id=? AND r.reversed_at IS NULL GROUP BY rl.item_id, rl.order_line_id').all(orderId);
  const svc = new Map(), byItem = new Map();
  for (const x of rec) { if (x.item_id == null) svc.set(Number(x.order_line_id), Number(x.q)); else byItem.set(Number(x.item_id), (byItem.get(Number(x.item_id)) || 0) + Number(x.q)); }
  return ls.map((x) => {
    let got = 0;
    if (x.kind === 'service' || x.kind === 'asset') got = svc.get(Number(x.id)) || 0;
    else if (x.item_id) { const left = byItem.get(Number(x.item_id)) || 0; got = Math.min(left, Number(x.qty)); byItem.set(Number(x.item_id), left - got); }
    return { ...x, receivedQty: got };
  });
}
const orderView = (db, r) => {
  const taxes = Number(r.sales_tax||0) + Number(r.delivery_tax||0) + Number(r.other_tax||0);
  return {id:r.id,no:r.no,requestId:r.request_id,requestNo:r.requestNo,supplierId:r.supplier_id,supplierName:r.supplierName,supplierCode:r.sup_code,supplierApproved:r.sup_approved==null?true:!!Number(r.sup_approved),status:r.status,totalAmount:r.total_amount,orderedAt:r.ordered_at,receivedAt:r.received_at,note:r.note,createdBy:r.created_by,createdAt:r.created_at,
    supplier:{contactPerson:r.sup_contact??'',email:r.sup_email??'',phone:r.sup_phone??'',fax:r.sup_fax??'',mobile:r.sup_mobile??'',address:r.sup_address??''},
    deliveryMethod:r.delivery_method,deliveryDay:r.delivery_day,paymentTerms:r.payment_terms,currency:r.currency,
    deliveryContact:r.delivery_contact,deliveryEmail:r.delivery_email,deliveryAddress:r.delivery_address,billingContact:r.billing_contact,billingEmail:r.billing_email,
    salesTax:Number(r.sales_tax||0),deliveryTax:Number(r.delivery_tax||0),otherTax:Number(r.other_tax||0),grandTotal:Number(r.total_amount||0)+taxes,
    directReason:r.direct_reason??null,directApprovedBy:r.direct_approved_by??null,
    lines:orderLinesView(db,r.id).map(x=>({id:x.id,kind:x.kind||'stock',receivedQty:x.receivedQty,remainingQty:Math.max(0,Number(x.qty)-x.receivedQty),itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,description:x.description,qty:x.qty,unitCost:x.unit_cost,lineTotal:x.line_total,unit:x.unit}))};
};
const ORDER_HEAD = [['deliveryMethod','delivery_method',60,'طريقة التوصيل'],['paymentTerms','payment_terms',120,'شروط الدفع'],['currency','currency',20,'العملة'],['deliveryContact','delivery_contact',80,'شخص التواصل للتوصيل'],['deliveryEmail','delivery_email',120,'بريد التوصيل'],['deliveryAddress','delivery_address',160,'عنوان التوصيل'],['billingContact','billing_contact',80,'شخص التواصل للفوترة'],['billingEmail','billing_email',120,'بريد الفوترة']];
const orderHead = (b) => [...ORDER_HEAD.map(([k, , max, label]) => opt(b?.[k], max, label)), optDay(b?.deliveryDay, 'تاريخ التوصيل المطلوب'), nonNeg(b?.salesTax, 'ضريبة المبيعات'), nonNeg(b?.deliveryTax, 'ضريبة التوصيل'), nonNeg(b?.otherTax, 'الضرائب الأخرى')];
export function getOrder(db,id){
  const r=db.prepare(`${ORDER_SELECT} WHERE o.id=?`).get(Number(id)); if(!r) throw bad('أمر التوريد غير موجود.',404,'not_found');
  const o=orderView(db,r);
  o.dispatches=db.prepare('SELECT d.*, u.display_name by_name FROM proc_order_dispatches d LEFT JOIN users u ON u.id=d.sent_by WHERE d.order_id=? ORDER BY d.id DESC').all(r.id).map(d=>({id:Number(d.id),channel:d.channel,recipient:d.recipient??'',note:d.note??'',by:d.by_name??'',at:Number(d.sent_at)}));
  o.files=db.prepare('SELECT f.id, f.kind, f.orig_name, f.mime, f.size, f.uploaded_at, u.display_name by_name FROM proc_order_files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.order_id=? ORDER BY f.id DESC').all(r.id).map(f=>({id:Number(f.id),kind:f.kind,name:f.orig_name,mime:f.mime,size:Number(f.size),by:f.by_name??'',at:Number(f.uploaded_at)}));
  return {order:o};
}
/* بنود الأمر مقيّدة بالطلب المعتمد: لا صنف خارج الطلب، ولا كمية فوق المعتمد، ولا سعر أو إجمالي فوق التقدير
   إلا ضمن هامش الإعدادات (procurement.order_price_margin). ما يتجاوزه يحتاج طلباً جديداً يُعتمد. */
function checkOrderAgainstRequest(db, reqId, lines, opts = {}){
  const rl = db.prepare('SELECT item_id, description, qty, est_cost FROM proc_request_lines WHERE request_id=?').all(reqId);
  const margin = 1 + Math.max(0, Number(getSetting(db, 'procurement.order_price_margin') ?? 10)) / 100;
  const reqTotal = rl.reduce((s, x) => s + Number(x.qty) * Number(x.est_cost), 0);
  const ordTotal = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitCost), 0);
  const byItem = new Map();
  for (const x of rl) if (x.item_id) { const k = Number(x.item_id), c = byItem.get(k) || { qty: 0, cost: 0 }; c.qty += Number(x.qty); c.cost = Math.max(c.cost, Number(x.est_cost)); byItem.set(k, c); }
  const used = new Map();
  lines.forEach((l, i) => {
    if (!l.itemId) return;
    const k = Number(l.itemId), r = byItem.get(k);
    if (!r) throw bad(`البند ${i + 1}: الصنف غير مدرج في طلب الشراء المعتمد.`, 409, 'line_not_in_request');
    used.set(k, (used.get(k) || 0) + Number(l.qty));
    if (used.get(k) > r.qty + 1e-6) throw bad(`البند ${i + 1}: الكمية (${used.get(k)}) تتجاوز المعتمد في الطلب (${r.qty}).`, 409, 'qty_over_request');
    if (!opts.awarded && r.cost > 0 && Number(l.unitCost) > r.cost * margin + 1e-6) throw bad(`البند ${i + 1}: سعر الوحدة (${l.unitCost}) يتجاوز التقدير المعتمد (${r.cost}) بأكثر من الهامش المسموح؛ يحتاج طلباً جديداً يُعتمد.`, 409, 'price_over_request');
  });
  const reqQty = rl.reduce((s, x) => s + Number(x.qty), 0), ordQty = lines.reduce((s, l) => s + Number(l.qty), 0);
  if (ordQty > reqQty + 1e-6) throw bad(`مجموع كميات الأمر (${ordQty}) يتجاوز مجموع الطلب المعتمد (${reqQty}).`, 409, 'qty_over_request');
  if (!opts.awarded && reqTotal > 0 && ordTotal > reqTotal * margin + 1e-6) throw bad(`إجمالي الأمر (${Math.round(ordTotal)}) يتجاوز إجمالي الطلب المعتمد (${Math.round(reqTotal)}) بأكثر من الهامش المسموح؛ يحتاج طلباً جديداً يُعتمد.`, 409, 'total_over_request');
}
// opts.awarded: أمر ناتج عن ترسية عروض أسعار، فالسعر من المنافسة لا من التقدير (تبقى قيود الصنف والكمية)
export function createOrder({db},actor,b,ip,opts={}){
  const reqId=b?.requestId?Number(b.requestId):null;
  // بلا مورد محدد: المورد المقترح في طلب الشراء المرتبط إن وُجد
  const rqSup = reqId && !b?.supplierId && !String(b?.supplierName??'').trim() ? db.prepare('SELECT supplier_id, supplier_name FROM proc_requests WHERE id=?').get(reqId) : null;
  const supIn = rqSup && (rqSup.supplier_id || rqSup.supplier_name) ? { ...b, supplierId: rqSup.supplier_id, supplierName: rqSup.supplier_name } : b;
  if(!supIn?.supplierId && !String(supIn?.supplierName??'').trim()) throw bad('اختر المورد من القائمة أو اكتب اسمه.');
  if(supIn?.supplierId && !db.prepare('SELECT 1 FROM proc_suppliers WHERE id=? AND active=1').get(Number(supIn.supplierId))) throw bad('المورد غير موجود أو معطّل.');
  const budgetId=validBudgetForOrder(db, b?.budgetId?Number(b.budgetId):null);
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  if(lines.length>50) throw bad('حتى 50 بنداً للأمر.');
  for(let i=0;i<lines.length;i++){ const l=lines[i]; clean(l?.description,100,`وصف البند ${i+1}`,2); l.qty=checkQty(db, String(l.unit??'').trim() || (l.itemId?itemUnitOf(db,l.itemId):''), l?.qty, `البند ${i+1}`); if(!(Number(l?.unitCost)>0)) throw bad(`البند ${i+1}: سعر الوحدة مطلوب وأكبر من صفر.`); if((l.kind==='service'||l.kind==='asset') && l.itemId) throw bad(`البند ${i+1}: بند الخدمة أو الأصل الثابت لا يرتبط بصنف مخزني.`); if(l.kind==='asset' && !Number.isInteger(Number(l.qty))) throw bad(`البند ${i+1}: الأصول الثابتة بعدد صحيح.`); if(l.itemId && !db.prepare('SELECT 1 FROM proc_items WHERE id=?').get(Number(l.itemId))) throw bad(`البند ${i+1}: الصنف غير موجود.`); }
  let directReason = null;
  if(reqId){
    const rq=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(reqId); if(!rq) throw bad('طلب الشراء غير موجود.',404,'not_found'); if(rq.status!=='approved') throw bad('طلب الشراء ليس معتمداً.',409,'conflict'); if(db.prepare("SELECT 1 FROM proc_orders WHERE request_id=? AND status!='cancelled' LIMIT 1").get(reqId)) throw bad('يوجد أمر توريد مرتبط بهذا الطلب.',409,'conflict');
    // فصل المهام: من اعتمد الطلب لا يصدر أمره
    if(db.prepare('SELECT 1 FROM proc_request_approvals WHERE request_id=? AND user_id=? LIMIT 1').get(reqId, actor.id)) throw bad('فصل المهام: اعتمدت طلب الشراء هذا، فيصدر أمر التوريد شخص آخر.',403,'sod_violation');
    checkOrderAgainstRequest(db, reqId, lines, opts);
  } else {
    // أمر مباشر بلا طلب: استثناء بسبب مكتوب، ولا يُرسل للمورد إلا باعتماد شخص آخر
    directReason = String(b?.directReason ?? '').replace(/\s+/g,' ').trim();
    if(directReason.length < 10) throw bad('أمر التوريد بلا طلب شراء معتمد استثناء: اكتب سببه (10 أحرف على الأقل)، ويعتمده شخص آخر قبل إرساله.',400,'direct_reason_required');
    directReason = directReason.slice(0,300);
  }
  const head = orderHead(b); if (!head[2]) head[2] = 'ليرة سورية';
  return tx(db,()=>{
    const supId = Number(resolveSupplier(db, actor, supIn, ip).id);
    const no=nextNo(db,'PO','proc_orders');
    const total=Math.round(lines.reduce((s,l)=>s+Number(l.qty)*Number(l.unitCost||0),0));
    const id=Number(db.prepare('INSERT INTO proc_orders (no,request_id,supplier_id,status,total_amount,note,created_by,created_at,budget_id,delivery_method,payment_terms,currency,delivery_contact,delivery_email,delivery_address,billing_contact,billing_email,delivery_day,sales_tax,delivery_tax,other_tax,direct_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(no,reqId,supId,'draft',total,String(b?.note??'').slice(0,300),actor.id,Date.now(),budgetId,...head,directReason).lastInsertRowid);
    for(const l of lines){
      const unit = opt(l.unit,20,'الواحدة') || (l.itemId ? (db.prepare('SELECT unit FROM proc_items WHERE id=?').get(Number(l.itemId))?.unit ?? '') : '');
      db.prepare('INSERT INTO proc_order_lines (order_id,item_id,description,qty,unit_cost,line_total,unit,kind) VALUES (?,?,?,?,?,?,?,?)').run(id,l.itemId?Number(l.itemId):null,clean(l.description,100,'وصف البند',1),Number(l.qty),Number(l.unitCost||0),Math.round(Number(l.qty)*Number(l.unitCost||0)),unit,['service','asset'].includes(l.kind)?l.kind:'stock');
    }
    if(reqId) db.prepare("UPDATE proc_requests SET status='ordered' WHERE id=?").run(reqId);
    audit(db,actor,'إنشاء أمر توريد',no,ip); return getOrder(db,id);
  });
}
export function orderAction({db},actor,id,action,ip){
  const o=db.prepare('SELECT * FROM proc_orders WHERE id=?').get(Number(id)); if(!o) throw bad('أمر التوريد غير موجود.',404,'not_found');
  if(action==='order'){
    if(o.status!=='draft') throw bad('الأمر ليس مسودة.',409,'conflict');
    // الأمر المباشر (بلا طلب) يعتمده شخص غير منشئه
    if(!o.request_id){
      if(Number(o.created_by)===Number(actor.id)) throw bad('أمر توريد مباشر بلا طلب شراء: يعتمده ويرسله شخص غير منشئه (فصل المهام).',403,'sod_violation');
      db.prepare('UPDATE proc_orders SET direct_approved_by=?, direct_approved_at=? WHERE id=?').run(actor.id,Date.now(),o.id);
    }
    const warn=checkOrderBudget(db,o); if(warn) audit(db,actor,'تجاوز موازنة بأمر توريد (تحذير)',`${o.no}: ${warn}`,ip); db.prepare("UPDATE proc_orders SET status='ordered', ordered_at=? WHERE id=?").run(Date.now(),o.id); audit(db,actor,o.request_id?'إرسال أمر توريد':'اعتماد وإرسال أمر توريد مباشر',o.no,ip);
  }
  else if(action==='cancel'){
    if(!['draft','ordered'].includes(o.status)) throw bad('لا يمكن الإلغاء.',409,'conflict');
    // أمر استُلم منه شيء لا يُلغى: البضاعة في المخزن وقيدها في الدفتر
    if(db.prepare('SELECT 1 FROM proc_receipts WHERE order_id=? AND reversed_at IS NULL LIMIT 1').get(o.id)) throw bad('استُلم جزء من هذا الأمر فلا يُلغى؛ اعكس سند الاستلام أولاً أو أغلق الأمر بالمستلم.',409,'has_receipts');
    tx(db,()=>{
      db.prepare("UPDATE proc_orders SET status='cancelled' WHERE id=?").run(o.id);
      // الطلب يعود «معتمداً» إن لم يبقَ له أمر فعّال، فيُصدر له أمر جديد دون إعادة الاعتماد
      if(o.request_id && !db.prepare("SELECT 1 FROM proc_orders WHERE request_id=? AND status!='cancelled' LIMIT 1").get(o.request_id)) db.prepare("UPDATE proc_requests SET status='approved' WHERE id=? AND status='ordered'").run(o.request_id);
      // أمر ناتج عن ترسية: يعود طلب العروض مفتوحاً لترسية أخرى
      db.prepare("UPDATE proc_rfqs SET status='open', awarded_quote_id=NULL, order_id=NULL, award_note='' WHERE order_id=? AND status='awarded'").run(o.id);
      audit(db,actor,'إلغاء أمر توريد',o.no,ip);
    });
  }
  else throw bad('إجراء غير صالح.');
  return getOrder(db,o.id);
}
/* Receipts */
// opts.imported: سند تاريخي مستورد؛ «منشئ» الأمر المستورد هو من استورده لا المشتري، ففصل المهام لا ينطبق
export function createReceipt({db},actor,b,ip,opts={}){
  const orderId=Number(b?.orderId); const o=db.prepare('SELECT * FROM proc_orders WHERE id=?').get(orderId); if(!o) throw bad('أمر التوريد غير موجود.',404,'not_found');
  if(o.status!=='ordered') throw bad('أمر التوريد ليس مرسلاً.',409,'conflict');
  if(!opts.imported && getSetting(db,'procurement.sod_receive') && Number(o.created_by)===Number(actor.id)) throw bad('فصل المهام: أنشأت أمر التوريد هذا، فيستلمه أمين المستودع أو شخص آخر.',403,'sod_violation');
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  const orderLines=db.prepare('SELECT * FROM proc_order_lines WHERE order_id=?').all(orderId);
  const prevRows=db.prepare('SELECT rl.item_id, COALESCE(SUM(rl.qty),0) AS r_qty FROM proc_receipt_lines rl JOIN proc_receipts r ON r.id=rl.receipt_id WHERE r.order_id=? AND r.reversed_at IS NULL GROUP BY rl.item_id').all(orderId);
  const prevByItem=new Map(prevRows.map(x=>[Number(x.item_id),Number(x.r_qty)]));
  // بيانات مذكرة فحص واستلام المواد من نموذج الجامعة
  const supName = db.prepare('SELECT name FROM proc_suppliers WHERE id=?').get(o.supplier_id)?.name ?? '';
  const rHead = [opt(b?.receivedFrom,120,'تم الاستلام من') || supName, opt(b?.deliveryNoteNo,60,'رقم بيان الشحنة / مذكرة التسليم'), opt(b?.location,120,'موقع المستلم'), b?.compliant === true ? 1 : b?.compliant === false ? 0 : null];
  return tx(db,()=>{
    const rid=Number(db.prepare('INSERT INTO proc_receipts (order_id,received_at,note,created_by,created_at,received_from,delivery_note_no,location,compliant) VALUES (?,?,?,?,?,?,?,?,?)').run(orderId,Date.now(),String(b?.note??'').slice(0,300),actor.id,Date.now(),...rHead).lastInsertRowid);
    let receiptTotal=0, assetTotal=0; const assetIds=[];
    // الأمر قد يخص مستودعاً عبر طلب الشراء: يُعرَّف فيه الصنف الجديد افتراضياً
    const reqWh = o.request_id ? db.prepare('SELECT warehouse_id FROM proc_requests WHERE id=?').get(o.request_id)?.warehouse_id ?? null : null;
    // مستودع الاستلام: المحدد في السند، ثم مستودع طلب الشراء، ثم مستودع كل صنف
    const rcvWh = b?.warehouseId ? pickWh(db, null, b.warehouseId) : (reqWh ? Number(reqWh) : null);
    db.prepare('UPDATE proc_receipts SET warehouse_id=? WHERE id=?').run(rcvWh, rid);
    // بنود الخدمات/الأعمال المستلمة سابقاً لكل بند أمر
    const prevSvc=new Map(db.prepare('SELECT rl.order_line_id, COALESCE(SUM(rl.qty),0) AS q FROM proc_receipt_lines rl JOIN proc_receipts r ON r.id=rl.receipt_id WHERE r.order_id=? AND r.reversed_at IS NULL AND rl.item_id IS NULL GROUP BY rl.order_line_id').all(orderId).map(x=>[Number(x.order_line_id),Number(x.q)]));
    for(const l of lines){
      // خدمة أو أعمال: تُستلم بالكمية (إنجاز) دون حركة مخزن ولا صنف
      const svcLine = l.orderLineId ? orderLines.find(x=>Number(x.id)===Number(l.orderLineId) && (x.kind==='service' || x.kind==='asset')) : null;
      if(svcLine){
        const qty=Number(l.qty); if(!(qty>0)) throw bad('الكمية غير صالحة.');
        const done=prevSvc.get(Number(svcLine.id))||0;
        if(done+qty > Number(svcLine.qty)+1e-6) throw bad(`الكمية المستلمة (${qty}) تتجاوز المتبقي من بند الخدمة «${svcLine.description}» (المطلوب: ${svcLine.qty}، المستلم سابقاً: ${done}).`,409,'over_receipt_qty');
        prevSvc.set(Number(svcLine.id),done+qty);
        if(svcLine.kind==='asset'){ const ar=assetsFromReceipt(db, actor, { order:o, line:svcLine, qty, receiptId:rid, warehouseId:rcvWh }); assetTotal+=ar.total; assetIds.push(...ar.ids); }
        db.prepare('INSERT INTO proc_receipt_lines (receipt_id,item_id,qty,unit_cost,expected_qty,quality,comment,order_line_id) VALUES (?,?,?,?,?,?,?,?)').run(rid,null,qty,Number(svcLine.unit_cost),Number(svcLine.qty),opt(l.quality,30,'فحص الجودة'),opt(l.comment,200,'التعليقات'),svcLine.id);
        continue;
      }
      let itemId=Number(l.itemId);
      // بند في أمر الشراء بلا صنف مخزني (مادة لم تُعرَّف من قبل): يُعرَّف صنفاً عند استلامها ويُربط البند به
      if(!itemId && l.orderLineId){
        const ln=orderLines.find(x=>Number(x.id)===Number(l.orderLineId));
        if(!ln) throw bad('بند أمر الشراء غير موجود.',400,'validation');
        if(ln.item_id) itemId=Number(ln.item_id);
        else {
          const ni=l.newItem??{};
          const name=clean(ni.name||ln.description,80,'اسم الصنف الجديد',2), unit=clean(ni.unit||ln.unit||'قطعة',20,'وحدة الصنف الجديد');
          const code=ni.code?clean(ni.code,20,'رمز الصنف الجديد'):autoItemCode(db);
          if(db.prepare('SELECT 1 FROM proc_items WHERE code=?').get(code)) throw bad(`رمز الصنف ${code} مستخدم.`,409,'conflict');
          const catId=ni.categoryId?Number(ni.categoryId):null; if(catId && !db.prepare('SELECT 1 FROM proc_categories WHERE id=?').get(catId)) throw bad('التصنيف غير موجود.');
          const whId=ni.warehouseId?Number(ni.warehouseId):(rcvWh||reqWh); if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المستودع غير موجود.');
          itemId=Number(db.prepare('INSERT INTO proc_items (code,name,category_id,unit,warehouse_id,min_stock,max_stock,notes,created_at,qr_code) VALUES (?,?,?,?,?,0,0,?,?,?)').run(code,name,catId,unit,whId,`عُرِّف عند استلام أمر الشراء ${o.no}`,Date.now(),itemQr(db,ni.qrCode)).lastInsertRowid);
          db.prepare('UPDATE proc_order_lines SET item_id=? WHERE id=?').run(itemId,ln.id); ln.item_id=itemId;
          audit(db,actor,'تعريف صنف جديد عند الاستلام',`${code} ${name} (${o.no})`,ip);
        }
      }
      if(!itemId || !db.prepare('SELECT 1 FROM proc_items WHERE id=?').get(itemId)) throw bad('الصنف غير موجود.');
      const ol=orderLines.find(x=>Number(x.item_id)===itemId);
      const qty=checkQty(db, ol?.unit || itemUnitOf(db,itemId), l.qty, 'الكمية المستلمة');
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
      const expected = l.expectedQty !== undefined && l.expectedQty !== null && l.expectedQty !== '' ? Math.max(0, Number(l.expectedQty) || 0) : (ol ? Number(ol.qty) : null);
      db.prepare('INSERT INTO proc_receipt_lines (receipt_id,item_id,qty,unit_cost,expected_qty,quality,comment,order_line_id) VALUES (?,?,?,?,?,?,?,?)').run(rid,itemId,qty,cost,expected,opt(l.quality,30,'فحص الجودة'),opt(l.comment,200,'التعليقات'),ol?ol.id:null);
      // التحويل إلى وحدة التخزين: شراء بالعلبة وتخزين بالقطعة (العلبة = 12) يُدخل 12 × الكمية بسعر القطعة
      const f=unitFactor(db,itemId,ol?.unit), sQty=Math.round(qty*f*1000)/1000, sCost=f?cost/f:cost;
      const it=db.prepare('SELECT qty_on_hand, avg_cost FROM proc_items WHERE id=?').get(itemId);
      const newQty=Math.round((Number(it.qty_on_hand)+sQty)*1000)/1000;
      const newAvg=newQty>0?Math.round((Number(it.avg_cost)*Number(it.qty_on_hand) + sCost*sQty)/newQty):Math.round(sCost);
      // رصيد المستودع أولاً: الصنف القديم بلا رصيد مستودعي يُحسب من رصيده الكلي قبل تغييره
      const inWh = pickWh(db, itemId, rcvWh);
      whAdd(db, itemId, inWh, sQty);
      db.prepare('UPDATE proc_items SET qty_on_hand=?, avg_cost=? WHERE id=?').run(newQty,newAvg,itemId);
      stockMove(db, actor, { itemId, kind:'receipt', qty:sQty, unitCost:Math.round(sCost*100)/100, warehouseId:inWh, refType:'receipt', refId:rid, refNo:`${o.no} / RCV-${String(rid).padStart(4,'0')}`, note:opt(l.quality,30,'فحص الجودة') });
    }
    // الاكتمال لكل بند: الخدمة بكميتها المنجزة، والمخزني بصنفه، وبند مادة لم تُعرَّف بعد لم يُستلم
    const allReceived = !orderLines.length || orderLines.every(ol => (ol.kind==='service' || ol.kind==='asset') ? (prevSvc.get(Number(ol.id)) || 0) >= Number(ol.qty) - 1e-6
      : ol.item_id ? (prevByItem.get(Number(ol.item_id)) || 0) >= Number(ol.qty) - 1e-6 : false);
    if (allReceived) {
      db.prepare("UPDATE proc_orders SET status='received', received_at=? WHERE id=?").run(Date.now(),orderId);
    }
    const stockTotal = receiptTotal;
    const j = stockTotal > 0 ? postReceiptJournal(db, actor, rid, o.no, stockTotal) : { journalEntryId: null, journalError: null };
    const aj = assetTotal > 0 ? postAssetAcquisition(db, actor, rid, o.no, assetTotal) : { entryId: null, error: null };
    audit(db,actor,'استلام توريد',o.no,ip);
    return {receiptId:rid, journalEntryId:j.journalEntryId, journalError:j.journalError || aj.error || null, assetIds, status: allReceived ? 'received' : 'ordered'};
  });
}
/* قيد استحقاق الاستلام المخزني (مدين المخزون 1301 / دائن الموردين 2101). تعذّره لا يُبتلع بصمت:
   يُحفظ سببه على السند ويُبلَّغ من يملك ترحيل القيود، ويُعاد ترحيله من شاشة الاستلامات بعد معالجة السبب. */
/* ===== قيود المخزون (الصرف والتسوية) =====
   قيد بسطرين في السنة المالية المفتوحة. يعيد {entryId} أو {error} بسبب واضح (حساب غير معرَّف أو موقوف، لا سنة مفتوحة،
   حساب يشترط مركز تكلفة)، فلا يُبتلع التعذّر، ويبقى المستند صحيحاً في المخزون ويُعاد ترحيل قيده بعد المعالجة. */
export const acctFor = (db, code, label) => {
  const a = db.prepare('SELECT id, code, name, postable, active, require_cc FROM fin_accounts WHERE code = ?').get(String(code ?? '').trim());
  if (!a) return { error: `حساب ${label} (${code}) غير موجود في دليل الحسابات.` };
  if (!Number(a.postable) || !Number(a.active)) return { error: `حساب ${label} (${code}) غير نهائي أو موقوف.` };
  return { acc: a };
};
export function writeStockEntry(db, actor, { source, reference, desc, debit, credit, amount, cc = null }) {
  const minor = Math.round(Number(amount) * 100);
  if (!(minor > 0)) return { entryId: null, error: null };
  if (debit.error) return { error: debit.error }; if (credit.error) return { error: credit.error };
  for (const a of [debit.acc, credit.acc]) if (Number(a.require_cc) && !cc) return { error: `حساب ${a.code} يشترط مركز تكلفة؛ عرّف مركز تكلفة باسم القسم أو اربط القسم به.` };
  const year = db.prepare("SELECT id, name FROM fin_years WHERE status='open' ORDER BY start_day DESC LIMIT 1").get();
  if (!year) return { error: 'لا توجد سنة مالية مفتوحة.' };
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());
  const seq = nextNumber(db, `fin:${year.id}:JV`, "SELECT MAX(seq) FROM fin_entries WHERE year_id = ? AND type = 'JV'", [year.id]);
  const entryId = Number(db.prepare("INSERT INTO fin_entries (year_id, seq, no, type, entry_day, description, reference, status, source, created_by, created_at, posted_by, posted_at) VALUES (?,?,?,'JV',?,?,?,'posted',?,?,?,?,?) RETURNING id")
    .get(year.id, seq, `JV-${year.name}-${String(seq).padStart(5, '0')}`, day, desc.slice(0, 300), String(reference).slice(0, 60), source, actor?.id ?? null, Date.now(), actor?.id ?? null, Date.now()).id);
  db.prepare('INSERT INTO fin_lines (entry_id, line_no, account_id, debit, credit, note, cost_center_id) VALUES (?,?,?,?,?,?,?)').run(entryId, 1, debit.acc.id, minor, 0, desc.slice(0, 200), Number(debit.acc.require_cc) || debit.cc ? cc : null);
  db.prepare('INSERT INTO fin_lines (entry_id, line_no, account_id, debit, credit, note, cost_center_id) VALUES (?,?,?,?,?,?,?)').run(entryId, 2, credit.acc.id, 0, minor, desc.slice(0, 200), Number(credit.acc.require_cc) ? cc : null);
  return { entryId, error: null };
}
export const notifyFinance = (db, kind, refId, text) => { const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING"); for (const u of holdersOf(db, 'finance:post')) ins.run(u, kind, refId, text, Date.now()); };
export const invAcct = (db) => { const a = db.prepare("SELECT code FROM fin_accounts WHERE system_key='inventory' OR code='1301' ORDER BY CASE WHEN system_key='inventory' THEN 0 ELSE 1 END LIMIT 1").get(); return acctFor(db, a ? a.code : '1301', 'المخزون'); };
// مركز تكلفة القسم الطالب: بالاسم أو الرمز
export const ccOf = (db, dept) => { const d = String(dept ?? '').trim(); if (!d) return null; return db.prepare('SELECT id FROM fin_cost_centers WHERE (name = ? OR code = ?) AND active = 1 LIMIT 1').get(d, d)?.id ?? null; };

/* قيد الصرف: المصروف (حساب الإعداد procurement.issue_expense_account) مدين بمركز تكلفة القسم، والمخزون دائن بمتوسط التكلفة */
export function postIssueJournal(db, actor, issueId){
  const is = db.prepare('SELECT * FROM proc_issues WHERE id=?').get(Number(issueId));
  const amount = Number(db.prepare('SELECT COALESCE(SUM(ABS(qty) * unit_cost), 0) v FROM proc_stock_moves WHERE ref_type = ? AND ref_id = ? AND kind = ?').get('issue', is.id, 'issue').v);
  const exp = { ...acctFor(db, getSetting(db, 'procurement.issue_expense_account'), 'مصروف المواد المصروفة'), cc: true };
  const r = writeStockEntry(db, actor, { source: `proc_issue:${is.id}`, reference: is.no, desc: `قيد صرف مخزني ${is.no} إلى ${is.issued_to}`, debit: exp, credit: invAcct(db), amount, cc: ccOf(db, is.department || is.issued_to) });
  db.prepare('UPDATE proc_issues SET journal_entry_id=?, journal_error=? WHERE id=?').run(r.entryId ?? null, r.error, is.id);
  if (r.error) notifyFinance(db, 'proc_issue_journal', is.id, `إذن الصرف ${is.no} خرج من المخزون بلا قيد محاسبي: ${r.error}`);
  return { journalEntryId: r.entryId ?? null, journalError: r.error };
}
/* قيد فرق الجرد: العجز على حساب الفروقات (procurement.adjust_loss_account)، والزيادة لحساب الإيراد (procurement.adjust_gain_account) */
export function postAdjustJournal(db, actor, moveId){
  const m = db.prepare('SELECT m.*, i.code FROM proc_stock_moves m JOIN proc_items i ON i.id = m.item_id WHERE m.id = ?').get(Number(moveId));
  const amount = Math.abs(Number(m.qty)) * Number(m.unit_cost), loss = Number(m.qty) < 0;
  const other = loss ? acctFor(db, getSetting(db, 'procurement.adjust_loss_account'), 'عجز الجرد') : acctFor(db, getSetting(db, 'procurement.adjust_gain_account'), 'زيادة الجرد');
  const r = writeStockEntry(db, actor, { source: `proc_adjust:${m.id}`, reference: m.code, desc: `قيد ${loss ? 'عجز' : 'زيادة'} جرد للصنف ${m.code}: ${m.note}`, debit: loss ? other : invAcct(db), credit: loss ? invAcct(db) : other, amount });
  db.prepare('UPDATE proc_stock_moves SET journal_entry_id=?, journal_error=? WHERE id=?').run(r.entryId ?? null, r.error, m.id);
  if (r.error) notifyFinance(db, 'proc_adjust_journal', m.id, `تسوية جرد الصنف ${m.code} بلا قيد محاسبي: ${r.error}`);
  return { journalEntryId: r.entryId ?? null, journalError: r.error };
}
// ما خرج من المخزون أو دخله بلا قيد: للمالية لتعالج السبب ثم تعيد الترحيل
export function unpostedStock(db){
  return {
    receipts: db.prepare('SELECT r.id, r.journal_error, r.received_at, o.no order_no FROM proc_receipts r JOIN proc_orders o ON o.id=r.order_id WHERE r.journal_error IS NOT NULL AND r.journal_entry_id IS NULL AND r.reversed_at IS NULL ORDER BY r.id DESC LIMIT 200').all().map((x)=>({id:Number(x.id),no:`RCV-${String(x.id).padStart(4,'0')}`,ref:x.order_no,error:x.journal_error,at:Number(x.received_at)})),
    issues: db.prepare('SELECT id, no, journal_error, issued_at FROM proc_issues WHERE journal_error IS NOT NULL AND journal_entry_id IS NULL AND reversed_at IS NULL ORDER BY id DESC LIMIT 200').all().map((x)=>({id:Number(x.id),no:x.no,error:x.journal_error,at:Number(x.issued_at)})),
    adjustments: db.prepare("SELECT m.id, m.journal_error, m.created_at, i.code FROM proc_stock_moves m JOIN proc_items i ON i.id=m.item_id WHERE m.kind='adjust' AND m.journal_error IS NOT NULL AND m.journal_entry_id IS NULL ORDER BY m.id DESC LIMIT 200").all().map((x)=>({id:Number(x.id),no:x.code,error:x.journal_error,at:Number(x.created_at)})),
  };
}
export function repostStockJournal({db}, actor, kind, id, ip){
  if(kind==='receipts') return repostReceiptJournal({db}, actor, id, ip);
  if(kind==='issues'){ const is=db.prepare('SELECT * FROM proc_issues WHERE id=?').get(Number(id)); if(!is) throw bad('إذن الصرف غير موجود.',404,'not_found'); if(is.journal_entry_id) throw bad('للإذن قيد مرحّل.',409,'conflict'); if(is.reversed_at) throw bad('الإذن معكوس.',409,'conflict'); return tx(db,()=>{ const j=postIssueJournal(db,actor,is.id); if(j.journalEntryId) audit(db,actor,'ترحيل قيد صرف متأخر',is.no,ip); return j; }); }
  if(kind==='adjustments'){ const m=db.prepare("SELECT * FROM proc_stock_moves WHERE id=? AND kind='adjust'").get(Number(id)); if(!m) throw bad('التسوية غير موجودة.',404,'not_found'); if(m.journal_entry_id) throw bad('للتسوية قيد مرحّل.',409,'conflict'); return tx(db,()=>{ const j=postAdjustJournal(db,actor,m.id); if(j.journalEntryId) audit(db,actor,'ترحيل قيد تسوية جرد متأخر',`#${m.id}`,ip); return j; }); }
  throw bad('نوع غير معروف.');
}
/* مطابقة المخزون مع الدفتر المحاسبي: قيمة المخزون (الرصيد × متوسط التكلفة + قيد النقل) مقابل رصيد حساب المخزون المرحّل */
export function glReconcile(db){
  const stock = Number(db.prepare('SELECT COALESCE(SUM(qty_on_hand * avg_cost), 0) v FROM proc_items').get().v);
  const transit = inTransit(db).value;
  const acc = db.prepare("SELECT id, code, name FROM fin_accounts WHERE system_key='inventory' OR code='1301' ORDER BY CASE WHEN system_key='inventory' THEN 0 ELSE 1 END LIMIT 1").get();
  const gl = acc ? Number(db.prepare("SELECT COALESCE(SUM(l.debit - l.credit), 0) v FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE l.account_id = ? AND e.status = 'posted'").get(acc.id).v) / 100 : 0;
  const unposted = unpostedStock(db);
  const value = Math.round(stock + transit);
  return { stockValue: value, glBalance: Math.round(gl), difference: Math.round(value - gl), account: acc ? `${acc.code} ${acc.name}` : null, unposted: unposted.receipts.length + unposted.issues.length + unposted.adjustments.length };
}

export function postReceiptJournal(db, actor, rid, orderNo, amount){
  const fail = (why) => {
    db.prepare('UPDATE proc_receipts SET journal_error=? WHERE id=?').run(why, rid);
    const ins=db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'proc_receipt_journal', ?, ?, '', ?) ON CONFLICT DO NOTHING");
    for(const u of holdersOf(db,'finance:post')) ins.run(u, rid, `سند الاستلام #${rid} (أمر ${orderNo}) دخل المخزون بلا قيد محاسبي: ${why}`, Date.now());
    return { journalEntryId: null, journalError: why };
  };
  const invAcc = db.prepare("SELECT id FROM fin_accounts WHERE system_key='inventory' OR code='1301' LIMIT 1").get();
  const supAcc = db.prepare("SELECT id FROM fin_accounts WHERE system_key='suppliers' OR code='2101' LIMIT 1").get();
  const openYear = db.prepare("SELECT id, name FROM fin_years WHERE status='open' ORDER BY start_day DESC LIMIT 1").get();
  if (!invAcc) return fail('حساب المخزون (1301) غير موجود في دليل الحسابات.');
  if (!supAcc) return fail('حساب الموردين (2101) غير موجود في دليل الحسابات.');
  if (!openYear) return fail('لا توجد سنة مالية مفتوحة.');
  const receiptTotal = amount, o = { no: orderNo };
  let journalEntryId = null;
  {
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
  db.prepare('UPDATE proc_receipts SET journal_entry_id=?, journal_error=NULL WHERE id=?').run(journalEntryId, rid);
  return { journalEntryId, journalError: null };
}
export function repostReceiptJournal({db}, actor, id, ip){
  const r = db.prepare('SELECT r.*, o.no order_no FROM proc_receipts r JOIN proc_orders o ON o.id=r.order_id WHERE r.id=?').get(Number(id));
  if(!r) throw bad('سند الاستلام غير موجود.',404,'not_found');
  if(r.journal_entry_id) throw bad('للسند قيد مرحّل.',409,'conflict');
  if(r.reversed_at) throw bad('السند معكوس.',409,'conflict');
  const amt = Number(db.prepare('SELECT COALESCE(SUM(qty*unit_cost),0) v FROM proc_receipt_lines WHERE receipt_id=? AND item_id IS NOT NULL').get(r.id).v);
  return tx(db,()=>{ const j = postReceiptJournal(db, actor, r.id, r.order_no, amt); if(j.journalEntryId) audit(db,actor,'ترحيل قيد استلام متأخر',`${r.order_no} #${r.id}`,ip); return j; });
}
export function listReceipts(db,q={},meta={}){
  const where=q.orderId?'WHERE r.order_id=?':''; const a=q.orderId?[Number(q.orderId)]:[];
  const _rows=db.prepare(`SELECT COUNT(*) OVER() AS _total, r.*, o.no orderNo, s.name supplierName, rq.no requestNo FROM proc_receipts r JOIN proc_orders o ON o.id=r.order_id JOIN proc_suppliers s ON s.id=o.supplier_id LEFT JOIN proc_requests rq ON rq.id=o.request_id ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...a, ...pageArgs(q,200)); meta.total=Number(_rows[0]?._total ?? _rows.length); return _rows.map(r=>({journalEntryId:r.journal_entry_id??null,journalError:r.journal_error??null,id:r.id,no:`RCV-${String(r.id).padStart(4,'0')}`,orderId:r.order_id,orderNo:r.orderNo,requestNo:r.requestNo,supplierName:r.supplierName,receivedAt:r.received_at,note:r.note,reversedAt:r.reversed_at,
    receivedFrom:r.received_from||r.supplierName,deliveryNoteNo:r.delivery_note_no,location:r.location,compliant:r.compliant==null?null:!!Number(r.compliant),
    lines:db.prepare("SELECT l.*, COALESCE(i.name, ol.description) itemName, COALESCE(i.code, '') itemCode, COALESCE(i.unit, ol.unit) unit, CASE WHEN l.item_id IS NULL THEN 'service' ELSE 'stock' END kind FROM proc_receipt_lines l LEFT JOIN proc_items i ON i.id=l.item_id LEFT JOIN proc_order_lines ol ON ol.id=l.order_line_id WHERE l.receipt_id=? ORDER BY l.id").all(r.id).map(x=>({itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,unit:x.unit,qty:x.qty,unitCost:x.unit_cost,expectedQty:x.expected_qty==null?null:Number(x.expected_qty),quality:x.quality,comment:x.comment}))}));
}
/* ===== الرصيد لكل مستودع =====
   رصيد الصنف الكلي = مجموع أرصدته في المستودعات؛ كل إدخال وإخراج يحدد مستودعه، ولا يُخرج من مستودع أكثر مما فيه. */
// صنف بلا أي رصيد مستودعي (بيانات قديمة أو مُدخلة مباشرة): رصيده كله في مستودعه الافتراضي، ويُثبَّت في جدول المستودعات عند أول حركة
export function whQty(db, itemId, whId){
  const row = db.prepare('SELECT qty FROM proc_item_stock WHERE item_id=? AND warehouse_id=?').get(Number(itemId), Number(whId));
  if (row) return Number(row.qty);
  if (db.prepare('SELECT 1 FROM proc_item_stock WHERE item_id=? LIMIT 1').get(Number(itemId))) return 0;
  const it = db.prepare('SELECT warehouse_id, qty_on_hand FROM proc_items WHERE id=?').get(Number(itemId));
  return it && Number(it.warehouse_id) === Number(whId) ? Math.max(0, Number(it.qty_on_hand)) : 0;
}
export function whAdd(db, itemId, whId, delta){
  if(!whId) throw bad('حدد المستودع.');
  const cur = whQty(db, itemId, whId), next = Math.round((cur + Number(delta)) * 1000) / 1000;
  if(next < -1e-9){ const it=db.prepare('SELECT code FROM proc_items WHERE id=?').get(Number(itemId)); const w=db.prepare('SELECT name FROM proc_warehouses WHERE id=?').get(Number(whId)); throw bad(`رصيد الصنف ${it?.code ?? itemId} في ${w?.name ?? 'المستودع'} لا يكفي (${cur} متاح).`,409,'insufficient_stock'); }
  db.prepare('INSERT INTO proc_item_stock (item_id, warehouse_id, qty) VALUES (?,?,?) ON CONFLICT (item_id, warehouse_id) DO UPDATE SET qty = excluded.qty').run(Number(itemId), Number(whId), Math.max(0, next));
  return next;
}
// مستودع افتراضي لحركة صنف: المحدد، ثم مستودع الصنف، ثم أول مستودع فعّال
function pickWh(db, itemId, whId){
  if(whId){ if(!db.prepare('SELECT 1 FROM proc_warehouses WHERE id=? AND active=1').get(Number(whId))) throw bad('المستودع غير موجود أو معطّل.'); return Number(whId); }
  const own=db.prepare('SELECT warehouse_id FROM proc_items WHERE id=?').get(Number(itemId))?.warehouse_id;
  if(own) return Number(own);
  const first=db.prepare('SELECT id FROM proc_warehouses WHERE active=1 ORDER BY id LIMIT 1').get();
  if(!first) throw bad('عرّف مستودعاً واحداً على الأقل قبل حركات المخزون.');
  return Number(first.id);
}
const stocksOf=(db,itemId)=>db.prepare('SELECT s.warehouse_id, s.qty, w.name, w.code FROM proc_item_stock s JOIN proc_warehouses w ON w.id=s.warehouse_id WHERE s.item_id=? AND s.qty<>0 ORDER BY w.code').all(Number(itemId)).map((x)=>({warehouseId:Number(x.warehouse_id),code:x.code,name:x.name,qty:Number(x.qty)}));

/* ===== سند التحويل بين المستودعات (خطوتان) =====
   الإرسال يُخرج الكميات من المستودع المرسِل فتصير «قيد النقل»، والاستلام يُدخلها المستودع المستلِم بيد شخص غير المرسِل.
   الإلغاء قبل الاستلام يعيدها إلى المرسِل. كل خطوة تُكتب في دفتر الحركات. */
const trView=(db,t)=>({id:Number(t.id),no:t.no,fromWh:Number(t.from_wh),fromName:t.from_name,toWh:Number(t.to_wh),toName:t.to_name,status:t.status,note:t.note,sentBy:t.sent_name??'',sentById:Number(t.sent_by),sentAt:Number(t.sent_at),receivedBy:t.recv_name??'',receivedAt:t.received_at?Number(t.received_at):null,receiveNote:t.receive_note??'',
  lines:db.prepare('SELECT l.*, i.code, i.name, i.unit FROM proc_transfer_lines l JOIN proc_items i ON i.id=l.item_id WHERE l.transfer_id=? ORDER BY l.id').all(t.id).map((l)=>({itemId:Number(l.item_id),code:l.code,name:l.name,unit:l.unit,qty:Number(l.qty),unitCost:Number(l.unit_cost)}))});
const TR_SELECT=`SELECT t.*, f.name from_name, d.name to_name, us.display_name sent_name, ur.display_name recv_name FROM proc_transfers t JOIN proc_warehouses f ON f.id=t.from_wh JOIN proc_warehouses d ON d.id=t.to_wh LEFT JOIN users us ON us.id=t.sent_by LEFT JOIN users ur ON ur.id=t.received_by`;
export function listTransfers(db,q={}){ const w=q.status?'WHERE t.status=?':''; return db.prepare(`${TR_SELECT} ${w} ORDER BY t.id DESC LIMIT 200`).all(...(q.status?[q.status]:[])).map((t)=>trView(db,t)); }
const loadTr=(db,id)=>{ const t=db.prepare(`${TR_SELECT} WHERE t.id=?`).get(Number(id)); if(!t) throw bad('سند التحويل غير موجود.',404,'not_found'); return t; };
export function createTransfer({db},actor,b,ip){
  const from=pickWh(db,null,b?.fromWarehouseId), to=pickWh(db,null,b?.toWarehouseId);
  if(!b?.fromWarehouseId||!b?.toWarehouseId) throw bad('حدد المستودع المرسِل والمستودع المستلِم.');
  if(from===to) throw bad('المستودعان متطابقان.');
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف صنفاً واحداً على الأقل.'); if(lines.length>100) throw bad('حتى 100 صنف للسند.');
  const need=new Map();
  for(const [i,l] of lines.entries()){ if(!db.prepare('SELECT 1 FROM proc_items WHERE id=?').get(Number(l.itemId))) throw bad(`البند ${i+1}: الصنف غير موجود.`); const q=checkQty(db,itemUnitOf(db,l.itemId),l?.qty,`البند ${i+1}`); need.set(Number(l.itemId),(need.get(Number(l.itemId))||0)+q); }
  const note=String(b?.note??'').replace(/\s+/g,' ').trim().slice(0,300);
  return tx(db,()=>{
    for(const [itemId,q] of need){ const have=whQty(db,itemId,from); if(q>have+1e-9){ const it=db.prepare('SELECT code FROM proc_items WHERE id=?').get(itemId); throw bad(`الصنف ${it.code}: الرصيد في المستودع المرسِل لا يكفي (${have} متاح).`,409,'insufficient_stock'); } }
    const no=nextNo(db,'TR','proc_transfers');
    const id=Number(db.prepare('INSERT INTO proc_transfers (no,from_wh,to_wh,status,note,sent_by,sent_at) VALUES (?,?,?,?,?,?,?) RETURNING id').get(no,from,to,'sent',note,actor.id,Date.now()).id);
    for(const [itemId,q] of need){
      const cost=Number(db.prepare('SELECT avg_cost FROM proc_items WHERE id=?').get(itemId).avg_cost);
      db.prepare('INSERT INTO proc_transfer_lines (transfer_id,item_id,qty,unit_cost) VALUES (?,?,?,?)').run(id,itemId,q,cost);
      whAdd(db,itemId,from,-q);
      db.prepare('UPDATE proc_items SET qty_on_hand = qty_on_hand - ? WHERE id=?').run(q,itemId);
      stockMove(db,actor,{itemId,kind:'transfer_out',qty:-q,unitCost:cost,warehouseId:from,refType:'transfer',refId:id,refNo:no,note:'قيد النقل'});
    }
    audit(db,actor,'إرسال سند تحويل مخزني',no,ip);
    return {transfer:trView(db,loadTr(db,id))};
  });
}
export function receiveTransfer({db},actor,id,b,ip){
  const t=loadTr(db,id); if(t.status!=='sent') throw bad('سند التحويل ليس قيد النقل.',409,'conflict');
  if(getSetting(db,'procurement.sod_receive') && Number(t.sent_by)===Number(actor.id)) throw bad('فصل المهام: أرسلت هذا التحويل، فيستلمه أمين المستودع المستلِم.',403,'sod_violation');
  return tx(db,()=>{
    for(const l of db.prepare('SELECT * FROM proc_transfer_lines WHERE transfer_id=?').all(t.id)){
      whAdd(db,l.item_id,t.to_wh,Number(l.qty));
      db.prepare('UPDATE proc_items SET qty_on_hand = qty_on_hand + ? WHERE id=?').run(Number(l.qty),l.item_id);
      stockMove(db,actor,{itemId:l.item_id,kind:'transfer_in',qty:Number(l.qty),unitCost:Number(l.unit_cost),warehouseId:t.to_wh,refType:'transfer',refId:t.id,refNo:t.no,note:`وارد من ${t.from_name}`});
    }
    db.prepare("UPDATE proc_transfers SET status='received', received_by=?, received_at=?, receive_note=? WHERE id=?").run(actor.id,Date.now(),String(b?.note??'').slice(0,300),t.id);
    audit(db,actor,'استلام سند تحويل مخزني',t.no,ip);
    return {transfer:trView(db,loadTr(db,t.id))};
  });
}
export function cancelTransfer({db},actor,id,b,ip){
  const t=loadTr(db,id); if(t.status!=='sent') throw bad('يُلغى التحويل قيد النقل فقط.',409,'conflict');
  if(Number(t.sent_by)!==Number(actor.id) && !actor.can('procurement:manage')) throw bad('يلغي التحويل مرسِله أو مدير المشتريات.',403,'forbidden');
  const why=String(b?.reason??'').replace(/\s+/g,' ').trim(); if(why.length<5) throw bad('اكتب سبب إلغاء التحويل.',400,'reason_required');
  return tx(db,()=>{
    for(const l of db.prepare('SELECT * FROM proc_transfer_lines WHERE transfer_id=?').all(t.id)){
      whAdd(db,l.item_id,t.from_wh,Number(l.qty));
      db.prepare('UPDATE proc_items SET qty_on_hand = qty_on_hand + ? WHERE id=?').run(Number(l.qty),l.item_id);
      stockMove(db,actor,{itemId:l.item_id,kind:'transfer_in',qty:Number(l.qty),unitCost:Number(l.unit_cost),warehouseId:t.from_wh,refType:'transfer',refId:t.id,refNo:t.no,note:`إلغاء التحويل: ${why}`.slice(0,200)});
    }
    db.prepare("UPDATE proc_transfers SET status='cancelled', receive_note=? WHERE id=?").run(why.slice(0,300),t.id);
    audit(db,actor,'إلغاء سند تحويل مخزني',`${t.no}: ${why}`.slice(0,300),ip);
    return {transfer:trView(db,loadTr(db,t.id))};
  });
}
// قيمة البضاعة قيد النقل (أُخرجت من مستودع ولم تُستلم بعد)
export function inTransit(db){ const r=db.prepare("SELECT COUNT(DISTINCT t.id) n, COALESCE(SUM(l.qty*l.unit_cost),0) v FROM proc_transfers t JOIN proc_transfer_lines l ON l.transfer_id=t.id WHERE t.status='sent'").get(); return {count:Number(r.n),value:Math.round(Number(r.v))}; }

/* ===== دفتر الحركات المخزنية =====
   كل تغيّر في رصيد صنف يمر من هنا: سطر بالكمية (موجبة للإدخال وسالبة للإخراج) والرصيد بعده والمرجع.
   الرصيد بعد الحركة يُحسب من آخر سطر في الدفتر لا من بطاقة الصنف، فيبقى الدفتر متسقاً بذاته. */
export function stockMove(db, actor, { itemId, kind, qty, unitCost = 0, warehouseId, refType = '', refId = null, refNo = '', note = '' }) {
  const last = db.prepare('SELECT balance_after FROM proc_stock_moves WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(Number(itemId));
  const wh = warehouseId !== undefined ? warehouseId : (db.prepare('SELECT warehouse_id FROM proc_items WHERE id = ?').get(Number(itemId))?.warehouse_id ?? null);
  const after = Math.round(((last ? Number(last.balance_after) : 0) + Number(qty)) * 1000) / 1000;
  db.prepare('INSERT INTO proc_stock_moves (item_id, warehouse_id, kind, qty, unit_cost, balance_after, ref_type, ref_id, ref_no, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(Number(itemId), wh, kind, Number(qty), Number(unitCost) || 0, after, refType, refId, String(refNo).slice(0, 40), String(note).slice(0, 200), actor?.id ?? null, Date.now());
  return after;
}
// عكس حركات مستند (تراجع الاستيراد): سطر معاكس لكل حركة سجّلها المستند
export function reverseStockMoves(db, actor, refType, refId, note = 'عكس مستند') {
  const moves = db.prepare("SELECT * FROM proc_stock_moves WHERE ref_type = ? AND ref_id = ? AND kind <> 'reversal' ORDER BY id").all(refType, Number(refId));
  for (const m of moves) {
    if (m.warehouse_id) whAdd(db, m.item_id, m.warehouse_id, -Number(m.qty));
    stockMove(db, actor, { itemId: m.item_id, kind: 'reversal', qty: -Number(m.qty), unitCost: m.unit_cost, warehouseId: m.warehouse_id, refType, refId: Number(refId), refNo: m.ref_no, note });
  }
  return moves.length;
}
const KIND_AR = { opening: 'رصيد افتتاحي', receipt: 'استلام', issue: 'صرف', adjust: 'تسوية جرد', reversal: 'عكس', transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', return: 'مرتجع إلى المستودع' };
/* بطاقة الصنف: رصيد أول المدة ثم حركات الفترة بالرصيد بعد كل حركة */
export function itemCard(db, id, q = {}) {
  const it = db.prepare('SELECT i.*, w.name wh_name FROM proc_items i LEFT JOIN proc_warehouses w ON w.id = i.warehouse_id WHERE i.id = ?').get(Number(id));
  if (!it) throw bad('الصنف غير موجود.', 404, 'not_found');
  const from = q.from && isDay(q.from) ? new Date(`${q.from}T00:00:00+03:00`).getTime() : 0;
  const to = q.to && isDay(q.to) ? new Date(`${q.to}T23:59:59.999+03:00`).getTime() : Date.now() + 1;
  const open = from ? db.prepare('SELECT balance_after FROM proc_stock_moves WHERE item_id = ? AND created_at < ? ORDER BY id DESC LIMIT 1').get(it.id, from) : null;
  const moves = db.prepare(`SELECT m.*, u.display_name by_name FROM proc_stock_moves m LEFT JOIN users u ON u.id = m.created_by
    WHERE m.item_id = ? AND m.created_at >= ? AND m.created_at <= ? ORDER BY m.id LIMIT 5000`).all(it.id, from, to);
  const last = db.prepare('SELECT balance_after FROM proc_stock_moves WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(it.id);
  return {
    item: { id: Number(it.id), code: it.code, name: it.name, unit: it.unit, warehouse: it.wh_name ?? '', qtyOnHand: Number(it.qty_on_hand), avgCost: Number(it.avg_cost) },
    from: q.from || null, to: q.to || null, opening: open ? Number(open.balance_after) : 0,
    moves: moves.map((m) => ({ id: Number(m.id), at: Number(m.created_at), kind: m.kind, kindLabel: KIND_AR[m.kind] || m.kind, qty: Number(m.qty), in: Number(m.qty) > 0 ? Number(m.qty) : 0, out: Number(m.qty) < 0 ? -Number(m.qty) : 0, unitCost: Number(m.unit_cost), balance: Number(m.balance_after), refType: m.ref_type, refNo: m.ref_no, note: m.note, by: m.by_name ?? '' })),
    totals: { in: moves.reduce((s, m) => s + Math.max(0, Number(m.qty)), 0), out: moves.reduce((s, m) => s + Math.max(0, -Number(m.qty)), 0) },
    ledgerBalance: last ? Number(last.balance_after) : 0,
    consistent: Math.abs((last ? Number(last.balance_after) : 0) - Number(it.qty_on_hand)) < 1e-6,
  };
}
/* الرصيد في تاريخ سابق لكل الأصناف (آخر رصيد في الدفتر حتى نهاية ذلك اليوم) وقيمته بمتوسط التكلفة الحالي */
export function stockAt(db, q = {}) {
  const dayStr = q.day && isDay(q.day) ? q.day : today();
  const until = new Date(`${dayStr}T23:59:59.999+03:00`).getTime();
  const rows = db.prepare(`SELECT i.id, i.code, i.name, i.unit, i.avg_cost, i.qty_on_hand, w.name wh_name,
      (SELECT m.balance_after FROM proc_stock_moves m WHERE m.item_id = i.id AND m.created_at <= ? ORDER BY m.id DESC LIMIT 1) bal
    FROM proc_items i LEFT JOIN proc_warehouses w ON w.id = i.warehouse_id ORDER BY i.code`).all(until);
  const items = rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, unit: r.unit, warehouse: r.wh_name ?? '', qty: r.bal == null ? 0 : Number(r.bal), value: Math.round((r.bal == null ? 0 : Number(r.bal)) * Number(r.avg_cost)) })).filter((x) => x.qty !== 0 || q.all);
  return { day: dayStr, items, totalValue: items.reduce((s, x) => s + x.value, 0) };
}
/* مطابقة الدفتر مع أرصدة البطاقات: الأصناف التي يختلف رصيدها عن آخر رصيد في دفترها */
export function ledgerCheck(db) {
  const rows = db.prepare(`SELECT i.id, i.code, i.name, i.qty_on_hand, i.warehouse_id,
      (SELECT m.balance_after FROM proc_stock_moves m WHERE m.item_id = i.id ORDER BY m.id DESC LIMIT 1) bal FROM proc_items i`).all();
  const wh = new Map(db.prepare('SELECT item_id, SUM(qty) q FROM proc_item_stock GROUP BY item_id').all().map((x) => [Number(x.item_id), Number(x.q)]));
  const diffs = rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, qtyOnHand: Number(r.qty_on_hand), ledger: r.bal == null ? 0 : Number(r.bal), warehouses: wh.has(Number(r.id)) ? wh.get(Number(r.id)) : (r.warehouse_id ? Math.max(0, Number(r.qty_on_hand)) : 0) }))
    .filter((r) => Math.abs(r.qtyOnHand - r.ledger) > 1e-6 || Math.abs(r.qtyOnHand - r.warehouses) > 1e-6);
  return { ok: diffs.length === 0, diffs };
}
/* Issues */
export function createIssue({db},actor,b,ip){
  const whId=Number(b?.warehouseId); if(!whId || !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المخزن غير موجود.');
  // محضر إخراج / صرف المواد: القسم الطالب واسم المستلم ورقم طلب الصرف، والمستلم يكفي أحدهما
  // إذن صرف لطلب صرف معتمد: القسم ورقم الطلب منه
  const isr = b?.issueRequestId ? db.prepare('SELECT no, department FROM proc_issue_requests WHERE id=?').get(Number(b.issueRequestId)) : null;
  if(b?.issueRequestId && !isr) throw bad('طلب الصرف غير موجود.',404,'not_found');
  const department=opt(b?.department,80,'القسم الطالب') || (isr?.department ?? ''), receiver=opt(b?.receiverName,80,'اسم المستلم'), requestRef=opt(b?.requestRef,40,'رقم طلب الصرف') || (isr?.no ?? '');
  const to=clean(b?.issuedTo || [department, receiver].filter(Boolean).join(' — '),60,'الجهة المستلمة',2); const purpose=String(b?.purpose??'').slice(0,200);
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  for(const l of lines){ const u=itemUnitOf(db,l.itemId); l.qty=checkQty(db,u,l.qty,'الكمية المصروفة'); if(l.requestedQty!==undefined&&l.requestedQty!==null&&l.requestedQty!=='') l.requestedQty=checkQty(db,u,l.requestedQty,'الكمية المطلوبة'); const rq=l.requestedQty===undefined||l.requestedQty===null||l.requestedQty===''?null:Number(l.requestedQty); if(rq!==null && Number(l.qty)>rq) throw bad('الكمية المصروفة أكبر من المطلوبة.'); }
  return tx(db,()=>{
    // الرصيد المطلوب لكل صنف في المستودع المصدِّر (الصنف قد يتكرر في السند)
    const need=new Map(); for(const l of lines){ if(!db.prepare('SELECT 1 FROM proc_items WHERE id=?').get(Number(l.itemId))) throw bad('الصنف غير موجود.'); need.set(Number(l.itemId),(need.get(Number(l.itemId))||0)+Number(l.qty)); }
    for(const [itemId,q] of need){ const have=whQty(db,itemId,whId); if(q>have+1e-9){ const it=db.prepare('SELECT code FROM proc_items WHERE id=?').get(itemId); throw bad(`الصنف ${it.code}: الرصيد في هذا المستودع لا يكفي (${have} متاح).`,409,'insufficient_stock'); } }
    const no=nextNo(db,'IS','proc_issues');
    const id=Number(db.prepare('INSERT INTO proc_issues (no,warehouse_id,issued_to,purpose,issued_at,created_by,created_at,request_ref,department,receiver_name) VALUES (?,?,?,?,?,?,?,?,?,?)').run(no,whId,to,purpose,Date.now(),actor.id,Date.now(),requestRef,department,receiver).lastInsertRowid);
    for(const l of lines){
      whAdd(db, Number(l.itemId), whId, -Number(l.qty));
      db.prepare('UPDATE proc_items SET qty_on_hand = qty_on_hand - ? WHERE id=?').run(Number(l.qty),Number(l.itemId));
      stockMove(db, actor, { itemId:Number(l.itemId), kind:'issue', qty:-Number(l.qty), unitCost:Number(db.prepare('SELECT avg_cost FROM proc_items WHERE id=?').get(Number(l.itemId)).avg_cost), warehouseId:whId, refType:'issue', refId:id, refNo:no, note:to });
      const after=whQty(db, Number(l.itemId), whId);   // الرصيد بعد الصرف في المستودع المصدِّر (محضر الإخراج)
      db.prepare('INSERT INTO proc_issue_lines (issue_id,item_id,qty,requested_qty,balance_after,item_condition,note) VALUES (?,?,?,?,?,?,?)').run(id,Number(l.itemId),Number(l.qty),(l.requestedQty===undefined||l.requestedQty===null||l.requestedQty==='') ? Number(l.qty) : Number(l.requestedQty),after,opt(l.itemCondition,30,'حالة المادة'),opt(l.note,200,'الملاحظات'));
    }
    if(isr) applyIssueToRequest(db, Number(b.issueRequestId), { id, warehouseId: whId, lines: lines.map((l)=>({itemId:Number(l.itemId),qty:Number(l.qty)})) });
    const j = postIssueJournal(db, actor, id);
    audit(db,actor,'صرف مخزني',no,ip); return {issueId:id,no,journalEntryId:j.journalEntryId,journalError:j.journalError};
  });
}
export function listIssues(db,q={},meta={}){
  const w=[],a=[]; if(q.warehouse){w.push('i.warehouse_id=?');a.push(Number(q.warehouse));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  const _rows=db.prepare(`SELECT COUNT(*) OVER() AS _total, i.*, w.name whName, w.location whLocation FROM proc_issues i JOIN proc_warehouses w ON w.id=i.warehouse_id ${where} ORDER BY i.id DESC LIMIT ? OFFSET ?`).all(...a, ...pageArgs(q,200)); meta.total=Number(_rows[0]?._total ?? _rows.length); return _rows.map(r=>({id:r.id,no:r.no,warehouseId:r.warehouse_id,warehouseName:r.whName,warehouseLocation:r.whLocation,issuedTo:r.issued_to,purpose:r.purpose,issuedAt:r.issued_at,reversedAt:r.reversed_at,requestRef:r.request_ref,department:r.department,receiverName:r.receiver_name,
    lines:db.prepare('SELECT l.*, it.name itemName, it.code itemCode, it.unit unit FROM proc_issue_lines l JOIN proc_items it ON it.id=l.item_id WHERE l.issue_id=? ORDER BY l.id').all(r.id).map(x=>({itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,unit:x.unit,qty:x.qty,requestedQty:x.requested_qty==null?Number(x.qty):Number(x.requested_qty),balanceAfter:x.balance_after==null?null:Number(x.balance_after),itemCondition:x.item_condition,note:x.note}))}));
}
/* Assets */
export function listAssets(db,q={},meta={}){
  const w=[],a=[]; if(q.status){w.push('a.status=?');a.push(q.status);} if(q.q){const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(a.name LIKE ? ESCAPE \'\\\' OR a.code LIKE ? ESCAPE \'\\\')'); a.push(l,l);} if(q.warehouse){w.push('a.warehouse_id=?');a.push(Number(q.warehouse));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  const _rows=db.prepare(`SELECT COUNT(*) OVER() AS _total, a.*, w.name whName, s.name supName FROM proc_assets a LEFT JOIN proc_warehouses w ON w.id=a.warehouse_id LEFT JOIN proc_suppliers s ON s.id=a.supplier_id ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...a, ...pageArgs(q,500)); meta.total=Number(_rows[0]?._total ?? _rows.length); return _rows.map(r=>({id:r.id,code:r.code,name:r.name,category:r.category,warehouseId:r.warehouse_id,warehouseName:r.whName,status:r.status,purchaseDay:r.purchase_day,cost:r.cost,supplierId:r.supplier_id,supplierName:r.supName,assignedTo:r.assigned_to,notes:r.notes,createdAt:r.created_at,
    serialNo:r.serial_no??'',assignedUserId:r.assigned_user_id??null,usefulLifeMonths:Number(r.useful_life_months||0),salvageValue:Number(r.salvage_value||0),depreciationStart:r.depreciation_start??null,accumulated:Number(r.accumulated_dep||0),bookValue:Math.max(0,Number(r.cost)-Number(r.accumulated_dep||0)),
    orderId:r.order_id??null,disposalRequested:!!r.disposal_requested_at,disposalReason:r.disposal_reason??'',disposalRequestedBy:r.disposal_requested_by??null,lastVerifiedAt:r.last_verified_at?Number(r.last_verified_at):null}));
}
export function createAsset({db},actor,b,ip){
  const code=String(b?.code??'').trim()?clean(b.code,20,'رمز الأصل'):assetCode(db); const name=clean(b?.name,80,'اسم الأصل',2);
  if(db.prepare('SELECT 1 FROM proc_assets WHERE code=?').get(code)) throw bad('رمز الأصل مستخدم.',409,'conflict');
  const whId=b?.warehouseId?Number(b.warehouseId):null; if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المخزن غير موجود.');
  const supId=b?.supplierId?Number(b.supplierId):null; if(supId && !db.prepare('SELECT 1 FROM proc_suppliers WHERE id=?').get(supId)) throw bad('المورد غير موجود.');
  const day=b?.purchaseDay?String(b.purchaseDay):null; if(day && !isDay(day)) throw bad('تاريخ الشراء غير صالح.');
  const st=String(b?.status??'available'); if(!['available','in_use','maintenance'].includes(st)) throw bad('حالة الأصل الجديد: متاح أو قيد الاستخدام أو صيانة (الإتلاف بحركة موثقة).');
  const cost=Number(b?.cost??0); if(!Number.isFinite(cost)||cost<0) throw bad('تكلفة الأصل رقم غير سالب.');
  b={...b,status:st,cost};
  const id=Number(db.prepare('INSERT INTO proc_assets (code,name,category,warehouse_id,status,purchase_day,cost,supplier_id,assigned_to,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(code,name,String(b?.category??'عام').slice(0,30),whId,String(b?.status??'available'),day,Number(b?.cost??0),supId,String(b?.assignedTo??'').slice(0,80),String(b?.notes??'').slice(0,300),Date.now()).lastInsertRowid);
  saveAssetExtra(db, id, b);
  audit(db,actor,'إضافة أصل',code,ip); return {asset: db.prepare('SELECT * FROM proc_assets WHERE id=?').get(id)};
}
export function updateAsset({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_assets WHERE id=?').get(Number(id)); if(!cur) throw bad('الأصل غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز الأصل'):cur.code; const name=b?.name?clean(b.name,80,'اسم الأصل',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_assets WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز الأصل مستخدم.',409,'conflict');
  const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):cur.warehouse_id;
  const status=b?.status??cur.status; if(!['available','in_use','maintenance','disposed'].includes(status)) throw bad('حالة الأصل غير صالحة.');
  if(status==='disposed' && cur.status!=='disposed') throw bad('الإتلاف بطلب إتلاف موثق يعتمده شخص آخر، لا بتعديل الحالة.',409,'dispose_by_move');
  if(cur.status==='disposed' && status!=='disposed') throw bad('الأصل متلف ولا تُغيَّر حالته.',409,'conflict');
  if(b?.cost!==undefined && (!Number.isFinite(Number(b.cost)) || Number(b.cost)<0)) throw bad('تكلفة الأصل رقم غير سالب.');
  db.prepare('UPDATE proc_assets SET code=?,name=?,category=?,warehouse_id=?,status=?,purchase_day=?,cost=?,supplier_id=?,assigned_to=?,notes=? WHERE id=?').run(code,name,String(b?.category??cur.category).slice(0,30),whId,status,b?.purchaseDay??cur.purchase_day, b?.cost!==undefined?Number(b.cost):cur.cost, b?.supplierId!==undefined?(b.supplierId?Number(b.supplierId):null):cur.supplier_id, String(b?.assignedTo??cur.assigned_to).slice(0,80), String(b?.notes??cur.notes).slice(0,300), cur.id);
  saveAssetExtra(db, cur.id, b);
  audit(db,actor,'تعديل أصل',code,ip); return {asset: db.prepare('SELECT * FROM proc_assets WHERE id=?').get(cur.id)};
}
export function moveAsset({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_assets WHERE id=?').get(Number(id)); if(!cur) throw bad('الأصل غير موجود.',404,'not_found');
  const kind=String(b?.kind??'transfer'); if(!['transfer','dispose','maintenance','return'].includes(kind)) throw bad('نوع الحركة غير صالح.');
  const toWh=b?.toWarehouseId?Number(b.toWarehouseId):null; const toUser=String(b?.toUser??'').slice(0,80); const reason=String(b?.reason??'').slice(0,200);
  if(kind==='transfer' && !toWh) throw bad('حدد المخزن الهدف للنقل.');
  if(cur.status==='disposed') throw bad('الأصل متلف ولا تُسجَّل له حركات.',409,'conflict');
  if(kind==='dispose' && reason.trim().length<10) throw bad('الإتلاف يحتاج سبباً مفصّلاً ورقم محضر الإتلاف.',400,'reason_required');
  // الإتلاف لا يُنفَّذ مباشرة: يصير طلب إتلاف يعتمده شخص آخر (ويُرحَّل قيده عند الاعتماد)
  if(kind==='dispose') return { ...requestDisposal({db}, actor, cur.id, { reason }, ip), disposalPending: true };
  const newStatus=kind==='dispose'?'disposed':kind==='maintenance'?'maintenance':kind==='return'?'available':cur.status;
  const finalWh=kind==='transfer'?toWh:cur.warehouse_id;
  // الإرجاع إلى المستودع يُنهي العهدة الشخصية
  const finalUser=kind==='transfer'?toUser:kind==='return'||kind==='dispose'?'':cur.assigned_to;
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
  const newQty=checkQty(db,cur.unit,b?.qtyOnHand,'الرصيد الفعلي',{zero:true});
  // الجرد يكون في مستودع: المحدد، أو المستودع الوحيد الذي فيه الصنف، أو مستودعه الافتراضي
  const held=stocksOf(db,cur.id);
  const whId=b?.warehouseId ? pickWh(db,cur.id,b.warehouseId) : held.length===1 ? held[0].warehouseId : held.length>1 ? (()=>{ throw bad('الصنف موجود في أكثر من مستودع؛ حدد مستودع الجرد.',400,'warehouse_required'); })() : pickWh(db,cur.id,null);
  const whBefore=whQty(db,cur.id,whId);
  const newCost=b?.avgCost!==undefined ? Number(b.avgCost) : cur.avg_cost;
  if(!Number.isFinite(newCost) || newCost<0) throw bad('متوسط التكلفة غير صالح.');
  const reason=clean(b?.reason,120,'سبب التسوية ورقم محضر الجرد',10);
  if(/^تسوية جرد( مخزني)?$/.test(reason)) throw bad('اكتب سبب التسوية مفصّلاً ورقم محضر الجرد، لا العبارة العامة.',400,'reason_required');
  // الرصيد الدفتري الذي بُنيت عليه ورقة الجرد: إن تحرّك الصنف بعد العدّ تُرفض التسوية كي لا تضيع الحركة
  if(b?.expectedQty!==undefined && b?.expectedQty!==null && Number(b.expectedQty)!==whBefore) throw bad(`تحرّك رصيد الصنف بعد العدّ (كان ${b.expectedQty} وصار ${whBefore})؛ أعد الجرد.`,409,'stock_changed');
  const delta=newQty-whBefore, total=Number(cur.qty_on_hand)+delta; let jr={journalEntryId:null,journalError:null};
  tx(db,()=>{
    if(delta!==0) whAdd(db,cur.id,whId,delta);
    db.prepare('UPDATE proc_items SET qty_on_hand=?, avg_cost=? WHERE id=?').run(total,newCost,cur.id);
    if(delta!==0){ stockMove(db, actor, { itemId:cur.id, kind:'adjust', qty:delta, unitCost:newCost, warehouseId:whId, refType:'adjust', refNo:'', note:reason });
      const mv=Number(db.prepare("SELECT id FROM proc_stock_moves WHERE item_id=? AND kind='adjust' ORDER BY id DESC LIMIT 1").get(cur.id).id);
      jr=postAdjustJournal(db, actor, mv); }
  });
  audit(db,actor,'تسوية جرد صنف',`${cur.code} @${whId}: ${whBefore} -> ${newQty} (${reason})`,ip);
  return {item: db.prepare('SELECT * FROM proc_items WHERE id=?').get(cur.id), journalEntryId: jr.journalEntryId, journalError: jr.journalError};
}
/* طلب شراء للنواقص: كل صنف دون حده الأدنى (لا أول 12)، عدا ما له طلب أو أمر مفتوح، كمسودة يراجعها صاحبها قبل الإرسال.
   الكمية تعيد الرصيد إلى الحد الأعلى إن حُدد، وإلا إلى ضعف الحد الأدنى. */
export function replenishRequest({db},actor,ip){
  const low=db.prepare('SELECT * FROM proc_items WHERE active=1 AND min_stock>0 AND qty_on_hand<=min_stock ORDER BY code').all();
  const open=new Set(db.prepare("SELECT DISTINCT l.item_id FROM proc_request_lines l JOIN proc_requests r ON r.id=l.request_id WHERE l.item_id IS NOT NULL AND r.status IN ('draft','pending','approved','ordered')").all().map((x)=>Number(x.item_id)));
  const skipped=[], lines=[];
  for(const it of low){
    if(open.has(Number(it.id))){ skipped.push(`${it.code}: له طلب مفتوح`); continue; }
    if(!(Number(it.avg_cost)>0)){ skipped.push(`${it.code}: بلا تكلفة سابقة، أضفه يدوياً بسعر تقديري`); continue; }
    const target=Number(it.max_stock)>Number(it.min_stock)?Number(it.max_stock):Number(it.min_stock)*2;
    lines.push({itemId:it.id,description:it.name,qty:Math.max(1,target-Number(it.qty_on_hand)),estCost:Number(it.avg_cost),unit:it.unit});
  }
  if(!lines.length) return {request:null,skipped};
  const {request}=createRequest({db},actor,{title:'إعادة تموين الأصناف دون الحد الأدنى',description:'مولّد من تنبيه الحد الأدنى؛ راجِع الكميات قبل الإرسال.',warehouseId:null,lines:lines.slice(0,50),submit:false},ip);
  return {request,skipped,truncated:lines.length>50};
}
// موظفو المخازن لاختيار أمين المستودع: من يملك الاستلام والصرف
export function stockStaff(db){ return db.prepare("SELECT id, display_name FROM users WHERE role <> 'student' AND active = 1 ORDER BY display_name").all().filter((u)=>effective(db,u).includes('procurement:stock')).map((u)=>({id:Number(u.id),name:u.display_name})); }
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
