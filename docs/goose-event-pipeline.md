# Goose ↔ GooseOffice 事件管線規格

> **定位**：本文件是 MobileGoose（事件產出端）與 pixel-agents-webview（GooseOffice 前端）之間的**唯一**對接規格。
>
> - **MobileGoose 側** 請閱讀：§2 架構、§3 檔案位置、§4 Event 格式、§5 stdout 解析對照、§11 MobileGoose 需求
> - **pixel-agents-webview 側** 請閱讀：§4 Event 格式、§6 Shell 指令語意、§7 動線行為、§8 前端對接、§9 家具擴展
>
> 先前分散在 `pixel-agents-webview/docs/goose-action-mapping-spec.md` 與 `MobileGoose/docs/gooseoffice-event-stream.md` 的內容，已於 2026-04-13 統一至此份。

---

## 1. 目的

讓 GooseOffice（pixel-agents-webview）能即時以像素角色動畫顯示 Goose + DroidRun 的工作狀態。

`goose-log-wrapper.py` 解析 Goose stdout，產出結構化 JSONL 事件流；pixel-agents-webview 以 file watcher 讀取，轉譯為 webview 訊息，驅動角色動作、動線與家具聯動。

---

## 2. 整體架構

```
start-goose.bat --testrun="TC201L_Wave4_ST2"
  └→ python tools/goose-log-wrapper.py --testrun="..." goose run -t "..."
       ├─ pipe Goose stdout（逐行即時解析）
       ├─ 原樣輸出到 terminal（pass-through）
       ├─ 寫 JSONL → .runtime/sessions/goose-events-<testrun>.jsonl
       ├─ 寫人類 Log → .runtime/sessions/goose-activity-<testrun>.log
       ├─ 維持心跳 → .runtime/sessions/<testrun>.heartbeat（每 30 秒 touch）
       └─ 啟動時清理 → 掃描 .runtime/sessions/ 移除心跳超過 3 分鐘的孤兒檔案

.runtime/sessions/goose-events-<testrun>.jsonl
       ↓ file watch (fs.watch + fs.watchFile + polling 三重 fallback)
pixel-agents-webview server（Express + WebSocket）
       ↓ WebSocket
webview-ui
       ↓ message dispatch
useExtensionMessages.ts → OfficeState → Character FSM / Furniture Auto-State
```

### 設計取捨

- 不改 Goose 本體，不依賴 LLM 自律遵守指令
- Goose 的 `▸ toolName` stdout 格式由 Goose 原生硬編碼，穩定可靠
- DroidRun 的 plan/action banner 由 `run-droidrun.py` 透過 `handler.stream_events()` 即時印出，同樣穩定

---

## 3. 檔案位置與生命週期

```
.runtime/sessions/
├── goose-events-<testrun_safe>.jsonl     ← JSONL 事件流（pixel-agents 消費）
├── goose-activity-<testrun_safe>.log     ← 人類可讀 activity log
├── <testrun_safe>.heartbeat              ← 心跳檔（每 30 秒 touch，內容為 PID）
├── session-info-<testrun_safe>           ← Goose 讀取的 testrun 資訊（key=value）
└── session-info-<testrun_safe>.json      ← 同上，JSON 格式
```

### 生命週期

- **啟動時**：掃描 `.runtime/sessions/`，清除心跳超過 3 分鐘的孤兒檔案
- **執行中**：持續 append + flush，背景 thread 每 30 秒 touch heartbeat
- **正常結束**：歸檔 log 到 `test-reports/<testrun_safe>/`，刪除自己的所有 runtime 檔案
- **異常終止**（crash/kill）：heartbeat 停止更新，下一個 session 啟動時自動清理

### 環境變數

- `GOOSE_EVENT_LOG` — 覆寫 JSONL 路徑
- `GOOSE_SESSION_INFO` — Goose 讀取 session info 的路徑

---

## 4. Event 格式規格

每行一個 JSON 物件，必含 `type` 與 `ts` 欄位。

### 4.1 欄位命名慣例

| 欄位 | 說明 |
|------|------|
| `ts` | ISO 8601 時間戳（UTC），精確到毫秒 |
| `type` | 事件類型（見下方定義） |
| `toolId` | 工具呼叫唯一 ID（`t1`, `t2`, ...），用於配對 start/end |
| `parentToolId` | DroidRun 事件對應的父 shell tool ID |

### 4.2 Goose 原生事件

