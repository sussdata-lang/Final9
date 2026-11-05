import { tx } from '../db.js';
import { bad } from '../validate.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import {
  PERMISSION_CATALOG,
  PERMISSIONS,
  ASSIGNABLE,
  BUILTIN_ROLES,
  ROLE_LABEL,
  ROLE_DESC,
  STUDENT_PERMISSION_LABELS,
  PLATFORM_MODULES_MATRIX,
  DEPARTMENT_ROLE_PRESETS,
  ALL_STAFF_VIEWS,
  safeJsonParse,
  resolveModulePermissions,
  } from '../permissions.js';
import { SCHEMA, getSetting, studentPermSetting, STUDENT_VIEW_KEYS } from './settings.js';
import { writeXlsx } from '../lib/xlsx.js';
import {
  cacheGetOrSet,
  getCachedUnitTree,
  getCachedLinkedTargets,
  getOrgUnitsSnapshot,
  getRolesSnapshot,
} from '../cache.js';

const clean = (v, min, max, what) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max || /[\u0000-\u001f<>]/.test(s)) throw bad(`«${what}» يجب أن يكون بين ${min} و${max} حرفاً بلا رموز غير مسموحة.`);
  return s;
};

/* ---------------- الأدوار ---------------- */
function parsePerms(actor, list) {
  if (!Array.isArray(list) || !list.length) throw bad('اختر صلاحية واحدة على الأقل.');
  const set = [...new Set(list.map(String))];
  for (const p of set) {
    if (!ASSIGNABLE.has(p)) throw bad(`صلاحية غير معروفة: ${p}`);
    if (!actor.can(p)) throw new HttpError(403, 'لا يجوز منح صلاحية لا تملكها أنت.', 'forbidden');
  }
  if (set.includes('request:read_all') && set.includes('request:read_unit')) throw bad('اختر إما «عرض كل الطلبات» أو «عرض طلبات وحدته فقط».');
  return set;
}

function listRoles(db) {
  return cacheGetOrSet(db, 'identity', 'roles:list_full', () => {
    // استعلام تجميعي واحد لحساب المستخدمين الفعالين لكل دور بدلاً من 40+ استعلام منفصل
    const roleCounts = new Map();
    const roleKeyCounts = new Map();
    for (const r of db.prepare('SELECT role, role_key, COUNT(*) AS n FROM users WHERE active = 1 GROUP BY role, role_key').all()) {
      if (r.role_key) {
        roleKeyCounts.set(r.role_key, (roleKeyCounts.get(r.role_key) || 0) + r.n);
      } else {
        roleCounts.set(r.role, (roleCounts.get(r.role) || 0) + r.n);
      }
    }

    const builtin = BUILTIN_ROLES.map((k) => ({
      key: k,
      label: ROLE_LABEL[k],
      description: ROLE_DESC[k],
      permissions: PERMISSIONS[k],
      builtin: true,
      active: true,
      users: roleCounts.get(k) || 0,
    }));
    const custom = getRolesSnapshot(db).rows.map((r) => {
      const perms = safeJsonParse(r.permissions_json, []);
      return {
        key: r.key,
        label: r.label,
        description: r.description,
        permissions: perms,
        builtin: false,
        active: !!r.active,
        users: roleKeyCounts.get(r.key) || 0,
      };
    });
    return [...builtin, ...custom];
  });
}

