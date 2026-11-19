/* الأصول الثابتة (تقرير المشتريات 7.1-7.3 و13.14)
   - الأصل يُنشأ من بند استلام «أصل ثابت» بأمر الشراء: أصل لكل وحدة برمز تلقائي، مرتبط بالأمر والسند والمورد، وقيده على حساب الأصول.
   - الإهلاك بالقسط الثابت شهرياً: (التكلفة − القيمة التخريدية) ÷ العمر بالأشهر، مرة واحدة لكل شهر، وقيد الشهر مصروف الإهلاك / مجمع الإهلاك.
   - الإتلاف بخطوتين: طلب بسبب ورقم محضر، ثم اعتماد شخص آخر يرحّل القيد ويُخرج الأصل من السجل الفعّال.
   - العهدة بمستخدم، والجرد الدوري بمحضر لكل أصل (موجود/مفقود، في موقعه أم لا). */
import { tx } from '../../db.js';
import { audit } from '../../audit.js';
import { getSetting } from '../settings.js';
import { nextNumber } from '../numbering.js';
import { qrSvg } from '../../qr.js';
import { sendRaw } from '../../http.js';
import { bad, clean, isDay, today, acctFor, writeStockEntry, notifyFinance } from './core.js';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const lastDay = (period) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const assetCode = (db) => { const y = today().slice(0, 4), head = `AST-${y}-`; const n = nextNumber(db, `proc_assets:${head}`, 'SELECT MAX(CAST(substr(code, ?) AS INTEGER)) FROM proc_assets WHERE code LIKE ?', [head.length + 1, `${head}%`]); return `${head}${String(n).padStart(5, '0')}`; };
const bookValue = (a) => Math.max(0, Number(a.cost) - Number(a.accumulated_dep || 0));

/* بيانات الإهلاك والعهدة والرقم التسلسلي (عند الإنشاء والتعديل) */
export function saveAssetExtra(db, id, b) {
  const cur = db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(Number(id));
  const life = b?.usefulLifeMonths !== undefined ? Number(b.usefulLifeMonths) : Number(cur.useful_life_months);
  if (!Number.isInteger(life) || life < 0 || life > 600) throw bad('العمر الإنتاجي بالأشهر عدد صحيح من 0 إلى 600.');
  const salvage = b?.salvageValue !== undefined ? Number(b.salvageValue) : Number(cur.salvage_value);
  if (!Number.isFinite(salvage) || salvage < 0 || salvage > Number(cur.cost)) throw bad('القيمة التخريدية رقم غير سالب لا يتجاوز التكلفة.');
  const start = b?.depreciationStart !== undefined ? (String(b.depreciationStart || '').trim() || null) : cur.depreciation_start;
  if (start && !isDay(start)) throw bad('تاريخ بدء الإهلاك بصيغة 2026-12-31.');
  if (Number(cur.accumulated_dep) > 0 && (life !== Number(cur.useful_life_months) || salvage !== Number(cur.salvage_value))) throw bad('بدأ إهلاك الأصل؛ لا يُغيَّر عمره ولا قيمته التخريدية.', 409, 'depreciation_started');
  const uid = b?.assignedUserId !== undefined ? (b.assignedUserId ? Number(b.assignedUserId) : null) : cur.assigned_user_id;
  if (uid && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) throw bad('صاحب العهدة غير موجود.');
  const holder = uid ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(uid).display_name : null;
  db.prepare('UPDATE proc_assets SET serial_no = ?, useful_life_months = ?, salvage_value = ?, depreciation_start = ?, assigned_user_id = ?, assigned_to = COALESCE(?, assigned_to) WHERE id = ?')
    .run(b?.serialNo !== undefined ? String(b.serialNo).trim().slice(0, 60) : cur.serial_no, life, Math.round(salvage), start || (life && !cur.depreciation_start ? (cur.purchase_day || today()) : start), uid, holder, cur.id);
}

