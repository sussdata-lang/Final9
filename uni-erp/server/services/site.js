import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { getSetting, saveSettings } from './settings.js';

// مفتاح التخزين ← [اسم الخاصية، التسمية، الحد الأقصى للطول]
const FIELDS = {
  university_name: ['university', 'اسم الجامعة', 120],
  portal_title: ['title', 'اسم البوابة', 60],
  department_name: ['department', 'اسم القسم', 80],
};

// حقول ترويسة المطبوعات: تُحفظ عبر سجل الإعدادات (تحقق وتدقيق موحّدان)؛ والفارغ يُخفي السطر
const HEAD_FIELDS = { country: 'institution.country', ministry: 'institution.ministry', countryEn: 'institution.country_en', ministryEn: 'institution.ministry_en', universityEn: 'institution.university_en' };

export function getSite({ db, cfg }) {
  return {
    university: getSetting(db, 'institution.university', cfg.universityName), title: getSetting(db, 'institution.portal'), department: getSetting(db, 'institution.department'),
    // ترويسة المطبوعات (السندات والنماذج): تُقرأ عند كل طباعة فيظهر أي تعديل فوراً
    country: getSetting(db, 'institution.country'), ministry: getSetting(db, 'institution.ministry'),
    countryEn: getSetting(db, 'institution.country_en'), ministryEn: getSetting(db, 'institution.ministry_en'), universityEn: getSetting(db, 'institution.university_en'),
  };
}

export function universityName(db, cfg) { return getSetting(db, 'institution.university', cfg.universityName); }

// ترويسة الوثائق: «الجهة الأعلى — القسم» وسطر الدولة (يُحذف الفارغ منهما)
export function headerLines(db) {
  const dep = getSetting(db, 'institution.department'), min = getSetting(db, 'institution.ministry'), country = getSetting(db, 'institution.country');
  return { line: [min, dep].filter(Boolean).join(' — '), corr: [min, 'المراسلات الداخلية'].filter(Boolean).join(' — '), country: [country, min].filter(Boolean).join(' · ') };
}

export function saveSite(deps, actor, input, ip) {
  const { db, cfg } = deps;
  const clean = {};
  const head = {};
  for (const [prop, key] of Object.entries(HEAD_FIELDS)) if (input?.[prop] !== undefined) head[key] = String(input[prop]);
  for (const [key, [prop, label, max]] of Object.entries(FIELDS)) {
    if (input?.[prop] === undefined) continue;
    const v = String(input[prop]).replace(/\s+/g, ' ').trim();
    if (v.length < 2 || v.length > max) throw new HttpError(400, `«${label}» يجب أن يكون بين 2 و${max} حرفاً.`, 'validation');
    if (/[\x00-\x1f<>]/.test(v)) throw new HttpError(400, `«${label}» يحوي رموزاً غير مسموحة.`, 'validation');
    if (prop === 'university' && !/[\u0600-\u06ff]/.test(v)) throw new HttpError(400, '«اسم الجامعة» يجب أن يحوي حروفاً عربية.', 'validation');
    clean[key] = v;
  }
  if (!Object.keys(clean).length && !Object.keys(head).length) throw new HttpError(400, 'لا توجد إعدادات للحفظ.', 'validation');
  if (Object.keys(head).length) saveSettings(deps, actor, { values: head }, ip);
  if (Object.keys(clean).length) tx(db, () => {
    const up = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(clean)) up.run(k, v);
    audit(db, actor, 'تعديل إعدادات الموقع', Object.keys(clean).join(','), ip);
  });
  return getSite({ db, cfg });
}

import { getCachedSettingRaw } from '../cache.js';

export const TRANSCRIPT_TEMPLATES = ['classic', 'modern', 'academic', 'royal'];
export function getTranscriptTemplate(db) {
  const v = getCachedSettingRaw(db, 'transcript_template');
  return TRANSCRIPT_TEMPLATES.includes(v) ? v : 'classic';
}
export function setTranscriptTemplate({ db }, actor, id, ip) {
  if (!TRANSCRIPT_TEMPLATES.includes(id)) throw new HttpError(400, 'نموذج كشف العلامات غير معروف.', 'validation');
  tx(db, () => {
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('transcript_template', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(id);
    audit(db, actor, 'اعتماد نموذج كشف العلامات', id, ip);
  });
  return id;
}
