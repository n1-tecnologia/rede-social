import { STORY_PERMISSIONS } from '@tria/module-stories/contracts';
import { PageHeader } from '@tria/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import { loadOwnStories } from '@/lib/stories';
import { storyHistoryView } from '@/lib/story-view';
import { getHostTenant } from '@/lib/tenant-host';
import { StoryHistoryList } from './StoryHistoryList';

/**
 * `/stories/meus` (D-84, UI-D-40, UI-D-41) — the admin's own story history, and surface 5 of the
 * five the design prototype does not have. It is also the ONE screen in Phase 5 with no prototype
 * at all, which is why it went through `/gsd-sketch` before it was coded.
 *
 * **It is three things in one place, deliberately.** It is where every story the tenant ever
 * published lives with its counts; it is where PINNING happens (STORY-04); and it is where a story
 * is deleted. Scattering those across the viewer and the publish screen would have put a
 * destructive action inside a full-screen layer with no chrome, and would have left the pin flow
 * with no home at all.
 *
 * **Authorisation is the composed PERMISSION, never a role comparison** (T-05-48). The page reads
 * `stories.story.manage` off the bootstrap — the identical value `requirePermission` evaluates on
 * the API — so V2's member stories are a settings flip with no web change. A caller without it goes
 * back to `/inicio` rather than being shown a list they would then be refused; the API refuses every
 * route independently regardless, which is what makes this a UX decision rather than the boundary.
 *
 * **The communities are read HERE rather than inside the sheet** (UI partial/E09). The pin sheet
 * lists the ACTIVE communities from this page's own read, so opening it costs no round trip; a
 * community archived between this render and a toggle makes the WRITE fail server-side, the switch
 * reverts and the row stays — which is a better answer than a row that vanishes mid-gesture.
 *
 * **There is no public render path.** The route lives inside the `(app)` group, so `proxy.ts`
 * bounces a session-less visitor to `/entrar` before this file runs, and it reads the session and
 * the host headers at request time — which is what keeps it OUT of the static route list
 * (`scripts/check-static-routes.sh`). `redirect()` throws in Next 16, so it sits outside any catch.
 */
export default async function StoryHistoryPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(STORY_PERMISSIONS.manage)) redirect('/inicio');

  const [ts, tm, page, communities] = await Promise.all([
    getTranslations('stories'),
    // Phase 3's media vocabulary, read from its own namespace: the pill and the refusal note are
    // the media screens' words, and duplicating them into `stories.json` would be drift.
    getTranslations('media'),
    loadOwnStories(),
    listAllCommunities(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {/* `stickyTop="0px"` pins the header at the TOP of the scroll container's padding box, which
          is where it already sits in normal flow — the 03-05 lesson, restated for every
          `PageHeader` in this phase. */}
      <PageHeader
        title={ts('history.title')}
        backHref="/inicio"
        backLabel={ts('history.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />

      <StoryHistoryList
        initialItems={(page?.items ?? []).map((story) => storyHistoryView(story, ts, tm))}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        communities={communities
          .filter((community) => community.status === 'active')
          .map((community) => ({
            id: community.id,
            name: community.name,
            coverAssetId: community.coverAssetId,
            coverVariantWidths: community.coverVariantWidths,
            coverAlt: ts('pin.cover', { community: community.name }),
          }))}
        createCommunityHref="/comunidades/nova"
        publishHref="/stories/publicar"
      />
    </div>
  );
}
