-- ربط عضو الهيئة التدريسية بحساب دخوله، ليعتمد علامات مقرراته المسندة إليه فقط.
ALTER TABLE faculty_members ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_faculty_members_user ON faculty_members(user_id) WHERE user_id IS NOT NULL;
