# Feature Specification: ADB 手機偵測與 Tester 自動產生系統

**Feature Branch**: `001-adb-tester-mapping`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "ADB 手機偵測自動產生 Tester 角色，Boss 下令分配任務，子工具 spawn 附屬角色"

## Clarifications

### Session 2026-04-07

- Q: 如何把 JSONL session 對應回啟動它的 Tester？ → A: 啟動時透過參數指定 session ID 包含裝置序號（如 `goose-events-{serial}-{uuid}.jsonl`），從檔名反查
- Q: 多個 Tester 待命時，任務分配策略是什麼？ → A: 最先閒置的優先（idle 時間最長者），自然均衡負載
- Q: ADB 裝置偵測的輪詢間隔應設為多少？ → A: 5 秒
- Q: 裝置序號如何傳給 start-goose.bat？ → A: 額外 CLI 參數 `--device <serial>`（需改 MobileGoose 的 start-goose.bat 支援此參數）
- Q: Mock 角色開關放在哪裡？ → A: 程式碼中的 static boolean 常數（預設 false），先不做 UI 開關

## User Scenarios & Testing *(mandatory)*

### User Story 1 - ADB 偵測自動產生 Tester (Priority: P1)

當系統啟動或偵測到新 ADB 裝置時，自動為每台已連接的 Android 手機產生一個 Tester 角色。每個 Tester 與一台手機一一對應，顯示該手機的裝置名稱。Tester 在像素辦公室中以待命狀態出現，等待被分配任務。

**Why this priority**: 沒有 Tester 角色就無法進行後續的任務分配與視覺化，這是整個功能的基礎。

**Independent Test**: 插上一台 Android 手機，開啟系統後確認畫面上出現一個對應的 Tester 角色，顯示裝置名稱和待命狀態。

**Acceptance Scenarios**:

1. **Given** 系統啟動時有 2 台 Android 手機透過 ADB 連線, **When** 頁面載入完成, **Then** 畫面上出現 2 個 Tester 角色，各自顯示對應的裝置序號或型號名
2. **Given** 系統已在執行中, **When** 使用者插入一台新手機且 ADB 辨識成功, **Then** 畫面上在數秒內自動出現一個新的 Tester 角色（含 spawn 特效）
3. **Given** 有一台手機對應的 Tester 正在待命, **When** 該手機被拔除或 ADB 斷線, **Then** 對應的 Tester 角色以 despawn 特效消失
4. **Given** 有一台手機對應的 Tester 正在執行任務, **When** 該手機被拔除, **Then** 該 Tester 的任務標記為異常中斷，角色顯示錯誤狀態後 despawn

---

### User Story 2 - Boss 下令分配任務給 Tester (Priority: P1)

使用者扮演 Boss 角色，透過指令輸入框下達測試指令（自然語言描述）。系統自動從待命中的 Tester 裡挑選一位，將任務分配給他。被分配任務的 Tester 從待命狀態切換為工作狀態，並啟動 MobileGoose 的 `start-goose.bat` 執行測試。

**Why this priority**: 這是使用者的核心互動——下指令驅動測試，與 P1 的 Tester 偵測同等重要。

**Independent Test**: 在有至少一台手機連線的情況下，於 Boss 對話框輸入指令，確認一個 Tester 開始工作並看到狀態變化。

**Acceptance Scenarios**:

1. **Given** 有 3 個 Tester 均為待命, **When** Boss 輸入「幫我測試 STTL-181126」, **Then** 系統選擇一個待命的 Tester，該 Tester 進入工作狀態並啟動測試流程
2. **Given** 3 個 Tester 中有 2 個正在工作、1 個待命, **When** Boss 下達新指令, **Then** 唯一待命的 Tester 被分配
3. **Given** 所有 Tester 都在執行任務, **When** Boss 下達新指令, **Then** 系統提示「所有 Tester 忙碌中，請等待任務完成或連接更多裝置」
4. **Given** 沒有任何手機連線（0 個 Tester）, **When** Boss 下達指令, **Then** 系統提示「沒有可用的測試裝置，請連接 Android 手機」

---

### User Story 3 - 任務狀態顯示與停止按鈕 (Priority: P2)

正在執行任務的 Tester 在角色狀態面板上即時顯示任務進度（來自 Goose WebSocket 事件流）。使用者可以按下 Tester 狀態旁的停止按鈕，強制終止該 Tester 正在執行的任務，讓 Tester 回到待命狀態。

**Why this priority**: 讓使用者能監控進度並在必要時中止任務是基本的控制能力，但需要先有 P1 的 Tester 和任務分配才有意義。

**Independent Test**: 分配一個任務給 Tester，觀察狀態面板上的即時更新，按下停止按鈕後確認 Tester 回到待命。

**Acceptance Scenarios**:

