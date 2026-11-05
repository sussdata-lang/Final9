// السكن الجامعي: المباني والغرف والساكنون والمواد المسلمة لكل طالب.
import { HttpError } from '../http.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { docNo, academicYear } from '../lib/doc_no.js';
import { getSetting } from './settings.js';

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const bad = (m, code = 'validation') => new HttpError(400, m, code);
const today = () => new Date().toISOString().slice(0, 10);
const RESIDENT = "a.status = 'ساكن'";

const studentRow = (db, no) => {
  const r = db.prepare(`SELECT u.id, u.student_no, u.display_name, p.gender, g.faculty FROM users u
    LEFT JOIN student_profiles p ON p.user_id = u.id LEFT JOIN programs g ON g.id = p.program_id WHERE u.student_no = ? AND u.role = 'student'`).get(clean(no, 40));
  if (!r) throw bad('الرقم الجامعي غير موجود في النظام.');
  return r;
};
const genderFits = (profile, building) => !profile || building === (/أنث|إناث|female/i.test(profile) ? 'إناث' : 'ذكور');

function housingOverview({ db }, user) {
  const buildings = db.prepare('SELECT * FROM dorm_buildings ORDER BY name').all();
  const rooms = db.prepare(`SELECT r.*, b.id AS building_id, b.gender, (SELECT COUNT(*) FROM dorm_allocations a WHERE a.room_id = r.id AND ${RESIDENT}) AS residents
    FROM dorm_rooms r LEFT JOIN dorm_buildings b ON b.name = r.building_name ORDER BY r.building_name, r.room_no`).all();
  const own = user.role === 'student' ? ' AND a.student_no = ?' : '', args = user.role === 'student' ? [user.student_no] : [];
  const allocations = db.prepare(`SELECT a.*, r.building_name, r.room_no, r.capacity FROM dorm_allocations a JOIN dorm_rooms r ON r.id = a.room_id WHERE ${RESIDENT}${own} ORDER BY r.building_name, r.room_no, a.student_name`).all(...args);
  const handouts = db.prepare(`SELECT * FROM housing_handouts h WHERE 1 = 1${user.role === 'student' ? ' AND h.student_no = ?' : ''} ORDER BY h.created_at DESC`).all(...args)
    .map((h) => ({ ...h, items: JSON.parse(h.items_json || '[]') }));
  return { buildings, rooms: rooms.map((r) => ({ ...r, residents: Number(r.residents) })), allocations, handouts, supplyItems: getSetting(db, 'housing.supply_items'), roomTypes: getSetting(db, 'housing.room_types') };
}