#### `session_start`
Goose session 啟動時發送。
```typescript
{
  type: 'session_start';
  ts: string;
  provider: string;        // e.g. "github_copilot"
  model: string;           // e.g. "gpt-4.1"
  testrun: string;         // e.g. "TC201L_Wave4_ST2"
}
```

#### `tool_start`
Goose 呼叫任何工具時發送（對應 stdout 的 `▸` 行）。
```typescript
{
  type: 'tool_start';
  ts: string;
  toolId: string;          // "t1", "t2", ...
  toolName: string;        // "shell", "get_testcase_details", "todo_write"
  extension: string;       // "developer", "mcp-ta2", "todo"
}
```

#### `tool_args`
工具參數補充（在 `tool_start` 之後、stdout 解析到參數行時發送）。
```typescript
{
  type: 'tool_args';
  ts: string;
  toolId: string;
  key: string;             // "command", "testcase_id", "content"
  value: string;           // 截斷至 200 字元
}
```

#### `tool_end`
工具執行完成時發送（由下一個 `tool_start` 或 session 結束觸發）。
```typescript
{
  type: 'tool_end';
  ts: string;
  toolId: string;
  toolName: string;
  extension: string;
  result?: {
    exitCode?: number;
    summary?: string;
  };
}
```

#### `session_end`
Session 結束。
```typescript
{
  type: 'session_end';
  ts: string;
  reason: 'completed';
  result?: 'pass' | 'fail';      // 需求 G-3（見 §11.3）
  summary?: string;               // 需求 G-3
}
```

### 4.3 DroidRun 事件

> **命名歷史**：2026-04-13 以前使用 `droidclaw_*` 命名（對應舊 sub-agent 實作 DroidClaw），現已全面改用 `droidrun_*`。舊 JSONL 紀錄中的 `droidclaw_*` 事件為歷史資料，新事件一律用新名。

#### `droidrun_plan`
Manager 產出新的 plan / subgoal（stdout 出現 `Goal: ...` 時發送）。
```typescript
{
  type: 'droidrun_plan';
  ts: string;
  parentToolId: string;    // 觸發它的 shell tool_start 的 toolId
  goal: string;            // DroidRun 的目標描述
}
```

#### `droidrun_action`
Executor 執行的單一 action 與結果（stdout 出現 `Decision: ...` 時發送）。
```typescript
{
  type: 'droidrun_action';
  ts: string;
  parentToolId: string;
  step: number;            // 當前步驟（1-based）
  maxSteps: number;        // 最大步驟數（通常 50）
  think: string;           // LLM 思考摘要（截斷至 300 字元）
  decision: string;        // 決策描述（截斷至 300 字元）
}
```

#### `droidrun_result`
整個 DroidRun task 的最終 success/fail（stdout 出現 `Goal Achieved:` 或 `Task completed/failed` 時發送）。
```typescript
{
  type: 'droidrun_result';
  ts: string;
  parentToolId: string;
  success: boolean;
  message: string;         // 結果訊息（截斷至 500 字元）
  totalSteps: number;
}
```

#### `droidrun_log`
DroidRun session log 儲存完成。
```typescript
{
  type: 'droidrun_log';
  ts: string;
  path: string;            // log 檔案路徑
}
```

---

## 5. stdout 解析對照表

| stdout 模式 | 正則 | 產出事件 |
|---|---|---|
| `▸ {toolName} {extension}` | `^\s+▸\s+(\S+)\s*(.*)$` | `tool_start`（前一個自動 `tool_end`） |
| `    key: value`（縮排參數行） | `^\s{4,}(\w[\w_]*):\s*(.*)$` | `tool_args` |
| `new session · provider model` | `new session\s+[·•]\s+(\S+)\s+(\S+)` | `session_start` |
| `DroidRun Started` | literal | 進入 DroidRun 狀態機 |
| `Goal: ...` | `^Goal:\s+(.+)$` | `droidrun_plan` |
| `--- Step N/M ---` | `^--- Step (\d+)/(\d+) ---$` | 記錄步驟（等待 Decision） |
| `Think: ...` | `^Think:\s+(.+)$` | 暫存（附加到下一個 action） |
| `Decision: ...` | `^Decision:\s+(.+)$` | `droidrun_action` |
| `Goal Achieved: ...` | `^Goal Achieved:\s+(.+)$` | `droidrun_result`（success） |
| `Task completed successfully.` | literal | `droidrun_result`（success） |
| `Task failed.` | literal | `droidrun_result`（fail） |
| `Session log saved: ...` | `^Session log saved:\s+(.+)$` | `droidrun_log` |

