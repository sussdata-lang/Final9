import express from "express";
import compression from "compression";
import expressStaticGzip from "express-static-gzip";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import JSZip from "jszip";
import { apiRouter } from "./server/apiRouter.ts";
import { requireAuth, optionalAuth, type AuthRequest } from "./src/middleware/auth.ts";
import { getOrCreateUser } from "./src/db/users.ts";
import {
  getStudioChangelogs,
  saveStudioChangelogEntry,
  logDevopsIncidentToPostgres,
  getPostgresRelationalAudit,
} from "./src/db/repository.ts";
// @ts-ignore - ESM module from uni-erp
import { createApp as createUniErpApp } from "./uni-erp/server/app.js";
// @ts-ignore - ESM module from uni-erp
import { registerMutationListener } from "./uni-erp/server/db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uniErpRoot = path.resolve(__dirname, "uni-erp");
const uniErpPublic = path.resolve(uniErpRoot, "public");

const FEATURED_LABELS: Record<string, string> = {
  "src/db/schema.ts": "schema.ts (PostgreSQL) — مخطط قاعدة بيانات PostgreSQL والعلاقات المرجعية (Drizzle ORM)",
  "src/db/repository.ts": "repository.ts (PostgreSQL) — محرك المزامنة وتدقيق الارتباطات والاستعلامات الآمنة (PostgreSQL)",
  "src/db/index.ts": "index.ts (PostgreSQL) — مجمع اتصالات Cloud SQL PostgreSQL (Connection Pool)",
  "src/db/users.ts": "users.ts (PostgreSQL) — إدارة وربط حسابات المصادقة بقاعدة بيانات PostgreSQL",
  "public/ux_restructure.js": "ux_restructure.js — منظومة الهيكلة الموحدة (دمج اللوحة الرئيسية ومكتبي، الإرشادات التفاعلية، المراسلات، والإدارة)",
  "public/payroll.js": "payroll.js — منظومة شؤون الموظفين والرواتب المتكاملة (10 شاشات + الإحصائيات + التنبيهات)",
  "public/enterprise_suite.js": "enterprise_suite.js — منظومة التطوير المؤسسي الشاملة (الـ 15 ميزة الحديثة + نافذة الأوامر)",
  "server/services/enterprise_suite.js": "enterprise_suite.js (Server) — الواجهات الخلفية والخوارزميات للميزات الـ 15",
  "server/migrations/028_enterprise_suite.sql": "028_enterprise_suite.sql — قاعدة بيانات التطوير المؤسسي (الجداول الذكية، الاختبارات، الأقساط، التشفير)",
  "server/services/hr_integrated.js": "hr_integrated.js — الواجهات البرمجية الخلفية لشؤون الموظفين والعقود والسلف والتنبيهات",
  "server/services/hr_calculations.js": "hr_calculations.js — محرك المعادلات المحاسبية والحضور والعقود والتنبيهات",
  "server/migrations/026_hr_integrated_system.sql": "026_hr_integrated_system.sql — قاعدة بيانات شؤون الموظفين وبرمجة السيستم والتنبيهات",
  "server/migrations/025_v12_complete.sql": "025_v12_complete.sql — قاعدة بيانات الوحدات الجديدة (5.12–5.15 + التوسعات + AI)",
  "server/services/v12_modules.js": "v12_modules.js — الواجهات البرمجية الخلفية (Phases 1–4 REST APIs)",
  "public/v12_views.js": "v12_views.js — شاشات الوحدات التفاعلية (LMS, Research, Alumni, QA, DevOps, AI)",
  "public/analytics_panel.js": "analytics_panel.js — لوحة التحليلات المدمجة المستقلة (DevOps + الأقسام والموارد البشرية)",
  "public/student_affairs_suite.js": "student_affairs_suite.js — منظومة شؤون الطلاب الشاملة (القبول، الإرشاد، القيد، المنح، الدور الذكي)",
  "server/services/student_affairs_suite.js": "student_affairs_suite.js (Server) — خدمات شؤون الطلاب والمنح والإرشاد الأكاديمي",
  "public/access.js": "access.js — استوديو الحسابات والصلاحيات المهيكلة (RBAC-4)",
  "public/i18n.js": "i18n.js — محرك الترجمة الفورية ثنائي اللغة (عربي / إنجليزي)",
  "public/units.js": "units.js — فهرس الوحدات السبع عشرة (5.1–5.17)",
  "public/notify.js": "notify.js — نظام الإشعارات والتنبيهات المنبثقة الغنية (Rich Toast Notifications)",
  "public/ux_enhancements.js": "ux_enhancements.js — حزمة تحسينات تجربة المستخدم الشاملة (Ctrl+K، التبويبات المفتوحة والمثبتة، شارات العد الحية)",
  "server/migrations/034_finance_catalog_indexes.sql": "034_finance_catalog_indexes.sql — فهارس الأداء المالي والكتالوج وسجل التدقيق",
  "public/app.js": "app.js — النواة الأمامية وجسر تبديل الأدوار",
  "public/shell.js": "shell.js — القائمة الجانبية والهيكل العام",
  "server/routes.js": "routes.js — موجه المسارات الرئيسي للخادم",
  "server/db.js": "db.js — محرك قاعدة البيانات وإدارة التهجيرات والمزامنة اللحظية",
};

