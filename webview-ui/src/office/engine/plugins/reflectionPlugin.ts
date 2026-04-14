import type { ColorValue } from '../../../components/ui/types.js';
import { CHARACTER_SITTING_OFFSET_PX, REFLECTION_ALPHA, REFLECTION_GAP_PX } from '../../../constants.js';
import { getCachedSprite } from '../../sprites/spriteCache.js';
import { getCharacterFrameCanvases, getCharacterSprites } from '../../sprites/spriteData.js';
import type { Character, FurnitureInstance } from '../../types.js';
import { CharacterState, TILE_SIZE } from '../../types.js';
import { getCharacterSheetCoords, getCharacterSprite } from '../characters.js';
import type { RenderContext, RenderPlugin } from './types.js';

function buildReflectiveTileSet(
  tileColors: Array<ColorValue | null> | undefined,
  cols: number,
  rows: number,
): Set<string> | null {
  if (!tileColors) return null;
  const set = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = tileColors[r * cols + c];
      if (color?.reflective) set.add(`${c},${r}`);
    }
  }
  return set.size > 0 ? set : null;
}

/** Lazy-initialized offscreen canvas for reflection compositing */
let _reflCanvas: HTMLCanvasElement | null = null;
let _reflCtx: CanvasRenderingContext2D | null = null;

function getReflCtx(w: number, h: number): CanvasRenderingContext2D {
  if (!_reflCanvas) {
    _reflCanvas = document.createElement('canvas');
  }
  if (_reflCanvas.width !== w || _reflCanvas.height !== h) {
    _reflCanvas.width = w;
    _reflCanvas.height = h;
    _reflCtx = _reflCanvas.getContext('2d')!;
  }
  _reflCtx!.clearRect(0, 0, w, h);
  return _reflCtx!;
}

/**
 * Render vertically-flipped reflections of furniture and characters
 * onto reflective floor tiles, with gradient fade within one tile height.
 *
 * Pipeline:
 * 1. Draw flipped reflections onto offscreen canvas (same coords as main)
 * 2. Erase with per-tile vertical gradient (destination-out) for fade-out
 * 3. Composite offscreen → main canvas, clipped to reflective tiles
 */
function render(rctx: RenderContext): void {
  const { ctx, offsetX, offsetY, zoom, cols, rows, tileColors, furniture, characters } = rctx;

  const reflectiveTiles = buildReflectiveTileSet(tileColors, cols, rows);
  if (!reflectiveTiles) return;

  const s = TILE_SIZE * zoom;
  const cw = ctx.canvas.width;
  const canvasH = ctx.canvas.height;

  // ── 1. Draw reflections onto offscreen canvas ──
  const off = getReflCtx(cw, canvasH);

  off.save();
  off.beginPath();
  for (const key of reflectiveTiles) {
    const [cStr, rStr] = key.split(',');
    const c = parseInt(cStr!, 10);
    const r = parseInt(rStr!, 10);
    off.rect(offsetX + c * s, offsetY + r * s, s, s);
  }
  off.clip();

  off.globalAlpha = REFLECTION_ALPHA;

  const gapPx = REFLECTION_GAP_PX * zoom;

  for (const f of furniture) {
    const cached = getCachedSprite(f.sprite, zoom);
    const fx = offsetX + f.x * zoom;
    const fy = offsetY + f.y * zoom;
    const fh = cached.height;
    const fw = cached.width;
    const mirrorY = fy + fh + gapPx;

    off.save();
    off.beginPath();
    off.rect(fx, mirrorY, fw, s);
    off.clip();
    off.translate(0, 2 * mirrorY);
    off.scale(1, -1);

    if (f.mirrored) {
      off.save();
      off.translate(fx + fw, fy);
      off.scale(-1, 1);
      off.drawImage(cached, 0, 0);
      off.restore();
    } else {
      off.drawImage(cached, fx, fy);
    }
    off.restore();
  }

  for (const char of characters) {
    if (char.matrixEffect) continue;

    const sittingOffset = char.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const hiRes = getCharacterFrameCanvases(char.palette);

    if (hiRes) {
      // Route B: high-res frame canvas path (mirrors renderer.ts logic)
      const { row, col, mirror } = getCharacterSheetCoords(char);
      const fc = hiRes[row]![col]!;
      const dstW = TILE_SIZE * zoom;
      const dstH = TILE_SIZE * 2 * zoom;
      const drawX = Math.round(offsetX + char.x * zoom - dstW / 2);
      const drawY = Math.round(offsetY + (char.y + sittingOffset) * zoom - dstH);
      const mirrorY = drawY + dstH + gapPx;

      off.save();
      off.beginPath();
      off.rect(drawX, mirrorY, dstW, s);
      off.clip();
      off.translate(0, 2 * mirrorY);
      off.scale(1, -1);
      off.imageSmoothingEnabled = true;
      off.imageSmoothingQuality = 'high';
      if (mirror) {
        off.save();
        off.translate(drawX + dstW, drawY);
        off.scale(-1, 1);
        off.drawImage(fc, 0, 0, fc.width, fc.height, 0, 0, dstW, dstH);
        off.restore();
      } else {
        off.drawImage(fc, 0, 0, fc.width, fc.height, drawX, drawY, dstW, dstH);
      }
      off.restore();
    } else {
      // Route A: SpriteData cached sprite path
      const sprites = getCharacterSprites(char.palette, char.hueShift);
      const spriteData = getCharacterSprite(char, sprites);
      const cached = getCachedSprite(spriteData, zoom);
      const drawX = Math.round(offsetX + char.x * zoom - cached.width / 2);
      const drawY = Math.round(offsetY + (char.y + sittingOffset) * zoom - cached.height);
      const mirrorY = drawY + cached.height + gapPx;

      off.save();
      off.beginPath();
      off.rect(drawX, mirrorY, cached.width, s);
      off.clip();
      off.translate(0, 2 * mirrorY);
      off.scale(1, -1);
      off.drawImage(cached, drawX, drawY);
      off.restore();
    }
  }

  off.restore();

  // ── 2. Gradient fade per reflective tile ──
  off.save();
  off.globalCompositeOperation = 'destination-out';
  for (const key of reflectiveTiles) {
    const [cStr, rStr] = key.split(',');
    const c = parseInt(cStr!, 10);
    const r = parseInt(rStr!, 10);
    const tx = offsetX + c * s;
    const ty = offsetY + r * s;

    const grad = off.createLinearGradient(tx, ty, tx, ty + s);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    off.fillStyle = grad;
    off.fillRect(tx, ty, s, s);
  }
  off.restore();

  // ── 3. Composite onto main canvas, clipped to reflective tiles ──
  ctx.save();
  ctx.beginPath();
  for (const key of reflectiveTiles) {
    const [cStr, rStr] = key.split(',');
    const c = parseInt(cStr!, 10);
    const r = parseInt(rStr!, 10);
    ctx.rect(offsetX + c * s, offsetY + r * s, s, s);
  }
  ctx.clip();
  ctx.drawImage(_reflCanvas!, 0, 0);
  ctx.restore();
}

export const reflectionPlugin: RenderPlugin = {
  name: 'reflection',
  layer: 'belowScene',
  render,
};
