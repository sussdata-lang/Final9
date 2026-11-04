/**
 * db.js — PostgreSQL adapter بواجهة متوافقة مع SQLite
 *
 * يستخدم Worker Thread + SharedArrayBuffer + Atomics.wait لتحويل
 * الاستعلامات الـ async (pg) إلى sync API يشبه better-sqlite3:
 *   db.prepare(sql).get(...args)   → صف واحد أو undefined
 *   db.prepare(sql).all(...args)   → مصفوفة صفوف
 *   db.prepare(sql).run(...args)   → { changes, lastInsertRowid }
 *   db.exec(sql)                   → تنفيذ DDL أو multi-statement
 *   tx(db, fn)                     → معاملة ذرية
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import pg from 'pg';
import { invalidateCacheForSql, flushAllCaches } from './cache.js';
import { invalidateAuditTailCache } from './audit.js';

const { Pool } = pg;

// ==============================
// مسار migrations
// ==============================
function getMigrationsDir() {
  const p1 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve(process.cwd(), 'uni-erp/server/migrations');
  if (fs.existsSync(p2)) return p2;
  return p1;
}
const MIGRATIONS = getMigrationsDir();

// مسار db_worker.js
const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db_worker.js');

// ==============================
// تحويل ? → $1,$2,...
// ==============================
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?(?=[^']*(?:'[^']*'[^']*)*$)/g, () => `$${++i}`);
}

// ==============================
// تحويل قيم SQLite → PostgreSQL
// timestamps (ms integers) → Date objects
// ==============================
function toPostgresValues(args) {
  return args.map((v) => {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === undefined) return null;
    if (typeof v === 'number' && Number.isNaN(v)) return null;   // SQLite يربط NaN كـ NULL؛ PostgreSQL يرفضه لـ bigint
    return v;
  });
}

// ==============================
// تحويل نتائج PostgreSQL → SQLite format
// Date → timestamp ms, bigint → number
// ==============================
// alias: خريطة {اسمٌ_بأحرف_صغيرة: الاسم_كما_كتب_في_SQL} لأن PostgreSQL يخفّض الأسماء المستعارة غير المقتبسة (docId → docid)
// ملاحظة: لا نحوّل النصوص الرقمية إلى أرقام هنا (كان يفسد أعمدة TEXT مثل national_id)؛ BIGINT/NUMERIC تُحوَّل في db_worker.js
function convertRow(row, alias) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [key, v] of Object.entries(row)) {
    const k = (alias && alias[key]) || key;
    if (v instanceof Date) {
      out[k] = v.getTime();
    } else if (typeof v === 'bigint') {
      out[k] = Number(v);
    } else if (v === true) {
      out[k] = 1;
    } else if (v === false) {
      out[k] = 0;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ==============================
// إحصاءات الأداء
// ==============================
const dbPerfStats = {
  stmtCacheHits: 0,
  stmtCacheMisses: 0,
  totalReads: 0,
  totalWrites: 0,
  startedAt: Date.now(),
};

export function getDbPerfStats(_db) {
  const total = dbPerfStats.stmtCacheHits + dbPerfStats.stmtCacheMisses;
  return {
    ...dbPerfStats,
    stmtCacheHitRate: total > 0
      ? Math.round((dbPerfStats.stmtCacheHits / total) * 1000) / 10
      : 100,
  };
}

// ==============================
// Mutation listeners
// ==============================
const mutationListeners = new Set();
export function registerMutationListener(fn) {
  if (typeof fn === 'function') mutationListeners.add(fn);
  return () => mutationListeners.delete(fn);
}

// ==============================
// Sync Query via Worker + SharedArrayBuffer
// ==============================
export const DB_POOL_MAX = 20;
const SAB_SIZE = 8 + 8 * 1024 * 1024; // header(8) + data(8MB)
const HEADER_INTS = 2; // [status, dataLen]

class SyncExecutor {
  constructor(poolConfig) {
    this.poolConfig = poolConfig;
    this.sab = new SharedArrayBuffer(SAB_SIZE);
    this.sa = new Int32Array(this.sab, 0, HEADER_INTS);

    this.worker = new Worker(WORKER_PATH, {
      workerData: { poolConfig, poolMax: DB_POOL_MAX },
    });
    // لا يُبقي العاملُ العمليةَ حيّة: من لا يستدعي db.close() (سكربتات واختبارات) يجب أن تنتهي عمليته طبيعياً
    this.worker.unref();
    this.worker.on('error', (e) => console.error('[DB Worker Error]', e.message));
    this.worker.on('exit', (code) => {
      if (code !== 0) console.error(`[DB Worker] exited with code ${code}`);
    });
  }

  query(sql, values = []) {
    // إعادة تعيين حالة SAB
    Atomics.store(this.sa, 0, 0);
    Atomics.store(this.sa, 1, 0);

    // إرسال الطلب للـ worker
    this.worker.postMessage({ sab: this.sab, sql, values });

    // انتظار النتيجة (blocking — يعمل فقط خارج الـ main async event loop)
    const result = Atomics.wait(this.sa, 0, 0, 30000); // timeout 30s
    if (result === 'timed-out') {
      throw new Error(`[DB] Query timed out: ${sql.slice(0, 100)}`);
    }

    const status = Atomics.load(this.sa, 0);
    const dataLen = Atomics.load(this.sa, 1);
    const dataBuf = Buffer.from(this.sab, 8, dataLen);
    const parsed = JSON.parse(dataBuf.toString('utf8'));

    if (status === -1) {
      throw new Error(`[DB] PostgreSQL error: ${parsed.error}\nSQL: ${sql.slice(0, 200)}`);
    }
    this.lastRowCount = parsed.rowCount ?? parsed.rows.length;   // عدد الصفوف المتأثرة (UPDATE/DELETE بلا RETURNING)
    return parsed.rows;
  }

  terminate() {
    this.worker.terminate();
  }
}

// ==============================
// Statement class — يحاكي better-sqlite3 Statement
// ==============================
class Statement {
  constructor(executor, dbRef, sql) {
    this.executor = executor;
    this.dbRef = dbRef;
    this.rawSql = sql;

    const upper = sql.trim().toUpperCase();
    this._isInsert = upper.startsWith('INSERT');
    this._isWrite = this._isInsert ||
      upper.startsWith('UPDATE') ||
      upper.startsWith('DELETE') ||
      upper.startsWith('REPLACE');

    // الأسماء المستعارة بأحرف مختلطة (docId, enteredAt): الأعمدة في المخطط snake_case دائماً، فكل معرّف مختلط الحالة هو اسم مستعار
    const bare = sql.replace(/'(?:[^']|'')*'/g, "''");
    const aliasMap = {};
    for (const m of bare.matchAll(/\b[a-z_][a-z0-9_]*[A-Z][A-Za-z0-9_]*\b/g)) aliasMap[m[0].toLowerCase()] = m[0];
    this._alias = Object.keys(aliasMap).length ? aliasMap : null;

    // المعاملات المسمّاة (@name) كما في node:sqlite/better-sqlite3: نحوّلها إلى $N ونربطها من الكائن الممرَّر
    this._named = null;
    const names = [];
    const withNamed = sql.replace(/@([A-Za-z_]\w*)(?=[^']*(?:'[^']*'[^']*)*$)/g, (_m, n) => {
      let idx = names.indexOf(n);
      if (idx < 0) { names.push(n); idx = names.length - 1; }
      return `$${idx + 1}`;
    });
    if (names.length) { this._named = names; sql = withNamed; }

    // تحويل ? → $N والـ INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
    let converted = convertPlaceholders(sql);
    converted = convertInsertOrIgnore(converted);
    converted = convertSqlFunctions(converted);

    // للـ INSERT نضيف RETURNING * لنحصل على lastInsertRowid إن وجد عمود id
    if (this._isInsert && !upper.includes('RETURNING')) {
      this.pgSql = converted.replace(/;\s*$/, '') + ' RETURNING *';
    } else {
      this.pgSql = converted;
    }
  }

  // يبني قائمة القيم: كائن واحد + معاملات مسمّاة → ترتيب الظهور، وإلا القيم الموضعية كما هي
  _bind(args) {
    if (this._named && args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const o = args[0];
      return this._named.map((n) => o[n] ?? o[`@${n}`] ?? o[`:${n}`] ?? null);
    }
    return args.flat();
  }

  get(...args) {
    dbPerfStats.totalReads++;
    const rows = this.executor.query(this.pgSql, toPostgresValues(this._bind(args)));
    return rows.length ? convertRow(rows[0], this._alias) : undefined;
  }

  all(...args) {
    dbPerfStats.totalReads++;
    const rows = this.executor.query(this.pgSql, toPostgresValues(this._bind(args)));
    return rows.map((r) => convertRow(r, this._alias));
  }

  run(...args) {
    dbPerfStats.totalWrites++;
    const rows = this.executor.query(this.pgSql, toPostgresValues(this._bind(args)));
    try { invalidateCacheForSql(this.dbRef, this.rawSql); } catch {}
    for (const fn of mutationListeners) { try { fn(this.rawSql); } catch {} }
    let lastInsertRowid = 0;
    if (rows && rows.length > 0) {
      const r = rows[0];
      lastInsertRowid = Number(r.id ?? r.lastid ?? 0);
    }
    return { changes: this.executor.lastRowCount ?? rows?.length ?? 0, lastInsertRowid };
  }
}

// ==============================
// تحويل INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
// ==============================
function convertInsertOrIgnore(sql) {
  const isIgnore  = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql);
  const isReplace = /INSERT\s+OR\s+REPLACE\s+INTO/i.test(sql);

  if (!isIgnore && !isReplace) return sql;

  let out = sql
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
    .replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');

  // أضف ON CONFLICT في نهاية الـ statement (بعد آخر $N)
  // نستخدم [\s\S] لدعم multi-line
  if (isIgnore) {
    // نبحث عن آخر ) في نهاية الـ SQL (قد يكون بعده مسافات/أسطر)
    out = out.replace(/(\))\s*$/s, '$1 ON CONFLICT DO NOTHING');
  } else if (isReplace) {
    const colMatch = out.match(/INSERT INTO\s+\w+\s*\(([^)]+)\)/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map((c) => c.trim()).filter(Boolean);
      const setClauses = cols.slice(1).map((c) => `${c} = EXCLUDED.${c}`).join(', ');
      if (setClauses) {
        out = out.replace(/(\))\s*$/s, `$1 ON CONFLICT (${cols[0]}) DO UPDATE SET ${setClauses}`);
      } else {
        out = out.replace(/(\))\s*$/s, '$1 ON CONFLICT DO NOTHING');
      }
    }
  }
  return out;
}

// ==============================
// تحويل دوال SQLite → PostgreSQL
// ==============================
// GLOB (نمط SQLite) → تعبير نمطي POSIX: * → .* ، ? → . ، [..] كما هي
function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const j = g.indexOf(']', i + 1);
      if (j === -1) { re += '\\['; continue; }
      re += '[' + g.slice(i + 1, j) + ']';
      i = j;
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return '^' + re + '$';
}

function convertGlob(sql) {
  return sql.replace(/([\w.]+)\s+(NOT\s+)?GLOB\s+'([^']*)'/gi,
    (_m, col, not, pat) => `${col} ${not ? '!~' : '~'} '${globToRegex(pat).replace(/'/g, "''")}'`);
}

// json_extract(col, '$.a.b') → (col::jsonb #>> '{a,b}') ، json_object → jsonb_build_object
function convertJsonFunctions(sql) {
  return sql
    .replace(/\bjson_extract\s*\(\s*([\w.]+)\s*,\s*'\$\.([\w.]+)'\s*\)/gi,
      (_m, col, p) => `(${col}::jsonb #>> '{${p.split('.').join(',')}}')`)
    .replace(/\bjson_object\s*\(/gi, 'jsonb_build_object(');
}

// مشغّلات SQLite من نمط «BEFORE ... BEGIN SELECT RAISE(ABORT,'..'); END» → دالة plpgsql + مشغّل
function convertSqliteTriggers(sql) {
  return sql.replace(
    /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+BEFORE\s+(UPDATE|DELETE|INSERT)\s+ON\s+(\w+)\s+(?:FOR\s+EACH\s+ROW\s+)?BEGIN\s+SELECT\s+RAISE\s*\(\s*ABORT\s*,\s*'((?:[^']|'')*)'\s*\)\s*;\s*END\s*;?/gi,
    (_m, name, ev, table, msg) =>
      `CREATE OR REPLACE FUNCTION trgfn_${name}() RETURNS trigger LANGUAGE plpgsql AS $trg$ BEGIN RAISE EXCEPTION '%', '${msg}'; END; $trg$;\n` +
      `DROP TRIGGER IF EXISTS ${name} ON ${table};\n` +
      `CREATE TRIGGER ${name} BEFORE ${ev} ON ${table} FOR EACH ROW EXECUTE FUNCTION trgfn_${name}();`
  );
}

function convertSqlFunctions(sql) {
  return convertJsonFunctions(convertGlob(sql))
    // SQLite: LIKE غير حساس لحالة الأحرف (ASCII)؛ PostgreSQL حساس، فنستعمل ILIKE
    .replace(/\b(NOT\s+)?LIKE\b/gi, (_m, n) => `${n || ''}ILIKE`)
    // PRAGMA table_info(t) → أعمدة الجدول بالاسم نفسه الذي يقرؤه الكود (name)
    .replace(/^\s*PRAGMA\s+table_info\s*\(\s*['"]?(\w+)['"]?\s*\)\s*;?\s*$/i,
      (_m, t) => `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' ORDER BY ordinal_position`)
    // وسيط بلا نوع في «? IS NULL OR ...» لا يستطيع PostgreSQL استنتاجه؛ كل وسيط له رقمه الخاص فالتحويل آمن
    .replace(/\$(\d+)\s+IS\s+(NOT\s+)?NULL\b/gi, (_m, n, not) => `$${n}::text IS ${not ? 'NOT ' : ''}NULL`)
    .replace(/\bSELECT\s+name\s+FROM\s+sqlite_master/gi, 'SELECT table_name AS name FROM sqlite_master')
    .replace(/\bGROUP_CONCAT\s*\(/gi, 'STRING_AGG(')
    .replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
    .replace(/\bstrftime\s*\(\s*'%Y-%m-%d'\s*,\s*'now'\s*\)/gi, "TO_CHAR(NOW(), 'YYYY-MM-DD')")
    .replace(/\bstrftime\s*\(\s*'%s'\s*,\s*'now'\s*\)/gi, 'EXTRACT(EPOCH FROM NOW())::BIGINT')
    .replace(/\bunixepoch\s*\(\s*\)/gi, 'EXTRACT(EPOCH FROM NOW())::BIGINT')
    .replace(/\bCURRENT_TIMESTAMP\b/gi, 'NOW()')
    // تحويل sqlite_master → information_schema.tables للاستعلامات الشائعة
    .replace(
      /FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*(NOT\s+LIKE|LIKE|=|!=|<>)\s*([^\s)]+)/gi,
      "FROM information_schema.tables WHERE table_schema='public' AND table_name $1 $2"
    )
    .replace(
      /FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'/gi,
      "FROM information_schema.tables WHERE table_schema='public'"
    )
    .replace(/\bsqlite_master\b/gi, 'information_schema.tables')
    .replace(/\bname\s+NOT\s+LIKE\s+'sqlite_%'/gi, "table_name NOT LIKE 'pg_%'");
}

// ==============================
// DbWrapper — يحاكي DatabaseSync من node:sqlite
// ==============================
class DbWrapper {
  constructor(executor) {
    this._exec = executor;
    this._stmtCache = new Map();
    this._MAX_CACHE = 400;
    this._closed = false;
  }

  prepare(sql) {
    const cached = this._stmtCache.get(sql);
    if (cached) {
      dbPerfStats.stmtCacheHits++;
      // LRU: حرّك للنهاية
      this._stmtCache.delete(sql);
      this._stmtCache.set(sql, cached);
      return cached;
    }
    dbPerfStats.stmtCacheMisses++;
    const stmt = new Statement(this._exec, this, sql);
    if (sql.length < 2000) {
      if (this._stmtCache.size >= this._MAX_CACHE) {
        const oldest = this._stmtCache.keys().next().value;
        this._stmtCache.delete(oldest);
      }
      this._stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  exec(sql) {
    // تنظيف: حذف PRAGMA واستعلامات SQLite-only
    const cleaned = sql
      .replace(/^\s*PRAGMA\s+[^;]*;?\s*$/gim, '')
      .replace(/^\s*ANALYZE\s*;?\s*$/gim, '')
      .trim();

    if (!cleaned) return;

    // تحويل SQL
    const converted = convertMigrationSql(convertSqlFunctions(cleaned));

    // تقسيم وتنفيذ statements
    for (const rawStmt of splitSqlStatements(converted)) {
      const stmt = convertInsertOrIgnore(rawStmt.trim());
      if (!stmt) continue;
      this._exec.query(stmt, []);
    }

    // مسح الـ cache عند DDL
    const upper = converted.toUpperCase();
    if (upper.includes('ALTER ') || upper.includes('DROP ') || upper.includes('CREATE ')) {
      this._stmtCache.clear();
      try { flushAllCaches(this); } catch {}
    }
  }

  close() {
    if (!this._closed) {
      this._closed = true;
      this._exec.terminate();
      // قاعدة :memory: المشتقة مؤقتة بطبيعتها: نحذفها بعد الإغلاق (بأفضل جهد، لا تعطّل الإغلاق)
      const d = this._dropOnClose;
      if (d) {
        const admin = new Pool({ connectionString: d.baseUrl, max: 1 });
        admin.query(`DROP DATABASE IF EXISTS "${d.name}" WITH (FORCE)`)
          .catch(() => {})
          .finally(() => admin.end().catch(() => {}));
      }
    }
  }
}

// ==============================
// تقسيم SQL إلى statements
// ==============================
function splitSqlStatements(sql) {
  const stmts = [];
  let cur = '';
  let inStr = false;
  let strChar = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      cur += c;
      if (c === strChar && sql[i - 1] !== '\\') inStr = false;
    } else if (c === "'" || c === '"') {
      inStr = true; strChar = c; cur += c;
    } else if (c === '-' && sql[i + 1] === '-') {
      // تعليق SQL — تخطّ حتى نهاية السطر
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(sql.slice(i, i + 40))) {
      // اقتباس بالدولار ($tag$ ... $tag$) كما في أجسام دوال plpgsql: لا نقسم داخله
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40))[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) { cur += c; } else { cur += sql.slice(i, end + tag.length); i = end + tag.length - 1; }
    } else if (c === ';') {
      const s = cur.trim();
      if (s) stmts.push(s);
      cur = '';
    } else {
      cur += c;
    }
  }
  const s = cur.trim();
  if (s) stmts.push(s);
  return stmts;
}

// ==============================
// تحويل migrations SQL من SQLite → PostgreSQL
// ==============================
// DROP TRIGGER name (SQLite) → PostgreSQL يشترط ON table: نبحث عن الجدول ديناميكياً
function convertDropTrigger(sql) {
  return sql.replace(/\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s*(?:;|$)/gi,
    (_m, n) => `DO $dt$ DECLARE t text; BEGIN SELECT c.relname INTO t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE g.tgname = '${n}' AND NOT g.tgisinternal LIMIT 1; IF t IS NOT NULL THEN EXECUTE format('DROP TRIGGER %I ON %I', '${n}', t); END IF; END $dt$;`);
}

function convertMigrationSql(sql) {
  return convertDropTrigger(convertJsonFunctions(convertGlob(convertSqliteTriggers(sql))))
    // إزالة PRAGMA
    .replace(/^\s*PRAGMA\s+[^;]+;?\s*$/gim, '')
    // AUTOINCREMENT → GENERATED BY DEFAULT AS IDENTITY
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\b/gi, 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
    .replace(/\bINTEGER\b/gi, 'BIGINT')
    // أنواع البيانات
    .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
    .replace(/\bBLOB\b/g, 'BYTEA')
    .replace(/\bDATETIME\b/gi, 'BIGINT')
    // دوال التاريخ
    .replace(/strftime\s*\(\s*'%Y-%m-%d'\s*,\s*'now'\s*\)/gi, "TO_CHAR(NOW(), 'YYYY-MM-DD')")
    .replace(/strftime\s*\(\s*'%s'\s*,\s*'now'\s*\)/gi, 'EXTRACT(EPOCH FROM NOW())::BIGINT')
    .replace(/\bunixepoch\s*\(\s*\)/gi, 'EXTRACT(EPOCH FROM NOW())::BIGINT')
    .replace(/\bCURRENT_TIMESTAMP\b/gi, 'NOW()')
    // CREATE TABLE ... WITH ROWID → بدونها (PG لا يدعمها)
    .replace(/\bWITHOUT\s+ROWID\b/gi, '')
    // ANALYZE table_name → ANALYZE
    .replace(/\bANALYZE\s+\w[\w.]*\s*;/gi, '-- ANALYZE (skipped for PG);')
    // sqlite_master
    .replace(/\bsqlite_master\b/gi, 'pg_catalog.pg_class')
    // GROUP_CONCAT → STRING_AGG
    .replace(/\bGROUP_CONCAT\s*\(/gi, 'STRING_AGG(')
    // IFNULL → COALESCE
    .replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
}

function resolvePgPoolConfig(connectionStringOrPath) {
  let cs = connectionStringOrPath;
  if (!cs || cs.endsWith('.db') || cs === ':memory:') {
    cs = process.env.DATABASE_URL || '';
  }
  if (cs && (cs.startsWith('postgres://') || cs.startsWith('postgresql://'))) {
    const ssl = cs.includes('sslmode=require') ||
      cs.includes('amazonaws.com') || cs.includes('railway.app') || cs.includes('render.com');
    return { connectionString: cs, ssl: ssl ? { rejectUnauthorized: false } : false };
  }
  if (process.env.SQL_HOST) {
    return {
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      ssl: false,
    };
  }
  throw new Error(
    '[DB] DATABASE_URL or SQL_HOST is not set. ' +
    'Set DATABASE_URL to your PostgreSQL connection string: postgres://user:pass@host/db'
  );
}

// ==============================
// Async migrations runner
// ==============================
// الترحيلات تُدخل صفوفاً بمعرّفات صريحة (بيانات تأسيسية، أو نسخ جدول عند إعادة بنائه) فلا يتقدّم عدّاد identity؛
// نزامنه مع أكبر معرّف وإلا اصطدم أول INSERT بلا id بمفتاح موجود (مثل rules بعد إعادة البناء في 002)
async function syncIdentitySequences(pool) {
  await pool.query(`
    DO $sync$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND is_identity = 'YES'
      LOOP
        EXECUTE format(
          'SELECT setval(pg_get_serial_sequence(%L, %L), COALESCE((SELECT MAX(%I) FROM %I), 0) + 1, false)',
          quote_ident(r.table_name), r.column_name, r.column_name, r.table_name);
      END LOOP;
    END
    $sync$
  `);
}

async function runMigrations(poolConfig) {
  const pool = new Pool({
    ...poolConfig,
    max: 3,
  });

  try {
    // SQLite يوفّر COLLATE NOCASE؛ المكافئ في PostgreSQL تجميعة ICU غير حتمية (مستوى 2 = تجاهل حالة الأحرف)
    await pool.query(`
      CREATE COLLATION IF NOT EXISTS nocase (provider = icu, locale = 'und-u-ks-level2', deterministic = false)
    `);

    // SQLite يعامل نتيجة المقارنة كعدد صحيح فيقبل SUM(status = 'active')؛ PostgreSQL لا يوفّر sum(boolean)
    await pool.query(`
      DO $agg$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'sum' AND n.nspname = 'public' AND p.proargtypes::text = 'bool'::regtype::oid::text
        ) THEN
          CREATE FUNCTION public.bool_sum_step(bigint, boolean) RETURNS bigint LANGUAGE sql IMMUTABLE
            AS 'SELECT COALESCE($1, 0) + CASE WHEN $2 THEN 1 ELSE 0 END';
          CREATE AGGREGATE public.sum(boolean) (sfunc = public.bool_sum_step, stype = bigint);
        END IF;
      END
      $agg$
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `);

    // أُعيدت تسمية ترحيل كان يتشارك الرقم 029: ما طُبّق باسمه القديم لا يُعاد تنفيذه، والترتيب لم يتغير
    await pool.query("UPDATE schema_migrations SET name = '029b_student_affairs_suite.sql' WHERE name = '029_student_affairs_suite.sql'");
    const { rows: done } = await pool.query('SELECT name FROM schema_migrations');
    const doneSet = new Set(done.map((r) => r.name));

    const files = fs.readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith('.sql'))
      .sort();

    // رموز SQLSTATE المقبولة عند إعادة تطبيق ترحيل: الكائن موجود مسبقاً (جدول/عمود/فهرس/قيد/نوع)
    const BENIGN = new Set(['42P07', '42701', '42710', '42P06', '42P04']);

    let applied = 0;
    const failures = [];
    for (const f of files) {
      if (doneSet.has(f)) continue;

      const rawSql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
      const pgSql = convertMigrationSql(rawSql);
      const statements = splitSqlStatements(pgSql).map((s) => convertInsertOrIgnore(s.trim())).filter(Boolean);

      const errors = [];
      for (const stmt of statements) {
        try {
          await pool.query(stmt);
          // بعد إعادة تسمية جدول أُعيد بناؤه (نسخ بمعرّفات صريحة) نزامن العدّاد فوراً قبل أي INSERT لاحق في الملف نفسه
          if (/^\s*ALTER\s+TABLE\s+\w+\s+RENAME\s+TO\b/i.test(stmt)) await syncIdentitySequences(pool);
          // SQLite يعيد استعمال المعرّفات (INTEGER PRIMARY KEY = أكبر معرّف + 1) بعد الحذف؛ نحاكي ذلك
          // حتى تبقى المعرّفات التأسيسية (برامج، كليات، ...) كما هي عند من يعتمد عليها.
          const del = /^\s*DELETE\s+FROM\s+(\w+)/i.exec(stmt);
          if (del) {
            await pool.query(
              `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM "${del[1]}"), 0) + 1, false)`,
              [`public."${del[1]}"`]
            ).catch(() => {});
          }
        } catch (e) {
          if (BENIGN.has(e.code)) continue;
          errors.push({ code: e.code, message: e.message, sql: stmt.replace(/\s+/g, ' ').slice(0, 160) });
        }
      }

      await syncIdentitySequences(pool);

      if (errors.length) {
        // لا نسجّل الترحيل كمطبَّق ولا نبتلع الخطأ: قاعدة ناقصة أسوأ من فشل صريح
        for (const e of errors) console.error(`[migrate] ✗ ${f} [${e.code}] ${e.message}\n         SQL: ${e.sql}`);
        failures.push(f);
        continue;
      }

      await pool.query(
        'INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [f, Date.now()]
      );
      applied++;
      console.log(`[migrate] ✓ ${f}`);
    }


    await syncIdentitySequences(pool);
    console.log(`[migrate] Done — ${applied} new migration(s) applied.`);
    if (failures.length) {
      throw new Error(`[migrate] فشلت الترحيلات التالية: ${failures.join(', ')}`);
    }
  } finally {
    await pool.end();
  }
}

// ==============================
// openDb — نقطة الدخول الرئيسية
// ==============================
const isPgUri = (s) => typeof s === 'string' && /^postgres(ql)?:\/\//i.test(s);

/**
 * في SQLite «المسار = قاعدة بيانات»: كل مسار ملف (أو :memory:) قاعدة مستقلة. نحافظ على هذه الدلالة على PostgreSQL:
 * عند ضبط DATABASE_URL ومجيء مسار ملف نشتق منه قاعدة مستقلة على الخادم نفسه (تُنشأ عند أول فتح، وتبقى بين الفتحات
 * لنفس المسار)، و:memory: تعطي قاعدة جديدة تُحذف عند الإغلاق. هكذا لا تتشارك الاختبارات والسكربتات القاعدة نفسها.
 * يتطلب صلاحية CREATEDB لمستخدم DATABASE_URL. اتصال إنتاجي (postgres://...) يُستعمل كما هو دون اشتقاق.
 */
