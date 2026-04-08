# Data Model: ADB 手機偵測與 Tester 自動產生系統

**Feature**: `001-adb-tester-mapping`
**Date**: 2026-04-08

## Entities

### AdbDevice

表示一台透過 ADB 連線的 Android 裝置。

| Field | Type | Description |
|-------|------|-------------|
| serial | string | ADB 裝置序號（唯一識別，如 `RFCR30XXXXX` 或 `192.168.1.5:5555`） |
| model | string | 裝置型號（如 `SM_G975F`、`Pixel_6_Pro`） |
| status | `'device'` \| `'unauthorized'` \| `'offline'` | ADB 連線狀態 |
| transportId | string \| null | ADB transport ID（可選） |

**Source**: `adb devices -l` 輸出解析  
**Lifecycle**: 隨 ADB 輪詢動態建立/移除

---

### DeviceAgent

表示一個與 AdbDevice 綁定的 Tester 角色，在 server 端追蹤。

| Field | Type | Description |
|-------|------|-------------|
| serial | string | 對應的 AdbDevice 序號 |
| agentId | number | webview 角色 ID（200 起始遞增） |
| state | `'idle'` \| `'active'` \| `'error'` | Tester 狀態 |
| idleSince | number | 進入 idle 的 timestamp（用於分配策略：最先閒置優先） |
| task | ActiveTask \| null | 目前執行中的任務（如有） |
| translatorInstance | EventTranslator | 該 Tester 專屬的事件翻譯器 |

**Lifecycle**: ADB 偵測到 device → 建立；device 斷線 → 如果 idle 直接移除；如果 active 先標 error  

---

### ActiveTask

表示一個正在執行的 MobileGoose 測試任務。

| Field | Type | Description |
|-------|------|-------------|
| command | string | Boss 下達的原始指令（自然語言） |
| serial | string | 目標裝置序號 |
| testrun | string | 組合的 testrun ID（如 `dev-RFCR30XXXXX-a1b2c3d4`） |
| pid | number \| null | MobileGoose 進程 PID |
| startedAt | number | 啟動 timestamp |
| jsonlFile | string \| null | 對應的 JSONL 事件檔案路徑 |

**Lifecycle**: Boss 下令 → 建立 → MobileGoose 結束或使用者停止 → 清除

---

### WebSocket Message Extensions

在現有 goose-events WebSocket 協議上新增的訊息類型：

#### `devices-update` (Server → Client)

**觸發**: ADB 輪詢偵測到裝置變化時推送

```json
{
  "type": "devices-update",
  "devices": [
    {
      "serial": "RFCR30XXXXX",
      "model": "SM_G975F",
      "agentId": 200,
      "state": "idle"
    }
  ]
}
```

#### `task-assigned` (Server → Client)

**觸發**: Boss 下令成功分配任務時推送

```json
{
  "type": "task-assigned",
  "serial": "RFCR30XXXXX",
  "agentId": 200,
  "command": "幫我測試 STTL-181126",
  "testrun": "dev-RFCR30XXXXX-a1b2c3d4"
}
```

#### `task-stopped` (Server → Client)

**觸發**: 使用者按停止按鈕或進程自然結束

```json
{
  "type": "task-stopped",
  "serial": "RFCR30XXXXX",
  "agentId": 200,
  "reason": "user-stop" | "completed" | "error"
}
```

## Relationships

```
Boss ──(下令)──→ DeviceAgent ──(1:1)──→ AdbDevice
                      │
                      ├──(持有)──→ ActiveTask
                      │                 │
                      │                 └──(產生)──→ JSONL File
                      │
                      └──(spawn)──→ SubAgent (DroidClaw)
```

## State Machine: DeviceAgent

```
[不存在] ──(ADB偵測到device)──→ [idle]
[idle] ──(Boss分配任務)──→ [active]
[active] ──(session_end / 使用者停止)──→ [idle]
[active] ──(ADB裝置斷線)──→ [error] ──(3秒後)──→ [移除]
[idle] ──(ADB裝置斷線)──→ [移除]
```
