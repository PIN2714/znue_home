/* webdav.js
   極簡 WebDAV 客戶端 — 給 znue_home 用來把 bookmarks.json 存在 NAS。
   - HTTP Basic Auth (Authorization: Basic base64(user:pass))
   - 樂觀並行控制:read 取 ETag,write 用 If-Match header,server 回 412 = 衝突
   - 所有請求有 10 秒 timeout(AbortController)
   - 不解 XML,直接走 file-level GET/PUT(WebDAV 對單檔操作就是普通 HTTP)
   依賴:無(純 fetch + IndexedDB by storage.js) */

const WEBDAV_TIMEOUT_MS = 10000;

function _wdAuthHeader(user, pass){
  // btoa 不支援多 byte 字元,先 encodeURIComponent 再 unescape 轉成單 byte 序列
  return 'Basic ' + btoa(unescape(encodeURIComponent((user || '') + ':' + (pass || ''))));
}

async function _wdFetch(url, opts, creds){
  const headers = new Headers(opts.headers || {});
  if (creds && creds.user) headers.set('Authorization', _wdAuthHeader(creds.user, creds.pass));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBDAV_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      headers,
      signal: controller.signal,
      credentials: 'omit',  // 不送 cookies(用 Authorization header 認證)
      mode: 'cors',
    });
  } finally {
    clearTimeout(timer);
  }
}

/* GET — 讀檔
   回傳 { exists, content, etag, lastModified } 或 { exists: false } */
async function webdavGet(url, creds){
  const resp = await _wdFetch(url, { method: 'GET', cache: 'no-store' }, creds);
  if (resp.status === 404) return { exists: false };
  if (resp.status === 401) throw new Error('帳號或密碼錯誤(401 Unauthorized)');
  if (resp.status === 403) throw new Error('沒權限存取此檔案(403 Forbidden)');
  if (!resp.ok) throw new Error(`WebDAV GET 失敗 ${resp.status} ${resp.statusText}`);
  const text = await resp.text();
  return {
    exists: true,
    content: text,
    etag: resp.headers.get('ETag') || '',
    lastModified: resp.headers.get('Last-Modified') || '',
  };
}

/* HEAD — 只查 metadata 不下載內容(test connection / 取 ETag) */
async function webdavHead(url, creds){
  const resp = await _wdFetch(url, { method: 'HEAD' }, creds);
  return {
    ok: resp.ok,
    status: resp.status,
    etag: resp.headers.get('ETag') || '',
    lastModified: resp.headers.get('Last-Modified') || '',
  };
}

/* PUT — 寫檔
   ifMatchEtag 非空時,server 比對 ETag,若不符回 412 → { conflict: true }
   回傳 { ok, etag } 或 { conflict: true, status: 412 } */
async function webdavPut(url, creds, content, ifMatchEtag){
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (ifMatchEtag) headers['If-Match'] = ifMatchEtag;
  const resp = await _wdFetch(url, { method: 'PUT', headers, body: content }, creds);
  if (resp.status === 412) return { conflict: true, status: 412 };
  if (resp.status === 401) throw new Error('帳號或密碼錯誤(401 Unauthorized)');
  if (resp.status === 403) throw new Error('沒權限寫入(403 Forbidden)');
  // 200/201/204 都算成功
  if (!resp.ok && resp.status !== 201 && resp.status !== 204){
    throw new Error(`WebDAV PUT 失敗 ${resp.status} ${resp.statusText}`);
  }
  // 部分 server PUT 後不會回 ETag,需要再 HEAD 一次拿新 ETag(否則下次 PUT 用空 ETag 等於沒並行控制)
  let etag = resp.headers.get('ETag') || '';
  if (!etag){
    try {
      const h = await webdavHead(url, creds);
      etag = h.etag || '';
    } catch(_){}
  }
  return { ok: true, etag };
}

/* 測試連線 — onboarding 用
   回傳 { ok, exists, etag, error? } */
async function webdavTest(url, creds){
  try {
    const h = await webdavHead(url, creds);
    if (h.ok) return { ok: true, exists: true, etag: h.etag };
    if (h.status === 404) return { ok: true, exists: false, etag: '' };  // 連線 OK,只是檔案還不存在(第一次用)
    if (h.status === 401) return { ok: false, error: '帳號或密碼錯誤(401)' };
    if (h.status === 403) return { ok: false, error: '沒權限存取(403)' };
    return { ok: false, error: `HTTP ${h.status}` };
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '連線逾時(10 秒)' : (e.message || String(e));
    return { ok: false, error: msg };
  }
}
