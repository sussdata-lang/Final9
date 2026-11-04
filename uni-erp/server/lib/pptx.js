// قراءة عرض PowerPoint (pptx) إلى شرائح نصوص وصور تُرسم في المتصفح، بلا خدمة خارجية ولا مكتبة.
// الموضع والحجم بوحدات EMU كما في الملف؛ الأشكال المعقدة والحركات لا تُعرض.
import { readZip } from './zip.js';

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

function relsOf(z, file) {
  const out = new Map(), xml = z.get(file)?.toString('utf8') ?? '';
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) out.set(attr(m[0], 'Id'), { target: attr(m[0], 'Target'), type: attr(m[0], 'Type') ?? '' });
  return out;
}
// يحوّل مسار الهدف النسبي (../media/a.png) إلى مساره داخل الأرشيف
function resolve(baseFile, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseFile.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}
const relsPath = (file) => { const i = file.lastIndexOf('/'); return `${file.slice(0, i)}/_rels/${file.slice(i + 1)}.rels`; };
function boxOf(xml) {
  const off = /<a:off\b[^>]*>/.exec(xml), ext = /<a:ext\b[^>]*\bcx="[^>]*>/.exec(xml);
  if (!off || !ext) return null;
  return { x: Number(attr(off[0], 'x')), y: Number(attr(off[0], 'y')), w: Number(attr(ext[0], 'cx')), h: Number(attr(ext[0], 'cy')) };
}
function paragraphsOf(xml) {
  const out = [];
  for (const p of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const ppr = /<a:pPr\b[^>]*>/.exec(p[1])?.[0] ?? '', runs = [];
    for (const r of p[1].matchAll(/<a:(?:r|fld)\b[^>]*>([\s\S]*?)<\/a:(?:r|fld)>/g)) {
      const text = /<a:t>([\s\S]*?)<\/a:t>/.exec(r[1]);
      if (!text) continue;
      const rpr = /<a:rPr\b[^>]*>/.exec(r[1])?.[0] ?? '', color = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(r[1])?.[1] ?? null;
      runs.push({ text: unesc(text[1]), size: Number(attr(rpr, 'sz')) || null, bold: attr(rpr, 'b') === '1', color });
    }
    if (runs.length) out.push({ align: attr(ppr, 'algn'), level: Number(attr(ppr, 'lvl')) || 0, runs });
  }
  return out;
}
const SHAPES = /<p:(sp|pic|graphicFrame)\b[\s\S]*?<\/p:\1>/g;
const placeholderOf = (xml) => { const ph = /<p:ph\b[^>]*>/.exec(xml)?.[0]; return ph ? { type: attr(ph, 'type') ?? 'body', idx: attr(ph, 'idx') ?? '' } : null; };

// مواضع الحقول في تخطيط الشريحة: الشكل بلا موضع يرثه منها
function layoutBoxes(z, slideFile) {
  const boxes = new Map(), rels = relsOf(z, relsPath(slideFile));
  for (const r of rels.values()) {
    if (!r.type.endsWith('/slideLayout')) continue;
    const xml = z.get(resolve(slideFile, r.target))?.toString('utf8') ?? '';
    for (const m of xml.matchAll(SHAPES)) { const ph = placeholderOf(m[0]), box = boxOf(m[0]); if (ph && box) { boxes.set(`${ph.type}:${ph.idx}`, box); if (!boxes.has(ph.type)) boxes.set(ph.type, box); } }
  }
  return boxes;
}
function fallbackBox(ph, width, height) {
  const title = ph && /title/i.test(ph.type);
  return title ? { x: width * 0.05, y: height * 0.04, w: width * 0.9, h: height * 0.16 } : { x: width * 0.05, y: height * 0.22, w: width * 0.9, h: height * 0.7 };
}

export function readPptx(buf) {
  const z = readZip(buf, { maxTotal: 300 * 1024 * 1024, maxEntries: 5000 });
  const pres = z.get('ppt/presentation.xml')?.toString('utf8');
  if (!pres) throw new Error('الملف ليس عرض PowerPoint بصيغة pptx.');
  const sz = /<p:sldSz\b[^>]*>/.exec(pres)?.[0] ?? '', width = Number(attr(sz, 'cx')) || 12192000, height = Number(attr(sz, 'cy')) || 6858000;
  const presRels = relsOf(z, 'ppt/_rels/presentation.xml.rels'), media = new Set(), slides = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*>/g)) {
    const rel = presRels.get(attr(m[0], 'r:id'));
    if (!rel) continue;
    const file = resolve('ppt/presentation.xml', rel.target), xml = z.get(file)?.toString('utf8');
    if (!xml) continue;
    const rels = relsOf(z, relsPath(file)), boxes = layoutBoxes(z, file), items = [];
    for (const s of xml.matchAll(SHAPES)) {
      const ph = placeholderOf(s[0]), box = boxOf(s[0]) ?? (ph ? boxes.get(`${ph.type}:${ph.idx}`) ?? boxes.get(ph.type) : null) ?? fallbackBox(ph, width, height);
      if (s[1] === 'pic') {
        const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(s[0])?.[1], target = embed && rels.get(embed)?.target;
        if (!target || !IMAGE.test(target)) continue;
        const name = target.split('/').pop();
        media.add(resolve(file, target));
        items.push({ type: 'image', ...box, media: name });
      } else {
        const paragraphs = paragraphsOf(s[0]);
        if (paragraphs.length) items.push({ type: 'text', ...box, title: !!(ph && /title/i.test(ph.type)), paragraphs });
      }
    }
    const bg = /<p:bg>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(xml)?.[1] ?? null;
    slides.push({ bg, items });
  }
  if (!slides.length) throw new Error('العرض لا يحوي شرائح.');
  return { width, height, slides, media: [...media].map((p) => ({ name: p.split('/').pop(), data: z.get(p) })).filter((x) => x.data) };
}
