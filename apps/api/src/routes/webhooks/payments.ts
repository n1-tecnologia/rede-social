import { receivePaymentWebhook } from '@rede-social/core/server/payments/receive';
import { bodyLimit } from 'hono/body-limit';
import { createOpenApiApp } from '../../http/openapi';

/**
 * `POST /v1/webhooks/{provider}/{integrationId}` — a tenant's payment gateway delivery (09.1-05, D-486,
 * PAY-03). The `mux.ts` posture, one level more neutral: the path names the ADAPTER (`provider`) and
 * the tenant's INTEGRATION ROW (`integrationId`, a uuid that is a handle, not a secret).
 *
 * THE GATEWAY'S SIGNATURE IS THIS ROUTE'S AUTHENTICATION: no bearer, no membership, no host rule. The
 * token that verifies it belongs to the tenant, is stored only sealed, and is opened in memory for the
 * duration of one delivery (`core/server/payments/receive.ts`).
 *
 *  - It is a plain `.post`, deliberately NOT an OpenAPI route definition: the endpoint is the gateway's
 *    contract, stays out of `openapi.json`, and no body parsing may run before the signature was
 *    verified over the RECEIVED BYTES. The body is read as bytes (`arrayBuffer()`) before anything else;
 *    a decoded string would break a signature over a body with a BOM or invalid UTF-8 (P5).
 *  - It is bounded by a 256 KiB body limit (413): the route is public, and there is no rate limiting in
 *    this repository (assumption A-P20), so the cheap 404 for an unknown handle and this cap are the
 *    mitigations.
 *  - It answers 2xx FAST and does the state change in `kernel.payment-event` (plan 07), because
 *    gateways retry on anything else and their budget is short. `Cache-Control: no-store` on every answer.
 *  - A `GET` is the liveness probe some gateways send before saving the URL (`{ status: 'ok' }`, no row
 *    read). It is a plain `.get`: Hono answers a HEAD request from the GET handler on its own, and a
 *    registered HEAD entry would be a route-table row the isolation inventory's key grammar cannot hold.
 *  - The signature rides the URL (`?signature=`). Nothing here logs `c.req.url`, the query string, the
 *    token, the signature or the body: lines carry ids only (the request logger adds the request id), and the request logger
 *    records `c.req.path`, which has no query (pinned by `payments-webhook.test.ts`).
 *
 * The `/mux` route is mounted under the same `/v1/webhooks` base without clashing: that one has a single
 * segment, this one two.
 */

export const PAYMENTS_WEBHOOK_MAX_BYTES = 256 * 1024;

export const paymentsWebhookRoutes = createOpenApiApp()
  .get('/:provider/:integrationId', (c) => c.json({ status: 'ok' }, 200))
  .post(
    '/:provider/:integrationId',
    bodyLimit({
      maxSize: PAYMENTS_WEBHOOK_MAX_BYTES,
      onError: (c) => c.json({ error: { code: 'PAYLOAD_TOO_LARGE' } }, 413),
    }),
    async (c) => {
      const log = c.get('logger');
      const rawBody = Buffer.from(await c.req.arrayBuffer());
      const provider = c.req.param('provider');
      const integrationId = c.req.param('integrationId');

      c.header('Cache-Control', 'no-store');

      const result = await receivePaymentWebhook({
        provider,
        integrationId,
        rawBody,
        signature: c.req.query('signature'),
      });

      if (result.kind === 'unknown_integration') {
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      }
      if (result.kind === 'rejected') {
        log.warn(
          { event: 'payments.webhook.signature_rejected', provider, integrationId },
          'payment webhook refused: bad, missing or tampered signature',
        );
        return c.json({ error: { code: 'FORBIDDEN' } }, 403);
      }
      return c.json({ received: true, enqueued: result.enqueued }, 200);
    },
  );
