-- إشعارات داخل الموقع لكل مستخدم، على نمط corr_notifs. تعمل بديلاً لمن لم يفعّل Web Push.
-- الفهرس الفريد يمنع تكرار الإشعار نفسه عند تشغيل المهمة المجدولة من أكثر من عملية.
CREATE TABLE user_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id INTEGER,
  text TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '/',
  at BIGINT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0,1))
);
CREATE INDEX idx_user_notifications_user ON user_notifications(user_id, read, at);
CREATE UNIQUE INDEX idx_user_notifications_once ON user_notifications(user_id, kind, ref_id) WHERE ref_id IS NOT NULL;
