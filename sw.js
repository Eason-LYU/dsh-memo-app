// 阿蓝手机端 · 离线外壳
// 缓存页面 + 渲染库 + 表情清单，离线也能打开；记忆包/聊天走网络或 localStorage。
const V = 'alan-mobile-v65';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './stickers.json',
  './vendor/marked.min.js', './vendor/purify.min.js',
  './vendor/katex.min.js', './vendor/auto-render.min.js', './vendor/katex.min.css',
  './vendor/pdf/pdf.min.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(V)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(V).then((c) => c.put('./index.html', copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(V).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});