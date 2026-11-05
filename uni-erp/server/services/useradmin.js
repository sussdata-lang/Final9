import { tx } from '../db.js';
import { getSetting, studentViewsOf } from './settings.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { hashPassword, tempPassword, validatePasswordPolicy } from '../security.js';
import {
  PERMISSIONS,
  BUILTIN_ROLES,
  ASSIGNABLE,
  PLATFORM_MODULES,
  effective,
  roleLabel,
  safeJsonParse,
  resolveModulePermissions,
  computeAllowedViews,
  summarizeUserAccessProfile,
} from '../permissions.js';
import { cacheGetOrSet, getCachedRoleByKey, getCachedUnitById } from '../cache.js';

// حسابات العاملين والموظفين؛ حسابات الطلاب تُدار من شاشة «شؤون الطلاب»
const bad = (m, code = 'validation') => new HttpError(400, m, code);
const activeAdmins = (db) => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND role_key IS NULL AND active = 1").get().n;
const covers = (actor, perms) => perms.every((p) => actor.can(p));

const VALID_MODES = ['role', 'custom', 'hybrid'];
const VALID_SCOPES = ['all', 'faculty', 'unit', 'own', 'self'];
const VALID_LEVELS = ['none', 'read', 'write', 'edit', 'full'];
const VALID_MODULE_IDS = new Set(PLATFORM_MODULES.map((m) => m.id));

function sanitizePermissionList(actor, list) {
  if (!Array.isArray(list)) return [];
  const out = [...new Set(list.map(String).filter((p) => ASSIGNABLE.has(p)))];
  for (const p of out) {
    if (!actor.can(p)) throw new HttpError(403, `لا يجوز منح صلاحية لا تملكها أنت (${p}).`, 'forbidden');
  }
  return out;
}

function sanitizeModuleAccess(actor, rawMap) {
  if (!rawMap || typeof rawMap !== 'object') return {};
  const cleanMap = {};
  for (const [modId, val] of Object.entries(rawMap)) {
    if (!VALID_MODULE_IDS.has(modId)) continue;
    if (typeof val === 'string') {
      if (VALID_LEVELS.includes(val)) cleanMap[modId] = val;
    } else if (val && typeof val === 'object') {
      const obj = {};
      for (const k of ['view', 'write', 'edit', 'approve', 'delete']) {
        if (typeof val[k] === 'boolean') obj[k] = val[k];
      }
      if (Object.keys(obj).length > 0) cleanMap[modId] = obj;
    }
  }
  const impliedPerms = resolveModulePermissions(cleanMap);
  for (const p of impliedPerms) {
    if (!actor.can(p)) throw new HttpError(403, `لا يجوز منح مستوى وصول يتضمن صلاحية لا تملكها (${p}).`, 'forbidden');
  }
  return cleanMap;
}

function sanitizeHiddenTabs(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter((v) => /^[a-z0-9_:-]{3,60}$/.test(v)))].slice(0, 300);
}
function sanitizeAllowedViews(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter((v) => /^[a-z0-9_]{2,24}$/.test(v)))];
}

// يحوّل مفتاح الدور المختار إلى (role, role_key) مع منع رفع الصلاحيات
function resolveRole(db, actor, key) {
  key = String(key ?? '');
  if (BUILTIN_ROLES.includes(key)) {
    if (!covers(actor, PERMISSIONS[key])) throw new HttpError(403, 'لا يجوز منح دور أوسع من صلاحياتك.', 'forbidden');
    return { role: key, role_key: null };
  }
  const r = getCachedRoleByKey(db, key);
  if (!r) throw bad('دور غير موجود.');
  if (!r.active) throw bad('هذا الدور معطَّل.');
  if (!covers(actor, JSON.parse(r.permissions_json))) throw new HttpError(403, 'لا يجوز منح دور أوسع من صلاحياتك.', 'forbidden');
  return { role: 'staff', role_key: r.key };
}

