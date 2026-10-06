import { COMMUNITY_PERMISSIONS } from '@rede-social/module-communities/contracts';
import { CommunityHeader } from '@rede-social/module-communities/ui';
import { FEED_CAPTION_TRUNCATE_AT, FEED_PERMISSIONS } from '@rede-social/module-feed/contracts';
import { STORY_PERMISSIONS } from '@rede-social/module-stories/contracts';
import { EmptyState, SectionTitle, StatusPill } from '@rede-social/ui';
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
import { loadHighlights } from '@/lib/stories';
import {
  highlightGroupView,
  highlightRowCircles,
  openableHighlights,
  storyViewerLabels,
} from '@/lib/story-view';
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
    // The highlight circles are the stories module's component with the stories module's copy —
    // the Destaques SECTION TITLE is the communities namespace's, because it names the section
    // rather than the things in it.
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
  // D-109 / UI-D-63: a curator of an ACTIVE community gets the dashed admin circles — its empty
  // highlights as links and the trailing "Gerenciar" — so it reads the curator row. An archived
  // community keeps the member read and gets no manage circle (UI-D-64); its manage screen stays
  // reachable by direct link for take-downs (UI-D-80).
  const curates = !archived && bootstrap.permissions.includes(STORY_PERMISSIONS.manage);
  const [page, placed] = await Promise.all([
    loadFeed({ communityId: community.id }),
    // HIGHLIGHT-04: this community's named highlights. A member's read (no `scope`) never carries an
    // empty highlight (D-102). `null` is "the tenant has no stories module" or "we could not read
    // it" — both render NOTHING, which is the same answer an empty row gives.
    loadHighlights(
      curates ? { communityId: community.id, scope: 'all' } : { communityId: community.id },
    ),
  ]);
  const now = Date.now();
  const { media, ...card } = postCardLabels(tf);

  /**
   * HIGHLIGHT-04 / UI-D-64: under "Destaques", the community's NAMED HIGHLIGHTS — the same row
   * Início draws, minus the tenant circle (D-104 is Início's alone). The pinned-story row this
   * replaced (D-68's "the Destaques circles ARE the pinned stories") is gone.
   *
   * **It is the SAME `StoriesStrip` the `/inicio` home slot renders** through the same
   * `StoriesSurface` client shell, with the same builders (`highlightCircleView`,
   * `highlightGroupView`): one circle per highlight in the API's `position, id` order, each OPENING
   * its own viewer group at its first story (D-107). A group's items are NOT carried by this render:
   * the viewer reads them lazily when the member reaches that circle, exactly as on Início. Every
   * highlight circle wears the neutral archive ring (UI-D-61). There is no tabbed layout (D-68).
   *
   * **The leading `+` is the D-80 door restated for this row (D-92, UI-D-53).** It is the strip's
   * `link` circle with the `own` disc — "Seu story" — pointed at `/stories/publicar?comunidade={id}`,
   * so the composer opens pre-filled with this community's first highlight (or its D-112 gate when it
   * has none) and the story lands in this row. It is drawn exactly like Início's (UI-D-28, as
   * amended on 2026-10-02): a centred `Plus` in the dashed "only you see this" ring (UI-D-63), never
   * the admin's photo. **Its gate is unchanged**: `stories.story.publish` AND `stories.story.manage`
   * AND an active community — what the API requires for a publish that names a destination
   * (T-05.2-32) — so this door never opens onto a composer that cannot choose one.
   *
   * **An ARCHIVED community shows its non-empty highlights read-only** (UI-D-64, the D-93 analogue):
   * no `+` at all — not a disabled one — while its circles still open.
   *
   * **A curator of an active community also gets UI-D-63's admin circles** (05.2-09): an EMPTY
   * highlight as a dashed link to `/comunidades/{id}/destaques?editar={highlightId}` (never a viewer
   * group) and the trailing "Gerenciar" circle to the manage screen — the ONE curation door (D-109).
   *
   * `null` means the row AND its `SectionTitle` are both absent with nothing in their place (UI E02
   * empty, UI-D-53) — never a reserved height. That is the case only with no highlight, no `+` and
   * no manage circle: a curator always sees "Gerenciar" (D-108), and a member sees nothing.
   */
  const highlightItems = placed?.items ?? [];
  const playable = openableHighlights(highlightItems);
  const canPublishHere =
    !archived &&
    bootstrap.permissions.includes(STORY_PERMISSIONS.publish) &&
    bootstrap.permissions.includes(STORY_PERMISSIONS.manage);
  const highlights: ReactNode =
    highlightItems.length === 0 && !canPublishHere && !curates ? null : (
      <StoriesSurface
        circles={[
          // The D-80 door restated for this row (D-92, UI-D-53): the leading `+` link circle.
          ...(canPublishHere
            ? [
                {
                  kind: 'link' as const,
                  key: 'own',
                  href: `/stories/publicar?comunidade=${community.id}`,
                  label: ts('own.label'),
                  actionLabel: ts('own.actionCommunity', { community: community.name }),
                  ring: 'dashed' as const,
                  disc: { kind: 'own' as const },
                },
              ]
            : []),
          // One circle per highlight; the k-th PLAYABLE one opens group k — the circles and the
          // groups below are built from the same read in the same order, so they never disagree.
          // A curator's empty highlights are dashed links, and "Gerenciar" closes the row.
          ...highlightRowCircles(
            highlightItems,
            0,
            ts,
            curates
              ? {
                  manageHref: `/comunidades/${community.id}/destaques`,
                  manageActionLabel: ts('highlights.circle.actionCommunity', {
                    community: community.name,
                  }),
                }
              : undefined,
          ),
        ]}
        // With nothing playable (the `+` and the admin circles alone) there is nothing to open, so
        // there is no viewer at all — the home strip's rule.
        viewer={
          playable.length === 0
            ? undefined
            : {
                groups: playable.map(highlightGroupView),
                labels: storyViewerLabels(ts),
                onLike: likeStoryAction,
                onUnlike: unlikeStoryAction,
                comments: storyCommentsProps(
                  locale,
                  tf,
                  ts,
                  bootstrap,
                  await getTranslations('moderation'),
                ),
                // UI-D-66: "Destacar" for a curator on any story, a permission never a role.
                canCurate: bootstrap.permissions.includes(STORY_PERMISSIONS.manage),
                // The empty highlight sheet's "Criar destaque" opens THIS community's manage screen.
                originCommunityId: community.id,
              }
        }
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

      {/* No side gutter: the posts run edge to edge like Início's timeline (the REINE layout,
          2026-10-02), 12px of page ground under the hairline; the feed keeps its own empty and
          error cards inset. */}
      <div className="pt-3 pb-6">
        <CommunityPosts
          initialItems={
            page === null
              ? []
              : page.items.map((post) =>
                  postCardView(post, now, tf, shareOrigin, bootstrap.tenant.timezone),
                )
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
          comments={{
            title: tf('comments.title'),
            ...feedCommentsProps(locale, tf, bootstrap, await getTranslations('moderation')),
          }}
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
