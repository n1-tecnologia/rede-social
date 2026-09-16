import { absoluteBrandUrl, deriveBrandColors, NEUTRAL_BRAND } from '@tria/contracts';
import { env, publicWebOrigin } from '../env';
import { type Logger, moduleLogger } from '../logging';
import {
  type MailTenantResolution,
  redirectHostOf,
  resolveMailTenant,
} from '../tenancy/mail-tenant';
import { buildActionLink, HookPayloadError, type SendEmailHookPayload } from './hook-schema';
import { localTransport } from './local';
import { type MailBrand, safeHttpUrl } from './templates/layout';
import { renderRecovery } from './templates/recovery';
import { MAIL_SEND_TIMEOUT_MS, type MailTransport, maskEmail } from './transport';

/**
 * The kernel's auth-mail pipeline (D-37): hook payload → tenant resolution → pt-BR template →
 * transport. The transport is selected ONCE from `env.MAIL_TRANSPORT`; `local` (Mailpit) is the
 * default, so nothing here can send real mail unless a deploy asked for `resend` explicitly.
 */
function selectTransport(): MailTransport {
  switch (env.MAIL_TRANSPORT) {
    case 'local':
      return localTransport;
    case 'resend':
      // Wired by the expansion task (`./resend.ts`); selecting it before then is a boot error.
      throw new Error('MAIL_TRANSPORT=resend is not available yet');
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
 * Brand facts for the template. Tenant: display name, the logo resolved to an absolute URL of the
 * tenant's primary host (seed logos are root-relative, uploads absolute) and filtered by
 * `safeHttpUrl` (http only when the web app itself is served over http), the PERSISTED
 * `colors.primary` / `colors.onPrimary` (D-25/D-41). Neutral: TRIA, no logo, the neutral pair.
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
    displayName: 'TRIA',
    logoUrl: null,
    primary: NEUTRAL_COLORS.primary,
    onPrimary: NEUTRAL_COLORS.onPrimary,
  };
}

export type SendAuthMailInput = {
  payload: SendEmailHookPayload;
  webhookId: string;
  /** The request's child logger, so `mail.*` lines carry `requestId`. */
  logger?: Logger;
};

export type SendAuthMailResult = {
  outcome: 'sent';
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

  const to = payload.user.email;
  if (!to) throw new HookPayloadError('no_recipient');

  const redirectHost = redirectHostOf(payload.email_data.redirect_to);
  const resolution = await resolveMailTenant({
    userId: payload.user.id,
    redirectTo: payload.email_data.redirect_to,
  });
  if (resolution.kind === 'refused') throw new MailRefusedError(resolution.reason);

  const brand = toMailBrand(resolution, redirectHost);
  const tenantId = resolution.kind === 'tenant' ? resolution.tenantId : null;

  if (actionType !== 'recovery') throw new MailRefusedError('unsupported_action_type');
  const rendered = renderRecovery({
    brand,
    link: buildActionLink(
      payload.email_data.redirect_to,
      payload.email_data.token_hash,
      'recovery',
    ),
  });

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
