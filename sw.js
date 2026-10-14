// 이전 버전의 오프라인 캐시(서비스워커)를 지우기 위한 파일
// 영어 데스크는 이제 이 기기에 아무것도 저장하지 않으므로, 예전에 설치된 서비스워커가 이 파일로 갱신되면
// 저장해 둔 캐시를 모두 지우고 스스로 등록을 해제함
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
