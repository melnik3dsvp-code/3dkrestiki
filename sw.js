// Минимальный сервис-воркер: нужен браузеру для установки приложения на экран телефона.
// Запросы всегда идут в сеть, чтобы заказы и каталог были актуальными, ничего не кэшируется.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request));
});