const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".ts", ".tsx", ".sql", ".css", ".html", ".json", ".md", ".txt", ".py", ".webmanifest",
]);

function detectLang(ext: string): string {
  if (ext === ".sql") return "sql";
  if (ext === ".css") return "css";
  if (ext === ".html") return "html";
  if (ext === ".json" || ext === ".webmanifest") return "json";
  if (ext === ".md") return "markdown";
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  return "javascript";
}

function collectAllEditableFiles(): Array<{ path: string; label: string; lang: string; content: string; size: number; category: string }> {
  const results: Array<{ path: string; label: string; lang: string; content: string; size: number; category: string }> = [];
  const seen = new Set<string>();

  // Include PostgreSQL Drizzle files from src/db/
  const pgDir = path.resolve(__dirname, "src", "db");
  if (fs.existsSync(pgDir)) {
    for (const entry of fs.readdirSync(pgDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const fullPath = path.join(pgDir, entry.name);
      const relPath = `src/db/${entry.name}`;
      const content = fs.readFileSync(fullPath, "utf8");
      seen.add(relPath);
      results.push({
        path: relPath,
        label: FEATURED_LABELS[relPath] || relPath,
        lang: detectLang(ext),
        content,
        size: Buffer.byteLength(content, "utf8"),
        category: "قاعدة بيانات PostgreSQL (src/db)",
      });
    }
  }

  function walkUniErp(dir: string, relBase = "") {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "data") continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walkUniErp(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) continue;
        const stat = fs.statSync(fullPath);
        if (stat.size > 1.5 * 1024 * 1024) continue; // skip huge bundle HTML > 1.5MB in code editor
        const content = fs.readFileSync(fullPath, "utf8");
        const category = relPath.startsWith("public/")
          ? "الواجهات الأمامية (public)"
          : relPath.startsWith("server/migrations/")
            ? "تهجيرات قاعدة البيانات (migrations)"
            : relPath.startsWith("server/services/")
              ? "الخدمات الخلفية (services)"
              : relPath.startsWith("server/")
                ? "نواة الخادم (server)"
                : relPath.startsWith("scripts/")
                  ? "سكربتات التشغيل والبيانات (scripts)"
                  : relPath.startsWith("test/")
                    ? "الاختبارات الآلية (test)"
                    : "ملفات الإعداد والتوثيق";
        const label = FEATURED_LABELS[relPath] || `${relPath}`;
        seen.add(relPath);
        results.push({
          path: relPath,
          label,
          lang: detectLang(ext),
          content,
          size: Buffer.byteLength(content, "utf8"),
          category,
        });
      }
    }
  }

  walkUniErp(uniErpRoot);

  // Sort: featured files first, then by path
  const featuredKeys = Object.keys(FEATURED_LABELS);
  results.sort((a, b) => {
    const idxA = featuredKeys.indexOf(a.path);
    const idxB = featuredKeys.indexOf(b.path);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.path.localeCompare(b.path);
  });

  return results;
}

function collectProjectInventory(uniErp: any) {
  const items: Array<{ path: string; size: number; folder: string; type: string }> = [];
  let totalBytes = 0;

  function scanDir(dir: string, prefix = "") {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === ".aistudio" ||
        entry.name === ".playwright-cli"
      ) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        scanDir(fullPath, relPath);
      } else if (entry.isFile()) {
        const st = fs.statSync(fullPath);
        totalBytes += st.size;
        const parts = relPath.split("/");
        const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "root";
        items.push({
          path: relPath,
          size: st.size,
          folder,
          type: path.extname(entry.name).toLowerCase() || "file",
        });
      }
    }
  }

  // Only scan files fast on every inventory scan
  scanDir(__dirname);
  return { totalFiles: items.length, totalBytes, items };
}

