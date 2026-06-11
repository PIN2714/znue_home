/* render.js
   主面板渲染:卡片網格 + 卡片 hover 面板 + memo popover
   - renderCard(cat) / renderSections(): 主面板卡片網格
   - renderPanelFor(cat) / openPanel / closePanel / togglePinCardPanel: hover 面板
   - bindHover(): 60ms 開、140ms 關;觸控裝置改點擊
   - showMemoPop / hideMemoPop: 長備註 hover 浮窗
   - startInlineEdit / bindSectionInlineEdit: 雙擊改名
   依賴:DATA、state、helpers、md、IS_TOUCH */

/* ===== 內容顯示 helpers ===== */
// 解析「實際顯示模式」:auto → 由 settings.defaultContentMode 決定
function effectiveContentMode(cat){
  const m = cat.contentMode || 'auto';
  if (m === 'auto'){
    return (DATA.settings && DATA.settings.defaultContentMode) || 'list';
  }
  return m;
}
// 解析「實際行數」:null → 依 size 預設(large=3, medium=2, small=1)
function effectiveContentRows(cat){
  if (cat.contentRows != null) return cat.contentRows;
  if (cat.size === 'large') return 3;
  if (cat.size === 'medium') return 2;
  return 1;  // small
}
// 解析「grid 一行幾個 icon」:null → auto fit
function effectiveGridCols(cat){
  if (cat.gridCols != null) return cat.gridCols;
  return null;  // auto fit
}
// quickLinks 解析:支援 string (link.id 由 groups lookup) 或舊 {title,url}
// 沒設 quickLinks 時自動 fallback — 取 groups 內所有 link 作為候選
// 顯式設定的 quickLinks 保留使用者排序;fallback 套用 sortMode
//
// 對舊 {title,url} 格式的 entry,先嘗試用 url 在 groups 內找對應 link(自動升級拿到 icon),
// 找不到才回傳原 {title,url} 物件 — 這樣即使是舊資料(像重命名後留下的 quickLinks)也能正確顯示 icon
function resolveQuickLinks(cat){
  if (cat.quickLinks && cat.quickLinks.length > 0){
    return cat.quickLinks.map(q => {
      if (typeof q === 'string'){
        for (const g of cat.groups || []){
          const found = (g.links || []).find(l => l.id === q);
          if (found) return found;
        }
        return null;  // id 失效(原連結被刪)
      }
      // 舊 {title, url} 格式 — 嘗試用 url 在 groups 內找對應 link
      if (q && q.url && q.url !== '#'){
        for (const g of cat.groups || []){
          const found = (g.links || []).find(l => l.url === q.url);
          if (found) return found;  // 升級到完整 link 物件,有 icon
        }
      }
      return q;  // 找不到對應就直接用舊格式(renderCard 會用 title 第一字當 placeholder)
    }).filter(Boolean);
  }
  // fallback:沒 quickLinks 時,自動列出所有 group 的所有 link 並依該卡 sortMode 排序
  const all = [];
  for (const g of (cat.groups || [])){
    for (const l of (g.links || [])) all.push(l);
  }
  return sortLinks(all, cat);
}

