# GooseOffice 動作對應規格書

> **目的**：定義 MobileGoose 的 Goose JSONL 事件如何映射為 pixel-agents 像素角色的動畫、動線與場景互動。
> 本文件同時作為給 pixel-agents-webview（前端改造）和 MobileGoose（事件產出端改造）的需求規格。

---

## 1. 現狀分析

### 1.1 事件來源

MobileGoose 透過 `goose-log-wrapper.py` 攔截 Goose 的 stdout，解析為 JSONL 事件寫入
`.runtime/sessions/goose-events-<testrun>.jsonl`。

pixel-agents-webview 的 `gooseWatcher.ts` 監控該目錄，透過 WebSocket 推送到前端。
`eventTranslator.ts` 將 GooseEvent 轉譯為 webview 訊息。

### 1.2 目前 Goose 實際使用的工具

從真實測試紀錄（rounds/round2、batch2、batch3）分析，Goose agent 只使用 **2 種原生工具**：

| Goose toolName | extension | 說明 |
|---|---|---|
| `shell` | `developer` | **所有操作**都透過 shell 執行（ADB、DroidRun、報告工具等） |
| `todo_write` | `todo` | 更新測試進度檢查清單 |

### 1.3 問題

`eventTranslator.ts` 的 `buildToolStatus()` 只做 `toolName → 顯示名` 映射：
- `shell` → `Bash`（typing 動畫）
- `todo_write` → `Write`（typing 動畫）

結果：**所有 shell 指令都顯示為「打字」動畫**，無法區分偵測裝置、讀取測試案例、操控手機、截圖等不同語意。

---

## 2. Shell 指令語意分類

從 216 筆不重複的 DroidRun 指令、以及全部測試 JSONL 分析，shell command 可用關鍵字歸類為以下語意類別：

### 2.1 指令 → 動作對應表

| 語意類別 | command 關鍵字（優先序由上而下） | 角色動畫 | 狀態面板文字 | 備註 |
|---|---|---|---|---|
| **DroidRun 操控** | `run-droidrun.py` | typing + **spawn sub-agent** | `DroidRun: {goal}` | 觸發 Matrix 特效產生 sub-agent |
| **截圖存證** | `goose-report-tools.py screenshot` | reading（舉目觀察） | `截圖: {label}` | 未來可新增閃光特效 |
| **報告初始化** | `goose-report-tools.py init` | typing | `初始化報告: {testrun}` | |
| **報告撰寫** | `goose-report-tools.py report` | typing | `撰寫測試報告` | |
| **報告定稿** | `goose-report-tools.py finalize` | typing | `定稿報告: {testrun}` | |
| **Logcat 收集** | `goose-report-tools.py logcat` | reading | `收集裝置日誌` | |
| **讀取測試案例** | `type sample-testcases` | reading | `讀取案例: {ID}` | Windows `type` = `cat` |
| **裝置偵測** | `adb devices` | reading | `偵測裝置連線` | |
| **查詢裝置屬性** | `adb shell getprop` | reading | `查詢裝置屬性` | 165 次出現 |
| **查詢系統設定** | `adb shell settings get` | reading | `檢查系統設定` | 281 次 |
| **查詢套件資訊** | `adb shell dumpsys`, `adb shell pm` | reading | `查詢系統狀態` | 262 次 |
| **UI 操作** | `adb shell input` | typing | `裝置 UI 操作` | 直接按鍵/滑動 |
| **啟動 App** | `adb shell am start`, `adb shell monkey` | typing | `啟動應用程式` | |
| **拉取檔案** | `adb pull` | reading | `拉取檔案` | |
| **螢幕截圖** | `adb shell screencap` | reading | `裝置截圖` | |
| **進度記錄** | （toolName = `todo_write`） | typing | `更新進度清單` | 非 shell |
| **其餘 shell** | （以上皆不匹配） | typing | `Bash: {command 前 80 字}` | 維持現狀 |

### 2.2 動畫類型定義

| 動畫名稱 | 說明 | 角色行為 |
|---|---|---|
| **typing** | 坐在工位、雙手敲鍵盤 | 2 幀循環，面對桌面 |
| **reading** | 坐在工位、低頭看螢幕/文件 | 2 幀循環，面對桌面 |
| **walk** | 走路前往目標格子 | 4 幀循環，BFS 路徑 |
| **idle** | 站立不動（閒晃間的暫停） | 靜止 standing pose |
| **report** | 站在主管桌前匯報 | standing pose，面對主管 |
| **spawn** | Matrix 數位雨掃描出現 | 0.3s 綠光效果 |
| **despawn** | Matrix 數位雨消散 | 0.3s 綠光效果 |

