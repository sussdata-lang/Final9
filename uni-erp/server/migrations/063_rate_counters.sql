-- حدود معدل الطلبات مشتركة بين عمليات الخادم. لا حاجة لبقائها بعد إعادة تشغيل القاعدة.
CREATE UNLOGGED TABLE IF NOT EXISTS rate_counters (
  key        TEXT PRIMARY KEY,
  count      BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
