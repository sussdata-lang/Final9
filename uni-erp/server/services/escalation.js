// تصعيد الطلبات التي تجاوزت مهلة الإنجاز: كل مستوى يصل إلى الوحدة الأعلى في الهيكل.
import { getSetting } from './settings.js';
import { tx } from '../db.js';

const HOUR = 3600_000, BATCH = 500;

// أقرب وحدة أعلى فيها موظفون فعليون، وإلا فمديرو النظام
function targetOf(db, unitId, level) {
  let id = unitId, climbed = 0, last = null;
  while (id) {
    const u = db.prepare('SELECT id, name, parent_id FROM org_units WHERE id = ?').get(id);
    if (!u) break;
    if (climbed >= level) {
      const users = db.prepare("SELECT id FROM users WHERE unit_id = ? AND active = 1 AND role <> 'student'").all(u.id).map((x) => x.id);
      if (users.length) return { name: u.name, users };
    }
    last = u; id = u.parent_id; climbed++;
  }
  return { name: last && climbed > level ? last.name : 'إدارة النظام', users: db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((x) => x.id) };
}

export function escalateOverdueRequests(db, now = Date.now()) {
  if (!getSetting(db, 'requests.escalation_enabled')) return { escalated: 0 };
  const repeat = Number(getSetting(db, 'requests.escalation_repeat_hours')) * HOUR, max = Number(getSetting(db, 'requests.escalation_max_levels'));
  const rows = db.prepare(`SELECT r.id, r.no, r.assigned_unit_id, r.escalation_level, r.escalated_at, r.created_at, st.sla_hours, st.label, o.id AS service_unit
    FROM requests r JOIN service_types st ON st.code = r.service_code LEFT JOIN org_units o ON o.code = st.unit_code
    WHERE r.status = 'review' AND r.escalation_level < ? AND st.sla_hours > 0
      AND ((r.escalation_level = 0 AND r.created_at + st.sla_hours * ${HOUR} <= ?) OR (r.escalation_level > 0 AND r.escalated_at + ? <= ?))
    ORDER BY r.created_at LIMIT ${BATCH}`).all(max, now, repeat, now);
  let escalated = 0;
  for (const r of rows) {
    const level = Number(r.escalation_level) + 1;
    tx(db, () => {
      const claim = db.prepare('UPDATE requests SET escalation_level = ?, escalated_at = ? WHERE id = ? AND escalation_level = ?').run(level, now, r.id, r.escalation_level);
      if (!claim.changes) return;
      const t = targetOf(db, r.assigned_unit_id ?? r.service_unit, level);
      db.prepare('INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?, ?, ?, ?)').run(r.id, now, 'النظام', `تصعيد تلقائي (المستوى ${level}): تجاوز مهلة ${r.sla_hours} ساعة، وأُبلغت «${t.name}»`);
      const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING");
      for (const id of t.users) ins.run(id, `sla_escalation_${level}`, r.id, `طلب متأخر ${r.no} (${r.label}): تجاوز مهلة الإنجاز ويحتاج إلى متابعتكم.`, now);
      escalated++;
    });
  }
  return { escalated };
}
