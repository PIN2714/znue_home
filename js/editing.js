/* editing.js
   編輯模式 + modals + icon picker
   - toggleEditMode / exitEditMode: E 鍵或鉛筆 icon 切換
   - openLinkEdit / openGroupEdit / openCardEdit: 三種 modal
   - addCardToSection / addSection / deleteSection / addGroupToCard / addLinkToGroup
   - incrementClicks: 連結點擊計數(stage 5 才會持久化,目前只更新記憶體)
   - icon picker: emoji / symbol / upload(壓縮 128×128 base64)
   依賴:DATA、state、helpers、md、render(activeCard、openPanel、closePanel、renderSections) */

/* ===== 重 render helper =====
   編輯/新增後同時刷新主面板 + 封存區,並重新打開原本 active 的 panel(若仍存在)。
   activeCard 在 renderSections 後是 detached,所以用 dataset.cat 反查新 DOM。 */
function _refreshAfterEdit(){
  const reopenCatId = (typeof activeCard !== 'undefined' && activeCard) ? activeCard.dataset.cat : null;
  if (typeof renderSections === 'function') renderSections();
  if (typeof renderArchive === 'function' && state.archiveOpen) renderArchive();
  if (reopenCatId){
    const newEl = document.querySelector(`[data-cat="${reopenCatId}"]`);
    if (newEl) openPanel(reopenCatId, newEl);
  }
}

/* ===== Quick link toggle helper =====
   cat.quickLinks 內元素可能是 string (link.id) 或舊 {title, url}
   on:加入 string id(unshift 到開頭,讓新加的快捷立即可見)
   off:移除 string id 與 url 相符的舊物件
   注意 url='#' 不參與 url 比對(避免 sample data 中多個 placeholder 互相誤判) */
function _setQuickLink(cat, link, on){
  if (!cat.quickLinks) cat.quickLinks = [];
  const isAlreadyIn = _isQuickLink(cat, link);
  if (on && !isAlreadyIn){
    // unshift 不 push — 讓新加的 quick 在前面、不被 contentRows 截斷
    cat.quickLinks.unshift(link.id);
  } else if (!on && isAlreadyIn){
    cat.quickLinks = cat.quickLinks.filter(q => {
      if (typeof q === 'string') return q !== link.id;
      // url 比對只在 url 非 '#' 時生效
      if (q && typeof q === 'object' && link.url && link.url !== '#') return q.url !== link.url;
      return true;
    });
  }
}
function _isQuickLink(cat, link){
  if (!cat || !cat.quickLinks) return false;
  return cat.quickLinks.some(q => {
    if (typeof q === 'string') return q === link.id;
    if (q && typeof q === 'object' && link.url && link.url !== '#') return q.url === link.url;
    return false;
  });
}

/* ===== Modal 容器 ===== */
const modal = () => $('#editModal');
const modalBackdrop = () => $('#modalBackdrop');
function openModal(){ modalBackdrop().classList.add('show'); modal().classList.add('show'); }
function closeModal(){ modalBackdrop().classList.remove('show'); modal().classList.remove('show'); }

/* ===== Edit mode toggle ===== */
function toggleEditMode(){
  state.edit = !state.edit;
  document.body.classList.toggle('edit-mode', state.edit);
  $('#editMode').classList.toggle('active', state.edit);
  if (typeof setSortablesEnabled === 'function') setSortablesEnabled(state.edit);
  if (state.edit) showTip('編輯模式啟用 · 點擊任何項目來修改');
}
function exitEditMode(){
  state.edit = false;
  document.body.classList.remove('edit-mode');
  $('#editMode').classList.remove('active');
  $$('[contenteditable="true"]').forEach(el => el.contentEditable = 'false');
  if (typeof setSortablesEnabled === 'function') setSortablesEnabled(false);
}

/* ===== Markdown 輔助:popover help + 即時預覽 textarea ===== */
const MARKDOWN_HELP = `
  <div class="md-row"><code>**粗體**</code><span class="md-result"><strong>粗體</strong></span></div>
  <div class="md-row"><code>*斜體*</code><span class="md-result"><em>斜體</em></span></div>
  <div class="md-row"><code>\`code\`</code><span class="md-result"><code>code</code></span></div>
  <div class="md-row"><code>- 清單</code><span class="md-result">• 清單</span></div>
  <div class="md-row"><code>1. 數字</code><span class="md-result">1. 數字</span></div>
  <div class="md-row"><code>&gt; 引用</code><span class="md-result">▎ 引用</span></div>
  <div class="md-row"><code>[文字](url)</code><span class="md-result">連結</span></div>
  <div class="md-row" style="border:none;"><code>(換行)</code><span class="md-result">空行分段</span></div>
`;

