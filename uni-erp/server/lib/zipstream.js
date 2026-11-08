// أرشيف ZIP يُكتب مباشرة إلى الرد ملفاً بعد ملف، فلا يُحمَّل في الذاكرة إلا جزء الملف الجاري بثه.
// بلا ضغط: الحلول (PDF وOffice وصور) مضغوطة أصلاً. يدعم ZIP64 حين يتجاوز الأرشيف 4 جيجابايت أو 65535 ملفاً.
import zlib from 'node:zlib';
import { once } from 'node:events';

const LIMIT32 = 0xffffffff, LIMIT16 = 0xffff, UTF8_AND_DESCRIPTOR = 0x0808, FIXED_DOS_TIME = 0x58210000;

// entries: مكرر غير متزامن يعطي { name, open() } حيث open يعيد مصدر أجزاء Buffer
export async function pipeZip(out, entries) {
  let offset = 0;
  const central = [];
  async function write(buf) {
    if (out.destroyed) throw new Error('zip: أُغلق الاتصال');
    offset += buf.length;
    if (!out.write(buf)) await Promise.race([once(out, 'drain'), once(out, 'close')]);
  }
  for await (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'), start = offset, head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(UTF8_AND_DESCRIPTOR, 6); head.writeUInt32LE(FIXED_DOS_TIME, 10); head.writeUInt16LE(name.length, 26);
    await write(head); await write(name);
    let crc = 0, size = 0;
    for await (const chunk of entry.open()) { crc = zlib.crc32(chunk, crc); size += chunk.length; await write(chunk); }
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc >>> 0, 4); descriptor.writeUInt32LE(size, 8); descriptor.writeUInt32LE(size, 12);
    await write(descriptor);
    central.push({ name, crc: crc >>> 0, size, start });
  }
  const dirStart = offset;
  for (const e of central) {
    const big = e.start >= LIMIT32, extra = big ? Buffer.alloc(12) : Buffer.alloc(0), rec = Buffer.alloc(46);
    if (big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(e.start), 4); }
    rec.writeUInt32LE(0x02014b50, 0); rec.writeUInt16LE(45, 4); rec.writeUInt16LE(big ? 45 : 20, 6); rec.writeUInt16LE(UTF8_AND_DESCRIPTOR, 8); rec.writeUInt32LE(FIXED_DOS_TIME, 12);
    rec.writeUInt32LE(e.crc, 16); rec.writeUInt32LE(e.size, 20); rec.writeUInt32LE(e.size, 24); rec.writeUInt16LE(e.name.length, 28); rec.writeUInt16LE(extra.length, 30); rec.writeUInt32LE(big ? LIMIT32 : e.start, 42);
    await write(rec); await write(e.name); if (big) await write(extra);
  }
  const dirSize = offset - dirStart, needs64 = dirStart >= LIMIT32 || dirSize >= LIMIT32 || central.length >= LIMIT16;
  if (needs64) {
    const z = Buffer.alloc(56), loc = Buffer.alloc(20), at = offset;
    z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14); z.writeBigUInt64LE(BigInt(central.length), 24); z.writeBigUInt64LE(BigInt(central.length), 32); z.writeBigUInt64LE(BigInt(dirSize), 40); z.writeBigUInt64LE(BigInt(dirStart), 48);
    loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(at), 8); loc.writeUInt32LE(1, 16);
    await write(z); await write(loc);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Math.min(central.length, LIMIT16), 8); end.writeUInt16LE(Math.min(central.length, LIMIT16), 10); end.writeUInt32LE(Math.min(dirSize, LIMIT32), 12); end.writeUInt32LE(Math.min(dirStart, LIMIT32), 16);
  await write(end);
  out.end();
}
