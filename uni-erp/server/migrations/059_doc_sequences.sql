-- عدّادات أرقام المستندات: بديل MAX+1 الذي يكرر الرقم عند تعدد عمليات الخادم
CREATE TABLE IF NOT EXISTS doc_sequences (
  key   TEXT PRIMARY KEY,
  value BIGINT NOT NULL
);
