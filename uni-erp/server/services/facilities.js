// الخدمات الإدارية: حجز القاعات دون تعارض مع حجز معتمد أو محاضرة مجدولة، وأوامر الصيانة من البلاغ إلى الإغلاق.
// يطلب أي موظف، ويعتمد ويُسند من يملك facilities:manage، وينفذ الفني المسند إليه.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { docNo } from '../lib/doc_no.js';

const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const nameOf = (db, id) => (id ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(Number(id))?.display_name ?? '—' : '—');
const notify = (db, ids, kind, ref, text) => { const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING"); for (const id of new Set(ids)) ins.run(id, kind, ref, text, Date.now()); };
const manages = (actor) => !!actor.can?.('facilities:manage');
export const MAINT_CATEGORIES = ['كهرباء', 'سباكة', 'تكييف وتدفئة', 'نجارة وأثاث', 'شبكات واتصالات', 'أجهزة حاسوب', 'نظافة', 'أخرى'];
const PRIORITY = { normal: 'عادي', urgent: 'مستعجل', emergency: 'طارئ' };

export function facilitiesOverview({ db }, actor) {
  const manage = manages(actor), mine = manage ? '' : 'WHERE b.requester_id = ?';
  return {
    canManage: manage, categories: MAINT_CATEGORIES, priorities: PRIORITY,
    rooms: db.prepare('SELECT * FROM facility_rooms WHERE active = 1 ORDER BY building, name').all().map((r) => ({ id: Number(r.id), name: r.name, building: r.building, capacity: Number(r.capacity) })),
    bookings: db.prepare(`SELECT b.*, r.name AS room FROM room_bookings b JOIN facility_rooms r ON r.id = b.room_id ${mine} ORDER BY b.day DESC, b.start_time LIMIT 300`).all(...(manage ? [] : [actor.id]))
      .map((b) => ({ id: Number(b.id), room: b.room, title: b.title, day: b.day, start: b.start_time, end: b.end_time, attendees: Number(b.attendees), status: b.status, requester: nameOf(db, b.requester_id), mine: Number(b.requester_id) === Number(actor.id), note: b.decision_note })),
    orders: db.prepare(`SELECT * FROM maintenance_orders ${manage ? '' : 'WHERE requester_id = ? OR assignee_id = ?'} ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, CASE priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, id DESC LIMIT 300`).all(...(manage ? [] : [actor.id, actor.id]))
      .map((o) => ({ id: Number(o.id), no: o.no, location: o.location, category: o.category, description: o.description, priority: o.priority, priorityLabel: PRIORITY[o.priority], status: o.status,
        requester: nameOf(db, o.requester_id), assignee: nameOf(db, o.assignee_id), assignedToMe: Number(o.assignee_id) === Number(actor.id), mine: Number(o.requester_id) === Number(actor.id), doneNote: o.done_note, cost: Number(o.cost), at: Number(o.created_at) })),
    staff: manage ? db.prepare("SELECT id, display_name AS name FROM users WHERE role <> 'student' AND active = 1 ORDER BY display_name LIMIT 3000").all().map((u) => ({ id: Number(u.id), name: u.name })) : [],
  };
}

export function addRoom({ db }, actor, b, ip) {
  const name = clean(b?.name, 80);
  if (name.length < 2) throw bad('اسم القاعة مطلوب.');
  if (db.prepare('SELECT 1 FROM facility_rooms WHERE name = ?').get(name)) throw bad('القاعة معرّفة مسبقاً.', 409, 'conflict');
  const cap = Number(b?.capacity ?? 0);
  if (!Number.isInteger(cap) || cap < 0 || cap > 5000) throw bad('السعة عدد صحيح.');
  const id = Number(db.prepare('INSERT INTO facility_rooms (name, building, capacity, kind, created_at) VALUES (?,?,?,?,?) RETURNING id').get(name, clean(b?.building, 80), cap, clean(b?.kind, 30) || 'hall', Date.now()).id);
  audit(db, actor, 'تعريف قاعة أو مرفق', name, ip);
  return { id };
}

// التعارض: حجز معتمد أو قيد الاعتماد في القاعة نفسها، أو محاضرة مجدولة باسم القاعة في يوم الأسبوع نفسه
function conflictOf(db, room, day, start, end, exceptId = 0) {
  const s = toMin(start), e = toMin(end);
  const other = db.prepare("SELECT title, start_time, end_time FROM room_bookings WHERE room_id = ? AND day = ? AND status IN ('pending', 'approved') AND id <> ?").all(room.id, day, exceptId)
    .find((x) => toMin(x.start_time) < e && s < toMin(x.end_time));
  if (other) return `القاعة محجوزة من ${other.start_time} إلى ${other.end_time} (${other.title}).`;
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const lecture = db.prepare('SELECT s.start_min, s.end_min, c.name FROM course_schedules s JOIN courses c ON c.id = s.course_id WHERE s.hall = ? AND s.day = ?').all(room.name, dow)
    .find((x) => Number(x.start_min) < e && s < Number(x.end_min));
  if (lecture) return `في القاعة محاضرة مجدولة (${lecture.name}) في هذا الوقت.`;
  return null;
}

export function requestBooking({ db }, actor, b, ip) {
  const room = db.prepare('SELECT * FROM facility_rooms WHERE id = ? AND active = 1').get(Number(b?.roomId));
  if (!room) throw bad('القاعة غير موجودة.', 404, 'not_found');
  const day = String(b?.day ?? ''), start = String(b?.start ?? ''), end = String(b?.end ?? '');
  if (!DAY_RE.test(day) || !TIME_RE.test(start) || !TIME_RE.test(end) || end <= start) throw bad('التاريخ والوقت غير صالحين، والنهاية بعد البداية.');
  if (day < new Date().toISOString().slice(0, 10)) throw bad('لا يُحجز تاريخ مضى.');
  const title = clean(b?.title, 120);
  if (title.length < 3) throw bad('الغرض من الحجز مطلوب.');
  const attendees = Number(b?.attendees ?? 0);
  if (room.capacity && attendees > Number(room.capacity)) throw bad(`سعة القاعة ${room.capacity} فقط.`);
  const conflict = conflictOf(db, room, day, start, end);
  if (conflict) throw bad(conflict, 409, 'room_conflict');
  const status = manages(actor) ? 'approved' : 'pending';
  const id = Number(db.prepare('INSERT INTO room_bookings (room_id, title, day, start_time, end_time, attendees, requester_id, status, decided_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id')
    .get(room.id, title, day, start, end, attendees, actor.id, status, status === 'approved' ? actor.id : null, Date.now()).id);
  audit(db, actor, 'طلب حجز قاعة', `${room.name} ${day} ${start}-${end}: ${title}`, ip);
  return { id, status };
}

export function decideBooking({ db }, actor, id, b, ip) {
  const bk = db.prepare('SELECT b.*, r.name AS room_name FROM room_bookings b JOIN facility_rooms r ON r.id = b.room_id WHERE b.id = ?').get(Number(id));
  if (!bk) throw bad('الحجز غير موجود.', 404, 'not_found');
  const decision = String(b?.decision ?? '');
  if (decision === 'cancel') {
    if (Number(bk.requester_id) !== Number(actor.id) && !manages(actor)) throw bad('يلغي الحجز صاحبه أو مدير الخدمات.', 403, 'forbidden');
    if (!['pending', 'approved'].includes(bk.status)) throw bad('الحجز منتهٍ.', 409, 'conflict');
    db.prepare("UPDATE room_bookings SET status = 'cancelled' WHERE id = ?").run(bk.id);
    audit(db, actor, 'إلغاء حجز قاعة', `${bk.room_name} ${bk.day}`, ip);
    return { ok: true };
  }
  if (!manages(actor)) throw bad('اعتماد الحجوزات لمدير الخدمات الإدارية.', 403, 'forbidden');
  if (bk.status !== 'pending') throw bad('بُت في هذا الحجز مسبقاً.', 409, 'conflict');
  if (!['approved', 'rejected'].includes(decision)) throw bad('القرار غير صالح.');
  const note = clean(b?.note, 300);
  if (decision === 'rejected' && note.length < 3) throw bad('سبب الرفض مطلوب.');
  db.prepare('UPDATE room_bookings SET status = ?, decided_by = ?, decision_note = ? WHERE id = ?').run(decision, actor.id, note, bk.id);
  notify(db, [bk.requester_id], 'room_booking', bk.id, `${decision === 'approved' ? 'اعتُمد' : 'رُفض'} حجز ${bk.room_name} يوم ${bk.day} (${bk.start_time}-${bk.end_time})${note ? `: ${note}` : ''}.`);
  audit(db, actor, decision === 'approved' ? 'اعتماد حجز قاعة' : 'رفض حجز قاعة', `${bk.room_name} ${bk.day}`, ip);
  return { ok: true };
}

export function reportMaintenance({ db }, actor, b, ip) {
  const location = clean(b?.location, 120), description = clean(b?.description, 1000), category = String(b?.category ?? '');
  if (location.length < 2) throw bad('مكان العطل مطلوب.');
  if (!MAINT_CATEGORIES.includes(category)) throw bad('نوع العطل غير صالح.');
  if (description.length < 5) throw bad('وصف العطل مطلوب.');
  const priority = PRIORITY[b?.priority] ? b.priority : 'normal';
  const no = docNo('MNT');
  const id = Number(db.prepare('INSERT INTO maintenance_orders (no, location, category, description, priority, requester_id, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id').get(no, location, category, description, priority, actor.id, Date.now()).id);
  audit(db, actor, 'بلاغ صيانة', `${no}: ${location} — ${category}`, ip);
  return { id, no };
}

export function maintenanceAction({ db }, actor, id, b, ip) {
  const o = db.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(Number(id));
  if (!o) throw bad('أمر الصيانة غير موجود.', 404, 'not_found');
  const action = String(b?.action ?? '');
  if (action === 'assign') {
    if (!manages(actor)) throw bad('إسناد الصيانة لمدير الخدمات الإدارية.', 403, 'forbidden');
    if (!['open', 'assigned'].includes(o.status)) throw bad('الأمر منجز أو مغلق.', 409, 'conflict');
    const tech = db.prepare("SELECT id FROM users WHERE id = ? AND role <> 'student' AND active = 1").get(Number(b?.assigneeId));
    if (!tech) throw bad('الفني غير موجود.');
    db.prepare("UPDATE maintenance_orders SET assignee_id = ?, status = 'assigned', assigned_at = ? WHERE id = ?").run(tech.id, Date.now(), o.id);
    notify(db, [tech.id], 'maintenance_assigned', o.id, `أُسند إليك أمر الصيانة ${o.no} (${PRIORITY[o.priority]}): ${o.location} — ${o.description}`.slice(0, 300));
  } else if (action === 'done') {
    if (Number(o.assignee_id) !== Number(actor.id) && !manages(actor)) throw bad('ينجز الأمر الفني المسند إليه.', 403, 'forbidden');
    if (o.status !== 'assigned') throw bad('يُنجز الأمر المسند فقط.', 409, 'conflict');
    const note = clean(b?.note, 500);
    if (note.length < 3) throw bad('اكتب ما نُفّذ.');
    const cost = Number(b?.cost ?? 0);
    if (!Number.isInteger(cost) || cost < 0) throw bad('الكلفة عدد صحيح.');
    db.prepare("UPDATE maintenance_orders SET status = 'done', done_note = ?, cost = ?, done_at = ? WHERE id = ?").run(note, cost, Date.now(), o.id);
    notify(db, [o.requester_id], 'maintenance_done', o.id, `نُفّذ أمر الصيانة ${o.no}: ${note}. أكّد الإغلاق إن عُولج العطل.`);
  } else if (action === 'close' || action === 'reopen') {
    if (Number(o.requester_id) !== Number(actor.id) && !manages(actor)) throw bad('يغلق الأمر مقدّم البلاغ أو مدير الخدمات.', 403, 'forbidden');
    if (o.status !== 'done') throw bad('يُغلق الأمر بعد تنفيذه.', 409, 'conflict');
    if (action === 'close') db.prepare("UPDATE maintenance_orders SET status = 'closed', closed_at = ? WHERE id = ?").run(Date.now(), o.id);
    else { db.prepare("UPDATE maintenance_orders SET status = 'assigned', done_at = NULL WHERE id = ?").run(o.id); notify(db, [o.assignee_id], 'maintenance_reopened', o.id, `أُعيد فتح أمر الصيانة ${o.no}: لم يُعالج العطل.`); }
  } else if (action === 'cancel') {
    if (Number(o.requester_id) !== Number(actor.id) && !manages(actor)) throw bad('يلغي البلاغ صاحبه أو مدير الخدمات.', 403, 'forbidden');
    if (o.status !== 'open') throw bad('يُلغى البلاغ قبل إسناده فقط.', 409, 'conflict');
    db.prepare("UPDATE maintenance_orders SET status = 'cancelled' WHERE id = ?").run(o.id);
  } else throw bad('إجراء غير صالح.');
  audit(db, actor, `أمر صيانة: ${action}`, o.no, ip);
  return { ok: true };
}

export function registerFacilitiesRoutes(r, deps) {
  const staff = (c) => { if (!c.user || c.user.role === 'student') throw bad('هذه الخدمة للموظفين.', 403, 'forbidden'); return c.user; };
  const manage = (c) => { if (!manages(staff(c))) throw bad('يتطلب صلاحية إدارة الخدمات الإدارية.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/facilities', (c) => c.json(200, facilitiesOverview(deps, staff(c))));
  r.add('POST', '/api/facilities/rooms', (c) => c.json(201, addRoom(deps, manage(c), c.body, c.ip)));
  r.add('POST', '/api/facilities/bookings', (c) => c.json(201, requestBooking(deps, staff(c), c.body, c.ip)));
  r.add('POST', '/api/facilities/bookings/:id/decide', (c) => c.json(200, decideBooking(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/facilities/maintenance', (c) => c.json(201, reportMaintenance(deps, staff(c), c.body, c.ip)));
  r.add('POST', '/api/facilities/maintenance/:id/action', (c) => c.json(200, maintenanceAction(deps, staff(c), c.params.id, c.body, c.ip)));
}
