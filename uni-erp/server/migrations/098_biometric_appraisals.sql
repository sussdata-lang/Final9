-- أجهزة البصمة والحضور الحيوي بكامل تعريفها، وربط الموظفين بها، وسجل الحركات الخام؛ وتقييم أداء شامل بمحاور ومسؤوليات.

-- ===== أجهزة البصمة: كل ما يلزم لتعريف الجهاز وربطه =====
ALTER TABLE hr_biometric_devices ADD COLUMN name TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN brand TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN model TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN serial_no TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN mac_address TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN port INTEGER;
-- push_adms: الجهاز يرسل إلى /iclock (ZKTeco ADMS) · push_http: يرسل JSON برمز الجهاز · usb_import: ملف يُصدَّر من الجهاز ويُستورد
ALTER TABLE hr_biometric_devices ADD COLUMN comm_type TEXT NOT NULL DEFAULT 'push_adms';
ALTER TABLE hr_biometric_devices ADD COLUMN direction TEXT NOT NULL DEFAULT 'both';
ALTER TABLE hr_biometric_devices ADD COLUMN verify_modes TEXT NOT NULL DEFAULT 'fingerprint';
ALTER TABLE hr_biometric_devices ADD COLUMN unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL;
ALTER TABLE hr_biometric_devices ADD COLUMN building TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN firmware TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN installed_on TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN warranty_until TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN restrict_ip INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_biometric_devices ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hr_biometric_devices ADD COLUMN notes TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN token_hash TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN token_last4 TEXT;
ALTER TABLE hr_biometric_devices ADD COLUMN created_at INTEGER;
ALTER TABLE hr_biometric_devices ADD COLUMN updated_at INTEGER;
CREATE UNIQUE INDEX idx_hr_bio_serial ON hr_biometric_devices(serial_no) WHERE serial_no IS NOT NULL;

-- رقم الموظف على أجهزة البصمة (PIN) ورقم بطاقته: يُسجَّل الموظف بالرقم نفسه على كل الأجهزة
CREATE TABLE hr_biometric_users (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin TEXT NOT NULL UNIQUE,
  card_no TEXT,
  methods TEXT,
  updated_at INTEGER NOT NULL
);

-- كل حركة كما وصلت من الجهاز: تُطبَّق على الدوام بوقتها الفعلي، وتبقى غير المربوطة ظاهرة لتُربط
CREATE TABLE hr_biometric_punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER REFERENCES hr_biometric_devices(id) ON DELETE SET NULL,
  pin TEXT NOT NULL,
  punched_at INTEGER NOT NULL,
  verify_mode TEXT,
  direction TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'unmapped')),
  source TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE (device_id, pin, punched_at)
);
CREATE INDEX idx_hr_bio_punches_time ON hr_biometric_punches(punched_at);
CREATE INDEX idx_hr_bio_punches_unmapped ON hr_biometric_punches(pin) WHERE status = 'unmapped';

-- ===== تقييم الأداء الشامل =====
ALTER TABLE hr_appraisals ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hr_appraisals ADD COLUMN job_title TEXT;
ALTER TABLE hr_appraisals ADD COLUMN period_from TEXT;
ALTER TABLE hr_appraisals ADD COLUMN period_to TEXT;
ALTER TABLE hr_appraisals ADD COLUMN is_supervisor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_appraisals ADD COLUMN scores_json TEXT;
ALTER TABLE hr_appraisals ADD COLUMN responsibilities_json TEXT;
ALTER TABLE hr_appraisals ADD COLUMN attendance_pct REAL;
ALTER TABLE hr_appraisals ADD COLUMN strengths TEXT;
ALTER TABLE hr_appraisals ADD COLUMN improvements TEXT;
ALTER TABLE hr_appraisals ADD COLUMN training_needs TEXT;
ALTER TABLE hr_appraisals ADD COLUMN goals_next TEXT;
ALTER TABLE hr_appraisals ADD COLUMN grade TEXT;
ALTER TABLE hr_appraisals ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE hr_appraisals ADD COLUMN evaluator_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hr_appraisals ADD COLUMN approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hr_appraisals ADD COLUMN approved_at INTEGER;
ALTER TABLE hr_appraisals ADD COLUMN employee_comment TEXT;
ALTER TABLE hr_appraisals ADD COLUMN acknowledged_at INTEGER;
ALTER TABLE hr_appraisals ADD COLUMN updated_at INTEGER;
