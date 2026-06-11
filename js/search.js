/* search.js
   搜尋下拉:5 個 chip(全部/標題/備註/URL/分類)+ 即時結果
   會搜主面板 + 封存區(只在有 query 時搜封存)
   依賴:DATA、state、escapeHtml、renderIcon */

function bindSearch(){
  const input = $('#searchInput'), pop = $('#searchPop');
  input.addEventListener('focus', () => {
    state.searchQuery = input.value;
    renderSearchResults();
    pop.classList.add('open');
  });
  input.addEventListener('input', () => {
    state.searchQuery = input.value;
    renderSearchResults();
  });
  input.addEventListener('blur', () => {
    setTimeout(() => pop.classList.remove('open'), 180);
  });
  $$('.schip').forEach(chip => {
    chip.addEventListener('mousedown', e => {
      e.preventDefault();
      state.searchScope = chip.dataset.scope;
      $$('.schip').forEach(c => c.classList.toggle('active', c === chip));
      renderSearchResults();
      input.focus();
    });
  });
}

function searchMatches(text, q){
  if (!text) return false;
  return text.toLowerCase().includes(q.toLowerCase());
}

function renderSearchResults(){
  const q = state.searchQuery.trim();
  const wrap = $('#searchResults');
  const scope = state.searchScope;
  const hits = [];
  // 主面板搜尋
  DATA.sections.forEach(sec => {
    sec.categories.forEach(cat => {
      cat.groups.forEach(g => {
        g.links.forEach(link => {
          let match = false;
          if (q === ''){
            match = scope === 'all' || scope === 'title';
          } else {
            if (scope === 'all'){
              match = searchMatches(link.title, q) || searchMatches(link.memo, q)
                   || searchMatches(link.url, q) || searchMatches(cat.title, q)
                   || searchMatches(g.name, q) || searchMatches(sec.name, q);
            } else if (scope === 'title') match = searchMatches(link.title, q);
            else if (scope === 'memo') match = searchMatches(link.memo, q) || searchMatches(g.memo, q);
            else if (scope === 'url') match = searchMatches(link.url, q);
            else if (scope === 'cat') match = searchMatches(cat.title, q) || searchMatches(sec.name, q);
          }
          if (match) hits.push({link, cat, group: g, section: sec, location: 'main'});
        });
      });
    });
  });
  // 封存搜尋(只在有 query 時)
  if (q !== '' && DATA.archive){
    DATA.archive.tabs.forEach(tab => {
      tab.sections.forEach(sec => {
        sec.categories.forEach(cat => {
          cat.groups.forEach(g => {
            g.links.forEach(link => {
              let match = false;
              if (scope === 'all') match = searchMatches(link.title, q) || searchMatches(link.memo, q) || searchMatches(link.url, q) || searchMatches(cat.title, q);
              else if (scope === 'title') match = searchMatches(link.title, q);
              else if (scope === 'memo') match = searchMatches(link.memo, q);
              else if (scope === 'url') match = searchMatches(link.url, q);
              else if (scope === 'cat') match = searchMatches(cat.title, q);
              if (match) hits.push({link, cat, group: g, section: sec, tab, location: 'archive'});
            });
          });
        });
      });
    });
  }

  if (hits.length === 0){
    wrap.innerHTML = `<div class="search-empty">${q ? '沒有結果' : '輸入文字開始搜尋,或瀏覽下方所有連結'}</div>`;
    return;
  }
  // 結果分組顯示:主面板 vs 封存
  const main = hits.filter(h => h.location === 'main');
  const arc = hits.filter(h => h.location === 'archive');
  let html = '';
  if (main.length){
    if (arc.length) html += `<div class="search-section-label">主面板 · ${main.length}</div>`;
    html += main.slice(0, 30).map(h => searchRowHtml(h, q)).join('');
  }
  if (arc.length){
    html += `<div class="search-section-label">封存區 · ${arc.length}</div>`;
    html += arc.slice(0, 20).map(h => searchRowHtml(h, q)).join('');
  }
  wrap.innerHTML = html;
  $$('.search-row').forEach(row => {
    row.addEventListener('mousedown', e => {
      e.preventDefault();
      const url = row.dataset.url;
      if (url && url !== '#') {
        try { window.open(url, '_blank'); } catch(_){}
      }
      $('#searchPop').classList.remove('open');
      $('#searchInput').blur();
    });
  });
}

function highlightHtml(text, q){
  if (!q || !text) return escapeHtml(text || '');
  const safe = escapeHtml(text);
  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(safeQ, 'gi'), m => `<mark>${m}</mark>`);
}

function searchRowHtml(hit, q){
  const {link, cat, group, section, tab, location} = hit;
  const meta = location === 'main'
    ? `${section.name} · ${cat.title} · ${group.name}`
    : `📦 ${tab.name} · ${cat.title}`;
  const ico = renderIcon(link.icon || cat.icon, link.iconType || cat.iconType);
  return `<div class="search-row" data-url="${escapeHtml(link.url || '#')}">
    <div class="ico" style="background:${cat.tint || 'var(--bg-2)'}; color:${cat.color || 'inherit'};">${ico}</div>
    <div class="info">
      <div class="ttl">${highlightHtml(link.title, q)}</div>
      <div class="meta">${highlightHtml(meta, q)}</div>
    </div>
  </div>`;
}
