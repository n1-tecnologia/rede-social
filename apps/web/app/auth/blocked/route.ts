import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** The tenant display name is only ever echoed back as a label; 80 chars is plenty for a heading. */
const MAX_TENANT_LABEL = 80;

/**
 * Where the `(app)` layout sends a member whose API answer was 403 `MEMBERSHIP_BLOCKED` (AUTH-06, D-09).
 *
 * It is a Route Handler and not a server action because the session has to be CLEARED here: only a
 * route handler (or a server action) may write cookies, and the layout is a Server Component.
 * `scope: 'local'` revokes this device's refresh token — the block is per tenant membership, not a
 * platform-wide ban, so other devices are dealt with by the same 403 on their own next request.
 */
export async function GET(request: NextRequest): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });

  const tenant = (request.nextUrl.searchParams.get('t') ?? '').slice(0, MAX_TENANT_LABEL);
  redirect(`/acesso-suspenso?t=${encodeURIComponent(tenant)}`);
}
