/**
 * Shared default layout resolution — used by both VS Code extension
 * (assetLoader.ts) and standalone server (viteGoosePlugin.ts).
 *
 * No VS Code dependency. Pure fs operations only.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Scan a directory for `default-layout-{N}.json` files and return the
 * path with the highest N. Falls back to `default-layout.json` if no
 * versioned files exist. Returns `null` when nothing is found.
 */
export function findHighestDefaultLayout(assetsDir: string): { path: string; revision: number } | null {
  let bestRevision = 0;
  let bestPath: string | null = null;

  if (fs.existsSync(assetsDir)) {
    for (const file of fs.readdirSync(assetsDir)) {
      const match = /^default-layout-(\d+)\.json$/.exec(file);
      if (match) {
        const rev = parseInt(match[1], 10);
        if (rev > bestRevision) {
          bestRevision = rev;
          bestPath = path.join(assetsDir, file);
        }
      }
    }
  }

  // Fall back to unversioned default-layout.json
  if (!bestPath) {
    const fallback = path.join(assetsDir, 'default-layout.json');
    if (fs.existsSync(fallback)) {
      return { path: fallback, revision: 0 };
    }
    return null;
  }

  return { path: bestPath, revision: bestRevision };
}
