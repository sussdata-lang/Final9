/**
 * waf.js — In-App Web Application Firewall
 * يفحص كل طلب قبل وصوله للمسارات، ويحظر الأنماط الخبيثة
 * SQL Injection / XSS / Path Traversal / Prototype Pollution / Scanner Bots
 */

import { SECURITY_HEADERS } from './http.js';
import { isTrustedIp } from './security.js';

// ===== أنماط الهجمات =====
const SQL_INJECTION = [
  // جملة عادية فيها select وfrom لا تكفي: يلزم رمز من رموز SQL
  /^(?=[\s\S]*['"`;()=*])[\s\S]*(\b(union|select|insert|update|delete|drop|create|alter|exec|execute|xp_|sp_)\b.*\b(from|into|table|where|set)\b)/i,
  /\bunion\s+(all\s+)?select\b/i,
  /\bdrop\s+table\b/i,
  /('|"|`)\s*(or|and)\s*('|"|`|\d|[a-z])/i,
  /\b(or|and)\s+\d+\s*=\s*\d+/i,
  /--\s*$/m,
  /\/\*[\s\S]*?\*\//,
  /;\s*(drop|delete|truncate|update|insert)\b/i,
  /\bchar\s*\(\s*\d+/i,
  /\bconcat\s*\(/i,
  /0x[0-9a-f]{4,}/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /<\/script>/i,
  /javascript\s*:/i,
  /on(error|load|click|mouseover|focus|blur|change|submit|reset|select|keydown|keyup|keypress|mouseenter|mouseleave|dblclick|contextmenu|drag|drop|input|wheel)\s*=/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /document\.(cookie|write|location)/i,
  /window\.(location|open)/i,
  /<img[^>]+src\s*=\s*["']?\s*javascript/i,
  /expression\s*\(/i,
  /vbscript\s*:/i,
];

const PATH_TRAVERSAL = [
  /\.\.[/\\]/,
  /%2e%2e[%2f%5c]/i,
  /\.\.[%2f%5c]/i,
  /%2e%2e[/\\]/i,
  /\/etc\/(passwd|shadow|hosts|group)/i,
  /\/(proc|sys|dev)\//i,
  /\\(windows|winnt|system32)\\/i,
];

const PROTO_POLLUTION = [
  /__proto__/i,
  /constructor\.prototype/i,
  /prototype\.__proto__/i,
];

// أدوات الاختراق الشائعة
const SCANNER_AGENTS = [
  /sqlmap/i, /nikto/i, /\bnmap\b/i, /masscan/i, /dirbuster/i,
  /gobuster/i, /wfuzz/i, /\bhydra\b/i, /medusa/i, /acunetix/i,
  /nessus/i, /openvas/i, /metasploit/i, /burpsuite/i, /zaproxy/i,
  /w3af/i, /skipfish/i, /appscan/i, /webscarab/i, /paros/i,
  /havij/i, /pangolin/i, /absinthe/i, /whitewidow/i,
];

// ===== نظام نقاط التهديد =====
const ipRegistry = new Map();
const SCORE_DECAY_MS = 10 * 60_000;
const BAN_THRESHOLDS = [15 * 60_000, 60 * 60_000, 24 * 60 * 60_000];

function getIpRecord(ip) {
  if (!ipRegistry.has(ip)) {
    ipRegistry.set(ip, { score: 0, banUntil: 0, violations: [], banCount: 0, lastSeen: Date.now() });
  }
  return ipRegistry.get(ip);
}

export function addThreatScore(ip, points, reason, path) {
  const rec = getIpRecord(ip);
  const elapsed = Date.now() - rec.lastSeen;
  if (elapsed > SCORE_DECAY_MS) {
    rec.score = Math.max(0, rec.score - Math.floor(elapsed / SCORE_DECAY_MS) * 3);
  }
  rec.score += points;
  rec.lastSeen = Date.now();
  rec.blocks = (rec.blocks || 0) + 1;
  rec.violations.push({ type: reason, path, at: Date.now() });
  if (rec.violations.length > 50) rec.violations = rec.violations.slice(-50);

  if (rec.score >= 20 && rec.banUntil < Date.now()) {
    const duration = BAN_THRESHOLDS[Math.min(rec.banCount, BAN_THRESHOLDS.length - 1)];
    rec.banUntil = Date.now() + duration;
    rec.bannedAt = Date.now();
    rec.banCount++;
    rec.score = 0;
    wafBanListener?.(ip, rec.banUntil);
    return { banned: true, until: rec.banUntil, duration };
  }
  return { banned: false };
}

export function isIpBanned(ip) {
  const rec = ipRegistry.get(ip);
  if (!rec) return false;
  return rec.banUntil > Date.now();
}

// ===== فحص المحتوى =====
// نص base64 طويل (ملف مرفوع كـ xlsx/pdf) لا يحوي فراغات ولا اقتباساً ولا أقواساً فلا يحمل صياغة هجوم؛
// لكن أنماطاً مثل 0x[0-9a-f]{4,} تطابقه عشوائياً وتحجب رفعاً سليماً، فنستثنيه من الفحص.
const BASE64_BLOB = /^(?:data:[\w.+/-]+;base64,)?[A-Za-z0-9+/_\-\r\n]{256,}={0,2}$/;   // يشمل بادئة data: والصيغة url-safe

function scanValue(val, label) {
  if (typeof val !== 'string') return null;
  if (BASE64_BLOB.test(val)) return null;
  for (const p of SQL_INJECTION) if (p.test(val)) return { type: 'sqli', label };
  for (const p of XSS_PATTERNS) if (p.test(val)) return { type: 'xss', label };
  for (const p of PATH_TRAVERSAL) if (p.test(val)) return { type: 'path_traversal', label };
  for (const p of PROTO_POLLUTION) if (p.test(val)) return { type: 'proto_pollution', label };
  return null;
}

function deepScan(obj, prefix = 'body') {
  if (!obj || typeof obj !== 'object') return scanValue(String(obj ?? ''), prefix);
  for (const [k, v] of Object.entries(obj)) {
    const label = `${prefix}.${k}`;
    const keyHit = scanValue(k, `${prefix}[key]`);
    if (keyHit) return keyHit;
    const hit = typeof v === 'object' ? deepScan(v, label) : scanValue(String(v ?? ''), label);
    if (hit) return hit;
  }
  return null;
}

// ===== Magic-Bytes File Validator =====
const MAGIC_SIGS = {
  'application/pdf':  [[0x25,0x50,0x44,0x46]],
  'image/jpeg':       [[0xFF,0xD8,0xFF]],
  'image/png':        [[0x89,0x50,0x4E,0x47]],
  'image/gif':        [[0x47,0x49,0x46,0x38]],
  'application/zip':  [[0x50,0x4B,0x03,0x04],[0x50,0x4B,0x05,0x06]],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50,0x4B]],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50,0x4B]],
};

const EXEC_MAGIC = [
  [0x4D,0x5A],           // PE (Windows EXE/DLL)
  [0x7F,0x45,0x4C,0x46], // ELF (Linux)
  [0xCA,0xFE,0xBA,0xBE], // Mach-O (Mac)
  [0x23,0x21],           // Shebang #!
];

export function validateFileMagicBytes(buffer, declaredMime) {
  if (!buffer || buffer.length < 4) return { valid: false, reason: 'empty_file' };

  // حظر الملفات التنفيذية دائماً
  for (const sig of EXEC_MAGIC) {
    if (sig.every((b, i) => buffer[i] === b)) return { valid: false, reason: 'executable_file' };
  }

  // فحص SVG مع JS مضمّن
  if (declaredMime?.includes('svg') || buffer.slice(0, 5).toString().includes('<svg')) {
    if (/javascript|<script|onload|onerror/i.test(buffer.slice(0, 2000).toString())) {
      return { valid: false, reason: 'svg_with_js' };
    }
  }

  const expected = MAGIC_SIGS[declaredMime];
  if (!expected) return { valid: true }; // نوع غير معروف — نسمح
  return expected.some(sig => sig.every((b, i) => buffer[i] === b))
    ? { valid: true }
    : { valid: false, reason: 'magic_bytes_mismatch' };
}

// ===== WAF Middleware =====
export function wafMiddleware(_cfg) {
  return function waf(req, res, next) {
    const xff = _cfg?.trustProxy && req.headers?.['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const ip = req.ip || (xff.length ? xff[xff.length - 1] : null) || req.socket?.remoteAddress || '0.0.0.0';
    // عناوين الجامعة الموثوقة (WAF_TRUSTED_IPS): لا يوقف مستخدم واحد خلف NAT الجميع، وفحص الجسم يبقى يعمل
    const trusted = isTrustedIp(ip);

    // تتبع عدد الطلبات
    const _rec = getIpRecord(ip);
    _rec.requests = (_rec.requests || 0) + 1;
    _rec.lastSeen = Date.now();

    // 1. فحص الحظر
    if (!trusted && isIpBanned(ip)) {
      const rec = getIpRecord(ip);
      res.setHeader('Retry-After', String(Math.ceil((rec.banUntil - Date.now()) / 1000)));
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: 'تم حظر عنوان IP مؤقتاً بسبب نشاط مشبوه.', code: 'ip_banned', until: rec.banUntil }));
    }

    // 2. فحص User-Agent (أدوات الاختراق)
    const ua = req.headers['user-agent'] || '';
    for (const pattern of SCANNER_AGENTS) {
      if (pattern.test(ua)) {
        if (!trusted) addThreatScore(ip, 25, 'scanner_agent', req.url);
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: 'مرفوض.', code: 'scanner_blocked' }));
      }
    }

    // 3. فحص URL (بعد decode)
    let decodedUrl = req.url || '/';
    try { decodedUrl = decodeURIComponent(decodedUrl); } catch { /* URL مكسور */ }
    const urlHit = scanValue(decodedUrl, 'url');
    if (urlHit) {
      if (!trusted) addThreatScore(ip, 10, urlHit.type, req.url);
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: 'طلب مرفوض.', code: urlHit.type }));
    }

    // 4. فحص Query String
    try {
      const qs = new URL(req.url || '/', 'http://x');
      for (const [k, v] of qs.searchParams) {
        const hit = scanValue(k, 'query.key') || scanValue(v, `query.${k}`);
        if (hit) {
          if (!trusted) addThreatScore(ip, 10, hit.type, req.url);
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
          return res.end(JSON.stringify({ error: 'معامل مرفوض.', code: hit.type }));
        }
      }
    } catch { /* URL parse error */ }

    // 5. فحص Headers الخطرة
    const dangerousHeaders = ['x-forwarded-host', 'x-rewrite-url', 'x-original-url'];
    for (const h of dangerousHeaders) {
      if (req.headers[h]) {
        const hit = scanValue(req.headers[h], `header.${h}`);
        if (hit) addThreatScore(ip, 8, hit.type, req.url);
      }
    }

    // 6. تعيين helpers للفحص اللاحق (بعد parse body)
    req._wafIp = ip;
    req._wafScanBody = (body) => body ? deepScan(body, 'body') : null;

    next();
  };
}