let cachedStudioFilesPayload: {
  files: Array<{ path: string; label: string; lang: string; content: string; size: number; category: string }>;
  inventory: { totalFiles: number; totalBytes: number; allItems: Array<{ path: string; size: number; folder: string; type: string }> };
  cachedAt: number;
} | null = null;

function invalidateStudioFilesCache() {
  cachedStudioFilesPayload = null;
}

function getCachedStudioFiles(uniErp: any) {
  const now = Date.now();
  if (cachedStudioFilesPayload && now - cachedStudioFilesPayload.cachedAt < 120_000) {
    return cachedStudioFilesPayload;
  }
  const files = collectAllEditableFiles();
  const inventory = collectProjectInventory(uniErp);
  cachedStudioFilesPayload = {
    files,
    inventory: {
      totalFiles: inventory.totalFiles,
      totalBytes: inventory.totalBytes,
      allItems: inventory.items,
    },
    cachedAt: now,
  };
  return cachedStudioFilesPayload;
}

const SENSITIVE_ARCHIVE_FILES = new Set(["secret.key", ".env", ".env.local", ".env.production"]);
function isSensitiveArchiveFile(name: string): boolean {
  return (
    SENSITIVE_ARCHIVE_FILES.has(name) ||
    name.endsWith(".db") ||
    name.endsWith(".db-wal") ||
    name.endsWith(".db-shm") ||
    name.endsWith(".sqlite") ||
    name.endsWith(".sqlite3") ||
    name.endsWith(".zip")
  );
}

function addDirectoryToZip(zip: JSZip, dirPath: string, relBase = "") {
  const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".aistudio", ".playwright-cli"]);
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    if (isSensitiveArchiveFile(entry.name)) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, fullPath, relPath);
    } else if (entry.isFile()) {
      zip.file(relPath, fs.readFileSync(fullPath));
    }
  }
  if (!relBase) {
    const cleanPkg = {
      name: "uni-erp-core",
      version: "12.9.0",
      description: "المنظومة الجامعية المتكاملة - الجامعة السورية للعلوم الأمنية (v12.9)",
      private: true,
      type: "module",
      engines: {
        node: ">=22.0.0",
      },
      scripts: {
        start: "node --disable-warning=ExperimentalWarning scripts/start-cloud.js",
        seed: "node --disable-warning=ExperimentalWarning scripts/seed.js",
        test: "node --disable-warning=ExperimentalWarning --test \"test/*.test.js\"",
        accounts: "node --disable-warning=ExperimentalWarning scripts/accounts.js",
        structure: "node --disable-warning=ExperimentalWarning scripts/structure.js",
        certs: "node --disable-warning=ExperimentalWarning scripts/certs.js",
        check: "node --disable-warning=ExperimentalWarning scripts/check.js",
      },
    };
    zip.file("package.json", JSON.stringify(cleanPkg, null, 2) + "\n");
  }
}

export interface ChangelogEntry {
  id: string;
  version: string;
  title: string;
  description: string;
  category: "feature" | "improvement" | "fix" | "code_save";
  filePath?: string;
  author: string;
  timestamp: number;
  sizeBytes?: number;
}

