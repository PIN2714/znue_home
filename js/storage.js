/* storage.js
   File System Access API + IndexedDB + WebDAV(Synology NAS) + GitHub Gist
   - 第一次開啟:顯示 onboarding,讓使用者選儲存模式
   - 之後開啟:從 IndexedDB 讀回 file handle / WebDAV config / Gist config,自動載入
   - 每次 DATA 改動透過 markDirty() 觸發 debounced 寫回
   - health-ledger.json 也用同套機制(可選,僅 FSA 模式)
   依賴:DATA、HEALTH_DATA、helpers、render(renderSections / renderHealthBar)、theme(applyTheme)、webdav.js、gist.js

   IndexedDB schema (v3):
     DB: znue_home_handles
     store: handles  — FSA FileSystemFileHandle,keys: 'bookmarks' / 'health'
     store: config   — 後端設定,key: 'webdav' → { url, user, pass }
                                  key: 'gist'  → { gistId, token }
     store: cache    — 離線書籤快取,key: 'bookmarks' → { content, etag, cachedAt }
     store: local    — IDB 本機模式,key: 'bookmarks' → JSON string */

const HANDLE_DB = 'znue_home_handles';
const HANDLE_DB_VERSION = 3;
const SAVE_DEBOUNCE_MS = 500;
const DEFAULT_HEALTH_PAGE_URL = '../health_pwa/index.html';
// File System Access API 是否可用
// ✅ 支援：桌機 Chrome/Edge/Brave、Android Chrome（可選 OneDrive 檔案）
// ❌ 排除：Samsung Internet（picker 卡死）、iOS Safari/Chrome（無 API）、Firefox（無 API）
const _IS_SAMSUNG  = /SamsungBrowser/i.test(navigator.userAgent);
const _IS_IOS      = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const _IS_FIREFOX  = /Firefox\/\d/i.test(navigator.userAgent);
const IS_FSA_SUPPORTED = !_IS_SAMSUNG && !_IS_IOS && !_IS_FIREFOX &&
                          ('showOpenFilePicker' in window) &&
                          ('showSaveFilePicker' in window);

// 模組級別 — 跨函式共用
let bookmarksHandle = null;
let healthHandle = null;
// 健康 ledger 的原始內容(stage 6 才做 schema 轉換,stage 2 先收著)
let _healthLedgerRaw = null;
let _saveTimer = null;
let _saving = false;
// 載入流程中為 true,讓 syncSettingsFromState 跳過 markDirty(避免無意義的回寫)
let _suppressSync = false;

// ─── WebDAV 相關 ─────────────────────────────────────────────────────────────
// 'fsa' | 'webdav' | 'gist' | 'idb' | 'none'
let storageMode = 'none';
// { url, user, pass }(webdav 模式時有值)
let _webdavCreds = null;
// 最近一次成功 GET/PUT 回傳的 ETag(用於 If-Match 樂觀鎖)
let _webdavEtag = '';

// ─── GitHub Gist 相關 ────────────────────────────────────────────────────────
// { gistId, token }(gist 模式時有值)
let _gistCreds = null;
// 最近一次 GET 的 ETag(304 快速路徑用)
let _gistEtag = '';

// ─── 跨分頁同步(BroadcastChannel) ────────────────────────────────────────────
let _bc = null;
try { _bc = new BroadcastChannel('znue_home_sync'); } catch(_){}

/* ============ IndexedDB 持久化(handles + config + cache) ============ */
function openHandleDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, HANDLE_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // v1 store(升級時保留)
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      // v2 stores
      if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
      if (!db.objectStoreNames.contains('cache'))  db.createObjectStore('cache');
      // v3 store — IDB 本機模式(給不支援 FSA 的瀏覽器用)
      if (!db.objectStoreNames.contains('local'))  db.createObjectStore('local');
    };
  });
}

/* ─── WebDAV config: 儲存/讀取/清除 ─────────────────────────────────────── */
async function saveWebdavConfig(cfg){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['config'], 'readwrite');
    const req = tx.objectStore('config').put(cfg, 'webdav');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function loadWebdavConfig(){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['config'], 'readonly');
    const req = tx.objectStore('config').get('webdav');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function clearWebdavConfig(){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['config'], 'readwrite');
    const req = tx.objectStore('config').delete('webdav');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ─── 離線書籤快取(WebDAV 模式用) ─────────────────────────────────────────── */
