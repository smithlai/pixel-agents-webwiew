/**
 * 瀏覽器模式啟動器 — 載入素材並注入與 VS Code extension 相同的 postMessage 事件。
 *
 * 職責：
 * - 素材載入（優先使用 Vite middleware 預解碼 JSON，fallback PNG 解碼）
 * - 分派初始化事件（existingAgents, layoutLoaded, settingsLoaded 等）
 * - 啟動 mock agent 行為模擬（從 browserMockData.ts 引入）
 * - 連接 Goose WebSocket 事件串流
 *
 * 僅在瀏覽器模式下 import；VS Code webview 模式下被 tree-shaken 排除。
 */

import { rgbaToHex } from '../../shared/assets/colorUtils.ts';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
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
import { setCharacterFrameCanvases } from './office/sprites/spriteData.js';
// Mock session schedulers available for future use:
// import { scheduleMockTester2Session, scheduleMockTester3Session } from './browserMockData.js';
import { loadBrowserPersistedSettings, loadSavedLayout } from './webviewBridge.js';

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

/**
 * Enable/disable mock agents (PM, Analyst, Tester, Tester2, Tester3).
 * Persisted in localStorage so the Settings UI can toggle it without code changes.
 * Boss (ID 100) is always present regardless of this flag.
 */
export const ENABLE_MOCK_AGENTS = localStorage.getItem('mockAgentsEnabled') === 'true';

// ── PNG decode helpers (browser fallback) ───────────────────────────────────

interface DecodedPng {
  width: number;
  height: number;
  data: Uint8ClampedArray;
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

/** 僅針對高解析度 PNG 建立 frame canvases（Route B）。
 *  當走 JSON 快取路徑時呼叫，補上無法序列化的 HTMLCanvasElement。 */
async function buildHighResFrameCanvases(base: string, index: AssetIndex): Promise<void> {
  for (let i = 0; i < index.characters.length; i++) {
    const relPath = index.characters[i];
    const png = await decodePng(`${base}assets/${getIndexedAssetPath('characters', relPath)}`);
    const isHighRes = png.width > CHAR_FRAME_W * CHAR_FRAMES_PER_ROW;
    if (!isHighRes) continue;

    const srcFrameW = Math.floor(png.width / CHAR_FRAMES_PER_ROW);
    const srcFrameH = Math.floor(png.height / CHARACTER_DIRECTIONS.length);
    const imgData = new ImageData(png.data, png.width, png.height);
    const bitmap = await createImageBitmap(imgData);

    const frameCanvases: HTMLCanvasElement[][] = [];
    for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
      const dirFrames: HTMLCanvasElement[] = [];
      for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame++) {
        const sx = frame * srcFrameW;
        const sy = dirIdx * srcFrameH;
        const fc = document.createElement('canvas');
        fc.width = srcFrameW;
        fc.height = srcFrameH;
        fc.getContext('2d')!.drawImage(bitmap, sx, sy, srcFrameW, srcFrameH, 0, 0, srcFrameW, srcFrameH);
        dirFrames.push(fc);
      }
      frameCanvases.push(dirFrames);
    }
    bitmap.close();
    setCharacterFrameCanvases(i, frameCanvases);
    console.log(`[BrowserMock] Route B frame canvases built for char ${i} (${srcFrameW}×${srcFrameH})`);
  }
}

