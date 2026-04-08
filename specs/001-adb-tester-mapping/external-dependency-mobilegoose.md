# 外部依賴需求：MobileGoose `--device` 參數支援

**來源**: pixel-agents-webview Feature `001-adb-tester-mapping`
**目標**: [MobileGoose](D:\WorkTable\AIAgent\MobileGoose) `start-goose.bat`
**建立日期**: 2026-04-07
**狀態**: 待實作

## 背景

pixel-agents-webview 正在開發「ADB 手機偵測自動產生 Tester」功能，需要為每台連線的 Android 手機啟動獨立的 Goose session。目前 `start-goose.bat` 只會自動抓第一台裝置（`adb devices` 取第一行），無法指定目標裝置。

## 需求

### 1. `--device <serial>` CLI 參數

**目前**：
```bat
start-goose.bat run -t "幫我測試 STTL-181126"
:: → 自動找第一台裝置
```

**期望**：
```bat
start-goose.bat run --device RFCR30XXXXX -t "幫我測試 STTL-181126"
:: → 明確指定裝置序號
```

**實作建議**（在 `start-goose.bat` 的 `:parse_args` 區段）：
```bat
if /i "%_ARG%"=="--device" goto parse_device
:: ...
:parse_device
shift
if "%~1"=="" (
    echo [ERROR] --device requires a serial number.
    exit /b 1
)
set "ANDROID_SERIAL=%~1"
shift
goto parse_args
```

然後在 Portal 安裝等段落中，把硬編碼的 `%_ADB_SERIAL%` 替換為 `%ANDROID_SERIAL%`。
若 `--device` 未指定，保留原來的自動偵測邏輯。

### 2. Session ID 包含裝置序號

`goose-log-wrapper.py` 產生的 JSONL 檔名需要包含裝置序號，以便外部系統從檔名反查對應裝置。

**目前**：`goose-events-run-b11d9119.jsonl`

**期望**：`goose-events-RFCR30XXXXX-b11d9119.jsonl`

**實作建議**：`goose-log-wrapper.py` 在建立輸出檔名時，檢查 `ANDROID_SERIAL` 環境變數，若存在則嵌入檔名。

### 3. 影響範圍

| 檔案 | 改動 |
|------|------|
| `start-goose.bat` | `:parse_args` 新增 `--device` 解析，設定 `ANDROID_SERIAL` 環境變數 |
| `tools/goose-log-wrapper.py` | 檔名格式加入 `ANDROID_SERIAL`（如有） |

### 4. 相容性

- 不帶 `--device` 時行為完全不變（向後相容）
- `ANDROID_SERIAL` 是 ADB 官方環境變數，設定後所有 `adb` 子指令自動指向該裝置
