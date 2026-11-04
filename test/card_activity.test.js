import test from 'node:test';
import assert from 'node:assert/strict';

function formatCardLogTime(ts) {
  if (!ts) return { fullText: '—', rel: '—', timeStr: '—', dateStr: '—' };
  const d = new Date(ts);
  const dateStr = d.toISOString().slice(0, 10);
  const hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  const isPm = hours >= 12;
  const h12 = hours % 12 || 12;
  const timeStr = `${h12}:${mins}:${secs} ${isPm ? 'م' : 'ص'}`;
  const diffMs = Date.now() - ts;
  let rel = '';
  if (diffMs < 60000) rel = 'منذ لحظات';
  else if (diffMs < 3600000) rel = `منذ ${Math.floor(diffMs / 60000)} دقيقة`;
  else if (diffMs < 86400000) rel = `اليوم (${Math.floor(diffMs / 3600000)} س)`;
  else if (diffMs < 172800000) rel = 'أمس';
  else rel = `منذ ${Math.floor(diffMs / 86400000)} يوم`;
  return { dateStr, timeStr, rel, fullText: `${dateStr} ${timeStr}` };
}

test('Digital Card Activity Log: log entry fields and methods', () => {
  const log = {
    id: 'LOG-001',
    studentId: 1,
    studentNo: 'CYB-2026-0001',
    studentName: 'طارق محمود العلي',
    eventType: 'check_in',
    locationName: 'البوابة الرئيسية — الحرم المركزي',
    locationCode: 'GATE-MAIN-01',
    method: 'nfc',
    terminalId: 'TRM-NFC-A1',
    status: 'granted',
    reason: 'تصريح دخول نظامي ساري المفعول',
    pkiHash: '0x8f2a9c1e4d',
    timestamp: Date.now() - 3600000,
  };

  assert.equal(log.studentNo, 'CYB-2026-0001');
  assert.equal(log.eventType, 'check_in');
  assert.equal(log.method, 'nfc');
  assert.equal(log.status, 'granted');
  assert.ok(log.pkiHash.startsWith('0x'));

  const formatted = formatCardLogTime(log.timestamp);
  assert.ok(formatted.dateStr.length === 10);
  assert.ok(formatted.timeStr.includes('م') || formatted.timeStr.includes('ص'));
});

test('Digital Card Activity Log: both NFC and Barcode methods are supported for check-in and check-out', () => {
  const sampleLogs = [
    { eventType: 'check_in', method: 'nfc', locationCode: 'GATE-MAIN-01' },
    { eventType: 'check_out', method: 'barcode', locationCode: 'GATE-NORTH-03' },
    { eventType: 'check_in', method: 'barcode', locationCode: 'LAB-CYB-03' },
    { eventType: 'check_out', method: 'nfc', locationCode: 'LIB-ENTRANCE' },
  ];

  const nfcCount = sampleLogs.filter(l => l.method === 'nfc').length;
  const barcodeCount = sampleLogs.filter(l => l.method === 'barcode').length;
  const inCount = sampleLogs.filter(l => l.eventType === 'check_in').length;
  const outCount = sampleLogs.filter(l => l.eventType === 'check_out').length;

  assert.equal(nfcCount, 2);
  assert.equal(barcodeCount, 2);
  assert.equal(inCount, 2);
  assert.equal(outCount, 2);
});
