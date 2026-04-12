import { lightingPlugin } from './lightingPlugin.js';
import { reflectionPlugin } from './reflectionPlugin.js';
import type { RenderContext, RenderLayer, RenderPlugin } from './types.js';

/** Ordered list of registered render plugins. */
const PLUGINS: RenderPlugin[] = [reflectionPlugin, lightingPlugin];

/** Run all plugins registered for the given layer, in registration order. */
export function runPlugins(layer: RenderLayer, rctx: RenderContext): void {
  for (const p of PLUGINS) {
    if (p.layer === layer) p.render(rctx);
  }
}

export type { RenderContext, RenderLayer, RenderPlugin };
