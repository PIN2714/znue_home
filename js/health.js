/* health.js
   健康狀態列 + hover 詳細面板
   - computeHealthSummary(): 算出最新體重 + 體脂 + 餐點加總 + 活動 (用 _activeHealthData)
   - _activeHealthData(): 有真實 ledger 用 buildSummaryFromLedger,沒有 fallback HEALTH_DATA
   - buildSummaryFromLedger(raw): 把真實 health-ledger.json 的 records[type=meal/weight/activity]
     轉成 {goals, records, meals_today, activity_today} 形狀
   - shouldShowHealthBar(): 沒連結 ledger 或設定關閉時隱藏
   - renderHealthBar/renderHealthPanel/openHealthPanel/...: UI
   依賴:HEALTH_DATA(fallback)、_healthLedgerRaw(storage)、state、DATA、$、$$、IS_TOUCH */

/* 把真實 health-ledger.json 轉成狀態列預期的形狀
   ledger schema: { settings: {cal_goal, protein_goal, weight_goal},
                    records: [{type, date, created_at, data}, ...] }
   record type: meal / weight / activity / exercise */
function buildSummaryFromLedger(raw){
  const records = (raw && raw.records) || [];
  const settings = (raw && raw.settings) || {};

  // weight 紀錄(從舊到新)
  const weights = records
    .filter(r => r.type === 'weight' && r.data && typeof r.data.weight_kg === 'number')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // meal 紀錄按日分組,取「最新有 meal 的那一天」
  const meals = records.filter(r => r.type === 'meal');
  let dayMeals = [];
  if (meals.length){
    const latestMealDate = meals.reduce((acc, m) => (m.date || '') > acc ? (m.date || '') : acc, '');
    dayMeals = meals
      .filter(m => m.date === latestMealDate)
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  }

  // activity 取「最新有 activity 的那一天」加總
  const activities = records.filter(r => r.type === 'activity');
  let todayActivity = null;
  if (activities.length){
    const latestActDate = activities.reduce((acc, a) => (a.date || '') > acc ? (a.date || '') : acc, '');
    const dayActs = activities.filter(a => a.date === latestActDate);
    todayActivity = dayActs.reduce((acc, a) => {
      const d = a.data || {};
      return {
        steps: (acc.steps || 0) + (d.steps || 0),
        calories_burned: (acc.calories_burned || 0) + (d.active_kcal || 0),
        active_minutes: (acc.active_minutes || 0) + (d.active_minutes || 0),
        sleep_hours: d.sleep_hours != null ? d.sleep_hours : acc.sleep_hours,
      };
    }, {});
  }

  return {
    goals: {
      calories: settings.cal_goal != null ? settings.cal_goal : 1850,
      protein_g: settings.protein_goal != null ? settings.protein_goal : 130,
      weight_kg: settings.weight_goal != null ? settings.weight_goal : 70,
    },
    records: weights.map(w => ({ date: w.date, data: w.data })),
    meals_today: dayMeals.map(m => ({
      time: m.created_at ? String(m.created_at).slice(11, 16) : '',
      name: ((m.data && m.data.items) || []).map(i => i.name).join(' / ') || '餐點',
      total: (m.data && m.data.total) || { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    })),
    activity_today: todayActivity || { steps: 0, calories_burned: 0, active_minutes: 0, sleep_hours: 0 },
  };
}

/* 取目前要用的健康資料:有真實 ledger 用真實,沒就用 sample */
function _activeHealthData(){
  if (typeof _healthLedgerRaw !== 'undefined' && _healthLedgerRaw){
    return buildSummaryFromLedger(_healthLedgerRaw);
  }
  return HEALTH_DATA;
}

/* 是否該顯示健康狀態列?
   - 設定 healthBarEnabled === false 不顯示
   - 沒連結 ledger 也不顯示(避免分享專案時新使用者看到 sample) */
function shouldShowHealthBar(){
  const enabled = !(DATA && DATA.settings && DATA.settings.healthBarEnabled === false);
  const hasLedger = (typeof _healthLedgerRaw !== 'undefined' && _healthLedgerRaw)
                 || (typeof healthHandle !== 'undefined' && healthHandle);
  return enabled && hasLedger;
}

function computeHealthSummary(){
  const data = _activeHealthData();
  const recs = data.records || [];
  const last = recs[recs.length-1];
  const prev = recs[recs.length-2] || last;
  const meals = data.meals_today || [];
  const consumedKcal = meals.reduce((a,m) => a + (m.total?.kcal || 0), 0);
  const consumedProtein = meals.reduce((a,m) => a + (m.total?.protein_g || 0), 0);
  const consumedCarbs = meals.reduce((a,m) => a + (m.total?.carbs_g || 0), 0);
  const consumedFat = meals.reduce((a,m) => a + (m.total?.fat_g || 0), 0);
  const goals = data.goals || {};
  const remaining = (goals.calories || 0) - consumedKcal;
  return {
    last: last ? last.data : {}, prev: prev ? prev.data : {}, lastDate: last ? last.date : '',
    consumedKcal, consumedProtein, consumedCarbs, consumedFat, remaining,
    activity: data.activity_today || {}, mealCount: meals.length,
    goals,
  };
}

function fmtDelta(curr, prev, suffix=""){
  const d = (curr - prev);
  if (Math.abs(d) < 0.01) return { text: "—", cls: "neutral" };
  const sign = d > 0 ? "+" : "";
  return { text: `${sign}${d.toFixed(1)}${suffix}`, cls: d > 0 ? "up" : "down" };
}

function renderHealthBar(){
  const bar = $('#healthBar');
  if (!bar) return;
  if (!shouldShowHealthBar()){
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';

  const s = computeHealthSummary();
  $('#healthDate').textContent = (s.lastDate || '').replace(/-/g, '.') || '—';
  const wDelta = fmtDelta(s.last.weight_kg, s.prev.weight_kg);
  const bfDelta = fmtDelta(s.last.body_fat_percent, s.prev.body_fat_percent);
  const calGoal = s.goals.calories || 1850;
  const calPct = Math.min(100, (s.consumedKcal / calGoal) * 100);
  const stepPct = Math.min(100, ((s.activity.steps || 0) / 10000) * 100);

  $('#healthStats').innerHTML = `
    <div class="h-stat" data-h="weight">
      <div class="h-stat-label">體重</div>
      <div class="h-stat-val">${s.last.weight_kg ?? '—'}<span class="unit">kg</span><span class="delta ${wDelta.cls}">${wDelta.text}</span></div>
      <div class="h-stat-meta">目標 ${s.goals.weight_kg ?? '—'} · BMI ${s.last.bmi ?? '—'}</div>
    </div>
    <div class="h-stat" data-h="bf">
      <div class="h-stat-label">體脂率</div>
      <div class="h-stat-val">${s.last.body_fat_percent ?? '—'}<span class="unit">%</span><span class="delta ${bfDelta.cls}">${bfDelta.text}</span></div>
      <div class="h-stat-meta">標準 10–20%</div>
    </div>
    <div class="h-stat" data-h="calories">
      <div class="h-stat-label">熱量剩餘</div>
      <div class="h-stat-val">${s.remaining}<span class="unit">kcal</span></div>
      <div class="h-stat-mini"><div class="h-stat-mini-fill" style="width:${calPct}%"></div></div>
    </div>
    <div class="h-stat" data-h="steps">
      <div class="h-stat-label">步數</div>
      <div class="h-stat-val">${(s.activity.steps || 0).toLocaleString()}</div>
      <div class="h-stat-mini"><div class="h-stat-mini-fill green" style="width:${stepPct}%"></div></div>
    </div>
    <div class="h-stat" data-h="score">
      <div class="h-stat-label">身體評分</div>
      <div class="h-stat-val">${s.last.score ?? '—'}<span class="unit">/ 100</span></div>
      <div class="h-stat-meta">睡眠 ${s.activity.sleep_hours ?? '—'}h</div>
    </div>
  `;
  bindHealthHover();
}

function sparkline(values, color = 'var(--accent)'){
  if (values.length < 2) return '';
  const w = 280, h = 32, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = (w - pad*2) / (values.length - 1);
  const pts = values.map((v,i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}" />
    <circle cx="${pad + (values.length-1)*step}" cy="${h - pad - ((values[values.length-1] - min)/range)*(h-pad*2)}" r="2.5" fill="${color}"/>
  </svg>`;
}

let _hHoverTimer = null, _hLeaveTimer = null, _activeHStat = null;

function renderHealthPanel(key){
  const s = computeHealthSummary();
  const data = _activeHealthData();
  const recs = data.records || [];
  switch(key){
    case 'weight': {
      const wDelta = fmtDelta(s.last.weight_kg, s.prev.weight_kg, ' kg');
      const goalDiff = (s.last.weight_kg - s.goals.weight_kg).toFixed(2);
      return `
        <div class="h-panel-head"><h4>體重 · Weight</h4><span class="h-panel-sub">${recs.length} 筆紀錄</span></div>
        <div class="h-panel-bigval">${s.last.weight_kg}<span class="unit">kg</span></div>
        <div class="h-panel-row"><span class="key">前次</span><span class="val">${s.prev.weight_kg} kg (${wDelta.text})</span></div>
        <div class="h-panel-row"><span class="key">目標</span><span class="val">${s.goals.weight_kg} kg</span></div>
        <div class="h-panel-row"><span class="key">距目標</span><span class="val">${goalDiff > 0 ? '+' : ''}${goalDiff} kg</span></div>
        <div class="h-panel-row"><span class="key">BMI</span><span class="val">${s.last.bmi}</span></div>
        ${sparkline(recs.map(r => r.data.weight_kg))}
        <div class="h-panel-foot"><span>近 ${recs.length} 筆趨勢</span><a href="${(DATA.settings && DATA.settings.healthPageUrl) || '../health_pwa/index.html'}" target="_blank">完整紀錄 →</a></div>
      `;
    }
    case 'bf': {
      const bfDelta = fmtDelta(s.last.body_fat_percent, s.prev.body_fat_percent, '%');
      return `
        <div class="h-panel-head"><h4>體脂率 · Body Fat</h4><span class="h-panel-sub">最近更新</span></div>
        <div class="h-panel-bigval">${s.last.body_fat_percent}<span class="unit">%</span></div>
        <div class="h-panel-row"><span class="key">前次</span><span class="val">${s.prev.body_fat_percent}% (${bfDelta.text})</span></div>
        <div class="h-panel-row"><span class="key">肌肉量</span><span class="val">${s.last.muscle_kg || '—'} kg</span></div>
        <div class="h-panel-row"><span class="key">水分</span><span class="val">${s.last.water_percent || '—'}%</span></div>
        ${sparkline(recs.map(r => r.data.body_fat_percent), '#b8860b')}
        <div class="h-panel-note">男性標準 10–20%。持續就會降。</div>
      `;
    }
    case 'calories': {
      const goal = s.goals.calories;
      const pct = Math.round((s.consumedKcal / goal) * 100);
      const meals = data.meals_today || [];
      return `
        <div class="h-panel-head"><h4>今日熱量 · Calories</h4><span class="h-panel-sub">${s.mealCount} 餐</span></div>
        <div class="h-panel-bigval">${s.consumedKcal}<span class="unit">/ ${goal} kcal</span></div>
        <div class="h-panel-bar"><div class="h-panel-bar-fill" style="width:${Math.min(100,pct)}%"></div></div>
        <div class="h-panel-row"><span class="key">剩餘</span><span class="val">${s.remaining} kcal</span></div>
        <div class="h-panel-row"><span class="key">蛋白質</span><span class="val">${s.consumedProtein.toFixed(0)} / ${s.goals.protein_g} g</span></div>
        <div class="h-panel-row"><span class="key">碳水</span><span class="val">${s.consumedCarbs.toFixed(0)} g</span></div>
        <div class="h-panel-row"><span class="key">脂肪</span><span class="val">${s.consumedFat.toFixed(0)} g</span></div>
        <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--line);">
          ${meals.map(m => `<div class="h-panel-row" style="border:none; padding: 3px 0;">
            <span class="key">${m.time} · ${m.name}</span><span class="val">${m.total.kcal}</span>
          </div>`).join('')}
        </div>
        <div class="h-panel-foot"><span></span><a href="${(DATA.settings && DATA.settings.healthPageUrl) || '../health_pwa/index.html'}" target="_blank">完整紀錄 →</a></div>
      `;
    }
    case 'steps': {
      const a = s.activity;
      const pct = Math.round((a.steps / 10000) * 100);
      return `
        <div class="h-panel-head"><h4>今日活動 · Activity</h4><span class="h-panel-sub">三星 Health</span></div>
        <div class="h-panel-bigval">${a.steps.toLocaleString()}<span class="unit">steps</span></div>
        <div class="h-panel-bar"><div class="h-panel-bar-fill" style="width:${Math.min(100,pct)}%; background: var(--green);"></div></div>
        <div class="h-panel-row"><span class="key">目標</span><span class="val">10,000 步</span></div>
        <div class="h-panel-row"><span class="key">消耗熱量</span><span class="val">${a.calories_burned} kcal</span></div>
        <div class="h-panel-row"><span class="key">活動分鐘</span><span class="val">${a.active_minutes} min</span></div>
        <div class="h-panel-row"><span class="key">睡眠</span><span class="val">${a.sleep_hours} 小時</span></div>
        <div class="h-panel-note">再走 ${(10000 - a.steps).toLocaleString()} 步達標。</div>
      `;
    }
    case 'score': {
      return `
        <div class="h-panel-head"><h4>身體評分 · Score</h4><span class="h-panel-sub">综合指標</span></div>
        <div class="h-panel-bigval">${s.last.score}<span class="unit">/ 100</span></div>
        <div class="h-panel-bar"><div class="h-panel-bar-fill" style="width:${s.last.score}%"></div></div>
        <div class="h-panel-row"><span class="key">前次</span><span class="val">${s.prev.score}</span></div>
        <div class="h-panel-row"><span class="key">BMI</span><span class="val">${s.last.bmi}</span></div>
        ${sparkline(recs.map(r => r.data.score), 'var(--blue)')}
        <div class="h-panel-note">由體脂、BMI、睡眠、活動綜合計算。穩定上升中。</div>
      `;
    }
  }
}

function openHealthPanel(key, anchor){
  const healthPanel = $('#healthPanel');
  healthPanel.innerHTML = renderHealthPanel(key);
  // 注入釘選按鈕到 h-panel-head
  const head = healthPanel.querySelector('.h-panel-head');
  if (head){
    const isPinned = state.pinnedHealthPanel === key;
    head.style.position = 'relative';
    head.style.paddingRight = '36px';
    const btn = document.createElement('button');
    btn.className = 'pin-btn ' + (isPinned ? 'active' : '');
    btn.innerHTML = '📌';
    btn.title = isPinned ? '取消釘選' : '釘選';
    btn.style.position = 'absolute';
    btn.style.right = '10px';
    btn.style.top = '8px';
    btn.addEventListener('click', e => { e.stopPropagation(); toggleHealthPanelPin(key); });
    head.appendChild(btn);
  }
  healthPanel.classList.toggle('pinned', state.pinnedHealthPanel === key);
  const r = anchor.getBoundingClientRect();
  const PAD = 8;
  healthPanel.style.top = (r.bottom + PAD) + 'px';
  healthPanel.style.left = r.left + 'px';
  healthPanel.classList.add('show');
  requestAnimationFrame(() => {
    const pr = healthPanel.getBoundingClientRect();
    if (pr.right > window.innerWidth - 12) healthPanel.style.left = Math.max(12, window.innerWidth - pr.width - 12) + 'px';
    if (pr.bottom > window.innerHeight - 12) healthPanel.style.top = Math.max(12, r.top - pr.height - PAD) + 'px';
  });
  if (_activeHStat) _activeHStat.classList.remove('is-open');
  anchor.classList.add('is-open');
  _activeHStat = anchor;
}

function closeHealthPanel(){
  const healthPanel = $('#healthPanel');
  if (_activeHStat && state.pinnedHealthPanel === _activeHStat.dataset.h) return;
  healthPanel.classList.remove('show');
  healthPanel.classList.remove('pinned');
  if (_activeHStat) _activeHStat.classList.remove('is-open');
  _activeHStat = null;
}

function toggleHealthPanelPin(key){
  const healthPanel = $('#healthPanel');
  if (state.pinnedHealthPanel === key){
    state.pinnedHealthPanel = null;
    healthPanel.classList.remove('pinned');
  } else {
    state.pinnedHealthPanel = key;
    healthPanel.classList.add('pinned');
  }
  // 重新 render 來更新按鈕狀態
  if (_activeHStat) openHealthPanel(_activeHStat.dataset.h, _activeHStat);
}

function bindHealthHover(){
  const healthPanel = $('#healthPanel');
  $$('.h-stat').forEach(el => {
    el.addEventListener('mouseenter', () => {
      if (state.pinnedHealthPanel && state.pinnedHealthPanel !== el.dataset.h) return;
      clearTimeout(_hLeaveTimer);
      _hHoverTimer = setTimeout(() => openHealthPanel(el.dataset.h, el), 60);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(_hHoverTimer);
      _hLeaveTimer = setTimeout(() => { if (!healthPanel.matches(':hover')) closeHealthPanel(); }, 140);
    });
    // 觸控裝置:點擊切換
    el.addEventListener('click', () => {
      if (!IS_TOUCH) return;
      if (healthPanel.classList.contains('show') && _activeHStat === el){
        closeHealthPanel();
      } else {
        openHealthPanel(el.dataset.h, el);
      }
    });
  });
  healthPanel.addEventListener('mouseenter', () => clearTimeout(_hLeaveTimer));
  healthPanel.addEventListener('mouseleave', () => { _hLeaveTimer = setTimeout(closeHealthPanel, 140); });
}
