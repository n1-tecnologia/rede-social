import type { Bootstrap, ModuleKey } from '@tria/contracts';
import type { HomeSlot } from '@tria/core/ui';
import { FEED_CAPTION_TRUNCATE_AT } from '@tria/module-feed/contracts';
import type { PostCardLabels, PostMenuLabels } from '@tria/module-feed/ui';
import { EmptyState } from '@tria/ui';
import { TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import {
  createCommentAction,
  deleteCommentAction,
  deletePostAction,
  likeCommentAction,
  likePostAction,
  loadCommentsAction,
  loadMoreFeedAction,
  loadRepliesAction,
  refreshFeedAction,
  unlikeCommentAction,
  unlikePostAction,
} from '@/app/(app)/inicio/feed-actions';
import { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import { FeedSurface } from '@/components/feed/FeedSurface';
import { StoriesSurface } from '@/components/stories/StoriesSurface';
import { loadFeed } from '@/lib/feed';
import { postCardView, relativeFrom } from '@/lib/feed-view';
import { loadStories } from '@/lib/stories';
import { storyViewerItem, storyViewerLabels } from '@/lib/story-view';
import { primaryHostOrigin } from '@/lib/tenant-host';

/**
 * The WEB composition point for module UI (MOD-02, D-42). The API registry
 * (`apps/api/src/modules/registry.ts`) decides WHICH modules a tenant has and emits their `home`
 * declarations on the bootstrap; this file supplies the renderer for each `<key>` → `home[index]`.
 * Nothing here decides membership: a module without an enabled flag never reaches
 * `bootstrap.modules`, so its renderer is never called.
 *
 * **Composition may now cross into one client shell per surface** (04-08, amending "the only file
 * in `apps/web` that imports a module's `ui` package"): `components/feed/FeedSurface.tsx` and
 * `components/feed/PostDetail.tsx` render `FeedList` / `PostCard` because two handlers — the share
 * branch table and the failed-like toast — need `useToast`, and a server component cannot hold a
 * hook. The rule those shells keep is the one that mattered: every DECISION (which module, which
 * data, which label, which server action, which share origin) is still made HERE, on the server,
 * and passed straight through. A shell that started choosing a label or a route would be the drift
 * this file exists to prevent.
 */

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * THE card's label block (04-08) — the ONE place the post's strings are chosen.
 *
 * `/inicio`'s home slot and `/post/[postId]` both read this, for the same reason both read
 * `postCardView` from `lib/feed-view.tsx`: a second copy of the block would drift the first time a
 * label changed on one surface, and the card on the post page would quietly stop matching the card
 * in the feed. `FeedList` flattens `media` into its own label block, so the list destructures it
 * rather than keeping a parallel literal.
 *
 * `raw`, not `tf(...)`, for the two count blocks: those are TEMPLATES the module fills with the
 * count it is showing at that instant (an optimistic like changes the number without a round trip),
 * so the placeholder must survive the catalog lookup instead of being interpolated here.
 */
export function postCardLabels(tf: Translator): PostCardLabels {
  return {
    more: tf('caption.more'),
    like: tf('actions.like'),
    unlike: tf('actions.unlike'),
    comment: tf('actions.comment'),
    share: tf('actions.share'),
    moreOptions: tf('actions.more'),
    likes: { one: tf.raw('meta.likes.one'), other: tf.raw('meta.likes.other') },
    comments: { one: tf.raw('meta.comments.one'), other: tf.raw('meta.comments.other') },
    edited: tf('meta.edited'),
    media: { carousel: tf('gallery.carousel'), attachmentError: tf('errors.generic') },
  };
}

/**
 * The overflow menu's label block (04-09) — chosen HERE for the same reason `postCardLabels` is:
 * `@tria/module-feed` ships no language (PWA-03), and `/inicio` and `/post/[postId]` must offer the
 * identical rows. "Copiar link" is deliberately the `share` namespace's own string, not a second
 * copy under `menu`: the row and the action row's share control are one handler resolving one url,
 * and two catalog keys for one affordance is exactly how those two drift apart.
 *
 * The four confirmation strings are FIXED — nothing interpolates a caption, a name or a filename
 * into a destructive dialog (T-04-58).
 */
export function postMenuLabels(tf: Translator): PostMenuLabels {
  return {
    edit: tf('menu.edit'),
    copyLink: tf('share.copyLink'),
    delete: tf('menu.delete'),
    deleteTitle: tf('delete.title'),
    deleteBody: tf('delete.body'),
    deleteConfirm: tf('delete.confirm'),
    deleteCancel: tf('delete.cancel'),
  };
}

/** Renders one home slot for a module; receives the whole bootstrap (permissions, tenant, …). */
export type HomeSlotRenderer = (ctx: { bootstrap: Bootstrap }) => Promise<ReactNode>;

interface WebModule {
  /** One renderer per `manifest.home[index]`; an index without a renderer renders nothing. */
  home: HomeSlotRenderer[];
}

/**
 * `feed` → home[0] (D-55): the feed is the main content of `/inicio`, and it adds NO navigation tab.
 *
 * `canPost` is the composed `feed.post.create` permission from the bootstrap — the SAME value the
 * API's `requirePermission` guard evaluates (FEED-08). There is deliberately no role comparison here:
 * flipping `tenant_modules['feed'].settings.postingPolicy` to `'members'` must turn a member into an
 * author with no web change at all.
 *
 * A load failure renders the widget's own error card rather than rejecting: `homeSlotsFor` would
 * replace the slot with the generic card anyway, but the feed is the page's main content and its
 * error deserves the feed's own region label.
 */
const feedHome: HomeSlotRenderer = async ({ bootstrap }) => {
  // `shareOrigin` is resolved on the SERVER (FEED-07): `https://{primaryHost}` from the tenant's
  // verified `tenant_domains` row, `null` on the platform and generic shells. It is what turns each
  // post id into a card's `shareUrl`, and it is deliberately not something the browser could have
  // derived for itself — an alias host would leak into a link a member sends (T-04-51). A null
  // origin yields a null `shareUrl`, and the card then offers no share affordance at all.
  const [page, locale, tf, te, shareOrigin] = await Promise.all([
    loadFeed(),
    getLocale(),
    getTranslations('feed'),
    getTranslations('app.error'),
    primaryHostOrigin(),
  ]);
  const now = Date.now();
  // The SAME block `/post/[postId]` renders its card with; `FeedList` flattens `media` into its own
  // labels, so it is destructured here rather than duplicated as a second literal.
  const { media, ...card } = postCardLabels(tf);

  return (
    <FeedSurface
      initialItems={
        page === null ? [] : page.items.map((post) => postCardView(post, now, tf, shareOrigin))
      }
      initialCursor={page?.nextCursor ?? null}
      initialError={page === null}
      canPost={bootstrap.permissions.includes('feed.post.create')}
      captionTruncateAt={FEED_CAPTION_TRUNCATE_AT}
      // 04-09 closes 04-01's stub (WINDOWS #18): the empty card's CTA, the desktop header button and
      // the mobile FAB all point HERE, and the module never assembles a route (MOD-02). It was left
      // absent until the route existed precisely so nothing linked to a 404.
      createHref="/criar"
      locale={locale}
      onLoadMore={loadMoreFeedAction}
      onRefresh={refreshFeedAction}
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
        region: tf('region'),
        carousel: media.carousel,
        attachmentError: media.attachmentError,
        emptyTitle: tf('empty.title'),
        emptyBody: tf('empty.body', { tenant: bootstrap.tenant.displayName }),
        emptyBodyAuthor: tf('empty.bodyAuthor', { tenant: bootstrap.tenant.displayName }),
        emptyCta: tf('empty.cta'),
        errorTitle: te('title'),
        errorBody: te('body'),
        errorRetry: te('retry'),
        loadMoreError: tf('errors.loadMore'),
        loadMoreRetry: te('retry'),
        createCta: tf('empty.cta'),
        createFab: tf('empty.cta'),
        genericError: tf('errors.generic'),
      }}
    />
  );
};