async function saveBookmarksCache(content, etag){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cache'], 'readwrite');
    const req = tx.objectStore('cache').put({ content, etag, cachedAt: new Date().toISOString() }, 'bookmarks');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function loadBookmarksCache(){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cache'], 'readonly');
    const req = tx.objectStore('cache').get('bookmarks');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function clearBookmarksCache(){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cache'], 'readwrite');
    const req = tx.objectStore('cache').delete('bookmarks');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ─── Gist config: 儲存/讀取/清除 ──────────────────────────────────────────── */
async function saveGistConfig(cfg){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['config'], 'readwrite');
    const req = tx.objectStore('config').put(cfg, 'gist');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function loadGistConfig(){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['config'], 'readonly');
    const req = tx.objectStore('config').get('gist');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function clearGistConfig(){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['config'], 'readwrite');
    const req = tx.objectStore('config').delete('gist');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ─── IDB 本機模式(FSA 不支援時的主要儲存) ──────────────────────────────────── */
async function saveLocalBookmarks(content){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['local'], 'readwrite');
    const req = tx.objectStore('local').put(content, 'bookmarks');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function loadLocalBookmarks(){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['local'], 'readonly');
    const req = tx.objectStore('local').get('bookmarks');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function clearLocalBookmarks(){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['local'], 'readwrite');
    const req = tx.objectStore('local').delete('bookmarks');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(key, handle){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['handles'], 'readwrite');
    const req = tx.objectStore('handles').put(handle, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function loadHandle(key){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['handles'], 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function clearHandle(key){
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['handles'], 'readwrite');
    const req = tx.objectStore('handles').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ============ 權限 + 讀寫 ============ */
async function ensurePermission(handle, mode){
  if (!handle) throw new Error('沒有 file handle');
  const cur = await handle.queryPermission({ mode });
  if (cur === 'granted') return true;
  const req = await handle.requestPermission({ mode });
  if (req !== 'granted') throw new Error(mode === 'read' ? '讀取權限被拒絕' : '寫入權限被拒絕');
  return true;
}
async function readJSONFromHandle(handle){
  await ensurePermission(handle, 'read');
  const file = await handle.getFile();
  const text = await file.text();
  return { data: JSON.parse(text), lastModified: file.lastModified, name: file.name };
}
async function writeJSONToHandle(handle, obj){
  await ensurePermission(handle, 'readwrite');
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(obj, null, 2));
  await writable.close();
}

/* ============ DATA 替換 / 預設 ============ */
function ensureDataShape(){
  if (!DATA.settings) DATA.settings = {};
  if (DATA.settings.theme === undefined) DATA.settings.theme = 'salmon';
  if (DATA.settings.autoTheme === undefined) DATA.settings.autoTheme = false;
  if (DATA.settings.denseGrid === undefined) DATA.settings.denseGrid = false;
  if (DATA.settings.healthPageUrl === undefined) DATA.settings.healthPageUrl = DEFAULT_HEALTH_PAGE_URL;
  if (DATA.settings.defaultContentMode === undefined) DATA.settings.defaultContentMode = 'list';
  if (DATA.settings.healthBarEnabled === undefined) DATA.settings.healthBarEnabled = true;
  if (DATA.settings.heroMark === undefined) DATA.settings.heroMark = '// 2026 — your home, your map';
  if (DATA.settings.heroQuote === undefined) DATA.settings.heroQuote = '一個給你 <em>常去的地方</em> 的安靜入口。按右上角 ✎ 編輯,☀ 換主題,右側 ▶ 看封存。';
  if (DATA.settings.brandText === undefined) DATA.settings.brandText = 'home';
  if (DATA.settings.sortMode === undefined) DATA.settings.sortMode = 'manual';   // manual | clicks | recent
  if (!DATA.sections) DATA.sections = [];
  if (!DATA.archive) DATA.archive = { activeTabId: null, lastUsedTabId: null, tabs: [] };
  if (!DATA.version) DATA.version = '1.0';
  // 卡片新欄位 migration(主面板 + 封存)
  for (const sec of DATA.sections){
    for (const cat of (sec.categories || [])) _migrateCat(cat);
  }
  for (const tab of (DATA.archive.tabs || [])){
    for (const sec of (tab.sections || [])){
      for (const cat of (sec.categories || [])) _migrateCat(cat);
    }
  }
}
function _migrateCat(cat){
  if (cat.contentMode === undefined) cat.contentMode = 'auto';   // 'auto' | 'list' | 'grid'
  if (cat.contentRows === undefined) cat.contentRows = null;     // null = 依 size 預設
  if (cat.gridCols === undefined) cat.gridCols = null;           // null = auto fit
  // 自動修復:過去 sortable 的 bug 可能讓 groups / links 內留 null,清掉
  if (Array.isArray(cat.groups)){
    cat.groups = cat.groups.filter(g => g != null);
    for (const g of cat.groups){
      if (Array.isArray(g.links)){
        g.links = g.links.filter(l => l != null);
      } else {
        g.links = [];
      }
    }
  } else {
    cat.groups = [];
  }
}

function buildBookmarksJSON(){
  ensureDataShape();
  return {
    version: DATA.version || '1.0',
    lastModified: new Date().toISOString(),
    settings: DATA.settings,
    sections: DATA.sections,
    archive: DATA.archive,
  };
}

function applyLoadedBookmarks(loaded){
  // 用 in-place mutation,讓其他模組持有的 DATA 參照保持有效
  DATA.version = loaded.version || '1.0';
  DATA.settings = loaded.settings || {};
  DATA.sections = Array.isArray(loaded.sections) ? loaded.sections : [];
  DATA.archive = loaded.archive || { activeTabId: null, lastUsedTabId: null, tabs: [] };
  ensureDataShape();
  // 同步 archive.activeTabId 到 state
  if (DATA.archive.activeTabId) state.archiveActiveTab = DATA.archive.activeTabId;
}

/* ============ 載入 / 儲存 ============ */
async function loadBookmarks(handle){
  const { data, name } = await readJSONFromHandle(handle);
  applyLoadedBookmarks(data);
  bookmarksHandle = handle;
  return name;
}

async function loadHealth(handle){
  const { data } = await readJSONFromHandle(handle);
  _healthLedgerRaw = data;
  healthHandle = handle;
}

async function saveBookmarks(){
  if (storageMode === 'webdav'){
    await _webdavSaveBookmarks();
    return;
  }
  if (storageMode === 'gist'){
    await _gistSaveBookmarks();
    return;
  }
  if (storageMode === 'idb'){
    try {
      const content = JSON.stringify(buildBookmarksJSON(), null, 2);
      await saveLocalBookmarks(content);
      _bc?.postMessage({ type: 'saved', mode: 'idb', ts: Date.now() });
      if (typeof updateLastSavedDisplay === 'function') updateLastSavedDisplay();
    } catch (e) {
      console.error('IDB saveBookmarks failed:', e);
      showTip('儲存失敗:' + (e.message || e));
    }
    return;
  }
  // FSA 模式
  if (!bookmarksHandle) return; // 沒檔案就不存(可能還在 onboarding)
  if (_saving) return;
  _saving = true;
  try {
    await writeJSONToHandle(bookmarksHandle, buildBookmarksJSON());
    _bc?.postMessage({ type: 'saved', mode: 'fsa', ts: Date.now() });
    if (typeof updateLastSavedDisplay === 'function') updateLastSavedDisplay();
  } catch (e) {
    console.error('saveBookmarks failed:', e);
    showTip('儲存失敗:' + (e.message || e));
  } finally {
    _saving = false;
  }
}

/* ============ WebDAV 讀寫(WebDAV 模式) ============ */

/* 從 NAS 載入書籤;離線時 fallback 到 IDB 快取 */
async function _webdavLoadBookmarks(){
  if (!_webdavCreds) throw new Error('WebDAV 設定遺失');
  try {
    const result = await webdavGet(_webdavCreds.url, _webdavCreds);
    if (!result.exists){
      // 第一次連線:NAS 上還沒有此檔 → 用目前 DATA 建立新檔
      ensureDataShape();
      const content = JSON.stringify(buildBookmarksJSON(), null, 2);
      const putResult = await webdavPut(_webdavCreds.url, _webdavCreds, content, '');
      _webdavEtag = putResult.etag || '';
      await saveBookmarksCache(content, _webdavEtag);
      return; // DATA 保持預設
    }
    // 解析並套用
    const data = JSON.parse(result.content);
    applyLoadedBookmarks(data);
    _webdavEtag = result.etag || '';
    await saveBookmarksCache(result.content, _webdavEtag);
  } catch (e) {
    // 網路失敗(AbortError=timeout, TypeError=Failed to fetch, offline) → 嘗試離線快取
    const isNetErr = e.name === 'AbortError' || e.name === 'TypeError' || !navigator.onLine;
    if (isNetErr){
      const cached = await loadBookmarksCache();
      if (cached){
        try {
          const data = JSON.parse(cached.content);
          applyLoadedBookmarks(data);
          _webdavEtag = cached.etag || '';
          showTip('離線模式 · 顯示快取資料 · 連線後自動同步');
          return;
        } catch(_){}
      }
    }
    throw e;
  }
}

/* 將 DATA 寫回 NAS;離線時只更新快取等重連後再送 */
async function _webdavSaveBookmarks(){
  if (!_webdavCreds || _saving) return;
  _saving = true;
  try {
    const content = JSON.stringify(buildBookmarksJSON(), null, 2);
    // 先更新 IDB 快取(離線時至少有最新版)
    await saveBookmarksCache(content, _webdavEtag);
    const result = await webdavPut(_webdavCreds.url, _webdavCreds, content, _webdavEtag);
    if (result.conflict){
      // 412:遠端有更新的版本,重新拉取後提示使用者
      showTip('⚠ NAS 有較新的版本,正在更新…');
      const fresh = await webdavGet(_webdavCreds.url, _webdavCreds);
      if (fresh.exists){
        const data = JSON.parse(fresh.content);
        applyLoadedBookmarks(data);
        _webdavEtag = fresh.etag || '';
        await saveBookmarksCache(fresh.content, _webdavEtag);
        if (typeof renderSections === 'function') renderSections();
        showTip('已從 NAS 拉取最新版本(你的改動已被覆蓋)');
      }
      return;
    }
    _webdavEtag = result.etag || '';
    if (typeof updateLastSavedDisplay === 'function') updateLastSavedDisplay();
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TypeError' || !navigator.onLine){
      // 離線/逾時:快取已更新,等重連
    } else {
      console.error('WebDAV saveBookmarks failed:', e);
      showTip('NAS 儲存失敗:' + (e.message || e));
    }
  } finally {
    _saving = false;
  }
}

/* 連線上 WebDAV:onboarding 用 */
async function handleWebdavConnect(url, user, pass){
  _webdavCreds = { url: url.trim(), user: user.trim(), pass };
  storageMode = 'webdav';
  await saveWebdavConfig(_webdavCreds);
  await _webdavLoadBookmarks();
  afterBookmarksReady();
  // FSA settings row 隱藏,改顯示 WebDAV 資訊
  const fsaRow = $('#settingsFsaRow');
  if (fsaRow) fsaRow.style.display = 'none';
}

/* 斷開 WebDAV:settings 用 */
async function handleWebdavDisconnect(){
  if (!confirm('斷開 NAS 連線?\n本機離線快取也會清除。下次開啟會回到 onboarding。')) return;
  storageMode = 'none';
  _webdavCreds = null;
  _webdavEtag = '';
  await clearWebdavConfig();
  await clearBookmarksCache();
  closeSettings();
  showOnboarding('welcome');
}

/* 重連(上線後自動把快取推回 NAS) */
async function _webdavOnlineSync(){
  if (storageMode !== 'webdav' || !_webdavCreds) return;
  try {
    await _webdavSaveBookmarks();
    showTip('已重新連線 · 書籤同步完成');
  } catch(_){}
}

// 監聽 online 事件以自動重連
window.addEventListener('online', _webdavOnlineSync);

/* ============ GitHub Gist 讀寫(Gist 模式) ============ */

/* 從 Gist 載入書籤;離線時 fallback 到 IDB 快取 */
async function _gistLoadBookmarks(){
  if (!_gistCreds) throw new Error('Gist 設定遺失');
  try {
    const result = await gistGet(_gistCreds.gistId, _gistCreds.token, _gistEtag);
    if (result.notModified){
      // 304 — 內容沒變,用快取即可
      const cached = await loadBookmarksCache();
      if (cached){
        applyLoadedBookmarks(JSON.parse(cached.content));
        _gistEtag = cached.etag || _gistEtag;
      }
      return;
    }
    if (!result.exists){
      // Gist 裡還沒有書籤檔 → 用目前 DATA 建立
      ensureDataShape();
      const content = JSON.stringify(buildBookmarksJSON(), null, 2);
      const putResult = await gistPut(_gistCreds.gistId, _gistCreds.token, content);
      _gistEtag = putResult.etag || '';
      await saveBookmarksCache(content, _gistEtag);
      return;
    }
    const data = JSON.parse(result.content);
    applyLoadedBookmarks(data);
    _gistEtag = result.etag || '';
    await saveBookmarksCache(result.content, _gistEtag);
  } catch(e){
    const isNetErr = e.name === 'AbortError' || e.name === 'TypeError' || !navigator.onLine;
    if (isNetErr){
      const cached = await loadBookmarksCache();
      if (cached){
        try {
          applyLoadedBookmarks(JSON.parse(cached.content));
          _gistEtag = cached.etag || '';
          showTip('離線模式 · 顯示快取資料 · 連線後自動同步');
          return;
        } catch(_){}
      }
    }
    throw e;
  }
}

/* 將 DATA 寫回 Gist;離線時只更新快取,等重連後再送 */
async function _gistSaveBookmarks(){
  if (!_gistCreds || _saving) return;
  _saving = true;
  try {
    const content = JSON.stringify(buildBookmarksJSON(), null, 2);
    await saveBookmarksCache(content, _gistEtag);
    const result = await gistPut(_gistCreds.gistId, _gistCreds.token, content);
    _gistEtag = result.etag || '';
    if (typeof updateLastSavedDisplay === 'function') updateLastSavedDisplay();
  } catch(e){
    if (e.name === 'AbortError' || e.name === 'TypeError' || !navigator.onLine){
      // 離線/逾時:快取已更新,等重連
    } else {
      console.error('Gist saveBookmarks failed:', e);
      showTip('Gist 儲存失敗:' + (e.message || e));
    }
  } finally {
    _saving = false;
  }
}

/* 連線 Gist:onboarding 用 */
async function handleGistConnect(gistId, token){
  _gistCreds = { gistId: gistId.trim(), token: token.trim() };
  storageMode = 'gist';
  await saveGistConfig(_gistCreds);
  await _gistLoadBookmarks();
  afterBookmarksReady();
}

/* 斷開 Gist:settings 用 */
async function handleGistDisconnect(){
  if (!confirm('斷開 GitHub Gist 連線?\n本機離線快取也會清除。下次開啟會回到 onboarding。')) return;
  storageMode = 'none';
  _gistCreds = null;
  _gistEtag = '';
  await clearGistConfig();
  await clearBookmarksCache();
  closeSettings();
  showOnboarding('welcome');
}

/* 上線後自動推快取到 Gist */
async function _gistOnlineSync(){
  if (storageMode !== 'gist' || !_gistCreds) return;
  try {
    await _gistSaveBookmarks();
    showTip('已重新連線 · 書籤同步完成');
  } catch(_){}
}
window.addEventListener('online', _gistOnlineSync);

/* ============ 跨分頁同步 ============ */

/* BroadcastChannel：另一個分頁儲存後，這個分頁自動重讀 */
if (_bc){
  _bc.onmessage = async (e) => {
    if (e.data?.type !== 'saved') return;
    // 避免回聲：只有「不是自己發的」才重讀
    // (BroadcastChannel 本身就不會收到自己發的訊息，這裡不需要特別過濾)
    try {
      if (storageMode === 'fsa' && bookmarksHandle){
        const perm = await bookmarksHandle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') return;
        const { data } = await readJSONFromHandle(bookmarksHandle);
        applyLoadedBookmarks(data);
      } else if (storageMode === 'idb'){
        const content = await loadLocalBookmarks();
        if (!content) return;
        applyLoadedBookmarks(JSON.parse(content));
      } else {
        return;
      }
      if (typeof renderSections === 'function') renderSections();
      if (typeof renderHero === 'function') renderHero();
      if (typeof renderHealthBar === 'function') renderHealthBar();
    } catch(_){}
  };
}

/* visibilitychange：切回這個分頁時重讀，確保看到最新版本 */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    if (storageMode === 'fsa' && bookmarksHandle){
      const perm = await bookmarksHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') return;
      const { data } = await readJSONFromHandle(bookmarksHandle);
      applyLoadedBookmarks(data);
      if (typeof renderSections === 'function') renderSections();
      if (typeof renderHero === 'function') renderHero();
    }
    // IDB 模式不需要 visibilitychange，BroadcastChannel 已即時同步
  } catch(_){}
});

