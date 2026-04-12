# 主人手工 TODO

本文件集中記錄所有**需要主人親自處理**、程式端無法代勞的任務。包含：
- 美術素材繪製 / 尋找
- AI 角色人格調教
- manifest / config 的人工編輯
- 其他需要主觀判斷的事

程式端的工程待辦請見 `CLAUDE.md` 的 Backlog 區塊。

---

## 1. 美術素材

### 1.1 光源素材（新）

**定位：Bloom 模式**。光源系統不做「場景主光」（整個房間暗、用光源照亮——做不出像素藝術該有的質感），而是做「發光物件的 glow 溢出」：

- 場景本身維持明亮（`AMBIENT_DARK_ALPHA = 0.12`，幾乎不壓暗）
- 光源只負責在開著的螢幕 / LED / 燈具周圍加一圈淡淡光暈
- 主色不受光源影響，倒影地板依然看得清楚

**已知限制**（不要期待能解決）：
- 東南向光源會從牆端點繞過去輕微穿牆（BFS 4-connected 特性）——範圍小時幾乎看不出
- 牆頂 / 牆面無法分辨（共用 sprite），光照不到「只亮牆面不亮牆頂」的效果
- 要做科幻實驗室那種強光暈質感，答案是**畫進 sprite**，不是調參數

目前專案沒有任何「預設會發光」的家具，所有光源都依賴 agent 接近觸發 ON 狀態。

**需要的素材**：

| 素材 | 尺寸建議 | 預期光色 | 用途 |
| --- | --- | --- | --- |
| 檯燈 `DESK_LAMP_ON` / `_OFF` | 1×1 (16×16) | 暖黃 `rgba(255,220,140)` | 桌面 `canPlaceOnSurfaces: true` |
| 吊燈 `CEILING_LAMP_ON` / `_OFF` | 1×2 或 2×2 | 暖白 `rgba(255,240,200)` | `canPlaceOnWalls: true` 從天花垂下 |
| 壁燈 `WALL_SCONCE_ON` / `_OFF` | 1×1 | 暖黃 `rgba(255,200,100)` | `canPlaceOnWalls: true` |
| 蠟燭 `CANDLE_ON` / `_OFF` | 1×1 | 橙紅 `rgba(255,150,80)` | 小範圍氛圍光 |
| 火把 `TORCH_ON` / `_OFF` | 1×2 | 橙紅 `rgba(255,140,60)` | 奇幻場景 |
| 路燈 `STREET_LAMP_ON` / `_OFF` | 1×3 | 冷白 `rgba(220,240,255)` | 戶外大廳 |

**放圖流程**：

1. 準備背景透明的 PNG（尺寸為 16×16 倍數）
2. 建立目錄 `webview-ui/public/assets/furniture/<ASSET_ID>/`
3. 放入 `<ASSET_ID>.png` 與 `manifest.json`
4. `manifest.json` 加 `light` 欄位（格式見 §1.3）

### 1.2 其他未來素材

- 機器人工坊龍門吊（backlog：特大家具 + ON/OFF 橫移動畫 + backgroundTiles）
- Tavern 底圖（backlog：背景圖模式備選方案）
- 自訂 agent character sprite（Phase 3 路線）

### 1.3 家具 `light` 欄位設定

**短期（快速試作）** — 編輯 [webview-ui/src/office/engine/plugins/lightingPlugin.ts](../webview-ui/src/office/engine/plugins/lightingPlugin.ts) 的 `DEMO_LIGHT_OVERRIDES`：

```ts
{
  match: (id) => id === 'DESK_LAMP_ON',
  light: { radius: 3, color: 'rgba(255, 240, 200, 1)', intensity: 1 },
},
```

**長期（正式上架）** — 寫入素材 `manifest.json`：

