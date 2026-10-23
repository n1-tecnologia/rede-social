import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { moduleLogger } from '../logging';
import { recordPaymentEvent } from './inbox';
import { gatewayAdapter } from './index';
import { resolveIntegrationRoute } from './routes';
import { openSecret } from './secret';
import { GatewayError } from './types';

/**
 * Receives ONE delivery of a payment gateway (09.1-05, D-486, PAY-03): resolve the tenant's integration,
 * open its sealed token, verify the signature over the received bytes, normalise, record. The route
 * (`apps/api/src/routes/webhooks/payments.ts`) passes the bytes untouched, the `signature` query value
 * and the two path segments; everything else happens here, in the kernel, because the admin lane is
 * kernel-only.
 *
 * REJECT CHEAPLY, THEN DECRYPT (planning decision 4). The route is public and there is no rate limiting
 * in this repository (assumption A-P20), so random traffic must cost as little as possible. In order:
 *  1. the integration id has the shape of a uuid;
 *  2. ONE indexed primary-key read of the CENTRAL route index `platform.payment_integration_routes`
 *     (09.2-10, D-486: the delivery carries no host, so this read is what finds the tenant and with it
 *     the tenant's project; it is the only database work an unknown handle costs, and no tenant database
 *     is opened for it);
 *  3. the route's provider equals the path segment, exactly;
 *  4. the provider names an enabled adapter;
 *  5. the integration row is read by primary key INSIDE the tenant's own project (provider equal again);
 *  6. ONLY NOW the sealed token is opened (AES-GCM) and the signature verified.
 * Steps 1-5 answer `unknown_integration` (a 404 carrying nothing); a bad signature answers `rejected`
 * (a 403) and stores nothing. The index only decides WHERE a delivery is recorded: whether it is genuine
 * is still the tenant's token (T-09.2-45).
 *
 * The tenant of the recorded event is the INTEGRATION'S tenant, never anything in the payload
 * (T-09.1-22). The plaintext token lives only in the local variable below while one delivery is
 * verified. An unreadable sealed token (a key mismatch is OUR misconfiguration) fails CLOSED as
 * `rejected` with a loud error line that names the integration id only; it cannot be provoked from
 * outside. Any other throw (a database error) propagates: the route answers 500 and the gateway retries.
 *
 * LOGS carry ids, the neutral type and the outcome — never the body, the query string, the token, the
 * signature or the buyer's e-mail.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const log = moduleLogger('payments');

export type ReceiveResult =
  | { kind: 'unknown_integration' }
  | { kind: 'rejected' }
  | { kind: 'accepted'; eventId: string; enqueued: boolean };

export async function receivePaymentWebhook(input: {
  provider: string;
  integrationId: string;
  rawBody: Buffer;
  signature: string | undefined;
}): Promise<ReceiveResult> {
  const { provider, integrationId, rawBody, signature } = input;
  if (!UUID.test(integrationId)) return { kind: 'unknown_integration' };

  const route = await resolveIntegrationRoute(integrationId);
  if (!route || route.provider !== provider) return { kind: 'unknown_integration' };

  const adapter = gatewayAdapter(provider);
  if (!adapter) return { kind: 'unknown_integration' };

  const rows = await withAdminTx(
    { tenantId: route.tenantId },
    async (tx) =>
      (await tx.execute(sql`
        select id, tenant_id, provider, secret_sealed
          from public.payment_integrations
         where id = ${integrationId}::uuid and tenant_id = ${route.tenantId}::uuid`)) as unknown as {
        id: string;
        tenant_id: string;
        provider: string;
        secret_sealed: string;
      }[],
  );
  // A route whose tenant row was never written (an orphan of a failed save) finds nothing here.
  const integration = rows[0];
  if (!integration || integration.provider !== provider) return { kind: 'unknown_integration' };

  let variant: string;
  let signed: Buffer;
  try {
    const secret = openSecret(integration.secret_sealed, integration.id);
    ({ variant, signed } = adapter.verify({ rawBody, signature, secret }));
  } catch (error) {
    if (error instanceof GatewayError) return { kind: 'rejected' };
    log.error(
      { event: 'payments.webhook.secret_unreadable', provider, integrationId: integration.id },
      'the sealed webhook token could not be opened; refusing the delivery',
    );
    return { kind: 'rejected' };
  }

  // Normalise the authenticated material too, so the event that is applied is the one that was signed.
  const event = adapter.normalise(signed);
  const recorded = await recordPaymentEvent({
    integration: { id: integration.id, tenantId: integration.tenant_id, provider },
    event,
    // The replay memory keys on the bytes that were AUTHENTICATED, not the bytes received (CR-01): an
    // adapter may accept more than one rendering of a signed delivery. For a delivery whose received
    // bytes were signed as-is, `signed` IS the received bytes, so every key recorded before this change
    // stays valid (no migration).
    dedupeKey: createHash('sha256').update(signed).digest('hex'),
  });

  log.info(
    {
      event: recorded.enqueued ? 'payments.webhook.received' : 'payments.webhook.duplicate',
      provider,
      integrationId: integration.id,
      eventId: recorded.eventId,
      type: event.type,
      variant,
      outcome: recorded.enqueued ? 'enqueued' : 'not_enqueued',
    },
    recorded.enqueued ? 'payment webhook accepted' : 'payment webhook already seen',
  );

  return { kind: 'accepted', eventId: recorded.eventId, enqueued: recorded.enqueued };
}