/* 任何 DATA 改動 → 呼叫這個。500ms debounce 後才真的寫入。 */
function markDirty(){
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveBookmarks, SAVE_DEBOUNCE_MS);
}

/* 立即強制寫入(例如 export 之前、或 user 主動點儲存) */
async function flushDirty(){
  clearTimeout(_saveTimer);
  await saveBookmarks();
}

/* ============ 檔案選取(File System Access API) ============ */
async function pickBookmarksFileToOpen(){
  if (!('showOpenFilePicker' in window)) throw new Error('此瀏覽器不支援 File System Access API · 建議 Chrome / Edge');
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'znue bookmarks', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  });
  await ensurePermission(handle, 'readwrite');
  await saveHandle('bookmarks', handle);
  return handle;
}

async function pickBookmarksFileToCreate(){
  if (!('showSaveFilePicker' in window)) throw new Error('此瀏覽器不支援 File System Access API · 建議 Chrome / Edge');
  const handle = await window.showSaveFilePicker({
    suggestedName: 'znue_bookmarks.json',
    types: [{ description: 'znue bookmarks', accept: { 'application/json': ['.json'] } }],
  });
  await ensurePermission(handle, 'readwrite');
  // 把目前 state(localStorage 帶來的主題等)寫進 DATA.settings,再序列化
  ensureDataShape();
  DATA.settings.theme = state.theme;
  DATA.settings.autoTheme = state.autoTheme;
  DATA.settings.denseGrid = state.denseGrid;
  await writeJSONToHandle(handle, buildBookmarksJSON());
  await saveHandle('bookmarks', handle);
  return handle;
}