/* ---------- المباني ---------- */
const buildingFields = (b) => {
  const name = clean(b?.name, 100), gender = b?.gender;
  if (!name) throw bad('اسم المبنى مطلوب.');
  if (!['ذكور', 'إناث'].includes(gender)) throw bad('حدد قسم المبنى: ذكور أو إناث.');
  return { name, gender, notes: clean(b?.notes, 300) };
};
function createBuilding({ db }, user, b, ip) {
  const f = buildingFields(b);
  if (db.prepare('SELECT 1 AS x FROM dorm_buildings WHERE name = ?').get(f.name)) throw bad('يوجد مبنى بهذا الاسم.');
  const id = Number(db.prepare('INSERT INTO dorm_buildings (name, gender, notes, created_at) VALUES (?, ?, ?, ?)').run(f.name, f.gender, f.notes, Date.now()).lastInsertRowid);
  const count = Math.min(Math.max(Number(b?.rooms) || 0, 0), 300);
  if (count) addRooms(db, f.name, count, Math.max(Number(b?.capacity) || 4, 1));
  audit(db, user, 'إضافة مبنى سكن', f.name, ip);
  return { id };
}
function addRooms(db, building, count, capacity) {
  const existing = new Set(db.prepare('SELECT room_no FROM dorm_rooms WHERE building_name = ?').all(building).map((r) => r.room_no));
  let added = 0;
  for (let i = 0; added < count && i < 2000; i++) {
    const floor = Math.floor(i / 10) + 1, no = String(floor * 100 + (i % 10) + 1);
    if (existing.has(no)) continue;
    db.prepare("INSERT INTO dorm_rooms (building_name, room_no, floor_no, capacity, occupied, room_type, annual_fee, status) VALUES (?, ?, ?, ?, 0, ?, 0, 'متاحة')").run(building, no, floor, capacity, capacity === 1 ? 'فردية' : capacity === 2 ? 'مزدوجة' : 'جماعية');
    added++;
  }
  return added;
}
function updateBuilding({ db }, user, id, b, ip) {
  const cur = db.prepare('SELECT * FROM dorm_buildings WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'المبنى غير موجود.', 'not_found');
  const f = buildingFields(b);
  if (f.name !== cur.name && db.prepare('SELECT 1 AS x FROM dorm_buildings WHERE name = ?').get(f.name)) throw bad('يوجد مبنى بهذا الاسم.');
  tx(db, () => {
    db.prepare('UPDATE dorm_buildings SET name = ?, gender = ?, notes = ? WHERE id = ?').run(f.name, f.gender, f.notes, cur.id);
    if (f.name !== cur.name) db.prepare('UPDATE dorm_rooms SET building_name = ? WHERE building_name = ?').run(f.name, cur.name);
    const more = Number(b?.addRooms) || 0;
    if (more > 0) addRooms(db, f.name, Math.min(more, 300), Math.max(Number(b?.capacity) || 4, 1));
  });
  audit(db, user, 'تعديل مبنى سكن', f.name, ip);
  return { ok: true };
}
function deleteBuilding({ db }, user, id, ip) {
  const cur = db.prepare('SELECT * FROM dorm_buildings WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'المبنى غير موجود.', 'not_found');
  if (db.prepare(`SELECT 1 AS x FROM dorm_allocations a JOIN dorm_rooms r ON r.id = a.room_id WHERE r.building_name = ? AND ${RESIDENT} LIMIT 1`).get(cur.name)) throw bad('في المبنى ساكنون؛ انقلهم أولاً.');
  tx(db, () => {
    db.prepare('DELETE FROM dorm_rooms WHERE building_name = ?').run(cur.name);
    db.prepare('DELETE FROM dorm_buildings WHERE id = ?').run(cur.id);
  });
  audit(db, user, 'حذف مبنى سكن', cur.name, ip);
  return { ok: true };
}

/* ---------- الغرف ---------- */
function saveRoom({ db }, user, id, b, ip) {
  const roomNo = clean(b?.room_no, 20), capacity = Number(b?.capacity), floor = Number(b?.floor_no) || 1, type = clean(b?.room_type, 40) || 'جماعية', status = clean(b?.status, 20) || 'متاحة';
  if (!roomNo) throw bad('رقم الغرفة مطلوب.');
  if (!(capacity >= 1 && capacity <= 30)) throw bad('السعة بين 1 و30.');
  if (id) {
    const cur = db.prepare('SELECT * FROM dorm_rooms WHERE id = ?').get(Number(id));
    if (!cur) throw new HttpError(404, 'الغرفة غير موجودة.', 'not_found');
    const now = Number(db.prepare(`SELECT COUNT(*) AS c FROM dorm_allocations a WHERE a.room_id = ? AND ${RESIDENT}`).get(cur.id).c);
    if (capacity < now) throw bad(`في الغرفة ${now} ساكنين، فلا تقل السعة عنهم.`);
    if (roomNo !== cur.room_no && db.prepare('SELECT 1 AS x FROM dorm_rooms WHERE building_name = ? AND room_no = ?').get(cur.building_name, roomNo)) throw bad('يوجد غرفة بهذا الرقم في المبنى.');
    db.prepare('UPDATE dorm_rooms SET room_no = ?, floor_no = ?, capacity = ?, room_type = ?, status = ? WHERE id = ?').run(roomNo, floor, capacity, type, status, cur.id);
    audit(db, user, 'تعديل غرفة سكن', `${cur.building_name} ${roomNo}`, ip);
    return { id: cur.id };
  }
  const building = clean(b?.building_name, 100);
  if (!db.prepare('SELECT 1 AS x FROM dorm_buildings WHERE name = ?').get(building)) throw bad('اختر مبنى موجوداً.');
  if (db.prepare('SELECT 1 AS x FROM dorm_rooms WHERE building_name = ? AND room_no = ?').get(building, roomNo)) throw bad('يوجد غرفة بهذا الرقم في المبنى.');
  const nid = Number(db.prepare('INSERT INTO dorm_rooms (building_name, room_no, floor_no, capacity, occupied, room_type, annual_fee, status) VALUES (?, ?, ?, ?, 0, ?, 0, ?)').run(building, roomNo, floor, capacity, type, status).lastInsertRowid);
  audit(db, user, 'إضافة غرفة سكن', `${building} ${roomNo}`, ip);
  return { id: nid };
}
function deleteRoom({ db }, user, id, ip) {
  const cur = db.prepare('SELECT * FROM dorm_rooms WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'الغرفة غير موجودة.', 'not_found');
  if (db.prepare(`SELECT 1 AS x FROM dorm_allocations a WHERE a.room_id = ? AND ${RESIDENT} LIMIT 1`).get(cur.id)) throw bad('في الغرفة ساكنون؛ انقلهم أولاً.');
  db.prepare('DELETE FROM dorm_rooms WHERE id = ?').run(cur.id);
  audit(db, user, 'حذف غرفة سكن', `${cur.building_name} ${cur.room_no}`, ip);
  return { ok: true };
}

/* ---------- الساكنون ---------- */
function roomForResident(db, roomId, student, exceptAlloc = 0) {
  const room = db.prepare('SELECT r.*, b.gender FROM dorm_rooms r LEFT JOIN dorm_buildings b ON b.name = r.building_name WHERE r.id = ?').get(Number(roomId));
  if (!room) throw bad('اختر غرفة موجودة.');
  if (room.status === 'مغلقة') throw bad('هذه الغرفة مغلقة.');
  if (room.gender && !genderFits(student.gender, room.gender)) throw bad(`هذا المبنى قسم ${room.gender}.`);
  const now = Number(db.prepare(`SELECT COUNT(*) AS c FROM dorm_allocations a WHERE a.room_id = ? AND ${RESIDENT} AND a.id <> ?`).get(room.id, exceptAlloc).c);
  if (now >= Number(room.capacity)) throw bad('الغرفة ممتلئة.');
  return room;
}
const syncOccupied = (db, roomId) => db.prepare(`UPDATE dorm_rooms SET occupied = (SELECT COUNT(*) FROM dorm_allocations a WHERE a.room_id = ? AND ${RESIDENT}) WHERE id = ?`).run(Number(roomId), Number(roomId));

function allocate({ db }, user, b, ip) {
  const st = studentRow(db, b?.student_no);
  if (db.prepare(`SELECT 1 AS x FROM dorm_allocations a WHERE a.student_no = ? AND ${RESIDENT} LIMIT 1`).get(st.student_no)) throw bad('هذا الطالب مسكَّن بالفعل؛ انقله من جدول الساكنين.');
  const room = roomForResident(db, b?.room_id, st);
  const id = tx(db, () => {
    const newId = Number(db.prepare(`INSERT INTO dorm_allocations (room_id, student_name, student_no, faculty_name, check_in_date, academic_year, payment_status, status) VALUES (?, ?, ?, ?, ?, ?, '', 'ساكن')`)
      .run(room.id, st.display_name, st.student_no, st.faculty ?? '', clean(b?.check_in_date, 10) || today(), academicYear()).lastInsertRowid);
    syncOccupied(db, room.id);
    return newId;
  });
  audit(db, user, 'تسكين طالب', `${st.student_no} ← ${room.building_name} ${room.room_no}`, ip);
  return { id };
}
function moveResident({ db }, user, id, b, ip) {
  const a = db.prepare(`SELECT * FROM dorm_allocations a WHERE a.id = ? AND ${RESIDENT}`).get(Number(id));
  if (!a) throw new HttpError(404, 'لا يوجد ساكن بهذا السجل.', 'not_found');
  const st = studentRow(db, a.student_no), room = roomForResident(db, b?.room_id, st, a.id);
  tx(db, () => {
    db.prepare('UPDATE dorm_allocations SET room_id = ? WHERE id = ?').run(room.id, a.id);
    syncOccupied(db, a.room_id); syncOccupied(db, room.id);
  });
  audit(db, user, 'نقل طالب بين الغرف', `${a.student_no} ← ${room.building_name} ${room.room_no}`, ip);
  return { ok: true };
}
function checkOut({ db }, user, id, ip) {
  const a = db.prepare(`SELECT * FROM dorm_allocations a WHERE a.id = ? AND ${RESIDENT}`).get(Number(id));
  if (!a) throw new HttpError(404, 'لا يوجد ساكن بهذا السجل.', 'not_found');
  tx(db, () => {
    db.prepare("UPDATE dorm_allocations SET status = 'مغادر' WHERE id = ?").run(a.id);
    syncOccupied(db, a.room_id);
  });
  audit(db, user, 'إخلاء طالب من السكن', a.student_no, ip);
  return { ok: true };
}

/* ---------- المواد المسلمة ---------- */
const handoutFields = (db, b) => {
  const st = studentRow(db, b?.student_no);
  const allowed = new Set(getSetting(db, 'housing.supply_items'));
  const items = (Array.isArray(b?.items) ? b.items : []).map((x) => ({ name: clean(x?.name ?? x, 80), qty: Math.max(Number(x?.qty) || 1, 1), serial: clean(x?.serial, 60) })).filter((x) => x.name);
  if (!items.length) throw bad('اختر مادة واحدة على الأقل.');
  for (const it of items) if (!allowed.has(it.name)) throw bad(`«${it.name}» ليست في قائمة المواد؛ أضفها من الإعدادات العامة.`);
  const place = db.prepare(`SELECT r.building_name, r.room_no FROM dorm_allocations a JOIN dorm_rooms r ON r.id = a.room_id WHERE a.student_no = ? AND ${RESIDENT} LIMIT 1`).get(st.student_no);
  return { st, items, room: place ? `${place.building_name} / ${place.room_no}` : '', note: clean(b?.note, 300), day: clean(b?.handed_day, 10) || today(), returned: clean(b?.returned_day, 10) || null };
};
function createHandout({ db }, user, b, ip) {
  const f = handoutFields(db, b), no = docNo('HND');
  const id = Number(db.prepare('INSERT INTO housing_handouts (handout_no, student_no, student_name, faculty_name, room_label, items_json, note, handed_day, returned_day, handed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(no, f.st.student_no, f.st.display_name, f.st.faculty ?? '', f.room, JSON.stringify(f.items), f.note, f.day, f.returned, user.display_name, Date.now()).lastInsertRowid);
  audit(db, user, 'تسليم مواد سكن', `${f.st.student_no} / ${f.items.length} مادة`, ip);
  return { id, handoutNo: no };
}
function updateHandout({ db }, user, id, b, ip) {
  const cur = db.prepare('SELECT * FROM housing_handouts WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'السجل غير موجود.', 'not_found');
  const f = handoutFields(db, b);
  db.prepare('UPDATE housing_handouts SET student_no = ?, student_name = ?, faculty_name = ?, room_label = ?, items_json = ?, note = ?, handed_day = ?, returned_day = ? WHERE id = ?')
    .run(f.st.student_no, f.st.display_name, f.st.faculty ?? '', f.room, JSON.stringify(f.items), f.note, f.day, f.returned, cur.id);
  audit(db, user, 'تعديل سجل مواد سكن', cur.handout_no, ip);
  return { ok: true };
}
function deleteHandout({ db }, user, id, ip) {
  const cur = db.prepare('SELECT * FROM housing_handouts WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'السجل غير موجود.', 'not_found');
  db.prepare('DELETE FROM housing_handouts WHERE id = ?').run(cur.id);
  audit(db, user, 'حذف سجل مواد سكن', cur.handout_no, ip);
  return { ok: true };
}

export function registerHousingRoutes(r, deps, { need, needAny }) {
  const view = (c) => { if (c.user.role !== 'student') needAny(c, 'sa_housing:view', 'sa_housing:manage'); };
  const manage = (c) => need(c, 'sa_housing:manage');
  r.add('GET', '/api/housing/overview', (c) => { view(c); c.json(200, housingOverview(deps, c.user)); });
  r.add('POST', '/api/housing/buildings', (c) => { manage(c); c.json(201, createBuilding(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/housing/buildings/:id', (c) => { manage(c); c.json(200, updateBuilding(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/housing/buildings/:id', (c) => { manage(c); c.json(200, deleteBuilding(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/housing/rooms', (c) => { manage(c); c.json(201, saveRoom(deps, c.user, null, c.body, c.ip)); });
  r.add('PUT', '/api/housing/rooms/:id', (c) => { manage(c); c.json(200, saveRoom(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/housing/rooms/:id', (c) => { manage(c); c.json(200, deleteRoom(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/housing/allocations', (c) => { manage(c); c.json(201, allocate(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/housing/allocations/:id', (c) => { manage(c); c.json(200, moveResident(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/housing/allocations/:id', (c) => { manage(c); c.json(200, checkOut(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/housing/handouts', (c) => { manage(c); c.json(201, createHandout(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/housing/handouts/:id', (c) => { manage(c); c.json(200, updateHandout(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/housing/handouts/:id', (c) => { manage(c); c.json(200, deleteHandout(deps, c.user, c.params.id, c.ip)); });
}