async function decodeCharactersFromPng(
  base: string,
  index: AssetIndex,
): Promise<CharacterDirectionSprites[]> {
  const sprites: CharacterDirectionSprites[] = [];
  for (const relPath of index.characters) {
    const png = await decodePng(`${base}assets/${getIndexedAssetPath('characters', relPath)}`);
    const byDir: CharacterDirectionSprites = { down: [], up: [], right: [] };

    const isHighRes = png.width > CHAR_FRAME_W * CHAR_FRAMES_PER_ROW;

    if (isHighRes) {
      // 高解析度素材：用 createImageBitmap（正確處理 premultiplied alpha）
      const srcFrameW = Math.floor(png.width / CHAR_FRAMES_PER_ROW);
      const srcFrameH = Math.floor(png.height / CHARACTER_DIRECTIONS.length);

      // 從 RGBA 原始資料建 bitmap（瀏覽器原生，alpha 正確）
      const imgData = new ImageData(png.data, png.width, png.height);
      const bitmap = await createImageBitmap(imgData);

      // 預切幀：每幀獨立 canvas，直接從 bitmap 切出正確像素邊界
      const frameCanvases: HTMLCanvasElement[][] = [];
      // 同時準備 SpriteData fallback（供 outline / matrix effect 用）
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = CHAR_FRAME_W;
      smallCanvas.height = CHAR_FRAME_H;
      const smallCtx = smallCanvas.getContext('2d')!;
      smallCtx.imageSmoothingEnabled = true;
      smallCtx.imageSmoothingQuality = 'high';

      for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
        const dir = CHARACTER_DIRECTIONS[dirIdx];
        const dirFrames: HTMLCanvasElement[] = [];
        const spriteFrames: string[][][] = [];

        for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame++) {
          const sx = frame * srcFrameW;
          const sy = dirIdx * srcFrameH;

          // 高解析度幀 canvas（原始尺寸，renderer 用 drawImage 縮放）
          const fc = document.createElement('canvas');
          fc.width = srcFrameW;
          fc.height = srcFrameH;
          fc.getContext('2d')!.drawImage(bitmap, sx, sy, srcFrameW, srcFrameH, 0, 0, srcFrameW, srcFrameH);
          dirFrames.push(fc);

          // SpriteData fallback（16×32 縮小版）
          smallCtx.clearRect(0, 0, CHAR_FRAME_W, CHAR_FRAME_H);
          smallCtx.drawImage(bitmap, sx, sy, srcFrameW, srcFrameH, 0, 0, CHAR_FRAME_W, CHAR_FRAME_H);
          spriteFrames.push(readSprite(
            { width: CHAR_FRAME_W, height: CHAR_FRAME_H, data: smallCtx.getImageData(0, 0, CHAR_FRAME_W, CHAR_FRAME_H).data },
            CHAR_FRAME_W, CHAR_FRAME_H,
          ));
        }

        frameCanvases.push(dirFrames);
        byDir[dir] = spriteFrames;
      }

      bitmap.close();
      setCharacterFrameCanvases(sprites.length, frameCanvases);
    } else {
      for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
        const dir = CHARACTER_DIRECTIONS[dirIdx];
        const rowOffsetY = dirIdx * CHAR_FRAME_H;
        const frames: string[][][] = [];
        for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame++) {
          frames.push(readSprite(png, CHAR_FRAME_W, CHAR_FRAME_H, frame * CHAR_FRAME_W, rowOffsetY));
        }
        byDir[dir] = frames;
      }
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

  // 即使走 JSON 快取路徑，高解析度角色的 frame canvases 也需要額外建立
  // （JSON 只存 SpriteData，無法序列化 HTMLCanvasElement）
  if (hasDecoded) {
    await buildHighResFrameCanvases(base, assetIndex);
  }

  // Prefer saved layout from server state, fall back to default asset
  const savedLayout = await loadSavedLayout();
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

/**
 * Call inside a useEffect in App.tsx — after the window message listener
 * in useExtensionMessages has been registered.
 */
export async function dispatchMockMessages(): Promise<void> {
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
  const SECRETARY_ID = 101;
  const PM_ID = 102;
  const BUNNY1_ID = 103;
  const BUNNY2_ID = 104;

  // Boss is always present; NPC mock agents gate on ENABLE_MOCK_AGENTS
  const mockAgentIds: number[] = [BOSS_ID];
  const mockMeta: Record<number, { seatId: string; palette?: number }> = {
    [BOSS_ID]: { seatId: profiles.boss.workSeat },
  };
  const mockNames: Record<number, string> = {
    [BOSS_ID]: profiles.boss.name,
  };
  if (ENABLE_MOCK_AGENTS) {
    const npcEntries: Array<[number, string]> = [
      [SECRETARY_ID, 'npc_secretary'],
      [PM_ID, 'npc_pm'],
      [BUNNY1_ID, 'npc_bunny1'],
      [BUNNY2_ID, 'npc_bunny2'],
    ];
    for (const [id, key] of npcEntries) {
      const p = profiles[key];
      mockAgentIds.push(id);
      mockMeta[id] = { seatId: p.workSeat, palette: p.sprite };
      mockNames[id] = key;
    }
  }

  dispatch({
    type: 'existingAgents',
    agents: mockAgentIds,
    agentMeta: mockMeta,
    folderNames: mockNames,
  });

  dispatch({ type: 'layoutLoaded', layout });

  // 從 server 載入已儲存的設定，覆蓋 mock 預設值
  const persisted = await loadBrowserPersistedSettings();
  dispatch({
    type: 'settingsLoaded',
    soundEnabled: false,
    extensionVersion: '1.2.0',
    lastSeenVersion: '1.2',
    watchAllSessions: false,
    hooksEnabled: false,
    hooksInfoShown: true,
    alwaysShowLabels: true,
    externalAssetDirectories: [],
    ...persisted,
  });

  // All present agents start idle
  for (const id of mockAgentIds) {
    dispatch({ type: 'agentStatus', id, status: 'idle' });
  }

  // Goose WebSocket 事件串流
  import('./gooseSocket.js').then(({ initGooseSocket }) => {
    initGooseSocket();
  }).catch(() => {});

  console.log('[BrowserMock] Messages dispatched (with Goose mock agents)');
}
