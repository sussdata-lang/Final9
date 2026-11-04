// نقطة الدخول السحابية المباشرة لمنظومة Uni-ERP v12 على Railway (بلا اعتماديات خارجية)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

process.env.HOST = process.env.HOST || '0.0.0.0';
// قاعدة البيانات PostgreSQL عبر DATABASE_URL. إذا ركّب Railway قرصاً دائماً على /app/data نحفظ عليه الملفات والسجلات ومفتاح التوقيع والنسخ الاحتياطية
if (fs.existsSync('/app/data')) {
  process.env.UPLOAD_DIR = '/app/data/uploads';
  process.env.LOG_DIR = '/app/data/logs';
}

await import(new URL('../uni-erp/scripts/start-cloud.js', import.meta.url).href);
