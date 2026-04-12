import { WALL_PIECE_HEIGHT } from '../../../../../shared/assets/constants.js';
import {
  AMBIENT_DARK_ALPHA,
  LIGHT_DEFAULT_COLOR,
  LIGHT_DEFAULT_OFFSET_RATIO,
  LIGHT_DEFAULT_RADIUS_TILES,
} from '../../../constants.js';
import { getCatalogEntry } from '../../layout/furnitureCatalog.js';
import type { LightSource, TileType as TileTypeVal } from '../../types.js';
import { TILE_SIZE, TileType } from '../../types.js';
import type { RenderContext, RenderPlugin } from './types.js';

/**
 * 'gradient' — 每個光源畫圓形 radial gradient（平滑燈池，需 clip 避免穿牆）
 * 'tile'     — 每格 1 個亮度值（方塊像素光，BFS 自帶擋光，無 clip）
 * 切這個常數即可比較兩種視覺。
 */
const LIGHT_MODE: 'gradient' | 'tile' = 'gradient';

/**
 * Temporary demo-source overrides, keyed by catalog asset id prefix.
 * Applied until the asset manifest gains a native `light` field.
 * Remove entries here as manifests are updated.
 *
 * 要新增光源素材 / 為家具指定光源屬性 → 見 docs/owner-todo.md §1 美術素材
 */
const DEMO_LIGHT_OVERRIDES: Array<{ match: (id: string) => boolean; light: LightSource }> = [
  // Bloom 模式：發光物件的 glow 溢出，半徑小、強度適中
  {
    // LED panels on wall — cool white bloom around the panel
    match: (id) => id.startsWith('LED_PANEL_FRONT_ON'),
    light: { radius: 2, color: 'rgba(200, 230, 255, 1)', intensity: 0.7 },
  },
  {
    // Monitors on desk — warm screen glow (ON variants only)
    match: (id) => id.startsWith('PC_FRONT_ON'),
    light: { radius: 1.5, color: 'rgba(180, 220, 255, 1)', intensity: 0.6 },
  },
];

function resolveLight(type: string | undefined): LightSource | null {
  if (!type) return null;
  const entry = getCatalogEntry(type);
  if (!entry) return null;
  // Only active (ON) state emits light. No state set → always on (e.g. lamps with no variants).
  if (entry.state && entry.state !== 'on') return null;
  if (entry.light) return entry.light;
  for (const { match, light } of DEMO_LIGHT_OVERRIDES) {
    if (match(type)) return light;
  }
  return null;
}

/**
 * Flood-fill visibility of tiles reachable from (startC, startR) within radius.
 * WALL tiles block further propagation but are themselves marked visible (lit wall face).
 * Out-of-bounds tiles are skipped.
 */
function computeVisibleTiles(
  tileMap: TileTypeVal[][],
  cols: number,
  rows: number,
  startC: number,
  startR: number,
  radiusTiles: number,
): Array<{ c: number; r: number }> {
  const out: Array<{ c: number; r: number }> = [];
  if (rows <= 0 || cols <= 0) return out;
  if (startR < 0 || startR >= rows || startC < 0 || startC >= cols) return out;

  const visited = new Set<string>();
  // BFS queue carries dy: 來源方向的列偏移（+1 = 從南邊/下方來的光）
  const queue: Array<{ c: number; r: number; d: number; dy: number }> = [
    { c: startC, r: startR, d: 0, dy: 0 },
  ];
  let qHead = 0;

  while (qHead < queue.length) {
    const node = queue[qHead++]!;
    const { c, r, d, dy } = node;
    if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
    const key = `${c},${r}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const tile = tileMap[r]?.[c];
    // Walls: 只有「光從南邊鄰居撞上來」(dy=+1, 從 r+1 傳到 r) 才亮
    // 這也擋掉了繞過牆端點從東/西/北側照到牆面的情況
    if (tile === TileType.WALL) {
      if (dy === 1) out.push({ c, r });
      continue;
    }
    out.push({ c, r });
    if (d >= radiusTiles) continue;

    queue.push({ c: c + 1, r, d: d + 1, dy: 0 });
    queue.push({ c: c - 1, r, d: d + 1, dy: 0 });
    queue.push({ c, r: r + 1, d: d + 1, dy: -1 }); // 往南擴散 → 下一格看見光是從北側(dy=-1)來
    queue.push({ c, r: r - 1, d: d + 1, dy: 1 }); // 往北擴散 → 下一格看見光是從南側(dy=+1)來
  }
  return out;
}

/**
 * BFS that returns brightness 0..1 per visited tile (1 at source, 0 at radius edge).
 * Walls only light their south face (startR > r) and block further propagation.
 */
function computeTileBrightness(
  tileMap: TileTypeVal[][],
  cols: number,
  rows: number,
  startC: number,
  startR: number,
  radiusTiles: number,
): Array<{ c: number; r: number; b: number }> {
  const out: Array<{ c: number; r: number; b: number }> = [];
  if (rows <= 0 || cols <= 0) return out;
  if (startR < 0 || startR >= rows || startC < 0 || startC >= cols) return out;

  const visited = new Set<string>();
  const queue: Array<{ c: number; r: number; d: number; dy: number }> = [
    { c: startC, r: startR, d: 0, dy: 0 },
  ];
  let qHead = 0;

  while (qHead < queue.length) {
    const node = queue[qHead++]!;
    const { c, r, d, dy } = node;
    if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
    const key = `${c},${r}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const brightness = Math.max(0, 1 - d / radiusTiles);
    const tile = tileMap[r]?.[c];
    if (tile === TileType.WALL) {
      // 只有光從南邊鄰居來（dy=+1）才亮牆面
      if (dy === 1) out.push({ c, r, b: brightness });
      continue;
    }
    out.push({ c, r, b: brightness });
    if (d >= radiusTiles) continue;

    queue.push({ c: c + 1, r, d: d + 1, dy: 0 });
    queue.push({ c: c - 1, r, d: d + 1, dy: 0 });
    queue.push({ c, r: r + 1, d: d + 1, dy: -1 });
    queue.push({ c, r: r - 1, d: d + 1, dy: 1 });
  }
  return out;
}

