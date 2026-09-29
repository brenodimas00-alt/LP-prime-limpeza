// P4: service worker da agenda da profissional (escopo /diarista/). Conexão ruim: a agenda abre pelo que ficou salvo.
// - Páginas e arquivos do próprio site: rede primeiro, cópia local se a rede falhar (sempre a versão nova quando há sinal).
// - Nada de outra origem (Supabase, ViaCEP) passa por aqui: dado da agenda fica no próprio app (localStorage, só do dia)
//   e os check-ins sem sinal esperam numa fila com chave de idempotência (src/ui/paginas/agenda-diarista.js).
const CACHE = 'prime-agenda-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./agenda/'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then((r) => r || Response.error())));
});
