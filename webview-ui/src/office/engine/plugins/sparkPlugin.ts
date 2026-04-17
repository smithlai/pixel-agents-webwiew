import {
  SPARK_ALPHA_FADE,
  SPARK_COLORS,
  SPARK_FALL_LIMIT_PX,
  SPARK_GRAVITY,
  SPARK_MAX_COUNT,
  SPARK_SIZE_PX,
  SPARK_SPAWN_CHANCE,
  SPARK_SPAWN_INTERVAL_MS,
  SPARK_VX_RANGE,
  SPARK_VY_INIT,
  SPARK_VY_RANGE,
} from '../../../constants.js';
import { TILE_SIZE } from '../../types.js';
import type { Character } from '../../types.js';
import type { RenderContext, RenderPlugin } from './types.js';

interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
  startY: number;
}

const sparks: SparkParticle[] = [];
const lastSpawnTimes = new Map<string, number>();
let lastUpdateMs = 0;

function isSparkEmitter(
  item: { type?: string; x: number; y: number },
  characters: Character[],
): boolean {
  if (!item.type?.startsWith('ROBOT_ARM')) return false;
  // ROBOT_ARM PNG 3×2 tiles (48×32px); footprint = left 2 cols, right col is
  // the overhanging arm. Trigger when an active agent sits anywhere in the
  // 3×3 neighbourhood around the base (including the chair row above).
  const itemCol = Math.floor(item.x / TILE_SIZE);
  const itemRow = Math.floor(item.y / TILE_SIZE);
  for (const ch of characters) {
    if (!ch.isActive) continue;
    if (ch.tileCol >= itemCol && ch.tileCol <= itemCol + 2 &&
        ch.tileRow >= itemRow - 1 && ch.tileRow <= itemRow + 2) {
      return true;
    }
  }
  return false;
}

function getSparkOrigin(item: { x: number; y: number }): { x: number; y: number } {
  // ROBOT_ARM = 3×2 tiles (48×32px). Arm tip at upper-right corner.
  return {
    x: item.x + TILE_SIZE * 2.5,
    y: item.y + TILE_SIZE * 1.0,
  };
}

function spawnSpark(ox: number, oy: number): void {
  sparks.push({
    x: ox + (Math.random() - 0.5) * 8,
    y: oy + (Math.random() - 0.5) * 4,
    vx: (Math.random() - 0.5) * SPARK_VX_RANGE,
    vy: SPARK_VY_INIT + Math.random() * SPARK_VY_RANGE,
    size: SPARK_SIZE_PX * (0.6 + Math.random() * 0.8),
    alpha: 0.9 + Math.random() * 0.1,
    color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
    startY: oy,
  });
}

export const sparkPlugin: RenderPlugin = {
  name: 'sparks',
  layer: 'afterScene',
  render({ ctx, furniture, characters, offsetX, offsetY, zoom }: RenderContext): void {
    const now = Date.now();
    const dt = lastUpdateMs > 0 ? Math.min((now - lastUpdateMs) / 1000, 0.1) : 0;
    lastUpdateMs = now;

    // Spawn sparks from emitters (only when an active agent is at the base)
    if (sparks.length < SPARK_MAX_COUNT) {
      for (const item of furniture) {
        if (!isSparkEmitter(item, characters)) continue;
        const key = `${item.x}:${item.y}`;
        const last = lastSpawnTimes.get(key) ?? 0;
        if (now - last >= SPARK_SPAWN_INTERVAL_MS && Math.random() < SPARK_SPAWN_CHANCE) {
          lastSpawnTimes.set(key, now);
          const origin = getSparkOrigin(item);
          const burst = 1 + Math.floor(Math.random() * 4);
          for (let i = 0; i < burst; i++) spawnSpark(origin.x, origin.y);
        }
      }
    }

    // Physics update
    for (const s of sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += SPARK_GRAVITY * dt;
      s.size *= 1 - 0.08 * dt * 60;
      s.alpha -= SPARK_ALPHA_FADE * dt;
    }

    // Cull dead particles
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      if (s.alpha <= 0 || s.size <= 0.3 || s.y - s.startY > SPARK_FALL_LIMIT_PX) {
        sparks.splice(i, 1);
      }
    }

    // Render
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of sparks) {
      const sx = Math.round(offsetX + s.x * zoom);
      const sy = Math.round(offsetY + s.y * zoom);
      const sz = Math.max(1, Math.round(s.size * zoom));
      ctx.globalAlpha = Math.max(0, Math.min(1, s.alpha));
      ctx.fillStyle = s.color;
      ctx.fillRect(sx, sy, sz, sz);
    }
    ctx.restore();
  },
};