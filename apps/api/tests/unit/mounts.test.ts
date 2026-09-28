import type { ModuleKey } from '@rede-social/contracts';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { MODULE_REGISTRY, permissionsFor } from '../../src/modules/registry';

/**
 * The forgotten-mount test. A module can be registered (so it shows up in `/me/bootstrap` with a
 * nav entry) while nobody ever added its `.route()` line to `app.ts` — the shell would then link to
 * a 404. This suite makes that state impossible to commit, with no database and no network.
 */
describe('module mounts', () => {
  const keys = Object.keys(MODULE_REGISTRY) as ModuleKey[];

  it('1. every manifest with routes is actually mounted under /v1/<key>', () => {
    const withRoutes = keys.filter((key) => MODULE_REGISTRY[key]?.routes);
    // Guard against the test silently passing on an empty registry.
    expect(withRoutes).toContain('feed');

    for (const key of withRoutes) {
      const mounted = app.routes.filter((route) => route.path.startsWith(`/v1/${key}`));
      expect(mounted.length, `no route mounted for module '${key}'`).toBeGreaterThan(0);
    }
  });

  it('2. the feed module exposes its three routes under /v1/feed (04-01)', () => {
    const paths = app.routes
      .filter((route) => route.path.startsWith('/v1/feed') && route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    expect(paths).toContain('GET /v1/feed');
    expect(paths).toContain('POST /v1/feed/posts');
    expect(paths).toContain('GET /v1/feed/posts/:postId');
  });

  it('3. an enabled module contributes its permissions to the role that owns them', () => {
    expect(permissionsFor('admin_tenant', new Set<ModuleKey>(['feed']))).toContain(
      'feed.post.create',
    );
    // Members never get it by default (FEED-08's `admins_only`), and neither does an admin when the
    // module is disabled — turning a module off revokes what it granted.
    expect(permissionsFor('member', new Set<ModuleKey>(['feed']))).not.toContain(
      'feed.post.create',
    );
    expect(permissionsFor('admin_tenant', new Set<ModuleKey>())).not.toContain('feed.post.create');
  });

  it('4. the platform lane mounts the six provisioning routes under /v1/platform (02-05)', () => {
    const paths = app.routes
      .filter((route) => route.path.startsWith('/v1/platform') && route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    expect(paths).toContain('GET /v1/platform/tenants');
    expect(paths).toContain('POST /v1/platform/tenants');
    expect(paths).toContain('GET /v1/platform/tenants/:id');
    expect(paths).toContain('PATCH /v1/platform/tenants/:id');
    expect(paths).toContain('POST /v1/platform/tenants/:id/status');
    expect(paths).toContain('PUT /v1/platform/tenants/:id/modules/:key');
    // 02-10: the invite lifecycle is chained on the same tenants router.
    expect(paths).toContain('GET /v1/platform/tenants/:id/invites');
    expect(paths).toContain('POST /v1/platform/tenants/:id/invites/:inviteId/resend');
    // The guard is registered on the parent router, so every sub-router inherits it (T-02-15).
    expect(
      app.routes.some((route) => route.path === '/v1/platform/*' && route.method === 'ALL'),
    ).toBe(true);
  });

  it('5. every registered key equals its manifest key and every job name is namespaced', () => {
    for (const key of keys) {
      expect(MODULE_REGISTRY[key]?.key).toBe(key);
      for (const job of MODULE_REGISTRY[key]?.jobs ?? []) {
        expect(job.name.startsWith(`${key}.`), `job '${job.name}' is not namespaced`).toBe(true);
      }
    }
  });
});
