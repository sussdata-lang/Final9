-- مستودع بيانات خفيف: لقطة شهرية لمؤشرات مؤسسية عابرة للوحدات (أكاديمية، مالية، موارد بشرية،
-- مشتريات، جودة خدمة)، تُحفظ إلى جانب قاعدة التشغيل نفسها دون خدمة أو بنية منفصلة. يُعاد حساب
-- الشهر الحالي يومياً (idempotent)، وتبقى الأشهر المنتهية ثابتة، فيتكوّن تاريخ طويل للمقارنة بين
-- السنوات حتى بعد تغيّر البيانات الخام أو كبر حجمها.
CREATE TABLE wh_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,            -- 'YYYY-MM'
  metric_code TEXT NOT NULL,
  value NUMERIC NOT NULL DEFAULT 0,
  captured_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX idx_wh_metrics_key ON wh_metrics(period, metric_code);
CREATE INDEX idx_wh_metrics_metric ON wh_metrics(metric_code, period);
