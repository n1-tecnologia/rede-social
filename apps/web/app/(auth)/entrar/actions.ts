'use server';

import { loginSchema } from '@rede-social/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CONTINUE_COOKIE, safeContinuePath } from '@/lib/continue-path';
import { getHostBrand } from '@/lib/host-brand';
import { isEmailNotConfirmed, writePendingConfirmation } from '@/lib/pending-confirmation';
import { createClient } from '@/lib/supabase/server';

/**
 * E-mail + password login in the web tier (AUTH-02, D-07). `@supabase/ssr` writes the HttpOnly
 * session cookies; no token ever reaches the client. One generic error for every failure (T-02-05).
 *
 * An UNCONFIRMED account (quick 261007-gbk) with the right password goes to `/verifique-seu-email`
 * with the address in an HttpOnly cookie, where a new confirmation mail can be requested.
 *
 * D-32: on a SUSPENDED host the login is refused before any GoTrue call — the page already hides the
 * form, this is the server-side half. Otherwise the action does not look at the host: a member of
 * another tenant reaches `/inicio`, where the API answers 403 TENANT_HOST_MISMATCH and plan 01-05
 * renders the host-mismatch screen (D-23). `redirect()` is never called inside a try/catch.
 */
export async function login(formData: FormData): Promise<void> {
  const brand = await getHostBrand();
  if (brand.tenant?.status === 'suspended') redirect('/comunidade-indisponivel');

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) redirect('/entrar?erro=credenciais');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // GoTrue verifies the PASSWORD first, so "e-mail not confirmed" is only ever answered to someone
    // who typed the right one (pinned by signup.test.ts case 11): no existence oracle (T-gbk-01).
    // Every other failure keeps the single generic message.
    if (isEmailNotConfirmed(error)) {
      await writePendingConfirmation({ email: parsed.data.email });
      redirect('/verifique-seu-email?erro=nao-confirmado');
    }
    redirect('/entrar?erro=credenciais');
  }

  // FEED-07: a shared `/post/{id}` link that bounced through here comes back. `safeContinuePath`
  // re-validates the cookie rather than trusting it — one leading slash, this origin, that one
  // route — so a forged value can never turn the login into an open redirect. The cookie is spent
  // either way, so a stale destination cannot resurface on the next login.
  const jar = await cookies();
  const target = safeContinuePath(jar.get(CONTINUE_COOKIE)?.value);
  if (jar.get(CONTINUE_COOKIE)) jar.delete(CONTINUE_COOKIE);

  redirect(target ?? '/inicio');
}