/* بند أمر «أصل ثابت» عند الاستلام: أصل لكل وحدة مستلمة، ويعيد قيمة ما استُلم لقيد الأصول */
export function assetsFromReceipt(db, actor, { order, line, qty, receiptId, warehouseId }) {
  if (!Number.isInteger(Number(qty))) throw bad('الأصول الثابتة تُستلم بعدد صحيح.', 400, 'fraction_not_allowed');
  const life = Number(getSetting(db, 'procurement.asset_default_life_months')) || 0;
  const ids = [];
  for (let i = 0; i < Number(qty); i += 1) {
    const code = assetCode(db);
    ids.push(Number(db.prepare(`INSERT INTO proc_assets (code, name, category, warehouse_id, status, purchase_day, cost, supplier_id, notes, created_at, order_id, receipt_id, useful_life_months, depreciation_start)
      VALUES (?,?,?,?, 'available', ?,?,?,?,?,?,?,?,?) RETURNING id`).get(code, String(line.description).slice(0, 80), 'من الشراء', warehouseId ?? null, today(), Math.round(Number(line.unit_cost)), order.supplier_id,
      `من أمر الشراء ${order.no}`, Date.now(), order.id, receiptId, life, life ? today() : null).id));
  }
  return { ids, total: Number(qty) * Number(line.unit_cost) };
}
// قيد اقتناء الأصول المستلمة: حساب الأصول مدين / الموردون دائن
export function postAssetAcquisition(db, actor, receiptId, orderNo, amount) {
  const sup = db.prepare("SELECT code FROM fin_accounts WHERE system_key='suppliers' OR code='2101' ORDER BY CASE WHEN system_key='suppliers' THEN 0 ELSE 1 END LIMIT 1").get();
  const r = writeStockEntry(db, actor, { source: `proc_receipt_asset:${receiptId}`, reference: orderNo, desc: `قيد اقتناء أصول ثابتة (أمر شراء ${orderNo} — سند استلام #${receiptId})`,
    debit: acctFor(db, getSetting(db, 'procurement.asset_account'), 'الأصول الثابتة'), credit: acctFor(db, sup ? sup.code : '2101', 'الموردين'), amount });
  if (r.error) notifyFinance(db, 'proc_asset_journal', receiptId, `أصول سند الاستلام #${receiptId} بلا قيد اقتناء: ${r.error}`);
  return r;
}

/* الإهلاك الشهري: مرة واحدة لكل أصل في الشهر، وقيد واحد للشهر */
export function runDepreciation({ db }, actor, b, ip) {
  const period = String(b?.period ?? '').trim();
  if (!PERIOD_RE.test(period)) throw bad('الشهر بصيغة 2026-11.');
  if (period > today().slice(0, 7)) throw bad('لا يُهلك شهر لم يأتِ بعد.');
  const end = lastDay(period);
  return tx(db, () => {
    const assets = db.prepare(`SELECT * FROM proc_assets WHERE status <> 'disposed' AND useful_life_months > 0 AND depreciation_start IS NOT NULL AND depreciation_start <= ?
      AND NOT EXISTS (SELECT 1 FROM proc_asset_depreciation d WHERE d.asset_id = proc_assets.id AND d.period = ?) ORDER BY id`).all(end, period);
    let total = 0; const rows = [];
    for (const a of assets) {
      const base = Number(a.cost) - Number(a.salvage_value), left = base - Number(a.accumulated_dep);
      const amount = Math.min(left, Math.round(base / Number(a.useful_life_months)));
      if (!(amount > 0)) continue;
      const id = Number(db.prepare('INSERT INTO proc_asset_depreciation (asset_id, period, amount, created_by, created_at) VALUES (?,?,?,?,?) RETURNING id').get(a.id, period, amount, actor.id, Date.now()).id);
      db.prepare('UPDATE proc_assets SET accumulated_dep = accumulated_dep + ? WHERE id = ?').run(amount, a.id);
      total += amount; rows.push(id);
    }
    let entry = { entryId: null, error: null };
    if (total > 0) {
      entry = writeStockEntry(db, actor, { source: `proc_depreciation:${period}`, reference: period, desc: `قيد إهلاك الأصول الثابتة لشهر ${period}`,
        debit: acctFor(db, getSetting(db, 'procurement.depreciation_expense_account'), 'مصروف الإهلاك'), credit: acctFor(db, getSetting(db, 'procurement.accumulated_dep_account'), 'مجمع الإهلاك'), amount: total });
      if (entry.entryId) for (const id of rows) db.prepare('UPDATE proc_asset_depreciation SET entry_id = ? WHERE id = ?').run(entry.entryId, id);
      if (entry.error) notifyFinance(db, 'proc_depreciation_journal', 0, `إهلاك شهر ${period} سُجّل بلا قيد: ${entry.error}`);
    }
    audit(db, actor, 'تشغيل إهلاك الأصول', `${period}: ${rows.length} أصل بقيمة ${total}`, ip);
    return { period, assets: rows.length, total, journalEntryId: entry.entryId ?? null, journalError: entry.error };
  });
}

