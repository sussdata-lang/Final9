// «مكتبي»: ملخص شخصي للموظف في استدعاء واحد — الملف الوظيفي، الصلاحيات، الأرقام الحية، آخر الطلبات والمراسلات
import { effective, PERMISSION_CATALOG } from '../permissions.js';
import { scopeOf } from './requests.js';
import { myAttendance } from './staffatt.js';
import { publicUser } from './auth.js';
import { cacheGetOrSet, getCachedServiceByCode } from '../cache.js';

const one = (db, sql, ...a) => db.prepare(sql).get(...a)?.n ?? 0;

function countReviewQueue(db, user) {
  const scope = scopeOf(user);
  if (scope === 'all') {
    return one(db, "SELECT COUNT(*) n FROM requests WHERE status = 'review' AND student_id != ?", user.id);
  }
  if (scope === 'unit') {
    const ids = user.unitIds?.length ? user.unitIds : [user.unit_id ?? -1];
    const placeholders = ids.map(() => '?').join(',');
    return one(
      db,
      `SELECT COUNT(*) n FROM requests WHERE status = 'review' AND student_id != ? AND assigned_unit_id IN (${placeholders})`,
      user.id,
      ...ids
    );
  }
  return 0;
}

export function deskSummary({ db }, user) {
  return cacheGetOrSet(db, 'desk', `summary:${user.id}:${(user.unitIds || []).join(',')}`, () => {
    const can = (p) => user.can(p);
    const mine = effective(db, user);
    const permissions = PERMISSION_CATALOG.map((g) => ({ group: g.group, items: g.items.filter((i) => mine.includes(i.key)).map((i) => i.label) })).filter((g) => g.items.length);
    // نسخة لا تعديل: publicUser يعيد كائناً مشتركاً في الذاكرة المؤقتة، وحذف الصلاحيات منه يكسر /api/me عند إعادة التحميل
    const { permissions: _rawPerms, ...me } = publicUser(db, user);     // القائمة الخام موجودة في /api/me
    const out = { me, permissions, counts: {}, requests: { mine: [], queue: 0 }, corr: null, hr: null };

    // طلباتي الداخلية + ما ينتظر وحدتي
    if (can('request:create_internal')) {
      const rows = db.prepare('SELECT id, no, status, created_at, service_code FROM requests WHERE student_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id);
      out.requests.mine = rows.map((r) => ({
        id: r.id,
        no: r.no,
        status: r.status,
        at: r.created_at,
        service: getCachedServiceByCode(db, r.service_code)?.label ?? r.service_code,
      }));
      out.counts.myOpen = one(db, "SELECT COUNT(*) n FROM requests WHERE student_id = ? AND status = 'review'", user.id);
    }
    if (can('request:decide') || can('request:read_unit') || can('request:read_all')) {
      out.requests.queue = countReviewQueue(db, user);
      out.counts.queue = out.requests.queue;
    }

    // المراسلات
    if (can('corr:use') || can('corr:read_all')) {
      out.counts.corrTurn = one(db, `SELECT COUNT(*) n FROM corr_approvers a JOIN corr_docs d ON d.id = a.doc_id WHERE a.user_id = ? AND a.state = 'pending' AND d.status = 'pending'`, user.id);
      out.counts.corrUnread = one(db, 'SELECT COUNT(*) n FROM corr_notifs WHERE user_id = ? AND read = 0', user.id);
      out.counts.corrDrafts = one(db, "SELECT COUNT(*) n FROM corr_docs WHERE creator_id = ? AND status = 'draft'", user.id);
      out.corr = db.prepare(`SELECT d.id, d.no, d.title, d.status, d.created_at at FROM corr_docs d WHERE d.status != 'draft' AND (d.creator_id = ? OR EXISTS (SELECT 1 FROM corr_approvers a WHERE a.doc_id = d.id AND a.user_id = ?) OR EXISTS (SELECT 1 FROM corr_cc c WHERE c.doc_id = d.id AND c.user_id = ?)) ORDER BY d.created_at DESC LIMIT 5`).all(user.id, user.id, user.id);
    }

    // الحضور والإجازة
    if (can('staffatt:self')) { const a = myAttendance({ db }, user); out.hr = { today: a.today, month: a.month, leave: a.leave }; }
    return out;
  }, 5_000);
}

