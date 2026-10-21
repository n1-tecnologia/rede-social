import { createHash } from 'node:crypto';

/**
 * The fixed namespace of the integration handle (09.1-09, RFC 4122 section 4.3). A constant, never
 * secret, never changed: changing it would move every tenant's webhook URL.
 */
export const PAYMENTS_ID_NAMESPACE = '7d0a4c9e-3b52-4f1a-a6c8-91e5d2b07f34';

/**
 * `payment_integrations.id` for a tenant and a provider, derived instead of random (09.1-09, planning
 * decision 3). It is an RFC 4122 section 4.3 name-based UUID: SHA-1 of the namespace bytes followed by
 * `<tenantId>:<provider>`, the first 16 bytes, version nibble 5 and the RFC variant bits.
 *
 * Why derived. The id is the webhook route handle (`POST /v1/webhooks/<provider>/<id>`) AND the
 * additional authenticated data of the sealed token (`secret.ts`). The Pagamentos screen must show the
 * URL the admin pastes into the gateway BEFORE any token exists, so the handle cannot wait for a row;
 * and a placeholder row would flip the store into gateway mode (`app.payments_gateway_mode()` is true
 * whenever an integration row with a sealed token exists) before the admin finished. With a derived id
 * the first save creates the row with exactly the id the screen already showed, and nothing half
 * connected ever exists.
 *
 * The id is not secret: the signature is the authentication. A tenant id is not secret either, so
 * nothing here needs hiding; it only needs to be stable and collision free between tenants and providers.
 */
export function deterministicIntegrationId(tenantId: string, provider: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(PAYMENTS_ID_NAMESPACE.replaceAll('-', ''), 'hex'))
    .update(`${tenantId}:${provider}`, 'utf8')
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