async function deriveIsolatedDatabase(baseUrl, pathOrMem) {
  const u = new URL(baseUrl);
  const baseDb = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
  const ephemeral = pathOrMem === ':memory:';
  const key = ephemeral
    ? crypto.randomBytes(6).toString('hex')
    : crypto.createHash('sha1').update(path.resolve(pathOrMem)).digest('hex').slice(0, 12);
  const name = `${baseDb}_${key}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 63);

  const admin = new Pool({ connectionString: baseUrl, max: 1 });
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rows.length) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  u.pathname = '/' + name;
  return { url: u.toString(), name, baseUrl, ephemeral };
}

function describePgTarget(poolConfig) {
  try {
    if (poolConfig.connectionString) {
      const u = new URL(poolConfig.connectionString);
      return { host: u.hostname, port: u.port || '5432', database: decodeURIComponent(u.pathname.replace(/^\//, '')) };
    }
  } catch { return { host: '', port: '', database: '' }; }
  return { host: poolConfig.host || '', port: poolConfig.port || '5432', database: poolConfig.database || '' };
}

// اتصال إضافي بقاعدة جاهزة (بلا ترحيلات) لخيوط العمليات الثقيلة
export function connectDb(url) {
  const db = new DbWrapper(new SyncExecutor(resolvePgPoolConfig(url)));
  db.pgUrl = url;
  return db;
}

export async function openDb(connectionStringOrPath) {
  const given = connectionStringOrPath;
  let cs = isPgUri(given) ? given : (process.env.DATABASE_URL || '');
  // احتياطي لمنصات (مثل Railway) تُعرّف متغيرات PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT بدل DATABASE_URL
  if (!cs && process.env.PGHOST && process.env.PGUSER) {
    const e = process.env;
    cs = `postgres://${encodeURIComponent(e.PGUSER)}:${encodeURIComponent(e.PGPASSWORD || '')}@${e.PGHOST}:${e.PGPORT || 5432}/${encodeURIComponent(e.PGDATABASE || 'postgres')}`;
    process.env.DATABASE_URL = cs;
  }

  // النظام يعمل على PostgreSQL حصراً: لا مسار احتياطي إلى SQLite
  if (!cs) {
    throw new Error(
      '[DB] DATABASE_URL غير مضبوط. اضبطه على سلسلة اتصال PostgreSQL، مثال: ' +
      'DATABASE_URL=postgres://user:pass@127.0.0.1:5432/unierp'
    );
  }

  // مسار ملف أو :memory: مع خادم PostgreSQL مضبوط → قاعدة مستقلة مشتقة من المسار
  let isolated = null;
  if (!isPgUri(given) && typeof given === 'string' && given) {
    isolated = await deriveIsolatedDatabase(cs, given);
    cs = isolated.url;
  }

  const poolConfig = resolvePgPoolConfig(cs);

  // تشخيص الاتصال (بلا كلمة مرور): يُظهر الوجهة الفعلية ويكشف رابطاً مكسوراً (متغير غير محلول أو رمز غير مرمَّز في كلمة المرور)
  const target = describePgTarget(poolConfig);
  if (!target.host) {
    throw new Error('[DB] DATABASE_URL غير صالح: لا يوجد اسم مضيف. تأكد من القيمة (على Railway استعمل مرجع المتغير ${{Postgres.DATABASE_URL}}) وأن كلمة المرور لا تحوي رموزاً خاصة غير مرمَّزة (@ : / # ? %).');
  }
  console.log(`[db] connecting to ${target.host}:${target.port}/${target.database}`);
  if (process.env.NODE_ENV === 'production' && /^(localhost|127\.0\.0\.1|::1)$/.test(target.host)) {
    console.warn('[db] تنبيه: الاتصال موجّه إلى localhost في بيئة إنتاج؛ على Railway يجب أن يشير DATABASE_URL إلى خدمة PostgreSQL (المضيف postgres.railway.internal أو العنوان العام).');
  }

  // 1) تشغيل migrations بشكل async أولاً
  try {
    await runMigrations(poolConfig);
  } catch (e) {
    if (e && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      throw new Error(`[DB] تعذّر الاتصال بـ PostgreSQL على ${target.host}:${target.port} (${e.code}). تحقق من DATABASE_URL وأن خدمة PostgreSQL تعمل وفي نفس المشروع.`, { cause: e });
    }
    throw e;
  }

  // 2) إنشاء الـ sync executor عبر worker thread
  const executor = new SyncExecutor(poolConfig);

  // 3) إنشاء DbWrapper
  const db = new DbWrapper(executor);
  db.pgUrl = cs;   // الرابط الفعلي (قد يكون قاعدة مشتقة) — يستعمله النسخ الاحتياطي
  if (isolated?.ephemeral) db._dropOnClose = isolated;

  console.log('[db] PostgreSQL ready.');
  return db;
}

// ==============================
// tx — معاملة ذرية (متوافق مع الكود القديم)
// ==============================
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    // سجلات التدقيق المكتوبة داخل المعاملة أُلغيت: ذاكرة آخر بصمة صارت تشير إلى صف غير موجود فتُكسر السلسلة
    try { invalidateAuditTailCache(db); } catch {}
    throw e;
  }
}
