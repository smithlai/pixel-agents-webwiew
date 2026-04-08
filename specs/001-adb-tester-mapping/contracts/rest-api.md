# REST API Contracts

**Feature**: `001-adb-tester-mapping`
**Base**: Vite dev server middleware (`server/viteGoosePlugin.ts`)

---

## GET /goose/devices

列出所有 ADB 偵測到的裝置及其 Tester 狀態。

### Response 200

```json
{
  "devices": [
    {
      "serial": "RFCR30XXXXX",
      "model": "SM_G975F",
      "agentId": 200,
      "state": "idle",
      "idleSince": 1712534400000
    },
    {
      "serial": "192.168.1.5:5555",
      "model": "Pixel_6_Pro",
      "agentId": 201,
      "state": "active",
      "task": {
        "command": "幫我測試 STTL-181126",
        "testrun": "dev-192.168.1.5:5555-a1b2c3d4",
        "startedAt": 1712534500000
      }
    }
  ],
  "unauthorized": [
    {
      "serial": "UNAUTHORIZED123",
      "message": "裝置未授權，請在手機上允許 USB 除錯"
    }
  ]
}
```

---

## POST /goose/run (修改現有)

分配任務給一個待命的 Tester，啟動 MobileGoose。

### Request Body

```json
{
  "command": "幫我測試 STTL-181126",
  "serial": "RFCR30XXXXX"    // 可選 — 指定裝置；省略則自動分配最先閒置者
}
```

### Response 202 (Success)

```json
{
  "ok": true,
  "command": "幫我測試 STTL-181126",
  "serial": "RFCR30XXXXX",
  "agentId": 200,
  "testrun": "dev-RFCR30XXXXX-a1b2c3d4"
}
```

### Response 409 (No Available Tester)

```json
{
  "error": "no_available_tester",
  "message": "所有 Tester 忙碌中，請等待任務完成或連接更多裝置"
}
```

### Response 404 (No Devices)

```json
{
  "error": "no_devices",
  "message": "沒有可用的測試裝置，請連接 Android 手機"
}
```

### Response 400 (Specified Device Busy)

```json
{
  "error": "device_busy",
  "message": "指定裝置 RFCR30XXXXX 正在執行任務",
  "serial": "RFCR30XXXXX"
}
```

---

## POST /goose/kill

停止指定裝置上的 MobileGoose 任務。

### Request Body

```json
{
  "serial": "RFCR30XXXXX"
}
```

### Response 200 (Success)

```json
{
  "ok": true,
  "serial": "RFCR30XXXXX",
  "agentId": 200
}
```

### Response 404 (No Active Task)

```json
{
  "error": "no_active_task",
  "message": "該裝置沒有正在執行的任務"
}
```

---

## WebSocket /goose-ws (擴充現有)

### 新增訊息類型

所有新訊息透過現有 `{ type: 'goose-events', messages: [...] }` 封裝發送。

#### devices-update

```json
{
  "type": "devices-update",
  "devices": [
    { "serial": "RFCR30XXXXX", "model": "SM_G975F", "agentId": 200, "state": "idle" }
  ]
}
```

#### task-assigned

```json
{
  "type": "task-assigned",
  "serial": "RFCR30XXXXX",
  "agentId": 200,
  "command": "幫我測試 STTL-181126",
  "testrun": "dev-RFCR30XXXXX-a1b2c3d4"
}
```

#### task-stopped

```json
{
  "type": "task-stopped",
  "serial": "RFCR30XXXXX",
  "agentId": 200,
  "reason": "user-stop"
}
```