/* الإتلاف: طلب ثم اعتماد شخص آخر */
export function requestDisposal({ db }, actor, id, b, ip) {
  const a = db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(Number(id)); if (!a) throw bad('الأصل غير موجود.', 404, 'not_found');
  if (a.status === 'disposed') throw bad('الأصل متلف.', 409, 'conflict');
  if (a.disposal_requested_at) throw bad('للأصل طلب إتلاف قائم.', 409, 'conflict');
  const why = clean(b?.reason, 300, 'سبب الإتلاف ورقم المحضر', 10);
  db.prepare('UPDATE proc_assets SET disposal_reason = ?, disposal_requested_by = ?, disposal_requested_at = ? WHERE id = ?').run(why, actor.id, Date.now(), a.id);
  audit(db, actor, 'طلب إتلاف أصل', `${a.code}: ${why}`.slice(0, 300), ip);
  return { asset: db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(a.id) };
}
export function decideDisposal({ db }, actor, id, approve, b, ip) {
  const a = db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(Number(id)); if (!a) throw bad('الأصل غير موجود.', 404, 'not_found');
  if (!a.disposal_requested_at || a.status === 'disposed') throw bad('لا طلب إتلاف قائم لهذا الأصل.', 409, 'conflict');
  if (Number(a.disposal_requested_by) === Number(actor.id)) throw bad('فصل المهام: يعتمد الإتلاف شخص غير طالبه.', 403, 'sod_violation');
  return tx(db, () => {
    if (!approve) {
      db.prepare('UPDATE proc_assets SET disposal_reason = NULL, disposal_requested_by = NULL, disposal_requested_at = NULL WHERE id = ?').run(a.id);
      audit(db, actor, 'رفض إتلاف أصل', `${a.code}: ${String(b?.note ?? '').slice(0, 200)}`, ip);
      return { asset: db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(a.id) };
    }
    db.prepare('INSERT INTO proc_asset_moves (asset_id, kind, from_wh, to_wh, to_user, reason, moved_at, moved_by) VALUES (?,?,?,?,?,?,?,?)').run(a.id, 'dispose', a.warehouse_id, null, '', a.disposal_reason, Date.now(), actor.id);
    db.prepare("UPDATE proc_assets SET status = 'disposed', assigned_to = '', assigned_user_id = NULL, disposed_by = ?, disposed_at = ? WHERE id = ?").run(actor.id, Date.now(), a.id);
    // قيد الإتلاف: مجمع الإهلاك مدين بما أُهلك، وخسارة الإتلاف مدين بالقيمة الدفترية، وحساب الأصول دائن بالتكلفة
    let r = { entryId: null, error: null };
    const cost = Number(a.cost), dep = Number(a.accumulated_dep), nbv = bookValue(a);
    if (cost > 0) {
      const asset = acctFor(db, getSetting(db, 'procurement.asset_account'), 'الأصول الثابتة');
      if (dep > 0) r = writeStockEntry(db, actor, { source: `proc_asset_dispose:${a.id}:dep`, reference: a.code, desc: `إقفال مجمع إهلاك الأصل المتلف ${a.code}`, debit: acctFor(db, getSetting(db, 'procurement.accumulated_dep_account'), 'مجمع الإهلاك'), credit: asset, amount: dep });
      if (!r.error && nbv > 0) { const r2 = writeStockEntry(db, actor, { source: `proc_asset_dispose:${a.id}:loss`, reference: a.code, desc: `خسارة إتلاف الأصل ${a.code}: ${a.disposal_reason}`, debit: acctFor(db, getSetting(db, 'procurement.asset_disposal_loss_account'), 'خسارة الإتلاف'), credit: asset, amount: nbv }); r = { entryId: r2.entryId ?? r.entryId, error: r2.error }; }
    }
    db.prepare('UPDATE proc_assets SET disposal_entry_id = ?, disposal_error = ? WHERE id = ?').run(r.entryId ?? null, r.error, a.id);
    if (r.error) notifyFinance(db, 'proc_asset_dispose_journal', a.id, `إتلاف الأصل ${a.code} بلا قيد: ${r.error}`);
    audit(db, actor, 'اعتماد إتلاف أصل', `${a.code} (القيمة الدفترية ${nbv})`, ip);
    return { asset: db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(a.id), journalEntryId: r.entryId ?? null, journalError: r.error };
  });
}