function listUnits(db) {
  return cacheGetOrSet(db, 'org_units', 'units:list_full', () => {
    const snap = getOrgUnitsSnapshot(db);
    // جلب كافة مستخدمي الوحدات والطلبات قيد المراجعة باستعلامين مجمّعين بدلاً من 3 استعلامات لكل وحدة (توفير 100+ استعلام)
    const headsByUnit = new Map();
    const activeUsersByUnit = new Map();
    for (const u of db.prepare('SELECT id, unit_id, username, display_name AS name, active, job_title AS jobTitle FROM users WHERE unit_id IS NOT NULL AND role <> \'student\' ORDER BY id').all()) {
      const uid = Number(u.unit_id);
      if (!headsByUnit.has(uid)) headsByUnit.set(uid, []);
      headsByUnit.get(uid).push({
        id: u.id,
        username: u.username,
        name: u.name,
        jobTitle: u.jobTitle || '',
        active: !!u.active,
      });
      if (u.active) {
        activeUsersByUnit.set(uid, (activeUsersByUnit.get(uid) || 0) + 1);
      }
    }

    const pendingByUnit = new Map();
    for (const r of db.prepare("SELECT assigned_unit_id, COUNT(*) AS n FROM requests WHERE assigned_unit_id IS NOT NULL AND status = 'review' GROUP BY assigned_unit_id").all()) {
      pendingByUnit.set(Number(r.assigned_unit_id), r.n);
    }

    const units = snap.units.map((u) => {
      const defaultModuleAccess = safeJsonParse(u.default_module_access_json, {});
      const defaultPermissions = safeJsonParse(u.default_permissions_json, []);
      const allowedViews = safeJsonParse(u.allowed_views_json, []);
      const mergedPerms = [...new Set([...defaultPermissions, ...resolveModulePermissions(defaultModuleAccess)])];
      return {
        id: u.id,
        name: u.name,
        kind: u.kind,
        parentId: u.parent_id,
        active: !!u.active,
        code: u.code,
        description: u.description || '',
        module: u.module,
        defaultPermissions: mergedPerms,
        defaultModuleAccess,
        allowedViews,
        effectiveDefaultPermissionsCount: mergedPerms.length,
        heads: headsByUnit.get(u.id) || [],
        users: activeUsersByUnit.get(u.id) || 0,
        pending: pendingByUnit.get(u.id) || 0,
      };
    });
    const links = snap.links.map((l) => ({ id: l.id, from: l.from_unit, to: l.to_unit, twoWay: !!l.two_way }));
    return { units, links };
  });
}

export function createRole({ db }, actor, input, ip) {
  const key = String(input?.key ?? '').trim();
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(key)) throw bad('رمز الدور: 3 إلى 30 حرفاً لاتينياً صغيراً أو أرقاماً أو _ ويبدأ بحرف.');
  if (['student', ...BUILTIN_ROLES].includes(key) || db.prepare('SELECT 1 FROM roles WHERE key = ?').get(key)) throw new HttpError(409, 'رمز الدور مستخدم مسبقاً.', 'conflict');
  const label = clean(input?.label, 2, 60, 'اسم الدور'), description = clean(input?.description ?? '', 0, 200, 'الوصف');
  const perms = parsePerms(actor, input?.permissions);
  tx(db, () => {
    db.prepare('INSERT INTO roles (key, label, description, permissions_json, created_at) VALUES (?,?,?,?,?)').run(key, label, description, JSON.stringify(perms), Date.now());
    audit(db, actor, `إنشاء دور: ${label}`, key, ip);
  });
  return { key };
}

export function updateRole({ db }, actor, key, input, ip) {
  const r = db.prepare('SELECT * FROM roles WHERE key = ?').get(String(key));
  if (!r) throw new HttpError(404, 'الدور غير موجود (الأدوار الأساسية ثابتة).', 'not_found');
  const label = input?.label !== undefined ? clean(input.label, 2, 60, 'اسم الدور') : r.label;
  const description = input?.description !== undefined ? clean(input.description, 0, 200, 'الوصف') : r.description;
  const perms = input?.permissions !== undefined ? parsePerms(actor, input.permissions) : JSON.parse(r.permissions_json);
  const active = input?.active === undefined ? r.active : (input.active ? 1 : 0);
  if (!JSON.parse(r.permissions_json).every((p) => actor.can(p))) throw new HttpError(403, 'لا يجوز تعديل دور أوسع من صلاحياتك.', 'forbidden');
  const permsChanged = JSON.stringify(perms) !== r.permissions_json || active !== r.active;
  tx(db, () => {
    db.prepare('UPDATE roles SET label = ?, description = ?, permissions_json = ?, active = ? WHERE key = ?').run(label, description, JSON.stringify(perms), active, r.key);
    // (أُزيل إنهاء الجلسات: الصلاحيات تُقرأ طازجة عند كل طلب، فلا حاجة لإجبار أحد على تسجيل الدخول مجدداً)
    audit(db, actor, `تعديل دور: ${label}${active !== r.active ? (active ? ' (تفعيل)' : ' (تعطيل)') : ''}`, r.key, ip);
  });
  return { ok: true };
}

