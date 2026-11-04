// الأنواع القديمة (الطلاب والمقررات والعلامات والقاعات والطلبات): فحص ← «حفظ» برمز لمرة واحدة أو «إلغاء»، بلا إعادة إرسال الملف.
// كل حفظ يُسجَّل دفعة، والطلاب والعلامات يقبلان التراجع.
import { HttpError } from '../http.js';
import { LEGACY_DEFS, stageFile, readStagedFile, claimStaged, recordLegacyBatch } from './import_engine.js';
import { runImport } from './importer.js';
import { importRequests } from './requestsxl.js';

const bad = (m) => new HttpError(400, m, 'validation');
const isHighLegacy = (def) => def.risk === 'high';
export async function stagedImport(deps, actor, kind, body, ip) {
  const def = LEGACY_DEFS[kind];
  if (!def) throw new HttpError(404, 'نوع استيراد غير معروف.', 'not_found');
  const stageKind = `legacy:${kind}`, tz = body?.tz;
  if (!body?.commit) {
    if (deps.limiter && !deps.limiter.check(`import:${actor.id}`, 60, 60_000)) throw new HttpError(429, 'محاولات استيراد كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
    const res = await runImport(deps, actor, kind, { filename: body?.filename, data: body?.data, commit: false, tz }, ip);
    delete res.changes;
    return { ...res, ...(res.valid ? stageFile(deps, actor, stageKind, body.filename, body.data, res.totalRows) : { stagingToken: null, expiresAt: null }), confirmWord: isHighLegacy(def) ? def.title : null };
  }
  if (isHighLegacy(def) && String(body.confirm ?? '').trim() !== def.title) throw bad(`اكتب «${def.title}» لتأكيد هذا الاستيراد الحساس.`);
  const { st, data } = readStagedFile(deps, actor, stageKind, body.stagingToken);
  // إعادة الفحص: قد تكون البيانات تغيّرت بعد الفحص الأول
  const recheck = await runImport(deps, actor, kind, { filename: st.filename, data, commit: false, tz }, ip);
  if (recheck.errorCount && !body.acceptPartial) throw new HttpError(409, `في الملف ${recheck.errorCount} صف مرفوض؛ صحّحه أو اختر «حفظ الصالح فقط».`, 'has_errors');
  if (!recheck.valid) throw bad('لا توجد صفوف صالحة للحفظ.');
  claimStaged(deps, actor, stageKind, body.stagingToken);
  const res = await runImport(deps, actor, kind, { filename: st.filename, data, commit: true, tz }, ip), { changes = [], ...out } = res;
  const summary = { total: res.total, created: res.created ?? 0, updated: res.updated ?? 0, unchanged: 0, skipped: res.errorCount, sideUpdated: 0 };
  return { ...out, batchId: recordLegacyBatch(deps, actor, kind, st, summary, changes, ip) };
}
export function stagedRequestsImport(deps, actor, code, body, ip) {
  const stageKind = `legacy:reqx:${code}`;
  if (!body?.commit) {
    const res = importRequests(deps, actor, code, { filename: body?.filename, data: body?.data, commit: false }, ip);
    return { ...res, ...(res.valid ? stageFile(deps, actor, stageKind, body.filename, body.data, res.total) : { stagingToken: null, expiresAt: null }) };
  }
  const { st, data } = readStagedFile(deps, actor, stageKind, body.stagingToken);
  const recheck = importRequests(deps, actor, code, { filename: st.filename, data, commit: false }, ip);
  if (recheck.errorCount && !body.acceptPartial) throw new HttpError(409, `في الملف ${recheck.errorCount} صف مرفوض؛ صحّحه أو اختر «حفظ الصالح فقط».`, 'has_errors');
  claimStaged(deps, actor, stageKind, body.stagingToken);
  const res = importRequests(deps, actor, code, { filename: st.filename, data, commit: true }, ip);
  const summary = { total: res.total, created: res.created, updated: 0, unchanged: 0, skipped: res.errorCount, sideUpdated: 0 };
  return { ...res, batchId: recordLegacyBatch(deps, actor, 'reqx', st, summary, [], ip) };
}
