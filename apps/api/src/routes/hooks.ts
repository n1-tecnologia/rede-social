import type { AppEnv } from '@rede-social/core/server/auth/context';
import { env } from '@rede-social/core/server/env';
import {
  HOOK_HEADER_NAMES,
  HookPayloadError,
  HookSignatureError,
  parseHookSecrets,
  verifyHookRequest,
} from '@rede-social/core/server/mail/hook-schema';
import { MailRefusedError, sendAuthMail } from '@rede-social/core/server/mail/index';
import { hookSecretsFor, resolveHookProject } from '@rede-social/core/server/mail/project-hook';
import type { ProjectRecord } from '@rede-social/core/server/tenancy/project-registry';
import type { Context } from 'hono';
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
 * would retry inside the same 5 s budget (T-02-27).
 *
 * 09.2-11 (DBT-14, D-542): every Supabase project has its own GoTrue and so its own hook, at
 * `POST /v1/hooks/auth/send-email/{hookRef}`. The reference only selects the project (unknown or
 * malformed: 404 BEFORE any secret is opened or a signature checked); the signature is verified with
 * THAT project's sealed secret only, never the legacy list. The legacy path keeps serving project 0
 * with `SEND_EMAIL_HOOK_SECRETS`, byte for byte as before, so production's Auth config needs no change. Logs carry `webhookId`, `actionType`,
 * `requestId` and a masked recipient; never the token, the token hash or the link (T-02-25).
 */
export const hookRoutes = createOpenApiApp()
  .post('/auth/send-email', (c) =>
    handleHook(c, { secrets: () => parseHookSecrets(env.SEND_EMAIL_HOOK_SECRETS) }),
  )
  .post('/auth/send-email/:hookRef', async (c) => {
    c.header('Cache-Control', 'no-store');
    let project: ProjectRecord | null;
    try {
      project = await resolveHookProject(c.req.param('hookRef'));
    } catch (err) {
      c.get('logger').error(
        { event: 'mail.send_failed', err, requestId: c.get('requestId') },
        'hook project lookup failed',
      );
      return c.json({ error: { http_code: 500, message: 'send failed' } }, 500);
    }
    if (!project) {
      c.get('logger').warn(
        { event: 'mail.unknown_hook_ref', requestId: c.get('requestId') },
        'hook reference unknown',
      );
      return c.json({ error: { http_code: 404, message: 'not found' } }, 404);
    }
    return handleHook(c, { secrets: () => hookSecretsFor(project), project });
  });

type HookTarget = {
  /** The signing secrets to verify with: opened per request, evaluated in stored order. */
  secrets: () => string[];
  /** Set on the per-project route; absent on the legacy one. */
  project?: ProjectRecord;
};

async function handleHook(c: Context<AppEnv>, target: HookTarget) {
  const log = c.get('logger');
  const requestId = c.get('requestId');
  const raw = await c.req.text();
  const headers: Record<string, string | undefined> = {};
  for (const name of HOOK_HEADER_NAMES) headers[name] = c.req.header(name);
  const webhookId = headers['webhook-id'] ?? 'missing';
  const projectId = target.project?.id;
  let actionType: string | null = null;

  c.header('Cache-Control', 'no-store');
  try {
    const payload = verifyHookRequest(raw, headers, target.secrets());
    actionType = payload.email_data.email_action_type;
    const result = await sendAuthMail({
      payload,
      webhookId,
      logger: log,
      ...(target.project ? { project: target.project } : {}),
    });
    if (result.outcome === 'duplicate') {
      log.info(
        { event: 'mail.duplicate_suppressed', webhookId, requestId, projectId },
        'hook replay suppressed',
      );
    }
    return c.json({}, 200);
  } catch (err) {
    if (err instanceof HookSignatureError) {
      log.warn({ event: 'mail.signature_rejected', webhookId, requestId, projectId }, err.message);
      return c.json({ error: { http_code: 401, message: 'invalid signature' } }, 401);
    }
    if (err instanceof HookPayloadError || err instanceof MailRefusedError) {
      log.warn(
        { event: 'mail.refused', reason: err.reason, webhookId, actionType, requestId, projectId },
        'auth mail refused',
      );
      return c.json({ error: { http_code: 500, message: err.reason } }, 500);
    }
    log.error(
      { event: 'mail.send_failed', err, webhookId, actionType, requestId, projectId },
      'auth mail failed',
    );
    return c.json({ error: { http_code: 500, message: 'send failed' } }, 500);
  }
}
