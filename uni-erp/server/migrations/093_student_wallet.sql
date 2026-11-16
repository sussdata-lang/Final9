-- محفظة الطالب الجامعية (مغلقة): رصيد مسبق الدفع يُشحن في المكتب المالي ويُصرف داخل الجامعة فقط
-- (سداد الرسوم، ونقاط البيع في الحرم)، ويُرد عند التخرج أو الانسحاب. لا تحويل بين الطلاب.
-- كل حركة قيد مزدوج في دفتر المالية، والمجموع التزام على الجامعة في حساب «أرصدة محافظ الطلاب».
CREATE TABLE wallets (
  student_id INTEGER PRIMARY KEY REFERENCES users(id),
  pin_hash TEXT,
  pin_set_at BIGINT,
  failed_pins INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  frozen_reason TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

-- المبلغ بالوحدة الصغرى وبإشارته: موجب داخل إلى المحفظة، وسالب خارج منها
CREATE TABLE wallet_txns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('topup', 'fee_payment', 'purchase', 'purchase_refund', 'cash_refund')),
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  merchant_id INTEGER,
  description TEXT NOT NULL DEFAULT '',
  entry_id INTEGER,
  payment_id INTEGER,
  refund_of INTEGER,
  actor_id INTEGER,
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_wallet_txns_student ON wallet_txns(student_id, id DESC);
CREATE INDEX idx_wallet_txns_merchant ON wallet_txns(merchant_id, created_at DESC);

-- نقاط البيع داخل الحرم (المقصف، الطباعة، القرطاسية...) ومن يحق له التحصيل عند كل نقطة
CREATE TABLE wallet_merchants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE TABLE wallet_merchant_operators (
  merchant_id INTEGER NOT NULL REFERENCES wallet_merchants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (merchant_id, user_id)
);

-- حدود المحفظة (تُعدَّل من صفحة المحفظة بصلاحية إعداد المالية)
CREATE TABLE wallet_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- سداد الرسوم من المحفظة يُسجَّل دفعةً بطريقة «محفظة» فتنقص به المستحقات كأي دفعة
ALTER TABLE fin_payments DROP CONSTRAINT IF EXISTS fin_payments_method_check;
ALTER TABLE fin_payments ADD CONSTRAINT fin_payments_method_check CHECK (method IN ('cash', 'bank', 'wallet'));