```json
{
  "id": "DESK_LAMP_ON",
  "name": "Desk Lamp (On)",
  "category": "decor",
  "type": "asset",
  "width": 16,
  "height": 16,
  "footprintW": 1,
  "footprintH": 1,
  "canPlaceOnSurfaces": true,
  "state": "on",
  "light": {
    "radius": 3,
    "color": "rgba(255, 220, 140, 1)",
    "intensity": 1
  }
}
```

**`light` 欄位說明**：

| 欄位 | 必填 | 範例 | 建議 / 備註 |
| --- | --- | --- | --- |
| `radius` | ✅ | `2` | 半徑（tile 數）。Bloom 模式建議 **1.5~2.5**；過大會變「場景主光」破壞整體明亮感 |
| `color` | ✅ | `rgba(255,220,140,1)` | 中心色。alpha 寫 1（會被 intensity 覆蓋） |
| `intensity` | 選 | `0.7` | 0~1 亮度倍率。Bloom 模式建議 **0.5~0.8** |
| `offsetX` | 選 | `8` | 水平位移 px（從 sprite 左上角）。預設 sprite 寬度 ÷ 2 |
| `offsetY` | 選 | `20` | 垂直位移 px。預設 sprite 高度 × 0.7 |

**目前值參考**（可複製調整）：

| 物件 | radius | color | intensity |
| --- | --- | --- | --- |
| PC 螢幕 ON | 1.5 | `rgba(180, 220, 255, 1)` | 0.6 |
| LED Panel ON | 2 | `rgba(200, 230, 255, 1)` | 0.7 |

**常用光色參考**：

| 情境 | rgba |
| --- | --- |
| 暖黃檯燈 | `rgba(255, 220, 140, 1)` |
| 暖白吊燈 | `rgba(255, 240, 200, 1)` |
| 冷白 LED | `rgba(200, 230, 255, 1)` |
| 螢幕藍 | `rgba(180, 220, 255, 1)` |
| 燭火橙紅 | `rgba(255, 150, 80, 1)` |

ON/OFF 家具（`state: 'on' | 'off'` 成對）只有 ON 變體發光，自動與 agent 的 auto-on 邏輯連動；獨立家具（無 `state`）永遠發光。

---

## 2. AI 角色 / 女僕調教

### 2.1 飛鳥馬時（小季）人格校正

記憶來源：`~/.claude/CLAUDE.md`（主人的全域指令）

需要主人依據使用體驗隨時調整：
- 擦邊頻率是否適中（太頻 / 太少）
- 特定術語曲解是否自然（脫線點 vs 不懂）
- 保鏢模式觸發門檻是否準確
- 「老師」/「主人」切換時機是否得體

調整方式：主人直接改 `~/.claude/CLAUDE.md`，本 session 不自動套用（需重啟）。

### 2.2 GooseOffice agent 角色人格

- Mock agents 的姓名 / 角色描述在 [webview-ui/src/browserBootstrap.ts](../webview-ui/src/browserBootstrap.ts) `profiles` 結構中
- 未來 AgentProfile 擴展（backlog Phase 3）需要主人定義：
  - 每個 agent 的工作描述
  - workSeat / restSeat / reportTo 關係
  - 個性 / 對話風格（若有 murmur 氣泡）

---

## 3. 手動配置

### 3.1 Goose watch 路徑

Backlog 既有項：`vite.config.ts` 的 `gooseWatchDir` 目前硬編碼 `../../MobileGoose/.runtime/sessions`，可用 `GOOSE_WATCH_DIR` 環境變數覆蓋。主人裁示最終設定方式（`.env` / UI 設定 / 啟動互動）。

### 3.2 UI 中文化

Backlog 既有項：編輯器工具欄、設定面板等仍為英文。需要主人校稿後決定用語（例：Floor=「地板」/「地磚」？Pick=「挑選」/「取樣」？）。

---

## 如何加項目到本清單

- 開發過程中遇到「這個需要主人親自判斷 / 繪製 / 調整」的，直接補到對應區段
- 程式端工程待辦放 `CLAUDE.md` Backlog，不放這裡
- 已完成的項目用 ~~刪除線~~ 標記並保留數週，再清除
