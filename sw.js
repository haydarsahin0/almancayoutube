// Basit çevrimdışı desteği: kendi dosyalarımızı önbelleğe al, ağı öncelikli kullan.
const CACHE = 'almanca-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/main.js', './assets/js/util.js', './assets/js/store.js', './assets/js/ai.js',
  './assets/js/ui.js', './assets/js/word.js', './assets/js/video.js', './assets/js/youtube.js',
  './assets/js/book.js', './assets/js/vocab.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API/proxy istekleri dokunulmadan geçsin
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))),
  );
});
