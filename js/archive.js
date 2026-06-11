/* archive.js
   封存區:右側手把 + 滑出面板 + tabs(已完成 / 很少用 / 季節性…)
   - openArchive / closeArchive / toggleArchivePin: 面板開關 + 釘選
   - renderArchive(): 重繪 tabs 與內容
   - archiveCard(catId): 把卡片從主面板封存到「最後使用的 tab」
   - restoreFromArchive(catId, tabId): 還原卡片到第一個主 section
   依賴:DATA、state、helpers、render 的 renderSections */

function openArchive(){
  state.archiveOpen = true;
  $('#arcPanel').classList.add('open');
  renderArchive();
}
function closeArchive(){
  if (state.archivePinned) return;
  state.archiveOpen = false;
  $('#arcPanel').classList.remove('open');
}
function toggleArchivePin(){
  state.archivePinned = !state.archivePinned;
  document.body.classList.toggle('archive-pinned', state.archivePinned);
  $('#arcPinBtn').classList.toggle('active', state.archivePinned);
  if (state.archivePinned){
    state.archiveOpen = true;
    $('#arcPanel').classList.add('open');
  }
}

function renderArchive(){
  const arc = DATA.archive;
  if (!arc){ $('#arcBody').innerHTML = '<div class="arc-empty">沒有封存區</div>'; return; }
  // tabs
  const tabsEl = $('#arcTabs');
  let tabsHtml = `<button class="arc-tab all ${state.archiveActiveTab === 'all' ? 'active' : ''}" data-tab="all">☰ 全部</button>`;
  tabsHtml += arc.tabs.map(t => `
    <button class="arc-tab ${state.archiveActiveTab === t.id ? 'active' : ''}" data-tab="${t.id}">
      ${escapeHtml(t.name)}
      <span class="arc-tab-x" data-del="${t.id}" title="刪除分頁">✕</span>
    </button>
  `).join('');
  tabsHtml += `<button class="arc-tab-add" id="arcTabAdd" title="新增分頁">+</button>`;
  tabsEl.innerHTML = tabsHtml;
  // body
  const body = $('#arcBody');
  let tabsToShow = state.archiveActiveTab === 'all' ? arc.tabs : arc.tabs.filter(t => t.id === state.archiveActiveTab);
  if (tabsToShow.length === 0){
    body.innerHTML = '<div class="arc-empty">這個分頁是空的</div>';
  } else {
    body.innerHTML = tabsToShow.map(tab => {
      let html = '';
      if (state.archiveActiveTab === 'all'){
        html += `<div class="arc-section-head" style="color:var(--accent); font-style:normal; font-family:var(--serif); font-size:13px;">${escapeHtml(tab.name)}</div>`;
      }
      tab.sections.forEach(sec => {
        html += `<div class="arc-section" data-arc-tab="${tab.id}" data-arc-sec="${sec.id}">`;
        html += `<div class="arc-section-head">${escapeHtml(sec.name)}</div>`;
        if (sec.categories.length === 0){
          html += `<div class="arc-empty" style="padding:10px;">(沒有卡片)</div>`;
        } else {
          sec.categories.forEach(cat => {
            html += renderArchiveCardHtml(cat, tab.id);
          });
        }
        html += `</div>`;
      });
      return html;
    }).join('');
  }
  // 計數
  let totalCats = 0, totalLinks = 0;
  arc.tabs.forEach(tab => tab.sections.forEach(sec => sec.categories.forEach(cat => {
    totalCats++;
    cat.groups.forEach(g => totalLinks += g.links.length);
  })));
  $('#arcMeta').textContent = `${totalCats} 卡片 · ${totalLinks} 連結`;
  // bind tab clicks
  $$('.arc-tab').forEach(t => {
    t.addEventListener('click', e => {
      // 切 tab 會 renderArchive() 重畫,e.target 隨即從 DOM 移除,
      // 之後事件 bubble 到 document 時 pan.contains(e.target) 為 false → 誤關面板。
      // 阻擋傳播避免這個 race condition。
      e.stopPropagation();
      if (e.target.classList.contains('arc-tab-x')){
        const id = e.target.dataset.del;
        if (confirm(`刪除分頁「${arc.tabs.find(x => x.id === id)?.name}」?裡面的所有東西也會刪除。`)){
          DATA.archive.tabs = DATA.archive.tabs.filter(x => x.id !== id);
          if (state.archiveActiveTab === id) state.archiveActiveTab = DATA.archive.tabs[0]?.id || 'all';
          markDirty();
          renderArchive();
        }
        return;
      }
      state.archiveActiveTab = t.dataset.tab;
      if (t.dataset.tab !== 'all'){
        DATA.archive.lastUsedTabId = t.dataset.tab;
        DATA.archive.activeTabId = t.dataset.tab;
        markDirty();
      }
      renderArchive();
    });
  });
  const addBtn = $('#arcTabAdd');
  if (addBtn) addBtn.addEventListener('click', () => {
    const name = prompt('新分頁名稱?');
    if (!name) return;
    const newTab = {id: uid('tab'), name, sections: [{id: uid('sec'), name: '主要', categories: []}]};
    DATA.archive.tabs.push(newTab);
    state.archiveActiveTab = newTab.id;
    DATA.archive.lastUsedTabId = newTab.id;
    markDirty();
    renderArchive();
  });
  // bind restore
  $$('.arc-restore').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();  // 別 bubble 到 .arc-card 觸發 panel
      restoreFromArchive(btn.dataset.cat, btn.dataset.tab);
    });
  });
  // ✎ 編輯 — 開卡片編輯 modal
  $$('.arc-edit-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openCardEdit(btn.dataset.cat);
    });
  });
  // 封存區內的卡片也綁 hover/click → 開主面板的 panel(跟主面板一致)
  if (typeof bindHoverElements === 'function') bindHoverElements('.arc-card[data-cat]');
  // tab 拖曳排序
  if (typeof setupArchiveTabsSortable === 'function') setupArchiveTabsSortable();
  // archive 卡片排序(.arc-section 容器)
  if (typeof setupArchiveCardsSortables === 'function') setupArchiveCardsSortables();
}