function resolveUnit(db, unitId) {
  if (unitId === undefined || unitId === null || unitId === '') return null;
  const u = getCachedUnitById(db, Number(unitId));
  if (!u) throw bad('الوحدة غير موجودة.');
  if (!u.active) throw bad('الوحدة معطَّلة.');
  return u.id;
}

function target(db, actor, id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!u) throw new HttpError(404, 'المستخدم غير موجود.', 'not_found');
  if (u.role === 'student') throw bad('حسابات الطلاب تُدار من شاشة «شؤون الطلاب».', 'bad_request');
  if (u.id !== actor.id && !covers(actor, effective(db, u))) throw new HttpError(403, 'لا تملك صلاحية التصرف بحساب أوسع من صلاحياتك.', 'forbidden');
  return u;
}

const view = (db, u) => {
  const perms = effective(db, u);
  const explicitViews = safeJsonParse(u.allowed_views_json, []);
  const profile = summarizeUserAccessProfile(u, perms);
  const roleActive = u.role_key ? !!getCachedRoleByKey(db, u.role_key)?.active : true;
  const unitRow = u.unit_id ? getCachedUnitById(db, u.unit_id) : null;
  return {
    id: u.id,
    username: u.username,
    name: u.display_name,
    displayName: u.display_name,
    role: u.role,
    roleKey: u.role_key ?? u.role,
    roleLabel: roleLabel(db, u),
    roleActive,
    unit: unitRow ? { id: unitRow.id, name: unitRow.name } : null,
    unitId: u.unit_id ?? null,
    staffKind: u.staff_kind ?? 'admin',
    jobTitle: u.job_title ?? '',
    active: !!u.active,
    mustChange: !!u.must_change_password,
    locked: u.locked_until > Date.now(),
    accessMode: u.access_mode ?? 'role',
    dataScope: u.data_scope ?? 'unit',
    scopeFaculty: u.scope_faculty ?? '',
    moduleAccess: safeJsonParse(u.module_access_json, {}),
    derivedModuleAccess: profile.moduleAccess,
    customPermissions: safeJsonParse(u.custom_permissions_json, []),
    revokedPermissions: safeJsonParse(u.revoked_permissions_json, []),
    explicitAllowedViews: explicitViews,
    hiddenTabs: safeJsonParse(u.hidden_tabs_json, []),
    allowedViews: computeAllowedViews(perms, explicitViews, u.role, u.role === 'student' ? studentViewsOf(db, u.id) : null),
    effectivePermissions: perms,
    permissions: perms,
    accessProfile: profile,
    accessSummary: {
      fullCount: profile.counts.full,
      editCount: profile.counts.edit,
      writeCount: profile.counts.write,
      readCount: profile.counts.read,
      totalPermissions: perms.length,
    },
  };
};

export const listStaff = (db) =>
  cacheGetOrSet(db, 'identity', 'staff:list_full', () =>
    db.prepare("SELECT * FROM users WHERE role != 'student' ORDER BY id").all().map((u) => view(db, u)),
  );

// قائمة خفيفة لصفحة الحسابات: الأعداد فقط؛ تفاصيل صلاحيات الحساب تُجلب عند فتحه للتعديل
export const listStaffLight = (db) => listStaff(db).map((u) => {
  const { viewCount, writeCount, editCount, approveCount, deleteCount } = u.accessProfile.capabilities;
  return {
    id: u.id, username: u.username, name: u.name, displayName: u.displayName, role: u.role, roleKey: u.roleKey, roleLabel: u.roleLabel, roleActive: u.roleActive,
    unit: u.unit, unitId: u.unitId, staffKind: u.staffKind, jobTitle: u.jobTitle, active: u.active, mustChange: u.mustChange, locked: u.locked,
    accessMode: u.accessMode, dataScope: u.dataScope, accessSummary: u.accessSummary,
    permissionCount: u.effectivePermissions.length, viewCount: u.allowedViews.length,
    accessProfile: { capabilities: { viewCount, writeCount, editCount, approveCount, deleteCount } },
  };
});

