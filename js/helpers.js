/* helpers.js
   零碎共用工具:DOM 查詢縮寫、ID 生成、HTML 轉義、本機路徑偵測/正規化、
   剪貼簿、icon 渲染、findCat/findLink、IS_TOUCH 偵測、tip toast。
   這些函式不依賴其他模組(除了 state、DATA),在最早期就能載入。 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function uid(prefix='id'){ return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }

/* 取得卡片實際的排序模式
   - cat.sortMode 有設(manual / clicks / recent)→ 用該值
   - 沒設 → fallback 到全域 DATA.settings.sortMode
   - 都沒 → 'manual' */
function effectiveSortMode(cat){
  if (cat && cat.sortMode && cat.sortMode !== 'inherit'){
    return cat.sortMode;
  }
  return (DATA && DATA.settings && DATA.settings.sortMode) || 'manual';
}

/* 排序連結 — 依 effectiveSortMode(cat)
   回傳新 array(不 mutate 原 array,以保留拖曳的手動順序在資料層) */
function sortLinks(links, cat){
  if (!links || links.length === 0) return links;
  const mode = effectiveSortMode(cat);
  if (mode === 'manual') return links;
  const copy = [...links];
  if (mode === 'clicks'){
    copy.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
  } else if (mode === 'recent'){
    copy.sort((a, b) => {
      const ta = a.lastClicked || '';
      const tb = b.lastClicked || '';
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);  // 新的在前
    });
  }
  return copy;
}

function isLongMemo(memo){
  if (!memo) return false;
  return memo.length > 40 || memo.includes('\n');
}

function renderIcon(icon, iconType){
  if (iconType === 'image' && icon) return `<img src="${icon}" alt="" />`;
  // 文字 icon — 多字時把每字符 wrap 成 <span>,讓 CSS grid 排成 2x2 / 2-上-1-下 等版面
  if (iconType === 'text' && typeof icon === 'string'){
    const chars = [...icon];  // [...] 處理中文 surrogate pair
    if (chars.length > 1){
      const len = Math.min(chars.length, 4);
      return chars.slice(0, len).map(c => `<span>${escapeHtml(c)}</span>`).join('');
    }
  }
  return icon || '?';
}

/* 給 icon 容器 (.cat-icon / .quick-icon / .favicon / .arc-card-icon) 用的 attribute string
   iconType='text' 且字符數 >1 時加 data-text-len="N",CSS 用 [data-text-len="N"] 控制 layout/size */
function iconAttrs(icon, iconType){
  if (iconType === 'text' && typeof icon === 'string'){
    const visualLen = [...icon].length;
    if (visualLen > 1) return ` data-text-len="${Math.min(visualLen, 4)}"`;
  }
  return '';
}

/* 在 DATA.sections 找卡片 */
function findCat(id){
  for (const sec of DATA.sections){
    const c = sec.categories.find(x => x.id === id);
    if (c) return { cat: c, section: sec };
  }
  return null;
}

/* 在 DATA.sections 找連結 */
function findLink(id){
  for (const sec of DATA.sections){
    for (const c of sec.categories){
      for (const g of c.groups){
        const l = g.links.find(x => x.id === id);
        if (l) return { link: l, group: g, cat: c, section: sec };
      }
    }
  }
  return null;
}

/* 在主面板 + 封存區一起找
   回傳物件附 location: 'main' 或 'archive:<tabId>' 表示來源 */
function findCatAnywhere(id){
  const main = findCat(id);
  if (main) return { ...main, tab: null, location: 'main' };
  for (const tab of (DATA.archive?.tabs || [])){
    for (const sec of (tab.sections || [])){
      const cat = (sec.categories || []).find(x => x.id === id);
      if (cat) return { cat, section: sec, tab, location: `archive:${tab.id}` };
    }
  }
  return null;
}

function findLinkAnywhere(id){
  const main = findLink(id);
  if (main) return { ...main, tab: null, location: 'main' };
  for (const tab of (DATA.archive?.tabs || [])){
    for (const sec of (tab.sections || [])){
      for (const cat of (sec.categories || [])){
        for (const g of (cat.groups || [])){
          const l = (g.links || []).find(x => x.id === id);
          if (l) return { link: l, group: g, cat, section: sec, tab, location: `archive:${tab.id}` };
        }
      }
    }
  }
  return null;
}

/* 找 section(主面板 + 封存) — 用於 addCardToSection 對 archive section 也能用 */
function findSectionAnywhere(id){
  const m = DATA.sections.find(s => s.id === id);
  if (m) return { section: m, tab: null, location: 'main' };
  for (const tab of (DATA.archive?.tabs || [])){
    const s = (tab.sections || []).find(x => x.id === id);
    if (s) return { section: s, tab, location: `archive:${tab.id}` };
  }
  return null;
}

/* === 本機路徑偵測 + 正規化 ===
   把使用者輸入的各種本機路徑格式,轉成可被瀏覽器 / Local Explorer 接受的標準格式 */
function isLocalPath(url){
  if (!url) return false;
  if (url.startsWith('file:')) return true;
  // Windows 磁碟代號:D:\... 或 D:/...
  if (/^[a-zA-Z]:[\\/]/.test(url)) return true;
  // UNC: \\server\share
  if (url.startsWith('\\\\')) return true;
  // Unix 絕對路徑
  if (url.startsWith('/Users/') || url.startsWith('/home/') || url.startsWith('/Volumes/')) return true;
  // ~ 家目錄
  if (url.startsWith('~/')) return true;
  return false;
}

function normalizeLocalPath(url){
  if (!url) return url;
  let s = url.trim();
  if (s.startsWith('file:')) {
    return s.replace(/\\/g, '/');
  }
  if (/^[a-zA-Z]:[\\/]/.test(s)){
    return 'file:///' + s.replace(/\\/g, '/');
  }
  if (s.startsWith('\\\\')){
    return 'file://' + s.slice(2).replace(/\\/g, '/');
  }
  if (s.startsWith('/')){
    return 'file://' + s;
  }
  // 家目錄不展開(需要知道使用者),保持原樣讓使用者改
  return s;
}

function copyToClipboard(text){
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text);
      return;
    }
  } catch(_){}
  // fallback
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch(_){}
  document.body.removeChild(ta);
}

/* 觸控裝置偵測:沒有 hover 能力 → 改用點擊觸發 panel */
const IS_TOUCH = !window.matchMedia('(hover: hover)').matches;

/* tip toast — 短暫顯示在底部中央 */
let _tipTimer = null;
function showTip(msg){
  const tip = $('#tip');
  if (!tip) return;
  tip.textContent = msg;
  tip.classList.add('show');
  clearTimeout(_tipTimer);
  _tipTimer = setTimeout(() => tip.classList.remove('show'), 1800);
}
