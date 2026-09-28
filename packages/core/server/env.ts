import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Kernel environment. `DATABASE_URL` must be the `api_user` connection (never `postgres`/service role).
 *
 * Every adapter is selected here — Phase 2's domain provider, auth allow-list and mail transport,
 * plus Phase 3's video provider. Every selector defaults to its LOCAL implementation
 * (`fake` / `local`) so a clean machine or a misconfigured deploy never talks to Vercel, Resend, the
 * Supabase Management API or Mux by accident; `assertProductionEnv()` refuses a real selection that
 * is missing its credentials (T-02-10, T-03-43).
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_KEY: z.string().min(1),
    /** Read once by `server/logging.ts`; every logger in the codebase is a child of that root. */
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    /**
     * The one place the kernel asks "is this production?". Today only the video adapter reads it,
     * to create throwaway `test` assets everywhere else (RESEARCH Pitfall 7). It is NOT a second
     * adapter selector: which implementation runs is always an explicit `*_PROVIDER` value, so a
     * missing NODE_ENV can never silently switch a vendor on.
     */
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /**
     * The platform domain (D-21) — where the platform's `super_admin` works. The API reads it so the
     * custom-domain attach refuses it (D-34: a tenant host is never the platform host). Unset in
     * Preview/local means "every unregistered host is generic" (01-02).
     */
    PLATFORM_HOST: z.string().min(1).optional(),

    /** Custom-domain provider (RESEARCH Pattern 5). `fake` answers fixed DNS records and verifies on first check. */
    DOMAIN_PROVIDER: z.enum(['fake', 'vercel']).default('fake'),
    VERCEL_TOKEN: z.string().min(1).optional(),
    VERCEL_PROJECT_ID: z.string().min(1).optional(),
    VERCEL_TEAM_ID: z.string().min(1).optional(),

    /** Supabase Auth redirect allow-list writer. `local` is a no-op (config.toml already allows *.localhost). */
    AUTH_ALLOW_LIST: z.enum(['local', 'supabase']).default('local'),
    SUPABASE_PAT: z.string().min(1).optional(),
    SUPABASE_PROJECT_REF: z.string().min(1).optional(),

    /**
     * Video provider (MEDIA-03, D-43). `fake` mints a Storage signed upload URL into the private
     * `media` bucket and simulates transcoding with a deferred synthetic ready event, so no e2e or
     * CI run can ingest into a real Mux account (RESEARCH Pitfall 7).
     */
    VIDEO_PROVIDER: z.enum(['fake', 'mux']).default('fake'),
    MUX_TOKEN_ID: z.string().min(1).optional(),
    MUX_TOKEN_SECRET: z.string().min(1).optional(),
    /** D-44: signed playback. The key pair mints a short-lived playback JWT per request. */
    MUX_SIGNING_KEY_ID: z.string().min(1).optional(),
    /** base64-encoded PEM private key, mounted from GCP Secret Manager. Never in git. */
    MUX_SIGNING_KEY_PRIVATE: z.string().min(1).optional(),
    /** Mux webhook signing secret — the ONLY authentication of `POST /v1/webhooks/mux` (R-03). */
    MUX_WEBHOOK_SECRET: z.string().min(1).optional(),
    /**
     * Local-stack secret the FAKE provider's `verifyWebhook` HMACs against, so the fake exercises the
     * same code-path SHAPE the real one does instead of being a no-op. Defaulted in `fake.ts`.
     */
    FAKE_VIDEO_WEBHOOK_SECRET: z.string().min(1).optional(),

    /** Send Email Hook transport (RESEARCH Pattern 6). `local` posts to Mailpit's HTTP API. */
    MAIL_TRANSPORT: z.enum(['local', 'resend']).default('local'),
    RESEND_API_KEY: z.string().min(1).optional(),
    /** Sender domain: `From: "{displayName} <no-reply@{MAIL_DOMAIN}>"` (D-38). */
    MAIL_DOMAIN: z.string().min(1).default('mail.rede-social.localhost'),
    MAILPIT_URL: z.url().default('http://127.0.0.1:54324'),
    /** Standard Webhooks secret(s) for the Send Email Hook, `v1,whsec_<b64>[|<b64>]`; unset = hook route refuses every call. */
    SEND_EMAIL_HOOK_SECRETS: z.string().min(1).optional(),

    /**
     * How the web app is reached from a browser. The ONLY place a public web origin is composed
     * (D-22 forbids a SITE_URL): `publicWebOrigin(host)` = `${scheme}://${host}[:${port}]`.
     */
    PUBLIC_WEB_SCHEME: z.enum(['http', 'https']).default('https'),
    PUBLIC_WEB_PORT: z.coerce.number().int().positive().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