### 不可從 stdout 取得的事件

- `thinking` — Goose 的思考文字未寫入 stdout
- `text_output` — Goose 的回應文字與其他輸出混合，無法可靠分離
- `session_idle` — 無明確 stdout marker

---

## 6. Shell 指令語意分類

### 6.1 現狀

Goose agent 只用 **2 種原生工具**：

| toolName | extension | 說明 |
|---|---|---|
| `shell` | `developer` | **所有操作**都透過 shell 執行 |
| `todo_write` | `todo` | 更新測試進度檢查清單 |

因此若只看 `toolName`，所有 shell 指令都是同一種動畫，無法區分偵測裝置、讀取案例、操控手機等語意。`eventTranslator.ts` 需依 `command` 關鍵字進一步分類。

### 6.2 指令 → 動作對應表

| 語意類別 | command 關鍵字 | 角色動畫 | 狀態面板文字 |
|---|---|---|---|
| **DroidRun 操控** | `run-droidrun.py` | typing + **spawn sub-agent** | `DroidRun: {goal}` |
| **截圖存證** | `goose-report-tools.py screenshot` | reading | `截圖: {label}` |
| **報告初始化** | `goose-report-tools.py init` | typing | `初始化報告: {testrun}` |
| **報告撰寫** | `goose-report-tools.py report` | typing | `撰寫測試報告` |
| **報告定稿** | `goose-report-tools.py finalize` | typing | `定稿報告: {testrun}` |
| **Logcat 收集** | `goose-report-tools.py logcat` | reading | `收集裝置日誌` |
| **讀取測試案例** | `type sample-testcases` | reading | `讀取案例: {ID}` |
| **裝置偵測** | `adb devices` | reading | `偵測裝置連線` |
| **查詢裝置屬性** | `adb shell getprop` | reading | `查詢裝置屬性` |
| **查詢系統設定** | `adb shell settings get` | reading | `檢查系統設定` |
| **查詢套件資訊** | `adb shell dumpsys`, `adb shell pm` | reading | `查詢系統狀態` |
| **UI 操作** | `adb shell input` | typing | `裝置 UI 操作` |
| **啟動 App** | `adb shell am start`, `adb shell monkey` | typing | `啟動應用程式` |
| **拉取檔案** | `adb pull` | reading | `拉取檔案` |
| **螢幕截圖** | `adb shell screencap` | reading | `裝置截圖` |
| **進度記錄** | （toolName = `todo_write`） | typing | `更新進度清單` |
| **其餘 shell** | （以上皆不匹配） | typing | `Bash: {command 前 80 字}` |

### 6.3 動畫類型定義

| 動畫 | 說明 |
|---|---|
| **typing** | 坐在工位、雙手敲鍵盤（2 幀循環） |
| **reading** | 坐在工位、低頭看螢幕（2 幀循環） |
| **walk** | BFS 路徑走路（4 幀循環） |
| **idle** | 站立不動 |
| **report** | 站在主管桌前匯報 |
| **spawn** | Matrix 數位雨掃描出現（0.3s） |
| **despawn** | Matrix 數位雨消散（0.3s） |

---

## 7. 動線行為設計

### 7.1 完整測試流程動線

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
  └─ reading 動畫：「截圖」

tool_start (shell: goose-report-tools.py finalize ...)
  └─ typing 動畫：「定稿報告」

session_end
  ├─ 走向主管桌 → 站立 report（匯報結果）
  ├─ 走到休息區 → 坐沙發
  └─ idle 閒晃模式
