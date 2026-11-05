// تصدير البطاقات الجامعية دفعة واحدة بفلاتر الكلية والبرنامج والسنة، وجدول يوضح استلام كل بطاقة.
import { hashPassword, tempPassword as newTempPassword } from '../security.js';
import { certFor, certSummary, publicBase } from './enrollcert.js';
import { qrSvg } from '../qr.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { writeXlsx } from '../lib/xlsx.js';
import { levelLabel } from './students.js';

const MAX_BATCH = 2000;
const FROM = `FROM users u JOIN student_profiles p ON p.user_id = u.id JOIN programs g ON g.id = p.program_id LEFT JOIN faculties f ON f.id = g.faculty_id WHERE u.role = 'student' AND u.active = 1`;
const fullName = (r) => [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ');

function filterOf(q) {
  const where = [], args = [];
  const eq = (col, v) => { where.push(`${col} = ?`); args.push(v); };
  const term = String(q.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (term) {
    const like = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
    where.push("(u.student_no LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR (p.first_name || ' ' || p.father_name || ' ' || p.last_name) LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  if (Number(q.id) > 0) eq('u.id', Number(q.id));
  if (Number(q.faculty) > 0) eq('f.id', Number(q.faculty));
  if (Number(q.program) > 0) eq('g.id', Number(q.program));
  if (Number(q.level) > 0) eq('p.study_level', Number(q.level));
  if (Number(q.enrollYear) > 0) eq('p.enroll_year', Number(q.enrollYear));
  if (!(Number(q.id) > 0)) eq('p.status', ['active', 'suspended', 'graduated', 'withdrawn'].includes(q.status) ? q.status : 'active');
  return { sql: where.map((w) => ` AND ${w}`).join(''), args };
}

export function cardOptions(db) {
  return {
    faculties: db.prepare('SELECT id, name FROM faculties WHERE active = 1 ORDER BY name').all(),
    programs: db.prepare('SELECT id, name, faculty_id AS "facultyId" FROM programs WHERE active = 1 ORDER BY name').all(),
    years: db.prepare('SELECT DISTINCT enroll_year AS y FROM student_profiles ORDER BY y DESC').all().map((r) => r.y),
    levels: db.prepare('SELECT DISTINCT study_level AS l FROM student_profiles ORDER BY l').all().map((r) => ({ value: r.l, label: levelLabel(r.l, db) })),
  };
}

// صفوف البطاقات بالحقول التي يطبعها قالب البطاقة في الواجهة
export function cardStudents({ db }, q = {}) {
  const f = filterOf(q);
  // الشاشة تكفيها عينة وعدد؛ كل البطاقات تُجلب عند الطباعة فقط
  const limit = Math.min(MAX_BATCH, Math.max(1, Number(q.limit) || MAX_BATCH));
  const count = Number(db.prepare(`SELECT COUNT(*) AS c ${FROM}${f.sql}`).get(...f.args).c);
  const rows = db.prepare(`SELECT u.id, u.student_no, u.created_at AS account_at, p.first_name, p.father_name, p.last_name, p.study_level, p.enroll_year, p.enroll_term, p.national_id,
      g.name AS program_name, g.degree, g.faculty,
      (SELECT sf.id FROM student_files sf WHERE sf.student_id = u.id AND sf.kind = 'photo' ORDER BY sf.id DESC LIMIT 1) AS photo_id,
      (SELECT MAX(h.received_at) FROM card_handovers h WHERE h.student_id = u.id) AS received_at
    ${FROM}${f.sql} ORDER BY g.faculty, p.study_level, p.first_name LIMIT ${limit}`).all(...f.args);
  return {
    total: Math.min(count, MAX_BATCH),
    truncated: count > MAX_BATCH,
    students: rows.map((r) => ({
      id: r.id, studentNo: r.student_no, name: fullName(r), createdAt: Number(r.account_at), enrollYear: r.enroll_year, level: r.study_level, levelLabel: levelLabel(r.study_level, db),
      program: { name: r.program_name, degree: r.degree, faculty: r.faculty }, profile: { national_id: r.national_id, enroll_year: r.enroll_year, enroll_term: r.enroll_term },
      photoUrl: r.photo_id ? `/api/student-files/${r.photo_id}` : null, receivedAt: r.received_at ? Number(r.received_at) : null,
    })),
  };
}

// بيانات شهادة التسجيل المطبوعة. كلمة المرور مخزنة بصمة ولا تُقرأ، فتُصدر مؤقتة جديدة لمن لم يدخل بعد فقط
export async function cardCertificates({ db, cfg }, actor, body, ip) {
  const ids = Array.isArray(body?.studentIds) ? body.studentIds.map(Number).filter((n) => n > 0).slice(0, MAX_BATCH) : null;
  const list = ids ? ids.flatMap((id) => cardStudents({ db }, { ...(body.filters ?? {}), id }).students) : cardStudents({ db }, body?.filters ?? {}).students;
  const rows = list.length ? db.prepare(`SELECT id, must_change_password FROM users WHERE id IN (${list.map(() => '?').join(',')})`).all(...list.map((s) => s.id)) : [];
  const pending = new Set(rows.filter((r) => Number(r.must_change_password)).map((r) => r.id));
  const out = [];
  let reissued = 0;
  for (const s of list) {
    let tempPassword = null;
    if (pending.has(s.id)) {
      tempPassword = newTempPassword();
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(await hashPassword(tempPassword, cfg.scryptN), s.id);
      reissued++;
    }
    const ce = certFor(db, s.id), url = ce && `${publicBase(cfg)}/?verify=${ce.code}`;
    out.push({ ...s, tempPassword, cert: ce ? { ...certSummary(ce), payloadSha256: ce.payload_sha256, signer: ce.cert_subject, url, qrSvg: qrSvg(url) } : null });
  }
  audit(db, actor, 'طباعة شهادات تسجيل وإصدار كلمات مؤقتة', `${out.length} شهادة، ${reissued} كلمة جديدة`, ip);
  return { students: out };
}

export function createCardBatch({ db }, actor, body, ip) {
  const filters = body?.filters ?? {}, f = filterOf(filters);
  const label = String(body?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (label.length < 2) throw new HttpError(400, 'اكتب اسماً للدفعة.', 'validation');
  const ids = db.prepare(`SELECT u.id ${FROM}${f.sql} LIMIT ${MAX_BATCH + 1}`).all(...f.args).map((r) => r.id);
  if (!ids.length) throw new HttpError(400, 'لا يوجد طلاب بهذه الفلاتر.', 'validation');
  if (ids.length > MAX_BATCH) throw new HttpError(400, `الدفعة الواحدة حتى ${MAX_BATCH} طالب؛ ضيّق الفلاتر.`, 'validation');
  const now = Date.now();
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO card_batches (label, filter_json, created_by, created_at) VALUES (?,?,?,?)').run(label, JSON.stringify(filters), actor.id, now).lastInsertRowid);
    const ins = db.prepare('INSERT INTO card_handovers (batch_id, student_id) VALUES (?,?)');
    for (const sid of ids) ins.run(id, sid);
    audit(db, actor, `إنشاء دفعة بطاقات: ${ids.length} بطاقة`, label, ip);
    return { id, total: ids.length };
  });
}

export function listCardBatches({ db }) {
  return db.prepare(`SELECT b.id, b.label, b.created_at, u.display_name AS creator, COUNT(h.id) AS total, COUNT(h.received_at) AS received
    FROM card_batches b JOIN users u ON u.id = b.created_by LEFT JOIN card_handovers h ON h.batch_id = b.id
    GROUP BY b.id, b.label, b.created_at, u.display_name ORDER BY b.id DESC LIMIT 100`).all()
    .map((b) => ({ id: b.id, label: b.label, createdAt: Number(b.created_at), creator: b.creator, total: Number(b.total), received: Number(b.received) }));
}

const handoverRows = (db, batchId) => db.prepare(`SELECT h.id, h.received_at, h.receiver_name, h.note, s.student_no, s.display_name AS student_name, p.first_name, p.father_name, p.last_name, p.study_level, g.faculty, g.name AS program_name, st.display_name AS handed_by_name
  FROM card_handovers h JOIN users s ON s.id = h.student_id LEFT JOIN student_profiles p ON p.user_id = s.id LEFT JOIN programs g ON g.id = p.program_id LEFT JOIN users st ON st.id = h.handed_by
  WHERE h.batch_id = ? ORDER BY g.faculty, p.study_level, s.display_name`).all(batchId);
const batchOf = (db, id) => {
  const b = db.prepare('SELECT * FROM card_batches WHERE id = ?').get(Number(id));
  if (!b) throw new HttpError(404, 'الدفعة غير موجودة.', 'not_found');
  return b;
};
const rowView = (db, r) => ({ id: r.id, studentNo: r.student_no, name: r.first_name ? fullName(r) : r.student_name, faculty: r.faculty ?? '', program: r.program_name ?? '', levelLabel: r.study_level ? levelLabel(r.study_level, db) : '', receivedAt: r.received_at ? Number(r.received_at) : null, receiver: r.receiver_name, handedBy: r.handed_by_name ?? '', note: r.note });

export function cardBatchDetail({ db }, id) {
  const b = batchOf(db, id);
  return { batch: { id: b.id, label: b.label, createdAt: Number(b.created_at), filters: JSON.parse(b.filter_json || '{}') }, rows: handoverRows(db, b.id).map((r) => rowView(db, r)) };
}

const handoverOf = (db, id) => {
  const h = db.prepare('SELECT h.*, u.student_no FROM card_handovers h JOIN users u ON u.id = h.student_id WHERE h.id = ?').get(Number(id));
  if (!h) throw new HttpError(404, 'السجل غير موجود.', 'not_found');
  return h;
};
export function markCardReceived({ db }, actor, id, body, ip) {
  const h = handoverOf(db, id);
  if (h.received_at) throw new HttpError(409, 'سُجّل استلام هذه البطاقة من قبل.', 'conflict');
  const receiver = String(body?.receiver ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (receiver.length < 2) throw new HttpError(400, 'اكتب اسم المستلم.', 'validation');
  tx(db, () => {
    db.prepare('UPDATE card_handovers SET received_at = ?, receiver_name = ?, handed_by = ?, note = ? WHERE id = ?').run(Date.now(), receiver, actor.id, String(body?.note ?? '').trim().slice(0, 200), h.id);
    audit(db, actor, 'تسليم بطاقة جامعية', h.student_no, ip);
  });
  return { ok: true };
}
export function undoCardReceived({ db }, actor, id, ip) {
  const h = handoverOf(db, id);
  if (!h.received_at) throw new HttpError(409, 'هذه البطاقة لم تُسلَّم بعد.', 'conflict');
  tx(db, () => {
    db.prepare("UPDATE card_handovers SET received_at = NULL, receiver_name = '', handed_by = NULL, note = '' WHERE id = ?").run(h.id);
    audit(db, actor, 'إلغاء تسليم بطاقة جامعية', h.student_no, ip);
  });
  return { ok: true };
}
export function cardBatchXlsx({ db }, id) {
  const b = batchOf(db, id), day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');
  const rows = handoverRows(db, b.id).map((r) => rowView(db, r)).map((r) => [r.studentNo, r.name, r.faculty, r.program, r.levelLabel, r.receivedAt ? 'مستلَمة' : 'لم تُستلم', day(r.receivedAt), r.receiver, r.handedBy, r.note]);
  return writeXlsx([{ name: 'استلام البطاقات', rows: [['الرقم الجامعي', 'الطالب', 'الكلية', 'البرنامج', 'السنة', 'الحالة', 'وقت الاستلام', 'المستلم', 'سلّمها', 'ملاحظة'], ...rows], widths: [18, 28, 28, 24, 14, 12, 18, 22, 22, 24], rtl: true, textCols: [0] }], { title: b.label });
}
