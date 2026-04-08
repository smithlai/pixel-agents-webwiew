/**
 * Browser runtime mock — fetches assets and injects the same postMessage
 * events the VS Code extension would send.
 *
 * In Vite dev, it prefers pre-decoded JSON endpoints from middleware.
 * In plain browser builds, it falls back to decoding PNGs at runtime.
 *
 * Only imported in browser runtime; tree-shaken from VS Code webview runtime.
 */

import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  PNG_ALPHA_THRESHOLD,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from '../../shared/assets/constants.ts';
import type {
  AssetIndex,
  CatalogEntry,
  CharacterDirectionSprites,
} from '../../shared/assets/types.ts';
import { DEFAULT_PROFILES as profiles } from './office/agentProfiles.js';
import { loadSavedLayout } from './vscodeApi.js';

interface MockPayload {
  characters: CharacterDirectionSprites[];
  floorSprites: string[][][];
  wallSets: string[][][][];
  furnitureCatalog: CatalogEntry[];
  furnitureSprites: Record<string, string[][]>;
  layout: unknown;
}

// ── Module-level state ─────────────────────────────────────────────────────────

let mockPayload: MockPayload | null = null;

// ── PNG decode helpers (browser fallback) ───────────────────────────────────

interface DecodedPng {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  if (a < PNG_ALPHA_THRESHOLD) return '';
  const rgb =
    `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  if (a >= 255) return rgb;
  return `${rgb}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

function getPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
}

function readSprite(
  png: DecodedPng,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): string[][] {
  const sprite: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(png.data, png.width, offsetX + x, offsetY + y);
      row.push(rgbaToHex(r, g, b, a));
    }
    sprite.push(row);
  }
  return sprite;
}

