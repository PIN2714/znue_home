/* dnd.js
   SortableJS 拖曳排序 — 5 個層級
   1. sections        在 #sectionsWrap 內排序整段 section
   2. cards           在 .grid 內 + 跨 section 拖曳 (group: znue-cards)
   3. groups          在 panel 內排序卡片內的群組
   4. links           在 panel 內排序連結 + 跨群組(同卡內,group: links-{catId})
   5. archive tabs    在 #arcTabs 內排序分頁

   只在編輯模式啟用;進入 / 離開編輯模式時 toggle disabled。
   每次 onEnd 更新對應 DATA 陣列 + markDirty()。

   依賴:Sortable(全域)、DATA、state、findCat、markDirty、render(activeCard、openPanel、renderSections) */

const _sortables = new Set();

function _hasSortable(){ return typeof Sortable !== 'undefined'; }

function _destroySortable(el){
  if (!el || !el._sortable) return;
  try { el._sortable.destroy(); } catch(_){}
  el._sortable = null;
  _sortables.delete(el);
}

function _makeSortable(el, options){
  if (!el || !_hasSortable()) return null;
  _destroySortable(el);
  el._sortable = new Sortable(el, options);
  _sortables.add(el);
  return el._sortable;
}

/* 進 / 離開編輯模式時呼叫 — 切換所有 sortable 的 disabled
   .group(連結排序)在所屬卡片的 effectiveSortMode 不是 'manual' 時額外強制禁用 */
function setSortablesEnabled(enabled){
  // 要算每張卡片的 sortMode,先抓 panel 對應的 cat
  let panelSortMode = 'manual';
  if (typeof activeCard !== 'undefined' && activeCard && typeof effectiveSortMode === 'function'){
    const found = findCatAnywhere(activeCard.dataset.cat);
    if (found) panelSortMode = effectiveSortMode(found.cat);
  }
  for (const el of [..._sortables]){
    if (!document.contains(el)){ _sortables.delete(el); continue; }
    if (!el._sortable) continue;
    let canEnable = enabled;
    if (el.matches && el.matches('.group') && panelSortMode !== 'manual') canEnable = false;
    el._sortable.option('disabled', !canEnable);
  }
}

/* ============ Sections (整段排序) ============ */
function setupSectionsSortable(){
  const wrap = $('#sectionsWrap');
  if (!wrap) return;
  _makeSortable(wrap, {
    animation: 150,
    handle: '.section-head h2',  // 拉標題拖整段(避免跟 add-section 按鈕混淆)
    draggable: '.section',
    disabled: !state.edit,
    onEnd: (evt) => {
      if (evt.oldIndex === evt.newIndex) return;
      const moved = DATA.sections.splice(evt.oldIndex, 1)[0];
      DATA.sections.splice(evt.newIndex, 0, moved);
      markDirty();
    },
  });
}

/* ============ Cards (在 .grid 內 + 跨 section) ============ */
function setupCardsSortables(){
  $$('#sectionsWrap .section').forEach(secEl => {
    const grid = secEl.querySelector('.grid');
    if (!grid) return;
    _makeSortable(grid, {
      animation: 150,
      group: 'znue-cards',
      draggable: '.cat',
      // filter:不從這些子元素開始拖曳(讓它們的 click 正常觸發)
      filter: '.add-card, .quick-link, .quick-icon, .card-edit-tools, .cat-meta',
      preventOnFilter: false,
      disabled: !state.edit,
      onEnd: (evt) => {
        const fromSecId = evt.from.closest('.section')?.dataset.section;
        const toSecId = evt.to.closest('.section')?.dataset.section;
        if (!fromSecId || !toSecId) return;
        const fromSec = DATA.sections.find(s => s.id === fromSecId);
        const toSec = DATA.sections.find(s => s.id === toSecId);
        if (!fromSec || !toSec) return;
        const moved = fromSec.categories.splice(evt.oldIndex, 1)[0];
        toSec.categories.splice(evt.newIndex, 0, moved);
        markDirty();
        // count + add-card 位置可能要更新 → 重 render
        renderSections();
      },
    });
  });
}