async function pickHealthFileToOpen(){
  if (!('showOpenFilePicker' in window)) throw new Error('此瀏覽器不支援 File System Access API · 建議 Chrome / Edge');
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'health ledger', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  });
  await ensurePermission(handle, 'read');
  await saveHandle('health', handle);
  return handle;
}

/* ============ Onboarding ============ */
function showOnboarding(reason = 'welcome'){
  const overlay = $('#onboarding');
  overlay.classList.add('show');
  overlay.dataset.reason = reason;
  // banner 訊息
  const banner = $('#onboardingBanner');
  if (banner){
    if (reason === 'welcome') banner.textContent = '歡迎 · 第一次開啟,選一份 bookmarks.json 來開始(沒有就建一個)。';
    else if (reason === 'permission') banner.textContent = '需要重新授權才能讀寫你的 bookmarks.json。';
    else if (reason === 'lost') banner.textContent = '原本的 bookmarks.json 找不到了 · 請重新選一份或建一個新的。';
    else banner.textContent = '';
  }
  // 永遠顯示「略過」按鈕 — 給 FSA 不支援(手機)、picker 卡住、或暫時想瀏覽的 user 一個逃離路徑
  // 但 IS_FSA_SUPPORTED=true 時用較淡樣式(不喧賓奪主),false 時做主按鈕
  const skipBtn = $('#onbBtnSkip');
  if (skipBtn){
    skipBtn.style.display = 'block';
    skipBtn.classList.toggle('subtle', IS_FSA_SUPPORTED);
    skipBtn.innerHTML = IS_FSA_SUPPORTED
      ? '先進入瀏覽 · <strong>改動不會被儲存</strong>'
      : '<strong>直接在此瀏覽器使用</strong> · 書籤自動儲存在瀏覽器內<br><span style="font-size:11px;opacity:.7;">換瀏覽器/清除瀏覽器資料會遺失 · 可在設定匯出備份</span>';
  }
  // FSA 不支援時完全隱藏這兩顆按鈕(不只是淡化 — 淡化還是可點)
  const _fsaBtnDisplay = IS_FSA_SUPPORTED ? '' : 'none';
  $('#onbBtnOpen')?.style.setProperty('display', _fsaBtnDisplay);
  $('#onbBtnCreate')?.style.setProperty('display', _fsaBtnDisplay);
}
function hideOnboarding(){
  $('#onboarding').classList.remove('show');
}

async function handleBookmarksOpen(){
  if (!IS_FSA_SUPPORTED){ showTip('此瀏覽器不支援檔案模式，請使用下方的瀏覽器本機儲存'); return; }
  try {
    const handle = await pickBookmarksFileToOpen();
    if (!handle) throw new Error('沒有選到檔案 handle');
    storageMode = 'fsa';
    await loadBookmarks(handle);
    afterBookmarksReady();
  } catch (e) {
    if (e.name === 'AbortError') return; // user cancelled
    console.error('handleBookmarksOpen failed:', e);
    showTip('載入失敗:' + (e.message || e) + '(可點「先進入瀏覽」暫時略過)');
  }
}

async function handleBookmarksCreate(){
  if (!IS_FSA_SUPPORTED){ showTip('此瀏覽器不支援檔案模式，請使用下方的瀏覽器本機儲存'); return; }
  try {
    const handle = await pickBookmarksFileToCreate();
    if (!handle) throw new Error('沒有建立到檔案 handle');
    storageMode = 'fsa';
    bookmarksHandle = handle;
    afterBookmarksReady();
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('handleBookmarksCreate failed:', e);
    showTip('建立失敗:' + (e.message || e) + '(可點「先進入瀏覽」暫時略過)');
  }
}

