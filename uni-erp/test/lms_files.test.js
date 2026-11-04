import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { writeZip } from '../server/lib/zip.js';
import { readPptx } from '../server/lib/pptx.js';

const PW = 'Str0ng-Test-Pass!';
let app, base, adm, stu, reader, plain, dir;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

function pptx() {
  const ns = 'xmlns:p="p" xmlns:a="a" xmlns:r="r"';
  const shape = (x, y, text, extra = '') => `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2400" b="1"${extra}/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  return writeZip([
    { name: 'ppt/presentation.xml', data: `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="x/slide" Target="slides/slide2.xml"/><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/></Relationships>' },
    { name: 'ppt/slides/slide1.xml', data: `<p:sld ${ns}><p:cSld><p:spTree>${shape(100, 200, 'الشريحة &amp; الأولى')}<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>عنوان موروث</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rId5"/></p:blipFill><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>` },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: '<Relationships><Relationship Id="rId5" Type="x/image" Target="../media/image1.png"/><Relationship Id="rId6" Type="x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>' },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `<p:sldLayout ${ns}><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="111" y="222"/><a:ext cx="333" cy="444"/></a:xfrm></p:spPr></p:sp></p:sldLayout>` },
    { name: 'ppt/slides/slide2.xml', data: `<p:sld ${ns}><p:cSld><p:bg><a:srgbClr val="FF0000"/></p:bg><p:spTree>${shape(5, 6, 'الثانية')}</p:spTree></p:cSld></p:sld>` },
    { name: 'ppt/media/image1.png', data: PNG },
  ]);
}

async function call(method, url, { body, cookie, raw, range } = {}) {
  const headers = { ...(cookie ? { Cookie: cookie } : {}), ...(range ? { Range: range } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) };
  const res = await fetch(base + url, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch { /* ثنائي */ }
  return { status: res.status, json, buf, headers: res.headers };
}

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-lms-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), add = (u, role, perms = null, no = null) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, student_no, created_at) VALUES (?,?,?,?,?,?,?,?)').run(u, u, hash, role, perms ? 'custom' : 'role', perms ? JSON.stringify(perms) : null, no, Date.now());
  add('adm', 'admin'); add('stu', 'student', null, 'S-1'); add('reader', 'staff', ['lms_lib:view']); add('plain', 'staff', ['staffatt:self']);
  const login = async (username) => (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) })).headers.get('set-cookie').split(';')[0];
  adm = await login('adm'); stu = await login('stu'); reader = await login('reader'); plain = await login('plain');
});
test.after(async () => { if (app) await app.close(); });

const newLecture = async (title = 'محاضرة') => (await call('POST', '/api/lms/lectures', { cookie: adm, body: { course_code: 'C-1', course_name: 'مقرر', title } })).json.id;

test('قراءة pptx: الترتيب من العرض، والنص يُفك، والموضع يورث من التخطيط، والصورة تُستخرج', () => {
  const deck = readPptx(pptx());
  assert.equal(deck.width, 9144000);
  assert.equal(deck.slides.length, 2);
  const [first, second] = deck.slides;
  assert.equal(first.items[0].paragraphs[0].runs[0].text, 'الشريحة & الأولى');
  assert.equal(first.items[0].paragraphs[0].align, 'ctr');
  assert.deepEqual(first.items[0].paragraphs[0].runs[0].size, 2400);
  assert.deepEqual([first.items[1].x, first.items[1].title], [111, true], 'الموضع من التخطيط');
  assert.equal(first.items[2].media, 'image1.png');
  assert.equal(second.bg, 'FF0000');
  assert.equal(deck.media[0].name, 'image1.png');
  assert.throws(() => readPptx(writeZip([{ name: 'a.txt', data: 'x' }])), /pptx/);
});

