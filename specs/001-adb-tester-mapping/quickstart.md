# Quickstart: ADB 手機偵測與 Tester 自動產生系統

**Feature**: `001-adb-tester-mapping`

## 前置條件

1. ADB 已安裝且在 PATH 中（`adb version` 可執行）
2. MobileGoose 專案在 `MOBILE_GOOSE_DIR` 指定的路徑
3. `GOOSE_WATCH_DIR` 指向 MobileGoose 的 `.runtime/sessions` 資料夾
4. 至少一台 Android 手機已開啟 USB 除錯且已授權

## 啟動

```bash
cd webview-ui
npm run dev
# 瀏覽器開 http://localhost:5173
```

## 使用流程

1. **自動偵測裝置**: 頁面載入後，系統每 5 秒偵測 ADB 裝置，有幾台手機就出現幾個 Tester 角色
2. **Boss 下令**: 在底部對話框輸入指令（如「幫我測試 STTL-181126」），按 Enter 送出
3. **自動分配**: 系統將指令分配給最先閒置的 Tester，該 Tester 進入工作狀態
4. **即時監控**: 點擊 Tester 角色查看右側狀態面板，顯示即時工具呼叫進度
5. **停止任務**: 工作中的 Tester 面板上有紅色停止按鈕，點擊後終止任務

## 開發切換

- **Mock 角色**: `browserMock.ts` 中 `ENABLE_MOCK_AGENTS = false`（預設關閉）。改為 `true` 可顯示假人 PM、Analyst 等
- **無手機開發**: mock 開關開啟後可在沒有實體手機的情況下看到展示動畫
