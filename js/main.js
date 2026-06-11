/* main.js
   進入點:綁定所有模組的 DOM event,啟動 storage 初始化
   load 流程:DOMContentLoaded → init() → 綁定事件 → initStorage()
                ├─ 有 handle 且權限 OK → 載入 bookmarks.json,渲染畫面
                └─ 沒 handle / 權限 → 顯示 onboarding
   依賴:所有其他模組(必須最後載入)。 */

function bindDenseGrid(){
  const btn = $('#toggleDense');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.denseGrid = !state.denseGrid;
    document.body.classList.toggle('dense-grid', state.denseGrid);
    btn.style.color = state.denseGrid ? 'var(--accent)' : '';
    btn.textContent = state.denseGrid ? '✨ 已填補' : '✨ 自動填補';
    syncSettingsFromState();
  });
}

function init(){
  // 綁所有 DOM 事件(全部模組共享 — DOM 已就緒,因為 script 在 body 末端)
  loadThemePrefs();
  bindThemeMenu();
  bindSearch();
  bindDenseGrid();
  bindEditingDom();
  bindArchive();
  bindStorageDom();

  // 鍵盤快捷鍵
  document.addEventListener('keydown', e => {
    const editModalEl = $('#editModal');
    const settingsModalEl = $('#settingsModal');
    const onboardingEl = $('#onboarding');
    const anyModalOpen = editModalEl.classList.contains('show') ||
                         settingsModalEl.classList.contains('show') ||
                         onboardingEl.classList.contains('show');
    if (e.key === '/' && document.activeElement !== $('#searchInput') && !anyModalOpen){
      e.preventDefault(); $('#searchInput').focus();
    }
    if (e.key === 'e' && !state.edit && !anyModalOpen &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA'){
      toggleEditMode();
    }
    if (e.key === 'Escape'){
      if (editModalEl.classList.contains('show')) closeModal();
      else if (settingsModalEl.classList.contains('show')) closeSettings();
      else if ($('#searchPop').classList.contains('open')){
        $('#searchPop').classList.remove('open');
        $('#searchInput').blur();
      }
    }
  });

  // 預設先用 sample DATA 渲染(這樣 onboarding 開啟時背景也有東西)
  // initStorage 完成後若有真的檔案,會再 renderSections 取代。
  ensureDataShape();
  renderHero();
  bindHeroEditing();
  renderHealthBar();
  renderSections();

  // 啟動 storage:讀 IndexedDB → 載 bookmarks.json → 重繪
  initStorage();

  // 視窗大小改變時,重算 row(影響 .row-large-mode 的同 row 升級)
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      if (typeof tagLargeRows === 'function') tagLargeRows();
    }, 120);
  });
}

document.addEventListener('DOMContentLoaded', init);