export function deleteRole({ db }, actor, key, ip) {
  const r = db.prepare('SELECT * FROM roles WHERE key = ?').get(String(key));
  if (!r) throw new HttpError(404, 'الدور غير موجود.', 'not_found');
  if (db.prepare('SELECT 1 FROM users WHERE role_key = ?').get(r.key)) throw new HttpError(409, 'لا يمكن حذف دور مرتبط بحسابات؛ انقل الحسابات إلى دور آخر أو عطّل الدور.', 'conflict');
  tx(db, () => { db.prepare('DELETE FROM roles WHERE key = ?').run(r.key); audit(db, actor, `حذف دور: ${r.label}`, r.key, ip); });
  return { ok: true };
}

/* ---------------- الوحدات الإدارية وصلاحيات الأقسام ---------------- */
const KINDS = ['university', 'sector', 'college', 'department', 'office'];
const VALID_LEVELS = ['none', 'read', 'write', 'edit', 'full'];
const VALID_MODULE_IDS = new Set(PLATFORM_MODULES_MATRIX.map((m) => m.id));
const VALID_VIEW_KEYS = new Set(ALL_STAFF_VIEWS.map((v) => v.key));

function sanitizeUnitModuleAccess(actor, rawMap) {
  if (!rawMap || typeof rawMap !== 'object') return {};
  const cleanMap = {};
  for (const [modId, lvl] of Object.entries(rawMap)) {
    if (!VALID_MODULE_IDS.has(modId)) continue;
    const levelStr = String(lvl || 'none');
    if (!VALID_LEVELS.includes(levelStr)) continue;
    cleanMap[modId] = levelStr;
  }
  const implied = resolveModulePermissions(cleanMap);
  for (const p of implied) {
    if (!actor.can(p)) throw new HttpError(403, `لا يجوز منح صلاحية للقسم لا تملكها أنت (${p}).`, 'forbidden');
  }
  return cleanMap;
}

function sanitizeUnitPerms(actor, list) {
  if (!Array.isArray(list)) return [];
  const out = [...new Set(list.map(String).filter((p) => ASSIGNABLE.has(p)))];
  for (const p of out) {
    if (!actor.can(p)) throw new HttpError(403, `لا يجوز منح صلاحية للقسم لا تملكها أنت (${p}).`, 'forbidden');
  }
  return out;
}

function sanitizeUnitViews(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter((v) => VALID_VIEW_KEYS.has(v)))];
}

export function linkedTargets(db, unitId) {
  return getCachedLinkedTargets(db, unitId);
}



const unitRow = (db, id) => { const u = db.prepare('SELECT * FROM org_units WHERE id = ?').get(Number(id)); if (!u) throw new HttpError(404, 'الوحدة غير موجودة.', 'not_found'); return u; };

export function createUnit({ db }, actor, input, ip) {
  const name = clean(input?.name, 2, 80, 'اسم الوحدة'), kind = input?.kind ?? 'department';
  if (!KINDS.includes(kind)) throw bad('نوع وحدة غير صالح.');
  const parent = input?.parentId ? unitRow(db, input.parentId).id : null;
  if (db.prepare('SELECT 1 FROM org_units WHERE name = ?').get(name)) throw new HttpError(409, 'يوجد وحدة بهذا الاسم.', 'conflict');
  const description = input?.description ? clean(input.description, 0, 200, 'وصف الوحدة') : '';
  const defaultModuleAccess = sanitizeUnitModuleAccess(actor, input?.defaultModuleAccess);
  const defaultPermissions = sanitizeUnitPerms(actor, input?.defaultPermissions);
  const allowedViews = sanitizeUnitViews(input?.allowedViews);
  const id = tx(db, () => {
    const r = Number(
      db.prepare('INSERT INTO org_units (name, kind, parent_id, description, default_permissions_json, default_module_access_json, allowed_views_json) VALUES (?,?,?,?,?,?,?)')
        .run(name, kind, parent, description, JSON.stringify(defaultPermissions), JSON.stringify(defaultModuleAccess), JSON.stringify(allowedViews)).lastInsertRowid
    );
    audit(db, actor, `إضافة وحدة إدارية: ${name}`, String(r), ip);
    return r;
  });
  return { id };
}

