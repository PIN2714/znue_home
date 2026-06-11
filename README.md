# znue_home

個人化的瀏覽器起始頁,本機 JSON 持久化(File System Access API),可裝為桌面/手機 PWA。

> 給兩個月後的我自己:這個專案的所有事情都記在這份檔案。從這裡開始讀。

---

## 是什麼

取代 Google Sites 書籤頁的本機方案。書籤分「區段 → 卡片 → 群組 → 連結」四層,hover 卡片彈出連結 panel,搭配健康狀態列(讀同份本機 `health-ledger.json`)。資料完全本機,不送雲端。

UI 主軸:序文字型(Fraunces / Source Han Serif TC)、可切換 6 套主題、編輯模式可拖曳排序、icon 支援 emoji/符號/1-4 字文字/上傳圖片。

---

## 怎麼啟動

三種跑法:

### A. 雙擊 index.html
從檔案總管直接開。**僅供快速預覽**,因為:
- File System Access API 需要 secure context,`file://` 上某些行為怪
- Service Worker 不會註冊(離線跟 PWA 安裝失效)

### B. localhost http server(推薦日常使用)
```bash
cd D:\Onedrive\OneSyncFiles\程式專用\znue_home
python -m http.server 8000
# 或 npx serve .
```
開 `http://localhost:8000`。所有功能正常,Service Worker 會註冊,瀏覽器網址列會出現「安裝」按鈕。

### C. 安裝成 PWA(最終形態)
B 開啟後 → 設定面板按「安裝為應用程式」按鈕,或瀏覽器網址列右邊的「+」/「安裝」icon。安裝完後桌面/工作列/手機主畫面會有獨立 icon,點開無瀏覽器 chrome,完整 standalone。

### D. Synology NAS 部署 ⭐ 任何裝置一個連結

把 znue_home 部署到 Synology NAS 上,實現「無論手機/平板/PC,輸入同一個 URL 就能用」。書籤存在 NAS 的 WebDAV 路徑,任何連上網路的裝置都能讀寫。

#### 1. 在 Synology 上安裝套件

前往 **套件中心** 安裝以下兩個：
- **Web Station** — 靜態網頁伺服器(用來服務 znue_home 靜態檔案)
- **WebDAV Server** — 讓 znue_home 透過 WebDAV 協定讀寫 `bookmarks.json`

#### 2. 部署靜態檔案

將整個 `znue_home/` 資料夾複製到 NAS 的 Web Station 根目錄：
```
/volume1/web/znue_home/
├── index.html
├── manifest.json
├── service-worker.js
├── css/ …
├── js/ …
└── assets/ …
```

Web Station → 新增虛擬主機或直接用預設 `http://nas-ip/znue_home/`。

#### 3. 設定 WebDAV Server

**套件中心 → WebDAV Server → 設定**：
- 啟用 HTTP(建議用 HTTPS / reverse proxy 加密,見步驟 5)
- 預設 port 5005(HTTP)/ 5006(HTTPS)

建立書籤存放資料夾，例如 `/volume1/homes/<username>/webdav/`，或任何你能用帳號存取的路徑。

#### 4. 設定 CORS(讓瀏覽器允許跨來源 PUT)

WebDAV Server 預設不允許跨來源 PUT。若 znue_home 網頁是從 `https://nas.example.com/znue_home/` 服務,而 WebDAV URL 也是同一個 origin，則**不需要額外設 CORS**(同 origin)。

若使用不同 port 或子域名，需在 Synology Control Panel → 應用程式入口 → Reverse Proxy 設定，讓兩者同 origin(推薦方案,見步驟 5)。

#### 5. DDNS + HTTPS + Reverse Proxy(推薦)

讓 NAS 可從外網存取：

1. **DDNS**：Control Panel → 外部存取 → DDNS → 新增 `your-name.synology.me`(免費)
2. **Let's Encrypt 憑證**：Security → 憑證 → 新增 → 讓加密 → 填 DDNS 網域
3. **Reverse Proxy**：Control Panel → 登入入口 → 進階 → Reverse Proxy → 新增：
   ```
   來源:  https://your-name.synology.me/webdav/*  (443 HTTPS)
   目標:  http://localhost:5005/                   (WebDAV HTTP port)
   ```
   這樣 znue_home 網頁(`https://your-name.synology.me/znue_home/`)和 WebDAV(`https://your-name.synology.me/webdav/`)都是同 origin，CORS 問題自動消失。