/**
 * Everything D-59's comment surface needs, composed HERE for the same reason every other label
 * block is: `@tria/module-feed` ships no language (PWA-03) and knows no route table (MOD-02).
 *
 * **Both containers read this one block** (04-08): the `CommentSheet` over the feed adds its own
 * `title` at the call site, and `/post/[postId]` spreads the rest straight into the INLINE
 * `CommentsList`. The sheet's title is the only thing the two surfaces do not share, which is
 * exactly D-59's claim — one implementation, one label block, two containers.
 *
 * The six handlers are SERVER ACTIONS, which is what lets them cross into the client component that
 * owns the sheet. `canDelete` is NOT computed here and not computed in the client either — it rides
 * each row from the API, which derives it from the caller's own user id and re-checks it on the
 * delete itself (T-04-44). A client-side comparison would either hide a legitimate control or offer
 * one that always 404s.
 *
 * `viewer` feeds the OPTIMISTIC row only, and is replaced by the server's reconciled row a moment
 * later. `profileHref` is null there because the bootstrap carries the viewer's profile but not
 * their membership id — and for the ~200 ms a pending row lives, a name without a link is the
 * honest rendering rather than a guessed route.
 */
export function feedCommentsProps(locale: string, tf: Translator, bootstrap: Bootstrap) {
  return {
    locale,
    viewer: {
      displayName: bootstrap.membership.profile.displayName,
      profileHref: null,
      avatarUrl: bootstrap.membership.profile.avatarUrl,
    },
    onLoadComments: loadCommentsAction,
    onLoadReplies: loadRepliesAction,
    onCreateComment: createCommentAction,
    onDeleteComment: deleteCommentAction,
    onLikeComment: likeCommentAction,
    onUnlikeComment: unlikeCommentAction,
    labels: {
      region: tf('comments.region'),
      emptyLabel: tf('comments.empty'),
      errorLabel: tf('errors.comments'),
      errorRepliesLabel: tf('errors.replies'),
      retryLabel: tf('comments.retry'),
      submitErrorLabel: tf('errors.commentSubmit'),
      replyDepthErrorLabel: tf('errors.replyDepth'),
      loadMoreLabel: tf('comments.loadMore'),
      loadMoreRepliesLabel: tf('comments.loadMoreReplies'),
      // `raw`, not `tf(...)`: these are TEMPLATES the module fills with the count it is showing at
      // that instant, so the placeholder must survive the catalog lookup (the meta-row rule).
      showReplies: {
        one: tf.raw('comments.showReplies.one'),
        other: tf.raw('comments.showReplies.other'),
      },
      hideReplies: {
        one: tf.raw('comments.hideReplies.one'),
        other: tf.raw('comments.hideReplies.other'),
      },
      replyChip: tf.raw('comments.replyChip'),
      replyChipDismiss: tf('comments.replyChipDismiss'),
      placeholder: tf('comments.placeholder'),
      submitLabel: tf('comments.submit'),
      viewerLabel: tf('comments.viewerAvatar'),
      nowLabel: tf('comments.now'),
      deleteTitle: tf('comments.delete.title'),
      deleteBody: tf('comments.delete.body'),
      deleteConfirm: tf('comments.delete.confirm'),
      deleteCancel: tf('comments.delete.cancel'),
      item: {
        removedAuthor: tf('comments.removedAuthor'),
        like: tf('comments.like'),
        unlike: tf('comments.unlike'),
        likes: { one: tf.raw('comments.likes.one'), other: tf.raw('comments.likes.other') },
        reply: tf('comments.reply'),
        delete: tf('comments.delete.label'),
      },
    },
  };
}