export function staffDetail(db, id) {
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'student'").get(Number(id));
  if (!u) throw new HttpError(404, 'الحساب غير موجود.', 'not_found');
  return view(db, u);
}

const KINDS = ['admin', 'faculty'];
const kindOf = (v, dflt = 'admin') => { if (v === undefined || v === null || v === '') return dflt; if (!KINDS.includes(v)) throw bad('نوع العضو: هيئة إدارية أو تدريسية.'); return v; };
const titleOf = (v, dflt = '') => { if (v === undefined) return dflt; const s = String(v ?? '').replace(/\s+/g, ' ').trim(); if (s.length > 80) throw bad('المسمى الوظيفي حتى 80 حرفاً.'); return s; };
const modeOf = (v, dflt = 'role') => { if (v === undefined || v === null || v === '') return dflt; if (!VALID_MODES.includes(v)) throw bad('آلية الصلاحيات غير صالحة.'); return v; };
const scopeOf = (v, dflt = 'unit') => { if (v === undefined || v === null || v === '') return dflt; if (!VALID_SCOPES.includes(v)) throw bad('نطاق الوصول للبيانات غير صالح.'); return v; };

export async function createUser({ db, cfg }, actor, input, ip) {
  const username = String(input?.username ?? '').trim();
  const name = String(input?.displayName ?? input?.name ?? '').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,39}$/.test(username)) throw bad('اسم المستخدم: 3-40 حرفاً لاتينياً أو أرقاماً أو . _ - ويبدأ بحرف.');
  if (name.length < 2 || name.length > 100) throw bad('الاسم يجب أن يكون بين 2 و100 حرف.');
  const rawRole = input?.role ?? input?.roleKey ?? 'staff';
  if (rawRole === 'student') throw bad('يُسجَّل الطلاب من شاشة «تسجيل الطلاب» كي يكتمل ملفهم.', 'bad_request');
  const rawPassword = input?.password ?? input?.tempPassword;
  const pwBad = validatePasswordPolicy(rawPassword, getSetting(db, 'security.password_min'));
  if (pwBad) throw new HttpError(400, pwBad, 'weak_password');
  const rk = resolveRole(db, actor, rawRole);
  const unit = resolveUnit(db, input?.unitId);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'اسم المستخدم مستخدم مسبقاً.', 'conflict');

  const accessMode = modeOf(input?.accessMode, 'role');
  const dataScope = scopeOf(input?.dataScope, unit ? 'unit' : 'all');
  const moduleAccess = sanitizeModuleAccess(actor, input?.moduleAccess);
  const customPerms = sanitizePermissionList(actor, input?.customPermissions);
  const revokedPerms = Array.isArray(input?.revokedPermissions)
    ? [...new Set(input.revokedPermissions.map(String).filter((p) => ASSIGNABLE.has(p)))]
    : [];
  const allowedViews = sanitizeAllowedViews(input?.allowedViews);
  const hiddenTabs = sanitizeHiddenTabs(input?.hiddenTabs);

  const hash = await hashPassword(rawPassword, cfg.scryptN);
  const id = tx(db, () => {
    const r = db
      .prepare(`
        INSERT INTO users (
          username, display_name, password_hash, role, role_key, unit_id,
          must_change_password, created_at, staff_kind, job_title,
          access_mode, data_scope, custom_permissions_json, revoked_permissions_json,
          allowed_views_json, module_access_json, hidden_tabs_json
        ) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)
      `)
      .run(
        username,
        name,
        hash,
        rk.role,
        rk.role_key,
        unit,
        Date.now(),
        kindOf(input?.staffKind),
        titleOf(input?.jobTitle),
        accessMode,
        dataScope,
        JSON.stringify(customPerms),
        JSON.stringify(revokedPerms),
        JSON.stringify(allowedViews),
        JSON.stringify(moduleAccess),
        JSON.stringify(hiddenTabs)
      );
    setScopeFaculty(db, Number(r.lastInsertRowid), dataScope, input?.scopeFaculty);
    audit(db, actor, `إنشاء حساب إداري (${rk.role_key ?? rk.role} · ${accessMode})`, username, ip);
    return Number(r.lastInsertRowid);
  });
  return { id, username, tempPassword: rawPassword, user: view(db, db.prepare('SELECT * FROM users WHERE id = ?').get(id)) };
}

