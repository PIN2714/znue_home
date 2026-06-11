/* service-worker.js
   PWA 離線快取(cache-first 策略)+ 版本管理(每次升 CACHE_VERSION 自動清舊)
   - 預先快取所有靜態資源(html/css/js/字型/SortableJS CDN/icon)
   - 不快取 bookmarks.json / health-ledger.json — 那些走 File System Access API,不經 fetch
   - GET 請求 cache-first;cache miss 時 fetch + 動態加入快取
   - 升級新版本時:install 階段 skipWaiting + activate 清舊 caches + claim clients */

const CACHE_VERSION = 'znue-home-v13'; // 加入 AES-256 加密保護書籤資料
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const STATIC_RESOURCES = [
  './',
  './index.html',
  './manifest.json',
  './README.md',
  './css/base.css',
  './css/themes.css',
  './css/layout.css',
  './css/components.css',
  './css/archive.css',
  './css/onboarding.css',
  './js/data.js',
  './js/state.js',
  './js/helpers.js',
  './js/markdown.js',
  './js/webdav.js',
  './js/gist.js',
  './js/crypto.js',
  './js/storage.js',
  './js/theme.js',
  './js/search.js',
  './js/health.js',
  './js/render.js',
  './js/editing.js',
  './js/archive.js',
  './js/dnd.js',
  './js/main.js',
  './assets/icon.svg',
  // 第三方 CDN — 預先快取避免離線時 fail
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
];

// install:預先快取靜態資源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      // addAll 若任一 fail 就整批 fail。逐一 add 並容忍個別失敗(例如 CDN 暫時 unreachable)
      return Promise.all(STATIC_RESOURCES.map(url =>
        cache.add(url).catch(err => console.warn('SW cache miss:', url, err))
      ));
    }).then(() => self.skipWaiting())
  );
});

// activate:清掉舊版本 caches、claim 所有 clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n.startsWith('znue-home-') && n !== STATIC_CACHE)
           .map(n => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

// fetch:cache-first;不攔 bookmarks.json / health-ledger.json(那些是 FSA 讀的本機檔案)
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch(_) { return; }

  // 不快取使用者資料檔(走 FSA,不該被 SW 攔截)
  if (url.pathname.endsWith('/bookmarks.json') ||
      url.pathname.endsWith('/health-ledger.json') ||
      url.pathname.endsWith('/znue_bookmarks.json')) return;

  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(resp => {
        // 動態快取成功 GET 回應(包括 Google Fonts 跟 jsdelivr)
        if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')){
          const respClone = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(req, respClone)).catch(()=>{});
        }
        return resp;
      }).catch(() => {
        // 完全 offline 時若是導航請求 → 回 index.html
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline + no cache');
      });
    })
  );
});

// 接收 main thread 的 message(例如手動清快取、強制更新)
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
