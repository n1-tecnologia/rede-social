import type { CommunityPickerRow } from '@tria/module-communities/ui';
import { STORY_PERMISSIONS } from '@tria/module-stories/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StoryComposer } from '@/app/(app)/stories/publicar/StoryComposer';
import { requireBootstrap } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/stories/publicar` (STORY-01, D-81, UI-D-39) — the full-screen publish route, and surface 3 of
 * the five the design prototype does not have.
 *
 * **Authorisation is the composed PERMISSION, never a role comparison** (T-05-25). The page reads
 * `stories.story.publish` off the bootstrap — the identical value `requirePermission` evaluates on
 * the API — so V2's member stories are a `tenant_modules['stories'].settings` flip with no web
 * change. A caller without it goes back to `/inicio` rather than being shown a form they could fill
 * in and then be refused on; the API refuses the write independently regardless, which is what makes
 * this a UX decision rather than the security boundary.
 *
 * **Attaching a community takes `publish` AND `manage`** (05.1-01, T-05.1-31): the API refuses a
 * publish that names a community without `stories.story.manage`. So only a viewer holding BOTH gets
 * the community list — and with it the "Publicar em" row (D-97) and the `?comunidade=` pre-fill.
 * Anyone else sees today's composer: an empty list renders no row (UI-D-56) and the parameter is
 * ignored.
 *
 * **D-93 — `?comunidade={id}` is read HERE, on the server, exactly as `/criar` reads it.** The
 * community page's `+` circle hands the composer its destination and this page resolves it against
 * the tenant's own ACTIVE list before the composer paints, so the row arrives already filled in: no
 * client fetch, no flash of "Nenhuma comunidade" being replaced. An id that is unknown, another
 * tenant's or archived does not match and silently falls back to none (T-05.1-30); a repeated
 * parameter uses its FIRST value. The API re-validates the destination inside its transaction
 * regardless, which is what makes this a UX resolution rather than the security boundary.
 *
 * The header's trailing "Seus stories" action points at `/stories/meus`.
 *
 * **There is no public render path.** The route lives inside the `(app)` group, so `proxy.ts`
 * bounces a session-less visitor to `/entrar` before this file runs, and it reads the session and
 * the host headers at request time — which is what keeps it OUT of the static route list
 * (`scripts/check-static-routes.sh`). `redirect()` throws in Next 16, so it sits outside any catch.
 */
export default async function PublishStoryPage({
  searchParams,
}: {
  searchParams: Promise<{ comunidade?: string | string[] }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(STORY_PERMISSIONS.publish)) redirect('/inicio');

  const canAttach =
    bootstrap.permissions.includes(STORY_PERMISSIONS.publish) &&
    bootstrap.permissions.includes(STORY_PERMISSIONS.manage);

  const [params, listed, tc] = await Promise.all([
    searchParams,
    canAttach ? listAllCommunities() : Promise.resolve([]),
    getTranslations('communities'),
  ]);
  // The list read is the ACTIVE one; the filter is belt and braces, exactly as `/stories/meus`
  // does it, so an archived community can never become a pickable destination.
  const communities = listed.filter((community) => community.status === 'active');

  // A repeated `?comunidade=` arrives as an array; the FIRST value wins rather than the request
  // failing — the `/criar` rule, verbatim.
  const requested = Array.isArray(params.comunidade) ? params.comunidade[0] : params.comunidade;
  const initialCommunityId = communities.some((item) => item.id === requested)
    ? (requested ?? null)
    : null;

  const rows: CommunityPickerRow[] = communities.map((community) => ({
    id: community.id,
    name: community.name,
    coverAssetId: community.coverAssetId,
    coverVariantWidths: community.coverVariantWidths,
    coverAlt: tc('picker.cover', { community: community.name }),
  }));

  return (
    <StoryComposer
      historyHref="/stories/meus"
      communities={rows}
      initialCommunityId={initialCommunityId}
    />
  );
}