test('المرفقات: النوع من البايتات، والحدود والصلاحيات، والعرض بكل صيغة', async () => {
  const id = await newLecture();
  const up = (name, raw, cookie = adm) => call('POST', `/api/lms/lectures/${id}/files?name=${encodeURIComponent(name)}`, { cookie, raw });
  const pdfBytes = Buffer.from('%PDF-1.4\n%test\n'), mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(40, 1)]);
  assert.equal((await up('a.pdf', pdfBytes, stu)).status, 403, 'الطالب لا يرفع');
  assert.equal((await up('a.pdf', pdfBytes, reader)).status, 403, 'القراءة لا تكفي للرفع');
  assert.match((await up('x.exe', Buffer.from('MZ this is not allowed at all'))).json.message, /غير مدعوم/);
  assert.match((await up('old.ppt', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(20)]))).json.message, /pptx/);
  assert.match((await up('fake.pptx', writeZip([{ name: 'a.txt', data: 'x' }]))).json.message, /pptx/);
  assert.equal((await call('POST', '/api/lms/lectures/999999/files?name=a.pdf', { cookie: adm, raw: pdfBytes })).status, 404);

  const pdf = await up('ملف عربي.pdf', pdfBytes), video = await up('v.mp4', mp4), slides = await up('s.pptx', pptx());
  assert.deepEqual([pdf.status, video.status, slides.status], [201, 201, 201], JSON.stringify(pdf.json));
  assert.deepEqual([pdf.json.kind, video.json.kind, slides.json.kind], ['pdf', 'video', 'slides']);

  const open = await call('GET', `/api/lms/files/${pdf.json.id}`, { cookie: stu });
  assert.equal(open.status, 200);
  assert.equal(open.headers.get('content-type'), 'application/pdf');
  assert.match(open.headers.get('content-disposition'), /^inline/);
  assert.equal(open.headers.get('x-content-type-options'), 'nosniff');
  const part = await call('GET', `/api/lms/files/${video.json.id}`, { cookie: stu, range: 'bytes=4-11' });
  assert.equal(part.status, 206, 'الفيديو يقبل التقديم');
  assert.equal(part.buf.toString(), 'ftypmp42');
  const deck = await call('GET', `/api/lms/files/${slides.json.id}/slides`, { cookie: reader });
  assert.equal(deck.json.slides.length, 2);
  const img = await call('GET', `/api/lms/files/${slides.json.id}/media/image1.png`, { cookie: stu });
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await call('GET', `/api/lms/files/${slides.json.id}/media/${encodeURIComponent('../../t.db')}`, { cookie: adm })).status, 403, 'جدار الحماية يمنع الخروج من المجلد');
  assert.equal((await call('GET', `/api/lms/files/${slides.json.id}/media/t.db`, { cookie: adm })).status, 404, 'والخدمة لا تقدم غير الصور');
  assert.equal((await call('GET', `/api/lms/files/${pdf.json.id}`)).status, 401);
  assert.equal((await call('GET', `/api/lms/files/${pdf.json.id}`, { cookie: plain })).status, 403);

  const row = (await call('GET', '/api/lms/overview', { cookie: stu })).json.lectures.find((l) => l.id === id);
  assert.equal(row.files.length, 3);
  assert.ok(!('file' in row.files[0]), 'اسم الملف على القرص لا يخرج');
  assert.ok(Number(row.views_count) >= 2, 'المشاهدات تُعد');
});

test('الطالب لا يصل إلى مرفق محاضرة غير منشورة، والحذف يزيل الملفات', async () => {
  const id = await newLecture('مخفية');
  const f = await call('POST', `/api/lms/lectures/${id}/files?name=s.pptx`, { cookie: adm, raw: pptx() });
  const stored = app.db.prepare('SELECT file FROM lms_lecture_files WHERE id = ?').get(f.json.id).file;
  const onDisk = () => fs.existsSync(path.join(dir, 'up', 'lms', stored));
  assert.ok(onDisk());
  app.db.prepare('UPDATE lms_lectures SET published = 0 WHERE id = ?').run(id);
  assert.equal((await call('GET', `/api/lms/files/${f.json.id}`, { cookie: stu })).status, 404);
  assert.ok(!(await call('GET', '/api/lms/overview', { cookie: stu })).json.lectures.some((l) => l.id === id));
  assert.equal((await call('GET', `/api/lms/files/${f.json.id}`, { cookie: reader })).status, 200, 'الموظف يراها');
  assert.equal((await call('DELETE', `/api/lms/files/${f.json.id}`, { cookie: stu })).status, 403);
  assert.equal((await call('DELETE', `/api/lms/lectures/${id}`, { cookie: adm })).status, 200);
  assert.ok(!onDisk(), 'حذف المحاضرة يزيل مرفقاتها');
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM lms_lecture_files WHERE lecture_id = ?').get(id).c), 0);
});
