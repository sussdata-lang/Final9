-- معادلة المقررات: من أدخلها ومن بت فيها، لفصل المهام (لا يعتمدها مدخلها)
ALTER TABLE sa_credit_equivalences ADD COLUMN created_by_id INTEGER;
ALTER TABLE sa_credit_equivalences ADD COLUMN decided_by_id INTEGER;
ALTER TABLE sa_credit_equivalences ADD COLUMN decided_at INTEGER;
