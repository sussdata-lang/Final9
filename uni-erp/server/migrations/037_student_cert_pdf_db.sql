-- احتياط للشهادة الموقعة: تُحفظ في القاعدة إذا تعذّرت الكتابة على القرص (EACCES على قرص Railway المركّب)
ALTER TABLE student_certs ADD COLUMN pdf_b64 TEXT;