```

### 7.2 氣泡類型

| 氣泡 | 觸發條件 | 持續時間 |
|---|---|---|
| `...`（琥珀色圓點） | 等待使用者許可 | 持續到點擊/清除 |
| ✓（綠色勾勾） | 回合完成 / DroidRun 成功 | 2 秒 auto-fade |
| ⚠（黃色警告） | DroidRun 失敗 | 持續到點擊/清除 |
| 📱（手機圖示） | DroidRun 操控中（父角色） | 持續到 tool_end |
| 💤（睡眠） | 長時間 idle（可選） | 持續到激活 |

---

## 8. GooseOffice 端對接

### 8.1 Event → WebView Message 映射

| JSONL Event | WebView Message | 角色行為 |
|---|---|---|
| `tool_start` | `agentToolStart` | Goose 坐下，開始打字/閱讀 |
| `tool_end` | `agentToolDone` | 切換動畫狀態 |
| `droidrun_plan` | `subagentToolStart` | 生成 DroidRun 子角色 |
| `droidrun_action` | `subagentToolStart`（更新） | 子角色狀態文字更新 |
| `droidrun_result` | `subagentClear` | 子角色消失 |
| `session_end` | `agentStatus: idle` | Goose 站起來閒逛 |

### 8.2 MVP（最小可行版本）

只需 `tool_start` + `tool_end` + `session_end` 三個事件，Goose 角色就能在 GooseOffice 裡活起來。DroidRun 子角色與 shell 語意分類為錦上添花。

### 8.3 前端需改造點

#### `eventTranslator.ts` — Shell 指令語意解析

改造 `buildToolStatusWithArgs()`（位於 `server/eventTranslator.ts`）。當收到 `tool_args` 且 `key === "command"` 時，依 §6.2 關鍵字優先序匹配，產出對應 status 文字。

**關鍵**：當 command 包含 `run-droidrun.py` 時，status 需帶 `Subtask:` 前綴以觸發 sub-agent spawn（`useExtensionMessages.ts` 已支援）。

```typescript
// 偽碼
if (command.includes('run-droidrun.py')) {
  const goal = command.match(/"([^"]+)"/)?.[1] ?? 'DroidRun';
  return `Subtask:DroidRun — ${goal}`;
}
if (command.includes('goose-report-tools.py screenshot')) {
  return `Read: 截圖 ${extractLabel(command)}`;
}
if (command.includes('goose-report-tools.py init')) {
  return `Write: 初始化報告`;
}
// ... 依 §6.2 表格繼續
```

#### `officeState.ts` — Auto-State 擴展

PHONE_DOCK 家具：當 agent 的 `currentTool` status 包含 `DroidRun` 時，面前的 PHONE_DOCK 切換為 ON。

#### `agentProfiles.ts` — session_end 匯報動線

在 `setAgentActive(false)` 時，若 session 有結果摘要，先推 `report` behavior 到隊列，再推 `rest`：

```
behaviorQueue: [
  { tile: 主管桌旁, facingDir: 面向主管, action: 'report' },
  { seatId: restSeat, action: 'rest' }
]
```

#### `spriteData.ts` — 氣泡擴展

- ⚠ 警告氣泡（DroidRun 失敗）
- 📱 手機氣泡（DroidRun 操控中）

---

## 9. 家具與設備擴展

### 9.1 場景家具提案

| 家具 | 尺寸 | footprint | 動態 | 用途 |
|---|---|---|---|---|
| **PHONE_DOCK** | 16×32 | 1×2 | on/off：亮屏/暗屏 | Tester 工位旁 |
| **SERVER_RACK** | 16×48 | 1×3 | on/off：LED 閃爍 | 測試實驗室 |
| **DASHBOARD** | 48×32 | 3×2 | on/off | 分析室牆上 |
| **PRINTER** | 32×32 | 2×2 | on/off：列印動畫 | 報告定稿觸發 |
| **COFFEE_MACHINE** | 16×32 | 1×2 | on/off：蒸氣 | 休息吧 |
| **VENDING_MACHINE** | 16×48 | 1×3 | 靜態 | 休息吧 |
| **WATER_COOLER** | 16×32 | 1×2 | 靜態 | 休息吧 |
| **MEETING_TABLE** | 48×32 | 3×2 | 靜態 | 主管辦公室 |
| **PROJECTOR_SCREEN** | 48×16 | 3×1 | on/off | canPlaceOnWalls |
| **CABLE_TRAY** | 16×16 | 1×1 | 靜態 | 實驗室細節 |
| **ANDROID_FIGURINE** | 16×16 | 1×1 | 靜態，canPlaceOnSurfaces | 桌面裝飾 |

### 9.2 Auto-State 連動規則

| 家具 | 自動開啟條件 | 自動關閉條件 |
|---|---|---|
| PC | agent 坐在工位 && isActive | agent 離開或 idle |
| PHONE_DOCK | agent.currentTool 含 DroidRun | DroidRun 結束 |
| DASHBOARD | Analyst agent isActive | Analyst idle |
| PRINTER | 任何 agent 觸發 `report-tools.py finalize` | 動畫播完 |

### 9.3 家具製作流程

參考既有 PC 結構：
1. 繪製像素圖（16px 格線，Aseprite / Piskel / Photoshop）
2. 建立 `webview-ui/public/assets/furniture/{NAME}/` 目錄，放 PNG + `manifest.json`
3. `manifest.json` 定義 group/state/animation 巢狀結構
4. 放入 `default-layout-2.json` 或用內建 Layout Editor
5. `cd webview-ui && npm run dev` 重建查看

#### 像素圖規格

| 屬性 | 規格 |
|---|---|
| 格線 | 16×16 px per tile |
| 色彩 | RGBA，alpha < 2 視為透明 |
| 半透明 | 支援 `#RRGGBBAA` |
| 動畫 | 每幀一張 PNG，manifest 用 `frame: 0/1/2` 標記 |
| 命名 | `{BASE}[_{ORIENTATION}][_{STATE}][_{FRAME}].png` |
| 方向 | front、back、side |
| 狀態 | on、off |

