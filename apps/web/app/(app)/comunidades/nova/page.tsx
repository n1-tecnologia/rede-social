import { COMMUNITY_PERMISSIONS } from '@rede-social/module-communities/contracts';
import { redirect } from 'next/navigation';
import { CommunityForm } from '@/app/(app)/comunidades/CommunityForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/comunidades/nova` (COMM-01, UI-D-38) — the create half of the shared community form.
 *
 * **Authorisation is the composed PERMISSION, never a role comparison** (T-05-03). The page reads
 * `communities.community.manage` off the bootstrap — the identical value `requirePermission`
 * evaluates on the API — so granting it to another role opens this screen with no web edit at all.
 * A caller without it goes back to `/comunidades` rather than being shown a form they could fill in
 * and then be refused on; the API refuses the write independently regardless, which is what makes
 * this a UX decision rather than the security boundary.
 *
 * **There is no public render path.** The route lives inside the `(app)` group, so `proxy.ts`
 * bounces a session-less visitor to `/entrar` before this file runs, and it reads the session and
 * the host headers at request time — which is what keeps it OUT of the static route list.
 * `redirect()` throws in Next 16, so it sits outside any catch.
 */
export default async function NewCommunityPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(COMMUNITY_PERMISSIONS.manage)) redirect('/comunidades');

  return <CommunityForm mode="create" tenantName={bootstrap.tenant.displayName} />;
}
