-- التبويبات الفرعية التي أخفاها المدير لحساب بعينه (act:tab). تضيّق العرض ولا تمنح شيئاً.
ALTER TABLE users ADD COLUMN hidden_tabs_json TEXT NOT NULL DEFAULT '[]';