export function updateUnit({ db }, actor, id, input, ip) {
  const u = unitRow(db, id);
  const name = input?.name !== undefined ? clean(input.name, 2, 80, 'اسم الوحدة') : u.name;
  let parent = u.parent_id;
  if (input?.parentId !== undefined) {
    parent = input.parentId ? unitRow(db, input.parentId).id : null;
    for (let p = parent; p; p = db.prepare('SELECT parent_id FROM org_units WHERE id = ?').get(p)?.parent_id) if (p === u.id) throw bad('لا يمكن جعل الوحدة تابعة لنفسها أو لأحد فروعها.');
  }
  const active = input?.active === undefined ? u.active : (input.active ? 1 : 0);
  if (!active && u.active) {
    if (db.prepare('SELECT 1 FROM users WHERE unit_id = ? AND active = 1').get(u.id)) throw new HttpError(409, 'لا يمكن تعطيل وحدة فيها حسابات فعّالة.', 'conflict');
    if (db.prepare("SELECT 1 FROM requests WHERE assigned_unit_id = ? AND status = 'review'").get(u.id)) throw new HttpError(409, 'لا يمكن تعطيل وحدة لديها طلبات قيد المراجعة.', 'conflict');
  }
  if (name !== u.name && db.prepare('SELECT 1 FROM org_units WHERE name = ? AND id != ?').get(name, u.id)) throw new HttpError(409, 'يوجد وحدة بهذا الاسم.', 'conflict');

  const description = input?.description !== undefined ? clean(input.description, 0, 250, 'وصف الوحدة') : (u.description ?? '');
  const defaultModuleAccess = input?.defaultModuleAccess !== undefined
    ? sanitizeUnitModuleAccess(actor, input.defaultModuleAccess)
    : safeJsonParse(u.default_module_access_json, {});
  const defaultPermissions = input?.defaultPermissions !== undefined
    ? sanitizeUnitPerms(actor, input.defaultPermissions)
    : safeJsonParse(u.default_permissions_json, []);
  const allowedViews = input?.allowedViews !== undefined
    ? sanitizeUnitViews(input.allowedViews)
    : safeJsonParse(u.allowed_views_json, []);

  tx(db, () => {
    db.prepare('UPDATE org_units SET name = ?, parent_id = ?, active = ?, description = ?, default_permissions_json = ?, default_module_access_json = ?, allowed_views_json = ? WHERE id = ?')
      .run(name, parent, active, description, JSON.stringify(defaultPermissions), JSON.stringify(defaultModuleAccess), JSON.stringify(allowedViews), u.id);

    if (input?.applyToUnitUsers) {
      db.prepare("UPDATE users SET module_access_json = ?, custom_permissions_json = ?, allowed_views_json = ? WHERE unit_id = ? AND role != 'admin'")
        .run(JSON.stringify(defaultModuleAccess), JSON.stringify(defaultPermissions), JSON.stringify(allowedViews), u.id);
    }

    if (input?.defaultPermissions !== undefined || input?.defaultModuleAccess !== undefined || input?.allowedViews !== undefined) {
    // (أُزيل إنهاء الجلسات: الصلاحيات تُقرأ طازجة عند كل طلب، فلا حاجة لإجبار أحد على تسجيل الدخول مجدداً)
    }

    audit(db, actor, `تعديل وحدة إدارية وصلاحياتها: ${name}${active !== u.active ? (active ? ' (تفعيل)' : ' (تعطيل)') : ''}`, String(u.id), ip);
  });
  return { ok: true };
}

export function deleteUnit({ db }, actor, id, ip) {
  const u = unitRow(db, id);
  if (db.prepare('SELECT 1 FROM users WHERE unit_id = ?').get(u.id)) throw new HttpError(409, 'لا يمكن حذف وحدة فيها حسابات؛ انقل الحسابات أولاً.', 'conflict');
  if (db.prepare('SELECT 1 FROM org_units WHERE parent_id = ?').get(u.id)) throw new HttpError(409, 'لا يمكن حذف وحدة لها وحدات فرعية.', 'conflict');
  if (db.prepare('SELECT 1 FROM requests WHERE assigned_unit_id = ?').get(u.id)) throw new HttpError(409, 'لا يمكن حذف وحدة أُحيلت إليها طلبات؛ عطّلها بدلاً من حذفها.', 'conflict');
  tx(db, () => {
    db.prepare('DELETE FROM unit_links WHERE from_unit = ? OR to_unit = ?').run(u.id, u.id);
    db.prepare('DELETE FROM org_units WHERE id = ?').run(u.id);
    audit(db, actor, `حذف وحدة إدارية: ${u.name}`, String(u.id), ip);
  });
  return { ok: true };
}