#### 6. 在 znue_home 設定 WebDAV 連線

1. 任何裝置開啟 `https://your-name.synology.me/znue_home/`
2. 看到 onboarding → 點「🌐 連接 Synology / WebDAV」
3. 填入：
   - **URL**：`https://your-name.synology.me/webdav/znue_bookmarks.json`
   - **帳號**：Synology 使用者帳號
   - **密碼**：Synology 使用者密碼
4. 點「測試連線」確認 ✓
5. 點「連線並載入」→ 第一次會自動在 NAS 上建立 `znue_bookmarks.json`
6. 完成!設定存在瀏覽器 IndexedDB,下次開啟自動連線

#### WebDAV 儲存機制說明

| 功能 | 說明 |
|------|------|
| **同步方式** | 每次改動 500ms 後 PUT 到 NAS |
| **並行控制** | ETag + If-Match 樂觀鎖(兩個分頁同時開→ 412 → 自動拉最新版) |
| **離線支援** | 書籤 JSON 快取在 IndexedDB,離線仍可讀;重新上線後自動推回 NAS |
| **認證** | HTTP Basic Auth,密碼存 IndexedDB(不送任何第三方服務) |
| **斷開連線** | 設定面板 → 儲存模式 → 「斷開 NAS」→ 清除設定 + 快取 |

---

## 第一次設定流程

1. 啟動後看到 onboarding overlay
2. 點「✨ 建立新的 bookmarks.json」→ 選存放位置(建議跟此專案同層,或 OneDrive 同步資料夾,方便手機共用)→ 命名(預設 `znue_bookmarks.json`)→ 完成
3. (可選)點「🩺 連結 health-ledger.json」→ 選 `health_pwa` 資料夾裡那份
4. 進主頁,按 ✎ 進編輯模式,開始建構

之後重新打開,IndexedDB 記住 file handle,自動載入。

---

## 平台支援

| 瀏覽器 | 支援程度 |
|--------|---------|
| Chrome / Edge / Brave / Opera 桌面版 | ✅ 完整 |
| Chrome / Edge Android | ✅ 完整 |
| Samsung Internet 17+ | ✅ 完整(用 OneDrive 同步開啟最順) |
| iOS Safari / Firefox | ⚠️ 唯讀模式(無 FSA API),但裝 PWA 仍可瀏覽 |

**唯讀模式**:看畫面、用 sample data,改動不持久化(沒 file handle 可寫)。Onboarding 永遠顯示「先進入瀏覽」skip 按鈕,任何瀏覽器都能逃離卡住的狀態。

---

## 操作筆記

### 鍵盤快捷鍵
| 按鍵 | 動作 |
|------|------|
| `/` | focus 搜尋框 |
| `E` | 切換編輯模式 |
| `Esc` | 關 modal / 收搜尋下拉 |
| 雙擊 | inline 改名(區段/群組/卡片標題/hero 文字,編輯模式下) |
| Enter | 完成 inline edit |
| Esc on edit | 取消 inline edit |

### 編輯模式
按 ✎ 或 `E` 進入。會出現:
- 卡片右上 ✎ → 編輯卡片(尺寸 / 區段 / 主題色 / 內容顯示 / icon)
- 群組標題旁 ✎ → 編輯群組(name / memo)
- 連結右側 ✎ → 編輯連結(URL / memo / 位置 / 快捷 toggle / 釘選 / 最愛)
- favicon 點一下 → 開 icon picker
- 拖曳手把:區段(拉標題 h2)/ 卡片(拖卡身)/ 群組(拉群組標題)/ 連結(拖整 row)/ 封存分頁

### 排序模式(設定面板「連結排序」)
- **手動**(預設)— 照拖曳的順序顯示
- **點擊次數** — 最常用優先
- **最近用** — 最新點擊優先
- 非手動模式下,連結拖曳自動禁用(因為 render 會用排序覆蓋)
- 顯式設為「⚡ 快捷連結」的 quickLinks 始終照指定順序顯示(不被排序動)

### 卡片內容顯示
編輯卡片 → 內容顯示 section:
- **模式**:`auto`(依設定預設) / `list`(條列文字) / `grid`(圖示排列)
- **行數**:auto(依 size) / 1-5
- **grid 每行 icon 數**:auto fit 寬度 / 2-6 個
- **同 row 自動升級**:medium/small 卡片若跟 large 同 row,自動套用 large layout 並顯示 quickLinks(沒設則 fallback 到 group 內所有連結)