/**
 * `stories` → home[0] at order 5 (UI-D-25): the strip sits ABOVE the feed, because a story is the
 * most time-bounded thing on `/inicio` — it is gone in 24 h — while the feed is durable. The module
 * declares no navigation tab at all (D-40/D-80): its publish door is the own-circle below.
 *
 * **The own-circle's visibility is a PERMISSION, never a role** (UI-D-28, T-05-25). It renders
 * exactly when the bootstrap carries `stories.story.publish` — the same composed value the API's
 * `requirePermission` guard evaluates — so turning members into publishers in V2 is a settings flip
 * with no web change. A role comparison here would hard-code V1 into the home screen.
 *
 * **A failed read renders NOTHING** (UI-SPEC E01/error): `loadStories` swallows the failure into
 * `null`, this returns an empty strip, and `StoriesStrip` then collapses to no node for a member.
 * The strip must never be the reason `/inicio` shows an error card — which is also why it is NOT
 * allowed to reject into `homeSlotsFor`'s generic error slot the way the feed deliberately is.
 *
 * Every relative-time label is formatted HERE from the page's single `now` (UI-D-14): the circle
 * never calls a clock in render, so there is no hydration mismatch and no per-second re-render.
 */
const storiesHome: HomeSlotRenderer = async ({ bootstrap }) => {
  const [page, tf] = await Promise.all([loadStories(), getTranslations('stories')]);
  const now = Date.now();
  const canPublish = bootstrap.permissions.includes('stories.story.publish');
  const stories = page?.items ?? [];

  return (
    <StoriesSurface
      items={stories.map((story) => {
        const time = relativeFrom(story.publishedAt, now);
        return {
          id: story.id,
          label: time,
          actionLabel: tf('circle.action', { time }),
          assetId: story.mediaAssetId,
          variantWidths: story.mediaVariantWidths,
        };
      })}
      // STORY-02: the viewer opens on the STRIP'S OWN ordered sequence, built from the same page in
      // the same request — so the Nth circle and the Nth segment can never disagree, and opening
      // the viewer costs no second round trip. No stories means no `viewer` prop at all, which is
      // what keeps the circles inert rather than linking to a sequence with nothing in it.
      viewer={
        stories.length === 0
          ? undefined
          : {
              items: stories.map((story) => storyViewerItem(story, now)),
              author: {
                // V1's single publisher IS the tenant; see the note in `StoryViewerHost`.
                name: bootstrap.tenant.displayName,
                avatarUrl: bootstrap.tenant.branding.logoUrl,
              },
              labels: storyViewerLabels(tf),
              onLike: likeStoryAction,
              onUnlike: unlikeStoryAction,
            }
      }
      ringVariant="brand"
      regionLabel={tf('region')}
      own={
        canPublish
          ? {
              href: '/stories/publicar',
              label: tf('own.label'),
              actionLabel: tf('own.action'),
              avatarUrl: bootstrap.membership.profile.avatarUrl,
            }
          : undefined
      }
    />
  );
};

