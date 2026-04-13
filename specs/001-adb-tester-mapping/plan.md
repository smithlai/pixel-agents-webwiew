# Implementation Plan: ADB 手機偵測與 Tester 自動產生系統

**Branch**: `001-adb-tester-mapping` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-adb-tester-mapping/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

為 GooseOffice pixel-art 辦公室視覺化系統新增 ADB 裝置自動偵測功能。每台連線的 Android 手機自動產生一個 Tester 角色，Boss 可透過指令輸入框下令，系統自動分配待命的 Tester 執行 MobileGoose 測試。工作中的 Tester 可被停止，子工具（DroidRun）spawn 附屬角色。現有 mock 角色透過 static boolean 控制開關。

## Technical Context

**Language/Version**: TypeScript 5.x (strict, erasableSyntaxOnly)  
**Primary Dependencies**: React 18, Vite 6, `ws` (WebSocket), Node.js `child_process`  
**Storage**: N/A (all state in-memory on server side)  
**Testing**: Vitest (webview-ui/test/), manual integration testing  
**Target Platform**: Windows (Vite dev server + Chrome browser)
**Project Type**: Web application (Vite dev server + React SPA)  
**Performance Goals**: ADB 偵測 ≤5s latency, task assign ≤3s, UI 60fps  
**Constraints**: Windows-only (PowerShell/cmd spawn), ADB in PATH  
**Scale/Scope**: ≤10 concurrent devices, single operator (Boss)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution is an unfilled template — no project-specific gates defined. Proceeding with standard engineering practices:

- [x] No unnecessary abstractions (YAGNI)
- [x] Changes are additive, no breaking changes to existing interfaces
- [x] Existing mock system preserved behind flag
- [x] All new REST endpoints follow existing pattern in viteGoosePlugin.ts

## Project Structure

### Documentation (this feature)

```text
specs/001-adb-tester-mapping/
├── plan.md                              # This file
├── spec.md                              # Feature specification
├── research.md                          # Phase 0 output
├── data-model.md                        # Phase 1 output
├── quickstart.md                        # Phase 1 output
├── contracts/
│   └── rest-api.md                      # REST + WebSocket contract
├── external-dependency-mobilegoose.md   # MobileGoose 外部需求
└── checklists/
    └── requirements.md                  # Spec quality checklist
```

### Source Code (repository root)

```text
server/
├── adbPoller.ts          # NEW — ADB 裝置偵測輪詢器
├── deviceManager.ts      # NEW — DeviceAgent 生命週期管理
├── eventTranslator.ts    # MODIFY — 支援動態 agentId
├── gooseWatcher.ts       # MODIFY — onFileFound 提供 serial 映射
├── viteGoosePlugin.ts    # MODIFY — 新增 /goose/devices, /goose/kill, 改造 /goose/run

webview-ui/src/
├── browserMock.ts        # MODIFY — ENABLE_MOCK_AGENTS 開關
├── gooseSocket.ts        # MODIFY — 處理新訊息類型 (devices-update, task-assigned, task-stopped)
├── components/
│   ├── AgentStatusPanel.tsx  # MODIFY — 停止按鈕
│   └── CommandInput.tsx      # MINOR — 錯誤提示顯示
├── hooks/
│   └── useExtensionMessages.ts  # MODIFY — 動態 agent 建立/移除
└── office/
    └── agentProfiles.ts     # MODIFY — 動態 Tester profile 生成
```

**Structure Decision**: 延續現有的 server/ + webview-ui/ 雙層結構。新增 `adbPoller.ts` 和 `deviceManager.ts` 作為獨立模組，由 `viteGoosePlugin.ts` 整合。不引入新的頂層目錄。

## Complexity Tracking

No constitution violations to justify — all changes follow existing patterns.
