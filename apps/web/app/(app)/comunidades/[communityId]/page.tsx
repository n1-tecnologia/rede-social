import { COMMUNITY_PERMISSIONS } from '@tria/module-communities/contracts';
import { CommunityHeader } from '@tria/module-communities/ui';
import { FEED_CAPTION_TRUNCATE_AT, FEED_PERMISSIONS } from '@tria/module-feed/contracts';
import { EmptyState, SectionTitle, StatusPill } from '@tria/ui';
import { CircleAlert, Pencil } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import {
  loadMoreCommunityPostsAction,
  refreshCommunityPostsAction,
} from '@/app/(app)/comunidades/actions';
import {
  deletePostAction,
  likePostAction,
  unlikePostAction,
} from '@/app/(app)/inicio/feed-actions';
import { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import { StoriesSurface } from '@/components/stories/StoriesSurface';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadCommunity } from '@/lib/communities';
import { loadFeed } from '@/lib/feed';
import { postCardView } from '@/lib/feed-view';
import {
  feedCommentsProps,
  postCardLabels,
  postMenuLabels,
  storyCommentsProps,
} from '@/lib/registry';
import { relativeFrom } from '@/lib/relative-time';
import { loadCommunityHighlights } from '@/lib/stories';
import { storyViewerItem, storyViewerLabels } from '@/lib/story-view';
import { getHostTenant, primaryHostOrigin } from '@/lib/tenant-host';
import { CommunityPosts } from './CommunityPosts';
import { ReactivateCommunity } from './ReactivateCommunity';

/**
 * `/comunidades/[communityId]` (COMM-03, UI-D-43, UI-D-37) — the screen a member lands on when they
 * tap a community card, and the destination every D-71 label in the main feed points at.
 *
 * Its shape is `/post/[postId]`'s, three files and all, because that route already solves every
 * problem this one has: the async `params`, the platform-host redirect, the `Promise.all` of
 * translations plus loads, and the split between "this community is not reachable" and "we could
 * not reach the server".
 *
 * **ID-based, with the slug stored beside it** (D-56's precedent). The URL segment is the uuid, so a
 * rename never breaks a shared link and a `/{slug}` redirect stays trivially addable later.
 *
 * **Every miss is ONE screen** (D-23 / UI-D-16). An unknown id, another tenant's community and a
 * soft-deleted one all arrive here as `loadCommunity`'s single `not-found`, because the API answers
 * one indistinguishable bare 404 for all three and a 400 for an id that is not a uuid. `notFound()`
 * then renders `not-found.tsx`, which says nothing about which it was. A transport or 5xx failure is
 * a DIFFERENT screen below.
 *
 * **An ARCHIVED community still opens, read-only** (UI-D-37, 05-RESEARCH §Pattern 7). Archive is a
 * WRITE gate and a LIST gate, never a feed gate: the page renders normally with the neutral
 * "Arquivada" pill beside the name and its inline note under the description, and the compose entry
 * is ABSENT rather than disabled — the project-wide rule for a control the viewer may not use. A 404
 * here would break both a shared link and every post of that community already in the feed, which is
 * exactly what archiving must not do.
 *
 * **The compose entry is the shipped `ComposeFab`, unchanged** (D-70, UI-D-44), rendered by
 * `FeedList` from the `createHref` and `canPost` this page passes: mobile gets the floating control,
 * desktop gets a brand button in the header row above the list, and the FAB stands down while the
 * empty state's own CTA is the screen's single brand fill. `canPost` is the composed
 * `feed.post.create` permission AND `status === 'active'` — never a role comparison in the web tier.
 *
 * **There is no public render path.** The route lives inside the `(app)` group, so `proxy.ts`
 * bounces a session-less visitor to `/entrar` before this file runs, and the page reads the session
 * and the host headers at request time — which is what keeps it OUT of the static route list
 * (`scripts/check-static-routes.sh`).
 *
 * `redirect()` and `notFound()` both throw (Next 16), so both sit OUTSIDE any try/catch.
 */