export const WEB_MODULE_REGISTRY: Partial<Record<ModuleKey, WebModule>> = {
  feed: { home: [feedHome] },
  stories: { home: [storiesHome] },
};

/**
 * Module tab labels resolve from the module's own catalog namespace (`<key>.nav`, e.g.
 * `events.nav = "Eventos"`) before the manifest label (PWA-03). `t` is the ROOT translator.
 */
export function moduleLabelResolver(
  t: Translator,
): (key: string, fallback: string) => string | null {
  return (key, fallback) => (t.has(`${key}.nav`) ? t(`${key}.nav`) : fallback);
}

/**
 * The home slots of the tenant's ENABLED modules, in registry order (D-42). Every renderer runs with
 * `Promise.allSettled`: a slot whose loader rejects is replaced, in its own position, by the generic
 * error card (UI consideration E04/error) while the welcome block and the other slots still render.
 */
export async function homeSlotsFor(bootstrap: Bootstrap): Promise<HomeSlot[]> {
  const jobs: { key: string; order: number; run: () => Promise<ReactNode> }[] = [];
  for (const module of bootstrap.modules) {
    const renderers = WEB_MODULE_REGISTRY[module.key]?.home ?? [];
    (module.home ?? []).forEach((slot, index) => {
      const render = renderers[index];
      if (!render) return;
      jobs.push({
        key: `${module.key}:${index}`,
        order: slot.order,
        run: () => render({ bootstrap }),
      });
    });
  }
  if (jobs.length === 0) return [];

  const [te, results] = await Promise.all([
    getTranslations('app.error'),
    Promise.allSettled(jobs.map((job) => job.run())),
  ]);

  return results.map((result, i) => {
    const { key, order } = jobs[i] as (typeof jobs)[number];
    if (result.status === 'fulfilled') return { key, order, node: result.value };
    console.error('home-slot.failed', { slot: key, reason: String(result.reason) });
    return {
      key,
      order,
      node: (
        <EmptyState
          variant="card"
          icon={TriangleAlert}
          title={te('title')}
          body={te('body')}
          action={
            <a href="/inicio" className="text-sm font-bold text-brand">
              {te('retry')}
            </a>
          }
        />
      ),
    };
  });
}