1. **Given** 一個 Tester 正在執行任務, **When** 使用者點擊該 Tester, **Then** 狀態面板顯示該任務的即時工具呼叫狀態、已過時間，以及一個紅色停止按鈕
2. **Given** 使用者看到 Tester 的停止按鈕, **When** 點擊停止按鈕, **Then** 系統終止對應的 MobileGoose 進程，Tester 回到待命動畫，狀態顯示「已手動中止」
3. **Given** 一個待命的 Tester, **When** 使用者點擊該 Tester, **Then** 狀態面板顯示該 Tester 綁定的裝置資訊，但不顯示停止按鈕

---

### User Story 4 - 子工具 Spawn 附屬角色 (Priority: P2)

當 Goose 在測試過程中呼叫外部工具（例如 DroidRun），系統為該工具 spawn 一個附屬角色（使用 matrix rain 特效進場）。附屬角色的狀態顯示在其「上級」Tester 的狀態下方，形成階層結構。工具完成後附屬角色以 despawn 特效消失。

**Why this priority**: 子工具視覺化增強了整體可觀察性，但核心功能不依賴它。

**Independent Test**: 讓 Tester 執行一個會觸發 DroidRun 的任務，確認附屬角色出現並在工具完成後消失。

**Acceptance Scenarios**:

1. **Given** Tester 正在執行任務, **When** Goose 呼叫 DroidRun 工具, **Then** 一個附屬角色以 matrix rain 特效在 Tester 附近的空位 spawn，狀態面板顯示層級關係
2. **Given** 附屬角色正在執行中, **When** DroidRun 回報步驟進度, **Then** 附屬角色的狀態文字即時更新（例如「Step 2/50: 開啟設定」）
3. **Given** 附屬角色正在執行中, **When** DroidRun 完成, **Then** 附屬角色以 despawn 特效消失，Tester 的狀態更新為下一步
4. **Given** 使用者透過 Tester 的停止按鈕中止任務, **When** 該 Tester 有附屬角色, **Then** 附屬角色也一併 despawn

---

### User Story 5 - Mock 角色開關 (Priority: P3)

系統保留現有的假人展示角色（PM、Analyst、Tester2、Tester3），但提供一個可配置的開關（預設關閉）控制是否顯示。Boss 角色始終顯示，因為它代表使用者。

**Why this priority**: 清理開發用假資料是收尾工作，不影響核心功能。

**Independent Test**: 切換 mock 開關為開，確認假人角色出現；切換為關，假人消失。Boss 在兩種情況下都保留。

**Acceptance Scenarios**:

1. **Given** mock 開關為關閉（預設）, **When** 頁面載入, **Then** 畫面上只顯示 Boss 和 ADB 偵測到的真實 Tester，不顯示 PM、Analyst、Tester2、Tester3
2. **Given** mock 開關為開啟, **When** 頁面載入, **Then** 畫面上除了 Boss 和真實 Tester 外，也顯示 PM、Analyst 等 mock 角色並執行其 mock 腳本
3. **Given** mock 開關在執行中切換, **When** 從開切到關, **Then** mock 角色以 despawn 特效消失，真實 Tester 不受影響

---

### User Story 6 - 多任務併發與裝置隔離 (Priority: P2)

當有多台手機連線時，Boss 可以連續下達多個指令，每個指令分配給不同的待命 Tester。每個 Tester 的任務獨立執行，互不影響。不同 Tester 的 JSONL 事件流各自隔離，狀態面板能同時顯示多個 Tester 的進度。

**Why this priority**: 支持多裝置並行是 MobileGoose 的核心場景價值。

**Independent Test**: 連接 2 台手機，連續下達 2 個不同指令，確認 2 個 Tester 同時工作且狀態互不干擾。

**Acceptance Scenarios**:

1. **Given** 3 台手機連線、3 個 Tester 待命, **When** Boss 連續下達 3 個指令, **Then** 每個 Tester 各自接到一個任務並同時執行
2. **Given** 2 個 Tester 同時在工作, **When** 使用者點擊不同 Tester, **Then** 狀態面板各自獨立顯示對應 Tester 的進度
3. **Given** Tester A 完成任務回到待命, **When** Boss 下達新指令, **Then** 系統將新指令分配給 Tester A

---

### Edge Cases

