import { monitorEventLoopDelay } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { log } from './lib/logger.js';
import { wafMiddleware, getWafStats, unbanIp } from './waf.js';
import { checkTieredRateLimit } from './security.js';

export class HttpError extends Error {
  constructor(status, message, code = 'error', field = undefined) { super(message); this.status = status; this.code = code; this.field = field; }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

// الخطوط TTF غير مضغوطة أصلاً (woff2 مضغوط مسبقاً فيُستثنى) والضغط يقلّص حجمها عادةً بنسبة 40–60%
export const COMPRESSIBLE_EXT = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.json', '.webmanifest', '.ttf', '.otf', '.xml', '.txt', '.map']);
const staticRamCache = new Map();

export function invalidateStaticRamCache() {
  staticRamCache.clear();
}

// ترويسات أمنية: لا سكربتات إلا من الموقع نفسه، ولا تضمين في إطارات، ولا تخمين لأنواع الملفات
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' https:; frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};

export function originAllowed(cfg, req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === 'null') return false;
  let host; try { host = new URL(origin).host; } catch { return false; }
  const allowed = new Set([req.headers.host]);
  if (cfg.publicUrl) { try { allowed.add(new URL(cfg.publicUrl).host); } catch { /* PUBLIC_URL غير صالح يُتجاهل */ } }
  return allowed.has(host);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class Router {
  constructor() {
    this.routes = [];
    this.exactRoutes = new Map();
  }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    const routeObj = { method, re, keys, handler, opts };
    this.routes.push(routeObj);
    if (keys.length === 0) {
      const cleanPath = pattern.endsWith('/') && pattern.length > 1 ? pattern.slice(0, -1) : pattern;
      let byMethod = this.exactRoutes.get(cleanPath);
      if (!byMethod) {
        byMethod = new Map();
        this.exactRoutes.set(cleanPath, byMethod);
      }
      byMethod.set(method, routeObj);
    }
  }
  match(method, pathname) {
    const cleanPath = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
    const exactByMethod = this.exactRoutes.get(cleanPath);
    if (exactByMethod) {
      const exactRoute = exactByMethod.get(method);
      if (exactRoute) return { route: exactRoute, params: {} };
      return { route: null, pathMatched: true };
    }
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return { route: null, pathMatched };
  }
}

async function readRaw(req, limit) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'حجم الملف أكبر من المسموح.', 'too_large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

async function readBody(req, limit) {
  const chunks = []; let size = 0;
  const slow = setTimeout(() => req.destroy(), 30_000); slow.unref();
  try {
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, 'حجم الطلب أكبر من المسموح.', 'too_large');
      chunks.push(c);
    }
  } finally { clearTimeout(slow); }
  if (!size) return {};
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'يُقبل JSON فقط.', 'bad_content_type');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'JSON غير صالح.', 'bad_json'); }
}

const ASYNC_COMPRESS_CHARS = 256 * 1024;
export function sendJson(res, status, obj, headers = {}, req = null) {
  const bodyStr = JSON.stringify(obj);
  const acceptEncoding = req && req.headers ? String(req.headers['accept-encoding'] || '') : '';
  if (bodyStr.length > ASYNC_COMPRESS_CHARS && /\bbr\b/.test(acceptEncoding)) {
    const raw = Buffer.from(bodyStr, 'utf8');
    zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3 } }, (err, br) => {
      const common = { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Accept-Encoding', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers };
      if (err) { res.writeHead(status, { ...common, 'Content-Length': raw.length }); return res.end(raw); }
      res.writeHead(status, { ...common, 'Content-Encoding': 'br', 'Content-Length': br.length });
      res.end(br);
    });
    return;
  }
  if (bodyStr.length > 1536) {
    if (/\bbr\b/.test(acceptEncoding)) {
      const br = zlib.brotliCompressSync(Buffer.from(bodyStr, 'utf8'), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3 } });
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'br', 'Content-Length': br.length, 'Vary': 'Accept-Encoding', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
      res.end(br);
      return;
    }
    if (acceptEncoding.includes('gzip')) {
      const gz = zlib.gzipSync(Buffer.from(bodyStr, 'utf8'), { level: 1 });
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': gz.length, 'Vary': 'Accept-Encoding', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
      res.end(gz);
      return;
    }
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(bodyStr);
}

