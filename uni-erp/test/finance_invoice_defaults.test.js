import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openDb } from '../server/db.js';
import { createInvoice, invoiceDefaults, saveInvoiceDefaults } from '../server/services/finance/invoices.js';
import { saveSettings } from '../server/services/settings.js';

const admin = { id: 1, role: 'admin', name: 'مدير النظام', display_name: 'مدير النظام', can: () => true };

test('الحسابات الافتراضية للفواتير: الاختيار الافتراضي، والتعديل لاحقًا، والتحقق', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-defaults-'));
  const db = await openDb(path.join(dir, 'test.db'), path.resolve('uni-erp/server/migrations'));
  try {
    const deps = { db, cfg: { scryptN: 1024 } };
    db.prepare("INSERT INTO users (id, username, password_hash, role, display_name, active, created_at) VALUES (1, 'admin', 'x', 'admin', 'مدير النظام', 1, ?)").run(Date.now());
    invoiceDefaults(deps);
    const partyId = Number(db.prepare("INSERT INTO fin_parties (kind, name, created_at) VALUES ('customer', 'جهة', ?) RETURNING id").get(Date.now()).id);
    const make = (kind, extra = {}) => createInvoice(deps, admin, { kind, partyId, lines: [{ description: 'بند', qty: 1, unitPrice: 100 }], ...extra }, '::1');
    const codes = (entryId) => {
      const one = (side) => db.prepare(`SELECT a.code FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND l.${side} > 0`).get(entryId).code;
      return [one('debit'), one('credit')];
    };

    assert.deepEqual(codes(make('sale').entryId), ['1203', '4203'], 'مبيعات الخارج إيرادات متنوعة');
    assert.deepEqual(codes(make('purchase').entryId), ['5401', '2101']);

    const old = make('sale');
    saveInvoiceDefaults(deps, admin, { sale: { counter: '4202' }, purchase: { counter: '5203' } }, '::1');
    assert.deepEqual(codes(make('sale').entryId), ['1203', '4202'], 'التعديل يسري على الجديدة');
    assert.deepEqual(codes(make('purchase').entryId), ['5203', '2101']);
    assert.deepEqual(codes(old.entryId), ['1203', '4203'], 'ولا يغيّر السابقة');

    const other = Number(db.prepare("SELECT id FROM fin_accounts WHERE code = '4103'").get().id);
    assert.deepEqual(codes(make('sale', { counterAccountId: other }).entryId), ['1203', '4103'], 'الاختيار لكل فاتورة يتقدم على الافتراضي');

    assert.throws(() => saveInvoiceDefaults(deps, admin, { sale: { counter: '2101' } }, '::1'), (e) => e.status === 400, 'التزام لا يصلح إيرادًا');
    assert.throws(() => saveInvoiceDefaults(deps, admin, { purchase: { settle: '5401' } }, '::1'), (e) => e.status === 400, 'مصروف لا يصلح حساب مورد');
    assert.throws(() => saveInvoiceDefaults(deps, admin, { sale: { settle: '99999' } }, '::1'), (e) => e.status === 400, 'حساب غير موجود');
    assert.throws(() => saveInvoiceDefaults(deps, admin, { sale: { counter: '42' } }, '::1'), (e) => e.status === 400, 'حساب أب غير نهائي');
    assert.equal(invoiceDefaults(deps).sale.counter.code, '4202', 'الرفض لا يغيّر شيئًا');

    // رمز خاطئ كُتب من الإعدادات العامة يصل إلى الموظف برسالة، ولا يُنشئ فاتورة
    saveSettings(deps, admin, { values: { 'finance.invoice_sale_counter': '77777' } }, '::1');
    assert.equal(invoiceDefaults(deps).sale.counter.valid, false);
    const before = Number(db.prepare('SELECT COUNT(*) c FROM fin_invoices').get().c);
    assert.throws(() => make('sale'), (e) => e.status === 409 && /إعدادات الفواتير/.test(e.message));
    assert.equal(Number(db.prepare('SELECT COUNT(*) c FROM fin_invoices').get().c), before);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
