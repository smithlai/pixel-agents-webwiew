import {
  AMBIENT_DARK_ALPHA,
  LIGHT_DEFAULT_COLOR,
  LIGHT_DEFAULT_OFFSET_RATIO,
  LIGHT_DEFAULT_RADIUS_TILES,
} from '../../../constants.js';
import { getCatalogEntry } from '../../layout/furnitureCatalog.js';
import type { LightSource } from '../../types.js';
import { TILE_SIZE } from '../../types.js';
import type { RenderContext, RenderPlugin } from './types.js';

/**
 * Temporary demo-source overrides, keyed by catalog asset id prefix.
 * Applied until the asset manifest gains a native `light` field.
 * Remove entries here as manifests are updated.
 *
 * 要新增光源素材 / 為家具指定光源屬性 → 見 docs/owner-todo.md §1 美術素材
 */
const DEMO_LIGHT_OVERRIDES: Array<{ match: (id: string) => boolean; light: LightSource }> = [
  {
    // LED panels on wall — cool white pool around the panel center
    match: (id) => id.startsWith('LED_PANEL_FRONT_ON'),
    light: { radius: 2.5, color: 'rgba(200, 230, 255, 1)', intensity: 0.9 },
  },
  {
    // Monitors on desk — warm screen glow (ON variants only)
    match: (id) => id.startsWith('PC_FRONT_ON'),
    light: { radius: 2, color: 'rgba(180, 220, 255, 1)', intensity: 0.7 },
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
  const { ctx, offsetX, offsetY, zoom, cols, rows, furniture } = rctx;

  // Collect active light sources first to early-out the no-light case.
  type ActiveLight = { cx: number; cy: number; radius: number; color: string; intensity: number };
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
    const radius = (light.radius || LIGHT_DEFAULT_RADIUS_TILES) * TILE_SIZE * zoom;
    lights.push({
      cx,
      cy,
      radius,
      color: light.color || LIGHT_DEFAULT_COLOR,
      intensity: light.intensity ?? 1,
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

  // 1. Ambient darkness over the map rectangle
  off.fillStyle = `rgba(0, 0, 0, ${AMBIENT_DARK_ALPHA})`;
  off.fillRect(mapX, mapY, mapW, mapH);

  // 2. Erase radial gradient per light (destination-out)
  if (lights.length > 0) {
    off.save();
    off.globalCompositeOperation = 'destination-out';
    for (const l of lights) {
      const grad = off.createRadialGradient(l.cx, l.cy, 0, l.cx, l.cy, l.radius);
      grad.addColorStop(0, `rgba(0, 0, 0, ${l.intensity})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      off.fillStyle = grad;
      off.fillRect(l.cx - l.radius, l.cy - l.radius, l.radius * 2, l.radius * 2);
    }
    off.restore();

    // 3. Additive warm tint in the center (gentler glow)
    off.save();
    off.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const grad = off.createRadialGradient(l.cx, l.cy, 0, l.cx, l.cy, l.radius);
      // Extract base color with faded alpha for tint
      grad.addColorStop(0, l.color);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      off.fillStyle = grad;
      off.globalAlpha = 0.25 * l.intensity;
      off.fillRect(l.cx - l.radius, l.cy - l.radius, l.radius * 2, l.radius * 2);
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
