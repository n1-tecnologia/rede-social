import type { ConfigBody } from './types';

/**
 * The Auth configuration of a tenant project (09.2-13, D-542, RESEARCH Question 14): ONE `PATCH
 * /config/auth` body, so a project restarts its Auth service once and the platform spends one request of its
 * rate-limit window. The values mirror `supabase/config.toml` (`[auth]`, `[remotes.production.auth.*]`)
 * for project 0; `project-auth-config.test.ts` reads the TOML and pins every key the two share, so the
 * template (tenant projects) and the TOML (project 0) cannot diverge silently.
 *
 * Pure: no env, no I/O. The caller (the `auth` step) supplies the origin, the hook coordinates and the SMTP
 * password; the body it gets back is sent as is and never logged or stored (it holds the SMTP password and
 * the hook secret).
 */

/** The project-wide Storage file size limit: 50 MiB, the same ceiling `config.toml` sets and the Free plan allows. */
export const STORAGE_FILE_SIZE_LIMIT_BYTES = 52_428_800;

/** Resend over implicit TLS (`[remotes.production.auth.email.smtp]`). `smtp_port` is a STRING in the spec. */
export const SMTP = {
  host: 'smtp.resend.com',
  port: '465',
  user: 'resend',
  senderName: 'Rede Social',
} as const;

/** The two access hooks ship DISABLED (Open Question 2): enabling them is a deliberate per-tenant rollout step. */
export const ACCESS_HOOK_URIS = {
  beforeUserCreated: 'pg-functions://postgres/public/hook_before_user_created_allowlist',
  customAccessToken: 'pg-functions://postgres/public/hook_custom_access_token_allowlist',
} as const;

export type AuthConfigInput = {
  /** The platform's public origin, e.g. `https://app.exemplo.com.br`. No comma (the spec's `^[^,]+$`). */
  siteUrl: string;
  /** The API's public origin (`API_PUBLIC_URL`), the base of the Send Email Hook. */
  apiPublicUrl: string;
  /** The project's 22-character `hook_ref`, the last segment of the hook URI. */
  hookRef: string;
  /** The project's own Standard-Webhooks secret, `v1,whsec_<base64>`. */
  hookSecret: string;
  /** `PROJECT_AUTH_SMTP_PASS`: the Resend API key used as the SMTP password. */
  smtpPass: string;
  /** `MAIL_DOMAIN`: the sender is `no-reply@<mailDomain>`, the address the hook already sends from. */
  mailDomain: string;
  /**
   * The project's current `uri_allow_list`. When it already holds entries the body OMITS the key: the redirect
   * allow-list is maintained at runtime (plan 11) and this PATCH must never overwrite it.
   */
  existingAllowList?: string | null | undefined;
};

const refuse = (what: string) => new TypeError(`auth config: ${what}`);

export function buildAuthConfigBody(input: AuthConfigInput): ConfigBody {
  const siteUrl = input.siteUrl.replace(/\/+$/, '');
  if (siteUrl.length === 0 || siteUrl.includes(',')) throw refuse('site url');
  const apiPublicUrl = input.apiPublicUrl.replace(/\/+$/, '');
  if (apiPublicUrl.length === 0) throw refuse('api origin');
  if (!/^[A-Za-z0-9_-]{22}$/.test(input.hookRef)) throw refuse('hook ref');
  if (!/^v1,whsec_\S{32,}$/.test(input.hookSecret)) throw refuse('hook secret');
  if (input.smtpPass.length === 0) throw refuse('smtp password');
  if (input.mailDomain.length === 0) throw refuse('mail domain');

  const body: ConfigBody = {
    site_url: siteUrl,
    disable_signup: true,
    jwt_exp: 3600,
    mailer_otp_exp: 86_400,
    password_min_length: 8,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    smtp_host: SMTP.host,
    smtp_port: SMTP.port,
    smtp_user: SMTP.user,
    smtp_pass: input.smtpPass,
    smtp_admin_email: `no-reply@${input.mailDomain}`,
    smtp_sender_name: SMTP.senderName,
    rate_limit_email_sent: 100,
    hook_send_email_enabled: true,
    hook_send_email_uri: `${apiPublicUrl}/v1/hooks/auth/send-email/${input.hookRef}`,
    hook_send_email_secrets: input.hookSecret,
    hook_before_user_created_enabled: false,
    hook_before_user_created_uri: ACCESS_HOOK_URIS.beforeUserCreated,
    hook_custom_access_token_enabled: false,
    hook_custom_access_token_uri: ACCESS_HOOK_URIS.customAccessToken,
  };

  const existing = (input.existingAllowList ?? '').trim();
  if (existing.length === 0) body.uri_allow_list = `${siteUrl}/auth/confirm**`;
  return body;
}
