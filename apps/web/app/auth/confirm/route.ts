import { isAllowlistRejection } from '@rede-social/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { type NextRequest, NextResponse } from 'next/server';
import {
  continueHref,
  failureDestination,
  isCrossSiteSubmission,
  isOtpType,
  sameOriginPath,
} from '@/lib/auth-confirm';
import { LINK_RETURN_COOKIE, linkReturnCookieOptions, linkReturnFor } from '@/lib/link-return';
import { createClient } from '@/lib/supabase/server';

/**
 * Landing point of every mail link that carries a one-time token (AUTH-03, D-10): the recovery
 * mail `{origin}/auth/confirm?next=/redefinir-senha&token_hash=…&type=recovery` (`origin` is the
 * host the member actually used, D-22), the first-admin invite
 * `…?next=/aceitar-convite&token_hash=…&type=invite` (ROLE-03, D-29) and the sign-up confirmation
 * `…?next=/inicio&token_hash=…&type=signup` (quick 261007-gbk).
 *
 * Two steps, on purpose (quick 261117-kkx). Mail scanners (Microsoft SafeLinks, antivirus fetchers,
 * link previewers) GET every link in a message before the member does. When the GET exchanged the
 * token, the scanner burned it and the member's real click landed on "link inválido".
 * - GET is INERT: it creates no Supabase client, calls no `verifyOtp`, writes no cookie. It only
 *   hands a valid-shaped link to the interstitial `/auth/continuar` (one button in the tenant
 *   shell) with the same token, the type and a `next` that already went through the open-redirect
 *   guard, or sends a malformed link straight to its fallback.
 * - POST (the interstitial's native form) is the ONLY place `verifyOtp` runs. It writes the
 *   `link_return` marker and answers 303. It is a plain route handler, not a Server Action: the 303
 *   is a full document navigation, so the root layout re-reads the HttpOnly marker for the install
 *   gate exactly as the old GET + 307 did.
 *
 * Failure routing (unchanged): an allow-list refusal lands on `/entrar?erro=nao-liberado` and wins
 * over the others (GoTrue rolled the exchange back, so the token is not consumed); an invite (type
 * invite OR `next=/aceitar-convite`, 02-REVIEW IN-03) lands on `/convite-expirado`; a sign-up on
 * `/verifique-seu-email?erro=link-invalido`; anything else on `/esqueci-senha?erro=link-invalido`.
 *
 * Link-return marker (quick 261007-kyp): a SUCCESSFUL exchange writes `link_return`
 * (`signup | recovery | invite`, HttpOnly, SameSite=Lax, ten minutes, host-only, see
 * `lib/link-return.ts`); failed exchanges write nothing.
 *
 * The hidden form fields are client-controlled, so the OTP type allow-list and the open-redirect
 * guard run again on the POST input. A POST with positive evidence of a cross-site origin is
 * refused with 403 before Supabase is touched. Nothing here logs, and no error text carries the
 * token.
 */
export async function GET(request: NextRequest): Promise<never> {
  const search = request.nextUrl.searchParams;
  const tokenHash = search.get('token_hash');
  const type = search.get('type');
  const safeNext = sameOriginPath(search.get('next') ?? '', request.nextUrl.origin);

  // `redirect()` works by throwing: keep it outside any try/catch. 307 is right for a GET.
  if (tokenHash && isOtpType(type)) redirect(continueHref(tokenHash, type, safeNext));
  redirect(failureDestination(type, safeNext));
}

/** A relative-Location 303 (same shape `redirect()` emits; never cacheable, never carries the token). */
function see(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { location: path, 'cache-control': 'no-store' },
  });
}

function field(form: FormData | null, name: string): string | null {
  const value = form?.get(name);
  return typeof value === 'string' ? value : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hosts = [forwarded, request.headers.get('host'), request.nextUrl.host].filter(
    (host): host is string => Boolean(host),
  );
  if (isCrossSiteSubmission(request.headers, hosts)) {
    return new NextResponse(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  }

  const form = await request.formData().catch(() => null);
  const tokenHash = field(form, 'token_hash');
  const type = field(form, 'type');
  const safeNext = sameOriginPath(field(form, 'next') ?? '', request.nextUrl.origin);

  if (tokenHash && isOtpType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // The marker is written BEFORE the answer is built; it changes nothing about where the
      // member lands. Next merges the cookies written through `cookies()` into the response.
      const marker = linkReturnFor(type, safeNext);
      if (marker) (await cookies()).set(LINK_RETURN_COOKIE, marker, linkReturnCookieOptions);
      return see(safeNext);
    }
    // Quick 261018-owq: the `custom_access_token` hook refused the e-mail (not `liberado` on the
    // allowlist). GoTrue rolled the exchange back, so the one-time token is NOT consumed: the same
    // mail link works once the address is listed (proved by email-allowlist.test.ts case 7). This
    // branch wins over the /convite-expirado and link-invalido fallbacks, because the link itself
    // is fine.
    if (isAllowlistRejection(error)) return see('/entrar?erro=nao-liberado');
  }

  return see(failureDestination(type, safeNext));
}
