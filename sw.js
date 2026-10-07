// 오프라인 캐시: 한 번 열어 두면 인터넷 없이도 번역기 화면과 사전이 열림
// 화면 파일은 인터넷이 되면 항상 최신본을 받고(네트워크 우선), 사전(13MB)은 한 번 받으면 캐시 사용
const VERSION = '2026-10-07a';
const SHELL = 'shell-' + VERSION, DICT = 'dict-' + VERSION;
const SHELL_FILES = ['./', 'index.html', 'sync.js', 'dict-lookup.js', 'manifest.webmanifest',
                     'qrcode.js', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'download.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DICT).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // GitHub API·번역 API는 손대지 않음
  if (/\/setup\//.test(url.pathname)) return;                                // 설치 zip은 캐시하지 않음

  if (/dict-(en|ko)\.js$/.test(url.pathname)) {
    e.respondWith(caches.open(DICT).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }

  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r.ok) (await caches.open(SHELL)).put(e.request, r.clone());
      return r;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === 'navigate') return caches.match('index.html');
      throw new Error('offline');
    }
  })());
});
