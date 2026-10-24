/* BlitzBook web portal - service worker. Makes the portal installable (iPhone / iPad: Safari > Share > Add to
   Home Screen; Android / desktop Chrome: Install app) and keeps a copy of the app shell so it opens without a
   connection: the books live in the browser's storage anyway, and sync catches up when the connection is back.
   Online, every page and script still comes from the network first, so an update is picked up on the next
   open; the cached copy is only used when the network fails. The APK is never cached. */
const CACHE = 'blitzbook-shell-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './css/app.css', './js/util.js', './js/store.js', './js/subscription.js', './js/appformat.js',
  './js/supabase.js', './js/sync.js', './js/print.js', './js/app.js', './js/invoice.js', './js/ledger.js', './js/money.js', './js/reports.js', './js/gst.js', './js/migrate.js', './js/companies.js', './js/hr.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  // The APK and the app's version file are never served from the cache
  if (req.method !== 'GET' || url.origin !== self.location.origin || /\.(apk|ipa)$/i.test(url.pathname) || /app-version\.json$/.test(url.pathname)) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
