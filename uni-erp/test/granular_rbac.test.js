import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import {
  PLATFORM_MODULES_MATRIX,
  DEPARTMENT_ROLE_PRESETS,
  resolveEffectivePermissions,
  resolveModulePermissions,
  buildModuleAccessState,
  summarizeOperationCapabilities,
  computeAllowedViews,
} from '../server/permissions.js';

const PW = 'Test#Pass12345';

test('1. Pure Logic: PLATFORM_MODULES_MATRIX covers all 14 platform departments with 5 granular operations', () => {
  assert.equal(PLATFORM_MODULES_MATRIX.length, 14);
  for (const mod of PLATFORM_MODULES_MATRIX) {
    assert.ok(mod.id && mod.title && mod.department);
    for (const op of ['view', 'write', 'edit', 'approve', 'delete']) {
      assert.ok(mod.actions[op], `Module ${mod.id} missing operation ${op}`);
      assert.ok(Array.isArray(mod.actions[op].perms) && mod.actions[op].perms.length > 0);
    }
  }
  assert.ok(DEPARTMENT_ROLE_PRESETS.length >= 10);
});

test('2. Pure Logic: resolveModulePermissions & resolveEffectivePermissions handle custom, hybrid, and revoked permissions', () => {
  const modPerms = resolveModulePermissions({
    finance_accounting: { view: true, write: true, edit: false, approve: false, delete: false },
    hr_integrated: 'read',
  });
  assert.ok(modPerms.includes('finance:read'));
  assert.ok(modPerms.includes('finance:entry'));
  assert.ok(!modPerms.includes('finance:post'));
  assert.ok(modPerms.includes('hr_emp:view'));

  const eff = resolveEffectivePermissions({
    basePermissions: ['student:read', 'student:update'],
    unitPermissions: ['sa_admissions:view', 'sa_admissions:write'],
    accessMode: 'hybrid',
    customPermissions: ['finance:read'],
    revokedPermissions: ['student:update'],
  });
  assert.ok(eff.includes('student:read'));
  assert.ok(eff.includes('sa_admissions:view'));
  assert.ok(eff.includes('finance:read'));
  assert.ok(!eff.includes('student:update'));

  const cap = summarizeOperationCapabilities(eff);
  assert.ok(cap.viewCount >= 3);
  assert.ok(cap.writeCount >= 1);
  const state = buildModuleAccessState(eff);
  assert.equal(state.finance_accounting.view, true);
  assert.equal(state.finance_accounting.approve, false);
});

test('3. Pure Logic: computeAllowedViews respects explicit allowedViews and derives views from permissions', () => {
  // التخصيص يُضيّق ما تتيحه الصلاحيات ولا يوسّعه: «المالية» بلا صلاحيتها لا تظهر
  assert.deepEqual(computeAllowedViews(['student:read'], ['affairs', 'finance'], 'staff'), ['overview', 'guidelines', 'affairs', 'admin']);
  assert.deepEqual(computeAllowedViews(['student:read', 'finance:read'], ['affairs', 'finance'], 'staff'), ['overview', 'guidelines', 'affairs', 'finance', 'admin']);   // desk→overview وverify→admin بعد إعادة تسمية العروض
  assert.deepEqual(computeAllowedViews(['student:read', 'finance:read'], ['finance'], 'staff'), ['overview', 'guidelines', 'finance', 'admin'], 'ولا تظهر شاشة يملكها ولم تُختر');

  const derived = computeAllowedViews(['finance:read', 'hr_emp:view'], [], 'staff');
  assert.ok(derived.includes('finance'));
  assert.ok(derived.includes('payroll'));
});

test('4. Database & API Integration: Create user with custom department permissions, edit matrix, and inherit unit default permissions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-grbac-'));
  const app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const api = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  };

  try {
    const h = await hashPassword(PW, 1024);
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin', 'مدير النظام', h, 'admin', Date.now());
    const loginRes = await api('POST', '/api/auth/login', { body: { username: 'admin', password: PW } });
    assert.equal(loginRes.status, 200);
    const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

    // 1. فحص /api/admin/access والتأكد من وجود modulesMatrix و rolePresets و allViews
    const ov = await api('GET', '/api/admin/access', { cookie: adminCookie });
    assert.equal(ov.status, 200);
    assert.equal(ov.json.modulesMatrix.length, 14);
    assert.ok(ov.json.rolePresets.length >= 10);
    assert.ok(ov.json.allViews.length >= 20);

    // 2. تخصيص صلاحيات افتراضية لقسم «شؤون الطلاب»
    const saUnit = ov.json.units.find((u) => u.name === 'شؤون الطلاب');
    assert.ok(saUnit);
    const updUnit = await api('PUT', `/api/admin/units/${saUnit.id}`, {
      cookie: adminCookie,
      body: {
        defaultPermissions: ['sa_admissions:view', 'sa_advising:view', 'sa_scholarships:view'],
      },
    });
    assert.equal(updUnit.status, 200);

    // 3. تأسيس حساب موظف جديد مع مصفوفة صلاحيات مخصصة ونطاق بيانات وتحديد شاشات
    const createRes = await api('POST', '/api/admin/users', {
      cookie: adminCookie,
      body: {
        username: 'fin_emp1',
        displayName: 'سامر المحاسب المختص',
        role: 'staff',
        unitId: saUnit.id,
        staffKind: 'admin',
        jobTitle: 'محاسب منح ورسوم',
        password: PW,
        accessMode: 'custom',
        dataScope: 'faculty',
        scopeFaculty: app.db.prepare('SELECT faculty FROM programs ORDER BY id LIMIT 1').get().faculty,
        customPermissions: ['finance:read', 'finance:entry', 'finance:fees', 'sa_scholarships:view', 'sa_scholarships:write', 'student:read'],
        allowedViews: ['desk', 'overview', 'finance', 'affairs', 'verify'],
      },
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.json.user.accessMode, 'custom');
    assert.equal(createRes.json.user.dataScope, 'faculty');
    assert.ok(createRes.json.user.effectivePermissions.includes('finance:fees'));
    assert.ok(createRes.json.user.effectivePermissions.includes('sa_scholarships:write'));
    assert.ok(!createRes.json.user.effectivePermissions.includes('student:delete'));

    // 4. تعديل صلاحيات الحساب إلى وضع hybrid مع سحب صلاحية محددة وإضافة صلاحية أخرى
    const editRes = await api('PUT', `/api/admin/users/${createRes.json.id}`, {
      cookie: adminCookie,
      body: {
        accessMode: 'hybrid',
        dataScope: 'all',
        customPermissions: ['procurement:read', 'procurement:request'],
        revokedPermissions: ['student:reset_password'],
      },
    });
    assert.equal(editRes.status, 200);
    // في وضع hybrid يرث صلاحيات الدور (staff) + صلاحيات القسم (saUnit) + customPermissions - revokedPermissions
    assert.ok(editRes.json.user.effectivePermissions.includes('procurement:read'));
    assert.ok(editRes.json.user.effectivePermissions.includes('sa_admissions:view')); // موروثة من القسم!
    assert.ok(!editRes.json.user.effectivePermissions.includes('student:reset_password')); // مسحوبة صراحةً!
  } finally {
    await app.close();
  }
});