---

## 3. 動線行為設計

### 3.1 完整測試流程動線

```
session_start
  ├─ 角色激活（isActive = true）
  ├─ 走向主管桌 → 站立 report（等待指派）
  └─ 走回自己工位 → 坐下
  
tool_start (shell: type sample-testcases/...)
  └─ reading 動畫：「讀取案例」

tool_start (shell: goose-report-tools.py init ...)
  └─ typing 動畫：「初始化報告」

tool_start (shell: adb devices / getprop / settings get ...)
  └─ reading 動畫：「偵測裝置」/「查詢屬性」

tool_start (shell: run-droidrun.py "...")
  ├─ 父角色：typing 動畫
  └─ spawn sub-agent（DroidRun 機器人）
      ├─ droidrun_plan   → Matrix spawn 特效
      ├─ droidrun_action → 狀態文字更新「Step N/M: ...」
      └─ droidrun_result → Matrix despawn + 父角色氣泡 ✓/⚠

tool_start (shell: goose-report-tools.py screenshot ...)
  └─ reading 動畫：「截圖」+ 可選閃光特效

tool_start (shell: goose-report-tools.py finalize ...)
  └─ typing 動畫：「定稿報告」

session_end
  ├─ 走向主管桌 → 站立 report（匯報結果）
  ├─ 走到休息區 → 坐沙發
  └─ idle 閒晃模式
```

### 3.2 氣泡類型擴展

| 氣泡 | 觸發條件 | 持續時間 |
|---|---|---|
| `...`（琥珀色圓點） | 等待使用者許可 | 持續到點擊/清除 |
| ✓（綠色勾勾） | 回合完成 / DroidRun 成功 | 2 秒 auto-fade |
| ⚠（黃色警告） | DroidRun 失敗 | 持續到點擊/清除 |
| 📱（手機圖示） | DroidRun 操控中（父角色） | 持續到 tool_end |
| 💤（睡眠） | 長時間 idle（可選） | 持續到激活 |

---

## 4. 家具與設備擴展

### 4.1 測試場景相關新家具提案

根據 MobileGoose 測試情境（86 個 sample-testcases，涵蓋 Settings、Google Apps、Camera、Battery、Wallpaper、Keyboard 等），建議新增以下場景家具：

| 家具名稱 | 尺寸 (px) | footprint | 動態 | 用途 |
|---|---|---|---|---|
| **PHONE_DOCK**（手機座） | 16×32 | 1×2 | on/off：亮屏/暗屏 | Tester 工位旁，DroidRun 操控時亮屏 |
| **SERVER_RACK**（伺服器機櫃） | 16×48 | 1×3 | on/off：閃爍 LED 燈號 | 測試實驗室裝飾 |
| **DASHBOARD**（大螢幕看板） | 48×32 | 3×2 | on/off：顯示數據/關閉 | 分析室牆上，Analyst 使用時亮起 |
| **PRINTER**（印表機） | 32×32 | 2×2 | on/off：列印動畫（紙張滑出） | 報告定稿時自動 ON |
| **COFFEE_MACHINE**（咖啡機） | 16×32 | 1×2 | on/off：冒蒸氣動畫 | 休息吧裝飾 |
| **VENDING_MACHINE**（自動販賣機） | 16×48 | 1×3 | 靜態（發光面板） | 休息吧裝飾 |
| **WATER_COOLER**（飲水機） | 16×32 | 1×2 | 靜態 | 休息吧 |
| **MEETING_TABLE**（會議桌） | 48×32 | 3×2 | 靜態 | 主管辦公室 |
| **PROJECTOR_SCREEN**（投影幕） | 48×16 | 3×1 | on/off | 牆上，canPlaceOnWalls |
| **CABLE_TRAY**（線材架） | 16×16 | 1×1 | 靜態 | 測試實驗室細節 |
| **ANDROID_FIGURINE**（Android 公仔） | 16×16 | 1×1 | 靜態，canPlaceOnSurfaces | 桌面裝飾 |

### 4.2 Auto-State 連動設計

現有的 `officeState.rebuildFurnitureInstances()` 已支援「agent 坐在工位面前的電子設備自動 ON」。擴展規則：