async function handleHealthOpen(){
  try {
    const handle = await pickHealthFileToOpen();
    await loadHealth(handle);
    showTip('已連結 ' + handle.name);
    if (typeof renderHealthBar === 'function') renderHealthBar();
    if (typeof renderHero === 'function') renderHero();
    updateSettingsDisplay();
  } catch (e) {
    if (e.name === 'AbortError') return;
    showTip('連結健康紀錄失敗:' + (e.message || e));
  }
}

function afterBookmarksReady(){
  hideOnboarding();
  ensureDataShape();
  // 套用設定中的主題(會覆寫 localStorage 的 fallback)
  applySettingsToUi();
  // 渲染主面板
  if (typeof renderHero === 'function') renderHero();
  if (typeof renderSections === 'function') renderSections();
  if (typeof renderHealthBar === 'function') renderHealthBar();
  updateSettingsDisplay();
  showTip('已連結 bookmarks.json');
}

/* DATA.settings → state + UI(theme、denseGrid)
   呼叫時機:loadBookmarks 之後 */
function applySettingsToUi(){
  const s = DATA.settings || {};
  _suppressSync = true;
  try {
    if (s.autoTheme){
      state.autoTheme = true;
      if (typeof applyTheme === 'function' && typeof pickAutoTheme === 'function'){
        applyTheme(pickAutoTheme());
      }
      const sw = $('#autoThemeSwitch'); if (sw) sw.classList.add('on');
    } else if (s.theme){
      state.autoTheme = false;
      if (typeof applyTheme === 'function') applyTheme(s.theme);
    }
    if (s.denseGrid){
      state.denseGrid = true;
      document.body.classList.add('dense-grid');
      const btn = $('#toggleDense');
      if (btn){ btn.style.color = 'var(--accent)'; btn.textContent = '✨ 已填補'; }
    }
  } finally {
    _suppressSync = false;
  }
}

/* 把目前 state(主題、autoTheme、denseGrid)同步進 DATA.settings 後 markDirty
   呼叫時機:使用者切換主題、autoTheme、denseGrid 時 */
function syncSettingsFromState(){
  if (_suppressSync) return;
  ensureDataShape();
  DATA.settings.theme = state.theme;
  DATA.settings.autoTheme = state.autoTheme;
  DATA.settings.denseGrid = state.denseGrid;
  markDirty();
}

/* ============ Settings modal(切檔、健康頁 URL、匯出匯入) ============ */
function openSettings(){
  $('#settingsModal').classList.add('show');
  $('#modalBackdrop').classList.add('show');
  updateSettingsDisplay();
}
function closeSettings(){
  $('#settingsModal').classList.remove('show');
  $('#modalBackdrop').classList.remove('show');
}

function updateSettingsDisplay(){
  // ── 儲存模式顯示 ──────────────────────────────────────────────────────────
  const modeEl = $('#settingsStorageMode');
  const fsaRow = $('#settingsFsaRow');
  const wdDisBtn = $('#settingsWebdavDisconnect');
  const wdReBtn = $('#settingsWebdavReconfig');
  const gistDisBtn = $('#settingsGistDisconnect');
  const gistReBtn  = $('#settingsGistReconfig');
  if (modeEl){
    if (storageMode === 'webdav' && _webdavCreds){
      const shortUrl = _webdavCreds.url.replace(/^https?:\/\//, '').replace(/\/webdav\/.*/, '/…');
      modeEl.textContent = `WebDAV · ${shortUrl}`;
      modeEl.className = 'settings-row-val webdav-url';
      if (fsaRow) fsaRow.style.display = 'none';
      if (wdDisBtn) wdDisBtn.style.display = '';
      if (wdReBtn) wdReBtn.style.display = '';
      if (gistDisBtn) gistDisBtn.style.display = 'none';
      if (gistReBtn)  gistReBtn.style.display = 'none';
    } else if (storageMode === 'gist' && _gistCreds){
      const shortId = _gistCreds.gistId.slice(0, 8) + '…';
      modeEl.textContent = `GitHub Gist · ${shortId}`;
      modeEl.className = 'settings-row-val webdav-url';
      if (fsaRow) fsaRow.style.display = 'none';
      if (wdDisBtn) wdDisBtn.style.display = 'none';
      if (wdReBtn) wdReBtn.style.display = 'none';
      if (gistDisBtn) gistDisBtn.style.display = '';
      if (gistReBtn)  gistReBtn.style.display = '';
    } else {
      modeEl.textContent = storageMode === 'fsa' ? '本機檔案 (FSA)' : storageMode === 'idb' ? '瀏覽器本機 (IndexedDB)' : '未連結';
      modeEl.className = 'settings-row-val';
      if (fsaRow) fsaRow.style.display = '';
      if (wdDisBtn) wdDisBtn.style.display = 'none';
      if (wdReBtn) wdReBtn.style.display = 'none';
      if (gistDisBtn) gistDisBtn.style.display = 'none';
      if (gistReBtn)  gistReBtn.style.display = 'none';
    }
  }
  // ── FSA row 在 IDB 模式時改顯示瀏覽器儲存資訊 ──────────────────────────────
  if (storageMode === 'idb'){
    const bm = $('#settingsBookmarksName');
    if (bm) bm.textContent = '瀏覽器 IndexedDB';
    const swapBtn = $('#settingsSwapBookmarks');
    if (swapBtn){ swapBtn.textContent = '換成檔案模式'; swapBtn.style.display = IS_FSA_SUPPORTED ? '' : 'none'; }
    const clrBtn = $('#settingsClearBookmarks');
    if (clrBtn) clrBtn.textContent = '清除書籤資料';
    if (fsaRow) fsaRow.style.display = '';
    if (wdDisBtn) wdDisBtn.style.display = 'none';
    if (wdReBtn) wdReBtn.style.display = 'none';
  }
  // ── 其餘既有欄位 ─────────────────────────────────────────────────────────
  const bm = $('#settingsBookmarksName');
  if (bm && storageMode !== 'idb') bm.textContent = bookmarksHandle ? bookmarksHandle.name : '(未連結)';
  const hm = $('#settingsHealthName');
  if (hm) hm.textContent = healthHandle ? healthHandle.name : '(未連結 · 沒連結時健康狀態列自動隱藏)';
  const hbToggle = $('#settingsHealthBarToggle');
  if (hbToggle) hbToggle.classList.toggle('on', DATA.settings && DATA.settings.healthBarEnabled !== false);
  // 排序模式 picker — 標記 selected
  const sortWrap = $('#settingsSortMode');
  if (sortWrap){
    const cur = (DATA.settings && DATA.settings.sortMode) || 'manual';
    sortWrap.querySelectorAll('.size-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.sort === cur);
    });
  }
  const url = $('#settingsHealthUrl');
  if (url) url.value = (DATA.settings && DATA.settings.healthPageUrl) || DEFAULT_HEALTH_PAGE_URL;
  // 預設內容模式 — 標記 selected
  const modeWrap = $('#settingsDefaultContentMode');
  if (modeWrap){
    const cur = (DATA.settings && DATA.settings.defaultContentMode) || 'list';
    modeWrap.querySelectorAll('.size-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.mode === cur);
    });
  }
  const last = $('#lastUpdated');
  if (last && DATA.lastModified){
    try { last.textContent = `last saved · ${new Date(DATA.lastModified).toLocaleString('zh-TW')}`; }
    catch(_){}
  }
}