function renderCard(cat){
  // 防禦:過濾任何意外出現的 null group / null link(避免一個 bug 把整個 grid 拖垮)
  if (Array.isArray(cat.groups)){
    cat.groups = cat.groups.filter(g => g != null);
    for (const g of cat.groups){
      if (Array.isArray(g.links)) g.links = g.links.filter(l => l != null);
      else g.links = [];
    }
  } else {
    cat.groups = [];
  }
  const linkCount = cat.groups.reduce((a,g)=> a + (g.links ? g.links.length : 0), 0);
  const groupCount = cat.groups.length;
  const size = cat.size || 'medium';
  // 新預設:不論 size,只要 contentMode !== 'hidden' 就顯示 quickLinks。
  // .content-hidden class 觸發 CSS 回到緊湊 layout(small=inline、medium/large=無內容)
  const mode = effectiveContentMode(cat);
  const isHidden = (cat.contentMode === 'hidden');
  const rows = effectiveContentRows(cat);
  const cols = effectiveGridCols(cat);

  let inner = `
    <div class="card-edit-tools">
      <button class="icon-btn" onclick="event.stopPropagation(); openCardEdit('${cat.id}')" title="編輯卡片">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </button>
    </div>
    <div class="cat-head">
      <span class="cat-icon"${iconAttrs(cat.icon, cat.iconType)}>${renderIcon(cat.icon, cat.iconType)}</span>
      <span class="cat-title">${cat.title}</span>
    </div>
  `;

  // 內容(quick links)— 兩種模式
  // 不論 hidden 與否都產出 markup,讓 hide/show 純由 CSS 控制(避免 hide → show 時 markup 重新生成)
  const allQuick = isHidden ? [] : resolveQuickLinks(cat);
  if (allQuick.length){
    if (mode === 'grid'){
      const colsAttr = cols ? `style="--cols:${cols}"` : '';
      const colsClass = cols ? '' : 'auto-fit';
      inner += `<div class="quick-grid ${colsClass}" data-rows="${rows}" ${colsAttr}>`;
      // grid mode:rows × cols 個 icon (cols=null 用 CSS auto-fit,我們不限制總數)
      const limit = cols ? rows * cols : rows * 6;  // auto-fit 預估每行 6 個
      for (const q of allQuick.slice(0, limit)){
        // 沒 icon 但有 title → 用 title 前 1-2 字當 placeholder(text icon 風格,不再顯示 '?')
        let iconChar = q.icon, iconKind = q.iconType;
        if ((!iconChar) && q.title){
          iconChar = [...q.title].slice(0, 2).join('');
          iconKind = 'text';
        }
        const icon = renderIcon(iconChar, iconKind);
        const attrs = iconAttrs(iconChar, iconKind);
        inner += `<a class="quick-icon"${attrs} href="${q.url}" target="_blank" title="${(q.title||'').replace(/"/g,'&quot;')}" onclick="event.stopPropagation(); incrementClicks && incrementClicks('${q.id||''}')">${icon}</a>`;
      }
      inner += `</div>`;
    } else {
      // list 模式
      inner += `<div class="quick-links" data-rows="${rows}">`;
      for (const q of allQuick.slice(0, rows)){
        inner += `<a class="quick-link" href="${q.url}" target="_blank" onclick="event.stopPropagation(); incrementClicks && incrementClicks('${q.id||''}')">${q.title}</a>`;
      }
      inner += `</div>`;
    }
  }

  // meta(連結 / 群組數量 + 「→」 提示)
  // 顯示在所有 size 底部,但 hidden 模式下 small 會被 CSS 隱藏
  if (size === 'large'){
    inner += `<div class="cat-meta"><span>${linkCount} links · ${groupCount} groups</span><span class="arrow">→ hover</span></div>`;
  } else {
    inner += `<div class="cat-meta"><span>${linkCount} links</span><span>${groupCount} groups</span><span class="arrow">→</span></div>`;
  }

  const cls = `cat size-${size}` + (isHidden ? ' content-hidden' : '');
  return `<div class="${cls}" data-cat="${cat.id}" data-content-mode="${mode}"
    style="--cat-tint:${cat.tint}33; --cat-color:${cat.color}; ${size==='large' && !isHidden ?`background: linear-gradient(180deg, ${cat.tint}26 0%, var(--card) 80%);`:''}">${inner}</div>`;
}

/* ===== Hero / brand 可編輯 =====
   讀 DATA.settings.{brandText, heroMark, heroQuote} 渲染;雙擊在編輯模式 inline edit。
   heroQuote 允許 inline HTML(支援 <em>),其他純文字。 */
function renderHero(){
  ensureDataShape && ensureDataShape();
  const brand = $('#brandText');
  if (brand) brand.textContent = (DATA.settings && DATA.settings.brandText) || 'home';
  const mark = $('#heroMark');
  if (mark) mark.textContent = (DATA.settings && DATA.settings.heroMark) || '// 2026 — your home, your map';
  const body = $('#heroBody');
  if (body) body.innerHTML = (DATA.settings && DATA.settings.heroQuote) || '一個給你 <em>常去的地方</em> 的安靜入口。';
}