function serveStatic(cfg, pathname, req, res) {
  let rel = (pathname === '/' || pathname === '/erp' || pathname === '/erp/') ? '/index.html' : pathname;
  const file = path.normalize(path.join(cfg.publicDir, rel));
  if (!file.startsWith(cfg.publicDir + path.sep)) return false;

  let st;
  try {
    st = fs.statSync(file);
    if (!st.isFile()) return false;
  } catch {
    return false;
  }

  const ext = path.extname(file);
  if (ext === '.br' || ext === '.gz') return false;                       // ملفات الضغط المسبق تُقدَّم عبر الملف الأصلي فقط
  const mime = MIME[ext] ?? 'application/octet-stream';
  let entry = staticRamCache.get(file);
  if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
    const raw = fs.readFileSync(file);
    const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
    const etag = `"${hash}"`;
    // نفضّل نسخة .br/.gz المولَّدة وقت البناء (scripts/precompress.js) إن كانت أحدث من الأصل؛ وإلا نضغط مرة واحدة ونخزّن في الذاكرة
    const pre = (suffix) => { try { const ps = fs.statSync(file + suffix); return ps.mtimeMs >= st.mtimeMs ? fs.readFileSync(file + suffix) : null; } catch { return null; } };
    const compressible = COMPRESSIBLE_EXT.has(ext) && raw.length > 512;
    const gzipped = compressible ? (pre('.gz') ?? zlib.gzipSync(raw, { level: 9 })) : null;
    const brotli = compressible ? (pre('.br') ?? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })) : null;
    entry = { mtimeMs: st.mtimeMs, size: st.size, raw, gzipped, brotli, etag, mime };
    staticRamCache.set(file, entry);
  }

  // ملفات الخطوط والأيقونات الثابتة: تخزين طويل، بينما ملفات JS/CSS تتحقق عبر ETag لضمان ظهور التحديثات فور إعادة النشر
  const isImmutableFont = /\.(ttf|woff2)$/.test(ext);
  const versioned = /\.(js|css)$/.test(ext) && /[?&]v=/.test(req.url || '');
  const cacheControl = isImmutableFont
    ? 'public, max-age=86400, stale-while-revalidate=3600'
    : versioned ? 'public, max-age=86400' : 'no-cache, must-revalidate';

  const staticSecHeaders = rel.startsWith('/archify/')
    ? {
        ...SECURITY_HEADERS,
        'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; frame-ancestors 'self'",
      }
    : SECURITY_HEADERS;

  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, { ETag: entry.etag, 'Cache-Control': cacheControl, ...staticSecHeaders });
    res.end();
    return true;
  }

  const acceptEncStatic = String(req.headers['accept-encoding'] || '');
  if (entry.brotli && /\bbr\b/.test(acceptEncStatic)) {
    res.writeHead(200, {
      'Content-Type': entry.mime, 'Content-Encoding': 'br',
      'Content-Length': entry.brotli.length, 'Vary': 'Accept-Encoding',
      'ETag': entry.etag, 'Cache-Control': cacheControl, ...staticSecHeaders,
    });
    res.end(entry.brotli);
    return true;
  }
  if (entry.gzipped && acceptEncStatic.includes('gzip')) {
    res.writeHead(200, {
      'Content-Type': entry.mime, 'Content-Encoding': 'gzip',
      'Content-Length': entry.gzipped.length, 'Vary': 'Accept-Encoding',
      'ETag': entry.etag, 'Cache-Control': cacheControl, ...staticSecHeaders,
    });
    res.end(entry.gzipped);
    return true;
  }

  res.writeHead(200, {
    'Content-Type': entry.mime,
    'Content-Length': entry.raw.length,
    'ETag': entry.etag,
    'Cache-Control': cacheControl,
    ...staticSecHeaders,
  });
  res.end(entry.raw);
  return true;
}

const httpTelemetry = {
  totalRequests: 0,
  totalWriteRequests: 0,
  recentLatenciesMs: [],
};

// تأخر حلقة الأحداث والذاكرة: كل دقيقة، ويُسجَّل التوقف الطويل لمقارنته بأوقات الشكاوى
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
let lastLoop = { p50Ms: 0, p99Ms: 0, maxMs: 0 };
const LOOP_STALL_WARN_MS = 1000;
export function startLoopWatch() {
  loopDelay.enable();
  const t = setInterval(() => {
    const ms = (v) => Math.round(v / 1e6);
    lastLoop = { p50Ms: ms(loopDelay.percentile(50)), p99Ms: ms(loopDelay.percentile(99)), maxMs: ms(loopDelay.max) };
    loopDelay.reset();
    if (lastLoop.maxMs >= LOOP_STALL_WARN_MS) log.warn(`event loop stall: max ${lastLoop.maxMs}ms, p99 ${lastLoop.p99Ms}ms, rss ${Math.round(process.memoryUsage().rss / 1048576)}MB`);
  }, 60_000);
  t.unref();
  return () => { clearInterval(t); loopDelay.disable(); };
}

export function getHttpTelemetry() {
  const arr = httpTelemetry.recentLatenciesMs.slice().sort((a, b) => a - b);
  const pick = (p) => (arr.length ? Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] * 100) / 100 : 0.4);
  return {
    eventLoop: lastLoop,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    totalRequests: httpTelemetry.totalRequests,
    totalWriteRequests: httpTelemetry.totalWriteRequests,
    staticCachedFiles: staticRamCache.size,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    p99Ms: pick(0.99),
  };
}