type KernelEnv = typeof env;

/**
 * Refuses a real adapter selection without its credentials. Runs at import time (below) so a deploy
 * that sets `DOMAIN_PROVIDER=vercel` and forgets the token fails on boot, not on the first attach.
 * Exported so tests and tooling can assert the rule against an arbitrary env object.
 */
export function assertProductionEnv(
  e: Pick<
    KernelEnv,
    | 'DOMAIN_PROVIDER'
    | 'VERCEL_TOKEN'
    | 'VERCEL_PROJECT_ID'
    | 'VERCEL_TEAM_ID'
    | 'AUTH_ALLOW_LIST'
    | 'SUPABASE_PAT'
    | 'SUPABASE_PROJECT_REF'
    | 'MAIL_TRANSPORT'
    | 'RESEND_API_KEY'
    | 'VIDEO_PROVIDER'
    | 'MUX_TOKEN_ID'
    | 'MUX_TOKEN_SECRET'
    | 'MUX_SIGNING_KEY_ID'
    | 'MUX_SIGNING_KEY_PRIVATE'
    | 'MUX_WEBHOOK_SECRET'
  > = env,
): void {
  const missing: string[] = [];
  if (e.DOMAIN_PROVIDER === 'vercel') {
    for (const key of ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID'] as const) {
      if (!e[key]) missing.push(`${key} (required when DOMAIN_PROVIDER=vercel)`);
    }
  }
  if (e.AUTH_ALLOW_LIST === 'supabase') {
    for (const key of ['SUPABASE_PAT', 'SUPABASE_PROJECT_REF'] as const) {
      if (!e[key]) missing.push(`${key} (required when AUTH_ALLOW_LIST=supabase)`);
    }
  }
  if (e.MAIL_TRANSPORT === 'resend' && !e.RESEND_API_KEY) {
    missing.push('RESEND_API_KEY (required when MAIL_TRANSPORT=resend)');
  }
  // MEDIA-03: all five, or none. A partially configured Mux selection would boot, hand out upload
  // URLs and then fail to verify a single webhook — every asset stuck in `pending` forever.
  if (e.VIDEO_PROVIDER === 'mux') {
    for (const key of [
      'MUX_TOKEN_ID',
      'MUX_TOKEN_SECRET',
      'MUX_SIGNING_KEY_ID',
      'MUX_SIGNING_KEY_PRIVATE',
      'MUX_WEBHOOK_SECRET',
    ] as const) {
      if (!e[key]) missing.push(`${key} (required when VIDEO_PROVIDER=mux)`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Invalid kernel environment:\n  - ${missing.join('\n  - ')}`);
  }
}

assertProductionEnv(env);

/**
 * Public origin of the web app for a given host — e-mail links, invite `redirectTo`, allow-list
 * entries. Locally `http://rede-demo.localhost:3000`, hosted `https://comunidade.cliente.com.br`.
 */
export function publicWebOrigin(host: string): string {
  const port = env.PUBLIC_WEB_PORT ? `:${env.PUBLIC_WEB_PORT}` : '';
  return `${env.PUBLIC_WEB_SCHEME}://${host}${port}`;
}
