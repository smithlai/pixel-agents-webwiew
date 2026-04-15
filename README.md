# GooseOffice — Goose AI Agent 像素風工作狀態儀表板

本專案是 [pixel-agents](https://github.com/pablodelucca/pixel-agents) 的 fork，將 webview-ui 抽出為獨立 web app，作為 **Goose AI Agent** 的像素風工作狀態儀表板。

- **上游**：[pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents)（MIT License）
- **姊妹專案**：MobileGoose（Goose + DroidRun 測試框架）

## 快速啟動

```bash
# 第一次設定：根目錄也需要安裝（供 Vite config 的 pngjs / ws 解析用）
npm install

# 安裝vitest
cd server
npm install
cd ..
# 安裝web相關套件
cd webview-ui
npm install

# 啟動
npm run dev
# 瀏覽器開啟 http://localhost:5173
```

不需要 VS Code。啟動後自動載入 mock 資料（5 個 Agent 的完整 demo 動畫）。

> **為何需要根目錄 `npm install`？**
> `vite.config.ts` 透過 Vite plugin 引用了 `../server/` 與 `../shared/assets/` 的程式碼，
> 這些目錄的模組解析路徑不包含 `webview-ui/node_modules/`。
> 根目錄安裝 `pngjs` / `ws` 後，esbuild 靜態分析就能正確解析，消除啟動時的 `[UNRESOLVED_IMPORT]` 警告。

## 連接真實 Goose 事件串流

GooseOffice 本身不執行 Goose。它負責的是：

- 監看 Goose 輸出的 JSONL 事件檔
- 透過 WebSocket 將事件即時推送到畫面
- 依狀態文字切換角色動畫、設備狀態與 sub-agent 顯示

未設定事件來源時，畫面只會有 Boss 角色待命。真正的 Agent 會在 Goose 事件進來時根據 DUT 自動 spawn；沒有任務的 Agent 會在辦公室裡閒晃，走幾步後回休息位坐下，坐膩了再起來散步。

> 想看熱鬧的假人 demo？把 `webview-ui/src/browserBootstrap.ts` 裡的 `ENABLE_MOCK_AGENTS` 改成 `true` 即可。

### 整合步驟

1. 準備一份會輸出 Goose JSONL 事件的專案（例如你自己的 MobileGoose fork）。

2. 在 `webview-ui/` 複製 [.env.example](webview-ui/.env.example) 為 `.env.local`（已加入 .gitignore，不會上傳），填入事件目錄：

   ```bash
   # webview-ui/.env.local（必填）
   GOOSE_WATCH_DIR=/你的/Goose專案/.runtime/sessions
   ```

   如果你也想從畫面下方的 Boss 指令列直接啟動 Goose，再加上（選填）：

   ```bash
   MOBILE_GOOSE_DIR=/你的/Goose專案
   ```

3. 啟動 dev server：

   ```bash
   cd webview-ui
   npm install
   npm run dev
   ```

4. 開啟瀏覽器後，當 `.runtime/sessions` 有新事件寫入，角色狀態就會開始同步。

> **只想快速試一次？** 也可以跳過 `.env.local`，直接用 shell 變數：
> ```bash
> GOOSE_WATCH_DIR=/path/to/sessions npm run dev
> ```

> **沒有真的 Goose？** 可以用模擬腳本做端對端驗證（檔案→watcher→WebSocket→瀏覽器）：
> ```bash
> npx tsx server/simulate-goose.ts
> ```

### 與 MobileGoose 的責任分界

目前 GooseOffice 需要的最小事件集合是：

- `session_start`
- `tool_start`
- `tool_args`
- `tool_end`
- `session_end`

如果 MobileGoose 端尚未實作更細的「動作對應表」，仍然不會阻塞整合；畫面會照常顯示角色狀態，只是多數 shell 行為會先以較通用的狀態文字呈現。

已經額外支援、但屬於可選強化的事件：

- `droidrun_plan`
- `droidrun_action`
- `droidrun_result`

這些事件存在時，GooseOffice 才會產生更細緻的 sub-agent 動畫與步驟顯示。

## Goose 狀態訊息來源

畫面上看到的工具狀態文字，來源分成三層：

1. **MobileGoose / Goose 事件生產端**
  - Goose 或其包裝器將執行過程輸出成 JSONL 事件。
  - 檔案位置通常是 `MobileGoose/.runtime/sessions/goose-events-*.jsonl`。
2. **GooseOffice 後端轉譯層**
  - [server/gooseWatcher.ts](server/gooseWatcher.ts) 監看 JSONL 檔案。
  - [server/eventTranslator.ts](server/eventTranslator.ts) 將 GooseEvent 轉成前端可理解的訊息。
3. **GooseOffice 前端顯示層**
  - [webview-ui/src/hooks/useExtensionMessages.ts](webview-ui/src/hooks/useExtensionMessages.ts) 接收並保存狀態。
  - [webview-ui/src/office/toolUtils.ts](webview-ui/src/office/toolUtils.ts) 依狀態前綴決定動畫類型，例如 `Read`、`Write`、`Bash`。

### 畫面上顯示的是 Goose 的什麼訊息？

目前畫面上的狀態文字，主要來自 GooseEvent 的：

- `tool_start.toolName`
- `tool_start.extension`
- `tool_args.key/value`
- `droidrun_*` 事件內的 `goal`、`decision`、`step`

例如：

- `tool_start(shell, developer)` 會先變成 `Bash: developer`
- 收到 `tool_args(command=...)` 後，會更新成更完整的狀態文字
- `droidrun_plan` 會轉成 `Subtask: DroidRun — ...`

### 想修改格式，要改哪裡？

依需求分成三種：

1. **改 Goose 原始事件格式**
  - 修改 MobileGoose 端的事件輸出邏輯
  - 同步更新 [server/gooseEvents.ts](server/gooseEvents.ts) 的型別定義
2. **改畫面顯示文字內容**
  - 修改 [server/eventTranslator.ts](server/eventTranslator.ts)
  - 主要入口是 `buildToolStatus()` 與 `buildToolStatusWithArgs()`
3. **改動畫分類規則**
  - 修改 [webview-ui/src/office/toolUtils.ts](webview-ui/src/office/toolUtils.ts) 的 `extractToolName()`
  - 如需新增「哪些工具算 reading / typing」，再同步看 [webview-ui/src/office/engine/characters.ts](webview-ui/src/office/engine/characters.ts)

### 設備互動是怎麼判定的？

角色不是靠辨識「這是電腦、這是鍵盤」來互動。

目前的邏輯是：

- 角色坐到座位後，系統根據座位朝向，檢查前方桌面 tile
- 前方 tile 上的電子設備會被視為可互動設備
- 可互動時，設備會切到 `on` state，並在有動畫幀時播放動畫

核心邏輯在 [webview-ui/src/office/engine/officeState.ts](webview-ui/src/office/engine/officeState.ts)。

這表示互動判定依賴的是：

- 座位 facing direction
- 家具 footprint / state / animation manifest
- 家具是否擺在角色面前的 desk tile 上

而不是靠鍵盤或螢幕的像素內容做影像辨識。

## Agent Profile 客製化

Agent 與房間/座位的綁定定義在 [`webview-ui/src/office/agentProfiles.ts`](webview-ui/src/office/agentProfiles.ts)：

| Profile Key | 名稱 | 房間 | 工位 | 休息位 | 上司 |
|-------------|------|------|------|--------|------|
| `boss` | Boss | 主管辦公室 | exec-chair | exec-chair | — |
| `pm` | ST PM | 主管辦公室 | exec-chair-pm | lobby-sofa1 | Boss |
| `analyst` | ST Analyst | 分析室 | analysis-chair1 | lobby-sofa2 | PM |
| `tester` | ST Tester | 測試實驗室 1 | lab1-chair1 | lobby-sofa3 | PM |
| `tester2` | ST Tester 2 | 測試實驗室 2 | lab2-chair1 | lobby-sofa4 | PM |
| `tester3` | ST Tester 3 | 分析室 | analysis-chair2 | lobby-bench3 | PM |

- **DroidRun** 不是常駐 agent，而是 Tester 派出的 sub-agent。執行裝置操作時以光柱特效動態 spawn，完成後 despawn 消散。

- **工位 / 休息位的 UID** 必須對應 [`default-layout-2.json`](webview-ui/public/assets/default-layout-2.json) 中的家具 `uid`
- **reportTo** 決定空間行為動線：收到任務時先走到上司桌前匯報 → 開始工作後走回自己工位 → 結束後走去休息位

## 房間佈局客製化

辦公室佈局儲存在 `webview-ui/public/assets/default-layout-2.json`（32×28 格線）。可透過內建的 Layout Editor 修改（啟動後點擊「Layout」按鈕），或直接編輯 JSON。

目前房間配置：
- **主管辦公室**（Executive Office）— 右上角
- **測試實驗室 1 & 2**（Test Lab）— 左上方
- **分析室**（Analysis Room）— 右下方
- **休息吧**（Lobby Bar）— 下方

## 技術架構

```
webview-ui/          — React + Vite 前端（可獨立運行）
server/              — Goose 事件串流後端（Vite plugin）
  gooseWatcher.ts    — JSONL 檔案監視
  eventTranslator.ts — GooseEvent → webview 訊息轉譯
  viteGoosePlugin.ts — WebSocket 升級處理
shared/assets/       — PNG 解碼器、資產載入（extension + browser 通用）
```

**雙模式運行**：
- **瀏覽器模式**：Vite dev server + WebSocket 事件串流 + mock fallback
- **VS Code 模式**：原版 extension postMessage IPC（見下方原版說明）

## 近期功能更新

| 功能 | 說明 |
|------|------|
| Agent 動線可視化 | 角色移動時，從當前位置到目標畫出半透明藍色虛線，終點標示圓點，到達即消失 |
| DroidRun 動態 spawn | Tester 派出 DroidRun 時以 Matrix 光柱特效動態出現，任務完成後消散 |
| Boss 角色 + 指令輸入框 | 畫面下方可輸入指令觸發 Boss 動畫，PM 自動前往 Boss 桌前匯報 |
| 空間行為動線 | Agent 收到任務→匯報上司→走回工位工作→完成→走去休息位 |
| 瀏覽器 Layout 持久化 | F5 重載後佈局不再重置，透過 server-side state 保存 |
| 工具列收折 | 左下角工具列預設收起，點漢堡按鈕展開，減少畫面遮擋 |

---

# 以下為原版 pixel-agents README

---

<h1 align="center">
    <a href="https://github.com/pablodelucca/pixel-agents/discussions">
        <img src="webview-ui/public/banner.png" alt="Pixel Agents">
    </a>
</h1>

<h2 align="center" style="padding-bottom: 20px;">
  The game interface where AI agents build real things
</h2>

<div align="center" style="margin-top: 25px;">

[![version](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fpablodelucca%2F3cd28398fa4a2c0a636e1d51d41aee39%2Fraw%2Fversion.json)](https://github.com/pablodelucca/pixel-agents/releases)
[![marketplaces](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fpablodelucca%2F3cd28398fa4a2c0a636e1d51d41aee39%2Fraw%2Finstalls.json)](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents)
[![stars](https://img.shields.io/github/stars/pablodelucca/pixel-agents?logo=github&color=0183ff&style=flat)](https://github.com/pablodelucca/pixel-agents/stargazers)
[![license](https://img.shields.io/github/license/pablodelucca/pixel-agents?color=0183ff&style=flat)](https://github.com/pablodelucca/pixel-agents/blob/main/LICENSE)
[![good first issues](https://img.shields.io/github/issues/pablodelucca/pixel-agents/good%20first%20issue?color=7057ff&label=good%20first%20issues)](https://github.com/pablodelucca/pixel-agents/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)

</div>

<div align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents">🛒 VS Code Marketplace</a> • <a href="https://github.com/pablodelucca/pixel-agents/discussions">💬 Discussions</a> • <a href="https://github.com/pablodelucca/pixel-agents/issues">🐛 Issues</a> • <a href="CONTRIBUTING.md">🤝 Contributing</a> • <a href="CHANGELOG.md">📋 Changelog</a>
</div>

<br/>

Pixel Agents turns multi-agent AI systems into something you can actually see and manage. Each agent becomes a character in a pixel art office. They walk around, sit at their desk, and visually reflect what they are doing — typing when writing code, reading when searching files, waiting when it needs your attention.

Right now it works as a VS Code extension with Claude Code. The vision though, is a fully agent-agnostic, platform-agnostic interface for orchestrating any AI agents, deployable anywhere.

This is the source code for the free Pixel Agents extension for VS Code — install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) or [Open VSX](https://open-vsx.org/extension/pablodelucca/pixel-agents) with the full furniture catalog included.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **One agent, one character** — every Claude Code terminal gets its own animated character
- **Live activity tracking** — characters animate based on what the agent is actually doing (writing, reading, running commands)
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Sub-agent visualization** — Task tool sub-agents spawn as separate characters linked to their parent
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **External asset directories** — load custom or third-party furniture packs from any folder on your machine
- **Diverse characters** — 6 diverse characters. These are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- VS Code 1.105.0 or later
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured
- **Platform**: Windows, Linux, and macOS are supported

## Getting Started

If you just want to use Pixel Agents, the easiest way is to download the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents). If you want to play with the code, develop, or contribute, then:

### Install from source

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Usage

1. Open the **Pixel Agents** panel (it appears in the bottom panel area alongside your terminal)
2. Click **+ Agent** to spawn a new Claude Code terminal and its character. Right-click for the option to launch with `--dangerously-skip-permissions` (bypasses all tool approval prompts)
3. Start coding with Claude — watch the character react in real time
4. Click a character to select it, then click a seat to reassign it
5. Click **Layout** to open the office editor and customize your space

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

The grid is expandable up to 64×64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

All office assets (furniture, floors, walls) are now **fully open-source** and included in this repository under `webview-ui/public/assets/`. No external purchases or imports are needed — everything works out of the box.

Each furniture item lives in its own folder under `assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups (on/off), and animation frames. Floor tiles are individual PNGs in `assets/floors/`, and wall tile sets are in `assets/walls/`. This modular structure makes it easy to add, remove, or modify assets without touching any code.

To add a new furniture item, create a folder in `webview-ui/public/assets/furniture/` with your PNG sprite(s) and a `manifest.json`, then rebuild. The asset manager (`scripts/asset-manager.html`) provides a visual editor for creating and editing manifests.

To use furniture from an external directory, open Settings → **Add Asset Directory**. See [docs/external-assets.md](docs/external-assets.md) for the full manifest format and how to use third-party asset packs.

Characters are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

## How It Works

Pixel Agents watches Claude Code's JSONL transcript files to track what each agent is doing. When an agent uses a tool (like writing a file or running a command), the extension detects it and updates the character's animation accordingly. No modifications to Claude Code are needed — it's purely observational.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle → walk → type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Agent-terminal sync** — the way agents are connected to Claude Code terminal instances is not super robust and sometimes desyncs, especially when terminals are rapidly opened/closed or restored across sessions.
- **Heuristic-based status detection** — Claude Code's JSONL transcript format does not provide clear signals for when an agent is waiting for user input or when it has finished its turn. The current detection is based on heuristics (idle timers, turn-duration events) and often misfires — agents may briefly show the wrong status or miss transitions.
- **Linux/macOS tip** — if you launch VS Code without a folder open (e.g. bare `code` command), agents will start in your home directory. This is fully supported; just be aware your Claude sessions will be tracked under `~/.claude/projects/` using your home directory as the project root.

## Troubleshooting

If your agent appears stuck on idle or doesn't spawn:

1. **Debug View** — In the Pixel Agents panel, click the gear icon (Settings), then toggle **Debug View**. This shows connection diagnostics per agent: JSONL file status, lines parsed, last data timestamp, and file path. If you see "JSONL not found", the extension can't locate the session file.
2. **Debug Console** — If you're running from source (Extension Development Host via F5), open VS Code's **View > Debug Console**. Search for `[Pixel Agents]` to see detailed logs: project directory resolution, JSONL polling status, path encoding mismatches, and unrecognized JSONL record types.

## Where This Is Going

The long-term vision is an interface where managing AI agents feels like playing the Sims, but the results are real things built.

- **Agents as characters** you can see, assign, monitor, and redirect, each with visible roles (designer, coder, writer, reviewer), stats, context usage, and tools.
- **Desks as directories** — drag an agent to a desk to assign it to a project or working directory.
- **An office as a project** — with a Kanban board on the wall where idle agents can pick up tasks autonomously.
- **Deep inspection** — click any agent to see its model, branch, system prompt, and full work history. Interrupt it, chat with it, or redirect it.
- **Token health bars** — rate limits and context windows visualized as in-game stats.
- **Fully customizable** — upload your own character sprites, themes, and office assets. Eventually maybe even move beyond pixel art into 3D or VR.

For this to work, the architecture needs to be modular at every level:

- **Platform-agnostic**: VS Code extension today, Electron app, web app, or any other host environment tomorrow.
- **Agent-agnostic**: Claude Code today, but built to support Codex, OpenCode, Gemini, Cursor, Copilot, and others through composable adapters.
- **Theme-agnostic**: community-created assets, skins, and themes from any contributor.

We're actively working on the core module and adapter architecture that makes this possible. If you're interested to talk about this further, please visit our [Discussions Section](https://github.com/pablodelucca/pixel-agents/discussions).


## Community & Contributing

Use **[Issues](https://github.com/pablodelucca/pixel-agents/issues)** to report bugs or request features. Join **[Discussions](https://github.com/pablodelucca/pixel-agents/discussions)** for questions and conversations.

See [CONTRIBUTING.md](CONTRIBUTING.md) for instructions on how to contribute.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Supporting the Project

If you find Pixel Agents useful, consider supporting its development:

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=pablodelucca/pixel-agents&type=Date)](https://www.star-history.com/?repos=pablodelucca%2Fpixel-agents&type=date&legend=bottom-right)

## License

This project is licensed under the [MIT License](LICENSE).