function updateLastSavedDisplay(){
  const last = $('#lastUpdated');
  if (last) last.textContent = `last saved · ${new Date().toLocaleString('zh-TW')}`;
}

async function handleSwapBookmarks(){
  // 先 flush 目前的 DATA(免得切檔後丟失)— 但若 handle 早已遺失,就直接放棄寫入
  try { await flushDirty(); } catch(_){}
  // 換成 FSA 模式後清除 IDB local 資料(避免下次誤讀舊的)
  if (storageMode === 'idb') await clearLocalBookmarks().catch(() => {});
  await handleBookmarksOpen();
}

async function handleClearBookmarks(){
  if (storageMode === 'idb'){
    if (!confirm('清除瀏覽器儲存的書籤?\n所有資料會被刪除,下次開啟會回到初始畫面。')) return;
    await clearLocalBookmarks();
    storageMode = 'none';
    closeSettings();
    showOnboarding('welcome');
    return;
  }
  if (!confirm('清除目前的 bookmarks.json 連結?\n下次開啟會回到 onboarding。')) return;
  await clearHandle('bookmarks');
  bookmarksHandle = null;
  storageMode = 'none';
  closeSettings();
  showOnboarding('lost');
}

async function handleSwapHealth(){
  await handleHealthOpen();
}

async function handleClearHealth(){
  if (!confirm('清除健康紀錄連結?')) return;
  await clearHandle('health');
  healthHandle = null;
  _healthLedgerRaw = null;
  updateSettingsDisplay();
  if (typeof renderHealthBar === 'function') renderHealthBar();
  showTip('已清除健康紀錄連結');
}

function handleHealthUrlChange(value){
  ensureDataShape();
  DATA.settings.healthPageUrl = value.trim() || DEFAULT_HEALTH_PAGE_URL;
  markDirty();
  // 重繪 health panel(若已開啟)以更新「完整紀錄 →」連結
  // 簡單作法:不主動重繪,等下次 hover 自動更新
}

