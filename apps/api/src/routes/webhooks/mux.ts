import { recordProviderEvent } from '@tria/core/server/media/video/inbox';
import { videoProvider } from '@tria/core/server/media/video/index';
import { createOpenApiApp } from '../../http/openapi';

/**
 * `POST /v1/webhooks/mux` — the video provider's delivery endpoint (MEDIA-03, R-03).
 *
 * THE PROVIDER'S SIGNATURE IS THIS ROUTE'S AUTHENTICATION: no bearer, no membership, no host rule.
 * It is a plain `.post`, deliberately NOT an OpenAPI route definition — the endpoint is the
 * provider's contract, must stay out of `openapi.json`, and no zod-openapi body parsing may run
 * before the signature was verified over the RAW body (the 02-06 `hooks.ts` precedent).
 * `videoProvider.verifyWebhook` is HMAC-SHA256 over `timestamp.rawBody` with a 5-minute tolerance
 * and a timing-safe compare; a throw is a 403 and nothing else happens (T-03-37).
 *
 * The handler answers 2xx FAST and does the state change in `kernel.media-provider-event`, because
 * Mux retries for 24 h on anything else and its budget is short. Two independent idempotency layers
 * (T-03-38): the provider's own `event.id` is the PRIMARY KEY of `media_provider_events`, inserted
 * with `on conflict (id) do nothing returning id` — a zero-row return answers 200 and enqueues
 * nothing — and the job itself carries `singletonKey = event.id` under the `short` queue policy, so
 * even two simultaneous first deliveries converge on one job.
 *
 * The path is `/mux` under the `/v1/webhooks` mount, which is the URL configured in the Mux
 * dashboard (`docs/DEPLOY.md`, Phase 01.1). It is the PROVIDER-NEUTRAL handler behind a
 * provider-named path: `videoProvider` decides who verifies, so pointing a second vendor at
 * its own path is a mount line, not a rewrite.
 *
 * Logs carry the event id, the raw type and the request id — never a provider body (T-03-41).
 */

/** The headers the verifier reads. Collected into a plain object; the body is never parsed here. */
const WEBHOOK_HEADER_NAMES = ['mux-signature'] as const;

export const muxWebhookRoutes = createOpenApiApp().post('/mux', async (c) => {
  const log = c.get('logger');
  const requestId = c.get('requestId');
  const raw = await c.req.text();
  const headers: Record<string, string | undefined> = {};
  for (const name of WEBHOOK_HEADER_NAMES) headers[name] = c.req.header(name);

  c.header('Cache-Control', 'no-store');

  let event: Awaited<ReturnType<typeof videoProvider.verifyWebhook>>;
  try {
    event = await videoProvider.verifyWebhook(raw, headers);
  } catch {
    log.warn(
      { event: 'media.webhook.signature_rejected', provider: videoProvider.name, requestId },
      'video webhook refused: bad, tampered or stale signature',
    );
    return c.json({ error: { code: 'FORBIDDEN' } }, 403);
  }

  // `recordProviderEvent` is the kernel half: the `on conflict (id) do nothing` insert of the
  // provider's own event id and the `singletonKey: event.id` enqueue, in ONE admin transaction (the
  // admin lane is kernel-only, so the route cannot open it here).
  const enqueued = await recordProviderEvent(event);

  log.info(
    {
      event: enqueued ? 'media.webhook.received' : 'media.webhook.duplicate',
      eventId: event.id,
      rawType: event.rawType,
      kind: event.kind,
      provider: videoProvider.name,
      requestId,
    },
    enqueued ? 'video webhook accepted' : 'video webhook already seen; nothing enqueued',
  );

  return c.json({ received: true, enqueued }, 200);
});