export default async function CommunityPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const { communityId } = await params;
  const [tc, tf, ts, te, locale, bootstrap, shareOrigin, result] = await Promise.all([
    getTranslations('communities'),
    getTranslations('feed'),
    // D-68's circles are the stories module's component with the stories module's copy — the
    // Destaques SECTION TITLE is the communities namespace's, because it names the section rather
    // than the things in it.
    getTranslations('stories'),
    getTranslations('app.error'),
    getLocale(),
    requireBootstrap(),
    primaryHostOrigin(),
    loadCommunity(communityId),
  ]);

  if (result.status === 'not-found') notFound();

  if (result.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={te('title')}
          body={te('body')}
          action={
            <a
              href={`/comunidades/${encodeURIComponent(communityId)}`}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
            >
              {te('retry')}
            </a>
          }
        />
      </div>
    );
  }

  const community = result.community;
  const archived = community.status !== 'active';
  // The SAME permission `requirePermission` evaluates on the API (T-05-03) — never a role
  // comparison. Without it there is no edit affordance at all, not a disabled one.
  const canManage = bootstrap.permissions.includes(COMMUNITY_PERMISSIONS.manage);

  // The community is readable, so its posts are asked for SECOND rather than in the `Promise.all`
  // above: a miss must not pay for a page of posts nobody will see, and a cross-tenant probe must
  // not cost the API a second query either (the `/post/[postId]` rule).
  const [page, pinned] = await Promise.all([
    loadFeed({ communityId: community.id }),
    // D-68 / STORY-04: the community's Destaques. `null` is "the tenant has no stories module" or
    // "we could not read it" — both render NOTHING, which is the same answer an empty list gives.
    loadCommunityHighlights(community.id),
  ]);
  const now = Date.now();
  const { media, ...card } = postCardLabels(tf);

  /**
   * D-68's pinned-story circle row, answered YES: the Destaques circles ARE the pinned stories, and
   * a tap OPENS THE VIEWER on this community's own pinned sequence.
   *
   * **It is the SAME `StoriesStrip` the `/inicio` home slot renders** — one component, two data
   * sources, two ring variants (UI-D-27). `StoriesSurface` is the client shell that gives the
   * circles their `onOpen`, exactly as it does on the home screen, so a Destaques tap and a strip
   * tap reach the identical screen. There is no tabbed layout on this page and must not be (D-68).
   *
   * **Every circle is visually identical whether its story is active or expired** (D-79, A-4): the
   * ring variant is a property of the ROW, never of the story. `isActive` still rides the payload
   * because the viewer needs it for the expired-mid-view case.
   *
   * `null` means the row AND its `SectionTitle` are both absent with nothing in their place
   * (UI-SPEC E12/empty) — never a reserved height and never an empty-state card of its own.
   */
  const highlightItems = pinned?.items ?? [];
  const highlights: ReactNode =
    highlightItems.length === 0 ? null : (
      <StoriesSurface
        items={highlightItems.map((story) => {
          const time = relativeFrom(story.publishedAt, now);
          return {
            id: story.id,
            label: time,
            actionLabel: ts('circle.action', { time }),
            assetId: story.mediaAssetId,
            variantWidths: story.mediaVariantWidths,
          };
        })}
        // STORY-02's rule, restated for this row: the viewer opens on the ROW'S OWN ordered
        // sequence, built from the same read in the same request — so the Nth circle and the Nth
        // segment can never disagree, and opening the viewer costs no second round trip.
        viewer={{
          items: highlightItems.map((story) => storyViewerItem(story, now)),
          author: {
            // V1's single publisher IS the tenant; see the note in `StoryViewerHost`.
            name: bootstrap.tenant.displayName,
            avatarUrl: bootstrap.tenant.branding.logoUrl,
          },
          labels: storyViewerLabels(ts),
          onLike: likeStoryAction,
          onUnlike: unlikeStoryAction,
          comments: storyCommentsProps(locale, tf, ts, bootstrap),
        }}
        // UI-D-27: the neutral ring. The brand ring means "live now, tap me" and belongs to the
        // strip alone; Destaques is the community's editorial archive.
        ringVariant="neutral"
        regionLabel={tc('page.highlights')}
      />
    );

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <CommunityHeader
        name={community.name}
        description={community.description}
        backHref="/comunidades"
        backLabel={tc('page.back')}
        coverAssetId={community.coverAssetId}
        coverVariantWidths={community.coverVariantWidths}
        coverAlt={tc('card.cover', { community: community.name })}
        // COMM-01's edit entry, mirroring the back control on the other side of the cover. A LINK,
        // not a button: the form is a full-screen route (the `ComposeFab` rule). Its reactivate
        // control stays as the SECOND route back from archive (D-90); the first is the Reativar
        // island in the archived note below.
        action={
          canManage ? (
            <a
              href={`/comunidades/${community.id}/editar`}
              aria-label={tc('form.editTitle')}
              data-community-edit
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
            >
              <Pencil aria-hidden size={20} />
            </a>
          ) : undefined
        }
        statusPill={
          archived ? <StatusPill tone="neutral">{tc('archived.pill')}</StatusPill> : undefined
        }
        // D-90 / UI-D-52: a manager's archived note carries the one-tap Reativar island under the
        // unchanged text; a member's is exactly today's string, with no button.
        note={
          archived ? (
            canManage ? (
              <>
                {tc('archived.note')}
                <ReactivateCommunity communityId={community.id} />
              </>
            ) : (
              tc('archived.note')
            )
          ) : undefined
        }
      />

      {highlights ? (
        <section aria-label={tc('page.highlights')} className="flex flex-col gap-2 pb-4">
          <SectionTitle className="px-4">{tc('page.highlights')}</SectionTitle>
          {highlights}
        </section>
      ) : null}

      {/* The prototype's hairline between the container's own chrome and its content. */}
      <div aria-hidden className="h-px bg-border" />

      <div className="px-4 pt-4 pb-6">
        <CommunityPosts
          initialItems={
            page === null ? [] : page.items.map((post) => postCardView(post, now, tf, shareOrigin))
          }
          initialCursor={page?.nextCursor ?? null}
          initialError={page === null}
          // UI-D-44 / UI-D-37: the permission AND the status. An archived community offers no
          // compose entry at all — not a disabled one.
          canPost={bootstrap.permissions.includes(FEED_PERMISSIONS.create) && !archived}
          captionTruncateAt={FEED_CAPTION_TRUNCATE_AT}
          createHref={`/criar?comunidade=${community.id}`}
          locale={locale}
          onLoadMore={loadMoreCommunityPostsAction.bind(null, community.id)}
          onRefresh={refreshCommunityPostsAction.bind(null, community.id)}
          onLike={likePostAction}
          onUnlike={unlikePostAction}
          comments={{ title: tf('comments.title'), ...feedCommentsProps(locale, tf, bootstrap) }}
          share={{
            title: bootstrap.tenant.displayName,
            copied: tf('share.copied'),
            error: tf('errors.generic'),
          }}
          menu={{
            labels: postMenuLabels(tf),
            deletedLabel: tf('toasts.deleted'),
            onDelete: deletePostAction,
          }}
          labels={{
            ...card,
            // UI-D-46: the community page's landmark names the CONTAINER, never the tenant-wide
            // feed — `feed.region` is "Feed principal" and belongs to a different surface.
            region: tc('region', { community: community.name }),
            carousel: media.carousel,
            attachmentError: media.attachmentError,
            emptyTitle: tc('emptyPosts.title'),
            emptyBody: tc('emptyPosts.body'),
            emptyBodyAuthor: tc('emptyPosts.body'),
            emptyCta: tc('page.compose'),
            errorTitle: te('title'),
            errorBody: te('body'),
            errorRetry: te('retry'),
            loadMoreError: tf('errors.loadMore'),
            loadMoreRetry: te('retry'),
            createCta: tc('page.compose'),
            createFab: tc('page.compose'),
            genericError: tf('errors.generic'),
          }}
        />
      </div>
    </div>
  );
}