/* ============ Panel 內 — Groups + Links ============ */
function setupPanelSortables(catId){
  if (!_hasSortable()) return;
  const panelEl = $('#hoverPanel');
  if (!panelEl) return;

  // Groups sortable(整個 panel 是容器,.group 是 item)
  // 注意:SortableJS 的 evt.oldIndex/newIndex 是 panelEl 的 DOM child index,
  // 但 panelEl 內還有 .panel-head / .add-group 等非 .group 子元素 — 直接用會 out-of-bound
  // 導致 splice 取到 undefined 寫進 DATA → JSON 變 null,進而讓 renderCard 崩潰。
  // 解法:用 evt.item.dataset.groupIdx 抓 DATA 中真實 from index;to index 從
  //       SortableJS 移動後的 DOM(只算 .group 元素)反推。
  _makeSortable(panelEl, {
    animation: 150,
    handle: '.group-title-text',
    draggable: '.group',
    disabled: !state.edit,
    onEnd: (evt) => {
      const found = findCatAnywhere(catId);
      if (!found) return;
      const fromGi = parseInt(evt.item.dataset.groupIdx, 10);
      if (isNaN(fromGi) || fromGi < 0 || fromGi >= found.cat.groups.length) return;
      const groupEls = [...panelEl.querySelectorAll('.group')];
      const toGi = groupEls.indexOf(evt.item);
      if (toGi === -1 || fromGi === toGi) return;
      const moved = found.cat.groups.splice(fromGi, 1)[0];
      if (moved == null){
        // 萬一砍出 null/undefined,放回去免得 DATA 壞掉
        found.cat.groups.splice(fromGi, 0, moved);
        return;
      }
      found.cat.groups.splice(toGi, 0, moved);
      markDirty();
      // group idx 變了 — 重 render panel(讓新 dataset.groupIdx 生效)
      if (typeof activeCard !== 'undefined' && activeCard) openPanel(catId, activeCard);
    },
  });

  // 每個 group 內的 links(可跨群組,同卡片內)
  // 注意:這個卡的 sortMode 若不是 'manual',連結拖曳一律禁用
  const found = findCatAnywhere(catId);
  const cat = found ? found.cat : null;
  const linkSortMode = (typeof effectiveSortMode === 'function') ? effectiveSortMode(cat) : 'manual';
  const linkDisabled = !state.edit || linkSortMode !== 'manual';
  panelEl.querySelectorAll('.group').forEach((groupEl, gi) => {
    groupEl.dataset.groupIdx = String(gi);
    _makeSortable(groupEl, {
      animation: 150,
      group: `links-${catId}`,
      draggable: '.link',
      // filter: 這些子元素 mousedown 不啟動拖曳,讓內部按鈕的 click / 連結點擊正常 fire
      // 配合 preventOnFilter: false — 不 preventDefault touchstart/mousedown,native click 正常觸發
      // (這修了手機點 ✎ 編輯按鈕沒反應的 bug,且不影響桌面拖曳行為)
      filter: '.group-header, .group-memo, .add-link, .row-actions, .favicon, .link-memo',
      preventOnFilter: false,
      disabled: linkDisabled,
      forceFallback: true,  // 避免 <a> 的 native drag 干擾
      onEnd: (evt) => {
        const fromGi = parseInt(evt.from.dataset.groupIdx, 10);
        const toGi = parseInt(evt.to.dataset.groupIdx, 10);
        const found = findCatAnywhere(catId);
        if (!found) return;
        const fromLinks = found.cat.groups[fromGi]?.links;
        const toLinks = found.cat.groups[toGi]?.links;
        if (!fromLinks || !toLinks) return;
        // 用 link.id 反查資料中的 from 位置(最穩,不依賴 DOM index)
        const movedLinkId = evt.item.dataset.link;
        const realFromIdx = fromLinks.findIndex(l => l.id === movedLinkId);
        if (realFromIdx === -1) return;
        const moved = fromLinks.splice(realFromIdx, 1)[0];
        // 在 to 容器中找 evt.item 在 .link 元素之間的位置(SortableJS 已把 DOM 移好)
        const linkEls = [...evt.to.querySelectorAll('.link')];
        const insertIdx = linkEls.indexOf(evt.item);
        toLinks.splice(insertIdx >= 0 ? insertIdx : toLinks.length, 0, moved);
        markDirty();
        if (typeof activeCard !== 'undefined' && activeCard) openPanel(catId, activeCard);
      },
    });
  });
}

/* ============ Archive cards (在 .arc-section 內 + 跨 archive section) ============ */
function setupArchiveCardsSortables(){
  $$('#arcBody .arc-section').forEach(secEl => {
    _makeSortable(secEl, {
      animation: 150,
      group: 'znue-arc-cards',
      draggable: '.arc-card',
      filter: '.arc-section-head, .arc-empty',
      disabled: !state.edit,
      onEnd: (evt) => {
        const fromTabId = evt.from.dataset.arcTab;
        const fromSecId = evt.from.dataset.arcSec;
        const toTabId = evt.to.dataset.arcTab;
        const toSecId = evt.to.dataset.arcSec;
        if (!fromTabId || !toTabId) return;
        const fromTab = DATA.archive.tabs.find(t => t.id === fromTabId);
        const toTab = DATA.archive.tabs.find(t => t.id === toTabId);
        if (!fromTab || !toTab) return;
        const fromSec = fromTab.sections.find(s => s.id === fromSecId);
        const toSec = toTab.sections.find(s => s.id === toSecId);
        if (!fromSec || !toSec) return;
        // 用 evt.item 的 data-cat 反查移動位置(穩過直接用 oldIndex)
        const movedCatId = evt.item.dataset.cat;
        const realFromIdx = fromSec.categories.findIndex(c => c.id === movedCatId);
        if (realFromIdx === -1) return;
        const moved = fromSec.categories.splice(realFromIdx, 1)[0];
        const cardEls = [...evt.to.querySelectorAll('.arc-card')];
        const insertIdx = cardEls.indexOf(evt.item);
        toSec.categories.splice(insertIdx >= 0 ? insertIdx : toSec.categories.length, 0, moved);
        markDirty();
        // count 顯示需要重畫(arc-meta)
        if (typeof renderArchive === 'function') renderArchive();
      },
    });
  });
}

/* ============ Archive tabs ============ */
function setupArchiveTabsSortable(){
  const tabs = $('#arcTabs');
  if (!tabs) return;
  _makeSortable(tabs, {
    animation: 150,
    draggable: '.arc-tab',
    filter: '.arc-tab.all, .arc-tab-add',
    disabled: !state.edit,
    onEnd: (evt) => {
      // DOM:[ .arc-tab.all, .arc-tab(tab0), .arc-tab(tab1), ..., .arc-tab-add ]
      // DATA.archive.tabs 不含 'all' 與 'add' — 所以 dataIdx = domIdx - 1
      const oldDi = evt.oldIndex - 1;
      const newDi = evt.newIndex - 1;
      if (oldDi < 0 || newDi < 0) return;
      if (oldDi >= DATA.archive.tabs.length || newDi >= DATA.archive.tabs.length) return;
      const moved = DATA.archive.tabs.splice(oldDi, 1)[0];
      DATA.archive.tabs.splice(newDi, 0, moved);
      markDirty();
    },
  });
}
