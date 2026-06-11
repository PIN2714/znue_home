/* data.js
   預設書籤資料 + 健康資料(初次載入用)
   - DATA: 主面板 sections + archive 結構
   - HEALTH_DATA: 健康儀表板的範例資料
   Stage 2 加入 storage.js 後,DATA 會被 bookmarks.json 的內容取代;
   這裡保留作為「從零建立 bookmarks.json」時的種子。 */

const DATA = {
  sections: [
    {
      id: "daily", name: "每日必開", hint: "Daily essentials",
      categories: [
        { id:"claude", title:"Claude", icon:"✦", iconType:"text", tint:"#fde8d4", color:"#c2410c", size:"large",
          quickLinks:[{title:"Chat",url:"https://claude.ai"},{title:"Projects",url:"#"},{title:"Console",url:"#"}],
          groups:[{name:"主要", memo:"Anthropic 出品 · *日常思考與寫作的主力*", links:[
            {id:"l1", title:"Claude.ai", url:"https://claude.ai", icon:"✦", iconType:"text",
             memo:"長文、思考、寫作。**最常用**。", clicks:312, pinned:true},
            {id:"l2", title:"Claude Projects", url:"#", icon:"📁", iconType:"emoji", clicks:88,
             memo:"放長期的工作 context"},
            {id:"l3", title:"Claude Code", url:"#", icon:"⌘", iconType:"text",
             memo:"終端 agent。\n\n**安裝**: `npm install -g @anthropic-ai/claude-code`\n\n登入後直接在專案資料夾用 `claude` 指令。\n\n比 IDE 整合更輕巧,適合腳本任務。", clicks:19, memoPinned: true},
          ]}]},
        { id:"notion", title:"Notion", icon:"N", iconType:"text", tint:"#e8e8e8", color:"#1a1a1a", size:"large",
          quickLinks:[{title:"個人主頁",url:"#"},{title:"讀書筆記",url:"#"},{title:"專案追蹤",url:"#"}],
          groups:[{name:"工作區", memo:"我的個人 wiki 系統,所有東西都在這裡", links:[
            {id:"l4", title:"個人主頁", url:"#", icon:"🏠", iconType:"emoji", memo:"wiki 入口", clicks:88, pinned:true},
            {id:"l5", title:"讀書筆記", url:"#", icon:"📚", iconType:"emoji", clicks:41,
             memo:"> 一週至少更新一次\n\n讀完的書放這裡,有完整心得。"},
          ]}]},
        { id:"ticktick", title:"Ticktick", icon:"✓", iconType:"text", tint:"#dbeafe", color:"#1e40af", size:"large",
          quickLinks:[{title:"今日任務",url:"#"},{title:"本週",url:"#"}],
          groups:[{name:"官方", links:[
            {id:"l6", title:"Ticktick Web", url:"#", icon:"✓", iconType:"text", memo:"主要任務管理", clicks:142, pinned:true},
          ]}]},
      ]
    },
    {
      id: "tools", name: "工具", hint: "Workbench",
      categories: [
        { id:"local-folders", title:"本機資料夾", icon:"📁", iconType:"emoji", tint:"#ede9fe", color:"#7c3aed", size:"medium",
          groups:[{name:"常用", memo:"本機路徑 · 點 📋 複製,或裝 *Local Explorer* 擴充功能直接跳轉", links:[
            {id:"local1", title:"下載資料夾", url:"file:///D:/Downloads/", icon:"📥", iconType:"emoji",
             memo:"`Ctrl+J` 也可以打開瀏覽器下載清單", clicks: 32},
            {id:"local2", title:"工作專案", url:"file:///D:/Documents/Projects/", icon:"💼", iconType:"emoji", clicks: 56},
            {id:"local3", title:"備份硬碟", url:"file:///E:/Backup/", icon:"💾", iconType:"emoji", clicks: 12},
          ]}]},
        { id:"ai-text", title:"AI 文字工具", icon:"🤖", iconType:"emoji", tint:"#dbeafe", color:"#1e40af", size:"medium",
          groups:[
            {name:"對話", memo:"日常對話 AI · 各有所長", links:[
              {id:"l7", title:"ChatGPT", url:"#", icon:"💬", iconType:"emoji", clicks:178, pinned:true,
               memo:"GPT-4o · 多模態強,但回答偏簡略"},
              {id:"l8", title:"Gemini", url:"#", icon:"♊", iconType:"text", clicks:56,
               memo:"免費版有 1M context,適合塞長文"},
            ]},
            {name:"搜尋", memo:"AI 加持的搜尋工具", links:[
              {id:"l9", title:"Perplexity", url:"#", icon:"🔍", iconType:"emoji",
               memo:"**查資料用**\n- 引用清楚\n- 適合做研究\n- Pro 版有 Claude 模型可選", clicks:88},
            ]},
          ]},
        { id:"web-tools", title:"網頁工具", icon:"⚙", iconType:"text", tint:"#dcfce7", color:"#15803d", size:"medium",
          groups:[{name:"轉換", memo:"零碎的小工具", links:[
            {id:"l10", title:"短網址", url:"#", icon:"🔗", iconType:"emoji", clicks:19},
            {id:"l11", title:"Markdown 表格", url:"#", icon:"📊", iconType:"emoji", clicks:28,
             memo:"貼到 Notion 用"},
          ]}]},
      ]
    },
    {
      id: "occasional", name: "偶爾", hint: "Occasional",
      categories: [
        { id:"travel", title:"松山機場", icon:"✈", iconType:"text", tint:"#cffafe", color:"#0e7490", size:"small",
          groups:[{name:"航班", links:[{id:"l12", title:"即時航班", url:"#", icon:"✈", iconType:"text", clicks:14}]}]},
        { id:"beauty", title:"顏值鑑定", icon:"☻", iconType:"text", tint:"#fef3c7", color:"#a16207", size:"small",
          groups:[{name:"玩耍", memo:"無聊時的小遊戲", links:[{id:"l13", title:"小冰", url:"#", icon:"☻", iconType:"text"}]}]},
      ]
    }
  ],
  archive: {
    activeTabId: "completed",
    lastUsedTabId: "completed",
    tabs: [
      {
        id: "completed", name: "已完成 / 結案",
        sections: [
          {
            id: "arc-projects", name: "舊專案",
            categories: [
              { id:"arc-cat1", title:"2024 部落格改版", icon:"📝", iconType:"emoji", tint:"#fde8d4", color:"#c2410c", size:"medium",
                groups:[{name:"主要", memo:"已上線,連結保留供日後參考", links:[
                  {id:"al1", title:"設計稿", url:"#", icon:"🎨", iconType:"emoji", memo:"Figma 連結"},
                  {id:"al2", title:"上線版", url:"#", icon:"🌐", iconType:"emoji"},
                ]}]
              },
            ]
          }
        ]
      },
      {
        id: "rare", name: "很少用",
        sections: [
          {
            id: "arc-tools", name: "備忘工具",
            categories: [
              { id:"arc-cat2", title:"報稅相關", icon:"📋", iconType:"emoji", tint:"#dcfce7", color:"#15803d", size:"medium",
                groups:[{name:"主要", memo:"每年五月才會用一次", links:[
                  {id:"al3", title:"財政部", url:"#", icon:"🏛", iconType:"emoji"},
                  {id:"al4", title:"健保署", url:"#", icon:"🏥", iconType:"emoji"},
                ]}]
              },
            ]
          }
        ]
      },
      {
        id: "season", name: "季節性",
        sections: [
          {
            id: "arc-seasonal", name: "節慶",
            categories: [
              { id:"arc-cat3", title:"年末禮物清單", icon:"🎁", iconType:"emoji", tint:"#fce7f3", color:"#be185d", size:"small",
                groups:[{name:"主要", links:[]}]
              },
            ]
          }
        ]
      }
    ]
  }
};