function bindHeroEditing(){
  const cfgs = [
    { selector: '#brandText',  key: 'brandText',  rich: false },
    { selector: '#heroMark',   key: 'heroMark',   rich: false },
    { selector: '#heroBody',   key: 'heroQuote',  rich: true  },
  ];
  for (const c of cfgs){
    const el = $(c.selector);
    if (!el) continue;
    el.addEventListener('dblclick', () => {
      if (!state.edit) return;
      const original = c.rich ? el.innerHTML : el.textContent;
      el.contentEditable = 'true';
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      const finish = () => {
        el.contentEditable = 'false';
        const newVal = c.rich ? el.innerHTML.trim() : el.textContent.trim();
        if (newVal && newVal !== original){
          ensureDataShape();
          DATA.settings[c.key] = newVal;
          markDirty();
          showTip('已儲存');
        } else if (!newVal){
          // 還原預設(用 renderHero 重畫)
          renderHero();
        }
        el.removeEventListener('blur', finish);
        el.removeEventListener('keydown', onKey);
      };
      const onKey = e => {
        if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); el.blur(); }
        if (e.key === 'Escape'){
          if (c.rich) el.innerHTML = original; else el.textContent = original;
          el.blur();
        }
      };
      el.addEventListener('blur', finish);
      el.addEventListener('keydown', onKey);
    });
  }
}

/* ===== Tag rows that contain a large card =====
   CSS 不知道哪些卡同 row,我們用 getBoundingClientRect().top 反算。
   row 內有 .size-large 時,給 row 內所有非 large 卡加 .row-large-mode。
   呼叫時機:renderSections 後、window resize 後(debounced) */
function tagLargeRows(){
  $$('.section .grid').forEach(grid => {
    const cards = [...grid.querySelectorAll('.cat:not(.add-card)')];
    if (cards.length === 0) return;
    // 先清掉舊 class
    cards.forEach(c => c.classList.remove('row-large-mode'));
    // 用容差(5px)比較 top — 防 sub-pixel 把同 row 切成兩列
    const rowsArr = []; // [{top, cards: []}]
    for (const c of cards){
      const top = c.getBoundingClientRect().top;
      let bucket = rowsArr.find(r => Math.abs(r.top - top) < 5);
      if (!bucket){
        bucket = { top, cards: [] };
        rowsArr.push(bucket);
      }
      bucket.cards.push(c);
    }
    for (const r of rowsArr){
      const hasLarge = r.cards.some(c => c.classList.contains('size-large'));
      if (!hasLarge) continue;
      for (const c of r.cards){
        if (!c.classList.contains('size-large')){
          c.classList.add('row-large-mode');
        }
      }
    }
  });
}

function renderSections(){
  $('#sectionsWrap').innerHTML = DATA.sections.map(sec => `
    <div class="section" data-section="${sec.id}">
      <div class="section-head">
        <h2 data-edit-section-name="${sec.id}">${sec.name}</h2>
        <span class="tag">${sec.hint || ''}</span>
        <span class="count">${sec.categories.length} cards</span>
        <span class="sec-actions">
          <button class="icon-btn" onclick="addCardToSection('${sec.id}')" title="新增卡片">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button class="icon-btn" onclick="deleteSection('${sec.id}')" title="刪除區段">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </span>
      </div>
      <div class="grid">
        ${sec.categories.map(renderCard).join('')}
        <button class="add-card size-medium" onclick="addCardToSection('${sec.id}')">+ 新增卡片</button>
      </div>
    </div>
  `).join('');
  bindHover();
  bindSectionInlineEdit();
  if (typeof setupSectionsSortable === 'function') setupSectionsSortable();
  if (typeof setupCardsSortables === 'function') setupCardsSortables();
  // 等下一個 frame layout 完成後再算 row(initial render 還沒完成 layout)
  requestAnimationFrame(tagLargeRows);
}

function bindSectionInlineEdit(){
  $$('[data-edit-section-name]').forEach(el => {
    el.addEventListener('dblclick', () => {
      if (!state.edit) return;
      startInlineEdit(el, (newText) => {
        const sec = DATA.sections.find(s => s.id === el.dataset.editSectionName);
        if (sec){ sec.name = newText || sec.name; markDirty(); showTip('區段名稱已更新'); }
      });
    });
  });
}