| 家具 | 自動開啟條件 | 自動關閉條件 |
|---|---|---|
| PC | agent 坐在面對的工位且 isActive | agent 離開或 idle |
| PHONE_DOCK | agent 的 currentTool 包含 DroidRun 相關指令 | DroidRun 結束 |
| DASHBOARD | Analyst agent isActive | Analyst idle |
| PRINTER | 任何 agent 觸發 `goose-report-tools.py finalize` | 動畫播放完畢 |

### 4.3 家具製作流程

本專案有完整的素材管線，製作新家具的步驟：

#### 方法 A：手動創建（最直接）

1. **繪製像素圖**：用任何像素畫工具（Aseprite、Piskel、Photoshop 等），遵循 16px 格線
   - 靜態家具：一張 PNG（如 `PHONE_DOCK.png`）
   - 多方向：front/back/side 各一張（如 `PHONE_DOCK_FRONT.png`、`PHONE_DOCK_SIDE.png`）
   - 動態（on/off + 動畫）：每個 state × 每幀一張（如 PC 的 `PC_FRONT_ON_1.png`、`PC_FRONT_ON_2.png`、`PC_FRONT_ON_3.png`、`PC_FRONT_OFF.png`）

2. **建立目錄結構**：
   ```
   webview-ui/public/assets/furniture/PHONE_DOCK/
     ├── PHONE_DOCK_FRONT_OFF.png    (16×32)
     ├── PHONE_DOCK_FRONT_ON_1.png   (16×32, 亮屏幀 1)
     ├── PHONE_DOCK_FRONT_ON_2.png   (16×32, 亮屏幀 2)
     └── manifest.json
   ```

3. **撰寫 manifest.json**（參考 PC 的結構）：
   ```json
   {
     "id": "PHONE_DOCK",
     "name": "Phone Dock",
     "category": "electronics",
     "type": "group",
     "groupType": "state",
     "canPlaceOnWalls": false,
     "canPlaceOnSurfaces": true,
     "backgroundTiles": 0,
     "members": [
       {
         "type": "group",
         "groupType": "animation",
         "state": "on",
         "members": [
           { "type": "asset", "id": "PHONE_DOCK_FRONT_ON_1", "file": "PHONE_DOCK_FRONT_ON_1.png", "width": 16, "height": 32, "footprintW": 1, "footprintH": 2, "frame": 0 },
           { "type": "asset", "id": "PHONE_DOCK_FRONT_ON_2", "file": "PHONE_DOCK_FRONT_ON_2.png", "width": 16, "height": 32, "footprintW": 1, "footprintH": 2, "frame": 1 }
         ]
       },
       { "type": "asset", "id": "PHONE_DOCK_FRONT_OFF", "file": "PHONE_DOCK_FRONT_OFF.png", "width": 16, "height": 32, "footprintW": 1, "footprintH": 2, "state": "off" }
     ]
   }
   ```

4. **放入佈局**：用內建 Layout Editor 或直接編輯 `default-layout-2.json`

5. **重建**：`cd webview-ui && npm run dev` 即可在瀏覽器看到效果

#### 方法 B：使用 Asset Manager 工具

開啟 `scripts/asset-manager.html`（瀏覽器內的素材編輯器），可以：
- 匯入 tileset PNG，自動偵測個別素材邊界
- 視覺化設定 footprint、backgroundTiles、canPlaceOnSurfaces 等屬性
- 匯出為 PNG + manifest.json

#### 像素圖規格

| 屬性 | 規格 |
|---|---|
| 格線單位 | 16×16 px per tile |
| 色彩 | RGBA，alpha < 2 視為透明 |
| 半透明 | 支援 `#RRGGBBAA` 格式 |
| 動畫 | 每幀一張獨立 PNG，在 manifest 中以 frame: 0/1/2... 標記 |
| 命名慣例 | `{BASE}[_{ORIENTATION}][_{STATE}][_{FRAME}].png` |
| 方向 | front、back、side（side 可 mirrorSide 鏡射為另一側） |
| 狀態 | on、off |

---

## 5. 給 MobileGoose (Goose 端) 的修改需求

### 5.1 問題：DroidRun 事件未產出

目前 `goose-log-wrapper.py` 理論上支援解析 DroidRun 的 stdout banner（`DroidRun Started`、`--- Step N/M ---` 等），但從真實 JSONL 中未觀察到任何 `droidrun_plan/action/result` 事件。

**可能原因**：`run-droidrun.py` 作為 subprocess 執行時，DroidRun 的 stdout 可能被 Goose 的 `shell` tool 吃掉了，沒有轉發到 wrapper 的 stdout。

