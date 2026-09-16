import { Webhook } from 'standardwebhooks';
import { z } from 'zod';

/**
 * GoTrue Send Email Hook contract (RESEARCH Pattern 6): payload shape, Standard Webhooks signature
 * verification with secret rotation, and the action-link builder shared with `/auth/confirm`.
 *
 * Environment-free on purpose (zod + standardwebhooks only): the API route passes the parsed secret
 * list in, so this module is unit-testable without the kernel env placeholders.
 */

export const sendEmailHookPayloadSchema = z
  .object({
    user: z.object({ id: z.uuid(), email: z.string().nullish() }).loose(),
    email_data: z
      .object({
        token: z.string().default(''),
        token_hash: z.string().default(''),
        redirect_to: z.string().default(''),
        email_action_type: z.string().min(1),
        site_url: z.string().default(''),
        token_new: z.string().default(''),
        token_hash_new: z.string().default(''),
      })
      .loose(),
  })
  .loose();

export type SendEmailHookPayload = z.infer<typeof sendEmailHookPayloadSchema>;
export type HookEmailData = SendEmailHookPayload['email_data'];

export const HOOK_HEADER_NAMES = ['webhook-id', 'webhook-timestamp', 'webhook-signature'] as const;
export type HookHeaderName = (typeof HOOK_HEADER_NAMES)[number];

/** The signature did not verify against any configured secret (or none is configured) → 401. */
export class HookSignatureError extends Error {
  constructor(message = 'invalid signature') {
    super(message);
    this.name = 'HookSignatureError';
  }
}

/** A verified body that is not a usable hook payload → 500 with the reason as message. */
export class HookPayloadError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'HookPayloadError';
    this.reason = reason;
  }
}

/**
 * `SEND_EMAIL_HOOK_SECRETS` → the base64 secret list. Accepts both spellings of a rotation:
 * `v1,whsec_<a>|v1,whsec_<b>` (the form the Supabase CLI validates) and `v1,whsec_<a>|<b>` (the
 * hook docs). Every segment loses a leading `v1,` and then a leading `whsec_`; empty segments are
 * dropped, so an unset variable yields `[]` and the route fails closed.
 */
export function parseHookSecrets(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((segment) => {
      let value = segment.trim();
      if (value.startsWith('v1,')) value = value.slice(3);
      if (value.startsWith('whsec_')) value = value.slice(6);
      return value;
    })
    .filter((value) => value.length > 0);
}

/**
 * Verifies the Standard Webhooks signature of `rawBody` against EVERY secret (rotation) and only
 * then parses the payload. Fails closed: no secrets or a missing header is a signature error, never
 * a pass. `standardwebhooks` enforces the 5-minute timestamp tolerance and a timing-safe compare.
 */
export function verifyHookRequest(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secrets: string[],
): SendEmailHookPayload {
  if (secrets.length === 0) throw new HookSignatureError('no hook secret configured');
  const present: Record<string, string> = {};
  for (const name of HOOK_HEADER_NAMES) {
    const value = headers[name];
    if (!value) throw new HookSignatureError(`missing ${name} header`);
    present[name] = value;
  }

  let verified = false;
  for (const secret of secrets) {
    try {
      new Webhook(secret).verify(rawBody, present, { jsonParse: false });
      verified = true;
      break;
    } catch {
      // try the next secret
    }
  }
  if (!verified) throw new HookSignatureError();

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new HookPayloadError('invalid_payload');
  }
  const parsed = sendEmailHookPayloadSchema.safeParse(json);
  if (!parsed.success) throw new HookPayloadError('invalid_payload');
  return parsed.data;
}

/**
 * The link the CTA carries: `redirect_to` (GoTrue already allow-listed it) plus `token_hash` and
 * `type` — exactly what `apps/web/app/auth/confirm/route.ts` reads and what the SMTP fallback
 * template `supabase/templates/recovery.html` appends. `redirect_to` is validated with `new URL`
 * but kept VERBATIM (its own `next=/…` query stays as GoTrue received it; `URLSearchParams` would
 * re-encode it), and the hook never invents a host (T-02-26).
 */
export function buildActionLink(redirectTo: string, tokenHash: string, actionType: string): string {
  try {
    new URL(redirectTo);
  } catch {
    throw new HookPayloadError('invalid_redirect_to');
  }
  const base = redirectTo.split('#')[0] ?? redirectTo;
  const separator = base.endsWith('?') || base.endsWith('&') ? '' : base.includes('?') ? '&' : '?';
  const params = `token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(actionType)}`;
  return `${base}${separator}${params}`;
}
