/* gist.js
   GitHub Contents API — 把書籤存在 repo 裡的檔案
   用 Personal Access Token (repo scope) 讀寫
   無檔案大小限制，支援 SHA-based 衝突偵測
   API 文件: https://docs.github.com/en/rest/repos/contents */

'use strict';

const GIST_API = 'https://api.github.com';
const GIST_TIMEOUT_MS = 15000;
const GIST_FILENAME = 'znue_bookmarks.json';
// repo 固定是 PIN2714/znue_home，書籤存在 data/ 子目錄避免跟程式碼混在一起
const GIST_REPO = 'PIN2714/znue_home';
const GIST_FILE_PATH = `data/${GIST_FILENAME}`;

/* ── 共用 fetch 包裝 ──────────────────────────────────────────────────────── */
async function _gistFetch(path, opts = {}, token){
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), GIST_TIMEOUT_MS);
  try {
    const resp = await fetch(`${GIST_API}${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
    return resp;
  } finally {
    clearTimeout(tid);
  }
}

/* ── 測試 Token 是否可存取 repo ───────────────────────────────────────────── */
async function gistTest(gistId, token){
  // gistId 參數保留相容性，實際不使用（固定存在 repo）
  try {
    const resp = await _gistFetch(
      `/repos/${GIST_REPO}/contents/${GIST_FILE_PATH}`,
      {}, token
    );
    if (resp.status === 200) return { ok: true, exists: true };
    if (resp.status === 404) return { ok: true, exists: false }; // repo 有權限但檔案還不存在
    if (resp.status === 401) return { ok: false, error: 'Token 無效或無 repo 權限' };
    if (resp.status === 403) return { ok: false, error: 'Token 權限不足，需要 repo scope' };
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch(e){
    if (e.name === 'AbortError') return { ok: false, error: '連線逾時' };
    return { ok: false, error: e.message || String(e) };
  }
}

/* ── 讀取書籤檔內容 ────────────────────────────────────────────────────────── */
/* 回傳 { content, etag, exists } 或拋出 Error */
async function gistGet(gistId, token, knownEtag = '', password = ''){
  const headers = {};
  if (knownEtag) headers['If-None-Match'] = knownEtag;

  const resp = await _gistFetch(
    `/repos/${GIST_REPO}/contents/${GIST_FILE_PATH}`,
    { headers }, token
  );

  if (resp.status === 304) return { notModified: true, etag: knownEtag };
  if (resp.status === 404) return { exists: false, etag: '', content: null, sha: '' };
  if (!resp.ok){
    const body = await resp.text().catch(() => '');
    throw new Error(`讀取失敗: HTTP ${resp.status} ${body.slice(0,120)}`);
  }

  const etag = resp.headers.get('ETag') || '';
  const json = await resp.json();

  // GitHub Contents API 回傳 base64 編碼內容
  const raw = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
  const sha = json.sha || '';

  // 若有密碼則解密，否則直接用（相容舊資料）
  let content;
  if (password){
    try {
      content = await cryptoDecrypt(raw, password);
    } catch(_){
      // 可能是舊的未加密資料，直接用
      content = raw;
    }
  } else {
    content = raw;
  }

  return { exists: true, content, etag, sha };
}

/* ── 寫入書籤檔 ─────────────────────────────────────────────────────────────── */
/* 回傳 { etag, sha } 或拋出 Error */
async function gistPut(gistId, token, content, _unused, sha = '', password = ''){
  // 若有密碼則加密
  const plainOrEncrypted = password ? await cryptoEncrypt(content, password) : content;

  // 內容轉 base64
  const encoded = btoa(unescape(encodeURIComponent(plainOrEncrypted)));

  const body = JSON.stringify({
    message: 'update bookmarks',
    content: encoded,
    ...(sha ? { sha } : {}), // 有 sha 才帶（更新），沒有就是新建
  });

  const resp = await _gistFetch(
    `/repos/${GIST_REPO}/contents/${GIST_FILE_PATH}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, token
  );

  if (!resp.ok){
    const errBody = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('Token 無效，請重新設定');
    if (resp.status === 403) throw new Error('Token 無 repo 寫入權限');
    if (resp.status === 404) throw new Error('找不到 repo，請確認設定');
    if (resp.status === 409) throw new Error('衝突：遠端有更新，請重新整理後再試');
    if (resp.status === 422) throw new Error('SHA 不符，請重新整理頁面');
    throw new Error(`寫入失敗: HTTP ${resp.status} ${errBody.slice(0,120)}`);
  }

  const json = await resp.json();
  const etag = resp.headers.get('ETag') || '';
  const newSha = json.content?.sha || '';
  return { etag, sha: newSha };
}

/* ── 相容舊介面：gistCreate 不再需要，但保留避免 storage.js 呼叫出錯 ──────── */
async function gistCreate(token, content){
  const result = await gistPut('', token, content, '', '');
  return { gistId: GIST_REPO, etag: result.etag };
}
