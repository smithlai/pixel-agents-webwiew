# Research: ADB 手機偵測與 Tester 自動產生系統

**Feature**: `001-adb-tester-mapping`
**Date**: 2026-04-08

## R1 — ADB 裝置偵測在 Node.js/Vite 中的最佳實踐

### Decision: 在 Vite dev server（server/ 目錄）使用 `child_process.execFile('adb', ['devices', '-l'])` 每 5 秒輪詢

### Rationale
- `adb devices -l` 輸出包含 serial、連線狀態、型號（`model:XXX`），一個指令取得全部資訊
- `adb track-devices` 可以做推送式偵測（persistent connection），但需要管理 raw socket + ADB protocol，複雜度高且 Windows 上不穩定
- 5 秒輪詢 + `execFile` 成本極低（~200ms），足夠應付裝置插拔場景
- 現有 `gooseWatcher.ts` 已用類似的 fs.watch + polling hybrid 模式

### Alternatives Considered
1. **`adb track-devices`**：推送式，但需實作 ADB wire protocol，跨平台問題多
2. **USB event listener（node-usb）**：只能偵測 USB 事件，無法得知 ADB 授權狀態
3. **WebUSB API（瀏覽器端）**：安全沙箱限制，無法直接存取 ADB

### Format
```
$ adb devices -l
List of devices attached
RFCR30XXXXX            device product:beyond2 model:SM_G975F transport_id:1
192.168.1.5:5555       device product:raven model:Pixel_6_Pro transport_id:3
UNAUTHORIZED123        unauthorized
```

---

## R2 — 多 Tester 的 JSONL Session 映射

### Decision: 啟動 `start-goose.bat` 時指定 `--testrun` 含裝置序號，GooseWatcher 從檔名中提取 serial 對應 Tester

### Rationale
- `goose-log-wrapper.py` 生成的檔名格式為 `goose-events-{testrun}.jsonl`
- `--testrun` 是現有支援的參數，格式可完全控制
- 設定 `--testrun "dev-{serial}-{uuid8}"` → 檔名 `goose-events-dev-RFCR30XXXXX-a1b2c3d4.jsonl`
- GooseWatcher 的 `onFileFound` callback 已提供檔名，只需加正則提取 serial

### Implementation
- 啟動時組合 testrun：`dev-${serial}-${shortUUID}`
- GooseWatcher `onFileFound(filePath)` → 正則 `/goose-events-dev-(.+?)-[0-9a-f]{8}\.jsonl/` → 取得 serial
- 找到 serial 後查表 → 建立該 Tester 專屬的 EventTranslator（agentId = deviceAgentId）
- 不需修改 `goose-log-wrapper.py`，只利用現有 `--testrun` 參數

---

## R3 — 裝置序號傳遞與 `--device` 參數

### Decision: 在 `start-goose.bat` 新增 `--device <serial>` 參數，設定 `ANDROID_SERIAL` 環境變數

### Rationale
- `ANDROID_SERIAL` 是 ADB 官方環境變數，設定後 Goose 內部的所有 `adb` 呼叫自動指向該裝置
- `--device` 只是語法糖，bat 內部 `set ANDROID_SERIAL=%~1` 即可
- 不需要改 goose-log-wrapper.py 或 goosehints
- **外部依賴**：需要 MobileGoose 專案新增此參數（已建立 `external-dependency-mobilegoose.md`）
- **暫時方案**：在 pixel-agents-webview 的 spawn 端直接設定 `ANDROID_SERIAL` 環境變數給子進程，即使 MobileGoose 尚未支援 `--device`，ADB 也能正確路由

### 暫時方案實作
```ts
// viteGoosePlugin.ts — spawn 時直接注入環境變數
child_process.spawn('powershell', [...], {
  env: { ...process.env, ANDROID_SERIAL: serial },
  // ...
});
```

---

## R4 — 進程管理與停止按鈕

### Decision: 追蹤每個 spawn 的 MobileGoose 進程 PID，停止時使用 `taskkill /T /F /PID` 終止整個進程樹

### Rationale
- 現有 `spawn().unref()` 啟動後無法追蹤進程。需要保留 PID 參照
- `Start-Process` 包的是 `cmd /c start-goose.bat`，進程樹為 powershell → cmd → python → goose
- `taskkill /T`（recursive tree kill）能一次終止整個樹
- Windows 上 `process.kill()` 只殺 Node 子進程，不會殺 cmd 子樹

### Implementation
- 改用 `child_process.spawn('cmd', ['/c', batPath, ...args], { env: { ANDROID_SERIAL: serial } })`
- 不 `unref()`，保留 `ChildProcess` reference
- 新增 `POST /goose/kill` endpoint，接受 `{ serial }` → 查表找到 PID → `taskkill /T /F /PID`
- 進程正常結束（exit 事件）→ 自動清理

---

## R5 — 多 Agent 架構改造

### Decision: 從固定 agentId=103 改為 per-device 動態 agent，每個裝置一個 EventTranslator 實例

### Rationale
- 現有的 `EventTranslator` 硬編碼 `agentId = 103`，只支援一個 Tester
- 每台裝置需要獨立的 agent ID、獨立的 EventTranslator、獨立的 JSONL 監聽
- ID 分配策略：200 起始，遞增（避開現有 mock agent 100~105）
- GooseWatcher 已支援多檔案監聽，只需在 `onEvent` 回調中根據檔案路徑路由到正確的 translator

---

## R6 — Mock 角色開關

### Decision: 在 `browserMock.ts` 中使用 module-level `const ENABLE_MOCK_AGENTS = false` 控制

### Rationale
- 最低成本方案，不需 UI 元件或 Settings Modal 修改
- 開發者改一行常數重新載入即可切換
- Boss（ID 100）不受此開關控制，始終存在
- Goose WebSocket 連線不受 mock 開關影響
