'use server';

import { forgotSchema } from '@tria/contracts';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Origin of the request that is running this action (D-22). There is deliberately NO fallback of any
 * kind — no `SITE_URL`, no env var: on a tenant domain the recovery link must come back to THAT
 * domain, so the only honest source is the request itself.
 *
 * `x-forwarded-host` is read BEFORE `host` for the same reason `proxy.ts` does: when a Server Action
 * issues a redirect, Next re-requests the destination on the server's own origin and carries the
 * browser-facing host only in `x-forwarded-host`. Vercel and Cloud Run set both headers themselves.
 */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host')?.trim();
  if (!host) throw new Error('forgot: request carries no Host header');
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
  return `${proto}://${host}`;
}

/**
 * "Recuperar senha" (AUTH-03, D-10). The answer is CONSTANT: whether the address exists, is
 * malformed, or the mailer failed, the browser always lands on `?enviado=1` and reads
 * "Se existir uma conta com este e-mail, enviamos um link." — no account enumeration (T-05-02).
 * That is why this function has exactly ONE redirect target and never inspects the Supabase result.
 */
export async function forgot(formData: FormData): Promise<void> {
  const parsed = forgotSchema.safeParse({ email: formData.get('email') });

  if (parsed.success) {
    const origin = await requestOrigin();
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${origin}/auth/confirm?next=/redefinir-senha`,
    });
  }

  redirect('/esqueci-senha?enviado=1');
}
