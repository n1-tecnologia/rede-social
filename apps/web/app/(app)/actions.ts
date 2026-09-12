'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * "Sair" signs out THIS device only (AUTH-05, D-08): `scope: 'local'` revokes the current session's
 * refresh token and clears its cookies; phone and desktop sessions stay independent. A global
 * sign-out is a deliberate Phase 8 feature, never a side effect.
 */
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/entrar');
}