### Icon 模式
4 種:
- **emoji** — 8 組分類常用 emoji
- **符號** — Unicode 符號(✦ ★ ✓ → ♥ 等)
- **文字**(1-4 字)— 2 字橫排,3 字「2-上-1-下」grid,4 字 2x2 grid。中文/英文都行
- **上傳** — 自動壓縮成 128×128 PNG base64 內嵌進 JSON

### 封存區
右側「封存」手把點開。內部:
- Tab 系統:可新增/排序/刪除分頁
- 卡片可 hover/click 開 panel(跟主面板一致)
- ✎ 按鈕開卡片編輯 modal
- ↺ 按鈕還原到主面板第一個 section
- 拖曳:卡片在 archive section 內排或跨 section 拖
- 跨 main/archive 移動:用編輯 modal 的「所屬區段」/「所屬卡片」select

### 設定面板(⚙ 按鈕)
- **資料檔案**:bookmarks.json / health-ledger.json 換檔/清除/啟用 toggle
- **預設卡片內容模式**:list / grid
- **連結排序**:manual / clicks / recent
- **健康頁完整紀錄連結**:健康 panel 的「完整紀錄 →」會跳到這個 URL
- **備份**:匯出 JSON / 從 JSON 匯入(災難恢復)
- **應用程式**:安裝為 PWA(若瀏覽器支援且尚未安裝)

### 主題(☀ 按鈕)
6 套:salmon(預設)/ forest / rain / lavender / sunlight / peach

「跟隨時間自動」開啟後每 15 分鐘檢查:
- 06-11:sunlight
- 11-13:salmon
- 13-16:lavender
- 16-19:peach
- 19-22:forest
- 22-06:rain

### Hero 文字
編輯模式下雙擊上方 brand 的 `home`、quote 的 `// 2026 ...`、或下方那行,inline 編輯。Enter 儲存,Esc 取消,空字串還原預設。

---

## 資料結構

### bookmarks.json schema

```jsonc
{
  "version": "1.0",
  "lastModified": "ISO timestamp",
  "settings": {
    "theme": "salmon",                  // 主題 key
    "autoTheme": false,                 // 是否跟隨時間
    "denseGrid": false,                 // grid-auto-flow: dense
    "healthBarEnabled": true,           // 健康狀態列開關
    "healthPageUrl": "../health_pwa/index.html",
    "defaultContentMode": "list",       // list / grid (auto 模式的預設)
    "sortMode": "manual",               // manual / clicks / recent
    "heroMark": "// 2026 ...",
    "heroQuote": "...",
    "brandText": "home"
  },
  "sections": [{
    "id": "daily",
    "name": "每日必開",
    "hint": "Daily essentials",
    "categories": [{
      "id": "claude",
      "title": "Claude",
      "icon": "✦",
      "iconType": "text",                // emoji / text / image
      "tint": "#fde8d4",                 // 卡片背景色
      "color": "#c2410c",                // icon 強調色
      "size": "large",                   // small / medium / large (grid span 2/3/4)
      "contentMode": "auto",             // auto / list / grid
      "contentRows": null,               // null = 依 size;或 1-5
      "gridCols": null,                  // null = auto fit;或 2-6
      "quickLinks": ["l1", "l2"],        // link.id 陣列(舊格式 [{title,url}] 也吃)
      "groups": [{
        "name": "主要",
        "memo": "支援 markdown",
        "links": [{
          "id": "l1",
          "title": "Claude.ai",
          "url": "https://claude.ai",    // file:/// 開頭也支援(本機路徑)
          "icon": "✦",
          "iconType": "text",
          "memo": "支援 **md**",
          "memoPinned": false,
          "pinned": false,                // ⭐ 加入最愛
          "clicks": 312,
          "lastClicked": "ISO timestamp"
        }]
      }]
    }]
  }],
  "archive": {
    "activeTabId": "completed",
    "lastUsedTabId": "completed",
    "tabs": [{
      "id": "completed",
      "name": "已完成 / 結案",
      "sections": [{
        "id": "...",
        "name": "...",
        "categories": [/* 同主面板格式 */]
      }]
    }]
  }
}
```

