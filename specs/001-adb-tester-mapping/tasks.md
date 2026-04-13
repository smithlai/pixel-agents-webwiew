# Tasks: ADB 手機偵測與 Tester 自動產生系統

**Input**: Design documents from `/specs/001-adb-tester-mapping/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in spec — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Server**: `server/` (Node.js, Vite plugin)
- **Frontend**: `webview-ui/src/` (React SPA)

---

## Phase 1: Setup

**Purpose**: Type definitions and shared constants for ADB/device features

- [ ] T001 Define AdbDevice and DeviceAgent types in server/deviceTypes.ts
- [ ] T002 [P] Define WebSocket message types (devices-update, task-assigned, task-stopped) in server/deviceTypes.ts
- [ ] T003 [P] Add DEVICE_AGENT_ID_START (200), ADB_POLL_INTERVAL_MS (5000), TESTRUN_PREFIX ("dev") constants to server/deviceTypes.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Server-side ADB polling and device lifecycle — MUST be complete before any user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Implement AdbPoller class in server/adbPoller.ts — parse `adb devices -l` output, extract serial/model/status, emit device list on change
- [ ] T005 Implement DeviceManager class in server/deviceManager.ts — manage DeviceAgent lifecycle (create on device found, remove on disconnect), agent ID allocation (200+), idle-since tracking
- [ ] T006 Modify EventTranslator constructor in server/eventTranslator.ts to accept dynamic agentId parameter (remove hardcoded 103)
- [ ] T007 Register AdbPoller and DeviceManager in server/viteGoosePlugin.ts configureServer() — start polling on server ready, broadcast devices-update via WebSocket on change
- [ ] T008 Add GET /goose/devices endpoint in server/viteGoosePlugin.ts per contracts/rest-api.md

**Checkpoint**: `adb devices -l` polling runs, devices appear at /goose/devices, WebSocket broadcasts device changes

---

## Phase 3: User Story 1 — ADB 偵測自動產生 Tester (Priority: P1) 🎯 MVP

**Goal**: 每台 ADB 連線手機自動在畫面上產生一個 Tester 角色

**Independent Test**: 插上手機 → Tester 出現；拔掉 → Tester 消失

### Implementation for User Story 1

- [ ] T009 [US1] Handle `devices-update` message in webview-ui/src/gooseSocket.ts — dispatch as window MessageEvent
- [ ] T010 [US1] Handle `devices-update` in webview-ui/src/hooks/useExtensionMessages.ts — call officeState.addAgent() for new devices, officeState.removeAgent() for disconnected devices (with spawn/despawn effects)
- [ ] T011 [US1] Create dynamic Tester profile generator in webview-ui/src/office/agentProfiles.ts — generateTesterProfile(serial, model, agentId) returning AgentProfile with auto-assigned room/seat
- [ ] T012 [US1] Wire devices-update into webview-ui/src/App.tsx — display device model as agent folderName, handle device removal during active state (show error status before despawn)
- [ ] T013 [US1] Handle unauthorized devices — log warning to console from DeviceManager, exclude from devices-update broadcast

**Checkpoint**: Plugging in a phone shows a Tester with device name; unplugging removes it with despawn effect

---

## Phase 4: User Story 2 — Boss 下令分配任務給 Tester (Priority: P1) 🎯 MVP

**Goal**: Boss 在對話框輸入指令 → 系統自動分配待命 Tester → 啟動 MobileGoose

**Independent Test**: 下指令 → Tester 進入工作狀態 → MobileGoose 啟動

### Implementation for User Story 2

- [ ] T014 [US2] Implement assignTask(command, serial?) in server/deviceManager.ts — pick idle Tester with longest idle time, generate testrun ID (dev-{serial}-{uuid8}), return assignment info
- [ ] T015 [US2] Refactor POST /goose/run in server/viteGoosePlugin.ts — call deviceManager.assignTask(), spawn with ANDROID_SERIAL env var and --testrun param, track ChildProcess PID, broadcast task-assigned via WebSocket
- [ ] T016 [US2] Add error responses to POST /goose/run per contracts/rest-api.md — 404 no_devices, 409 no_available_tester, 400 device_busy
- [ ] T017 [US2] Handle `task-assigned` message in webview-ui/src/gooseSocket.ts — dispatch as window MessageEvent
- [ ] T018 [US2] Handle `task-assigned` in webview-ui/src/hooks/useExtensionMessages.ts — call officeState.setAgentActive(agentId, true) to trigger walk-to-desk animation
- [ ] T019 [US2] Update webview-ui/src/App.tsx handleBossCommand — show error toast when /goose/run returns 404/409/400 instead of silently logging
- [ ] T020 [US2] Modify GooseWatcher onFileFound in server/viteGoosePlugin.ts — extract serial from JSONL filename via regex, route events to the matching DeviceAgent's EventTranslator
- [ ] T021 [US2] Wire process exit event in server/viteGoosePlugin.ts — on MobileGoose process exit, clear ActiveTask, broadcast task-stopped with reason "completed", reset DeviceAgent to idle

**Checkpoint**: Boss types command → idle Tester walks to seat → MobileGoose runs → JSONL events flow to correct Tester overlay

---

## Phase 5: User Story 3 — 任務狀態顯示與停止按鈕 (Priority: P2)

**Goal**: 工作中的 Tester 面板顯示即時進度 + 紅色停止按鈕

**Independent Test**: 分配任務 → 面板顯示進度 → 按停止 → Tester 回到待命

### Implementation for User Story 3

- [ ] T022 [US3] Add POST /goose/kill endpoint in server/viteGoosePlugin.ts — lookup active task by serial, call taskkill /T /F /PID, broadcast task-stopped with reason "user-stop"
- [ ] T023 [US3] Handle `task-stopped` message in webview-ui/src/gooseSocket.ts — dispatch as window MessageEvent
- [ ] T024 [US3] Handle `task-stopped` in webview-ui/src/hooks/useExtensionMessages.ts — call officeState.setAgentActive(agentId, false), clear tool overlays, remove all sub-agents
- [ ] T025 [US3] Add stop button to AgentCard in webview-ui/src/components/AgentStatusPanel.tsx — red ■ button visible only when agent is active, onClick calls POST /goose/kill with serial
- [ ] T026 [US3] Show device info in AgentCard for idle Testers in webview-ui/src/components/AgentStatusPanel.tsx — display serial and model name when no active task

**Checkpoint**: Active Tester shows tool status + stop button; pressing stop kills MobileGoose and Tester returns to idle

---

## Phase 6: User Story 4 — 子工具 Spawn 附屬角色 (Priority: P2)

**Goal**: DroidRun 呼叫時 spawn 附屬角色顯示步驟進度

**Independent Test**: Tester 的 Goose 呼叫 DroidRun → 附屬角色出現 → 完成後消失

### Implementation for User Story 4

- [ ] T027 [US4] Verify EventTranslator droidrun_plan/action/result translation in server/eventTranslator.ts — ensure agentToolStart with "Subtask:" prefix uses correct dynamic agentId per device
- [ ] T028 [US4] Verify subagent spawn/despawn in webview-ui/src/hooks/useExtensionMessages.ts — existing subagentToolStart/subagentClear messages should work with dynamic agent IDs (integration check, may need no code change)
- [ ] T029 [US4] Ensure stop button cascades to sub-agents in webview-ui/src/hooks/useExtensionMessages.ts — on task-stopped, removeAllSubagents(agentId) is called

**Checkpoint**: DroidRun events spawn a sub-agent near Tester with matrix rain; sub-agent despawns on tool completion or parent stop

---

## Phase 7: User Story 6 — 多任務併發與裝置隔離 (Priority: P2)

**Goal**: 多台手機同時工作，JSONL 事件流互不干擾

**Independent Test**: 2 台手機 → 2 指令 → 2 個 Tester 各自獨立顯示進度

### Implementation for User Story 6

- [ ] T030 [US6] Ensure DeviceManager.assignTask returns different Testers for sequential calls in server/deviceManager.ts — verify idle-since comparison selects correct Tester
- [ ] T031 [US6] Ensure GooseWatcher routes events from multiple JSONL files to correct EventTranslator instances in server/viteGoosePlugin.ts — verify per-file → per-serial → per-agentId mapping
- [ ] T032 [US6] Verify AgentStatusPanel renders multiple active Testers independently in webview-ui/src/components/AgentStatusPanel.tsx — each with own tool history and stop button

**Checkpoint**: Multiple Testers can run simultaneously with independent status displays

---

## Phase 8: User Story 5 — Mock 角色開關 (Priority: P3)

**Goal**: Mock 角色（PM、Analyst、Tester2、Tester3）透過 static boolean 開關控制

**Independent Test**: 改 ENABLE_MOCK_AGENTS = true → mock 角色出現；改回 false → 只剩 Boss + 真實 Tester

### Implementation for User Story 5

- [ ] T033 [US5] Add ENABLE_MOCK_AGENTS constant (default false) at top of webview-ui/src/browserMock.ts
- [ ] T034 [US5] Guard mock agent creation in dispatchMockMessages() in webview-ui/src/browserMock.ts — only dispatch existingAgents for PM/Analyst/Tester2/Tester3 and their mock sessions when ENABLE_MOCK_AGENTS is true; Boss (ID 100) always dispatched
- [ ] T035 [US5] Guard mock session schedulers in webview-ui/src/browserMock.ts — only call scheduleMockTestSession/scheduleMockTester2Session/scheduleMockTester3Session when ENABLE_MOCK_AGENTS is true

**Checkpoint**: With ENABLE_MOCK_AGENTS=false, only Boss appears; with true, all mock agents appear and run their scripts

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup and edge case hardening

- [ ] T036 [P] Add debounce (500ms) to handleBossCommand in webview-ui/src/App.tsx to prevent rapid-fire task assignment
- [ ] T037 [P] Handle ADB not in PATH gracefully in server/adbPoller.ts — log warning once, continue without polling
- [ ] T038 [P] Handle device disconnect during active task in server/deviceManager.ts — set state to error, broadcast devices-update, auto-remove after 3 seconds
- [ ] T039 Remove unused scheduleMockTestSession for Tester (ID 103) from webview-ui/src/browserMock.ts — already bypassed but dead code remains
- [ ] T040 Run quickstart.md validation — verify end-to-end flow matches documented steps

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 types — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — server devices + WebSocket
- **US2 (Phase 4)**: Depends on Phase 2 + Phase 3 (needs Tester agents to exist for assignment)
- **US3 (Phase 5)**: Depends on Phase 4 (needs active tasks to stop)
- **US4 (Phase 6)**: Depends on Phase 4 (needs task running with JSONL events)
- **US6 (Phase 7)**: Depends on Phase 4 (needs multiple devices + assignments)
- **US5 (Phase 8)**: Independent — can run after Phase 2
- **Polish (Phase 9)**: After all desired user stories

### User Story Dependencies

- **US1 (P1)**: Foundation only — can implement after Phase 2
- **US2 (P1)**: Requires US1 (Testers must exist to assign tasks)
- **US3 (P2)**: Requires US2 (active tasks must exist to stop)
- **US4 (P2)**: Requires US2 (JSONL events must flow to trigger DroidRun)
- **US5 (P3)**: Foundation only — fully independent
- **US6 (P2)**: Requires US2 — integration verification of concurrent behavior

### Within Each User Story

- Server-side changes before frontend changes
- WebSocket message handling before UI rendering
- Core flow before error handling

### Parallel Opportunities

- T001, T002, T003 can run in parallel (Phase 1)
- T004, T005 can run in parallel (both server modules, different files)
- T009, T010, T011 can run in parallel after Phase 2
- US5 (Phase 8) can run in parallel with any other user story
- T036, T037, T038, T039 can all run in parallel (Phase 9)

---

## Parallel Example: User Story 1

```
T009 [gooseSocket.ts]  ──┐
T010 [useExtensionMessages.ts] ──┼──→ T012 [App.tsx wiring]
T011 [agentProfiles.ts] ──┘
```

## Parallel Example: User Story 2

```
T014 [deviceManager.ts] ──→ T015 [viteGoosePlugin.ts /goose/run] ──→ T020 [JSONL routing]
                                                                  ──→ T021 [process exit]
T017 [gooseSocket.ts] ──→ T018 [useExtensionMessages.ts]
T016 [error responses] ──→ T019 [App.tsx error toast]
```

---

## Implementation Strategy

**MVP**: Phase 1 → Phase 2 → Phase 3 (US1) → Phase 4 (US2) — delivers "plug phone + type command → Tester works"

**Incremental Delivery**:
1. **MVP**: US1 + US2 — core plug-and-play testing
2. **Control**: US3 — stop button for safety
3. **Observability**: US4 + US6 — sub-agent visualization + multi-device
4. **Cleanup**: US5 + Polish — mock toggle + edge cases