/* الجرد الدوري: محضر لكل أصل */
export function verifyAsset({ db }, actor, id, b, ip) {
  const a = db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(Number(id)); if (!a) throw bad('الأصل غير موجود.', 404, 'not_found');
  if (a.status === 'disposed') throw bad('الأصل متلف.', 409, 'conflict');
  const found = b?.found !== false, locOk = b?.locationOk !== false, note = String(b?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if ((!found || !locOk) && note.length < 5) throw bad('اكتب ملاحظة عن الأصل المفقود أو المنقول من موقعه.', 400, 'reason_required');
  db.prepare('INSERT INTO proc_asset_checks (asset_id, found, location_ok, note, checked_by, checked_at) VALUES (?,?,?,?,?,?)').run(a.id, found ? 1 : 0, locOk ? 1 : 0, note, actor.id, Date.now());
  if (found) db.prepare('UPDATE proc_assets SET last_verified_at = ?, last_verified_by = ? WHERE id = ?').run(Date.now(), actor.id, a.id);
  audit(db, actor, found ? 'جرد أصل' : 'جرد أصل: مفقود', `${a.code}${note ? `: ${note}` : ''}`.slice(0, 300), ip);
  return { ok: true };
}

/* سجل الأصل: الحركات والعهد والإهلاك والجرد */
export function assetHistory({ db }, id) {
  const a = db.prepare('SELECT a.*, o.no order_no, s.name sup_name FROM proc_assets a LEFT JOIN proc_orders o ON o.id = a.order_id LEFT JOIN proc_suppliers s ON s.id = a.supplier_id WHERE a.id = ?').get(Number(id));
  if (!a) throw bad('الأصل غير موجود.', 404, 'not_found');
  const KIND = { transfer: 'نقل', dispose: 'إتلاف', maintenance: 'صيانة', return: 'إرجاع إلى المستودع' };
  return {
    asset: { id: Number(a.id), code: a.code, name: a.name, serialNo: a.serial_no, cost: Number(a.cost), accumulated: Number(a.accumulated_dep), bookValue: bookValue(a), usefulLifeMonths: Number(a.useful_life_months), salvageValue: Number(a.salvage_value), depreciationStart: a.depreciation_start, orderNo: a.order_no ?? '', supplier: a.sup_name ?? '', status: a.status, disposalReason: a.disposal_reason ?? '', disposalRequested: !!a.disposal_requested_at },
    moves: db.prepare('SELECT m.*, w1.name f, w2.name t, u.display_name by_name FROM proc_asset_moves m LEFT JOIN proc_warehouses w1 ON w1.id = m.from_wh LEFT JOIN proc_warehouses w2 ON w2.id = m.to_wh LEFT JOIN users u ON u.id = m.moved_by WHERE m.asset_id = ? ORDER BY m.id').all(a.id)
      .map((m) => ({ at: Number(m.moved_at), kind: KIND[m.kind] || m.kind, from: m.f ?? '', to: m.t ?? '', toUser: m.to_user, reason: m.reason, by: m.by_name ?? '' })),
    depreciation: db.prepare('SELECT period, amount FROM proc_asset_depreciation WHERE asset_id = ? ORDER BY period').all(a.id).map((d) => ({ period: d.period, amount: Number(d.amount) })),
    checks: db.prepare('SELECT c.*, u.display_name by_name FROM proc_asset_checks c LEFT JOIN users u ON u.id = c.checked_by WHERE c.asset_id = ? ORDER BY c.id DESC').all(a.id).map((c) => ({ at: Number(c.checked_at), found: !!c.found, locationOk: !!c.location_ok, note: c.note, by: c.by_name ?? '' })),
  };
}
// أصول لم تُجرد منذ عدد أشهر (الافتراضي 12)
export function uncheckedAssets({ db }, q = {}) {
  const months = Math.max(1, Math.min(60, Number(q.months) || 12)), since = Date.now() - months * 30 * 86400000;
  return { months, assets: db.prepare("SELECT id, code, name, assigned_to, last_verified_at FROM proc_assets WHERE status <> 'disposed' AND (last_verified_at IS NULL OR last_verified_at < ?) ORDER BY last_verified_at NULLS FIRST, code LIMIT 500").all(since)
    .map((a) => ({ id: Number(a.id), code: a.code, name: a.name, assignedTo: a.assigned_to, lastVerifiedAt: a.last_verified_at ? Number(a.last_verified_at) : null })) };
}

export function registerAssetRoutes(r, deps) {
  const need = (c, ...perms) => { if (!c.user || !perms.some((p) => c.user.can(p))) throw bad('لا تملك صلاحية هذا الإجراء.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/procurement/assets/unchecked', (c) => { need(c, 'procurement:read'); c.json(200, uncheckedAssets(deps, c.query ?? {})); });
  r.add('POST', '/api/procurement/assets/depreciation', (c) => c.json(200, runDepreciation(deps, need(c, 'procurement:assets'), c.body, c.ip)));
  r.add('GET', '/api/procurement/assets/:id/history', (c) => { need(c, 'procurement:read'); c.json(200, assetHistory(deps, c.params.id)); });
  r.add('GET', '/api/procurement/assets/:id/qr.svg', (c) => {
    need(c, 'procurement:read');
    const a = deps.db.prepare('SELECT code FROM proc_assets WHERE id = ?').get(Number(c.params.id)); if (!a) throw bad('الأصل غير موجود.', 404, 'not_found');
    sendRaw(c.res, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store' }, qrSvg(a.code));
  });
  r.add('POST', '/api/procurement/assets/:id/dispose-request', (c) => c.json(200, requestDisposal(deps, need(c, 'procurement:assets'), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/procurement/assets/:id/dispose-approve', (c) => c.json(200, decideDisposal(deps, need(c, 'procurement:manage'), c.params.id, true, c.body, c.ip)));
  r.add('POST', '/api/procurement/assets/:id/dispose-reject', (c) => c.json(200, decideDisposal(deps, need(c, 'procurement:manage'), c.params.id, false, c.body, c.ip)));
  r.add('POST', '/api/procurement/assets/:id/verify', (c) => c.json(200, verifyAsset(deps, need(c, 'procurement:assets', 'procurement:stock'), c.params.id, c.body, c.ip)));
}
