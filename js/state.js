/* state.js
   全域 UI 狀態 — 不持久化的執行期狀態(會持久化的東西另外存 localStorage 或 bookmarks.json)
   可由其他模組直接讀寫 state.* */

const state = {
  edit: false,
  pickerTarget: null,
  pickerTab: 'emoji',
  theme: 'salmon',
  autoTheme: false,
  searchScope: 'all',
  searchQuery: '',
  denseGrid: false,
  pinnedCardPanel: null,    // catId
  pinnedHealthPanel: null,  // health key
  archiveOpen: false,
  archivePinned: false,
  archiveActiveTab: 'completed',  // tab id, 'all' = 全部
};
