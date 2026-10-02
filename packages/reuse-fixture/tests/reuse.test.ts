import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eventsRoutes } from '@rede-social/module-events/server';
import { describe, expect, it } from 'vitest';
import { fixtureApp } from '../src/app';

/**
 * MOD-05 (D-347), without a database: the events module builds (this package's `tsc --noEmit`),
 * mounts and guards itself on an app that provides only the kernel contracts.
 */

const PREFIX = '/v1/events';

/** `METHOD path` for every concrete route (the `ALL` entries are middleware, e.g. the guard chain). */
function routeKeys(routes: { method: string; path: string }[], prefix = ''): string[] {
  return routes
    .filter((route) => route.method !== 'ALL')
    .map((route) => `${route.method} ${route.path === '/' ? prefix : `${prefix}${route.path}`}`)
    .sort();
}

describe('reuse fixture (MOD-05)', () => {
  it('1. the app serves exactly the events module routes, under /v1/events', () => {
    const mounted = routeKeys(fixtureApp.routes);
    const expected = routeKeys(eventsRoutes.routes, PREFIX);
    expect(new Set(expected).size).toBeGreaterThan(10);
    // Entry for entry (per-route guards repeat a key), so nothing is added, dropped or re-prefixed.
    expect(mounted).toEqual(expected);
    for (const key of mounted) expect(key.split(' ')[1]?.startsWith(PREFIX)).toBe(true);
  });

  it('2. GET /v1/events without a token answers 401 UNAUTHENTICATED, needing no database', async () => {
    const res = await fixtureApp.request(PREFIX);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; requestId?: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.requestId).toBeTruthy();
  });

  it('3. the dependency set is the kernel contracts plus ONE module, and no app', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys(manifest.dependencies ?? {}).sort();
    expect(deps).toEqual([
      '@hono/zod-openapi',
      '@rede-social/contracts',
      '@rede-social/core',
      '@rede-social/module-events',
      'hono',
      'zod',
    ]);
    const everything = [...deps, ...Object.keys(manifest.devDependencies ?? {})];
    const modules = everything.filter((name) => name.startsWith('@rede-social/module-'));
    expect(modules).toEqual(['@rede-social/module-events']);
    expect(everything).not.toContain('@rede-social/api');
    expect(everything).not.toContain('@rede-social/web');
  });
});
