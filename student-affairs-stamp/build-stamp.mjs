// يولّد ختم شؤون الطلاب الدائري (SVG بلون حبر واحد) ثم يصدّره PNG شفافًا عبر Playwright.
// التشغيل: node build-stamp.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..', 'uni-erp', 'public');
const b64 = (f) => fs.readFileSync(path.join(site, 'fonts', f)).toString('base64');

const INKS = { green: '#0A4F43', blue: '#1D3A8A' };
const TEXT = {
  top: 'الجامعة السورية للعلوم الأمنية',
  bottom: 'SYRIAN UNIVERSITY FOR SECURITY SCIENCES',
  dept: 'شؤون الطلاب',
  deptEn: 'STUDENT AFFAIRS',
};

// الشعار نفسه داخل الختم، بحجم وموضع محددين
function crest(x, y, w, h, goldId) {
  const src = fs.readFileSync(path.join(site, 'brand', 'crest.svg'), 'utf8');
  // النسر وحقله والنجوم صور نقطية: يُفصل ذهبيّها عن الحقل الأخضر قبل تحويل الشعار كله إلى حبر
  return src.replace(/<svg\b[^>]*>/, `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 200 240">`)
    .replace(/<image /g, `<image filter="url(#${goldId})" `);
}

const C = 300;
// قوس علوي يُقرأ من اليمين إلى اليسار للعربية، وقوس سفلي يُقرأ من اليسار إلى اليمين
const arcTop = (r) => `M ${C - r} ${C} A ${r} ${r} 0 0 1 ${C + r} ${C}`;
const arcBottom = (r) => `M ${C - r} ${C} A ${r} ${r} 0 0 0 ${C + r} ${C}`;
const star = (cx, cy, r) => {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${p.join(' ')}"/>`;
};
// حلقة نقاط زخرفية بين الإطارين
const dots = (r, n, size) => Array.from({ length: n }, (_, i) => {
  const a = (i * 2 * Math.PI) / n;
  return `<circle cx="${(C + r * Math.cos(a)).toFixed(2)}" cy="${(C + r * Math.sin(a)).toFixed(2)}" r="${size}"/>`;
}).join('');

function stamp(ink, name) {
  const id = (k) => `st-${k}-${name}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="ختم شؤون الطلاب — الجامعة السورية للعلوم الأمنية">
<title>ختم شؤون الطلاب — الجامعة السورية للعلوم الأمنية</title>
<defs>
  <style>
    @font-face { font-family: 'StMohanad'; src: url(data:font/ttf;base64,${b64('AL-Mohanad-Bold-1.ttf')}) format('truetype'); font-weight: 700; }
    @font-face { font-family: 'StAmiri'; src: url(data:font/woff2;base64,${b64('tr-amiri-latin-700.woff2')}) format('woff2'); font-weight: 700; }
    .ar { font-family: 'StMohanad', 'Traditional Arabic', serif; font-weight: 700; }
    .en { font-family: 'StAmiri', 'Times New Roman', serif; font-weight: 700; }
  </style>
  <path id="${id('top')}" d="${arcTop(232)}"/>
  <path id="${id('bottom')}" d="${arcBottom(237)}"/>
  <!-- يحوّل الشعار الملوّن إلى حبر واحد: الذهبي (النسر والنجوم) والإطار الداكن حبر، والحقل الأخضر والأبيض فراغ.
       القيمة = العتمة + 4 × (الأحمر − الأزرق)، فتنخفض في الأخضر وترتفع في الذهبي، ثم تُقطع عند النصف -->
  <filter id="${id('ink')}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.7874 -0.7152 -4.0722 0 1" result="dark"/>
    <feComposite in="dark" in2="SourceAlpha" operator="in" result="mask"/>
    <feComponentTransfer in="mask" result="cut"><feFuncA type="discrete" tableValues="0 0 1 1"/></feComponentTransfer>
    <feFlood flood-color="${ink}"/>
    <feComposite in2="cut" operator="in"/>
  </filter>
  <!-- للصور النقطية: الذهبي (الأحمر أعلى من الأزرق بوضوح، حتى في الظل) أسود، والأخضر شفاف -->
  <filter id="${id('gold')}" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  6 0 -6 0 -0.3" result="g"/>
    <feComposite in="g" in2="SourceAlpha" operator="in" result="gm"/>
    <feComponentTransfer in="gm" result="gc"><feFuncA type="discrete" tableValues="0 0 1 1"/></feComponentTransfer>
    <feFlood flood-color="#000"/>
    <feComposite in2="gc" operator="in"/>
  </filter>
</defs>
<g fill="none" stroke="${ink}">
  <circle cx="${C}" cy="${C}" r="290" stroke-width="8"/>
  <circle cx="${C}" cy="${C}" r="279" stroke-width="2"/>
  <circle cx="${C}" cy="${C}" r="206" stroke-width="2"/>
  <circle cx="${C}" cy="${C}" r="197" stroke-width="5"/>
</g>
<g fill="${ink}">
  ${dots(273, 120, 1.6)}
  ${dots(211, 96, 1.4)}
  ${star(C - 243, C, 13)}
  ${star(C + 243, C, 13)}
  <text class="ar" font-size="46" text-anchor="middle" direction="rtl"><textPath href="#${id('top')}" startOffset="50%">${TEXT.top}</textPath></text>
  <text class="en" font-size="21.5" letter-spacing="2.2" text-anchor="middle" dominant-baseline="hanging"><textPath href="#${id('bottom')}" startOffset="50%">${TEXT.bottom}</textPath></text>
</g>
<g filter="url(#${id('ink')})">${crest(216, 104, 168, 202, id('gold'))}</g>
<g fill="${ink}" text-anchor="middle">
  <rect x="166" y="318" width="268" height="2.5"/>
  <text class="ar" x="${C}" y="378" font-size="60" direction="rtl">${TEXT.dept}</text>
  <text class="en" x="${C}" y="414" font-size="19" letter-spacing="5">${TEXT.deptEn}</text>
  <rect x="196" y="430" width="208" height="2"/>
  ${star(C, 460, 9)}
  ${star(C - 32, 462, 6)}
  ${star(C + 32, 462, 6)}
</g>
</svg>
`;
}

fs.mkdirSync(path.join(here, 'png'), { recursive: true });
for (const [name, ink] of Object.entries(INKS)) fs.writeFileSync(path.join(here, `stamp-${name}.svg`), stamp(ink, name));

// التصدير: Playwright من مسار البيئة أو الحزمة المثبتة
const spec = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(spec);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 4 });
for (const name of Object.keys(INKS)) {
  const svg = fs.readFileSync(path.join(here, `stamp-${name}.svg`), 'utf8');
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.locator('svg').first().screenshot({ path: path.join(here, 'png', `stamp-${name}-2400.png`), omitBackground: true });
}
await browser.close();
console.log('done');
