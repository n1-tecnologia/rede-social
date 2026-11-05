import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { env } from '@rede-social/core/server/env';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { sql } from 'drizzle-orm';
import type { PushDeviceInput, PushSubscriptionInput } from '../contracts/index';
import { isAllowedPushEndpoint } from './push/endpoint';

const log = moduleLogger('module-notifications');

/** The one refusal shape of a subscription save: `400 VALIDATION_FAILED` with `details.push`. */
export type PushInputRefusal = 'endpoint_invalid' | 'keys_invalid';

export function pushInputError(reason: PushInputRefusal): ApiError {
  return new ApiError(400, 'VALIDATION_FAILED', { push: reason });
}

/**
 * NOTIF-03: the caller saves THIS device's subscription (`POST /v1/notifications/push-subscriptions`).
 * The body already passed `pushSubscriptionInputSchema` (key lengths); the endpoint's host rule needs
 * the active transport, so it is applied here (T-07-33): anything but `https:` on a known push-service
 * host is `400 endpoint_invalid`. The write is `app.push_subscription_upsert` in the caller's own tenant
 * lane, which requires a live membership and REPLACES any other user's row of the same endpoint (the
 * device changed hands, T-07-34).
 *
 * Logs carry the shape only (never the endpoint, the keys or the user agent).
 */
export async function savePushSubscription(
  ctx: RequestContext,
  input: PushSubscriptionInput,
): Promise<void> {
  if (!isAllowedPushEndpoint(input.endpoint, env.PUSH_TRANSPORT)) {
    throw pushInputError('endpoint_invalid');
  }
  await withTenantTx(ctx, (tx) =>
    tx.execute(sql`
      select app.push_subscription_upsert(
        ${input.endpoint}::text,
        ${input.keys.p256dh}::text,
        ${input.keys.auth}::text,
        ${input.userAgent ?? null}::text
      )`),
  );
  log.info({ event: 'push.subscription_saved', tenantId: ctx.tenantId }, 'push subscription saved');
}

/**
 * NATIVE-09: the installed app saves THIS device's APNs or FCM token (`POST /v1/notifications/push-subscriptions`
 * with `kind: 'apns' | 'fcm'`, D-603, D-606). The body already passed `pushDeviceInputSchema` (kind and platform
 * paired, token shape of its own kind, environment, app version). Unlike a web endpoint, a native token is NOT
 * a URL: `isAllowedPushEndpoint` (T-07-33) is deliberately not called here, the anchored token patterns are the
 * whole shape check, and the sender (plan 12) addresses the platform's own API, never a stored host.
 *
 * The write is `app.push_device_upsert` in the caller's own tenant lane (plan 13-06): it requires a live
 * membership, hands the token over inside the tenant when another member held it (the phone changed hands),
 * refreshes the app version of the caller's own row, and never touches another tenant's row. Returns the row id.
 *
 * Logs carry the shape only (`kind`, `platform`): never the token, the environment or the app version
 * (T-13-20). An error from the database is rethrown untouched; the function's messages are fixed text.
 */
export async function savePushDevice(ctx: RequestContext, body: PushDeviceInput): Promise<string> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      select app.push_device_upsert(
        ${body.kind}::text,
        ${body.token}::text,
        ${body.platform}::text,
        ${body.environment}::text,
        ${body.appVersion}::text
      ) as id`),
  );
  log.info(
    { event: 'push.device.saved', kind: body.kind, platform: body.platform },
    'push device saved',
  );
  return String(rows[0]?.id ?? '');
}

/**
 * The caller forgets one of THEIR devices (logout on a shared device, 07-07; the switch turned off).
 * A plain DELETE in the caller's tenant lane: `push_subscriptions_owner_delete` makes every other
 * member's row (and every other tenant's) invisible, so a foreign endpoint deletes nothing. Idempotent:
 * the route answers 204 whether or not a row matched.
 */
export async function deletePushSubscription(ctx: RequestContext, endpoint: string): Promise<void> {
  await withTenantTx(ctx, (tx) =>
    tx.execute(sql`
      delete from public.push_subscriptions
       where tenant_id = ${ctx.tenantId}::uuid
         and user_id = ${ctx.userId}::uuid
         and endpoint = ${endpoint}`),
  );
}
