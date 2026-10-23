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
  tenantBelongsToProject,
} from '../tenancy/mail-tenant';
import type { ProjectRecord } from '../tenancy/project-registry';
import { buildActionLink, HookPayloadError, type SendEmailHookPayload } from './hook-schema';
import { localTransport } from './local';
import { resendTransport } from './resend';
import { renderInvite } from './templates/invite';
import { type MailBrand, type RenderedMail, safeHttpUrl } from './templates/layout';
import { LINK_ACTION_TYPES, renderNeutral } from './templates/neutral';
import { renderRecovery } from './templates/recovery';
import { renderSignup } from './templates/signup';
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

/**
 * The path the web app asks GoTrue to send the sign-up confirmation back to. Must stay byte-identical
 * to the `emailRedirectTo` literal in `apps/web/lib/signup-confirmation.ts` (the web app cannot import
 * kernel server code).
 */
export const SIGNUP_CONFIRM_PATH = '/auth/confirm?next=/inicio';

/**
 * The replacement `redirect_to` for a `site_url`-fallback signup link, or null (quick 261012-s0v).
 *
 * GoTrue drops an `emailRedirectTo` whose host is missing from the hosted `uri_allow_list` (every
 * `supabase config push` wipes the runtime per-domain entries, docs/DEPLOY.md WR-09) and falls back
 * to `site_url` — a hostless, pathless link that `proxy.ts` used to bounce to `/entrar`, stranding
 * the new member. Row 6a already brands that mail for the identity's only membership; this helper
 * restores exactly the path the web app asked for, on that tenant's host.
 *
 * Consistent with T-02-26 ("the hook never invents a host"): the host is `resolution.primaryHost`,
 * read by `tenantBrandRow` from `tenant_domains` — a verified AND primary row, server truth, the same
 * source `platform/invites.ts` uses to compose the invite `redirectTo` through `publicWebOrigin` —
 * never the payload's `redirect_to`, `site_url` or `user_metadata`. Scope is strict: `signup` only;
 * no change when an H existed (`hostMatched`); with no verified primary host the link stays on
 * `redirect_to` as before; recovery, invite and every other type are untouched.
 */
export function rehomedSignupRedirect(
  resolution: MailTenantResolution,
  actionType: string,
): string | null {
  if (actionType !== 'signup') return null;
  if (resolution.kind !== 'tenant') return null;
  if (resolution.hostMatched !== false) return null;
  if (!resolution.primaryHost) return null;
  return `${publicWebOrigin(resolution.primaryHost)}${SIGNUP_CONFIRM_PATH}`;
}

/** `recovery`, `invite` and `signup` have dedicated templates; every other type falls back to `renderNeutral`. */
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
    case 'signup':
      return renderSignup({
        brand,
        link: buildActionLink(emailData.redirect_to, emailData.token_hash, 'signup'),
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

/** Re-exported for the hook's callers and tests; defined beside `LINK_ACTION_TYPES`. */
export { isLinkActionType } from './templates/neutral';

export type SendAuthMailInput = {
  payload: SendEmailHookPayload;
  webhookId: string;
  /** The request's child logger, so `mail.*` lines carry `requestId`. */
  logger?: Logger;
  /**
   * 09.2-11 (DBT-14): the project whose own hook route delivered the call. The tenant the mail would be
   * branded for must belong to it, else `MailRefusedError('wrong_project')` and nothing is sent. Absent on
   * the legacy route, which serves project 0 exactly as before.
   */
  project?: Pick<ProjectRecord, 'id'>;
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
    actionType,
    ...(input.project ? { projectId: input.project.id } : {}),
  });
  if (resolution.kind === 'refused') throw new MailRefusedError(resolution.reason);
  if (
    input.project &&
    resolution.kind === 'tenant' &&
    !(await tenantBelongsToProject(resolution.tenantId, input.project.id))
  ) {
    // A brand drawn from another project's tenant (a hostless row 6a/8 pick): nothing is rendered.
    throw new MailRefusedError('wrong_project');
  }

  const brand = toMailBrand(resolution, redirectHost);
  const tenantId = resolution.kind === 'tenant' ? resolution.tenantId : null;
  const rehomed = rehomedSignupRedirect(resolution, actionType);
  if (rehomed !== null && resolution.kind === 'tenant') {
    // Only these four facts (T-02-25): never the token, the token hash, the link or the address.
    log.info(
      { event: 'mail.link_rehomed', actionType, tenantId, host: resolution.primaryHost },
      'signup link re-homed onto the tenant primary host',
    );
  }
  const emailData =
    rehomed !== null ? { ...payload.email_data, redirect_to: rehomed } : payload.email_data;
  const rendered = render(brand, emailData);

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
