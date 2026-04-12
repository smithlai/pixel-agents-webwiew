import type { ColorValue } from '../../../components/ui/types.js';
import type { Character, FurnitureInstance, TileType as TileTypeVal } from '../../types.js';

/** Shared context passed to every render plugin for a frame. */
export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  offsetX: number;
  offsetY: number;
  zoom: number;
  cols: number;
  rows: number;
  tileMap: TileTypeVal[][];
  tileColors: Array<ColorValue | null> | undefined;
  /** Furniture instances (walls already merged in). */
  furniture: FurnitureInstance[];
  characters: Character[];
}

/**
 * Render layer slot.
 * - `belowScene`: above floor/seat-indicator, below z-sorted scene (reflections)
 * - `afterScene`: above z-sorted scene + path/bubbles, below editor overlays (lighting, shadows)
 */
export type RenderLayer = 'belowScene' | 'afterScene';

export interface RenderPlugin {
  name: string;
  layer: RenderLayer;
  render(rctx: RenderContext): void;
}