export function createLink({ db }, actor, input, ip) {
  const a = unitRow(db, input?.from), b = unitRow(db, input?.to);
  if (a.id === b.id) throw bad('لا يمكن ربط الوحدة بنفسها.');
  if (!a.active || !b.active) throw bad('لا يمكن الربط بوحدة معطَّلة.');
  if (db.prepare('SELECT 1 FROM unit_links WHERE (from_unit = ? AND to_unit = ?) OR (from_unit = ? AND to_unit = ?)').get(a.id, b.id, b.id, a.id)) throw new HttpError(409, 'يوجد رابط بين الوحدتين مسبقاً؛ احذفه ثم أنشئ الجديد.', 'conflict');
  const id = tx(db, () => {
    const r = Number(db.prepare('INSERT INTO unit_links (from_unit, to_unit, two_way, created_at) VALUES (?,?,?,?)').run(a.id, b.id, input?.twoWay ? 1 : 0, Date.now()).lastInsertRowid);
    audit(db, actor, `ربط وحدتين: ${a.name} ${input?.twoWay ? '↔' : '←'} ${b.name}`, String(r), ip);
    return r;
  });
  return { id };
}

export function deleteLink({ db }, actor, id, ip) {
  const l = db.prepare('SELECT * FROM unit_links WHERE id = ?').get(Number(id));
  if (!l) throw new HttpError(404, 'الرابط غير موجود.', 'not_found');
  tx(db, () => { db.prepare('DELETE FROM unit_links WHERE id = ?').run(l.id); audit(db, actor, 'حذف رابط بين وحدتين', `${l.from_unit}-${l.to_unit}`, ip); });
  return { ok: true };
}

const settingLabel = (key) => SCHEMA.flatMap((s) => s.items).find((i) => i.key === key)?.label ?? key;
const studentRole = (db) => ({
  key: 'student',
  label: ROLE_LABEL.student,
  description: ROLE_DESC.student,
  builtin: true,
  fixed: true,
  active: true,
  users: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'student' AND active = 1").get().n,
  permissions: PERMISSIONS.student.filter((key) => getSetting(db, studentPermSetting(key), true) !== false).map((key) => ({ key, label: STUDENT_PERMISSION_LABELS[key] ?? key })),
  allPermissions: PERMISSIONS.student.map((key) => ({ key, label: STUDENT_PERMISSION_LABELS[key] ?? key, setting: studentPermSetting(key), enabled: getSetting(db, studentPermSetting(key), true) !== false })),
  views: STUDENT_VIEW_KEYS.map((key) => { const setting = `student_portal.view_${key}`; return { key, setting, label: settingLabel(setting), enabled: getSetting(db, setting, true) !== false }; }),
});

export const overview = (db) => ({
  catalog: PERMISSION_CATALOG,
  modulesMatrix: PLATFORM_MODULES_MATRIX,
  rolePresets: DEPARTMENT_ROLE_PRESETS,
  allViews: ALL_STAFF_VIEWS,
  roles: listRoles(db),
  studentRole: studentRole(db),
  ...listUnits(db),
});

export function matrixXlsx(db) {
  const roles = listRoles(db), st = studentRole(db), stKeys = new Set(st.permissions.map((p) => p.key));
  const head = ['المجموعة', 'الصلاحية', ...roles.map((r) => r.label + (r.builtin ? '' : r.active ? '' : ' (معطّل)')), 'الطالب'];
  const mark = (v) => (v ? '✓' : '');
  const rows = PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => [g.group, i.key, ...roles.map((r) => mark(r.permissions.includes(i.key))), mark(stKeys.has(i.key))]));
  for (const p of st.permissions) if (!ASSIGNABLE.has(p.key)) rows.push(['صلاحيات الطالب (ثابتة)', p.key, ...roles.map(() => ''), '✓']);
  const desc = [['الدور', 'الرمز', 'النوع', 'الحالة', 'الحسابات', 'عدد الصلاحيات', 'الوصف'], ...[...roles, { ...st, permissions: st.permissions }].map((r) => [r.label, r.key, r.builtin ? 'أساسي' : 'مخصّص', r.active ? 'فعّال' : 'معطّل', r.users, r.permissions.length, r.description ?? ''])];
  return writeXlsx([{ name: 'المصفوفة', rows: [head, ...rows], widths: [26, 24, ...roles.map(() => 14), 10], textCols: [1], rtl: true }, { name: 'الأدوار', rows: desc, widths: [30, 22, 10, 10, 10, 14, 60], rtl: true }], { title: 'مصفوفة الصلاحيات' });
}
