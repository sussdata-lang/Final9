-- حقول نماذج الجامعة الرسمية للمشتريات والمخازن: طلب الشراء، أمر الشراء، مذكرة فحص واستلام المواد،
-- محضر إخراج / صرف المواد، وبيانات تواصل المورّد. كلها اختيارية فلا تتأثر السجلات القائمة.
ALTER TABLE proc_requests ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_requests ADD COLUMN job_title TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_requests ADD COLUMN direct_manager TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_requests ADD COLUMN purchase_threshold TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_requests ADD COLUMN need_day TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_requests ADD COLUMN amount_words TEXT NOT NULL DEFAULT '';

ALTER TABLE proc_request_lines ADD COLUMN budget_code TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_request_lines ADD COLUMN specs TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_request_lines ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_request_lines ADD COLUMN stock_balance INTEGER;

ALTER TABLE proc_suppliers ADD COLUMN contact_person TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_suppliers ADD COLUMN fax TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_suppliers ADD COLUMN mobile TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_suppliers ADD COLUMN specialty TEXT NOT NULL DEFAULT '';

ALTER TABLE proc_orders ADD COLUMN delivery_method TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_orders ADD COLUMN delivery_day TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_orders ADD COLUMN payment_terms TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'ليرة سورية';
ALTER TABLE proc_orders ADD COLUMN delivery_contact TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_orders ADD COLUMN delivery_email TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_orders ADD COLUMN delivery_address TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_orders ADD COLUMN billing_contact TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_orders ADD COLUMN billing_email TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_orders ADD COLUMN sales_tax INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proc_orders ADD COLUMN delivery_tax INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proc_orders ADD COLUMN other_tax INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proc_order_lines ADD COLUMN unit TEXT NOT NULL DEFAULT '';

ALTER TABLE proc_receipts ADD COLUMN received_from TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_receipts ADD COLUMN delivery_note_no TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_receipts ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_receipts ADD COLUMN compliant INTEGER;
ALTER TABLE proc_receipt_lines ADD COLUMN expected_qty INTEGER;
ALTER TABLE proc_receipt_lines ADD COLUMN quality TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_receipt_lines ADD COLUMN comment TEXT NOT NULL DEFAULT '';

ALTER TABLE proc_issues ADD COLUMN request_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_issues ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_issues ADD COLUMN receiver_name TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_issue_lines ADD COLUMN requested_qty INTEGER;
ALTER TABLE proc_issue_lines ADD COLUMN balance_after INTEGER;
ALTER TABLE proc_issue_lines ADD COLUMN item_condition TEXT NOT NULL DEFAULT '';
ALTER TABLE proc_issue_lines ADD COLUMN note TEXT NOT NULL DEFAULT '';
