# @rede-social/reuse-fixture

The MOD-05 proof (D-347): one feature module, `@rede-social/module-events`, built, mounted and
served by a fresh app that provides only the kernel contracts. It is the worked example every
module README's `## Reuse` section points to.

The fixture depends on exactly `@rede-social/core`, `@rede-social/contracts`,
`@rede-social/module-events`, `hono`, `@hono/zod-openapi` and `zod`. Its unit test fails if a second
module, `@rede-social/api` or `@rede-social/web` ever enters `package.json`, and `pnpm boundaries`
checks its `app` tag against `turbo.json`.

## Copy a module into another project

1. **Copy the packages.** The module package (`packages/modules/<m>`), the kernel
   (`packages/core`), the shared contracts (`packages/contracts`) and the tooling config
   (`packages/config`). The kernel also carries `packages/ui` for its client-safe UI; a server-only
   host can skip the module's `./ui` export.
2. **Copy the schema.** The kernel tables and the module's own tables, with their RLS policies, from
   `supabase/migrations`. The events module references only kernel tables (`tenants`, `users`,
   `media_assets`), which is why it is the example: feed has hand-written foreign keys into the
   communities and stories tables, and reels `requires` feed.
3. **Provide the kernel environment.** `DATABASE_URL` (the `api_user` role, never `postgres`),
   `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`; see `packages/core/server/env.ts`.
4. **Compose the host app**, as `src/app.ts` does:
   - a request id and a per-request logger (`c.var.requestId`, `c.var.logger`);
   - `flushEventsAfterHandler`, so domain events are delivered after the handler's transaction
     commits;
   - an `onError` that renders `errorEnvelope`;
   - `setPermissionResolver`: `KERNEL_ROLE_PERMISSIONS[role]` plus the module's
     `defaultRolePermissions[role]` while the tenant has the module's flag on;
   - `subscribe` every manifest `events` entry and `registerJobQueues` every manifest job name;
   - `.route('/v1/<key>', <key>Routes)`. The module's router carries its own `requireAuth`,
     `requireModule` and `requirePermission` chain, so the mount cannot forget a guard.
5. **Optional seams.** `notificationSources` and `notificationRetractions` need the notifications
   module's sink (`setNotificationSink`); without it the kernel default is a no-op. `sweepFunctions`
   go to `registerSweepFunctions`, `counters` to `setCountersResolver`, `nav` and `home` to the web
   shell's bootstrap. A worker process creates the registered queues with
   `createQueues(boss, registeredJobQueues())`.

## Run the proofs

```bash
pnpm --filter @rede-social/reuse-fixture typecheck   # builds without any other module
pnpm --filter @rede-social/reuse-fixture test        # route set, 401 UNAUTHENTICATED, dependency set (no database)
pnpm boundaries                                       # the app tag's dependency graph
pnpm --filter @rede-social/reuse-fixture test:integration   # a seeded rede-demo member reads the seeded events
```

The database case runs against the seeded local stack (`pnpm db:reset && pnpm db:seed`) and reads
`apps/api/.env.local`, which `scripts/local-env.sh` writes. The root `pnpm test:integration` runs it
after the API suite, so `pnpm verify` and CI's `db` job both execute it.

## What this does not prove

The fixture consumes the module through `workspace:*`, inside this monorepo. Publishing the packages
to a registry and installing them in a separate repository is not exercised, because V1 has no
registry. A future publish step reuses the same dependency set this package asserts.