async function decodePng(url: string): Promise<DecodedPng> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch PNG: ${url} (${res.status.toString()})`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to create 2d canvas context for PNG decode');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: imageData.data };
}

async function fetchJsonOptional<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function getIndexedAssetPath(kind: 'characters' | 'floors' | 'walls', relPath: string): string {
  return relPath.startsWith(`${kind}/`) ? relPath : `${kind}/${relPath}`;
}

async function decodeCharactersFromPng(
  base: string,
  index: AssetIndex,
): Promise<CharacterDirectionSprites[]> {
  const sprites: CharacterDirectionSprites[] = [];
  for (const relPath of index.characters) {
    const png = await decodePng(`${base}assets/${getIndexedAssetPath('characters', relPath)}`);
    const byDir: CharacterDirectionSprites = { down: [], up: [], right: [] };

    for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
      const dir = CHARACTER_DIRECTIONS[dirIdx];
      const rowOffsetY = dirIdx * CHAR_FRAME_H;
      const frames: string[][][] = [];
      for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame++) {
        frames.push(readSprite(png, CHAR_FRAME_W, CHAR_FRAME_H, frame * CHAR_FRAME_W, rowOffsetY));
      }
      byDir[dir] = frames;
    }

    sprites.push(byDir);
  }
  return sprites;
}

async function decodeFloorsFromPng(base: string, index: AssetIndex): Promise<string[][][]> {
  const floors: string[][][] = [];
  for (const relPath of index.floors) {
    const png = await decodePng(`${base}assets/${getIndexedAssetPath('floors', relPath)}`);
    floors.push(readSprite(png, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE));
  }
  return floors;
}

async function decodeWallsFromPng(base: string, index: AssetIndex): Promise<string[][][][]> {
  const wallSets: string[][][][] = [];
  for (const relPath of index.walls) {
    const png = await decodePng(`${base}assets/${getIndexedAssetPath('walls', relPath)}`);
    const set: string[][][] = [];
    for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
      const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
      const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
      set.push(readSprite(png, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT, ox, oy));
    }
    wallSets.push(set);
  }
  return wallSets;
}

async function decodeFurnitureFromPng(
  base: string,
  catalog: CatalogEntry[],
): Promise<Record<string, string[][]>> {
  const sprites: Record<string, string[][]> = {};
  for (const entry of catalog) {
    const png = await decodePng(`${base}assets/${entry.furniturePath}`);
    sprites[entry.id] = readSprite(png, entry.width, entry.height);
  }
  return sprites;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Call before createRoot() in main.tsx.
 * Fetches all pre-decoded assets from the Vite dev server and stores them
 * for dispatchMockMessages().
 */
export async function initBrowserMock(): Promise<void> {
  console.log('[BrowserMock] Loading assets...');

  const base = import.meta.env.BASE_URL; // '/' in dev, '/sub/' with a subpath, './' in production

  const [assetIndex, catalog] = await Promise.all([
    fetch(`${base}assets/asset-index.json`).then((r) => r.json()) as Promise<AssetIndex>,
    fetch(`${base}assets/furniture-catalog.json`).then((r) => r.json()) as Promise<CatalogEntry[]>,
  ]);

  const shouldTryDecoded = import.meta.env.DEV;
  const [decodedCharacters, decodedFloors, decodedWalls, decodedFurniture] = shouldTryDecoded
    ? await Promise.all([
        fetchJsonOptional<CharacterDirectionSprites[]>(`${base}assets/decoded/characters.json`),
        fetchJsonOptional<string[][][]>(`${base}assets/decoded/floors.json`),
        fetchJsonOptional<string[][][][]>(`${base}assets/decoded/walls.json`),
        fetchJsonOptional<Record<string, string[][]>>(`${base}assets/decoded/furniture.json`),
      ])
    : [null, null, null, null];

  const hasDecoded = !!(decodedCharacters && decodedFloors && decodedWalls && decodedFurniture);

  if (!hasDecoded) {
    if (shouldTryDecoded) {
      console.log('[BrowserMock] Decoded JSON not found, decoding PNG assets in browser...');
    } else {
      console.log('[BrowserMock] Decoding PNG assets in browser...');
    }
  }

  const [characters, floorSprites, wallSets, furnitureSprites] = hasDecoded
    ? [decodedCharacters!, decodedFloors!, decodedWalls!, decodedFurniture!]
    : await Promise.all([
        decodeCharactersFromPng(base, assetIndex),
        decodeFloorsFromPng(base, assetIndex),
        decodeWallsFromPng(base, assetIndex),
        decodeFurnitureFromPng(base, catalog),
      ]);

  // Prefer saved layout from localStorage, fall back to default asset
  const savedLayout = loadSavedLayout();
  const layout = savedLayout
    ?? (assetIndex.defaultLayout
      ? await fetch(`${base}assets/${assetIndex.defaultLayout}`).then((r) => r.json())
      : null);

  mockPayload = {
    characters,
    floorSprites,
    wallSets,
    furnitureCatalog: catalog,
    furnitureSprites,
    layout,
  };

  console.log(
    `[BrowserMock] Ready (${hasDecoded ? 'decoded-json' : 'browser-png-decode'}) — ${characters.length} chars, ${floorSprites.length} floors, ${wallSets.length} wall sets, ${catalog.length} furniture items`,
  );
}

// ── Mock test session simulation ─────────────────────────────────────────────

/** Helper: dispatch a sequence of timed events to simulate a MobileGoose test run. */
function scheduleMockTestSession(dispatch: (data: unknown) => void): void {
  // Timeline helper — accumulates delay so steps are sequential
  let cursor = 0;
  function after(ms: number, fn: () => void): void {
    cursor += ms;
    setTimeout(fn, cursor);
  }

  // Swap tool status for a given agent (done old → start new)
  function swapTool(id: number, oldToolId: string, newToolId: string, status: string): void {
    dispatch({ type: 'agentToolDone', id, toolId: oldToolId });
    dispatch({ type: 'agentToolStart', id, toolId: newToolId, status });
  }

  const PM_ID = 101;
  const ANALYST_ID = 102;
  const TESTER_ID = 103;

  // Helper: make agent go idle (stand up, wander) while keeping overlay text
  function goIdle(id: number, toolId: string): void {
    dispatch({ type: 'agentToolDone', id, toolId });
    dispatch({ type: 'agentToolsClear', id });
    dispatch({ type: 'agentStatus', id, status: 'idle' });
  }

  // Helper: make agent active (walk back to seat, sit down, start tool)
  function goWork(id: number, toolId: string, status: string): void {
    dispatch({ type: 'agentStatus', id, status: 'active' });
    dispatch({ type: 'agentToolStart', id, toolId, status });
  }

  // ── PM reviews today's test plan ─────────────────────────────────────────────
  after(2000, () => {
    goWork(PM_ID, 'pm-plan', '審核今日測試計畫：STTL-181126 語言切換');
  });

  after(5000, () => {
    swapTool(PM_ID, 'pm-plan', 'pm-assign', '指派任務給 Tester：驗證多語言切換功能');
  });

  after(3000, () => {
    goIdle(PM_ID, 'pm-assign');
  });

  // ── Analyst starts background analysis ───────────────────────────────────────
  after(1000, () => {
    goWork(ANALYST_ID, 'analyst-read', '讀取歷史測試報告，分析失敗率趨勢');
  });

  after(6000, () => {
    swapTool(ANALYST_ID, 'analyst-read', 'analyst-stats', '統計近 7 日通過率：92.3% → 生成趨勢圖');
  });

  after(5000, () => {
    swapTool(ANALYST_ID, 'analyst-stats', 'analyst-report', '撰寫週報：語言切換模組穩定性分析');
  });

  // ── Tester receives task, reads test case ────────────────────────────────────
  after(1000, () => {
    goWork(TESTER_ID, 'tester-read', '收到任務，讀取測試案例 STTL-181126');
  });

  after(4000, () => {
    swapTool(TESTER_ID, 'tester-read', 'tester-parse', '解析前置條件：裝置需為英文環境');
  });

  after(3000, () => {
    swapTool(TESTER_ID, 'tester-parse', 'tester-plan', '規劃測試步驟：5 步驟自動化腳本');
  });

  // ── Tester dispatches DroidClaw (sub-agent spawn with matrix effect) ────────
  after(4000, () => {
    // Subtask: prefix triggers sub-agent spawn (matrix rain effect)
    swapTool(TESTER_ID, 'tester-plan', 'tester-dc', 'Subtask:DroidClaw 執行裝置操作');
  });

  // ── Mid-test: PM checks in ──────────────────────────────────────────────────
  after(2000, () => {
    goWork(PM_ID, 'pm-checkin', '確認 Tester 進度：DroidClaw 執行中');
  });

  after(4000, () => {
    swapTool(PM_ID, 'pm-checkin', 'pm-wait', '等待測試結果回報...');
  });

  // ── Analyst finishes report ─────────────────────────────────────────────────
  after(2000, () => {
    goIdle(ANALYST_ID, 'analyst-report');
  });

  // ── DroidClaw done (sub-agent despawn with matrix effect), Tester verifies ──
  after(15000, () => {
    dispatch({ type: 'agentToolDone', id: TESTER_ID, toolId: 'tester-dc' });
    dispatch({ type: 'agentToolsClear', id: TESTER_ID });
    goWork(TESTER_ID, 'tester-verify', '驗證結果：比對螢幕截圖與預期畫面');
  });

  after(4000, () => {
    swapTool(TESTER_ID, 'tester-verify', 'tester-screenshot', '擷取測試證據截圖');
  });

  // ── Tester reports to PM ────────────────────────────────────────────────────
  after(3000, () => {
    goIdle(TESTER_ID, 'tester-screenshot');
  });

  after(2000, () => {
    swapTool(PM_ID, 'pm-wait', 'pm-review', '審核測試報告：STTL-181126 語言切換');
  });

  after(4000, () => {
    swapTool(PM_ID, 'pm-review', 'pm-approve', '✓ 測試通過 — 簽核結案');
  });

  after(3000, () => {
    goIdle(PM_ID, 'pm-approve');
  });

  // ── Tester marks PASS ───────────────────────────────────────────────────────
  after(1000, () => {
    goWork(TESTER_ID, 'tester-result', '✓ PASS — STTL-181126 測試完成');
  });

  after(5000, () => {
    goIdle(TESTER_ID, 'tester-result');
  });

  // ── Analyst starts new task ─────────────────────────────────────────────────
  after(2000, () => {
    goWork(ANALYST_ID, 'analyst-new', '開始分析下一批測試數據');
  });

  after(8000, () => {
    goIdle(ANALYST_ID, 'analyst-new');
  });
}

/** Tester 3 agent mock — 分析室獨立測試循環 */
function scheduleMockTester3Session(dispatch: (data: unknown) => void, id: number): void {
  let cursor = 0;
  function after(ms: number, fn: () => void): void {
    cursor += ms;
    setTimeout(fn, cursor);
  }
  function goIdle(toolId: string): void {
    dispatch({ type: 'agentToolDone', id, toolId });
    dispatch({ type: 'agentToolsClear', id });
    dispatch({ type: 'agentStatus', id, status: 'idle' });
  }
  function goWork(toolId: string, status: string): void {
    dispatch({ type: 'agentStatus', id, status: 'active' });
    dispatch({ type: 'agentToolStart', id, toolId, status });
  }
  function swapTool(oldId: string, newId: string, status: string): void {
    dispatch({ type: 'agentToolDone', id, toolId: oldId });
    dispatch({ type: 'agentToolStart', id, toolId: newId, status });
  }

  // Round 1: API 相容性驗證
  after(6000, () => goWork('t3-read1', '讀取測試案例 STTL-300001 API 相容性'));
  after(8000, () => swapTool('t3-read1', 't3-exec1', '執行 API 端點回歸測試：12 個端點'));
  after(7000, () => swapTool('t3-exec1', 't3-verify1', '驗證結果：v2 → v3 回應格式比對'));
  after(6000, () => goIdle('t3-verify1'));

  // Round 2: 效能壓力測試
  after(5000, () => goWork('t3-perf', '執行效能壓力測試：並發 100 連線'));
  after(9000, () => swapTool('t3-perf', 't3-perf-check', '驗證：P95 回應時間 < 200ms'));
  after(5000, () => swapTool('t3-perf-check', 't3-perf-result', '✓ PASS — 效能測試通過'));
  after(6000, () => goIdle('t3-perf-result'));

  // Round 3: 安全掃描測試
  after(8000, () => goWork('t3-scan', '執行安全掃描測試：第三方套件漏洞'));
  after(10000, () => swapTool('t3-scan', 't3-patch', '驗證修補方案：3 個高風險項目'));
  after(6000, () => goIdle('t3-patch'));
}

/** Tester 2 agent mock — Lab 2 獨立測試循環，包含 DroidClaw 2 */
function scheduleMockTester2Session(dispatch: (data: unknown) => void, id: number): void {
  let cursor = 0;
  function after(ms: number, fn: () => void): void {
    cursor += ms;
    setTimeout(fn, cursor);
  }
  function goIdle(toolId: string): void {
    dispatch({ type: 'agentToolDone', id, toolId });
    dispatch({ type: 'agentToolsClear', id });
    dispatch({ type: 'agentStatus', id, status: 'idle' });
  }
  function goWork(toolId: string, status: string): void {
    dispatch({ type: 'agentStatus', id, status: 'active' });
    dispatch({ type: 'agentToolStart', id, toolId, status });
  }
  function swapTool(oldId: string, newId: string, status: string): void {
    dispatch({ type: 'agentToolDone', id, toolId: oldId });
    dispatch({ type: 'agentToolStart', id, toolId: newId, status });
  }

  // Round 1: 藍牙配對測試 STTL-200015
  after(8000, () => goWork('t2-read', '收到任務，讀取測試案例 STTL-200015 藍牙配對'));
  after(5000, () => swapTool('t2-read', 't2-plan', '規劃測試步驟：開啟藍牙 → 搜尋 → 配對 → 傳檔'));
  // Subtask: prefix triggers sub-agent spawn (matrix rain effect)
  after(4000, () => swapTool('t2-plan', 't2-dc', 'Subtask:DroidClaw 2 執行藍牙裝置操作'));

  // DroidClaw 2 sub-agent works for ~20s then done (despawn with matrix effect)
  after(20000, () => {
    dispatch({ type: 'agentToolDone', id, toolId: 't2-dc' });
    dispatch({ type: 'agentToolsClear', id });
    goWork('t2-verify', '驗證結果：檔案完整性比對');
  });
  after(5000, () => swapTool('t2-verify', 't2-result', '✓ PASS — STTL-200015 藍牙配對測試完成'));
  after(4000, () => goIdle('t2-result'));

  // Round 2: Wi-Fi 連線測試
  after(6000, () => goWork('t2-wifi-read', '收到任務，讀取測試案例 STTL-200022 Wi-Fi 切換'));
  after(5000, () => swapTool('t2-wifi-read', 't2-wifi-exec', '執行 Wi-Fi 斷線重連壓力測試'));
  after(8000, () => swapTool('t2-wifi-exec', 't2-wifi-verify', '驗證：連線恢復時間 < 3 秒'));
  after(4000, () => swapTool('t2-wifi-verify', 't2-wifi-result', '✓ PASS — STTL-200022 Wi-Fi 切換完成'));
  after(4000, () => goIdle('t2-wifi-result'));
}

/**
 * Call inside a useEffect in App.tsx — after the window message listener
 * in useExtensionMessages has been registered.
 */
export function dispatchMockMessages(): void {
  if (!mockPayload) return;

  const { characters, floorSprites, wallSets, furnitureCatalog, furnitureSprites, layout } =
    mockPayload;

  function dispatch(data: unknown): void {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  // Must match the load order defined in CLAUDE.md:
  // characterSpritesLoaded → floorTilesLoaded → wallTilesLoaded → furnitureAssetsLoaded → layoutLoaded
  dispatch({ type: 'characterSpritesLoaded', characters });
  dispatch({ type: 'floorTilesLoaded', sprites: floorSprites });
  dispatch({ type: 'wallTilesLoaded', sets: wallSets });
  dispatch({ type: 'furnitureAssetsLoaded', catalog: furnitureCatalog, sprites: furnitureSprites });
  // ── Goose mock agents (buffered before layoutLoaded) ─────────────────────────
  // Agent profiles define seat assignments and metadata (see agentProfiles.ts)
  const BOSS_ID = 100;
  const PM_ID = 101;
  const ANALYST_ID = 102;
  const TESTER_ID = 103;
  const TESTER3_ID = 104;
  const TESTER2_ID = 105;

  dispatch({
    type: 'existingAgents',
    agents: [BOSS_ID, PM_ID, ANALYST_ID, TESTER_ID, TESTER3_ID, TESTER2_ID],
    agentMeta: {
      [BOSS_ID]: { seatId: profiles.boss.workSeat },
      [PM_ID]: { seatId: profiles.pm.workSeat },
      [ANALYST_ID]: { seatId: profiles.analyst.workSeat },
      [TESTER_ID]: { seatId: profiles.tester.workSeat },
      [TESTER3_ID]: { seatId: profiles.tester3.workSeat },
      [TESTER2_ID]: { seatId: profiles.tester2.workSeat },
    },
    folderNames: {
      [BOSS_ID]: profiles.boss.name,
      [PM_ID]: profiles.pm.name,
      [ANALYST_ID]: profiles.analyst.name,
      [TESTER_ID]: profiles.tester.name,
      [TESTER3_ID]: profiles.tester3.name,
      [TESTER2_ID]: profiles.tester2.name,
    },
  });

  dispatch({ type: 'layoutLoaded', layout });
  dispatch({ type: 'settingsLoaded', soundEnabled: false });

  // All agents start idle — Boss stays idle unless user types command
  dispatch({ type: 'agentStatus', id: BOSS_ID, status: 'idle' });
  dispatch({ type: 'agentStatus', id: PM_ID, status: 'idle' });
  dispatch({ type: 'agentStatus', id: ANALYST_ID, status: 'idle' });
  dispatch({ type: 'agentStatus', id: TESTER_ID, status: 'idle' });
  dispatch({ type: 'agentStatus', id: TESTER3_ID, status: 'idle' });
  dispatch({ type: 'agentStatus', id: TESTER2_ID, status: 'idle' });

  // Tester2 and Tester3 always run mock scripts
  scheduleMockTester3Session(dispatch, TESTER3_ID);
  scheduleMockTester2Session(dispatch, TESTER2_ID);

  // Tester (ID 103): use real Goose events if server is watching, otherwise run mock
  // Tester (ID 103): always rely on real Goose events via WebSocket — no mock
  import('./gooseSocket.js').then(({ initGooseSocket }) => {
    initGooseSocket();
  }).catch(() => {});

  console.log('[BrowserMock] Messages dispatched (with Goose mock agents)');
}