---

## 10. 目前運作狀態

pipeline 目前已完成的部分：

- ✅ Goose 原生事件（`session_start` / `tool_start` / `tool_args` / `tool_end` / `session_end`）
- ✅ DroidRun 事件（`droidrun_plan` / `droidrun_action` / `droidrun_result` / `droidrun_log`）— 透過 `run-droidrun.py` 改用 `handler.stream_events()` 即時產出
- ✅ pixel-agents-webview file watcher + eventTranslator + WebSocket broadcast
- ✅ 角色 FSM + sub-agent spawn/despawn Matrix 特效

---

## 11. MobileGoose 側改造需求

### 11.1 需求 G-1：shell 語意不足

目前 shell 的 `tool_args` 只發一次 `key: "command"`。前端需自行用關鍵字解析。

**現行方案**：前端在 eventTranslator 做關鍵字分類（見 §8.3），已足夠。
**改進方案（可選，低優先）**：`goose-log-wrapper.py` 在 `tool_args` 加入 `semantic` 欄位。

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

| command 匹配 | semantic |
|---|---|
| `run-droidrun.py` | `droidrun` |
| `goose-report-tools.py screenshot` | `screenshot` |
| `goose-report-tools.py init` | `report_init` |
| `goose-report-tools.py finalize` | `report_finalize` |
| `goose-report-tools.py report` | `report_write` |
| `goose-report-tools.py logcat` | `logcat` |
| `type sample-testcases` | `read_testcase` |
| `adb devices` | `device_detect` |
| `adb shell getprop` / `settings` / `dumpsys` / `pm` | `device_query` |
| `adb shell input` / `am` | `device_control` |
| `adb pull` / `adb shell screencap` | `device_capture` |
| 其餘 | （省略） |

### 11.2 需求 G-2：session_end 攜帶結果摘要（中優先）

```json
{
  "type": "session_end",
  "reason": "completed",
  "result": "pass",
  "summary": "7/7 步驟通過",
  "ts": "..."
}
```

用於角色匯報動線顯示 ✓ pass / ⚠ fail 氣泡。

---

## 12. 實作優先序

| 優先級 | 項目 | 影響範圍 | 依賴 |
|---|---|---|---|
| **P0** | eventTranslator shell 語意解析 (§8.3) | 前端 | 無 |
| **P1** | PHONE_DOCK 家具 + Auto-State (§9) | 前端 | 素材繪製 |
| **P1** | session_end 匯報動線 (§8.3) | 前端 | §11.2（可先硬編碼） |
| **P2** | 新家具素材（SERVER_RACK、DASHBOARD 等） | 素材 | 無 |
| **P2** | 氣泡系統擴展 (§7.2) | 前端 | 素材繪製 |
| **P3** | semantic 標籤 (§11.1) | MobileGoose | 前端可自行解析 |
| **P3** | 截圖閃光特效 | 前端 | 新特效系統 |

---

## 附錄 A：真實事件流範例

STTL-182451（Touch & hold delay 測試）：

