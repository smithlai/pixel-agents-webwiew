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

  const layout = assetIndex.defaultLayout
    ? await fetch(`${base}assets/${assetIndex.defaultLayout}`).then((r) => r.json())
    : null;

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

  // ── Tester dispatches DroidClaw (sub-agent) ──────────────────────────────────
  after(4000, () => {
    swapTool(TESTER_ID, 'tester-plan', 'tester-dc', '派出 DroidClaw 執行裝置操作');
  });

  const dcSteps = [
    { id: 'dc-1', status: '操作裝置：點擊 Settings', delay: 4000 },
    { id: 'dc-2', status: '操作裝置：點擊 System → Languages', delay: 3000 },
    { id: 'dc-3', status: '操作裝置：點擊 Add a language', delay: 3500 },
    { id: 'dc-4', status: '操作裝置：選擇 Français (法語)', delay: 3000 },
    { id: 'dc-5', status: '操作裝置：確認語言切換完成', delay: 3500 },
  ];

  for (let i = 0; i < dcSteps.length; i++) {
    const step = dcSteps[i];
    const prev = i === 0 ? 'tester-dc' : dcSteps[i - 1].id;
    after(step.delay, () => {
      if (i === 0) {
        dispatch({ type: 'agentToolStart', id: TESTER_ID, toolId: step.id, status: step.status });
      } else {
        swapTool(TESTER_ID, prev, step.id, step.status);
      }
    });
  }

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

  // ── DroidClaw done, Tester verifies ─────────────────────────────────────────
  const lastDc = dcSteps[dcSteps.length - 1];
  after(3000, () => {
    dispatch({ type: 'agentToolDone', id: TESTER_ID, toolId: lastDc.id });
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
  // Seat IDs from default-layout-2.json furniture UIDs:
  //   Executive office (right-upper): exec-chair (CUSHIONED_CHAIR_BACK)
  //   Test lab 1 (upper-left):        lab1-chair1/2 (WOODEN_CHAIR_FRONT)
  //   Test lab 2 (upper-center):      lab2-chair1/2 (WOODEN_CHAIR_FRONT)
  //   Analysis room (right-lower):    analysis-chair1/2 (WOODEN_CHAIR_FRONT)
  //   Lobby bar (lower-left):         lobby-sofa1..4, bench1..4
  const PM_ID = 101;
  const ANALYST_ID = 102;
  const TESTER_ID = 103;
  const PM_SEAT = 'exec-chair';            // Executive office — PM's throne
  const ANALYST_SEAT = 'analysis-chair1';  // Analysis room — multi-monitor station
  const TESTER_SEAT = 'lab1-chair1';       // Test lab 1 workstation

  // Seat assignments:
  //   PM       → executive office (right-upper)
  //   Analyst  → analysis room (right-lower, multi-PC data station)
  //   Tester   → test lab 1 (upper-left)
  //   DroidClaw spawns will use lab1-chair2, lab2-chair1/2
  dispatch({
    type: 'existingAgents',
    agents: [PM_ID, ANALYST_ID, TESTER_ID],
    agentMeta: {
      [PM_ID]: { seatId: PM_SEAT },
      [ANALYST_ID]: { seatId: ANALYST_SEAT },
      [TESTER_ID]: { seatId: TESTER_SEAT },
    },
    folderNames: {
      [PM_ID]: 'PM',
      [ANALYST_ID]: 'Analyst',
      [TESTER_ID]: 'Tester',
    },
  });

  dispatch({ type: 'layoutLoaded', layout });
  dispatch({ type: 'settingsLoaded', soundEnabled: false });

  // PM and Analyst idle — will run mock scripts
  dispatch({ type: 'agentStatus', id: PM_ID, status: 'idle' });
  dispatch({ type: 'agentStatus', id: ANALYST_ID, status: 'idle' });
  // Tester starts idle — driven by WebSocket (real Goose events) or mock fallback
  dispatch({ type: 'agentStatus', id: TESTER_ID, status: 'idle' });

  // PM and Analyst always run mock scripts (background actors)
  scheduleMockTestSession(dispatch);

  // Tester: connect to Goose WebSocket for real events
  // (if server is not available, Tester just stays idle — that's fine)
  import('./gooseSocket.js').then(({ initGooseSocket }) => {
    initGooseSocket();
    console.log('[BrowserMock] Goose WebSocket client started for Tester agent');
  }).catch(() => {
    console.log('[BrowserMock] Goose WebSocket not available, Tester stays in mock mode');
  });

  console.log('[BrowserMock] Messages dispatched (with Goose mock agents)');
}
