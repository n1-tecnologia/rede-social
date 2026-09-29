import {
  absoluteBrandUrl,
  createBoundedTtlCache,
  deriveBrandColors,
  NEUTRAL_BRAND,
} from '@rede-social/contracts';
import { env, publicWebOrigin } from '../env';
import { type Logger, moduleLogger } from '../logging';
import {
  type MailTenantResolution,
  redirectHostOf,
  resolveMailTenant,
} from '../tenancy/mail-tenant';
import { buildActionLink, HookPayloadError, type SendEmailHookPayload } from './hook-schema';
import { localTransport } from './local';
import { resendTransport } from './resend';
import { renderInvite } from './templates/invite';
import { type MailBrand, type RenderedMail, safeHttpUrl } from './templates/layout';
import { LINK_ACTION_TYPES, renderNeutral } from './templates/neutral';
import { renderRecovery } from './templates/recovery';
import { MAIL_SEND_TIMEOUT_MS, type MailTransport, maskEmail } from './transport';

/**
 * The kernel's auth-mail pipeline (D-37): hook payload → tenant resolution → pt-BR template →
 * transport. The transport is selected ONCE from `env.MAIL_TRANSPORT`; `local` (Mailpit) is the
 * default, so nothing here can send real mail unless a deploy asked for `resend` explicitly
 * (`assertProductionEnv` then requires `RESEND_API_KEY` at boot).
 */
function selectTransport(): MailTransport {
  switch (env.MAIL_TRANSPORT) {
    case 'local':
      return localTransport;
    case 'resend':
      return resendTransport;
  }
}

export const mailTransport: MailTransport = selectTransport();

/** The resolution refused the send (mismatch, unsupported type, no recipient) → 500, nothing sent. */
export class MailRefusedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'MailRefusedError';
    this.reason = reason;
  }
}

const NEUTRAL_COLORS = deriveBrandColors(NEUTRAL_BRAND);

/**
 * Replay guard (T-02-22, Pitfall 6): GoTrue retries inside its 5 s budget with the SAME
 * `webhook-id`; a retry that reaches us after a slow-but-successful send must not double-send. The
 * id is remembered BEFORE the transport call and forgotten on transport failure, so a later
 * legitimate retry may still succeed. Bounded LRU: 5,000 ids for 15 minutes.
 */
const seenWebhookIds = createBoundedTtlCache<true>(5_000);
const SEEN_TTL_MS = 15 * 60_000;

/**
 * Brand facts for the template. Tenant: display name, the logo resolved to an absolute URL of the
 * tenant's primary host (seed logos are root-relative, uploads absolute) and filtered by
 * `safeHttpUrl` (http only when the web app itself is served over http), the PERSISTED
 * `colors.primary` / `colors.onPrimary` (D-25/D-41). Neutral: Rede Social, no logo, the neutral pair.
 */
export function toMailBrand(
  resolution: MailTenantResolution,
  redirectHost: string | null,
): MailBrand {
  if (resolution.kind === 'tenant') {
    const host = resolution.primaryHost ?? redirectHost;
    let logoUrl: string | null = null;
    try {
      logoUrl = host
        ? absoluteBrandUrl(resolution.branding.logoUrl, publicWebOrigin(host))
        : resolution.branding.logoUrl;
    } catch {
      logoUrl = null;
    }
    return {
      displayName: resolution.displayName,
      logoUrl: safeHttpUrl(logoUrl, env.PUBLIC_WEB_SCHEME === 'http'),
      primary: resolution.branding.colors.primary,
      onPrimary: resolution.branding.colors.onPrimary,
    };
  }
  return {
    displayName: 'Rede Social',
    logoUrl: null,
    primary: NEUTRAL_COLORS.primary,
    onPrimary: NEUTRAL_COLORS.onPrimary,
  };
}

