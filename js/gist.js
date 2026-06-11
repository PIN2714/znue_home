/* gist.js
   GitHub Gist 作為書籤後端 — 跨裝置同步的核心模組
   - 用 Personal Access Token (gist scope only) 讀寫 Gist
   - ETag-based 條件請求，避免不必要的 API 消耗
   - 離線時 fallback IDB 快取，重連後自動同步
   API 文件: https://docs.github.com/en/rest/gists/gists */

'use strict';

const GIST_API = 'https://api.github.com/gists';
const GIST_TIMEOUT_MS = 10000;
const GIST_FILENAME = 'znue_bookmarks.json';

/* ── 共用 fetch 包裝 ──────────────────────────────────────────────────────── */
async function _gistFetch(url, opts = {}, token){
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), GIST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
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

/* ── 測試 Token + Gist 是否可存取 ─────────────────────────────────────────── */
/* 回傳 { ok, exists, error } */
async function gistTest(gistId, token){
  try {
    const resp = await _gistFetch(`${GIST_API}/${gistId}`, {}, token);
    if (resp.status === 200){
      const json = await resp.json();
      const exists = GIST_FILENAME in (json.files || {});
      return { ok: true, exists };
    }
    if (resp.status === 401) return { ok: false, error: 'Token 無效或無 gist 權限' };
    if (resp.status === 403) return { ok: false, error: 'Token 權限不足' };
    if (resp.status === 404) return { ok: false, error: 'Gist ID 不存在，或 Token 無法存取此 Gist' };
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch(e){
    if (e.name === 'AbortError') return { ok: false, error: '連線逾時' };
    return { ok: false, error: e.message || String(e) };
  }
}

/* ── 讀取 Gist 內容 ────────────────────────────────────────────────────────── */
/* 回傳 { content, etag, exists } 或拋出 Error */
async function gistGet(gistId, token, knownEtag = ''){
  const headers = {};
  if (knownEtag) headers['If-None-Match'] = knownEtag;

  const resp = await _gistFetch(`${GIST_API}/${gistId}`, { headers }, token);

  if (resp.status === 304){
    // 未改變，caller 自行使用快取
    return { notModified: true, etag: knownEtag };
  }
  if (resp.status === 404){
    return { exists: false, etag: '', content: null };
  }
  if (!resp.ok){
    const body = await resp.text().catch(() => '');
    throw new Error(`Gist GET 失敗: HTTP ${resp.status} ${body.slice(0,120)}`);
  }

  const json = await resp.json();
  const etag = resp.headers.get('ETag') || '';
  const fileObj = json.files?.[GIST_FILENAME];

  if (!fileObj){
    // Gist 存在但裡面還沒有書籤檔案
    return { exists: false, etag, content: null };
  }

  // 小檔案直接在 files 裡；大檔案要用 raw_url 再拉一次
  let content = fileObj.content;
  if (fileObj.truncated && fileObj.raw_url){
    const raw = await fetch(fileObj.raw_url, { signal: AbortSignal.timeout(GIST_TIMEOUT_MS) });
    if (!raw.ok) throw new Error('Gist raw content 讀取失敗');
    content = await raw.text();
  }

  return { exists: true, content, etag };
}

/* ── 寫入 / 更新 Gist 內容 ─────────────────────────────────────────────────── */
/* 回傳 { etag } 或拋出 Error */
async function gistPut(gistId, token, content){
  const body = JSON.stringify({
    files: {
      [GIST_FILENAME]: { content }
    }
  });

  const resp = await _gistFetch(`${GIST_API}/${gistId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  }, token);

  if (!resp.ok){
    const errBody = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('Token 無效，請重新設定');
    if (resp.status === 403) throw new Error('Token 無 gist 寫入權限');
    if (resp.status === 404) throw new Error('找不到 Gist，請確認 Gist ID');
    if (resp.status === 422) throw new Error('Gist 內容格式錯誤');
    throw new Error(`Gist PUT 失敗: HTTP ${resp.status} ${errBody.slice(0,120)}`);
  }

  const json = await resp.json();
  const etag = resp.headers.get('ETag') || '';
  return { etag };
}

/* ── 建立新 Gist（首次使用，如果使用者提供的 Gist ID 是空的） ─────────────── */
/* 回傳 { gistId, etag } */
async function gistCreate(token, content){
  const body = JSON.stringify({
    description: 'znue_home bookmarks',
    public: false,
    files: {
      [GIST_FILENAME]: { content }
    }
  });

  const resp = await _gistFetch(GIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }, token);

  if (!resp.ok){
    const errBody = await resp.text().catch(() => '');
    throw new Error(`建立 Gist 失敗: HTTP ${resp.status} ${errBody.slice(0,120)}`);
  }

  const json = await resp.json();
  const etag = resp.headers.get('ETag') || '';
  return { gistId: json.id, etag };
}
