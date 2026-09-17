import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Where `requireBootstrap()` sends a member whose API answer was 403 `TENANT_SUSPENDED` (D-32): the
 * whole community is unavailable, so the device is signed out exactly like a blocked member (D-09,
 * `scope: 'local'`) and lands on the branded public screen. Only a Route Handler may clear the
 * session cookies — the `(app)` layout is a Server Component.
 *
 * Takes no input and forwards none: the brand comes from the host, the copy names no tenant.
 */
export async function GET(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });

  redirect('/comunidade-indisponivel');
}
