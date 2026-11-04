import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';

test('DevOps Incident Logging & Resolution', async (t) => {
  const db = await openDb(':memory:');

  await t.test('Inserts a new incident report', () => {
    const reportCode = 'INC-TEST-' + Date.now();
    const info = db.prepare(`
      INSERT INTO devops_incident_reports (
        report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(
      reportCode,
      'Code Studio',
      'FILE_SAVE_FAILURE',
      'critical',
      '/src/test.ts',
      'Disk write permission denied on test.ts',
      'Error: EACCES\n    at saveFile (server.ts:120)',
      JSON.stringify({ userId: 'admin', browser: 'Chromium' }),
      Date.now()
    );

    assert.ok(info.lastInsertRowid > 0, 'Row should be inserted');

    const row = db.prepare('SELECT * FROM devops_incident_reports WHERE id = ?').get(info.lastInsertRowid);
    assert.equal(row.report_code, reportCode);
    assert.equal(row.source, 'Code Studio');
    assert.equal(row.event_type, 'FILE_SAVE_FAILURE');
    assert.equal(row.status, 'open');
    assert.equal(row.severity, 'critical');
    assert.equal(row.file_path, '/src/test.ts');
  });

  await t.test('Resolves an incident report with notes and resolver identity', () => {
    const row = db.prepare("SELECT id FROM devops_incident_reports WHERE status = 'open' LIMIT 1").get();
    assert.ok(row, 'Should find at least one open incident');

    const update = db.prepare(`
      UPDATE devops_incident_reports
      SET status = 'resolved',
          resolved_at = ?,
          resolved_by = ?,
          resolution_note = ?
      WHERE id = ?
    `).run(Date.now(), 'مهندس DevOps', 'تم إصلاح أذونات المجلد بنجاح', row.id);

    assert.equal(update.changes, 1);

    const updatedRow = db.prepare('SELECT * FROM devops_incident_reports WHERE id = ?').get(row.id);
    assert.equal(updatedRow.status, 'resolved');
    assert.equal(updatedRow.resolved_by, 'مهندس DevOps');
    assert.equal(updatedRow.resolution_note, 'تم إصلاح أذونات المجلد بنجاح');
    assert.ok(updatedRow.resolved_at > 0);
  });
});
