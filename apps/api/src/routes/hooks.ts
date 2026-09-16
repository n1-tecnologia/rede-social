import { env } from '@tria/core/server/env';
import {
  HOOK_HEADER_NAMES,
  HookPayloadError,
  HookSignatureError,
  parseHookSecrets,
  verifyHookRequest,
} from '@tria/core/server/mail/hook-schema';
import { MailRefusedError, sendAuthMail } from '@tria/core/server/mail/index';
import { createOpenApiApp } from '../http/openapi';

/**
 * `POST /v1/hooks/auth/send-email` — GoTrue's Send Email Hook (D-37).
 *
 * The Standard Webhooks signature IS this route's authentication: no bearer, no membership, no host
 * rule. It is a plain `.post`, deliberately NOT an OpenAPI route definition — the endpoint is
 * GoTrue's contract, must stay out of `openapi.json`, and no zod-openapi body parsing may run before
 * the signature was verified over the RAW body (RESEARCH Pitfall 7).
 *
 * Answers in GoTrue's own error shape, never through `app.onError`: `200 {}` on success (a
 * suppressed duplicate included), `401 { error: { http_code, message } }` when the signature does not
 * verify against any configured secret, `500` for everything else — never 429/503, which GoTrue
 * would retry inside the same 5 s budget (T-02-27). Logs carry `webhookId`, `actionType`,
 * `requestId` and a masked recipient; never the token, the token hash or the link (T-02-25).
 */
export const hookRoutes = createOpenApiApp().post('/auth/send-email', async (c) => {
  const log = c.get('logger');
  const requestId = c.get('requestId');
  const raw = await c.req.text();
  const headers: Record<string, string | undefined> = {};
  for (const name of HOOK_HEADER_NAMES) headers[name] = c.req.header(name);
  const webhookId = headers['webhook-id'] ?? 'missing';
  let actionType: string | null = null;

  c.header('Cache-Control', 'no-store');
  try {
    const payload = verifyHookRequest(raw, headers, parseHookSecrets(env.SEND_EMAIL_HOOK_SECRETS));
    actionType = payload.email_data.email_action_type;
    const result = await sendAuthMail({ payload, webhookId, logger: log });
    if (result.outcome === 'duplicate') {
      log.info(
        { event: 'mail.duplicate_suppressed', webhookId, requestId },
        'hook replay suppressed',
      );
    }
    return c.json({}, 200);
  } catch (err) {
    if (err instanceof HookSignatureError) {
      log.warn({ event: 'mail.signature_rejected', webhookId, requestId }, err.message);
      return c.json({ error: { http_code: 401, message: 'invalid signature' } }, 401);
    }
    if (err instanceof HookPayloadError || err instanceof MailRefusedError) {
      log.warn(
        { event: 'mail.refused', reason: err.reason, webhookId, actionType, requestId },
        'auth mail refused',
      );
      return c.json({ error: { http_code: 500, message: err.reason } }, 500);
    }
    log.error(
      { event: 'mail.send_failed', err, webhookId, actionType, requestId },
      'auth mail failed',
    );
    return c.json({ error: { http_code: 500, message: 'send failed' } }, 500);
  }
});