```
session_start (gpt-4.1)                    → 角色激活，走向主管桌報告
shell: adb devices                         → reading「偵測裝置」
shell: adb shell getprop model             → reading「查詢裝置型號」
shell: adb shell settings get ...          → reading「檢查系統設定」
shell: goose-report-tools.py init          → typing「初始化報告」
shell: type sample-testcases/...           → reading「讀取測試案例」
shell: adb shell input keyevent 3          → typing「裝置 UI 操作」
shell: goose-report-tools.py screenshot    → reading「截圖: precondition」
shell: run-droidrun.py "Open Settings"     → typing + spawn DroidRun sub-agent
  (droidrun_plan → action 1..N → droidrun_result)
shell: run-droidrun.py "Scroll to..."      → typing + spawn DroidRun sub-agent
  ... (重複多次 DroidRun 操作)
shell: goose-report-tools.py screenshot    → reading「截圖: step8_restore」
shell: goose-report-tools.py logcat        → reading「收集日誌」
todo_write                                 → typing「更新進度清單」
session_end                                → 走向主管桌報告 → 休息區
```

## 附錄 B：JSONL 完整範例

取自 STTL-181126 測試執行（testrun: `run-de2aeb0d`，事件名已更新為 `droidrun_*`）：

```jsonl
{"type":"session_start","provider":"github_copilot","model":"gpt-4.1","testrun":"run-de2aeb0d","ts":"2026-03-23T09:37:10.767+00:00"}
{"type":"tool_start","toolId":"t1","toolName":"shell","extension":"developer","ts":"2026-03-23T09:37:12.843+00:00"}
{"type":"tool_args","toolId":"t1","key":"command","value":"adb devices","ts":"2026-03-23T09:37:12.843+00:00"}
{"type":"tool_end","toolId":"t1","toolName":"shell","extension":"developer","ts":"2026-03-23T09:37:15.814+00:00"}
{"type":"tool_start","toolId":"t6","toolName":"get_testcase_details","extension":"mcp-ta2","ts":"2026-03-23T09:37:22.656+00:00"}
{"type":"tool_args","toolId":"t6","key":"testcase_id","value":"STTL-181126","ts":"2026-03-23T09:37:22.656+00:00"}
{"type":"tool_end","toolId":"t6","toolName":"get_testcase_details","extension":"mcp-ta2","ts":"2026-03-23T09:37:26.374+00:00"}
{"type":"tool_start","toolId":"t7","toolName":"shell","extension":"developer","ts":"2026-03-23T09:37:26.374+00:00"}
{"type":"tool_args","toolId":"t7","key":"command","value":"python run-droidrun.py \"Open Settings app\"","ts":"2026-03-23T09:37:26.375+00:00"}
{"type":"droidrun_plan","parentToolId":"t7","goal":"Open Settings app","ts":"2026-03-23T09:37:46.068+00:00"}
{"type":"droidrun_action","parentToolId":"t7","step":1,"maxSteps":50,"think":"The goal is to open the Settings app...","decision":"open_settings — Open the Settings app as per the user goal (2395ms)","ts":"2026-03-23T09:37:46.071+00:00"}
{"type":"droidrun_action","parentToolId":"t7","step":2,"maxSteps":50,"think":"The Settings app is now open...","decision":"done — The Settings app is open and visible. Task is complete. (2054ms)","ts":"2026-03-23T09:37:46.073+00:00"}
{"type":"droidrun_result","parentToolId":"t7","success":true,"message":"The Settings app is open and visible. Task is complete.","totalSteps":2,"ts":"2026-03-23T09:37:46.073+00:00"}
{"type":"droidrun_log","path":"logs\\1774258653184-ngmjx3.json","ts":"2026-03-23T09:37:49.900+00:00"}
{"type":"tool_end","toolId":"t7","toolName":"shell","extension":"developer","ts":"2026-03-23T09:37:49.900+00:00"}
{"type":"session_end","reason":"completed","ts":"2026-03-23T09:43:48.205+00:00"}
```

## 附錄 C：ADB 指令統計（全部測試紀錄）

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

## 附錄 D：DroidRun 操控目標範例（代表性）

**系統導航**
- `Go to home screen`
- `Launch Settings app`
- `Go to Display in Settings`

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
- `Enter wrong PIN`
- `Expand notification bar`

---

## 附錄 E：備選方案（已放棄）

| 方案 | 說明 | 狀態 |
|---|---|---|
| **A. stdout pipe wrapper** | `goose-log-wrapper.py` 包外層 pipe stdout 即時解析 | ✅ 採用 |
| B. Goose Skill 主動寫 log | 依賴 LLM 遵守 Skill 指示，GPT-4.1 實測不可靠 | ❌ |
| C. 自訂 MCP Server | 最穩定但需額外跑 MCP server，複雜度不值 | ❌ |
| D. 混合方案 | stdout + DroidRun partial.json 合併 | ❌ 目前 stdout 已足夠 |
