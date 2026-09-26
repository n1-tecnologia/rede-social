import { STORY_PERMISSIONS } from '@tria/module-stories/contracts';
import { PageHeader } from '@tria/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { HighlightManager } from '@/components/stories/HighlightManager';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadCuratorHighlights } from '@/lib/stories';
import { highlightManageRowView } from '@/lib/story-view';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/stories/destaques` (D-109, UI-D-72, HIGHLIGHT-01) — Início's highlight manage screen: the ONE
 * curation door the trailing "Gerenciar" circle of the Início row opens. The admin creates, renames,
 * re-covers, reorders and deletes Início's highlights here, and adds stories to them.
 *
 * **A caller without `stories.story.manage` gets the NOT-FOUND screen, never a disabled page**
 * (UI-D-72, T-05.2-39) — the composed PERMISSION, never a role. The API refuses every read and write
 * this screen makes to anyone else independently; this gate is what keeps a member from seeing a
 * screen whose every control would fail.
 *
 * **A literal segment beside `/stories/[storyId]`** (Pitfall 7): the App Router resolves a static
 * segment before a dynamic one, so this path is this page and never the deep link to a story whose
 * id is "destaques". The e2e asserts it.
 *
 * **`?editar={id}` opens that highlight's edit sheet on arrival** (UI-D-63b — the dashed empty
 * circle's link), but ONLY when the id is a uuid of a highlight in THIS place's server-read list
 * (T-05.2-41): anything else is ignored, so a crafted id opens nothing and reveals nothing.
 *
 * It reads the session and the host per request, which keeps it dynamic (REQUIRED_KEYS in
 * `scripts/check-static-routes.sh`). The page is a thin server shell; `HighlightManager` is the island.
 */
export default async function HomeHighlightsPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string | string[] }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(STORY_PERMISSIONS.manage)) notFound();

  const [query, row, ts] = await Promise.all([
    searchParams,
    loadCuratorHighlights({}),
    getTranslations('stories'),
  ]);
  if (row.status === 'redirect') redirect(row.path);
  if (row.status === 'not-found') notFound();
  if (row.status === 'error') throw new Error('stories.curator_highlights_unavailable');

  const items = row.list.items.map((summary) => highlightManageRowView(summary, ts));
  const wanted = z.uuid().safeParse(query.editar);
  const editTarget =
    wanted.success && items.some((item) => item.id === wanted.data) ? wanted.data : null;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {/* `stickyTop="0px"`: the `/stories/meus` chrome (the 03-05 lesson). */}
      <PageHeader
        title={ts('highlights.manage.titleHome')}
        backHref="/inicio"
        backLabel={ts('highlights.manage.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <HighlightManager
        place={{ communityId: null }}
        placeLabel={ts('highlights.place.home')}
        initialItems={items}
        archived={false}
        editTarget={editTarget}
        publishHref="/stories/publicar"
      />
    </div>
  );
}
