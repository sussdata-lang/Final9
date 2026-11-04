// عامل الخدمة: يجعل التطبيق قابلاً للتثبيت ويسرّع تحميل الملفات الثابتة.
// قاعدة أمنية: لا تُخزَّن أي استجابة من /api/ إطلاقاً (بيانات الطلاب لا تُحفظ في ذاكرة الجهاز).
const VERSION = 'v93';
const CACHE = `uni-erp-static-${VERSION}`;
const PRECACHE = ['/offline.html', '/fonts/tr-cairo-arabic-400.woff2', '/fonts/tr-cairo-arabic-600.woff2', '/fonts/tr-cairo-arabic-700.woff2', '/fonts/tr-cairo-arabic-800.woff2', '/icons/icon-192.png', '/brand/crest.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('uni-erp-static-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/archify/')) return;   // الشبكة مباشرة، دون تخزين

  // التنقل بين الصفحات وملفات الكود (JS/CSS): الشبكة أولاً لضمان ظهور التحديثات فور النشر
  if (req.mode === 'navigate' || /\.(js|css|html)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((netRes) => {
          if (netRes && netRes.ok && req.mode !== 'navigate') {
            caches.open(CACHE).then((c) => c.put(req, netRes.clone())).catch(() => {});
          }
          return netRes;
        })
        .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error())))
    );
    return;
  }

  // الخطوط والأيقونات الثابتة: Cache-First مع تحديث خلفي
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cachedRes) => {
        const netFetch = fetch(req)
          .then((netRes) => {
            if (netRes && netRes.ok) cache.put(req, netRes.clone());
            return netRes;
          })
          .catch(() => cachedRes);
        return cachedRes || netFetch;
      })
    )
  );
});

// تنبيهات الجوال (Web Push): الحمولة مشفَّرة من الخادم وتصل JSON: { title, body, url, tag }
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'إشعار جديد', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'إشعار جديد'), {
    body: String(d.body || ''), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.tag || 'uni', renotify: true, dir: 'rtl', lang: 'ar', data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.focus(); if ('navigate' in c) c.navigate(url).catch(() => {}); return null; }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage({ type: 'push-resubscribe' }))));
});