// Magic-Bytes Validator
const EXEC_MAGIC = [[0x4D,0x5A],[0x7F,0x45,0x4C,0x46],[0xCA,0xFE,0xBA,0xBE],[0x23,0x21]];
const FILE_MAGIC = {
  'application/pdf': [[0x25,0x50,0x44,0x46]],
  'image/jpeg': [[0xFF,0xD8,0xFF]],
  'image/png': [[0x89,0x50,0x4E,0x47]],
  'image/gif': [[0x47,0x49,0x46,0x38]],
  'application/zip': [[0x50,0x4B,0x03,0x04],[0x50,0x4B,0x05,0x06]],
};
export function validateFileMagicBytes(buffer, declaredMime) {
  for (const sig of EXEC_MAGIC) if (sig.every((b,i) => buffer[i] === b)) return { valid: false, reason: 'executable_file' };
  const svgLike = declaredMime?.includes('svg') || buffer.slice(0,5).toString().includes('<svg');
  if (svgLike && /javascript|<script|onload|onerror/i.test(buffer.slice(0,2000).toString())) return { valid: false, reason: 'svg_with_js' };
  const expected = FILE_MAGIC[declaredMime];
  if (!expected) return { valid: true };
  return expected.some((sig) => sig.every((b,i) => buffer[i] === b)) ? { valid: true } : { valid: false, reason: 'magic_bytes_mismatch' };
}

export { getWafStats, unbanIp };

const _waf = wafMiddleware();

export function makeHandler({ cfg, router, getUser }) {
  const waf = wafMiddleware(cfg);
  return async (req, res) => {
    const t0 = performance.now();
    const url = new URL(req.url, 'http://x');
    const xff = cfg.trustProxy && req.headers['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const ip = (xff.length ? xff[xff.length - 1] : null) || req.socket?.remoteAddress || '127.0.0.1';
    try { Object.defineProperty(req, 'ip', { value: ip, writable: true, configurable: true }); } catch {}
    try {
      // --- WAF ---
      let wafBlocked = false;
      await new Promise((resolve) => waf(req, res, () => { resolve(); }));
      if (res.writableEnded) return; // WAF حظر الطلب

      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'الطريقة غير مسموحة.');
        // الخرائط المعمارية للموظفين فقط
        if (url.pathname.startsWith('/archify/')) { const viewer = getUser(parseCookies(req.headers.cookie).sid); if (!viewer || viewer.role === 'student') throw new HttpError(404, 'غير موجود.', 'not_found'); }
        if (serveStatic(cfg, url.pathname, req, res)) return;
        throw new HttpError(404, 'غير موجود.', 'not_found');
      }
      httpTelemetry.totalRequests++;
      if (req.method !== 'GET' && req.method !== 'HEAD') httpTelemetry.totalWriteRequests++;

      // --- Tiered Rate Limiter ---
      const rl = checkTieredRateLimit(req);
      if (rl.limited) {
        res.setHeader('Retry-After', String(rl.retryAfter));
        throw new HttpError(429, `طلبات كثيرة جداً (${rl.rule}). حاول بعد ${rl.retryAfter} ثانية.`, 'rate_limited');
      }

      const { route, params, pathMatched } = router.match(req.method, url.pathname);
      if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'الطريقة غير مسموحة.' : 'غير موجود.', 'not_found');
      if (req.method !== 'GET' && req.method !== 'HEAD' && !originAllowed(cfg, req))
        throw new HttpError(403, 'مصدر الطلب غير مسموح.', 'bad_origin');
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies.sid && req.headers['x-session-token']) cookies.sid = String(req.headers['x-session-token']);
      const user = getUser(cookies.sid);
      if (route.opts.auth !== false && !user) throw new HttpError(401, 'يلزم تسجيل الدخول.', 'unauthenticated');
      if (route.opts.auth !== false && user?.must_change_password && !route.opts.allowMustChange) throw new HttpError(403, 'يجب تغيير كلمة المرور المؤقتة أولاً.', 'password_change_required');
      const parsedBody = req.method === 'GET' ? {} : route.opts.raw ? await readRaw(req, route.opts.maxBody) : await readBody(req, route.opts.maxBody ?? 64 * 1024);
      // فحص WAF على الـ body بعد parse
      if (req._wafScanBody && typeof parsedBody === 'object' && !Buffer.isBuffer(parsedBody)) {
        const bodyHit = req._wafScanBody(parsedBody);
        if (bodyHit) throw new HttpError(403, `محتوى الطلب مرفوض${bodyHit.label ? ` (الحقل: ${String(bodyHit.label).slice(0, 60)})` : ''}.`, bodyHit.type);
      }
      const ctx = { req, res, ip, params, query: Object.fromEntries(url.searchParams), cookies, user, cfg,
        body: parsedBody,
        json: (status, obj, headers) => sendJson(res, status, obj, headers, req) };
      await route.handler(ctx);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) }, {}, req);
      log.error(`${req.method} ${String(req.url).split('?')[0]}`, e);
      sendJson(res, 500, { error: 'internal', message: 'خطأ داخلي في الخادم.' }, {}, req);
    } finally {
      const dt = performance.now() - t0;
      httpTelemetry.recentLatenciesMs.push(dt);
      if (httpTelemetry.recentLatenciesMs.length > 500) httpTelemetry.recentLatenciesMs.shift();
    }
  };
}

export function sendRaw(res, status, headers, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

// بثّ ملف كبير (نسخة احتياطية مثلاً) بدل تحميله كاملاً في الذاكرة
export function sendStream(res, status, headers, stream) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  stream.pipe(res);
}
