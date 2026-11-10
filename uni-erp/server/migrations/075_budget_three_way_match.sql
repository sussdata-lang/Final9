-- الموازنة السنوية ومناقلاتها، وربط أوامر التوريد بها، وفواتير المورّدين المطابقة لأمر التوريد والاستلام
CREATE TABLE fin_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_id INTEGER NOT NULL REFERENCES fin_years(id),
  cost_center_id INTEGER NOT NULL REFERENCES fin_cost_centers(id),
  account_id INTEGER NOT NULL REFERENCES fin_accounts(id),
  amount BIGINT NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  approved_by INTEGER,
  approved_at INTEGER,
  UNIQUE (year_id, cost_center_id, account_id)
);
CREATE TABLE fin_budget_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_budget_id INTEGER NOT NULL REFERENCES fin_budgets(id),
  to_budget_id INTEGER NOT NULL REFERENCES fin_budgets(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_fin_budget_transfers_from ON fin_budget_transfers(from_budget_id);
CREATE INDEX idx_fin_budget_transfers_to ON fin_budget_transfers(to_budget_id);

ALTER TABLE proc_orders ADD COLUMN budget_id INTEGER REFERENCES fin_budgets(id);
CREATE INDEX idx_proc_orders_budget ON proc_orders(budget_id);

ALTER TABLE fin_invoices ADD COLUMN order_id INTEGER REFERENCES proc_orders(id);
ALTER TABLE fin_invoices ADD COLUMN supplier_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE fin_invoices ADD COLUMN cost_center_id INTEGER REFERENCES fin_cost_centers(id);
ALTER TABLE fin_invoices ADD COLUMN match_status TEXT CHECK (match_status IN ('matched', 'held', 'override'));
ALTER TABLE fin_invoices ADD COLUMN match_note TEXT NOT NULL DEFAULT '';
ALTER TABLE fin_invoices ADD COLUMN match_by INTEGER;
ALTER TABLE fin_invoices ADD COLUMN post_amount BIGINT;
ALTER TABLE fin_invoices ADD COLUMN received_base BIGINT NOT NULL DEFAULT 0;
CREATE INDEX idx_fin_invoices_order ON fin_invoices(order_id);

CREATE TABLE fin_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES fin_invoices(id) ON DELETE CASCADE,
  order_line_id INTEGER REFERENCES proc_order_lines(id),
  item_id INTEGER REFERENCES proc_items(id),
  description TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price BIGINT NOT NULL CHECK (unit_price > 0)
);
CREATE INDEX idx_fin_invoice_lines_invoice ON fin_invoice_lines(invoice_id);