const HEALTH_DATA = {
  goals: { calories: 1850, protein_g: 130, weight_kg: 70.95 },
  records: [
    { date: "2026-04-28", data: { weight_kg: 73.8, body_fat_percent: 22.4, score: 78, bmi: 25.1 }},
    { date: "2026-04-30", data: { weight_kg: 73.5, body_fat_percent: 22.1, score: 79, bmi: 25.0 }},
    { date: "2026-05-02", data: { weight_kg: 73.3, body_fat_percent: 21.9, score: 80, bmi: 24.9 }},
    { date: "2026-05-04", data: { weight_kg: 73.1, body_fat_percent: 21.7, score: 81, bmi: 24.8 }},
    { date: "2026-05-06", data: { weight_kg: 72.8, body_fat_percent: 21.4, score: 82, bmi: 24.7 }},
    { date: "2026-05-07", data: { weight_kg: 72.6, body_fat_percent: 21.2, score: 83, bmi: 24.6, muscle_kg: 31.2, water_percent: 56.4 }},
  ],
  meals_today: [
    { time: "08:30", name: "早餐 · 燕麥+希臘優格", total: { kcal: 380, protein_g: 22, carbs_g: 48, fat_g: 9 }},
    { time: "12:45", name: "午餐 · 雞胸肉沙拉", total: { kcal: 520, protein_g: 42, carbs_g: 32, fat_g: 18 }},
    { time: "15:00", name: "點心 · 香蕉+杏仁", total: { kcal: 220, protein_g: 6, carbs_g: 28, fat_g: 11 }},
  ],
  activity_today: { steps: 8420, calories_burned: 412, active_minutes: 38, sleep_hours: 7.2 }
};
