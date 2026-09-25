import type { HighlightList } from '@tria/module-stories/contracts';
import { STORY_PERMISSIONS } from '@tria/module-stories/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { type ComposerSelection, StoryComposer } from '@/app/(app)/stories/publicar/StoryComposer';
import { requireBootstrap } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import { getHighlightCatalog } from '@/lib/stories';
import { type HighlightPlaceView, highlightPlacesView } from '@/lib/story-view';
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
 * **Choosing a highlight takes `publish` AND `manage`** (05.2, D-111, UI-D-69): the API refuses a
 * publish that names any destination without `stories.story.manage` (T-05.2-32). So only a viewer
 * holding BOTH gets the place groups — and with them the "Destaque" row and the `?comunidade=`
 * pre-fill. Anyone else sees the plain composer: no places renders no row, and the parameter is
 * ignored.
 *
 * **The single-select sheet is server-rendered with the page** (UI E10 loading): the ACTIVE
 * communities and the highlight catalogue are read here, in parallel, and composed by
 * `highlightPlacesView(…, { includeEmptyPlaces: true })` — Início first, then every active community,
 * including the ones with no highlight yet (each ends with its own "Novo destaque"). The sheet never
 * opens in a loading state.
 *
 * **D-112 / D-93 — `?comunidade={id}` is read HERE, on the server**, against the tenant's own ACTIVE
 * list, before the composer paints. An id that is unknown, another tenant's or archived does not
 * match and silently falls back to "Nenhum" (T-05.1-30); a repeated parameter uses its FIRST value.
 * A resolved origin arrives pre-filled with that community's FIRST highlight in row order, or — when
 * it has none — in the `choose` state, whose gate will not let the admin publish into "Nenhum"
 * without seeing the choice. The API re-validates the destination inside its transaction regardless,
 * which is what makes this a UX resolution rather than the security boundary.
 *
 * **A failed catalogue read degrades SAFE.** The places are then every community with no highlight
 * rows, so an origin reads "Escolher destaque" (the gate) rather than "Nenhum" — losing the catalogue
 * can cost the admin a tap, never a silent tenant-wide publish from a community.
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

  const canCurate =
    bootstrap.permissions.includes(STORY_PERMISSIONS.publish) &&
    bootstrap.permissions.includes(STORY_PERMISSIONS.manage);

  if (!canCurate) return <StoryComposer historyHref="/stories/meus" />;

  const [params, listed, catalog, t] = await Promise.all([
    searchParams,
    listAllCommunities(),
    readCatalog(),
    getTranslations('stories'),
  ]);
  // The list read is the ACTIVE one; the filter is belt and braces, exactly as `/stories/meus`
  // does it, so an archived community can never become a pickable destination.
  const communities = listed.filter((community) => community.status === 'active');

  // A repeated `?comunidade=` arrives as an array; the FIRST value wins rather than the request
  // failing — the `/criar` rule, verbatim.
  const requested = Array.isArray(params.comunidade) ? params.comunidade[0] : params.comunidade;
  const originCommunityId = communities.some((item) => item.id === requested)
    ? (requested ?? null)
    : null;

  const places: HighlightPlaceView[] = highlightPlacesView(catalog, communities, {
    homeLabel: t('highlights.place.home'),
    includeEmptyPlaces: true,
  });

  return (
    <StoryComposer
      historyHref="/stories/meus"
      places={places}
      originCommunityId={originCommunityId}
      initialSelection={initialSelectionFor(places, originCommunityId)}
    />
  );
}

/**
 * D-112: no origin → "Nenhum" (the zero-tap default, 05.1 criterion 5); an origin with highlights →
 * its FIRST highlight in row order; an origin with none → `choose`, the gate.
 */
function initialSelectionFor(
  places: readonly HighlightPlaceView[],
  originCommunityId: string | null,
): ComposerSelection {
  if (originCommunityId === null) return { kind: 'none' };
  const first = places.find((place) => place.communityId === originCommunityId)?.rows[0];
  return first ? { kind: 'highlight', highlightId: first.id } : { kind: 'choose' };
}

/** The catalogue, or `[]` when it cannot be read (the safe degradation above). Never navigates. */
async function readCatalog(): Promise<HighlightList['items']> {
  try {
    return (await getHighlightCatalog()).items;
  } catch (error) {
    // Shape only: a highlight TITLE is tenant content and never reaches a log line (T-05-29).
    console.error('stories.publish_catalog_failed', { error: String(error) });
    return [];
  }
}
