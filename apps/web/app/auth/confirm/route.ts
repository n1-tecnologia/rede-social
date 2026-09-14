import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Where a successful confirmation lands when `next` is absent or unsafe. */
const DEFAULT_NEXT = '/inicio';

/**
 * Open-redirect guard (T-05-01, phase-1 review WR-10). `next` is honoured ONLY as a same-origin
 * path. The check is done by the URL parser, not by a regex: `new URL(next, origin)` resolves
 * `next` exactly the way the browser will resolve the `Location` header, so every spelling of an
 * absolute or scheme-relative URL — `https://evil.example`, `//evil.example`, and the WHATWG
 * backslash form `/\evil.example` that a `^\/(?!\/)` regex let through — lands on a different
 * origin and falls back. What survives is re-emitted as `pathname + search` (never the raw input),
 * so the redirect can only ever be a path on this origin.
 */
function sameOriginPath(next: string, origin: string): string {
  if (!next.startsWith('/')) return DEFAULT_NEXT;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return DEFAULT_NEXT;
    return `${url.pathname}${url.search}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

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
  const safeNext = sameOriginPath(search.get('next') ?? '', request.nextUrl.origin);

  if (tokenHash && isOtpType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(safeNext);
  }

  // Missing params, unknown type, expired or already-used token: ask for a fresh link.
  redirect('/esqueci-senha?erro=link-invalido');
}
