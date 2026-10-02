import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_HANDLER_INVENTORY } from './route-handlers.inventory';

/**
 * The web half of the isolation gate (08-10, TENANT-05): every `route.ts` under `apps/web/app`,
 * found on disk, must be classified in `route-handlers.inventory.ts`; every entry must still exist;
 * every proxied API route must be one the API's isolation inventory classifies; and every exemption
 * must carry a reason. A new handler with no entry therefore fails `pnpm turbo test`.
 */

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));

/**
 * The API isolation inventory's keys, read as TEXT — a test-only cross-package READ, not an import.
 * `turbo boundaries` (a CI step) refuses any import that leaves `@rede-social/web`, and Biome confines
 * web imports of the API package to `@rede-social/api/types`, so the map is parsed from its source.
 * The API's own unit test (`isolation-inventory.test.ts`, "the web gate's text parse …") asserts that
 * this exact regex over the same file yields exactly `Object.keys(ISOLATION_INVENTORY)`, so the parse
 * cannot drift from the map. `apps/web/turbo.json` lists the file as a `test` input for the cache.
 */
const API_INVENTORY_KEY_RE = /^\s*'((?:GET|POST|PUT|PATCH|DELETE) \/[^']*)':/gm;

function apiInventoryKeys(): Set<string> {
  const source = readFileSync(
    fileURLToPath(new URL('../../api/tests/isolation-inventory.ts', import.meta.url)),
    'utf8',
  );
  return new Set([...source.matchAll(API_INVENTORY_KEY_RE)].map((match) => match[1] ?? ''));
}

function routeHandlers(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(APP_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== 'route.ts') continue;
    found.push(relative(APP_DIR, join(entry.parentPath, entry.name)).split(sep).join('/'));
  }
  return found.sort();
}

describe('web route-handler inventory (TENANT-05 gate)', () => {
  const onDisk = routeHandlers();

  it('finds the handlers on disk (the walk cannot pass vacuously)', () => {
    expect(onDisk.length).toBeGreaterThanOrEqual(20);
    expect(onDisk).toContain('api/csp-report/route.ts');
  });

  it('every route.ts on disk is classified, and every entry still exists', () => {
    expect(onDisk).toEqual(Object.keys(ROUTE_HANDLER_INVENTORY).sort());
  });

  it('every proxied API route is classified in the API isolation inventory', () => {
    const apiKeys = apiInventoryKeys();
    // Guard against a parse that silently matches nothing.
    expect(apiKeys.size).toBeGreaterThan(100);
    expect(apiKeys.has('GET /v1/media/:assetId/:variant')).toBe(true);
    const unknown = Object.entries(ROUTE_HANDLER_INVENTORY).flatMap(([handler, entry]) =>
      'proxies' in entry
        ? [entry.proxies]
            .flat()
            .filter((route) => !apiKeys.has(route))
            .map((route) => `${handler} -> ${route}`)
        : [],
    );
    expect(unknown).toEqual([]);
  });

  it('every exemption carries a reason of at least 10 characters', () => {
    const weak = Object.entries(ROUTE_HANDLER_INVENTORY)
      .filter(([, entry]) => 'exempt' in entry && entry.exempt.trim().length < 10)
      .map(([handler]) => handler);
    expect(weak).toEqual([]);
  });
});