// نطاق الكلية بلا كلية محددة لا يقيّد شيئاً، فيُرفض بدل أن يوهم بالتقييد
function setScopeFaculty(db, id, dataScope, faculty) {
  const name = dataScope === 'faculty' ? String(faculty ?? '').trim() : '';
  if (dataScope === 'faculty' && !db.prepare('SELECT 1 AS x FROM programs WHERE faculty = ? LIMIT 1').get(name)) throw bad('اكتب اسم الكلية أو المعهد كما هو في البرامج الدراسية.', 'validation');
  db.prepare('UPDATE users SET scope_faculty = ? WHERE id = ?').run(name || null, id);
}

export function updateUser({ db }, actor, id, input, ip) {
  const u = target(db, actor, id);
  const name = input?.displayName !== undefined ? String(input.displayName).replace(/\s+/g, ' ').trim() : u.display_name;
  if (name.length < 2 || name.length > 100) throw bad('الاسم يجب أن يكون بين 2 و100 حرف.');
  const cur = u.role_key ?? u.role;
  let rk = { role: u.role, role_key: u.role_key };
  const nextRoleInput = input?.role !== undefined ? input.role : input?.roleKey;
  if (nextRoleInput !== undefined && nextRoleInput !== cur) {
    if (u.id === actor.id) throw bad('لا يمكنك تغيير دورك بنفسك.', 'bad_request');
    if (u.role === 'admin' && !u.role_key && u.active && activeAdmins(db) <= 1) throw bad('لا يمكن إزالة آخر مدير فعّال.', 'bad_request');
    rk = resolveRole(db, actor, nextRoleInput);
  }
  const unit = input?.unitId !== undefined ? resolveUnit(db, input.unitId) : u.unit_id;
  const kind = kindOf(input?.staffKind, u.staff_kind);
  const title = titleOf(input?.jobTitle, u.job_title);

  const accessMode = input?.accessMode !== undefined ? modeOf(input.accessMode, u.access_mode ?? 'role') : (u.access_mode ?? 'role');
  if (u.id === actor.id && u.role === 'admin' && !u.role_key && accessMode === 'custom') {
    throw bad('لا يمكن تحويل حساب مدير النظام الحالي إلى صلاحيات مقيدة لتجنب قفل النظام.', 'bad_request');
  }
  const dataScope = input?.dataScope !== undefined ? scopeOf(input.dataScope, u.data_scope ?? 'unit') : (u.data_scope ?? 'unit');
  const moduleAccess = input?.moduleAccess !== undefined
    ? sanitizeModuleAccess(actor, input.moduleAccess)
    : safeJsonParse(u.module_access_json, {});
  const customPerms = input?.customPermissions !== undefined
    ? sanitizePermissionList(actor, input.customPermissions)
    : safeJsonParse(u.custom_permissions_json, []);
  const revokedPerms = input?.revokedPermissions !== undefined
    ? (Array.isArray(input.revokedPermissions) ? [...new Set(input.revokedPermissions.map(String).filter((p) => ASSIGNABLE.has(p)))] : [])
    : safeJsonParse(u.revoked_permissions_json, []);
  const allowedViews = input?.allowedViews !== undefined
    ? sanitizeAllowedViews(input.allowedViews)
    : safeJsonParse(u.allowed_views_json, []);
  const hiddenTabs = input?.hiddenTabs !== undefined ? sanitizeHiddenTabs(input.hiddenTabs) : safeJsonParse(u.hidden_tabs_json, []);

  const roleChanged = (rk.role_key ?? rk.role) !== cur;
  const permsChanged =
    roleChanged ||
    unit !== u.unit_id ||
    accessMode !== (u.access_mode ?? 'role') ||
    JSON.stringify(moduleAccess) !== (u.module_access_json ?? '{}') ||
    JSON.stringify(customPerms) !== (u.custom_permissions_json ?? '[]') ||
    JSON.stringify(revokedPerms) !== (u.revoked_permissions_json ?? '[]');

  tx(db, () => {
    db.prepare(`
      UPDATE users
      SET display_name = ?, role = ?, role_key = ?, unit_id = ?, staff_kind = ?, job_title = ?,
          access_mode = ?, data_scope = ?, module_access_json = ?,
          custom_permissions_json = ?, revoked_permissions_json = ?, allowed_views_json = ?, hidden_tabs_json = ?
      WHERE id = ?
    `).run(
      name,
      rk.role,
      rk.role_key,
      unit,
      kind,
      title,
      accessMode,
      dataScope,
      JSON.stringify(moduleAccess),
      JSON.stringify(customPerms),
      JSON.stringify(revokedPerms),
      JSON.stringify(allowedViews),
      JSON.stringify(hiddenTabs),
      u.id
    );
    if (input?.scopeFaculty !== undefined || input?.dataScope !== undefined) setScopeFaculty(db, u.id, dataScope, input?.scopeFaculty ?? u.scope_faculty);
    // لا نُنهي جلسة المستخدم عند تغيير صلاحياته: تُحسب الصلاحيات من قاعدة البيانات عند كل طلب وكاش الجلسات يُمسح تلقائياً
    // عند أي تعديل على users/roles/org_units، فيسري التغيير فوراً (رفعاً أو خفضاً) دون إجبار أحد على تسجيل الدخول من جديد.
    audit(db, actor, permsChanged ? `تحديث صلاحيات وحساب موظف (${rk.role_key ?? rk.role} · ${accessMode})` : 'تعديل حساب إداري', u.username, ip);
  });
  return { ok: true, user: view(db, db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) };
}