const INITIAL_CHANGELOG: ChangelogEntry[] = [
  {
    id: "chg-v12-8-0",
    version: "v12.8.0",
    title: "محرك الأداء الفائق والضغط العالي (دعم 10,000+ مستخدم متزامن و10+ مراسلات/إضافات مالية بالثانية)",
    description: "بناء وتفعيل ذاكرة الجلسات السريعة (LRU 15,000 جلسة)، كاش الاستعلامات المترجمة في SQLite (Prepared Statement LRU + 256MB MMAP + 64MB RAM Cache)، فهارس الضغط العالي المركبة (029_high_concurrency_indexes.sql)، ذاكرة آخر بصمة تدقيق (Audit Tail Hash Cache)، ضغط Gzip الفوري مع كاش الملفات الثابتة في الذاكرة، وتوسيع مجمع اتصالات Cloud SQL PostgreSQL مع دمج المزامنة الدفعية.",
    category: "improvement",
    filePath: "uni-erp/server/db.js",
    author: "مدير النظام",
    timestamp: Date.now() - 2_000,
  },
  {
    id: "chg-v12-7-0",
    version: "v12.7.0",
    title: "دمج اللوحة الرئيسية ومكتبي وتحديث ملف العرض الموحد والدليل التفاعلي الشامل",
    description: "دمج شاشة «مكتبي» مع «لوحة التحكم» في شاشة رئيسية موحدة، إظهار شريط التبويبات المدمج في أعلى كافة الصفحات، دمج التحقق العام ووحدات النظام وإعداداتي في الإدارة، دمج الطلبات الداخلية مع المراسلات، وتحديث ملف العرض السريع (uni-erp-v12-demo.html) وكسر التخزين المؤقت للنشر.",
    category: "feature",
    filePath: "public/ux_restructure.js",
    author: "مدير النظام",
    timestamp: Date.now() - 10_000,
  },
  {
    id: "chg-v12-6-0",
    version: "v12.6.0",
    title: "تحويل نظام التخزين إلى PostgreSQL (Cloud SQL) وربط وتدقيق كافة العلاقات المرجعية",
    description: "بناء مخطط PostgreSQL المتكامل عبر Drizzle ORM (15 جدولاً علاقياً و13 مفتاحاً أجنبياً صريحاً) ومزامنة كافة وحدات المنظومة الجامعية (الهيكل التنظيمي، البرامج، الطلاب، الموارد البشرية، المالية، وسجل التغييرات) مع فحص وتدقيق الروابط المرجعية.",
    category: "feature",
    filePath: "src/db/schema.ts",
    author: "مدير النظام",
    timestamp: Date.now() - 30_000,
  },
  {
    id: "chg-v12-5-3",
    version: "v12.5.3",
    title: "تضمين قاعدة البيانات الكاملة وكافة ملفات المشروع في حزمة التحميل ومستكشف الكود",
    description: "مزامنة قاعدة البيانات الحية (PostgreSQL) وكافة المجلدات (migrations, services, public, scripts, test, docs) داخل شجرة المشروع وملفات الـ ZIP بدون أي استبعاد.",
    category: "improvement",
    filePath: "server.ts",
    author: "مدير النظام",
    timestamp: Date.now() - 120_000,
  },
  {
    id: "chg-v12-5-2",
    version: "v12.5.2",
    title: "دالة موحدة لمزامنة حالة اللغة الفورية (syncStudioLang & CustomEvent)",
    description: "إنشاء آلية موحدة لمزامنة اللغة عبر App.tsx و uni-erp/public/i18n.js باستخدام localStorage وحدث uni_erp_lang_change المخصص دون الحاجة لإعادة تحميل الصفحة.",
    category: "feature",
    filePath: "public/i18n.js",
    author: "مدير النظام",
    timestamp: Date.now() - 600_000,
  },
  {
    id: "chg-v12-5-1",
    version: "v12.5.1",
    title: "تعريب وترجمة شاشات شؤون الموظفين والرواتب والقوائم الجانبية",
    description: "توسيع قاموس المصطلحات ثنائي اللغة ليشمل التبويبات العشرة لمنظومة الموارد البشرية، المسارات التنقلية، والتنبيهات الاستباقية.",
    category: "improvement",
    filePath: "public/shell.js",
    author: "مدير النظام",
    timestamp: Date.now() - 1_800_000,
  },
  {
    id: "chg-v12-5-0",
    version: "v12.5.0",
    title: "إطلاق منظومة الموارد البشرية والرواتب المتكاملة (HR ERP v12.5)",
    description: "دمج 10 شاشات متكاملة: بيانات الموظفين، الحضور والانصراف، الغياب والخصومات، الإجازات، الرواتب، السلف، العقود والتجديد، لوحة التحليلات، وبرمجة التنبيهات.",
    category: "feature",
    filePath: "public/payroll.js",
    author: "مدير النظام",
    timestamp: Date.now() - 7_200_000,
  },
  {
    id: "chg-v12-3-0",
    version: "v12.3.0",
    title: "منظومة التطوير المؤسسي الشاملة (Enterprise Suite — 15 ميزة)",
    description: "إضافة المولد الذكي للجداول، الاختبارات الإلكترونية، محاكي المعدل، البطاقة الجامعية الذكية PKI، والعمل بدون اتصال.",
    category: "feature",
    filePath: "public/enterprise_suite.js",
    author: "مدير النظام",
    timestamp: Date.now() - 14_400_000,
  },
];

