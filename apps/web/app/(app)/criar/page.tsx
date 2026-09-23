import { FEED_PERMISSIONS } from '@tria/module-feed/contracts';
import { redirect } from 'next/navigation';
import { ComposerForm } from '@/app/(app)/criar/ComposerForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/criar` (FEED-01, D-57) — the full-screen composer, and the first screen of this phase the
 * design prototype does not have.
 *
 * **Authorisation is the composed PERMISSION, never a role comparison** (FEED-08, R-P8). The page
 * reads `feed.post.create` off the bootstrap — the identical value `requirePermission` evaluates on
 * the API — so turning members into authors is
 * `update tenant_modules set settings = settings || '{"postingPolicy":"members"}'` and nothing
 * else. A caller without it goes back to `/inicio` rather than being shown an empty form they could
 * fill in and then be refused on; the API refuses the write independently regardless, which is what
 * makes this a UX decision rather than the security boundary.
 *
 * **There is no public render path.** The route lives inside the `(app)` group, so `proxy.ts`
 * bounces a session-less visitor to `/entrar` before this file runs, and it reads the session and
 * the host headers at request time — which is what keeps it OUT of the static route list
 * (`scripts/check-static-routes.sh`). `redirect()` throws in Next 16, so it sits outside any catch.
 *
 * **D-70 / D-72 — `?comunidade={id}` is read HERE, on the server.** The community FAB hands the
 * composer its destination as a query parameter and this page resolves it against the tenant's own
 * active list before the form ever paints, so the picker row arrives already filled in: no client
 * fetch, no flash of "Feed principal" being replaced. An id this member cannot see simply does not
 * match, and the form opens on the default — the API re-validates the destination on the write
 * regardless, which is what makes this a UX resolution rather than the security boundary.
 *
 * The `communities` module may be OFF for this tenant, in which case `listAllCommunities()` returns
 * `[]` and the picker offers exactly one row. There is no second branch for that: a tenant with no
 * communities and a tenant with the module disabled are the same screen (D-74).
 */
export default async function CreatePostPage({
  searchParams,
}: {
  searchParams: Promise<{ comunidade?: string | string[] }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(FEED_PERMISSIONS.create)) redirect('/inicio');

  const [params, communities] = await Promise.all([searchParams, listAllCommunities()]);
  // A repeated `?comunidade=` arrives as an array; the FIRST value wins rather than the request
  // failing, exactly as a hand-edited `?limit=` lands on a page rather than an error screen.
  const requested = Array.isArray(params.comunidade) ? params.comunidade[0] : params.comunidade;
  const initialCommunityId = communities.some((item) => item.id === requested)
    ? (requested ?? null)
    : null;

  return (
    <ComposerForm
      mode="create"
      tenantName={bootstrap.tenant.displayName}
      destinations={communities.map((item) => ({
        id: item.id,
        name: item.name,
        coverAssetId: item.coverAssetId,
        coverVariantWidths: item.coverVariantWidths,
      }))}
      initialCommunityId={initialCommunityId}
    />
  );
}
