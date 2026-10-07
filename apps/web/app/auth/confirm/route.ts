import type { EmailOtpType } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { LINK_RETURN_COOKIE, linkReturnCookieOptions, linkReturnFor } from '@/lib/link-return';
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

/** The invite's landing path; a failed link aimed there is an invite, whatever its `type`. */
const ACCEPT_INVITE_PATH = '/aceitar-convite';

function isAcceptInvitePath(safeNext: string): boolean {
  return safeNext.split('?')[0] === ACCEPT_INVITE_PATH;
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
 * Also the landing point of the first-admin invite (ROLE-03, D-29, plans 02-05/02-06/02-10): the
 * branded invite mail links to `{tenant origin}/auth/confirm?next=/aceitar-convite&token_hash=…&type=invite`.
 * A failed invite exchange (missing, expired, already-consumed or superseded-by-a-resend token) lands
 * on `/convite-expirado`, never on the recovery form: the invited admin has no password to recover
 * yet. A link counts as an invite when its `type` is `invite` OR its `next` is `/aceitar-convite`
 * (the WR-04 resend fallback mails a `type=recovery` link to the same landing). The redirect carries
 * no query string — that screen names no tenant. Every other link keeps the Phase 1 fallback.
 *
 * `verifyOtp` exchanges the one-time hash for a session; because this is a Route Handler, the
 * `@supabase/ssr` client may write the HttpOnly session cookies here (a Server Component may not).
 * And of the sign-up confirmation mail (quick 261007-gbk): `…/auth/confirm?next=/inicio&token_hash=…&type=signup`.
 * A successful exchange signs the person in and lands on `next`; a failed one lands on
 * `/verifique-seu-email?erro=link-invalido`, where a fresh mail can be requested.
 *
 * With a session in place the redirect lands on `/redefinir-senha`, whose action can call `updateUser`.
 *
 * Link-return marker (quick 261007-kyp): a SUCCESSFUL exchange also writes `link_return`
 * (`signup | recovery | invite`, HttpOnly, SameSite=Lax, ten minutes, host-only, see
 * `lib/link-return.ts`). The browser that clicked the mail link is usually not the installed app, so
 * the root layout hands the marker to the install gate, which shows "E-mail confirmado, abra o app
 * pelo ícone" on a phone outside the app. Failed exchanges write nothing; the open-redirect guard,
 * the OTP type allow-list and every redirect target are unchanged.
 */
export async function GET(request: NextRequest): Promise<never> {
  const search = request.nextUrl.searchParams;
  const tokenHash = search.get('token_hash');
  const type = search.get('type');
  const safeNext = sameOriginPath(search.get('next') ?? '', request.nextUrl.origin);

  if (tokenHash && isOtpType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // The marker (quick 261007-kyp) is written BEFORE the redirect and outside any try/catch:
      // `redirect()` works by throwing. It changes nothing about where the member lands.
      const marker = linkReturnFor(type, safeNext);
      if (marker) (await cookies()).set(LINK_RETURN_COOKIE, marker, linkReturnCookieOptions);
      redirect(safeNext);
    }
  }

  // An invite link that no longer exchanges: the dedicated expired screen (D-29). That includes the
  // invite mail's recovery-type fallback (02-REVIEW IN-03, fixed in 08-08): its `next` is
  // `/aceitar-convite`, and an invited admin must never land on the password-recovery form.
  if (type === 'invite' || isAcceptInvitePath(safeNext)) redirect('/convite-expirado');

  // A sign-up confirmation link that no longer exchanges (expired, already used, superseded by a
  // resend): the verification screen, where a new mail can be asked for. Never the recovery form.
  if (type === 'signup') redirect('/verifique-seu-email?erro=link-invalido');

  // Missing params, unknown type, expired or already-used token: ask for a fresh link.
  redirect('/esqueci-senha?erro=link-invalido');
}