function handleExportJSON(){
  ensureDataShape();
  const obj = buildBookmarksJSON();
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `znue_bookmarks_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showTip('已匯出 JSON');
}

function handleImportJSON(){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    if (!input.files[0]) return;
    if (!confirm('匯入會用檔案內容取代目前所有資料(主題、書籤、封存)。確定?')) return;
    try {
      const text = await input.files[0].text();
      const data = JSON.parse(text);
      applyLoadedBookmarks(data);
      applySettingsToUi();
      renderSections();
      renderHealthBar();
      closeSettings();
      showTip('匯入中，正在儲存…');
      await flushDirty(); // 立即強制寫入，不用 debounce
      showTip('已匯入並儲存完成');
    } catch (e) {
      showTip('匯入失敗:' + (e.message || e));
    }
  };
  input.click();
}

/* ============ 啟動流程 ============ */
async function initStorage(){
  // ── 優先嘗試 GitHub Gist 模式(若之前已設定) ────────────────────────────────
  let gistCfg = null;
  try { gistCfg = await loadGistConfig(); } catch(_){}
  if (gistCfg && gistCfg.gistId && gistCfg.token){
    storageMode = 'gist';
    _gistCreds = gistCfg;
    try {
      await _gistLoadBookmarks();
      afterBookmarksReady();
    } catch(e){
      console.error('Gist 啟動失敗:', e);
      const cached = await loadBookmarksCache().catch(() => null);
      if (cached){
        try {
          applyLoadedBookmarks(JSON.parse(cached.content));
          _gistEtag = cached.etag || '';
          afterBookmarksReady();
          showTip('離線模式 · 連線 GitHub 後自動同步');
          return;
        } catch(_){}
      }
      storageMode = 'none';
      ensureDataShape();
      showOnboarding('welcome');
      showTip('GitHub Gist 連線失敗:' + (e.message || e) + ' · 請重新設定');
    }
    return;
  }

  // ── 優先嘗試 WebDAV 模式(若之前已設定) ─────────────────────────────────
  let wdCfg = null;
  try { wdCfg = await loadWebdavConfig(); } catch(_){}
  if (wdCfg && wdCfg.url){
    storageMode = 'webdav';
    _webdavCreds = wdCfg;
    try {
      await _webdavLoadBookmarks();
      afterBookmarksReady();
    } catch (e){
      console.error('WebDAV 啟動失敗:', e);
      // 嘗試離線快取
      const cached = await loadBookmarksCache().catch(() => null);
      if (cached){
        try {
          applyLoadedBookmarks(JSON.parse(cached.content));
          _webdavEtag = cached.etag || '';
          afterBookmarksReady();
          showTip('離線模式 · 連線 NAS 後自動同步');
          return;
        } catch(_){}
      }
      // 快取也沒有 → 回 onboarding 顯示錯誤
      storageMode = 'none';
      ensureDataShape();
      showOnboarding('welcome');
      showTip('NAS 連線失敗:' + (e.message || e) + ' · 請重新設定');
    }
    return;
  }

  // ── 非 FSA 瀏覽器(iOS Safari / Firefox 等) → IDB 本機模式 ─────────────────
  if (!IS_FSA_SUPPORTED){
    let localData = null;
    try { localData = await loadLocalBookmarks(); } catch(_){}
    if (localData){
      storageMode = 'idb';
      try {
        applyLoadedBookmarks(JSON.parse(localData));
        afterBookmarksReady();
      } catch(e){
        ensureDataShape();
        showOnboarding('welcome');
      }
    } else {
      ensureDataShape();
      showOnboarding('welcome');
    }
    return;
  }

  // ── FSA 模式 ───────────────────────────────────────────────────────────────
  let bm = null;
  try { bm = await loadHandle('bookmarks'); } catch(_){}
  if (!bm){
    // 沒 handle → onboarding
    ensureDataShape();
    showOnboarding('welcome');
    // 同時嘗試載入 health(獨立流程)
    tryLoadStoredHealth();
    return;
  }
  // 有 handle:檢查權限
  try {
    const perm = await bm.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted'){
      storageMode = 'fsa';
      await loadBookmarks(bm);
      afterBookmarksReady();
    } else {
      // prompt or denied — 顯示 onboarding 但給一個「重新授權」按鈕
      ensureDataShape();
      showOnboarding('permission');
      // 把 handle 暫存,授權成功後直接用
      window._pendingBookmarksHandle = bm;
    }
  } catch (e){
    console.warn('bookmarks handle 失效:', e);
    await clearHandle('bookmarks');
    ensureDataShape();
    showOnboarding('lost');
  }
  tryLoadStoredHealth();
}

async function tryLoadStoredHealth(){
  let h = null;
  try { h = await loadHandle('health'); } catch(_){}
  if (!h) return;
  try {
    const perm = await h.queryPermission({ mode: 'read' });
    if (perm === 'granted'){
      await loadHealth(h);
      if (typeof renderHealthBar === 'function') renderHealthBar();
    } else {
      // 不主動 prompt — 等使用者進設定再連
      healthHandle = h;
    }
  } catch(_){
    await clearHandle('health');
  }
}

/* ============ PWA 安裝 ============
   beforeinstallprompt 事件只在「PWA 可安裝且未安裝」時 fire(Chromium-based 瀏覽器)。
   我們把事件 cache 起來,使用者點設定的「安裝」按鈕時才 prompt。 */
let _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // 顯示設定面板的「應用程式」section
  const sec = $('#settingsAppSection');
  if (sec) sec.style.display = '';
});
window.addEventListener('appinstalled', () => {
  _deferredInstallPrompt = null;
  const sec = $('#settingsAppSection');
  if (sec) sec.style.display = 'none';
  if (typeof showTip === 'function') showTip('已安裝為應用程式');
});

async function handleInstallPWA(){
  if (!_deferredInstallPrompt){
    showTip('已安裝,或此瀏覽器不支援 PWA 安裝');
    return;
  }
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') showTip('安裝中...');
  _deferredInstallPrompt = null;
}

/* 略過 onboarding
   - FSA 不支援(手機 Safari / Firefox)→ 啟用 IDB 本機模式,改動會存在瀏覽器內
   - FSA 支援但使用者選跳過 → 唯讀模式,改動不儲存 */
function handleSkipOnboarding(){
  hideOnboarding();
  ensureDataShape();
  if (!IS_FSA_SUPPORTED){
    storageMode = 'idb';
    // 把預設 DATA 立刻存入 IDB,讓下次開啟直接進入
    const content = JSON.stringify(buildBookmarksJSON(), null, 2);
    saveLocalBookmarks(content).catch(() => {});
    if (typeof renderHero === 'function') renderHero();
    if (typeof renderSections === 'function') renderSections();
    if (typeof renderHealthBar === 'function') renderHealthBar();
    showTip('已啟用瀏覽器本機儲存 · 可在設定匯出備份');
  } else {
    if (typeof renderHero === 'function') renderHero();
    if (typeof renderSections === 'function') renderSections();
    if (typeof renderHealthBar === 'function') renderHealthBar();
    showTip('唯讀模式 · 改動不會儲存');
  }
}

/* 重新授權按鈕(onboarding 的「permission」模式) */
async function handleReauthorize(){
  const handle = window._pendingBookmarksHandle;
  if (!handle) { showOnboarding('welcome'); return; }
  try {
    await ensurePermission(handle, 'readwrite');
    storageMode = 'fsa';
    await loadBookmarks(handle);
    delete window._pendingBookmarksHandle;
    afterBookmarksReady();
  } catch (e){
    showTip('授權失敗:' + (e.message || e));
  }
}

/* 綁 onboarding + settings 的 DOM 事件(從 main.js init 呼叫) */
function bindStorageDom(){
  $('#onbBtnOpen')?.addEventListener('click', handleBookmarksOpen);
  $('#onbBtnCreate')?.addEventListener('click', handleBookmarksCreate);
  $('#onbBtnHealth')?.addEventListener('click', handleHealthOpen);
  $('#onbBtnReauth')?.addEventListener('click', handleReauthorize);
  $('#onbBtnSkip')?.addEventListener('click', handleSkipOnboarding);

  // ── WebDAV onboarding ────────────────────────────────────────────────────
  const wdBtn = $('#onbBtnWebdav');
  const wdForm = $('#onbWebdavForm');
  if (wdBtn && wdForm){
    wdBtn.addEventListener('click', () => {
      const open = wdForm.style.display !== 'none';
      wdForm.style.display = open ? 'none' : '';
      if (!open) $('#onbWdUrl')?.focus();
    });
  }
  $('#onbWdTest')?.addEventListener('click', async () => {
    const url = $('#onbWdUrl')?.value?.trim();
    const user = $('#onbWdUser')?.value?.trim();
    const pass = $('#onbWdPass')?.value;
    const statusEl = $('#onbWdStatus');
    if (!url){ if(statusEl){ statusEl.textContent = '請輸入 WebDAV URL'; statusEl.className = 'onb-webdav-status err'; } return; }
    if (statusEl){ statusEl.textContent = '測試中…'; statusEl.className = 'onb-webdav-status'; }
    try {
      const result = await webdavTest(url, { user, pass });
      if (result.ok){
        const msg = result.exists ? '✓ 連線成功 · 已找到書籤檔案' : '✓ 連線成功 · 會自動建立新書籤檔案';
        if (statusEl){ statusEl.textContent = msg; statusEl.className = 'onb-webdav-status ok'; }
      } else {
        if (statusEl){ statusEl.textContent = '✗ ' + (result.error || '連線失敗'); statusEl.className = 'onb-webdav-status err'; }
      }
    } catch(e){
      if (statusEl){ statusEl.textContent = '✗ ' + (e.message || e); statusEl.className = 'onb-webdav-status err'; }
    }
  });
  $('#onbWdConnect')?.addEventListener('click', async () => {
    const url = $('#onbWdUrl')?.value?.trim();
    const user = $('#onbWdUser')?.value?.trim();
    const pass = $('#onbWdPass')?.value;
    const statusEl = $('#onbWdStatus');
    if (!url){ if(statusEl){ statusEl.textContent = '請輸入 WebDAV URL'; statusEl.className = 'onb-webdav-status err'; } return; }
    if (statusEl){ statusEl.textContent = '連線中…'; statusEl.className = 'onb-webdav-status'; }
    try {
      await handleWebdavConnect(url, user, pass);
    } catch(e){
      if (statusEl){ statusEl.textContent = '✗ ' + (e.message || e); statusEl.className = 'onb-webdav-status err'; }
    }
  });

  // ── Gist onboarding ──────────────────────────────────────────────────────
  const gistBtn  = $('#onbBtnGist');
  const gistForm = $('#onbGistForm');
  if (gistBtn && gistForm){
    gistBtn.addEventListener('click', () => {
      const open = gistForm.style.display !== 'none';
      gistForm.style.display = open ? 'none' : '';
      // 同時收合 WebDAV 表單
      const wdForm = $('#onbWebdavForm');
      if (!open && wdForm) wdForm.style.display = 'none';
      if (!open) $('#onbGistToken')?.focus();
    });
  }
  $('#onbGistTest')?.addEventListener('click', async () => {
    const token  = $('#onbGistToken')?.value?.trim();
    const gistId = $('#onbGistId')?.value?.trim();
    const statusEl = $('#onbGistStatus');
    if (!token){ if(statusEl){ statusEl.textContent = '請輸入 Personal Access Token'; statusEl.className = 'onb-webdav-status err'; } return; }
    if (!gistId){ if(statusEl){ statusEl.textContent = '請輸入 Gist ID'; statusEl.className = 'onb-webdav-status err'; } return; }
    if (statusEl){ statusEl.textContent = '測試中…'; statusEl.className = 'onb-webdav-status'; }
    try {
      const result = await gistTest(gistId, token);
      if (result.ok){
        const msg = result.exists ? '✓ 連線成功 · 已找到書籤檔案' : '✓ 連線成功 · 會自動建立新書籤檔案';
        if (statusEl){ statusEl.textContent = msg; statusEl.className = 'onb-webdav-status ok'; }
      } else {
        if (statusEl){ statusEl.textContent = '✗ ' + (result.error || '連線失敗'); statusEl.className = 'onb-webdav-status err'; }
      }
    } catch(e){
      if (statusEl){ statusEl.textContent = '✗ ' + (e.message || e); statusEl.className = 'onb-webdav-status err'; }
    }
  });
  $('#onbGistConnect')?.addEventListener('click', async () => {
    const token  = $('#onbGistToken')?.value?.trim();
    const gistId = $('#onbGistId')?.value?.trim();
    const statusEl = $('#onbGistStatus');
    if (!token){ if(statusEl){ statusEl.textContent = '請輸入 Personal Access Token'; statusEl.className = 'onb-webdav-status err'; } return; }
    if (!gistId){ if(statusEl){ statusEl.textContent = '請輸入 Gist ID'; statusEl.className = 'onb-webdav-status err'; } return; }
    if (statusEl){ statusEl.textContent = '連線中…'; statusEl.className = 'onb-webdav-status'; }
    try {
      await handleGistConnect(gistId, token);
    } catch(e){
      if (statusEl){ statusEl.textContent = '✗ ' + (e.message || e); statusEl.className = 'onb-webdav-status err'; }
    }
  });

  // ── Settings WebDAV controls ──────────────────────────────────────────────
  $('#settingsWebdavDisconnect')?.addEventListener('click', handleWebdavDisconnect);
  $('#settingsWebdavReconfig')?.addEventListener('click', () => {
    closeSettings();
    showOnboarding('welcome');
    // 展開 WebDAV form 並預填目前設定
    const wdForm = $('#onbWebdavForm');
    if (wdForm && _webdavCreds){
      wdForm.style.display = '';
      const urlEl = $('#onbWdUrl'); if (urlEl) urlEl.value = _webdavCreds.url;
      const userEl = $('#onbWdUser'); if (userEl) userEl.value = _webdavCreds.user;
    }
  });

  // ── Settings Gist controls ────────────────────────────────────────────────
  $('#settingsGistDisconnect')?.addEventListener('click', handleGistDisconnect);
  $('#settingsGistReconfig')?.addEventListener('click', () => {
    closeSettings();
    showOnboarding('welcome');
    const gistForm = $('#onbGistForm');
    if (gistForm && _gistCreds){
      gistForm.style.display = '';
      const idEl = $('#onbGistId'); if (idEl) idEl.value = _gistCreds.gistId;
    }
  });

  $('#settingsBtn')?.addEventListener('click', openSettings);
  $('#settingsClose')?.addEventListener('click', closeSettings);
  $('#settingsSwapBookmarks')?.addEventListener('click', handleSwapBookmarks);
  $('#settingsClearBookmarks')?.addEventListener('click', handleClearBookmarks);
  $('#settingsSwapHealth')?.addEventListener('click', handleSwapHealth);
  $('#settingsClearHealth')?.addEventListener('click', handleClearHealth);
  $('#settingsExport')?.addEventListener('click', handleExportJSON);
  $('#settingsImport')?.addEventListener('click', handleImportJSON);
  $('#settingsHealthUrl')?.addEventListener('change', e => handleHealthUrlChange(e.target.value));
  $('#settingsInstallPWA')?.addEventListener('click', handleInstallPWA);
  // 預設內容模式 picker
  const modeWrap = $('#settingsDefaultContentMode');
  if (modeWrap){
    modeWrap.querySelectorAll('.size-option').forEach(el => {
      el.addEventListener('click', () => {
        modeWrap.querySelectorAll('.size-option').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        ensureDataShape();
        DATA.settings.defaultContentMode = el.dataset.mode;
        markDirty();
        if (typeof renderSections === 'function') renderSections();
      });
    });
  }
  // 連結排序 picker
  const sortWrap = $('#settingsSortMode');
  if (sortWrap){
    sortWrap.querySelectorAll('.size-option').forEach(el => {
      el.addEventListener('click', () => {
        sortWrap.querySelectorAll('.size-option').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        ensureDataShape();
        DATA.settings.sortMode = el.dataset.sort;
        markDirty();
        if (typeof renderSections === 'function') renderSections();
        // 切換後也要更新 sortable disabled 狀態(link 排序在非 manual 時禁用)
        if (typeof setSortablesEnabled === 'function') setSortablesEnabled(state.edit);
        // 若 panel 開著也重新打開以套用新順序
        if (typeof activeCard !== 'undefined' && activeCard){
          openPanel(activeCard.dataset.cat, activeCard);
        }
      });
    });
  }
  // 健康狀態列 toggle
  const hbToggle = $('#settingsHealthBarToggle');
  if (hbToggle){
    hbToggle.addEventListener('click', () => {
      ensureDataShape();
      DATA.settings.healthBarEnabled = !(DATA.settings.healthBarEnabled !== false);
      hbToggle.classList.toggle('on', DATA.settings.healthBarEnabled);
      markDirty();
      if (typeof renderHealthBar === 'function') renderHealthBar();
    });
  }

  // 寫入前先 flush(避免關閉頁面時資料沒存)
  window.addEventListener('beforeunload', () => {
    if (_saveTimer){ clearTimeout(_saveTimer); saveBookmarks(); }
  });
}
