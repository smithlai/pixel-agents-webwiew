# ISSUES

本檔紀錄已討論但**暫不修補**的已知問題、潛在爭議、以及故意留下的設計邊界。
每次回顧本檔時，重新評估是否仍屬於「可接受」狀態。

---

## I1 — tmp 腳本檔名毫秒碰撞

**位置**：[server/viteGoosePlugin.ts](server/viteGoosePlugin.ts) POST `/goose/run` handler
```ts
const tmpCmd = path.join(os.tmpdir(), `goose-run-${Date.now()}.cmd`);
```

**問題**：`Date.now()` 解析度僅 1ms，同毫秒兩個請求會寫入同一檔名，覆蓋後 `cmd.exe` 逐行重讀會讀到污染後的內容，導致：
- 兩個任務的 serial / testrun / command 交叉污染
- `del "%~f0"` 自刪可能失效（tmp 檔殘留）

**現有緩解**：
- webview `bossCommandLockRef` 2s debounce（per-window）
- DeviceManager 裝置狀態守門（同裝置不得重複派）

**為何暫不修**：
主人判斷目前**單機單視窗情境下實務上不會發生**。若未來出現多視窗、多使用者、或外部自動化觸發，需重新評估。

**最小修補（未來若決定修）**：
```ts
import crypto from 'node:crypto';
const tmpCmd = path.join(
  os.tmpdir(),
  `goose-run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.cmd`,
);
```

**觸發重評條件**：
- 出現第二個 webview 使用者
- 加入 CI / 定時觸發 / 外部 API 呼叫
- 實際觀察到交叉污染或 tmp 殘留

---

## I2 — spawn 到 PID 捕獲之間的 kill 空窗

**位置**：[server/viteGoosePlugin.ts](server/viteGoosePlugin.ts) `ps.on('close')` 內的 `setTaskPid`

**問題**：從 `child_process.spawn` 出 PowerShell 到 PowerShell 印出 cmd PID 之間有數百毫秒空窗（典型 200–500ms）。若使用者在此空窗內呼叫 `/goose/kill`，`agent.task.pid` 仍為 `undefined`，`taskkill` 不會執行，實際 process 未被殺。

**現有緩解**：無直接防線。使用者可在 PID 寫入後再按一次 kill。

**為何暫不修**：
空窗期（~數百 ms）**小於人類從看到 UI 到按下按鈕的反應時間**（典型 > 500ms），實際上無法觸及。自動化腳本雖可能踩到但並非當前情境。

**未來若要修的思路**：
- 在 `assignTask` 當下就預留一個「pending kill」flag，PID 寫入時若 flag 為 true 立刻殺掉
- 或讓 `/goose/kill` 在 pid 缺失時輪詢等待 1–2 秒

**觸發重評條件**：
- 加入自動化測試腳本會立即 spawn + kill
- 實際回報「按了 kill 但 Goose 沒死」

---

## I3 — 工具鏈中段的假死無法偵測

**位置**：整個 Goose spawn → JSONL 事件管線

**問題**：我們只監控兩個訊號：
- **JSONL 事件流**（session_start / session_end / tool events）
- **cmd PID**（存在性，目前僅用於 `/goose/kill`）

若 Goose process 成功啟動、寫出第一筆 JSONL，但之後**卡住不再寫任何事件**（網路斷線、DroidRun 等待回應、python deadlock…），系統會認為「任務還在跑」，裝置狀態維持 active，直到：
- session_end 出現（不會）
- 使用者手動 `/goose/kill`
- server 重啟

60s spawn watchdog **無法處理這種情境**（它只在 `jsonlFile` 仍為空時觸發，而此時已有 JSONL）。

**為何暫不修**：
這是主人有意識拍板的**職責邊界**——「我們只看鵝是死是活，鵝在做什麼中間有沒有卡住不干我們的事」。

**未來若要修的思路**：
- 加入「JSONL idle timeout」：持續 N 分鐘沒有新事件 → 視為假死
- 或輪詢 cmd PID 存在性，process 已死但沒收到 session_end 時強制釋放
- 或在 Goose 端加心跳事件（侵入性大）

**觸發重評條件**：
- 實際觀察到「裝置卡 active，但 process 已死 / 網路已斷」
- 使用者抱怨「任務卡住不結束又沒法開新的」

---

## 設計邊界備註（非 bug）

以下是**有意設計**，不是問題，紀錄在此避免未來誤改：

1. **裝置釋放只由三個源頭驅動**：
   - `session_end` 事件（正常完成）
   - `/goose/kill` API（使用者手動）
   - 60s spawn watchdog（防卡死後援）
   
   PowerShell exit code **故意不參與**裝置狀態決策，因為 `Start-Process` detach 後 exit code 不反映子孫進程真實狀態。

2. **我們不監控工具鏈中間層**（PowerShell / cmd / bat / python / droidrun / adb）。只在「頭」（spawn）和「尾」（JSONL 事件）設觀測點，中間黑箱化。

3. **PID 捕獲的是 cmd 層，不是 goose.exe**。`taskkill /T /F /PID <cmd-pid>` 會連整棵子樹一起收，不需要個別追蹤每一層的 PID。
