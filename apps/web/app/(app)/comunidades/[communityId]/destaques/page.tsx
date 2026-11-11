import { PageHeader } from '@rede-social/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { HighlightManager } from '@/components/stories/HighlightManager';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadCommunity } from '@/lib/communities';
import { loadCuratorHighlights } from '@/lib/stories';
import { highlightManageRowView } from '@/lib/story-view';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/comunidades/[communityId]/destaques` (D-109, UI-D-72, UI-D-80, HIGHLIGHT-01) — one community's
 * highlight manage screen, opened by the trailing "Gerenciar" circle of that community's row.
 *
 * **Every miss is the community page's ONE not-found screen** (`../not-found.tsx`): an unknown id,
 * another tenant's, a removed community, the `communities` module off, AND a caller the API does not let
 * curate (`viewer.canCurate`, 10-14: the creator of a member community, `stories.story.manage` on an
 * organization one; UI-D-72, T-05.2-39 — never a disabled page). The API refuses all of them
 * independently; the screen simply never offers controls that would fail.
 *
 * **An ARCHIVED community still renders, reduced** (UI-D-80, R-D-F): its note under the header, no
 * "Novo destaque", no drag handles, and rows that open the reduced edit sheet where only "remove a
 * story" and "delete the highlight" remain — the take-downs the API still allows. Its row shows no
 * "Gerenciar" circle (UI-D-64), so this screen is reached only by direct link.
 *
 * `?editar={id}` is honoured only for a highlight in THIS community's server-read list (T-05.2-41).
 * It reads the session and the host per request, so it stays dynamic (REQUIRED_KEYS).
 */
export default async function CommunityHighlightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ communityId: string }>;
  searchParams: Promise<{ editar?: string | string[] }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const { communityId } = await params;
  // `requireBootstrap` runs for its session and host guards; the decision is the community's own flags.
  const [, result] = await Promise.all([requireBootstrap(), loadCommunity(communityId)]);
  // Not ok covers unknown, foreign, removed, the communities module off, a blocked or departed creator
  // (the API's bare 404, UI-D-717) — and a read failure, which must not render a manage screen for a
  // community nobody could verify.
  if (result.status !== 'ok') notFound();
  const community = result.community;
  // 10-14 (UI-D-713, UI-D-716): the API's `viewer.canCurate` is the guard — `stories.story.manage` on an
  // organization community, the creator on a member one (while `social` is on) — never a role or an id
  // comparison here. Any other caller gets the not-found screen, never a disabled page.
  if (!community.viewer.canCurate) notFound();

  const [query, row, ts] = await Promise.all([
    searchParams,
    loadCuratorHighlights({ communityId: community.id }),
    getTranslations('stories'),
  ]);
  if (row.status === 'redirect') redirect(row.path);
  if (row.status === 'not-found') notFound();
  if (row.status === 'error') throw new Error('stories.curator_highlights_unavailable');

  const archived = community.status !== 'active';
  const items = row.list.items.map((summary) => highlightManageRowView(summary, ts));
  const wanted = z.uuid().safeParse(query.editar);
  const editTarget =
    wanted.success && items.some((item) => item.id === wanted.data) ? wanted.data : null;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <PageHeader
        title={ts('highlights.manage.titleCommunity', { community: community.name })}
        backHref={`/comunidades/${community.id}`}
        backLabel={ts('highlights.manage.back')}
        className="md:static md:px-0"
      />
      {archived ? (
        <p className="px-4 pt-2 text-sm font-normal text-text-secondary">
          {ts('highlights.manage.archivedNote')}
        </p>
      ) : null}
      <HighlightManager
        place={{ communityId: community.id }}
        placeLabel={community.name}
        initialItems={items}
        archived={archived}
        editTarget={editTarget}
        publishHref={`/stories/publicar?comunidade=${community.id}`}
      />
    </div>
  );
}