function startInlineEdit(el, onSave){
  const original = el.textContent;
  el.contentEditable = 'true';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  const finish = () => {
    el.contentEditable = 'false';
    const newText = el.textContent.trim();
    if (newText && newText !== original){
      onSave(newText);
    } else {
      el.textContent = original;
    }
    el.removeEventListener('blur', finish);
    el.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Enter'){ e.preventDefault(); el.blur(); }
    if (e.key === 'Escape'){ el.textContent = original; el.blur(); }
  };
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', onKey);
}

/* ===== Hover panel ===== */
function renderPanelFor(cat){
  const isPinned = state.pinnedCardPanel === cat.id;
  // 判斷卡片在哪裡(main / archive)— 影響右上角按鈕
  const located = findCatAnywhere(cat.id);
  const inArchive = located && located.location && located.location.startsWith('archive:');
  const archiveTabId = inArchive && located.tab ? located.tab.id : '';
  // 主面板 → 「📦 封存」;封存區 → 「↺ 還原」
  const locationBtn = inArchive
    ? `<button class="archive-row-btn" title="還原到主面板"
        onclick="event.stopPropagation(); restoreFromArchive('${cat.id}', '${archiveTabId}')">↺</button>`
    : `<button class="archive-row-btn" title="封存此卡片"
        onclick="event.stopPropagation(); archiveCard('${cat.id}')">📦</button>`;
  let inner = `
    <div class="panel-head">
      <span class="cat-icon"${iconAttrs(cat.icon, cat.iconType)} style="background:${cat.tint}; color:${cat.color}">${renderIcon(cat.icon, cat.iconType)}</span>
      <h3>${cat.title}</h3>
      <div class="panel-actions">
        ${locationBtn}
        <button class="icon-btn" onclick="openCardEdit('${cat.id}')" title="編輯卡片">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button class="pin-btn ${isPinned ? 'active' : ''}" title="${isPinned ? '取消釘選' : '釘選面板'}"
          onclick="event.stopPropagation(); togglePinCardPanel('${cat.id}')">📌</button>
      </div>
    </div>
  `;
  cat.groups.forEach((g, gi) => {
    if (!g) return;  // 防禦
    inner += `<div class="group" data-group-idx="${gi}">
      <div class="group-header">
        <span class="group-title-text" data-group-name="${cat.id}-${gi}">${g.name}</span>
        <span class="group-actions">
          <button class="icon-btn" onclick="openGroupEdit('${cat.id}', ${gi})" title="編輯群組">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" onclick="addLinkToGroup('${cat.id}', ${gi})" title="新增連結">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </span>
      </div>`;
    if (g.memo){
      inner += `<div class="group-memo">${md(g.memo)}</div>`;
    }
    // 套用 sortMode(manual / clicks / recent)— 不 mutate g.links 本身
    sortLinks(g.links, cat).forEach(l => {
      const long = isLongMemo(l.memo);
      const memoCls = l.memoPinned ? 'pinned' : (long ? 'collapsed' : '');
      const memoContent = l.memoPinned ? md(l.memo || '') : (long ? escapeHtml((l.memo||'').split('\n')[0]) : md(l.memo || ''));
      const memoHtml = l.memo ? `<div class="link-memo ${memoCls}" data-link-id="${l.id}" ${long && !l.memoPinned ? `onmouseenter="showMemoPop(event, '${l.id}')" onmouseleave="hideMemoPop()"`:''}>${memoContent}</div>` : '';
      const pinMark = l.pinned ? `<span class="pin-mark">★</span>` : '';
      let host = '';
      const isLocal = isLocalPath(l.url);
      try { if (l.url && l.url !== '#' && !isLocal) host = new URL(l.url).hostname; } catch(e){}
      const localBadge = isLocal ? `<span class="local-badge" title="本機連結 · 需 Local Explorer 擴充才能直接跳轉">📁 local</span>` : '';
      const copyBtn = isLocal ? `
        <button class="icon-btn" data-copy="1" onclick="event.stopPropagation(); copyToClipboard('${(l.url||'').replace(/'/g,"\\'")}'); showTip('路徑已複製')" title="複製路徑">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>` : '';
      inner += `
        <div class="link" data-link="${l.id}">
          <span class="favicon"${iconAttrs(l.icon, l.iconType)} style="background:${cat.color}"
            onclick="event.stopPropagation(); state.edit && openIconPickerForLink(event, '${l.id}')">
            ${renderIcon(l.icon, l.iconType)}
          </span>
          <a href="${l.url}" target="_blank" class="link-body" onclick="event.stopPropagation(); incrementClicks('${l.id}')">
            <div class="link-title">${l.title}${pinMark}</div>
            ${memoHtml}
            <div class="link-meta">
              <span>${l.clicks||0} clicks</span>
              ${localBadge}
              ${host ? `<span>${host}</span>` : ''}
            </div>
          </a>
          <div class="row-actions">
            ${copyBtn}
            <button class="icon-btn" onclick="event.stopPropagation(); openLinkEdit('${l.id}')" title="編輯">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
          </div>
        </div>
      `;
    });
    inner += `<button class="add-link" onclick="addLinkToGroup('${cat.id}', ${gi})">+ 新增連結到「${g.name}」</button>`;
    inner += `</div>`;
  });
  inner += `<button class="add-group" onclick="addGroupToCard('${cat.id}')">+ 新增群組</button>`;
  return inner;
}

