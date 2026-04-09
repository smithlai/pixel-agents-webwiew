# GooseOffice Webview UI

這個目錄是 GooseOffice 的前端應用，使用 React + TypeScript + Vite。

如果你是第一次拿到這個 repo，要跟自己的 Goose 專案整合，建議先看根目錄的 [README.md](../README.md)。

## 最小啟動步驟

1. 在這個目錄執行安裝：

```bash
npm install
```

2. 複製 [webview-ui/.env.example](.env.example) 成 `.env.local`

3. 設定至少一個環境變數：

```bash
GOOSE_WATCH_DIR=/你的/Goose專案/.runtime/sessions
```

4. 如果你也要讓 Boss 指令列直接啟動 Goose，再加上：

```bash
MOBILE_GOOSE_DIR=/你的/Goose專案
```

5. 啟動開發伺服器：

```bash
npm run dev
```

6. 打開瀏覽器的 [http://localhost:5173](http://localhost:5173)

## `.env.local` 範例

```bash
GOOSE_WATCH_DIR=../../MobileGoose/.runtime/sessions
MOBILE_GOOSE_DIR=../../MobileGoose
```

## 這兩個環境變數的用途

- `GOOSE_WATCH_DIR`
  - 必填於真實 Goose 整合情境
  - 指向 Goose JSONL 事件輸出目錄
  - 未設定時，前端會 fallback 到 mock 模式

- `MOBILE_GOOSE_DIR`
  - 選填
  - 讓畫面下方的 Boss 指令列可以直接啟動你的 Goose / MobileGoose 專案
  - 未設定時，不影響畫面顯示，只是無法從 UI 直接發動 Goose 工作流

## 狀態文字與動畫是怎麼來的

- Goose / MobileGoose 先輸出 JSONL 事件
- [server/gooseWatcher.ts](../server/gooseWatcher.ts) 監看事件檔
- [server/eventTranslator.ts](../server/eventTranslator.ts) 轉成前端訊息
- [webview-ui/src/office/toolUtils.ts](src/office/toolUtils.ts) 依狀態前綴判定動畫類型

如果你要改：

- Goose 原始事件格式：改 Goose / MobileGoose 輸出端
- GooseOffice 顯示文字：改 [server/eventTranslator.ts](../server/eventTranslator.ts)
- GooseOffice 動畫分類：改 [webview-ui/src/office/toolUtils.ts](src/office/toolUtils.ts)

## 驗證整合是否成功

符合以下條件，就代表整合成功：

1. Vite 啟動時沒有出現 `GOOSE_WATCH_DIR 未設定` 提示
2. Goose 事件檔有持續寫入到你指定的 sessions 目錄
3. 畫面中的角色狀態文字會隨 `tool_start` / `tool_args` / `tool_end` 改變

如果 Goose 端還沒實作更細的動作對應表，仍然可以正常整合；只是目前多數 shell 指令會先以較通用的狀態名稱顯示。
