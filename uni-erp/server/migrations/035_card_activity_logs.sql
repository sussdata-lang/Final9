-- 035_card_activity_logs.sql
-- واجهة وسجل نشاط البطاقة الجامعية الرقمية الذكية (Check-in / Check-out Logs عبر NFC والباركود المشفر)

CREATE TABLE IF NOT EXISTS sa_card_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  student_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'check_in', -- check_in (دخول) | check_out (خروج) | audit_check (فحص أمني) | denied (مرفوض)
  location_name TEXT NOT NULL, -- البوابة الرئيسية | المكتبة المركزية | قاعة الامتحانات 102 | مختبر الأمن السيبراني والشبكات | مجمع المطاعم والخدمات | البوابة الشمالية
  location_code TEXT NOT NULL, -- GATE-MAIN-01 | LIB-ENTRANCE | HALL-EXAM-102 | LAB-CYB-03 | HUB-CAMPUS | GATE-NORTH-03
  method TEXT NOT NULL DEFAULT 'nfc', -- nfc (شريحة ذكية) | barcode (مسح باركود مشفر)
  terminal_id TEXT NOT NULL, -- TRM-NFC-A1 | SCAN-BC-04 | GATE-READER-09 | LIB-DESK-NFC-2
  status TEXT NOT NULL DEFAULT 'granted', -- granted (مصرح به) | denied (محظور/مرفوض) | warning (تنبيه)
  reason TEXT, -- تعليق التدقيق الأمني
  pki_hash TEXT NOT NULL, -- بصمة التحقق والتشفير المعتمدة
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sa_card_logs_student ON sa_card_activity_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_sa_card_logs_time ON sa_card_activity_logs(created_at DESC);

-- إدراج سجلات افتراضية واقعية حديثة للطالب الأول والطلاب الآخرين
INSERT INTO sa_card_activity_logs (student_id, student_no, student_name, event_type, location_name, location_code, method, terminal_id, status, reason, pki_hash, created_at)
SELECT 1, 'CYB-2026-0001', 'طارق محمود العلي', 'check_in', 'البوابة الرئيسية — الحرم المركزي', 'GATE-MAIN-01', 'nfc', 'TRM-NFC-A1', 'granted', 'تصريح دخول نظامي ساري المفعول', '0x8f2a9c1e4d', strftime('%s','now') * 1000 - 3600000 * 2
WHERE NOT EXISTS (SELECT 1 FROM sa_card_activity_logs WHERE student_id = 1);

INSERT INTO sa_card_activity_logs (student_id, student_no, student_name, event_type, location_name, location_code, method, terminal_id, status, reason, pki_hash, created_at)
VALUES 
  (1, 'CYB-2026-0001', 'طارق محمود العلي', 'check_in', 'مختبر الأمن السيبراني والشبكات', 'LAB-CYB-03', 'barcode', 'SCAN-BC-04', 'granted', 'حضور جلسة عملية معتمدة (مقرر CYB-401)', '0x3c7b12aa9e', strftime('%s','now') * 1000 - 3600000 * 1),
  (1, 'CYB-2026-0001', 'طارق محمود العلي', 'check_out', 'مختبر الأمن السيبراني والشبكات', 'LAB-CYB-03', 'nfc', 'TRM-NFC-L3', 'granted', 'انتهاء الجلسة العملية وخروج نظامي', '0x99e120bc71', strftime('%s','now') * 1000 - 1800000),
  (1, 'CYB-2026-0001', 'طارق محمود العلي', 'check_in', 'المكتبة المركزية — مدخل المطالعة والبحوث', 'LIB-ENTRANCE', 'nfc', 'LIB-DESK-NFC-2', 'granted', 'دخول قاعة المراجع والكتب التخصصية', '0x55a6d38e02', strftime('%s','now') * 1000 - 900000);
