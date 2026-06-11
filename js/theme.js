/* theme.js
   6 套主題切換 + 跟時間自動切換邏輯
   - applyTheme(name): 套用主題,寫 localStorage
   - setAutoTheme(on): 開關自動模式,寫 localStorage
   - loadThemePrefs(): 啟動時讀回偏好
   - bindThemeMenu(): 綁定 topbar 主題按鈕 + 選單
   自動模式時間表:晨陽 → 鮭魚 → 薰衣草 → 桃 → 森林 → 夜雨 */

const THEME_NAMES = ['salmon','forest','rain','lavender','sunlight','peach'];
const AUTO_THEME_SCHEDULE = [
  // [hour_start, hour_end, theme]
  [6, 11, 'sunlight'],
  [11, 13, 'salmon'],
  [13, 16, 'lavender'],
  [16, 19, 'peach'],
  [19, 22, 'forest'],
  // 22-6 → rain (default if not matched)
];

function pickAutoTheme(){
  const h = new Date().getHours();
  for (const [s, e, t] of AUTO_THEME_SCHEDULE){
    if (h >= s && h < e) return t;
  }
  return 'rain';
}

function applyTheme(name){
  state.theme = name;
  document.body.dataset.theme = name;
  $$('.theme-row').forEach(r => r.classList.toggle('active', r.dataset.theme === name));
  try { localStorage.setItem('znue_theme', name); } catch(_) {}
  // 同步到 DATA.settings(若 storage 已就緒)
  if (typeof syncSettingsFromState === 'function') syncSettingsFromState();
}

function setAutoTheme(on){
  state.autoTheme = on;
  $('#autoThemeSwitch').classList.toggle('on', on);
  try { localStorage.setItem('znue_autoTheme', on ? '1' : '0'); } catch(_) {}
  if (on) applyTheme(pickAutoTheme());
  if (typeof syncSettingsFromState === 'function') syncSettingsFromState();
}

function loadThemePrefs(){
  try {
    const saved = localStorage.getItem('znue_theme');
    if (saved && THEME_NAMES.includes(saved)) state.theme = saved;
    state.autoTheme = localStorage.getItem('znue_autoTheme') === '1';
  } catch(_) {}
  if (state.autoTheme) {
    applyTheme(pickAutoTheme());
    $('#autoThemeSwitch').classList.add('on');
  } else {
    applyTheme(state.theme);
  }
}

function bindThemeMenu(){
  const btn = $('#themeBtn'), menu = $('#themeMenu');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)){
      menu.classList.remove('open');
    }
  });
  $$('.theme-row').forEach(row => {
    row.addEventListener('click', () => {
      applyTheme(row.dataset.theme);
      // 手動選擇時關閉自動
      if (state.autoTheme) setAutoTheme(false);
    });
  });
  $('#autoThemeSwitch').addEventListener('click', () => {
    setAutoTheme(!state.autoTheme);
  });
  // 每 15 分鐘檢查一次自動主題
  setInterval(() => {
    if (state.autoTheme){
      const t = pickAutoTheme();
      if (t !== state.theme) applyTheme(t);
    }
  }, 15 * 60 * 1000);
}