let _panelEl = null;
let _hoverTimer = null, _leaveTimer = null;
// activeCard 是當前 hover 的卡片元素;editing.js / archive.js 會跨檔讀寫
let activeCard = null;

function openPanel(catId, anchor){
  if (!_panelEl) _panelEl = $('#hoverPanel');
  const found = findCatAnywhere(catId);
  if (!found) return;
  _panelEl.innerHTML = renderPanelFor(found.cat);
  _panelEl.classList.toggle('pinned', state.pinnedCardPanel === catId);
  const r = anchor.getBoundingClientRect();
  const PAD = 8;
  _panelEl.style.top = (r.bottom + PAD) + 'px';
  _panelEl.style.left = r.left + 'px';
  _panelEl.classList.add('show');
  requestAnimationFrame(() => {
    const pr = _panelEl.getBoundingClientRect();
    if (pr.right > window.innerWidth - 12) _panelEl.style.left = Math.max(12, window.innerWidth - pr.width - 12) + 'px';
    if (pr.bottom > window.innerHeight - 12) _panelEl.style.top = Math.max(12, r.top - pr.height - PAD) + 'px';
  });
  if (activeCard) activeCard.classList.remove('is-open');
  anchor.classList.add('is-open');
  activeCard = anchor;

  // bind double-click on group titles within panel
  _panelEl.querySelectorAll('.group-title-text').forEach(el => {
    el.addEventListener('dblclick', () => {
      if (!state.edit) return;
      const [catId, gi] = el.dataset.groupName.split('-');
      const f = findCatAnywhere(catId);
      if (!f) return;
      const g = f.cat.groups[Number(gi)];
      startInlineEdit(el, (newText) => {
        g.name = newText;
        markDirty();
        showTip('群組名稱已更新');
        if (activeCard) openPanel(activeCard.dataset.cat, activeCard);
      });
    });
  });

  // 拖曳排序(group / links)
  if (typeof setupPanelSortables === 'function') setupPanelSortables(catId);
}

function closePanel(){
  if (!_panelEl) _panelEl = $('#hoverPanel');
  // 如果有釘選的面板,且是這張,就不關
  if (activeCard && state.pinnedCardPanel === activeCard.dataset.cat) return;
  _panelEl.classList.remove('show');
  _panelEl.classList.remove('pinned');
  if (activeCard) activeCard.classList.remove('is-open');
  activeCard = null;
}

function togglePinCardPanel(catId){
  if (!_panelEl) _panelEl = $('#hoverPanel');
  if (state.pinnedCardPanel === catId){
    state.pinnedCardPanel = null;
    _panelEl.classList.remove('pinned');
    _panelEl.querySelectorAll('.pin-btn').forEach(b => b.classList.remove('active'));
  } else {
    state.pinnedCardPanel = catId;
    _panelEl.classList.add('pinned');
    _panelEl.querySelectorAll('.pin-btn').forEach(b => b.classList.add('active'));
  }
}