function memoFieldHtml(value, label='備註', hint='支援 markdown · 短備註直接顯示、長備註 hover 展開'){
  const id = 'f_memo_' + Math.random().toString(36).slice(2,7);
  return `
    <div class="field">
      <label class="field-label">
        ${label}
        <span class="hint">${hint}</span>
        <span class="md-help" data-md-help>md ?</span>
      </label>
      <textarea class="field-textarea" id="${id}" placeholder="支援 **粗體**、*斜體*、\`code\`、- 清單、> 引用…">${value || ''}</textarea>
      <div class="md-preview-label">即時預覽</div>
      <div class="md-preview" id="${id}_preview">${md(value || '') || '<span style="color:var(--ink-faint);font-style:italic;">輸入備註後在這裡預覽</span>'}</div>
    </div>
  `;
}

function bindMemoLivePreview(){
  $$('.field-textarea').forEach(ta => {
    if (ta.dataset.bound) return;
    ta.dataset.bound = '1';
    const previewId = ta.id + '_preview';
    const preview = document.getElementById(previewId);
    if (!preview) return;
    ta.addEventListener('input', () => {
      const html = md(ta.value);
      preview.innerHTML = html || '<span style="color:var(--ink-faint);font-style:italic;">輸入備註後在這裡預覽</span>';
    });
  });
  // markdown help popovers
  $$('[data-md-help]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('mouseenter', (e) => {
      const pop = document.createElement('div');
      pop.className = 'md-popover show';
      pop.innerHTML = MARKDOWN_HELP;
      pop.id = '_mdpop';
      const r = el.getBoundingClientRect();
      pop.style.position = 'fixed';
      pop.style.left = (r.right - 240) + 'px';
      pop.style.top = (r.bottom + 6) + 'px';
      document.body.appendChild(pop);
    });
    el.addEventListener('mouseleave', () => {
      const pop = document.getElementById('_mdpop');
      if (pop) pop.remove();
    });
  });
}

