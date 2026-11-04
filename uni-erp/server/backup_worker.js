/**
 * backup_worker.js — يجمع النسخة الاحتياطية خارج الخيط الرئيسي
 * قراءة الملفات والضغط والتشفير والكتابة توقف من يخدم المستخدمين لو جرت هناك
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { writeZip } from './lib/zip.js';
import { encrypt } from './lib/backup_crypto.js';

const { dumpPath, extra, signingKey, manifest, passphrase, outPath } = workerData;

const dbBuf = fs.readFileSync(dumpPath);
const files = [{ name: 'database/database.dump', data: dbBuf }];
for (const f of extra) files.push({ name: f.name, data: fs.readFileSync(f.full) });
if (signingKey) files.push({ name: 'signing-key.txt', data: signingKey });
const full = { ...manifest, dbSha256: crypto.createHash('sha256').update(dbBuf).digest('hex'), dbBytes: dbBuf.length, files: files.length };
files.unshift({ name: 'manifest.json', data: JSON.stringify(full, null, 2) });

let out = writeZip(files);
if (passphrase) out = encrypt(out, passphrase);
fs.writeFileSync(outPath, out, { mode: 0o600 });
parentPort.postMessage({ size: out.length, files: files.length });