**需求 G-1**：確認並修復 DroidRun banner → JSONL 事件的管線。確保以下事件能正確產出：
- `droidrun_plan`（含 `goal` 和 `parentToolId`）
- `droidrun_action`（含 `step`、`maxSteps`、`think`、`decision`）
- `droidrun_result`（含 `success`、`message`、`totalSteps`）

### 5.2 需求：豐富化 tool_args 事件

目前 shell 的 `tool_args` 只發一次 `key: "command"`。為了讓前端更精確分類，建議：

**需求 G-2**（可選，低優先）：在 `goose-log-wrapper.py` 新增語意標籤。

在 `tool_args` 事件中加入額外的 `semantic` 欄位：

```json
{
  "type": "tool_args",
  "toolId": "t10",
  "key": "command",
  "value": "python run-droidrun.py \"Open Settings app\"",
  "semantic": "droidrun"
}
```

語意標籤對照：

| command 匹配規則 | semantic 值 |
|---|---|
| 包含 `run-droidrun.py` | `droidrun` |
| 包含 `goose-report-tools.py screenshot` | `screenshot` |
| 包含 `goose-report-tools.py init` | `report_init` |
| 包含 `goose-report-tools.py finalize` | `report_finalize` |
| 包含 `goose-report-tools.py report` | `report_write` |
| 包含 `goose-report-tools.py logcat` | `logcat` |
| 包含 `type sample-testcases` | `read_testcase` |
| 包含 `adb devices` | `device_detect` |
| 包含 `adb shell getprop` | `device_query` |
| 包含 `adb shell settings` | `device_query` |
| 包含 `adb shell dumpsys` 或 `adb shell pm` | `device_query` |
| 包含 `adb shell input` 或 `adb shell am` | `device_control` |
| 包含 `adb pull` 或 `adb shell screencap` | `device_capture` |
| 其餘 | `shell`（不加或省略） |

> **注意**：即使 G-2 不實作，前端仍可從 `command` 值自行解析關鍵字（見第 6 節）。G-2 只是讓前端更乾淨。

### 5.3 需求：session_end 攜帶結果摘要

**需求 G-3**（中優先）：`session_end` 事件增加測試結果摘要。

```json
{
  "type": "session_end",
  "reason": "completed",
  "result": "pass",
  "summary": "7/7 步驟通過",
  "ts": "..."
}
```

這樣前端可以在角色匯報動線時，顯示對應的結果氣泡（✓ pass / ⚠ fail）。

---

## 6. 給 pixel-agents-webview (前端) 的修改需求

### 6.1 eventTranslator.ts — Shell 指令語意解析

改造 `buildToolStatusWithArgs()` 方法（目前位於 `server/eventTranslator.ts:199-209`）。

當收到 `tool_args` 且 `key === "command"` 時，依照 §2.1 的關鍵字優先序匹配，產出對應的 status 文字。

**關鍵邏輯**：當 command 包含 `run-droidrun.py` 時，應產出帶 `Subtask:` 前綴的 status，觸發 sub-agent spawn（現有的 `useExtensionMessages.ts` 已支援此前綴）。

```typescript
// 偽碼
if (command.includes('run-droidrun.py')) {
  const goal = command.match(/"([^"]+)"/)?.[1] ?? 'DroidRun';
  return `Subtask:DroidRun — ${goal}`;
}
if (command.includes('goose-report-tools.py screenshot')) {
  return `Read: 截圖 ${extractLabel(command)}`;  // → reading 動畫
}
if (command.includes('goose-report-tools.py init')) {
  return `Write: 初始化報告`;  // → typing 動畫
}
// ... 依照 §2.1 表格繼續
```

### 6.2 officeState.ts — Auto-State 擴展

為 PHONE_DOCK 家具新增條件判斷：當 agent 的 `currentTool` status 包含 `DroidRun` 時，將面前的 PHONE_DOCK 切換為 ON。

### 6.3 agentProfiles.ts — session_end 匯報動線

在 `setAgentActive(false)` 時，如果 session 有結果摘要，先推 `report` behavior 到隊列，再推 `rest`：

```
behaviorQueue: [
  { tile: 主管桌旁, facingDir: 面向主管, action: 'report' },
  { seatId: restSeat, action: 'rest' }
]
```

### 6.4 氣泡系統擴展

在 `spriteData.ts` 新增氣泡 sprite：
- ⚠ 警告氣泡（DroidRun 失敗）
- 📱 手機氣泡（DroidRun 操控中）

---

## 7. 實作優先序

