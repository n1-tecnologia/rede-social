import { FEED_PERMISSIONS } from '@tria/module-feed/contracts';
import { redirect } from 'next/navigation';
import { ComposerForm } from '@/app/(app)/criar/ComposerForm';
import { requireBootstrap } from '@/lib/bootstrap';
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
 */
export default async function CreatePostPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(FEED_PERMISSIONS.create)) redirect('/inicio');

  return <ComposerForm mode="create" />;
}
