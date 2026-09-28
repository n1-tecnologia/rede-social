'use server';

import { THEME_COOKIE } from '@rede-social/contracts/branding';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * "Sair" signs out THIS device only (AUTH-05, D-08): `scope: 'local'` revokes the current session's
 * refresh token and clears its cookies; phone and desktop sessions stay independent. A global
 * sign-out is a deliberate Phase 8 feature, never a side effect.
 *
 * When the sign-out itself rejects (network, GoTrue down) the member lands back on the settings
 * page with `?erro=sair`, which shows the generic error toast (UI consideration E05/error).
 * `redirect()` throws NEXT_REDIRECT, so it is called AFTER the try/catch (Next 16 rule).
 */
export async function logout(): Promise<void> {
  let failed = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } catch (error) {
    console.error('logout.failed', { error: String(error) });
    failed = true;
  }
  redirect(failed ? '/configuracoes?erro=sair' : '/entrar');
}

const themeSchema = z.enum(['light', 'dark']);

/**
 * Persists the per-device theme (D-41, RESEARCH Pattern 3) so the next SSR agrees with the client
 * toggle. Two-value allow-list (T-02-30/T-02-35): an invalid value writes nothing. Not HttpOnly on
 * purpose — the client toggle writes the same cookie before this action settles; no `Domain`, so it
 * is per origin (one tenant per origin). Never used for authorisation or tenant selection.
 */
export async function setTheme(theme: string): Promise<void> {
  const parsed = themeSchema.safeParse(theme);
  if (!parsed.success) return;
  (await cookies()).set(THEME_COOKIE, parsed.data, {
    path: '/',
    sameSite: 'lax',
    maxAge: 31536000,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
  });
}
