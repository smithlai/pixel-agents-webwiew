import {
  INTEL_ALERT_ALPHA,
  INTEL_ALERT_INTERVAL_MS,
  INTEL_ALERT_MAX_DURATION_MS,
  INTEL_ALERT_MAX_RADIUS_PX,
  INTEL_ALERT_MIN_DURATION_MS,
  INTEL_ALERT_STROKE_PX,
  INTEL_BORDER_DURATION_MS,
  INTEL_BORDER_INTERVAL_MS,
  INTEL_MONITOR_COLOR,
  INTEL_MONITOR_FILL,
  INTEL_SCANLINE_ALPHA,
  INTEL_SCANLINE_HEIGHT_PX,
  INTEL_SCAN_DURATION_MS,
  INTEL_SCAN_INTERVAL_MS,
  INTEL_SCAN_SPEED,
  INTEL_SCREEN_HEIGHT_FRACTION,
} from '../../../constants.js';
import type { FurnitureInstance } from '../../types.js';
import type { RenderContext, RenderPlugin } from './types.js';

interface AlertRing {
  cx: number;      // sprite-px world coords
  cy: number;
  startMs: number;
  durationMs: number;
}

interface SurfaceState {
  scanActive: boolean;
  scanUntil: number;
  nextScanAt: number;
  borderActive: boolean;
  borderUntil: number;
  nextBorderAt: number;
}

const activeAlerts: AlertRing[] = [];
let lastAlertSpawnMs = 0;
const surfaceActivity = new Map<string, SurfaceState>();

function isIntelSurface(type: string | undefined): boolean {
  if (!type) return false;
  return type.startsWith('SURVEILLANCE_WALL');
}

function surfaceKey(item: FurnitureInstance): string {
  return `${item.x}:${item.y}`;
}

function getOrInitSurface(key: string, now: number): SurfaceState {
  if (!surfaceActivity.has(key)) {
    // Stagger initial timers so all screens don't flash at once
    const jitter = Math.random() * 3000;
    surfaceActivity.set(key, {
      scanActive: false,
      scanUntil: 0,
      nextScanAt: now + jitter,
      borderActive: false,
      borderUntil: 0,
      nextBorderAt: now + jitter * 1.5,
    });
  }
  return surfaceActivity.get(key)!;
}

function getRandomPointInSurface(item: FurnitureInstance): { x: number; y: number } {
  const width = item.sprite[0]?.length ?? 48;
  const height = item.sprite.length ?? 32;
  // Stay within the inset screen region — bottom is desk/table, so clamp to screen fraction
  const insetFractionX = 0.15;
  const insetFractionY = 0.18;
  const left = item.x + width * insetFractionX;
  const top = item.y + height * insetFractionY;
  const right = item.x + width * (1 - insetFractionX);
  // Bottom boundary: INTEL_SCREEN_HEIGHT_FRACTION of sprite height (not the full sprite)
  const bottom = item.y + height * INTEL_SCREEN_HEIGHT_FRACTION * 0.9;
  return {
    x: left + Math.random() * (right - left),
    y: top + Math.random() * (bottom - top),
  };
}