/** Lazy-initialized offscreen canvas for lighting compositing */
let _litCanvas: HTMLCanvasElement | null = null;
let _litCtx: CanvasRenderingContext2D | null = null;

function getLitCtx(w: number, h: number): CanvasRenderingContext2D {
  if (!_litCanvas) {
    _litCanvas = document.createElement('canvas');
  }
  if (_litCanvas.width !== w || _litCanvas.height !== h) {
    _litCanvas.width = w;
    _litCanvas.height = h;
    _litCtx = _litCanvas.getContext('2d')!;
  }
  _litCtx!.clearRect(0, 0, w, h);
  return _litCtx!;
}

/**
 * Build an "after-scene" lighting overlay.
 *
 * Pipeline:
 * 1. Fill offscreen canvas with ambient darkness (rgba black × AMBIENT_DARK_ALPHA)
 * 2. Per active light, erase a radial gradient (destination-out) — closer to source = more erased
 * 3. Composite offscreen → main canvas
 *
 * Result: dark environment with bright pools around active light sources.
 */
function render(rctx: RenderContext): void {
  const { ctx, offsetX, offsetY, zoom, cols, rows, furniture, tileMap } = rctx;

  // Collect active light sources first to early-out the no-light case.
  type ActiveLight = {
    cx: number; cy: number; radius: number;
    color: string; intensity: number;
    lc: number; lr: number; radiusTiles: number;
  };
  const lights: ActiveLight[] = [];
  for (const f of furniture) {
    const light = resolveLight(f.type);
    if (!light) continue;
    const cached = f.sprite;
    const spriteW = cached[0]?.length ?? TILE_SIZE;
    const spriteH = cached.length || TILE_SIZE;
    const lx = f.x + (light.offsetX ?? spriteW / 2);
    const ly = f.y + (light.offsetY ?? spriteH * LIGHT_DEFAULT_OFFSET_RATIO);
    const cx = offsetX + lx * zoom;
    const cy = offsetY + ly * zoom;
    const radiusTiles = light.radius || LIGHT_DEFAULT_RADIUS_TILES;
    const radius = radiusTiles * TILE_SIZE * zoom;
    lights.push({
      cx,
      cy,
      radius,
      color: light.color || LIGHT_DEFAULT_COLOR,
      intensity: light.intensity ?? 1,
      lc: Math.floor(lx / TILE_SIZE),
      lr: Math.floor(ly / TILE_SIZE),
      radiusTiles,
    });
  }

  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;
  const off = getLitCtx(canvasW, canvasH);

  // Map-bounded fill region (avoid darkening outside the playable area)
  const mapX = offsetX;
  const mapY = offsetY;
  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;

  const tileW = TILE_SIZE * zoom;

  if (LIGHT_MODE === 'gradient') {
    // ── Gradient mode: smooth radial pools + BFS wall occlusion ───────────────
    // BFS 半徑放大 2 倍只用來找「光到得了的 tile」（擋牆用），gradient 自己 falloff。
    // 這樣避免 BFS Manhattan 距離與 gradient Euclidean 半徑不匹配造成方塊鋸齒。
    off.fillStyle = `rgba(0, 0, 0, ${AMBIENT_DARK_ALPHA})`;
    off.fillRect(mapX, mapY, mapW, mapH);

    if (lights.length > 0) {
      // 牆 sprite 高度以 tile 為單位（從 shared constants 派生，不寫死）。
      // WALL_PIECE_HEIGHT=32, TILE_SIZE=16 → wallTileSpan=2（底座1 + 立面1）
      const wallTileSpan = Math.max(1, Math.round(WALL_PIECE_HEIGHT / TILE_SIZE));
      const facadeSpan = wallTileSpan - 1; // 立面額外佔幾格（往上）

      // clip 規則：
      //  - WALL visible tile → 涵蓋自己 + 上方立面（共 wallTileSpan 格高）
      //  - non-WALL visible tile → 涵蓋自己；若下方是 WALL 但 WALL 不 visible，
      //    用 evenodd 扣掉立面區（避免立面被從背後的走廊照亮）
      const clipToTiles = (visible: Array<{ c: number; r: number }>): void => {
        const visibleSet = new Set<string>();
        for (const { c, r } of visible) visibleSet.add(`${c},${r}`);

        off.beginPath();
        // 外層：union 所有 visible tile（WALL 延伸到立面）
        for (const { c, r } of visible) {
          const tile = tileMap[r]?.[c];
          if (tile === TileType.WALL) {
            off.rect(
              offsetX + c * tileW,
              offsetY + (r - facadeSpan) * tileW,
              tileW,
              tileW * wallTileSpan,
            );
          } else {
            off.rect(offsetX + c * tileW, offsetY + r * tileW, tileW, tileW);
          }
        }
        // 內層（扣除）：若這格 non-WALL 但它下方 facadeSpan 格內有 WALL 且 WALL 不 visible，
        // 該 pixel 範圍其實是立面 sprite 畫出來的，得從 clip 扣掉
        if (facadeSpan > 0) {
          for (const { c, r } of visible) {
            const tile = tileMap[r]?.[c];
            if (tile === TileType.WALL) continue;
            for (let dr = 1; dr <= facadeSpan; dr++) {
              const below = tileMap[r + dr]?.[c];
              if (below !== TileType.WALL) continue;
              if (visibleSet.has(`${c},${r + dr}`)) continue;
              off.rect(offsetX + (c + 1) * tileW, offsetY + r * tileW, -tileW, tileW);
              break;
            }
          }
        }
        off.clip('evenodd');
      };

      for (const l of lights) {
        // BFS 半徑放大 1.5 倍讓 gradient falloff 不被 tile 邊界切鋸齒
        const visible = computeVisibleTiles(
          tileMap, cols, rows, l.lc, l.lr, Math.ceil(l.radiusTiles * 1.5),
        );
        if (visible.length === 0) continue;

        off.save();
        clipToTiles(visible);

        off.globalCompositeOperation = 'destination-out';
        const gradErase = off.createRadialGradient(l.cx, l.cy, 0, l.cx, l.cy, l.radius);
        gradErase.addColorStop(0, `rgba(0, 0, 0, ${l.intensity})`);
        gradErase.addColorStop(1, 'rgba(0, 0, 0, 0)');
        off.fillStyle = gradErase;
        off.fillRect(l.cx - l.radius, l.cy - l.radius, l.radius * 2, l.radius * 2);

        off.globalCompositeOperation = 'lighter';
        const gradTint = off.createRadialGradient(l.cx, l.cy, 0, l.cx, l.cy, l.radius);
        gradTint.addColorStop(0, l.color);
        gradTint.addColorStop(1, 'rgba(0, 0, 0, 0)');
        off.fillStyle = gradTint;
        off.globalAlpha = 0.25 * l.intensity;
        off.fillRect(l.cx - l.radius, l.cy - l.radius, l.radius * 2, l.radius * 2);

        off.restore();
      }
    }
  } else {
    // ── Tile mode: per-cell brightness, blocky pixel-RPG look ─────────────────
    const tileB = new Float32Array(cols * rows);
    const tileColor: Array<string | null> = new Array(cols * rows).fill(null);

    for (const l of lights) {
      const cells = computeTileBrightness(
        tileMap, cols, rows, l.lc, l.lr, Math.ceil(l.radiusTiles),
      );
      for (const { c, r, b } of cells) {
        const contrib = b * l.intensity;
        const idx = r * cols + c;
        if (contrib > tileB[idx]) {
          tileB[idx] = contrib;
          tileColor[idx] = l.color; // dominant light wins the tint color
        }
      }
    }

    // Pass 1: per-tile darkness (less dark where brighter)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dark = AMBIENT_DARK_ALPHA * (1 - tileB[r * cols + c]);
        if (dark <= 0) continue;
        off.fillStyle = `rgba(0, 0, 0, ${dark})`;
        off.fillRect(offsetX + c * tileW, offsetY + r * tileW, tileW, tileW);
      }
    }

    // Pass 2: additive warm tint only on lit tiles
    off.save();
    off.globalCompositeOperation = 'lighter';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const b = tileB[idx];
        const color = tileColor[idx];
        if (b <= 0 || !color) continue;
        off.globalAlpha = 0.25 * b;
        off.fillStyle = color;
        off.fillRect(offsetX + c * tileW, offsetY + r * tileW, tileW, tileW);
      }
    }
    off.restore();
  }

  // Composite onto main canvas
  ctx.drawImage(_litCanvas!, 0, 0);
}

export const lightingPlugin: RenderPlugin = {
  name: 'lighting',
  layer: 'afterScene',
  render,
};
