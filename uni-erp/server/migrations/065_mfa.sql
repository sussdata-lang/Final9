-- التحقق بخطوتين (TOTP). السر مشفر بمفتاح الخادم، ورموز الاسترداد مجزأة.
ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_last_step BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_recovery_json TEXT;
