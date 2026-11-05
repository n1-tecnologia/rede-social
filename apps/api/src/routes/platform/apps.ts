import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import {
  APP_CREDENTIAL_KINDS,
  type AppCredentialKind,
  apnsKeyBodySchema,
  appTabSchema,
  ascKeyBodySchema,
  credentialAnswerSchema,
  playServiceAccountBodySchema,
} from '@rede-social/contracts/native';
import {
  CredentialRefusal,
  readAppTab,
  replaceAppCredential,
  requireTenant,
} from '@rede-social/core/server/apps/index';
import { ApiError } from '@rede-social/core/server/http/api-error';
import type { PlatformEnv } from '@rede-social/core/server/platform/require-super-admin';
import { platformDefaultHook } from '../../http/openapi';

/**
 * `/v1/platform/tenants/{id}/app*` (13-09, D-605, D-607, D-615, D-617, NATIVE-24, NATIVE-26): the server half of
 * the platform panel's "App" tab. Mounted by `routes/platform/index.ts` AFTER `platform.use('*',
 * requireSuperAdmin())` and the `refuseWhileMoving` middleware, so a tenant admin, a member and an anonymous
 * caller never reach a handler and a tenant being moved is read-only here (T-13-17).
 *
 * WRITE-ONLY CUSTODY (T-13-16, UI-D-628). A store credential enters through `PUT .../app/credentials/{kind}`,
 * is format-checked, sealed under the platform master key and forgotten: the answer is `{ ok: true }`, the read
 * answers `held` and a date and nothing else, and every log line is an event name with ids and the kind. This
 * file imports ONLY from the kernel module's public index and never calls the function that unseals.
 *
 * Every answer is `Cache-Control: no-store`.
 */
const appsRouter = new OpenAPIHono<PlatformEnv>({ defaultHook: platformDefaultHook });

const idParams = z.object({ id: z.uuid() });
const credentialParams = z.object({ id: z.uuid(), kind: z.enum(APP_CREDENTIAL_KINDS) });

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

/**
 * One body per kind, chosen by the path. The three are strict and tell each other apart by their keys; the
 * handler re-parses with the schema of the kind, so a body for the wrong kind is `VALIDATION_FAILED`.
 */
const credentialBodySchema = z.union([
  ascKeyBodySchema,
  apnsKeyBodySchema,
  playServiceAccountBodySchema,
]);

const readRoute = createRoute({
  method: 'get',
  path: '/tenants/{id}/app',
  request: { params: idParams },
  responses: {
    200: {
      description:
        'The App tab: identity, the three store credentials as held or not, the links with their verdicts, the purchase switches, the listing, the checklist and the derived state. A tenant with no app reads the empty form. No secret, Key ID, prefix, length, file name or hash is ever returned',
      content: { 'application/json': { schema: appTabSchema } },
    },
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

const credentialRoute = createRoute({
  method: 'put',
  path: '/tenants/{id}/app/credentials/{kind}',
  request: {
    params: credentialParams,
    body: { content: { 'application/json': { schema: credentialBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The file was the right kind and was sealed; nothing is ever returned. Saving it again replaces the held value',
      content: { 'application/json': { schema: credentialAnswerSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED, CREDENTIAL_NOT_P8, CREDENTIAL_KEY_ID_MISMATCH or CREDENTIAL_NOT_SERVICE_ACCOUNT; the previously held value is unchanged',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
    409: envelope('TENANT_MOVING — the tenant is being moved to another database'),
  },
});

const BODY_BY_KIND = {
  asc_key: ascKeyBodySchema,
  apns_key: apnsKeyBodySchema,
  play_service_account: playServiceAccountBodySchema,
} as const satisfies Record<AppCredentialKind, z.ZodType>;

export const appsRoutes = appsRouter
  .openapi(readRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');

    const tab = await readAppTab(id);

    c.get('logger').info(
      { event: 'platform.apps.read', userId, requestId, tenantId: id, appState: tab.appState },
      'platform read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(tab, 200);
  })
  .openapi(credentialRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id, kind } = c.req.valid('param');
    const raw = c.req.valid('json');

    await requireTenant(id);

    // The body of the path's kind, and nothing else: a body for another kind is a validation failure that names
    // nothing about the value.
    const parsed = BODY_BY_KIND[kind].safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED');
    const body = parsed.data as Record<string, string | null | undefined>;

    try {
      // The values go straight to the kernel, which validates them, seals them and forgets them. They are never
      // logged, never echoed and never kept in this scope past the call.
      await replaceAppCredential(
        id,
        kind,
        kind === 'play_service_account' ? (body.json as string) : (body.p8 as string),
        {
          userId,
          logger: c.get('logger'),
          keyId: body.keyId ?? undefined,
          issuerId: body.issuerId ?? undefined,
          fileKeyId: body.fileKeyId,
        },
      );
    } catch (error) {
      if (error instanceof CredentialRefusal) throw new ApiError(400, error.code);
      throw error;
    }

    c.get('logger').info(
      { event: 'platform.apps.credential', userId, requestId, tenantId: id, kind },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true as const }, 200);
  });
