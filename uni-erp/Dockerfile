FROM node:22-alpine
WORKDIR /app
# pg_dump/pg_restore مطلوبان للنسخ الاحتياطي (BACKUP_AUTO)
RUN apk add --no-cache postgresql-client su-exec
# الاعتمادية الوحيدة: pg (عميل PostgreSQL). تُثبَّت قبل نسخ الشيفرة لتستفيد من كاش الطبقات
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node . .
# ضغط مسبق (Brotli مستوى 11 + Gzip) للملفات الثابتة: يقلّل حجم النقل نحو 75% ويلغي كلفة الضغط عند أول طلب
RUN node scripts/precompress.js
RUN cp docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p data uploads logs backups && chown -R node:node /app && chmod 700 data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
# يبدأ كـ root لإصلاح ملكية القرص المركَّب ثم يُسقط الصلاحيات إلى node (انظر docker-entrypoint.sh)
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
VOLUME /app/data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "scripts/start-cloud.js"]
