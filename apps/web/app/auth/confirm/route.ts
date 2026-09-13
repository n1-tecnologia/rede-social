import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Open-redirect guard (T-05-01). `next` is honoured ONLY as a same-origin relative path: it must start
 * with a single `/`. The negative lookahead rejects `//evil.example`, which browsers resolve as the
 * protocol-relative absolute URL `https://evil.example`. Everything else falls back to `/inicio`.
 */
const RELATIVE_PATH = /^\/(?!\/)/;

/** The OTP types this route accepts; anything else is treated as an invalid link. */
const OTP_TYPES: readonly EmailOtpType[] = ['recovery', 'email', 'signup', 'invite', 'magiclink'];

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Landing point of the recovery e-mail (AUTH-03, D-10). The template links to
 * `{origin}/auth/confirm?next=/redefinir-senha&token_hash=…&type=recovery`, where `origin` is the host
 * the member actually used (D-22).
 *
 * `verifyOtp` exchanges the one-time hash for a session; because this is a Route Handler, the
 * `@supabase/ssr` client may write the HttpOnly session cookies here (a Server Component may not).
 * With a session in place the redirect lands on `/redefinir-senha`, whose action can call `updateUser`.
 */
export async function GET(request: NextRequest): Promise<never> {
  const search = request.nextUrl.searchParams;
  const tokenHash = search.get('token_hash');
  const type = search.get('type');
  const next = search.get('next') ?? '';
  const safeNext = RELATIVE_PATH.test(next) ? next : '/inicio';

  if (tokenHash && isOtpType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(safeNext);
  }

  // Missing params, unknown type, expired or already-used token: ask for a fresh link.
  redirect('/esqueci-senha?erro=link-invalido');
}
