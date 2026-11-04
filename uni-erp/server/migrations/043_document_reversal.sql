-- سندات الاستلام والصرف المستوردة: رقم السند يمنع تكراره، والتراجع يبقي السند معكوساً بدل حذفه.
ALTER TABLE proc_receipts ADD COLUMN import_ref TEXT;
ALTER TABLE proc_receipts ADD COLUMN reversed_at INTEGER;
ALTER TABLE proc_receipts ADD COLUMN reversed_by INTEGER;
ALTER TABLE proc_issues ADD COLUMN reversed_at INTEGER;
ALTER TABLE proc_issues ADD COLUMN reversed_by INTEGER;
CREATE UNIQUE INDEX idx_proc_receipts_import_ref ON proc_receipts(import_ref);
