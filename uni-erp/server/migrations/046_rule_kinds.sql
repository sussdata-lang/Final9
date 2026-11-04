-- أنواع قواعد الفحص الجديدة: قيد CHECK القديم يقصر النوع على أربعة، والتحقق صار في RULE_KINDS.
ALTER TABLE rules DROP CONSTRAINT IF EXISTS rules_new_kind_check;
ALTER TABLE rules DROP CONSTRAINT IF EXISTS rules_kind_check;