**Schema migration**:`storage.js` 的 `ensureDataShape()` 在每次載入後補預設值,所以舊版 JSON 載入新版 code 不會壞。新加欄位永遠用 `if (foo === undefined) foo = default;` pattern。

### health-ledger.json
跟 `health_pwa/` 共用同一份檔案。schema 不一樣 — `records[]` 是混合 type(`meal` / `weight` / `activity` / `exercise`)。`health.js` 的 `buildSummaryFromLedger(raw)` 做轉換:

- weight records → sparkline + 體重/體脂顯示
- meal records 取最新一天 → 餐點 + 熱量加總
- activity records 取最新一天 → 步數 / 睡眠 / 消耗 kcal
- `settings.{cal_goal, protein_goal, weight_goal}` → 目標

---

## 檔案結構

```
znue_home/
├── index.html              # 主頁面 markup + script tags
├── manifest.json           # PWA metadata
├── service-worker.js       # 離線快取(cache-first)
├── README.md               # ← 你在這
├── assets/
│   └── icon.svg            # PWA icon(可換成 PNG)
├── css/
│   ├── base.css            # reset、字型、:root 變數、預設主題(salmon)
│   ├── themes.css          # 5 套替代主題的 [data-theme] 覆寫
│   ├── layout.css          # topbar、sections、grid、health bar、hero、響應式
│   ├── components.css      # cards、panels、modals、icon picker、tip、文字 icon 縮放
│   ├── archive.css         # 封存面板 + arc-card hover/edit
│   └── onboarding.css      # 首次開啟 overlay + settings modal toggle row
└── js/
    ├── data.js             # 預設 sample DATA + HEALTH_DATA(seed)
    ├── state.js            # 全域 UI 狀態(編輯模式、釘選、archive 狀態...)
    ├── helpers.js          # $, $$, escapeHtml, uid, isLocalPath, normalizeLocalPath,
    │                         findCat/findCatAnywhere, sortLinks, iconAttrs, IS_TOUCH...
    ├── markdown.js         # mini md parser(bold/italic/code/list/quote/link)
    ├── webdav.js           # 極簡 WebDAV 客戶端(GET/PUT/HEAD + ETag 樂觀鎖 + timeout)
    ├── storage.js          # FSA + WebDAV + IndexedDB + onboarding + settings
    ├── theme.js            # 主題系統 + 自動切換
    ├── search.js           # 搜尋下拉 + 5 個 chip 過濾
    ├── render.js           # renderSections / renderCard / renderPanelFor / hover panel /
    │                         tagLargeRows / renderHero / inline edit
    ├── editing.js          # 編輯 modal(link/group/card)+ icon picker(4 種模式)
    ├── archive.js          # 封存面板 + tab 系統
    ├── health.js           # 健康狀態列 + buildSummaryFromLedger + hover panel
    ├── dnd.js              # SortableJS 整合(5 sortable 層級)
    └── main.js             # init() 進入點
```

JS 載入順序就是 `index.html` 底部 `<script>` 的順序,不能亂(後面的依賴前面的全域變數/函式)。

---

## 第三方依賴

- [SortableJS 1.15.2](https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/) — 拖曳排序;CDN 載入,SW 預先快取(離線可用)
- Google Fonts — Fraunces / Inter Tight / JetBrains Mono / Noto Sans TC;SW 動態快取

完全沒有 npm / build process / framework。任何 modern 瀏覽器直接吃。

---

## 維護筆記

### 我更新 code 後使用者要怎麼拿到新版?

**情境 1**:沒裝 PWA(直接用瀏覽器分頁開)
- F5 重整就生效

**情境 2**:裝了 PWA(SW 在管 cache)
- 我若**有**改 `service-worker.js`(尤其 bump 了 `CACHE_VERSION`)→ 重整即可
- 我若**沒**改 `service-worker.js`(只改 css/js)→ SW 還給舊 cache,要 hard refresh(Ctrl+Shift+R)
- **大更新後我會明確說「請 hard refresh」**

**dev 期建議**:F12 → Application → Service Workers → 勾「Update on reload」+「Bypass for network」

### 想替換 PWA icon
1. 編輯 `assets/icon.svg`(現在是橘底白色 italic z),或
2. 把自己設計的圖存成 `assets/icon-192.png` / `icon-512.png`
3. 改 `manifest.json` 的 `icons` 欄位指向新檔(type: `image/png`)
4. bump `CACHE_VERSION` 讓 SW 拉新檔