export function setUserActive({ db }, actor, id, active, ip) {
  const u = target(db, actor, id), on = !!active;
  if (!on) {
    if (u.id === actor.id) throw bad('لا يمكنك تعطيل حسابك بنفسك.', 'bad_request');
    if (u.role === 'admin' && !u.role_key && u.active && activeAdmins(db) <= 1) throw bad('لا يمكن تعطيل آخر مدير فعّال.', 'bad_request');
  }
  tx(db, () => {
    db.prepare('UPDATE users SET active = ?, failed_logins = 0, locked_until = 0 WHERE id = ?').run(on ? 1 : 0, u.id);
    if (!on) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, actor, on ? 'تفعيل حساب' : 'تعطيل حساب', u.username, ip);
  });
  return { ok: true };
}

export async function resetUserPassword({ db, cfg }, actor, id, ip) {
  const u = target(db, actor, id);
  const pw = tempPassword(), hash = await hashPassword(pw, cfg.scryptN);
  tx(db, () => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = 0 WHERE id = ?').run(hash, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, actor, 'إعادة تعيين كلمة مرور مستخدم', u.username, ip);
  });
  return { credentials: { username: u.username, tempPassword: pw } };
}

export function deleteUser({ db }, actor, id, ip) {
  const u = target(db, actor, id);
  if (u.id === actor.id) throw bad('لا يمكنك حذف حسابك بنفسك.', 'bad_request');
  if (u.role === 'admin' && !u.role_key && u.active && activeAdmins(db) <= 1) throw bad('لا يمكن حذف آخر مدير فعّال.', 'bad_request');
  try {
    tx(db, () => {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      audit(db, actor, 'حذف حساب إداري', u.username, ip);
    });
  } catch (e) {
    if (/FOREIGN KEY/i.test(String(e?.message))) throw new HttpError(409, 'الحساب مرتبط بسجلات (طلبات أو علامات أو أخبار)؛ عطّله بدلاً من حذفه.', 'conflict');
    throw e;
  }
  return { ok: true };
}

export { ASSIGNABLE };
