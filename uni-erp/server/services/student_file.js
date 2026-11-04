// نافذة «المعلومات الشخصية الرئيسية»: كل بيانات الطالب، وأنواع مرفقاته، وبنوده الإضافية، وسجل التعديلات من سجل التدقيق.
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { getStudent, sections } from './students.js';
import { KINDS, listStudentFiles } from './studentfiles.js';

const META_FIELDS = [
  ['general_notes', 'generalNotes', 'ملاحظات عامة'],
  ['box_no', 'box', 'الصندوق'],
  ['dossier_no', 'dossier', 'الإضبارة'],
  ['cert_notes', 'certNotes', 'ملاحظات الشهادة'],
  ['exception_note', 'exception', 'الاستثناء'],
];
const MAX_LEN = 2000;
const accountName = (db, id) => (id ? db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(Number(id)) : null);

function metaView(db, id) {
  const m = db.prepare('SELECT * FROM student_file_meta WHERE student_id = ?').get(Number(id));
  const out = Object.fromEntries(META_FIELDS.map(([col, key]) => [key, m ? m[col] : '']));
  const by = m && accountName(db, m.audited_by);
  return { ...out, audited: !!(m && m.audited), auditedBy: by ? by.display_name : null, auditedAt: m && m.audited_at ? Number(m.audited_at) : null };
}

// الخيارات تُعرض بعناوينها لا بقيمها المخزنة
function displayValue(field, value) {
  if (value === null || value === undefined || value === '') return '';
  const opt = (field.options || []).find((o) => String(o.v ?? o) === String(value));
  return String(opt ? (opt.l ?? opt) : value);
}
// آخر تعديل بشري: لا يُحسب تسجيل الطالب ولا ما يفعله النظام تلقائياً كإصدار الشهادة
const lastEdit = (history) => history.find((h) => h.role !== 'system' && h.action !== 'تسجيل طالب جديد') ?? null;
function historyOf(db, no) {
  const rows = db.prepare(`SELECT a.at, a.action, a.actor_label, a.role, u.username
    FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.ref = ? AND a.action <> 'عرض ملف طالب' ORDER BY a.id DESC LIMIT 100`).all(no);
  return rows.map((r) => ({ at: Number(r.at), action: r.action, actor: r.actor_label, username: r.username ?? null, role: r.role }));
}

export function studentFileView({ db }, actor, id, ip) {
  const st = getStudent({ db }, id);
  const groups = sections(db).map((s) => ({
    title: s.title,
    fields: s.fields.map((f) => ({ label: f.label, value: displayValue(f, st.profile[f.name]) })),
  }));
  const files = listStudentFiles(db, st.id);
  const attachments = Object.entries(KINDS).map(([kind, label]) => ({ kind, label, files: files.filter((f) => f.kind === kind).map((f) => ({ id: f.id, name: f.name, url: f.url, size: f.size, createdAt: f.createdAt })) })).filter((k) => k.files.length);
  const history = historyOf(db, st.studentNo);
  const last = lastEdit(history);
  audit(db, actor, 'عرض ملف طالب', st.studentNo, ip);
  return { student: st, groups, extra: st.extra || [], attachments, meta: metaView(db, st.id), history, last, canEdit: actor.can('student:update') };
}

export function saveStudentFileMeta({ db }, actor, id, body, ip) {
  const st = getStudent({ db }, id), input = body || {}, cur = metaView(db, st.id);
  const next = {};
  for (const [, key, label] of META_FIELDS) {
    const v = input[key] === undefined || input[key] === null ? cur[key] : String(input[key]).trim();
    if (v.length > MAX_LEN) throw new HttpError(400, `«${label}» يجب ألا يتجاوز ${MAX_LEN} حرف.`, 'validation', key);
    next[key] = v;
  }
  const audited = input.audited === undefined ? cur.audited : !!input.audited;
  const changed = META_FIELDS.filter(([, key]) => next[key] !== cur[key]).map(([, , label]) => label);
  const now = Date.now();
  tx(db, () => {
    const auditedAt = audited ? (cur.audited ? cur.auditedAt : now) : null;
    const auditedById = audited ? (cur.audited ? db.prepare('SELECT audited_by FROM student_file_meta WHERE student_id = ?').get(st.id).audited_by : actor.id) : null;
    const cols = META_FIELDS.map(([col]) => col);
    db.prepare(`INSERT INTO student_file_meta (student_id, ${cols.join(', ')}, audited, audited_by, audited_at, updated_by, updated_at)
      VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, audited = excluded.audited, audited_by = excluded.audited_by, audited_at = excluded.audited_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(st.id, ...META_FIELDS.map(([, key]) => next[key]), audited ? 1 : 0, auditedById, auditedAt, actor.id, now);
    // أسماء البنود فقط في السجل، لا محتواها
    if (changed.length) audit(db, actor, `تعديل البنود الإضافية (${changed.join('، ')})`, st.studentNo, ip);
    if (audited !== cur.audited) audit(db, actor, audited ? 'تدقيق ملف طالب' : 'إلغاء تدقيق ملف طالب', st.studentNo, ip);
  });
  const history = historyOf(db, st.studentNo);
  return { meta: metaView(db, st.id), history, last: lastEdit(history) };
}