export const intelMonitorPlugin: RenderPlugin = {
  name: 'intel-monitor',
  layer: 'afterScene',
  render({ ctx, furniture, offsetX, offsetY, zoom }: RenderContext): void {
    const now = Date.now();
    const surfaces = furniture.filter((f) => isIntelSurface(f.type));
    if (surfaces.length === 0) return;

    // Spawn a new alert ring at interval from a random surface (at random position)
    if (now - lastAlertSpawnMs >= INTEL_ALERT_INTERVAL_MS) {
      lastAlertSpawnMs = now;
      const surf = surfaces[Math.floor(Math.random() * surfaces.length)];
      const pos = getRandomPointInSurface(surf);
      activeAlerts.push({
        cx: pos.x,
        cy: pos.y,
        startMs: now,
        durationMs:
          INTEL_ALERT_MIN_DURATION_MS +
          Math.random() * (INTEL_ALERT_MAX_DURATION_MS - INTEL_ALERT_MIN_DURATION_MS),
      });
    }

    // Remove expired alerts
    for (let i = activeAlerts.length - 1; i >= 0; i--) {
      if (now - activeAlerts[i].startMs >= activeAlerts[i].durationMs) activeAlerts.splice(i, 1);
    }

    // Update per-surface intermittent state
    for (const item of surfaces) {
      const key = surfaceKey(item);
      const state = getOrInitSurface(key, now);

      if (state.scanActive) {
        if (now >= state.scanUntil) {
          state.scanActive = false;
          state.nextScanAt = now + INTEL_SCAN_INTERVAL_MS + Math.random() * 2000;
        }
      } else if (now >= state.nextScanAt) {
        state.scanActive = true;
        state.scanUntil = now + INTEL_SCAN_DURATION_MS;
      }

      if (state.borderActive) {
        if (now >= state.borderUntil) {
          state.borderActive = false;
          state.nextBorderAt = now + INTEL_BORDER_INTERVAL_MS + Math.random() * 3000;
        }
      } else if (now >= state.nextBorderAt) {
        state.borderActive = true;
        state.borderUntil = now + INTEL_BORDER_DURATION_MS;
      }
    }

    const nowSec = now / 1000;
    ctx.save();

    // Per-surface: tint fill + intermittent scanline + intermittent border
    for (const item of surfaces) {
      const key = surfaceKey(item);
      const state = surfaceActivity.get(key);
      const width = item.sprite[0]?.length ?? 48;
      const height = item.sprite.length ?? 32;
      const drawX = offsetX + item.x * zoom;
      const drawY = offsetY + item.y * zoom;
      const drawW = width * zoom;
      const drawH = height * zoom;
      const insetX = Math.max(2 * zoom, drawW * 0.12);
      const insetY = Math.max(2 * zoom, drawH * 0.15);
      // Screen region: top INTEL_SCREEN_HEIGHT_FRACTION of sprite only (bottom is desk/table)
      const screenMaxH = drawH * INTEL_SCREEN_HEIGHT_FRACTION;
      const sX = drawX + insetX;
      const sY = drawY + insetY;
      const sW = Math.max(4 * zoom, drawW - insetX * 2);
      const sH = Math.max(4 * zoom, screenMaxH - insetY);

      // Always-on dim tint
      ctx.globalAlpha = 1;
      ctx.fillStyle = INTEL_MONITOR_FILL;
      ctx.fillRect(sX, sY, sW, sH);

      // Intermittent scanline
      if (state?.scanActive) {
        const scanPos = ((nowSec * INTEL_SCAN_SPEED + item.x * 0.07 + item.y * 0.11) % 1) * sH;
        const scanGrad = ctx.createLinearGradient(sX, sY + scanPos, sX, sY + scanPos + INTEL_SCANLINE_HEIGHT_PX * zoom);
        scanGrad.addColorStop(0, 'rgba(255,72,72,0)');
        scanGrad.addColorStop(0.5, `rgba(255,72,72,${INTEL_SCANLINE_ALPHA})`);
        scanGrad.addColorStop(1, 'rgba(255,72,72,0)');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(sX, sY, sW, sH);
      }

      // Intermittent border
      if (state?.borderActive) {
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = INTEL_MONITOR_COLOR;
        ctx.lineWidth = zoom;
        ctx.strokeRect(sX + 0.5, sY + 0.5, sW - 1, sH - 1);
        ctx.globalAlpha = 1;
      }
    }

    // Render alert rings (lighter blend for glow effect)
    ctx.globalCompositeOperation = 'lighter';
    for (const alert of activeAlerts) {
      const progress = (now - alert.startMs) / alert.durationMs;
      const pulseAlpha = Math.abs(Math.sin(progress * Math.PI * 4)) * 0.85 * (1 - progress * 0.4);
      if (pulseAlpha <= 0.01) continue;
      const cx = offsetX + alert.cx * zoom;
      const cy = offsetY + alert.cy * zoom;
      const radius = INTEL_ALERT_MAX_RADIUS_PX * zoom * (0.15 + progress * 0.85);
      ctx.globalAlpha = pulseAlpha * INTEL_ALERT_ALPHA;
      ctx.strokeStyle = INTEL_MONITOR_COLOR;
      ctx.lineWidth = INTEL_ALERT_STROKE_PX * zoom;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  },
};