/* ===== Link edit modal ===== */
function openLinkEdit(linkId){
  const found = findLinkAnywhere(linkId);
  if (!found) return;
  const l = found.link;

  // 是否為卡片快捷連結?(支援 string id 或舊 {url} — url='#' 不參與比對)
  const isQuick = _isQuickLink(found.cat, l);

  // 所有卡片(主面板 + 封存)— 「移動到」select
  const allCatOptions = [];
  for (const sec of DATA.sections){
    for (const cat of sec.categories){
      allCatOptions.push({id: cat.id, label: `${sec.name} · ${cat.title}`});
    }
  }
  for (const tab of (DATA.archive?.tabs || [])){
    for (const sec of (tab.sections || [])){
      for (const cat of (sec.categories || [])){
        allCatOptions.push({id: cat.id, label: `📦 ${tab.name} · ${sec.name} · ${cat.title}`});
      }
    }
  }
  const groupOptions = found.cat.groups.map((g, gi) => `<option value="${gi}" ${g === found.group ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('');

  $('#modalTitle').textContent = '編輯連結';
  $('#modalSub').textContent = 'link';
  $('#modalBody').innerHTML = `
    <div class="icon-row">
      <div class="preview" id="linkIconPreview"${iconAttrs(l.icon, l.iconType)} style="--cat-tint:${found.cat.tint}; --cat-color:${found.cat.color};"
        onclick="openIconPickerForLink(event, '${l.id}')">
        ${renderIcon(l.icon, l.iconType)}
      </div>
      <div class="preview-info">
        <div class="label">圖示 / Icon</div>
        <div class="help">點擊選 emoji、符號,或上傳圖片</div>
      </div>
    </div>
    <div class="field">
      <label class="field-label">標題</label>
      <input type="text" class="field-input" id="f_title" value="${(l.title||'').replace(/"/g,'&quot;')}" />
    </div>
    <div class="field">
      <label class="field-label">URL</label>
      <input type="text" class="field-input" id="f_url" value="${(l.url || '').replace(/"/g,'&quot;')}" placeholder="https://... 或 D:\\Documents\\(本機路徑)" />
      <div class="field-hint" id="urlHint" style="font-size:11px; color:var(--ink-faint); margin-top:5px; line-height:1.5;">
        本機路徑會自動正規化(例:<code style="font-family:var(--mono);background:var(--bg-2);padding:1px 4px;border-radius:3px;">D:\\Foo\\</code> → <code style="font-family:var(--mono);background:var(--bg-2);padding:1px 4px;border-radius:3px;">file:///D:/Foo/</code>)。
        <br>Chrome/Edge 點擊本機連結需安裝 <a href="https://chromewebstore.google.com/detail/local-explorer-open-file/eokekhgpaakbkfkmjjcbffibkencdfkl" target="_blank" style="color:var(--accent); text-decoration:underline;">Local Explorer</a> 擴充功能。
      </div>
    </div>
    ${memoFieldHtml(l.memo, '備註')}
    <div class="field-row">
      <div class="field">
        <label class="field-label">所屬卡片</label>
        <select class="field-input" id="f_targetCat">
          ${allCatOptions.map(o => `<option value="${o.id}" ${o.id===found.cat.id?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field-label">所屬群組</label>
        <select class="field-input" id="f_targetGroup">
          ${groupOptions}
        </select>
      </div>
    </div>
    <div class="toggle-row">
      <div class="toggle-switch ${l.memoPinned?'on':''}" id="f_memoPinned" onclick="this.classList.toggle('on')"></div>
      <span class="toggle-label">📌 釘住備註</span>
      <span class="toggle-hint">即使是長備註也直接顯示</span>
    </div>
    <div class="toggle-row">
      <div class="toggle-switch ${l.pinned?'on':''}" id="f_pinned" onclick="this.classList.toggle('on')"></div>
      <span class="toggle-label">⭐ 加入最愛</span>
      <span class="toggle-hint">標題旁顯示星號</span>
    </div>
    <div class="toggle-row">
      <div class="toggle-switch ${isQuick?'on':''}" id="f_isQuick" onclick="this.classList.toggle('on')"></div>
      <span class="toggle-label">⚡ 設為卡片快捷連結</span>
      <span class="toggle-hint">顯示在卡片外觀</span>
    </div>
  `;

  // 切換目標卡片時 → 重生成群組 select
  $('#f_targetCat').addEventListener('change', () => {
    const tCatId = $('#f_targetCat').value;
    const tCat = findCatAnywhere(tCatId);
    if (!tCat) return;
    $('#f_targetGroup').innerHTML = tCat.cat.groups.map((g, gi) => `<option value="${gi}">${escapeHtml(g.name)}</option>`).join('');
  });

  bindMemoLivePreview();

  // URL 欄位即時偵測本機路徑
  const urlInput = $('#f_url');
  const urlHint = $('#urlHint');
  if (urlInput && urlHint){
    const linkExt = `<a href="https://chromewebstore.google.com/detail/local-explorer-open-file/eokekhgpaakbkfkmjjcbffibkencdfkl" target="_blank" style="color:var(--accent); text-decoration:underline;">Local Explorer</a>`;
    const updateHint = () => {
      const v = urlInput.value.trim();
      if (isLocalPath(v)){
        const normalized = normalizeLocalPath(v);
        if (normalized !== v){
          urlHint.innerHTML = `✓ 偵測到本機路徑,儲存時會轉為:<code style="font-family:var(--mono);background:var(--accent-soft);color:var(--accent);padding:1px 4px;border-radius:3px;">${escapeHtml(normalized)}</code>`;
        } else {
          urlHint.innerHTML = `✓ 已是標準本機路徑格式。Chrome/Edge 需安裝 ${linkExt} 才能直接跳轉。`;
        }
      } else {
        urlHint.innerHTML = `本機路徑會自動正規化(例:<code style="font-family:var(--mono);background:var(--bg-2);padding:1px 4px;border-radius:3px;">D:\\Foo\\</code> → <code style="font-family:var(--mono);background:var(--bg-2);padding:1px 4px;border-radius:3px;">file:///D:/Foo/</code>)。<br>Chrome/Edge 點擊本機連結需安裝 ${linkExt} 擴充功能。`;
      }
    };
    urlInput.addEventListener('input', updateHint);
    updateHint();
  }

  $('#modalSave').onclick = () => {
    l.title = $('#f_title').value.trim();
    let urlVal = $('#f_url').value.trim();
    if (urlVal && isLocalPath(urlVal)) urlVal = normalizeLocalPath(urlVal);
    l.url = urlVal || '#';
    const ta = $('.field-textarea');
    l.memo = ta.value.trim();
    l.memoPinned = $('#f_memoPinned').classList.contains('on');
    l.pinned = $('#f_pinned').classList.contains('on');

    // 處理快捷連結 toggle(維持 quickLinks 在 found.cat — 移動前判斷)
    const wantQuick = $('#f_isQuick').classList.contains('on');
    _setQuickLink(found.cat, l, wantQuick);

    // 處理「移動到其他卡片 / 群組」(支援跨 main / archive)
    const tCatId = $('#f_targetCat').value;
    const tGroupIdx = parseInt($('#f_targetGroup').value, 10);
    const tFound = findCatAnywhere(tCatId);
    if (tFound && (tCatId !== found.cat.id || tFound.cat.groups[tGroupIdx] !== found.group)){
      // 從原群組移除
      found.group.links = found.group.links.filter(x => x.id !== l.id);
      // 也從原 cat 的 quickLinks 移除(避免遺留 dangling reference)
      _setQuickLink(found.cat, l, false);
      // 加入新群組
      const tGroup = tFound.cat.groups[tGroupIdx];
      if (tGroup){
        tGroup.links.push(l);
        // 若標記為快捷,把它加進新 cat 的 quickLinks
        if (wantQuick) _setQuickLink(tFound.cat, l, true);
      }
      const dest = tFound.location.startsWith('archive:') ? `📦 ${tFound.tab.name} · ${tFound.cat.title}` : tFound.cat.title;
      showTip(`已移動到「${dest}」`);
    } else {
      showTip('連結已儲存');
    }

    markDirty();
    closeModal();
    _refreshAfterEdit();
  };
  $('#modalDelete').onclick = () => {
    if (!confirm('確定要刪除這個連結?')) return;
    found.group.links = found.group.links.filter(x => x.id !== l.id);
    _setQuickLink(found.cat, l, false);  // 也從 quickLinks 移除
    markDirty();
    closeModal();
    _refreshAfterEdit();
    showTip('已刪除');
  };
  $('#modalDelete').style.display = '';
  openModal();
}

/* ===== Group edit modal ===== */
function openGroupEdit(catId, gi){
  const found = findCatAnywhere(catId);
  if (!found) return;
  const g = found.cat.groups[gi];
  if (!g) return;

  $('#modalTitle').textContent = '編輯群組';
  $('#modalSub').textContent = 'group';
  $('#modalBody').innerHTML = `
    <div class="field">
      <label class="field-label">群組名稱</label>
      <input type="text" class="field-input" id="f_name" value="${(g.name||'').replace(/"/g,'&quot;')}" />
    </div>
    ${memoFieldHtml(g.memo, '群組說明', '顯示在群組標題下方,可用來說明這個分類在做什麼')}
    <div style="margin-top: 12px; padding: 10px 12px; background: var(--bg-2); border-radius: 5px; font-size: 11.5px; color: var(--ink-soft); font-style: italic; font-family: var(--serif);">
      此群組目前有 <strong style="font-style:normal;color:var(--ink);">${g.links.length}</strong> 個連結
    </div>
  `;
  bindMemoLivePreview();

  $('#modalSave').onclick = () => {
    g.name = $('#f_name').value.trim() || g.name;
    const ta = $('.field-textarea');
    g.memo = ta.value.trim();
    markDirty();
    closeModal();
    _refreshAfterEdit();
    showTip('群組已儲存');
  };
  $('#modalDelete').onclick = () => {
    if (g.links.length > 0){
      if (!confirm(`刪除群組「${g.name}」?裡面 ${g.links.length} 個連結也會一併刪除。`)) return;
    } else {
      if (!confirm(`刪除群組「${g.name}」?`)) return;
    }
    found.cat.groups.splice(gi, 1);
    markDirty();
    closeModal();
    _refreshAfterEdit();
    showTip('群組已刪除');
  };
  $('#modalDelete').style.display = '';
  openModal();
}

/* ===== Card edit modal ===== */
const TINT_PALETTE = [
  { name:"橘", tint:"#fde8d4", color:"#c2410c" },
  { name:"琥珀", tint:"#fef3c7", color:"#a16207" },
  { name:"綠", tint:"#dcfce7", color:"#15803d" },
  { name:"藍", tint:"#dbeafe", color:"#1e40af" },
  { name:"青", tint:"#cffafe", color:"#0e7490" },
  { name:"紫", tint:"#f3e8ff", color:"#7c3aed" },
  { name:"粉", tint:"#fce7f3", color:"#be185d" },
  { name:"紅", tint:"#fee2e2", color:"#dc2626" },
  { name:"灰", tint:"#e8e8e8", color:"#1a1a1a" },
];

function openCardEdit(catId){
  const found = findCatAnywhere(catId);
  if (!found) return;
  const c = found.cat;
  closePanel();

  $('#modalTitle').textContent = '編輯卡片';
  $('#modalSub').textContent = 'category';
  $('#modalBody').innerHTML = `
    <div class="icon-row">
      <div class="preview" id="catIconPreview"${iconAttrs(c.icon, c.iconType)} style="--cat-tint:${c.tint}; --cat-color:${c.color};"
        onclick="openIconPickerForCard(event, '${c.id}')">
        ${renderIcon(c.icon, c.iconType)}
      </div>
      <div class="preview-info">
        <div class="label">卡片圖示</div>
        <div class="help">點擊選圖示</div>
      </div>
    </div>
    <div class="field">
      <label class="field-label">名稱</label>
      <input type="text" class="field-input" id="f_title" value="${(c.title||'').replace(/"/g,'&quot;')}" />
    </div>
    <div class="field">
      <label class="field-label">尺寸 <span class="hint">影響卡片在主頁佔的空間</span></label>
      <div class="size-picker">
        <div class="size-option ${c.size==='small'?'selected':''}" data-size="small">
          <div class="so-name">小</div><div class="so-hint">icon + 名稱</div>
        </div>
        <div class="size-option ${c.size==='medium'?'selected':''}" data-size="medium">
          <div class="so-name">中</div><div class="so-hint">標準</div>
        </div>
        <div class="size-option ${c.size==='large'?'selected':''}" data-size="large">
          <div class="so-name">大</div><div class="so-hint">+ 快捷連結</div>
        </div>
      </div>
    </div>
    <div class="field">
      <label class="field-label">所屬區段</label>
      <select class="field-input" id="f_section">
        ${DATA.sections.map(s => `<option value="${s.id}" ${s.id===found.section.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}
        ${(DATA.archive?.tabs || []).flatMap(tab =>
          (tab.sections || []).map(s => `<option value="${s.id}" ${s.id===found.section.id?'selected':''}>📦 ${escapeHtml(tab.name)} · ${escapeHtml(s.name)}</option>`)
        ).join('')}
      </select>
    </div>
    <div class="field">
      <label class="field-label">主題色</label>
      <div class="color-picker">
        ${TINT_PALETTE.map(p => `
          <div class="color-swatch ${c.tint===p.tint?'selected':''}"
               style="background:${p.color};" data-tint="${p.tint}" data-color="${p.color}"
               title="${p.name}"></div>
        `).join('')}
      </div>
    </div>

    <div class="field">
      <label class="field-label">內容顯示 <span class="hint">卡片底部要不要顯示快捷連結</span></label>
      <div class="size-picker" id="f_contentMode">
        <div class="size-option ${(c.contentMode||'auto')==='auto'?'selected':''}" data-mode="auto">
          <div class="so-name">auto</div><div class="so-hint">依設定預設</div>
        </div>
        <div class="size-option ${c.contentMode==='list'?'selected':''}" data-mode="list">
          <div class="so-name">list</div><div class="so-hint">條列文字</div>
        </div>
        <div class="size-option ${c.contentMode==='grid'?'selected':''}" data-mode="grid">
          <div class="so-name">grid</div><div class="so-hint">圖示排列</div>
        </div>
        <div class="size-option ${c.contentMode==='hidden'?'selected':''}" data-mode="hidden">
          <div class="so-name">hidden</div><div class="so-hint">不顯示內容</div>
        </div>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label class="field-label">顯示行數 <span class="hint">同 row 有 large 才會顯示</span></label>
        <select class="field-input" id="f_contentRows">
          <option value="">自動(依 size)</option>
          <option value="1" ${c.contentRows===1?'selected':''}>1 行</option>
          <option value="2" ${c.contentRows===2?'selected':''}>2 行</option>
          <option value="3" ${c.contentRows===3?'selected':''}>3 行</option>
          <option value="4" ${c.contentRows===4?'selected':''}>4 行</option>
          <option value="5" ${c.contentRows===5?'selected':''}>5 行</option>
        </select>
      </div>
      <div class="field">
        <label class="field-label">grid 每行 icon 數 <span class="hint">grid 模式才有效</span></label>
        <select class="field-input" id="f_gridCols">
          <option value="">自動(fit 寬度)</option>
          <option value="2" ${c.gridCols===2?'selected':''}>2 個</option>
          <option value="3" ${c.gridCols===3?'selected':''}>3 個</option>
          <option value="4" ${c.gridCols===4?'selected':''}>4 個</option>
          <option value="5" ${c.gridCols===5?'selected':''}>5 個</option>
          <option value="6" ${c.gridCols===6?'selected':''}>6 個</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label class="field-label">連結排序 <span class="hint">這張卡片內的連結怎麼排</span></label>
      <select class="field-input" id="f_sortMode">
        <option value="" ${(!c.sortMode || c.sortMode==='inherit')?'selected':''}>依設定(全域)</option>
        <option value="manual" ${c.sortMode==='manual'?'selected':''}>手動 · 拖曳指定</option>
        <option value="clicks" ${c.sortMode==='clicks'?'selected':''}>點擊次數 · 最常用優先</option>
        <option value="recent" ${c.sortMode==='recent'?'selected':''}>最近用 · 新鮮的優先</option>
      </select>
    </div>
    <div class="field">
      <label class="field-label">快捷連結 <span class="hint">卡片外觀顯示的圖示(個別連結 ⚡ toggle 可加入)</span></label>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span style="font-family:var(--mono); font-size:12px; color:var(--ink-soft);">
          目前 <strong style="color:var(--ink);" id="f_quickCount">${(c.quickLinks || []).length}</strong> 個
        </span>
        <button type="button" class="settings-btn ghost" id="f_clearQuick" ${(!c.quickLinks || c.quickLinks.length === 0) ? 'disabled' : ''}>清空</button>
        <span style="font-size:11px; color:var(--ink-faint); font-style:italic;">
          清空後會 fallback 顯示 group 內前幾個連結
        </span>
      </div>
    </div>
  `;

  // size-picker 互斥選擇 — 但同一個 modal 內有多個 size-picker(尺寸 + 內容顯示),
  // 各自獨立。用 closest 限制範圍。
  $$('#modalBody .size-picker').forEach(picker => {
    picker.querySelectorAll('.size-option').forEach(el => {
      el.addEventListener('click', () => {
        picker.querySelectorAll('.size-option').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
  });
  $$('#modalBody .color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      $$('#modalBody .color-swatch').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      const preview = $('#catIconPreview');
      preview.style.setProperty('--cat-tint', el.dataset.tint);
      preview.style.setProperty('--cat-color', el.dataset.color);
    });
  });

  // 清空快捷連結 — 點下立即生效(modal 儲存後 markDirty 寫入)
  $('#f_clearQuick')?.addEventListener('click', () => {
    if (!c.quickLinks || c.quickLinks.length === 0) return;
    if (!confirm(`清空「${c.title}」的 ${c.quickLinks.length} 個快捷連結?\n清空後卡片會自動顯示 group 內前幾個連結。`)) return;
    c.quickLinks = [];
    $('#f_quickCount').textContent = '0';
    $('#f_clearQuick').setAttribute('disabled', '');
    showTip('已清空 — 儲存後生效');
  });

  $('#modalSave').onclick = () => {
    c.title = $('#f_title').value.trim();
    // 兩個 size-picker:第一個是尺寸(data-size),第二個是內容模式(data-mode)
    const sizePicker = $$('#modalBody .size-picker')[0];
    const modePicker = $('#f_contentMode');
    if (sizePicker){
      const selSize = sizePicker.querySelector('.size-option.selected');
      if (selSize) c.size = selSize.dataset.size;
    }
    if (modePicker){
      const selMode = modePicker.querySelector('.size-option.selected');
      if (selMode) c.contentMode = selMode.dataset.mode;
    }
    const rowsVal = $('#f_contentRows').value;
    c.contentRows = rowsVal === '' ? null : parseInt(rowsVal, 10);
    const colsVal = $('#f_gridCols').value;
    c.gridCols = colsVal === '' ? null : parseInt(colsVal, 10);
    const sortVal = $('#f_sortMode').value;
    c.sortMode = sortVal || undefined;  // '' → undefined(依設定)
    const sw = $('#modalBody .color-swatch.selected');
    if (sw){ c.tint = sw.dataset.tint; c.color = sw.dataset.color; }
    const newSecId = $('#f_section').value;
    if (newSecId !== found.section.id){
      found.section.categories = found.section.categories.filter(x => x.id !== c.id);
      const newFound = findSectionAnywhere(newSecId);
      if (newFound) newFound.section.categories.push(c);
    }
    markDirty();
    closeModal();
    _refreshAfterEdit();
    showTip('卡片已儲存');
  };
  $('#modalDelete').onclick = () => {
    if (!confirm(`確定要刪除「${c.title}」這張卡片?`)) return;
    found.section.categories = found.section.categories.filter(x => x.id !== c.id);
    markDirty();
    closeModal();
    _refreshAfterEdit();
    showTip('卡片已刪除');
  };
  $('#modalDelete').style.display = '';
  openModal();
}

/* ===== Add ops ===== */
function addCardToSection(sectionId){
  const found = findSectionAnywhere(sectionId);
  if (!found) return;
  const id = uid('cat');
  found.section.categories.push({
    id, title: "新卡片", icon: "✦", iconType: "text",
    tint: "#fde8d4", color: "#c2410c", size: "medium",
    groups: [{ name: "新群組", memo: "", links: [] }]
  });
  markDirty();
  _refreshAfterEdit();
  setTimeout(() => openCardEdit(id), 50);
}
function addSection(){
  const id = uid('sec');
  DATA.sections.push({ id, name: "新區段", hint: "", categories: [] });
  markDirty();
  renderSections();
  setTimeout(() => {
    const h = document.querySelector(`[data-edit-section-name="${id}"]`);
    if (h) startInlineEdit(h, (newText) => {
      DATA.sections.find(s => s.id === id).name = newText;
      markDirty();
    });
  }, 50);
}
function deleteSection(sectionId){
  const sec = DATA.sections.find(s => s.id === sectionId);
  if (!sec) return;
  if (!confirm(`刪除「${sec.name}」?裡面 ${sec.categories.length} 張卡片也會一併刪除。`)) return;
  DATA.sections = DATA.sections.filter(s => s.id !== sectionId);
  markDirty();
  renderSections();
  showTip('區段已刪除');
}
function addGroupToCard(catId){
  const found = findCatAnywhere(catId);
  if (!found) return;
  found.cat.groups.push({ name: "新群組", memo: "", links: [] });
  markDirty();
  if (activeCard) openPanel(activeCard.dataset.cat, activeCard);
}
function addLinkToGroup(catId, groupIdx){
  const found = findCatAnywhere(catId);
  if (!found) return;
  const id = uid('l');
  found.cat.groups[groupIdx].links.push({
    id, title: "新連結", url: "https://", icon: "🔗", iconType: "emoji",
    memo: "", clicks: 0, pinned: false
  });
  markDirty();
  if (activeCard) openPanel(activeCard.dataset.cat, activeCard);
  setTimeout(() => openLinkEdit(id), 50);
}
function incrementClicks(linkId){
  const found = findLinkAnywhere(linkId);
  if (found){
    found.link.clicks = (found.link.clicks || 0) + 1;
    found.link.lastClicked = new Date().toISOString();
    markDirty();
  }
}

/* ===== Icon picker ===== */
const EMOJI_GROUPS = [
  { name:"常用", items:["⭐","❤️","🔥","✨","🎯","📌","🚀","💡","📚","🎨","🎵","🎮","🌟","⚡","🍀"] },
  { name:"工具", items:["⚙️","🔧","🔨","💻","⌨️","🖱️","📱","💾","🗂️","📁","📂","📋","🔍","🔗","✏️","✒️","📝","📐"] },
  { name:"溝通", items:["💬","📧","📩","📨","📞","📲","📢","📣","🔔","🔕","💭","🗨️","📰"] },
  { name:"工作", items:["📊","📈","📉","📅","📆","🗓️","🗒️","📔","📓","📒","📕","📗","📘","📙","📚","💼","🏢"] },
  { name:"生活", items:["🏠","🏪","☕","🍽️","🛒","💰","💳","🎁","🎉","☀️","🌙","🌈","🌍","🎀"] },
  { name:"娛樂", items:["🎬","🎭","🎤","🎧","🎮","🎲","🃏","♠️","♥️","♦️","♣️","🎪","🎢","🎡"] },
  { name:"運動", items:["⚽","🏀","🏈","⚾","🎾","🏐","🎱","🏓","🏸","🏃","🚴","🏊","🧘","💪"] },
  { name:"自然", items:["🌳","🌲","🌴","🌵","🌷","🌸","🌹","🌺","🌻","🌼","🍁","🍂","🍃"] },
];
const SYMBOL_LIST = [
  "✦","✧","★","☆","✩","✪","✫","✬","✭","✮","✯","✰",
  "✓","✕","✗","✘","✚","✛","✜","✝","✞","✟","✠",
  "♡","♥","♢","♦","♤","♠","♧","♣","♪","♫","♬","♭",
  "→","←","↑","↓","↔","↕","⇒","⇐","⇑","⇓","⇔","⇕",
  "○","●","◐","◑","◒","◓","◔","◕","◖","◗",
  "□","■","△","▲","▽","▼","◁","◀","▷","▶","◇","◆","◈","◉",
  "✈","⚓","☂","☁","☀","☃","❄","☘","♨","☎","✆","✉",
  "♔","♕","♖","♗","♘","♙","♚","♛","♜","♝","♞","♟",
  "α","β","γ","δ","ε","ζ","η","θ","λ","μ","π","Σ",
  "①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩",
  "Ⓐ","Ⓑ","Ⓒ","Ⓓ","Ⓔ","Ⓕ","Ⓖ","Ⓗ","Ⓘ","Ⓙ",
];

function renderPicker(){
  let content = '';
  if (state.pickerTab === 'emoji'){
    content = EMOJI_GROUPS.map(g => `
      <div style="margin-bottom: 12px;">
        <div style="font-family:var(--mono); font-size:9px; color:var(--ink-faint); letter-spacing:.12em; text-transform:uppercase; padding:4px 6px;">${g.name}</div>
        <div class="picker-grid">
          ${g.items.map(e => `<button class="picker-item" data-icon="${e}" data-type="emoji">${e}</button>`).join('')}
        </div>
      </div>
    `).join('');
    $('#pickerSearch').style.display = '';
  } else if (state.pickerTab === 'symbol'){
    content = `<div class="picker-grid">
      ${SYMBOL_LIST.map(s => `<button class="picker-item" data-icon="${s}" data-type="text">${s}</button>`).join('')}
    </div>`;
    $('#pickerSearch').style.display = '';
  } else if (state.pickerTab === 'text'){
    // 文字 icon — 1~4 字,圓形填滿
    content = `
      <div class="picker-text">
        <div class="picker-text-row">
          <input type="text" id="textIconInput" maxlength="4" placeholder="輸入 1–4 字 (例:AI、工具、abc)" autocomplete="off" />
          <button id="textIconConfirm" disabled>使用</button>
        </div>
        <div class="picker-text-preview" id="textIconPreview">
          <span class="preview-circle" id="textIconCircle">?</span>
          <span class="preview-hint">即時預覽</span>
        </div>
      </div>
    `;
    $('#pickerSearch').style.display = 'none';
  } else if (state.pickerTab === 'upload'){
    content = `
      <div class="picker-upload">
        <div class="upload-zone" id="uploadZone">
          <div class="upload-icon">⬆</div>
          <p>點擊或拖放圖片到這裡</p>
          <div class="upload-hint">建議 64×64px · PNG / JPG / SVG</div>
          <input type="file" id="uploadFile" accept="image/*" style="display:none;">
        </div>
        <div class="upload-preview" id="uploadPreview">
          <img id="uploadPreviewImg" />
          <button id="uploadConfirm">使用這張圖片</button>
        </div>
      </div>
    `;
    $('#pickerSearch').style.display = 'none';
  }
  $('#pickerContent').innerHTML = content;
  $$('.picker-item').forEach(el => {
    el.addEventListener('click', () => applyIcon(el.dataset.icon, el.dataset.type));
  });
  if (state.pickerTab === 'upload'){
    const zone = $('#uploadZone'), file = $('#uploadFile');
    zone.addEventListener('click', () => file.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
    });
    file.addEventListener('change', e => { if (e.target.files[0]) handleUpload(e.target.files[0]); });
  }
  if (state.pickerTab === 'text'){
    const input = $('#textIconInput');
    const circle = $('#textIconCircle');
    const confirm = $('#textIconConfirm');
    if (input && circle && confirm){
      input.focus();
      const update = () => {
        const raw = input.value.trim();
        const chars = [...raw].slice(0, 4);
        if (chars.length === 0){
          circle.textContent = '?';
          circle.removeAttribute('data-text-len');
        } else if (chars.length === 1){
          circle.textContent = chars[0];
          circle.removeAttribute('data-text-len');
        } else {
          // 多字 — wrap 成 spans 配合 grid layout(跟主面板一致)
          circle.innerHTML = chars.map(c => `<span>${escapeHtml(c)}</span>`).join('');
          circle.setAttribute('data-text-len', String(chars.length));
        }
        confirm.disabled = !raw;
      };
      input.addEventListener('input', update);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && input.value.trim()){ e.preventDefault(); confirm.click(); }
      });
      confirm.addEventListener('click', () => {
        const chars = [...input.value.trim()].slice(0, 4);
        if (!chars.length) return;
        applyIcon(chars.join(''), 'text');
      });
      update();
    }
  }
}

function handleUpload(file){
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 128, 128);
      const dataUrl = canvas.toDataURL('image/png');
      $('#uploadPreviewImg').src = dataUrl;
      $('#uploadPreview').classList.add('show');
      $('#uploadConfirm').onclick = () => applyIcon(dataUrl, 'image');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function applyIcon(icon, type){
  const target = state.pickerTarget;
  if (!target) return;
  if (target.type === 'link'){
    const found = findLinkAnywhere(target.id);
    if (found){
      found.link.icon = icon; found.link.iconType = type;
      const preview = $('#linkIconPreview');
      if (preview){
        preview.innerHTML = renderIcon(icon, type);
        // 更新 data-text-len 讓 multi-char 縮放生效
        if (type === 'text' && typeof icon === 'string' && icon.length > 1){
          preview.setAttribute('data-text-len', String(Math.min(icon.length, 4)));
        } else {
          preview.removeAttribute('data-text-len');
        }
      }
      if (activeCard) openPanel(activeCard.dataset.cat, activeCard);
    }
  } else if (target.type === 'card'){
    const found = findCatAnywhere(target.id);
    if (found){
      found.cat.icon = icon; found.cat.iconType = type;
      const preview = $('#catIconPreview');
      if (preview){
        preview.innerHTML = renderIcon(icon, type);
        if (type === 'text' && typeof icon === 'string' && icon.length > 1){
          preview.setAttribute('data-text-len', String(Math.min(icon.length, 4)));
        } else {
          preview.removeAttribute('data-text-len');
        }
      }
    }
  }
  markDirty();
  closeIconPicker();
}

function openIconPickerAt(anchor){
  const iconPicker = $('#iconPicker');
  const r = anchor.getBoundingClientRect();
  iconPicker.style.left = r.left + 'px';
  iconPicker.style.top = (r.bottom + 6) + 'px';
  iconPicker.classList.add('show');
  requestAnimationFrame(() => {
    const pr = iconPicker.getBoundingClientRect();
    if (pr.right > window.innerWidth - 12) iconPicker.style.left = Math.max(12, window.innerWidth - pr.width - 12) + 'px';
    if (pr.bottom > window.innerHeight - 12) iconPicker.style.top = Math.max(12, r.top - pr.height - 6) + 'px';
  });
  state.pickerTab = 'emoji';
  $$('.picker-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'emoji'));
  renderPicker();
}

function openIconPickerForLink(e, linkId){
  e.stopPropagation();
  state.pickerTarget = { type: 'link', id: linkId };
  openIconPickerAt(e.currentTarget);
}

function openIconPickerForCard(e, catId){
  e.stopPropagation();
  state.pickerTarget = { type: 'card', id: catId };
  openIconPickerAt(e.currentTarget);
}

function closeIconPicker(){
  $('#iconPicker').classList.remove('show');
  state.pickerTarget = null;
}

/* ===== Editing 區的 DOM 綁定(放在 main.js 的 init 之外也可以,
   但因為 prototype 是頂層執行,我們同樣放這裡 — index.html 的 script 在 body 末端,所以 DOM 一定就緒) ===== */
function bindEditingDom(){
  $('#editMode').addEventListener('click', toggleEditMode);
  $('#exitEdit').addEventListener('click', exitEditMode);
  // backdrop 共用 — 看哪個 modal 開著就關哪個
  modalBackdrop().addEventListener('click', () => {
    if ($('#settingsModal').classList.contains('show')) closeSettings();
    else closeModal();
  });

  // 點 picker 外側 → 關閉 picker
  document.addEventListener('click', (e) => {
    const iconPicker = $('#iconPicker');
    if (iconPicker.classList.contains('show') &&
        !iconPicker.contains(e.target) &&
        !e.target.closest('.preview') &&
        !e.target.closest('.favicon')){
      closeIconPicker();
    }
  });
  // picker tab 切換
  $$('.picker-tab').forEach(t => {
    t.addEventListener('click', () => {
      state.pickerTab = t.dataset.tab;
      $$('.picker-tab').forEach(x => x.classList.toggle('active', x === t));
      renderPicker();
    });
  });
}