// 全域只綁一次的監聽器(_panelEl 的 mouseenter/mouseleave、document click)
let _panelGlobalBound = false;

/* 給任意 selector 的元素綁 panel hover/click 行為。
   主面板 .cat 跟封存區 .arc-card 都用這個。 */
function bindHoverElements(selector){
  if (!_panelEl) _panelEl = $('#hoverPanel');
  $$(selector).forEach(el => {
    if (!el.dataset.cat) return;  // 沒 catId 跳過
    el.addEventListener('mouseenter', () => {
      if (state.edit) return;
      if (state.pinnedCardPanel && state.pinnedCardPanel !== el.dataset.cat) return;
      clearTimeout(_leaveTimer);
      _hoverTimer = setTimeout(() => openPanel(el.dataset.cat, el), 60);
    });
    el.addEventListener('mouseleave', () => {
      if (state.edit) return;
      clearTimeout(_hoverTimer);
      _leaveTimer = setTimeout(() => { if (!_panelEl.matches(':hover')) closePanel(); }, 140);
    });
    el.addEventListener('click', (e) => {
      if (state.edit || IS_TOUCH){
        if (_panelEl.classList.contains('show') && activeCard === el){
          if (IS_TOUCH && !state.edit) closePanel();
          return;
        }
        openPanel(el.dataset.cat, el);
      }
    });
  });
}

/* 一次性綁 panel 自身與 document 的監聽 */
function bindPanelGlobalsOnce(){
  if (_panelGlobalBound) return;
  _panelGlobalBound = true;
  if (!_panelEl) _panelEl = $('#hoverPanel');

  _panelEl.addEventListener('mouseenter', () => {
    if (state.edit) return;
    clearTimeout(_leaveTimer);
  });
  _panelEl.addEventListener('mouseleave', () => {
    if (state.edit) return;
    _leaveTimer = setTimeout(closePanel, 140);
  });

  document.addEventListener('click', (e) => {
    if (!_panelEl.classList.contains('show')) return;
    if (!state.edit && !IS_TOUCH) return;
    if (_panelEl.contains(e.target)) return;
    if (e.target.closest('[data-cat]')) return;  // .cat 與 .arc-card 都靠 data-cat 標記
    if (e.target.closest('.modal')) return;
    if (e.target.closest('.modal-backdrop')) return;
    if (e.target.closest('.icon-picker')) return;
    if (e.target.closest('.md-popover')) return;
    if (e.target.closest('.memo-pop')) return;
    if (e.target.closest('.onboarding')) return;
    closePanel();
  });
}

/* 主面板 hover 綁定 — 在 renderSections 後呼叫 */
function bindHover(){
  bindHoverElements('.cat:not(.add-card)');
  bindPanelGlobalsOnce();
}

/* ===== Memo popover ===== */
let _memoPopEl = null;
let _memoPopTimer = null;
function showMemoPop(e, linkId){
  if (!_memoPopEl) _memoPopEl = $('#memoPop');
  clearTimeout(_memoPopTimer);
  const found = findLink(linkId);
  if (!found || !found.link.memo) return;
  _memoPopEl.innerHTML = md(found.link.memo);
  const r = e.target.getBoundingClientRect();
  _memoPopEl.style.left = r.left + 'px';
  _memoPopEl.style.top = (r.bottom + 6) + 'px';
  _memoPopEl.classList.add('show');
  requestAnimationFrame(() => {
    const pr = _memoPopEl.getBoundingClientRect();
    if (pr.right > window.innerWidth - 12) _memoPopEl.style.left = Math.max(12, window.innerWidth - pr.width - 12) + 'px';
    if (pr.bottom > window.innerHeight - 12) _memoPopEl.style.top = Math.max(12, r.top - pr.height - 6) + 'px';
  });
}
function hideMemoPop(){
  if (!_memoPopEl) _memoPopEl = $('#memoPop');
  _memoPopTimer = setTimeout(() => _memoPopEl.classList.remove('show'), 120);
}
