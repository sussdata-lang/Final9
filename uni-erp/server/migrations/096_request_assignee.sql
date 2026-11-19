-- إحالة الطلب إلى موظف بعينه (لا إلى وحدة فقط): يراه الموظف ويُبلَّغ به ولو لم تشمله صلاحيات وحدته.
-- الإحالة لوحدة بعدها تلغي التكليف الشخصي.
ALTER TABLE requests ADD COLUMN assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_requests_assignee ON requests(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
