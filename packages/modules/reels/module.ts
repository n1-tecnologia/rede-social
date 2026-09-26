import type { ModuleManifest } from '@tria/core/server/modules/manifest';

/**
 * INERT RED STUB (05.3-01, TDD RED commit). This file exists only so `tests/manifest.test.ts` fails
 * on an ASSERTION rather than on a module-resolution crash: the `reels` key is not yet in
 * `TOGGLEABLE_MODULES`, so `defineModule` would throw at import time. The GREEN commit replaces this
 * file entirely with the real manifest (tab nav at order 30, `chrome: 'media'`, `requires: ['feed']`).
 */
export const reelsModule = { key: 'reels' } as unknown as ModuleManifest;
