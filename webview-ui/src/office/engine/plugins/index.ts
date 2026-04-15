import { intelMonitorPlugin } from './intelMonitorPlugin.js';
import { lightingPlugin } from './lightingPlugin.js';
import { reflectionPlugin } from './reflectionPlugin.js';
import { sparkPlugin } from './sparkPlugin.js';
import type { RenderContext, RenderLayer, RenderPlugin } from './types.js';

/** Ordered list of registered render plugins. */
const PLUGINS: RenderPlugin[] = [reflectionPlugin, lightingPlugin, sparkPlugin, intelMonitorPlugin];

/** Run all plugins registered for the given layer, in registration order. */
export function runPlugins(layer: RenderLayer, rctx: RenderContext): void {
  for (const p of PLUGINS) {
    if (p.layer === layer) p.render(rctx);
  }
}

export type { RenderContext, RenderLayer, RenderPlugin };
