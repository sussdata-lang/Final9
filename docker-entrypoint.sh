#!/bin/sh
# Railway يركّب القرص الدائم (/app/data) بملكية root، فيفشل المستخدم node في الكتابة (EACCES) عند رفع/توليد الملفات
# (مثل /app/data/uploads/certs/*.pdf). نصلح الملكية والصلاحيات أولاً (نبدأ كـ root) ثم نُسقط الصلاحيات إلى node.
set -e
if [ "$(id -u)" = "0" ]; then
  for d in /app/data /app/data/uploads /app/data/uploads/certs /app/data/logs /app/data/backups /app/uploads /app/logs /app/backups; do
    mkdir -p "$d"
  done
  for d in /app/data /app/uploads /app/logs /app/backups; do
    chown -R node:node "$d" || echo "[entrypoint] تحذير: تعذّر chown على $d" >&2
    chmod -R u+rwX "$d"    || echo "[entrypoint] تحذير: تعذّر chmod على $d" >&2
  done
  chmod 700 /app/data 2>/dev/null || true
  # تحقق فعلي: هل يستطيع node الكتابة داخل مجلد الشهادات؟ إن لم يستطع لا نترك التطبيق يفشل لاحقاً بصمت
  PROBE=/app/data/uploads/certs/.write-probe
  if su-exec node:node sh -c "touch '$PROBE' && rm -f '$PROBE'" 2>/dev/null; then
    exec su-exec node:node "$@"
  fi
  echo "[entrypoint] تحذير: المستخدم node لا يستطيع الكتابة في /app/data رغم chown (قيود القرص المركَّب)." >&2
  echo "[entrypoint] التشغيل بصلاحيات root كحل احتياطي. الأفضل ضبط RAILWAY_RUN_UID=0 أو تصحيح ملكية القرص." >&2
  exec "$@"
fi
exec "$@"