function renderArchiveCardHtml(cat, tabId){
  const ico = renderIcon(cat.icon, cat.iconType);
  // 加 data-cat 讓 bindHoverElements 可以綁 hover/click 開 panel(跟主面板一致)
  let html = `<div class="arc-card" data-cat="${cat.id}" data-arc-tab="${tabId}">
    <div class="arc-card-head">
      <span class="arc-card-icon"${iconAttrs(cat.icon, cat.iconType)} style="background:${cat.tint || 'var(--bg-2)'}; color:${cat.color || 'inherit'};">${ico}</span>
      <span class="arc-card-title">${escapeHtml(cat.title)}</span>
      <div class="arc-card-actions">
        <button class="arc-restore" data-cat="${cat.id}" data-tab="${tabId}" title="還原到主面板">↺</button>
        <button class="arc-edit-x" data-cat="${cat.id}" title="編輯">✎</button>
      </div>
    </div>`;
  cat.groups.forEach(g => {
    g.links.forEach(link => {
      const lico = renderIcon(link.icon, link.iconType);
      html += `<div class="arc-link">
        <span style="font-size:11px;">${lico}</span>
        <a href="${escapeHtml(link.url || '#')}" target="_blank">${escapeHtml(link.title)}</a>
      </div>`;
    });
  });
  html += `</div>`;
  return html;
}

function restoreFromArchive(catId, tabId){
  const arc = DATA.archive;
  let foundCat = null;
  for (const tab of arc.tabs){
    for (const sec of tab.sections){
      const idx = sec.categories.findIndex(c => c.id === catId);
      if (idx !== -1){
        foundCat = sec.categories[idx];
        sec.categories.splice(idx, 1);
        break;
      }
    }
    if (foundCat) break;
  }
  if (!foundCat) return;
  // 還原到第一個主要 section
  const target = DATA.sections[0];
  target.categories.push(foundCat);
  markDirty();
  renderSections();
  renderArchive();
  showTip(`已還原「${foundCat.title}」到「${target.name}」`);
}

function archiveCard(catId){
  // 找卡片所在的 section
  let foundCat = null, parentArr = null;
  for (const sec of DATA.sections){
    const idx = sec.categories.findIndex(c => c.id === catId);
    if (idx !== -1){
      foundCat = sec.categories[idx];
      parentArr = sec.categories;
      parentArr.splice(idx, 1);
      break;
    }
  }
  if (!foundCat) return;
  const tabId = DATA.archive.lastUsedTabId || DATA.archive.tabs[0]?.id;
  const tab = DATA.archive.tabs.find(t => t.id === tabId);
  if (!tab){
    // 把它放回主面板
    parentArr.push(foundCat);
    showTip('沒有可用的封存分頁');
    return;
  }
  // 放在 tab 的第一個 section
  if (!tab.sections.length) tab.sections.push({id: uid('sec'), name: '主要', categories: []});
  tab.sections[0].categories.push(foundCat);
  markDirty();
  renderSections();
  renderArchive();
  showTip(`已封存到「${tab.name}」`);
}

function bindArchive(){
  $('#arcHandle').addEventListener('click', openArchive);
  $('#arcPinBtn').addEventListener('click', toggleArchivePin);
  $('#arcCloseBtn').addEventListener('click', () => {
    state.archivePinned = false;
    document.body.classList.remove('archive-pinned');
    $('#arcPinBtn').classList.remove('active');
    state.archiveOpen = false;
    $('#arcPanel').classList.remove('open');
  });
  // 點面板外面關閉(若沒釘選)
  // 用 composedPath() 抓事件 dispatch 當下的祖先列表 —
  // 這樣即使 click handler 內 renderArchive() 把 e.target 從 DOM 移除,
  // 我們仍能正確判斷點擊是否在面板內(避免切 tab 時誤關)
  document.addEventListener('click', (e) => {
    if (!state.archiveOpen || state.archivePinned) return;
    const pan = $('#arcPanel');
    const handle = $('#arcHandle');
    const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
    if (path.includes(pan) || path.includes(handle)) return;
    if (e.target && (pan.contains(e.target) || handle.contains(e.target))) return;
    state.archiveOpen = false;
    pan.classList.remove('open');
  });
}