### 想加新的 settings 欄位
1. `storage.js` `ensureDataShape()` 加預設值(用 `if (foo === undefined) foo = default;`)
2. `index.html` 設定 modal 加 UI(可參考既有 toggle / picker pattern)
3. `storage.js` `bindStorageDom()` 加 event handler + `updateSettingsDisplay()` 補顯示邏輯
4. 對應的 render / behavior 模組加邏輯
5. 若會影響 schema,確認 migration 可吃舊 JSON

### Schema 演化原則
所有新加的 cat / link / settings 欄位用 `if (xxx === undefined) xxx = default;` 在 `ensureDataShape` 補,**不要** break 舊 JSON。

### 全域命名空間
所有 JS 模組用一般 `<script>` 載入,不是 ES module。所有 top-level `const` / `let` / `function` 在同一 global scope 共享。命名前綴慣例:
- `_` 開頭 = module-internal(雖然技術上仍是 global,但約定不外用)
- 大寫 const = 常數 / 設定(`THEME_NAMES`, `IS_TOUCH`, `IS_FSA_SUPPORTED`...)
- camelCase function = 一般函式

### 加新 sortable 層級
1. `dnd.js` 加 `setupXxxSortable()` 函式,用 `_makeSortable(el, options)` 建
2. 在對應的 render 函式結尾呼叫
3. 若需要編輯模式才啟用 → `disabled: !state.edit`
4. `setSortablesEnabled` 自動處理(因為用統一的 `_sortables` Set 追蹤)

---

## 已知限制

- **跨卡片拖曳連結**:不支援(設計決定 — 用編輯 modal 的「所屬卡片」select 移)
- **跨群組拖曳連結**:同卡片內可,跨卡片不可
- **`url='#'` 的 placeholder 連結**:`_isQuickLink` / `_setQuickLink` 不參與 url 比對(否則多個 placeholder 會互相誤判)
- **iOS Safari / Firefox**:無 FSA → 但可用 WebDAV(NAS)模式完整使用
- **WebDAV CORS**:若 NAS 網頁和 WebDAV 不同 origin,需設 Reverse Proxy 讓它們同 domain
- **密碼安全**:WebDAV 密碼存 IndexedDB(明文),建議只在個人裝置設定,且使用 Synology 的次要帳號
- **行動瀏覽器 file://**:基本上禁止,務必用 https / localhost / OneDrive 同步

---

## 設計取捨記錄

| 取捨 | 為什麼 |
|------|--------|
| 純 HTML/CSS/JS 無 build process | 可雙擊 index.html 立即跑,跨機器無依賴 |
| 不用 ES module | `file://` protocol 不允許 ES module,直接 `<script>` 都吃 |
| File System Access API + IndexedDB | 本機 JSON 是 source of truth,跨裝置靠 OneDrive/同步,不依賴雲端服務 |
| SortableJS CDN 不本地化 | 15KB 不值得自己 copy;SW 會預先快取確保離線可用 |
| 編輯模式禁用 hover panel | 編輯時 panel 跟著滑鼠跑會干擾精準點擊;改 click-to-open + click-outside-close |
| sample DATA 留在 data.js | 第一次「建立新的 bookmarks.json」會把 seed 寫入,新使用者有起步 |
| Schema 向後相容 | `ensureDataShape` 永遠補預設,讓我之後加新欄位不會破壞使用者既有 JSON |

---

## 改 bug / 想加 feature 時的順序

1. 先確認 schema 是否需要動,需要的話先在 `ensureDataShape` 加預設
2. 改 `data.js` 的 sample 補上新欄位(讓首次建立的檔案就有)
3. 改對應的 render 邏輯
4. 改編輯 UI(modal / settings)
5. 確認 `markDirty()` 在所有 mutation 點都有呼叫
6. 確認 `_refreshAfterEdit()` 跨 main/archive 都會 refresh
7. 確認手機版(用 DevTools mobile mode)也 work
8. bump `CACHE_VERSION`(若有改 css/js)

---

## 致謝

- prototype v6 設計來自 Claude(本起始頁的雛形 HTML)
- File System Access API 模式參考 health_pwa
- 字型 Fraunces / Inter Tight 來自 Google Fonts(SIL OFL 授權)