// ===== صادرات للإدارة =====
export function getWafStats() {
  const entries = [...ipRegistry.entries()];
  const now = Date.now();
  const banned = entries.filter(([, r]) => r.banUntil > now);

  // إحصائيات مجمَّعة حسب نوع الانتهاك
  let sqliDetected = 0, xssDetected = 0, pathTraversal = 0, scannerBlocked = 0, totalRequests = 0, blockedRequests = 0;
  const recentBlocks = [];

  for (const [ip, r] of entries) {
    totalRequests += r.requests || 0;
    blockedRequests += r.blocks || 0;
    for (const v of r.violations) {
      if (v.type === 'sqli') sqliDetected++;
      else if (v.type === 'xss') xssDetected++;
      else if (v.type === 'path_traversal') pathTraversal++;
      else if (v.type === 'scanner') scannerBlocked++;
      recentBlocks.push({ ip, type: v.type, path: v.path, at: v.at });
    }
  }
  recentBlocks.sort((a, b) => b.at - a.at);

  const topThreats = [...entries]
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, 20)
    .map(([ip, r]) => {
      const last = r.violations.at(-1);
      return { ip, score: r.score, banCount: r.banCount, lastReason: last?.type, lastPath: last?.path };
    });

  const bannedIps = banned.map(([ip, r]) => {
    const msLeft = r.banUntil - now;
    const minsLeft = Math.ceil(msLeft / 60_000);
    return {
      ip,
      bannedAt: r.bannedAt || now,
      reason: r.violations.at(-1)?.type ?? '—',
      permanent: false,
      expiresIn: minsLeft > 60 ? `${Math.ceil(minsLeft / 60)} ساعة` : `${minsLeft} دقيقة`,
    };
  });

  return {
    tracked: ipRegistry.size,
    bannedIps,
    topThreats,
    recentBlocks: recentBlocks.slice(0, 20),
    stats: { totalRequests, blockedRequests, sqliDetected, xssDetected, pathTraversal, scannerBlocked },
  };
}

/** تصفير حالة التهديد لكل العناوين (للاختبارات: كلها تأتي من 127.0.0.1 فلا يجوز أن يحظرها اختبار عدائي واحد). */
export function resetWaf() { ipRegistry.clear(); }

export function unbanIp(ip) {
  const rec = ipRegistry.get(ip);
  if (rec) { rec.banUntil = 0; rec.score = 0; }
  wafBanListener?.(ip, 0);
  return !!rec;
}

// الحظر يسري على كل عمليات الخادم
let wafBanListener = null;
export const setWafBanListener = (fn) => { wafBanListener = fn; };
export function applySharedBan(ip, until) {
  if (!ipRegistry.has(ip) && !until) return;
  const rec = getIpRecord(ip);
  rec.banUntil = until;
  if (!until) rec.score = 0;
}

export function testWafPattern(payload) {
  const results = {};
  results.url = scanValue(payload, 'url');
  results.body = deepScan(typeof payload === 'string' ? { input: payload } : payload, 'body');
  return results;
}

// تنظيف دوري للسجلات القديمة
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const [ip, rec] of ipRegistry) {
    if (rec.lastSeen < cutoff && rec.banUntil < Date.now()) ipRegistry.delete(ip);
  }
}, 60 * 60_000).unref();