| 優先級 | 項目 | 影響範圍 | 依賴 |
|---|---|---|---|
| **P0** | eventTranslator shell 語意解析 (§6.1) | 前端 | 無 |
| **P0** | 確認 DroidRun 事件管線 (§5.1) | MobileGoose | 需要跑真實測試驗證 |
| **P1** | PHONE_DOCK 家具 + Auto-State (§4, §6.2) | 前端 | 素材繪製 |
| **P1** | session_end 匯報動線 (§6.3) | 前端 | §5.3（可先硬編碼） |
| **P2** | 新家具素材繪製（SERVER_RACK、DASHBOARD 等） | 素材 | 無 |
| **P2** | 氣泡系統擴展 (§6.4) | 前端 | 素材繪製 |
| **P3** | semantic 標籤 (§5.2) | MobileGoose | 非必要，前端可自行解析 |
| **P3** | 截圖閃光特效 | 前端 | 新特效系統 |

---

## 附錄 A：真實事件流範例

以下為 STTL-182451（Touch & hold delay 測試）的真實事件流，標註對應的角色動作：

```
session_start (gpt-4.1)              → 角色激活，走向主管桌報告
shell: adb devices                   → reading「偵測裝置」
shell: adb shell getprop model       → reading「查詢裝置型號」
shell: adb shell settings get ...    → reading「檢查系統設定」
shell: goose-report-tools.py init    → typing「初始化報告」
shell: type sample-testcases/...     → reading「讀取測試案例」
shell: adb shell input keyevent 3    → typing「裝置 UI 操作」
shell: adb shell settings get ...    → reading「檢查無障礙服務」
shell: goose-report-tools.py screenshot → reading「截圖: precondition」
shell: run-droidrun.py "Open Settings" → typing + spawn DroidRun sub-agent
  (droidrun_plan → action 1..N → droidrun_result)
shell: run-droidrun.py "Scroll to..." → typing + spawn DroidRun sub-agent
  ... (重複 8 次 DroidRun 操作)
shell: goose-report-tools.py screenshot → reading「截圖: step8_restore」
shell: goose-report-tools.py logcat  → reading「收集日誌」
todo_write                           → typing「更新進度清單」
session_end                          → 走向主管桌報告 → 休息區
```

## 附錄 B：ADB 指令統計（全部測試紀錄）

| ADB 子指令 | 出現次數 | 語意歸類 |
|---|---|---|
| `adb shell settings` | 281 | 查詢（reading） |
| `adb shell getprop` | 159 | 查詢（reading） |
| `adb shell pm` | 144 | 查詢（reading） |
| `adb shell input` | 121 | UI 操控（typing） |
| `adb shell dumpsys` | 118 | 查詢（reading） |
| `adb shell am` | 104 | 啟動 App（typing） |
| `adb shell ls` | 32 | 查詢（reading） |
| `adb shell monkey` | 13 | 壓力測試（typing） |
| `adb shell ip` | 6 | 網路查詢（reading） |
| `adb shell ime` | 6 | 輸入法查詢（reading） |
| `adb pull` | 4 | 拉取檔案（reading） |
| `adb shell screencap` | 3 | 截圖（reading） |

## 附錄 C：測試案例分類統計

| 類別 | 案例數 |
|---|---|
| Basic OS Settings | 40 |
| Basic OS Google Apps | 20 |
| ZVA Enterprise Wallpaper | 5 |
| ZVA Hard Keys | 4 |
| ZVA Keypad Sound/Backlight | 4 |
| SIP (Soft Input Panel) | 3 |
| Power / Battery | 4 |
| Multiuser | 2 |
| Browser / Chrome | 1 |
| Media | 1 |
| Enterprise Device Owner | 1 |
| Green Mode | 1 |

## 附錄 D：DroidRun 操控目標範例（216 筆去重）

以下列出代表性的 DroidRun 指令，展示操控範圍：

**系統導航**
- `Go to home screen`
- `Launch Settings app`
- `Go to Display in Settings`
- `Navigate back to Settings main menu`

**設定操作**
- `Enable Auto-rotate screen in Accessibility`
- `Find and toggle Strict mode enabled in Developer options`
- `Select Short in Touch & hold delay dialog`

**App 操作**
- `Launch Camera app`
- `Open Chrome and navigate to www.zebra.com`
- `Open Play Store and search for Swiftkey`

**裝置互動**
- `Take a photo with rear camera`
- `Rotate device to landscape orientation`
- `Long press on home screen to open wallpaper options`
- `Change wallpaper by selecting a picture with distinctly different color`
- `Enter wrong PIN`
- `Expand notification bar`