/** `recovery` and `invite` have dedicated templates; every other type falls back to `renderNeutral`. */
function render(brand: MailBrand, emailData: SendEmailHookPayload['email_data']): RenderedMail {
  const actionType = emailData.email_action_type;
  switch (actionType) {
    case 'recovery':
      return renderRecovery({
        brand,
        link: buildActionLink(emailData.redirect_to, emailData.token_hash, 'recovery'),
      });
    case 'invite':
      return renderInvite({
        brand,
        link: buildActionLink(emailData.redirect_to, emailData.token_hash, 'invite'),
      });
    default: {
      // Link types get a link only when there is a token hash and `redirect_to` parses; a
      // notification with a broken redirect is still worth delivering.
      let link: string | null = null;
      if (LINK_ACTION_TYPES.has(actionType) && emailData.token_hash) {
        try {
          link = buildActionLink(emailData.redirect_to, emailData.token_hash, actionType);
        } catch {
          link = null;
        }
      }
      const code = actionType === 'reauthentication' && emailData.token ? emailData.token : null;
      return renderNeutral({ brand, actionType, link, code });
    }
  }
}

/**
 * Whether a GoTrue action type's mail carries a confirm link (`invite` and `recovery` have their own
 * templates and always do; the neutral link types are `LINK_ACTION_TYPES`). Drives the Send Email
 * Hook's link-host guard (`resolveMailTenant` `linkRequired`, quick 260929-g0s): notifications and
 * reauthentication codes are never refused for their `redirect_to` host.
 */
export function isLinkActionType(type: string): boolean {
  return type === 'invite' || type === 'recovery' || LINK_ACTION_TYPES.has(type);
}

export type SendAuthMailInput = {
  payload: SendEmailHookPayload;
  webhookId: string;
  /** The request's child logger, so `mail.*` lines carry `requestId`. */
  logger?: Logger;
};

export type SendAuthMailResult = {
  outcome: 'sent' | 'duplicate';
  tenantId: string | null;
  actionType: string;
};

/**
 * Renders and sends ONE auth e-mail for a verified hook payload. Never logs `token`, `token_hash`
 * or the built link (T-02-25). The transport call is bounded by `MAIL_SEND_TIMEOUT_MS` so the route
 * answers inside GoTrue's budget (T-02-27).
 */
export async function sendAuthMail(input: SendAuthMailInput): Promise<SendAuthMailResult> {
  const log = input.logger ? input.logger.child({ name: 'mail' }) : moduleLogger('mail');
  const { payload, webhookId } = input;
  const actionType = payload.email_data.email_action_type;

  if (seenWebhookIds.get(webhookId)) {
    return { outcome: 'duplicate', tenantId: null, actionType };
  }

  const to = payload.user.email;
  if (!to) throw new HookPayloadError('no_recipient');

  const redirectHost = redirectHostOf(payload.email_data.redirect_to);
  const resolution = await resolveMailTenant({
    userId: payload.user.id,
    email: to,
    redirectTo: payload.email_data.redirect_to,
    linkRequired: isLinkActionType(actionType),
  });
  if (resolution.kind === 'refused') throw new MailRefusedError(resolution.reason);

  const brand = toMailBrand(resolution, redirectHost);
  const tenantId = resolution.kind === 'tenant' ? resolution.tenantId : null;
  const rendered = render(brand, payload.email_data);

  seenWebhookIds.set(webhookId, true, SEEN_TTL_MS);
  try {
    await mailTransport.send(
      {
        from: { name: brand.displayName, email: `no-reply@${env.MAIL_DOMAIN}` },
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: webhookId,
        meta: { actionType, tenantId },
      },
      { signal: AbortSignal.timeout(MAIL_SEND_TIMEOUT_MS) },
    );
  } catch (err) {
    seenWebhookIds.delete(webhookId);
    throw err;
  }

  log.info(
    {
      event: 'mail.sent',
      transport: mailTransport.name,
      actionType,
      tenantId,
      via: resolution.via,
      webhookId,
      to: maskEmail(to),
    },
    'auth mail sent',
  );

  return { outcome: 'sent', tenantId, actionType };
}
