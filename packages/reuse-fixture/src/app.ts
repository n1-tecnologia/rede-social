/**
 * MOD-05 worked example (D-347): ONE module mounted on a fresh app that provides only the kernel
 * contracts. Nothing here imports another module or `@rede-social/api`; the package's own unit test
 * asserts that dependency set and `turbo boundaries` validates its `app` tag.
 *
 * What the KERNEL (`@rede-social/core`) provides, unchanged:
 *  - auth and tenancy: `requireAuth` (JWKS verification, membership of record, host check), which
 *    travels inside the module's own router together with `requireModule` and `requirePermission`;
 *  - the domain-event bus (`subscribe`, `flushEventsAfterHandler`), the job-queue name registry
 *    (`registerJobQueues`), the permission seam (`setPermissionResolver`) and its kernel grants
 *    (`KERNEL_ROLE_PERMISSIONS`);
 *  - the error envelope (`errorEnvelope`) and the root logger.
 *
 * What the HOST APP must provide (this file is all of it):
 *  1. a request id and a per-request logger (`c.var.requestId`, `c.var.logger`);
 *  2. `flushEventsAfterHandler`, so events are delivered after the handler's transaction commits;
 *  3. an `onError` that renders `errorEnvelope`, the `{ error: { code, … } }` shape every client
 *     switches on;
 *  4. the permission composition: kernel grants ∪ the module's `defaultRolePermissions` while the
 *     tenant has the module enabled;
 *  5. the manifest's side effects: its `events` subscribed on the bus and its `jobs` registered;
 *  6. the mount, `.route('/v1/<key>', <key>Routes)`.
 *
 * Not composed here, on purpose: `notificationSources` (they need the notifications module's sink;
 * without it the kernel default is a no-op, so the half that is absent is simply absent — MOD-03),
 * `home`/`nav` (read by the web shell's bootstrap, not by the API) and `sweepFunctions` (events
 * declares none). A worker process would call `createQueues(boss, registeredJobQueues())`; serving
 * HTTP does not need one.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { flushEventsAfterHandler, subscribe } from '@rede-social/core/server/events/bus';
import { ApiError, errorEnvelope } from '@rede-social/core/server/http/api-error';
import { registerJobQueues } from '@rede-social/core/server/jobs/boss';
import { rootLogger } from '@rede-social/core/server/logging';
import { setPermissionResolver } from '@rede-social/core/server/rbac/permissions';
import { KERNEL_ROLE_PERMISSIONS } from '@rede-social/core/server/rbac/require-role';
import { eventsModule } from '@rede-social/module-events/module';
import { eventsRoutes } from '@rede-social/module-events/server';
import { createMiddleware } from 'hono/factory';
import { requestId } from 'hono/request-id';

// (4) The permission composition. The real API's registry also folds in every other module and the
// per-module settings; one module needs only the kernel grants plus its own manifest.
setPermissionResolver((role, enabled) => [
  ...KERNEL_ROLE_PERMISSIONS[role],
  ...(enabled.has('events') ? (eventsModule.defaultRolePermissions?.[role] ?? []) : []),
]);

// (5) The manifest's side effects, exactly what `apps/api/src/modules/registry.ts` does per module.
for (const subscription of eventsModule.events ?? []) {
  subscribe(subscription.event, subscription.handler);
}
registerJobQueues((eventsModule.jobs ?? []).map((job) => job.name));

/** (1) A child of the kernel root per request, carrying the request id. */
const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  c.set('logger', rootLogger.child({ requestId: c.get('requestId'), app: 'reuse-fixture' }));
  await next();
});

const app = new OpenAPIHono<AppEnv>();

app.use(requestId());
app.use(requestLogger);
// (2) Events after commit, dropped when the handler threw.
app.use(flushEventsAfterHandler);

// (3) The stable error envelope.
app.onError((err, c) => {
  const id = c.get('requestId');
  const { body, status } = errorEnvelope(err, id);
  if (!(err instanceof ApiError) || status >= 500) {
    c.get('logger').error({ err, requestId: id, code: body.error.code }, 'unhandled');
  }
  return c.json(body, status);
});

// (6) The mount. The module's router carries its own guard chain, so it cannot be mounted unguarded.
export const fixtureApp = app.route('/v1/events', eventsRoutes);