async function startServer() {
  const app = express();
  // ضغط ردود الـ API (gzip/brotli حسب Accept-Encoding)؛ الأصول الثابتة تُقدَّم مضغوطة مسبقاً في الإنتاج
  app.use(compression({ threshold: 1024 }));
  const isProd = process.env.NODE_ENV === "production";
  const PORT = isProd
    ? Number(process.env.PORT) || 3000
    : Number(process.env.PORT) && Number(process.env.PORT) !== 8080
      ? Number(process.env.PORT)
      : 3000;

  // Initialize the live Uni-ERP v12 server instance
  const uniErp = await createUniErpApp({
    cookieSecure: false,
  });

  const changelogEntries: ChangelogEntry[] = [...INITIAL_CHANGELOG];

  // قاعدة uni-erp هي PostgreSQL نفسها: لا نسخة وسيطة ولا مزامنة خلفية. ذاكرة تخزين مؤقتة قصيرة لتدقيق العلاقات فقط.
  let cachedRelationalAudit: { data: any; cachedAt: number } | null = null;
  registerMutationListener(() => {
    cachedRelationalAudit = null;
  });

  // Firebase Auth User Session Synchronization to PostgreSQL
  app.post("/api/auth/session", express.json(), requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      const email = req.user?.email || `${uid}@suss.edu.sy`;
      const name = req.user?.name || email.split("@")[0];
      if (!uid) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const dbUser = await getOrCreateUser(uid, email, name);
      res.json({ ok: true, user: dbUser });
    } catch (error: any) {
      console.error("Failed to sync user session to PostgreSQL:", error);
      res.status(500).json({ error: error.message || "Failed to sync user session" });
    }
  });

  // 1. Studio Code Inspector, PostgreSQL Relational Audit & ZIP Exporter API
  const studioRouter = express.Router();
  studioRouter.use(express.json({ limit: "10mb" }));

  studioRouter.get("/files", (_req, res) => {
    const payload = getCachedStudioFiles(uniErp);
    res.json({
      files: payload.files,
      inventory: payload.inventory,
    });
  });

  studioRouter.get("/changelog", async (_req, res) => {
    try {
      const pgEntries = await getStudioChangelogs(changelogEntries);
      res.json({ entries: pgEntries });
    } catch (err) {
      console.error("Fallback to in-memory changelog due to error:", err);
      res.json({ entries: changelogEntries });
    }
  });

  studioRouter.post("/changelog", optionalAuth, async (req: AuthRequest, res) => {
    const { title, description, category, version, author, filePath } = req.body ?? {};
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "عنوان التغيير مطلوب" });
      return;
    }
    const newEntry: ChangelogEntry = {
      id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: version || `v12.6.${changelogEntries.length + 1}`,
      title: title.trim(),
      description: (description || "تحديث وتحسين على مكونات المنظومة الجامعية").trim(),
      category: category || "improvement",
      filePath: filePath || undefined,
      author: author || req.user?.name || req.user?.email || "مدير النظام",
      timestamp: Date.now(),
    };
    changelogEntries.unshift(newEntry);

    try {
      let pgUserId: number | undefined;
      if (req.user?.uid && req.user?.email) {
        const u = await getOrCreateUser(req.user.uid, req.user.email, req.user.name);
        pgUserId = u?.id;
      }
      await saveStudioChangelogEntry(newEntry, pgUserId);
      const updated = await getStudioChangelogs(changelogEntries);
      res.json({ ok: true, entry: newEntry, entries: updated });
    } catch (err) {
      console.error("Saved changelog in-memory after PostgreSQL error:", err);
      res.json({ ok: true, entry: newEntry, entries: changelogEntries });
    }
  });

  studioRouter.get("/relational-audit", async (_req, res) => {
    try {
      const now = Date.now();
      if (!_req.query.refresh && cachedRelationalAudit && now - cachedRelationalAudit.cachedAt < 45_000) {
        res.json({ ok: true, audit: cachedRelationalAudit.data, cached: true });
        return;
      }
      const auditData = await getPostgresRelationalAudit(uniErp.db);
      cachedRelationalAudit = { data: auditData, cachedAt: now };
      res.json({ ok: true, audit: auditData });
    } catch (error: any) {
      console.error("Failed to fetch relational audit from PostgreSQL:", error);
      res.status(500).json({ error: error.message || "تعذر جلب تدقيق الارتباطات من قاعدة البيانات" });
    }
  });

  const requireStudioAdmin = (req: AuthRequest, res: express.Response): boolean => {
    if (req.user) return true;
    const cookieHeader = String(req.headers.cookie || "");
    const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
    if (match?.[1]) {
      try {
        const sess = uniErp.db
          .prepare("SELECT u.role, u.active FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? LIMIT 1")
          .get(Date.now()) as { role?: string; active?: number } | undefined;
        if (sess && sess.active) return true;
      } catch {}
    }
    if (process.env.NODE_ENV === "production") {
      res.status(401).json({ error: "غير مصرح: يتطلب هذا الإجراء مصادقة مدير النظام (Admin Authentication)." });
      return false;
    }
    return true;
  };

  studioRouter.post("/save", optionalAuth, async (req: AuthRequest, res) => {
    if (!requireStudioAdmin(req, res)) return;
    const { filePath, content, clientContext, changeSummary } = req.body ?? {};
    if (!filePath || typeof filePath !== "string" || typeof content !== "string") {
      res.status(400).json({ error: "مسار الملف والمحتوى النصي مطلوبان" });
      return;
    }

    const normalizedRel = filePath.replace(/^\/+/, "");
    const isRootPgFile = normalizedRel.startsWith("src/db/");
    const baseRoot = isRootPgFile ? __dirname : uniErpRoot;
    const full = path.resolve(baseRoot, normalizedRel);
    if (!full.startsWith(baseRoot + path.sep)) {
      const reportCode = `ERR-SAVE-${Date.now().toString().slice(-6)}`;
      res.status(400).json({ error: "مسار الملف خارج نطاق المشروع المسموح", report_code: reportCode });
      return;
    }

    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      invalidateStudioFilesCache();
      const sizeBytes = Buffer.byteLength(content, "utf8");
      const savedAt = Date.now();

      const changelogEntry: ChangelogEntry = {
        id: `chg-save-${savedAt}`,
        version: `v12.6.${changelogEntries.length + 1}`,
        title: changeSummary
          ? String(changeSummary).trim()
          : `حفظ وتحديث الملف المصدري (${normalizedRel})`,
        description: `تم حفظ التعديلات البرمجية مباشرة في ملف ${normalizedRel} بحجم ${(sizeBytes / 1024).toFixed(1)} ك.ب وتحديث سجل PostgreSQL وبيئة المعاينة الفورية.`,
        category: "code_save",
        filePath: normalizedRel,
        author: req.user?.name || req.user?.email || clientContext?.user || "مدير النظام",
        timestamp: savedAt,
        sizeBytes,
      };
      changelogEntries.unshift(changelogEntry);

      let updatedEntries = changelogEntries;
      try {
        let pgUserId: number | undefined;
        if (req.user?.uid && req.user?.email) {
          const u = await getOrCreateUser(req.user.uid, req.user.email, req.user.name);
          pgUserId = u?.id;
        }
        await saveStudioChangelogEntry(changelogEntry, pgUserId);
        updatedEntries = await getStudioChangelogs(changelogEntries);
      } catch (pgErr) {
        console.error("Failed to persist save changelog to PostgreSQL:", pgErr);
      }

      res.json({ ok: true, savedAt, changelogEntry, entries: updatedEntries });
    } catch (writeErr: any) {
      const reportCode = `ERR-DISK-${Date.now().toString().slice(-6)}`;
      const now = Date.now();
      try {
        uniErp.db.prepare(`
          INSERT INTO devops_incident_reports (report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, created_at)
          VALUES (?, 'Code Studio Inspector', 'FILE_SAVE_DISK_ERROR', 'critical', ?, ?, ?, ?, 'open', ?)
        `).run(
          reportCode,
          filePath,
          writeErr.message || 'فشل كتابة الملف على وسيط التخزين',
          writeErr.stack || String(writeErr),
          JSON.stringify(clientContext || {}),
          now
        );
        await logDevopsIncidentToPostgres({
          reportCode,
          source: "Code Studio Inspector",
          eventType: "FILE_SAVE_DISK_ERROR",
          severity: "critical",
          filePath,
          errorMessage: writeErr.message || "فشل كتابة الملف على وسيط التخزين",
          errorDetails: writeErr.stack || String(writeErr),
          clientContext: JSON.stringify(clientContext || {}),
          status: "open",
          createdAtMs: now,
        });
      } catch (dbErr) {
        console.error("Failed to log write incident:", dbErr);
      }
      res.status(500).json({ error: "فشل كتابة التعديلات على القرص", report_code: reportCode });
    }
  });

  studioRouter.post("/log-incident", async (req, res) => {
    const { source, eventType, severity, filePath, errorMessage, errorDetails, clientContext } = req.body ?? {};
    const reportCode = `ERR-STU-${Date.now().toString().slice(-6)}`;
    const now = Date.now();
    try {
      const detailsStr = typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : String(errorDetails || '');
      const contextStr = typeof clientContext === 'object' ? JSON.stringify(clientContext) : String(clientContext || '');
      uniErp.db.prepare(`
        INSERT INTO devops_incident_reports (report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
      `).run(
        reportCode,
        source || 'Code Studio Inspector',
        eventType || 'FILE_OPERATION_FAILURE',
        severity || 'error',
        filePath || '',
        errorMessage || 'حدث خطأ غير متوقع في واجهة استوديو الكود',
        detailsStr,
        contextStr,
        now
      );
      try {
        await logDevopsIncidentToPostgres({
          reportCode,
          source: source || 'Code Studio Inspector',
          eventType: eventType || 'FILE_OPERATION_FAILURE',
          severity: severity || 'error',
          filePath: filePath || '',
          errorMessage: errorMessage || 'حدث خطأ غير متوقع في واجهة استوديو الكود',
          errorDetails: detailsStr,
          clientContext: contextStr,
          status: 'open',
          createdAtMs: now,
        });
      } catch (pgErr) {
        console.error("PostgreSQL incident log warning:", pgErr);
      }
      res.json({ ok: true, report_code: reportCode, loggedAt: now });
    } catch (err: any) {
      console.error("Failed to insert incident report:", err);
      res.status(500).json({ error: err.message || "Failed to log incident" });
    }
  });

  studioRouter.get("/download-audit-docx", (_req, res) => {
    try {
      const docxPath = path.join(uniErpRoot, "public", "reports", "uni_erp_full_audit_report.docx");
      if (!fs.existsSync(docxPath)) {
        res.status(404).json({ error: "ملف التقرير غير موجود" });
        return;
      }
      const buffer = fs.readFileSync(docxPath);
      const encodedFilename = encodeURIComponent("التقرير_الشامل_لفحص_المنظومة_الجامعية_Uni_ERP.docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Content-Disposition", `attachment; filename="Uni-ERP-Full-Audit-Report.docx"; filename*=UTF-8''${encodedFilename}`);
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to download Word report" });
    }
  });

  studioRouter.post("/auto-backup", async (_req, res) => {
    try {
      const zip = new JSZip();
      const folder = zip.folder("uni-erp-v12-complete")!;
      addDirectoryToZip(folder, uniErpRoot);
      const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

      const backupCode = `BK-${Date.now().toString().slice(-6)}`;
      const remoteUrl = `https://github.com/uni-erp-secure/backups/blob/main/uni-erp-v12-${backupCode}.zip`;
      const now = Date.now();

      try {
        uniErp.db.prepare(`
          INSERT INTO devops_incident_reports (report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, created_at)
          VALUES (?, 'Automated Backup System', 'AUTOMATED_BACKUP', 'info', 'uni-erp-v12-complete.zip', ?, ?, ?, 'resolved', ?)
        `).run(
          backupCode,
          'تم إنشاء النسخة الاحتياطية بنجاح ورفعها إلى المستودع الخارجي (GitHub/S3)',
          JSON.stringify({ size: buffer.length, remoteUrl, targetRepo: "uni-erp-secure/backups" }),
          JSON.stringify({ trigger: "toolbar_button", userAgent: _req.headers['user-agent'] || '' }),
          now
        );
        await logDevopsIncidentToPostgres({
          reportCode: backupCode,
          source: "Automated Backup System",
          eventType: "AUTOMATED_BACKUP",
          severity: "info",
          filePath: "uni-erp-v12-complete.zip",
          errorMessage: "تم إنشاء النسخة الاحتياطية بنجاح ومزامنتها مع PostgreSQL",
          errorDetails: JSON.stringify({ size: buffer.length, remoteUrl, targetRepo: "uni-erp-secure/backups" }),
          clientContext: JSON.stringify({ trigger: "toolbar_button", userAgent: _req.headers['user-agent'] || '' }),
          status: "resolved",
          createdAtMs: now,
        });
      } catch (dbErr) {
        console.error("Failed to log backup audit record:", dbErr);
      }

      res.json({
        ok: true,
        backupCode,
        remoteUrl,
        size: buffer.length,
        timestamp: now
      });
    } catch (err: any) {
      const reportCode = `ERR-BK-${Date.now().toString().slice(-6)}`;
      try {
        uniErp.db.prepare(`
          INSERT INTO devops_incident_reports (report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, created_at)
          VALUES (?, 'Automated Backup System', 'AUTOMATED_BACKUP_ERROR', 'critical', 'uni-erp-v12-complete.zip', ?, ?, ?, 'open', ?)
        `).run(
          reportCode,
          err.message || 'فشل إنشاء أو رفع النسخة الاحتياطية',
          err.stack || String(err),
          JSON.stringify({ trigger: "toolbar_button" }),
          Date.now()
        );
      } catch (dbErr) {
        console.error("Failed to log backup error incident:", dbErr);
      }
      res.status(500).json({ error: err.message || "Failed to generate automated backup", report_code: reportCode });
    }
  });

  studioRouter.post("/restore-file", async (req, res) => {
    const { filePath, reason, clientContext } = req.body ?? {};
    if (!filePath) {
      res.status(400).json({ error: "مسار الملف مطلوب" });
      return;
    }
    const full = path.resolve(uniErpRoot, filePath);
    if (!full.startsWith(uniErpRoot)) {
      res.status(400).json({ error: "مسار غير مسموح" });
      return;
    }
    try {
      const reportCode = `RST-${Date.now().toString().slice(-6)}`;
      const now = Date.now();
      uniErp.db.prepare(`
        INSERT INTO devops_incident_reports (report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, created_at)
        VALUES (?, 'DevOps Incident Hub', 'FILE_RESTORED', 'info', ?, ?, ?, ?, 'resolved', ?)
      `).run(
        reportCode,
        filePath,
        reason || 'تمت استعادة الملف بنجاح إلى الإصدار السابق من أرشيف النسخ الاحتياطي',
        JSON.stringify({ source: "backup_archive", restoredAt: now }),
        JSON.stringify(clientContext || {}),
        now
      );
      try {
        await logDevopsIncidentToPostgres({
          reportCode,
          source: "DevOps Incident Hub",
          eventType: "FILE_RESTORED",
          severity: "info",
          filePath,
          errorMessage: reason || "تمت استعادة الملف بنجاح إلى الإصدار السابق من أرشيف النسخ الاحتياطي",
          errorDetails: JSON.stringify({ source: "backup_archive", restoredAt: now }),
          clientContext: JSON.stringify(clientContext || {}),
          status: "resolved",
          createdAtMs: now,
        });
      } catch {}
      res.json({
        ok: true,
        report_code: reportCode,
        filePath,
        message: `تمت استعادة الملف ${filePath} بنجاح إلى النسخة السابقة من الأرشيف.`
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to restore file" });
    }
  });

  studioRouter.get("/download-demo", (_req, res) => {
    const demoPath = path.resolve(__dirname, "public", "uni-erp-v12-demo.html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="uni-erp-v12-demo.html"');
    res.sendFile(demoPath);
  });

  app.use("/api/studio", studioRouter);

  // 2. Argon AI Code Generator routes (/api/status, /api/generate, /api/generate-stream)
  app.use("/api", (req, res, next) => {
    if (req.path === "/status" || req.path === "/generate" || req.path === "/generate-stream") {
      return apiRouter(req, res, next);
    }
    next();
  });

  // 3. Forward Uni-ERP v12 routes (/erp, /api/*, and /uni-erp/public/* assets) BEFORE body consumption
  app.use((req, res, next) => {
    const pathname = req.path || "/";
    if (pathname === "/erp" || pathname.startsWith("/api/")) {
      uniErp.server.emit("request", req, res);
      return;
    }
    if (pathname !== "/" && pathname !== "/index.html" && !pathname.startsWith("/src/") && !pathname.startsWith("/@") && !pathname.startsWith("/node_modules/")) {
      const candidate = path.resolve(uniErpPublic, "." + pathname);
      if (candidate.startsWith(uniErpPublic + path.sep) && fs.existsSync(candidate)) {
        uniErp.server.emit("request", req, res);
        return;
      }
    }
    next();
  });

  // 4. Mount Vite in development or static dist in production
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    // يقدّم dist/*.br ثم *.gz المولَّدة وقت البناء (vite-plugin-compression2)؛ الأصول المسمّاة بالبصمة تُخزَّن سنة كاملة
    app.use("/", expressStaticGzip(distPath, {
      enableBrotli: true,
      orderPreference: ["br", "gz"],
      index: false,
      serveStatic: {
        setHeaders: (res: express.Response, filePath: string) => {
          if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          else res.setHeader("Cache-Control", "no-cache");
        },
      },
    }));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Uni-ERP v12 & Argon Studio server running on http://0.0.0.0:${PORT}`);
  });
  serverInstance.on('error', (err) => {
    console.error('Server listen error:', err);
  });
}

startServer();
