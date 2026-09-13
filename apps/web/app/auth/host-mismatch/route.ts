import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Where the `(app)` layout sends a session that reached ANOTHER tenant's host (403
 * `TENANT_HOST_MISMATCH`, TENANT-01/D-23).
 *
 * Deliberately takes no input and passes no query parameter along: neither the tenant the session
 * belongs to nor the tenant the host serves may appear anywhere the person (or their browser history,
 * or a referrer) can read. The API's 403 carries no `details` for the same reason.
 */
export async function GET(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });

  redirect('/endereco-invalido');
}