- 手機在任務執行途中斷線（USB 鬆脫、WiFi 不穩）：Tester 狀態切為錯誤，MobileGoose 進程不額外處理（讓 Goose 自行 timeout）
- `adb devices` 回傳 unauthorized 裝置：不產生 Tester，在控制台顯示提示「裝置未授權，請在手機上允許 USB 除錯」
- 同一台手機反覆拔插：根據裝置序號做去重，已存在的 Tester 不重複建立
- Boss 快速連續下達指令（連點）：前端做 debounce，避免同一秒分配多個任務給同一 Tester
- `start-goose.bat` 啟動失敗（路徑錯誤、Python 未安裝）：Tester 顯示啟動失敗狀態，回到待命
- 大量裝置同時連線（>10 台）：辦公室空間有限，超出座位數的 Tester 自動分配到最近的空閒地磚

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系統 MUST 在啟動時及每 5 秒輪詢一次透過 ADB 偵測已連線的 Android 裝置
- **FR-002**: 系統 MUST 為每台已連線且已授權的裝置自動產生一個 Tester 角色，裝置序號作為唯一識別
- **FR-003**: 每個 Tester MUST 與一台裝置一一對應，不可共用裝置
- **FR-004**: Boss 的指令輸入框 MUST 將使用者的自然語言指令傳送至後端進行任務分配
- **FR-005**: 系統 MUST 僅將任務分配給狀態為「待命」的 Tester，「工作中」的 Tester 不可再被分配。多個待命 Tester 時，選擇閒置時間最長者
- **FR-006**: 任務分配 MUST 觸發 `start-goose.bat run --device <serial> -t "<command>"` 傳入裝置序號與指令。Session ID MUST 包含裝置序號以便從 JSONL 檔名反查 Tester
- **FR-007**: 正在工作的 Tester MUST 在狀態面板上顯示即時工具呼叫狀態（透過 Goose JSONL WebSocket 事件流）
- **FR-008**: 正在工作的 Tester MUST 在狀態面板上顯示一個停止按鈕，點擊後終止對應的 MobileGoose 進程
- **FR-009**: 停止按鈕觸發後，Tester MUST 回到待命狀態，可再被分配新任務
- **FR-010**: 當 Goose 呼叫外部子工具（如 DroidRun）時，系統 MUST 在該 Tester 附近 spawn 一個附屬角色
- **FR-011**: 附屬角色 MUST 顯示子工具的即時步驟進度
- **FR-012**: 子工具完成時，附屬角色 MUST 以 despawn 特效消失
- **FR-013**: 當使用者停止 Tester 的任務時，該 Tester 的所有附屬角色 MUST 一併 despawn
- **FR-014**: 系統 MUST 提供一個程式碼層級的 static boolean 常數控制 mock 角色（PM、Analyst、Tester2、Tester3）是否顯示，預設為 false（關閉）
- **FR-015**: Boss 角色 MUST 始終顯示，不受 mock 開關影響
- **FR-016**: 裝置斷線時，若該 Tester 為待命狀態，MUST 以 despawn 特效移除；若為工作中，MUST 先顯示錯誤狀態
- **FR-017**: 系統 MUST 根據裝置序號去重，同一裝置不可產生多個 Tester
- **FR-018**: 所有 Tester 均不可用時，Boss 下令 MUST 收到明確的提示訊息

### Key Entities

- **Device（裝置）**: 一台透過 ADB 連線的 Android 手機。屬性包含裝置序號（serial）、型號名稱（model）、連線狀態（connected / unauthorized / offline）
- **Tester（測試員角色）**: 像素辦公室中的虛擬角色，與一台 Device 一一綁定。狀態包含待命（idle）、工作中（active）、錯誤（error）。持有當前任務的參照
- **Task（任務）**: 由 Boss 下達的一條測試指令。屬性包含原始指令文字、分配的 Tester、對應的 MobileGoose 進程、啟動時間、JSONL session 檔案路徑
- **SubAgent（附屬角色）**: Goose 呼叫子工具時 spawn 的臨時角色。屬於某個 Tester，顯示子工具的即時進度
- **Boss（主管角色）**: 代表使用者的常駐角色，擁有指令輸入框，可下達任務

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 使用者插入手機後 5 秒內，對應的 Tester 角色出現在畫面上
- **SC-002**: Boss 下達指令後 3 秒內，待命的 Tester 進入工作動畫
- **SC-003**: 同時連線 3 台裝置時，3 個 Tester 可分別獨立執行不同任務且狀態互不干擾
- **SC-004**: 停止按鈕點擊後 2 秒內，Tester 回到待命狀態
- **SC-005**: 子工具呼叫時，附屬角色在 1 秒內 spawn 並顯示在 Tester 附近
- **SC-006**: mock 開關切換後，mock 角色在 1 秒內顯示或消失
- **SC-007**: 80% 的首次使用者能在不看文件的情況下成功下達第一個測試指令

## Assumptions

- 使用者的開發環境已安裝 ADB 且在系統 PATH 中可呼叫
- MobileGoose 專案位於可透過環境變數或設定指定的路徑，內含 `start-goose.bat`
- `start-goose.bat` 需擴充支援 `--device <serial>` 參數來指定目標裝置（目前尚未支援，需由 MobileGoose 專案新增）
- `start-goose.bat` 接受 `run --device <serial> -t "<command>"` 參數格式來啟動測試 session
- 手機已開啟 USB 除錯並已授權（`adb devices` 顯示 `device` 而非 `unauthorized`）
- 本系統僅在 Vite dev server（瀏覽器模式）下運行，不需支援 VS Code extension 模式
- 每台裝置同一時間只會被一個 Tester 使用，不支援同一台手機跑多個 Goose session
- 辦公室 layout 中有足夠的座位容納合理數量的 Tester（≤10 台裝置）
- 子工具的事件格式遵循現有 `gooseEvents.ts` 定義的 `droidrun_plan / droidrun_action / droidrun_result` 結構
- 裝置序號在 ADB 連線期間保持穩定不變
