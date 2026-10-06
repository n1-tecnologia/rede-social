import type { Bootstrap, ModuleKey } from '@rede-social/contracts';
import type { HomeSlot, NavArea, NavItem } from '@rede-social/core/ui';
import { FEED_CAPTION_TRUNCATE_AT } from '@rede-social/module-feed/contracts';
import type { PostCardLabels, PostMenuLabels } from '@rede-social/module-feed/ui';
import { STORY_MAX_PAGE_SIZE, STORY_PERMISSIONS } from '@rede-social/module-stories/contracts';
import { EmptyState } from '@rede-social/ui';
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
import {
  createStoryCommentAction,
  deleteStoryCommentAction,
  likeStoryAction,
  loadStoryCommentsAction,
  refuseStoryCommentLikeAction,
  refuseStoryRepliesAction,
  unlikeStoryAction,
} from '@/app/(app)/stories/story-actions';
import { FeedSurface } from '@/components/feed/FeedSurface';
import { StoriesBand } from '@/components/stories/StoriesBand';
import { StoriesSurface } from '@/components/stories/StoriesSurface';
import { readAdminIconChoice } from '@/lib/admin-icon-cookie';
import { loadFeed } from '@/lib/feed';
import { postAuthorAdminLabel, postCardView } from '@/lib/feed-view';
import { loadHighlights, loadStories } from '@/lib/stories';
import {
  highlightGroupView,
  inicioGroups,
  inicioRow,
  openableHighlights,
  storyViewerItem,
  storyViewerLabels,
  tenantCircleFace,
  tenantSeenLabels,
  tenantSeenState,
  tenantSequence,
} from '@/lib/story-view';
import { collectTabDots, eventsTabDot, type TabDot, type TabDotLoader } from '@/lib/tab-dots';
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
 * `@rede-social/module-feed` ships no language (PWA-03), and `/inicio` and `/post/[postId]` must offer the
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
  home?: HomeSlotRenderer[];
  /** The red dot on the module's tab (`tabDotsFor`); without it the tab never has one. */
  tabDot?: TabDotLoader;
  /**
   * While the module's pages scroll down, the phone's BottomNav folds into the corner, one button
   * that takes the page back to the top (`collapsingTabsFor`, `NavItem.collapse`).
   */
  collapsesNav?: true;
  /**
   * The module's pages form an AREA (2026-10-06): the TopBar names it and folds its shortcuts into
   * the area's menu, whose screens this declares (`areasFor`, `NavArea`). Worded with the ROOT
   * translator, like the module labels.
   */
  area?: (t: (key: string) => string) => Omit<NavArea, 'key'>;
}

/** The events area: the list, the photos of past events, the check-in and the member's own. */
function eventsArea(t: (key: string) => string): Omit<NavArea, 'key'> {
  return {
    label: t('events.area.label'),
    menuLabel: t('events.area.menu'),
    screens: [
      {
        key: 'events-list',
        href: '/eventos',
        icon: 'calendar-days',
        label: t('events.area.screens.events'),
      },
      {
        key: 'events-photos',
        href: '/eventos/fotos',
        icon: 'camera',
        label: t('events.area.screens.photos'),
      },
      {
        key: 'events-checkin',
        href: '/eventos/check-in',
        icon: 'qr-code',
        label: t('events.area.screens.checkin'),
      },
      {
        key: 'events-mine',
        href: '/eventos/meus',
        icon: 'ticket',
        label: t('events.area.screens.mine'),
      },
    ],
  };
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
  const [page, locale, tf, te, shareOrigin, adminIcon] = await Promise.all([
    loadFeed(),
    getLocale(),
    getTranslations('feed'),
    getTranslations('app.error'),
    primaryHostOrigin(),
    readAdminIconChoice(),
  ]);
  const now = Date.now();
  // The SAME block `/post/[postId]` renders its card with; `FeedList` flattens `media` into its own
  // labels, so it is destructured here rather than duplicated as a second literal.
  const { media, ...card } = postCardLabels(tf);

  return (
    <FeedSurface
      initialItems={
        page === null
          ? []
          : page.items.map((post) =>
              postCardView(
                post,
                now,
                tf,
                shareOrigin,
                bootstrap.tenant.timezone,
                postAuthorAdminLabel(bootstrap, tf),
                adminIcon,
              ),
            )
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
 * block is: `@rede-social/module-feed` ships no language (PWA-03) and knows no route table (MOD-02).
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
    // 2026-10-06: the sheet closes only by its handle (and outside / Escape), so the handle is named.
    closeLabel: tf('comments.close'),
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
      // STORY-05's refusal cannot happen on a POST surface — `feed_comments_parent_fk` only raises
      // it for a story comment — so the feed's block carries the generic sentence here and the
      // story host (D-82) overrides this ONE key from its own namespace. The label is required
      // rather than optional on purpose: a surface where the refusal IS reachable must be made to
      // choose its wording rather than silently inherit "algo deu errado".
      storyNoReplyErrorLabel: tf('errors.commentSubmit'),
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
 * D-82's story comment surface, composed HERE for the same reason `feedCommentsProps` is — and
 * composed FROM it, deliberately.
 *
 * **Every string except one comes from the FEED namespace, verbatim.** The sheet a member opens
 * over a story is the sheet they already know: the same title, the same placeholder, the same empty
 * line, the same removed-member label. Duplicating that copy into `stories.json` would be the exact
 * drift D-82 exists to prevent, one namespace removed — the two would diverge the first time
 * someone reworded "Nenhum comentário ainda". The UI-SPEC's Copywriting Contract says as much:
 * Phase 5 adds NO comment copy beyond the refusal sentences.
 *
 * The one override is `storyNoReplyErrorLabel`, which is a refusal that cannot happen on a post and
 * therefore has no honest wording in the feed's namespace.
 *
 * The three handlers are the STORY actions, not the feed's: they address `/v1/stories/{id}/comments`
 * and their refusal vocabulary is STORY-05's. The other three — replies, like, unlike — are wired to
 * a rejection rather than left undefined, because the flat variant never calls them and a resolved
 * no-op would be a quieter lie.
 */
export function storyCommentsProps(
  locale: string,
  tf: Translator,
  ts: Translator,
  bootstrap: Bootstrap,
) {
  const feed = feedCommentsProps(locale, tf, bootstrap);
  return {
    ...feed,
    title: tf('comments.title'),
    onLoadComments: loadStoryCommentsAction,
    onCreateComment: createStoryCommentAction,
    onDeleteComment: deleteStoryCommentAction,
    // The three a flat list never calls, wired to a REFUSAL rather than to a resolved no-op — and
    // they are server ACTIONS rather than plain functions, because a plain function cannot cross
    // the RSC boundary at all (Next refuses to serialise it, and the whole home slot fails with it).
    onLoadReplies: refuseStoryRepliesAction,
    onLikeComment: refuseStoryCommentLikeAction,
    onUnlikeComment: refuseStoryCommentLikeAction,
    labels: { ...feed.labels, storyNoReplyErrorLabel: ts('viewer.comments.noReply') },
  };
}

/**
 * `stories` → home[0] at order 5 (UI-D-25): the row sits ABOVE the feed, because a story is the
 * most time-bounded thing on `/inicio` — it is gone in 24 h — while the feed is durable. The module
 * declares no navigation tab at all (D-40/D-80): its publish door is the `+` circle below.
 *
 * **D-104 / D-106 replace D-78.** Início shows ONE tenant circle — the tenant's logo and display
 * name; since #2b (2026-10-03) the FACE of whoever published the newest live story, with the logo
 * behind it (`tenantCircleFace`) — holding every active, ready story of the tenant, played
 * OLDEST → NEWEST over the newest
 * `STORY_MAX_PAGE_SIZE` (the API's newest-first page, reversed here by `tenantSequence`), followed by
 * Início's highlights, one circle each, in `position, id` order (UI-D-59, built by `inicioRow`).
 * Since 05.2-05 every circle OPENS: the viewer plays the row's groups (`inicioGroups`, D-107) — the
 * tenant sequence as group 0, then one group per highlight whose items are read lazily when the
 * member reaches it (`loadHighlightItemsAction`), so this render never carries a highlight's items.
 *
 * **The tenant circle wears the caller's seen ring** (05.2-10: HIGHLIGHT-06, D-105, UI-D-61): the
 * brand ring and "… Há stories novos." while any story of the sequence is unseen by THIS caller
 * (`viewerSeen`, their own server-side flag — the same statement as the page, no extra request),
 * the neutral ring and the plain name once all are seen, and it opens at the first unseen story.
 * `StoriesSurface` re-derives the same state on every close from the session's seen set.
 *
 * **The `+` circle's visibility is a PERMISSION, never a role** (UI-D-28, T-05-25). It renders
 * exactly when the bootstrap carries `stories.story.publish` — the same composed value the API's
 * `requirePermission` guard evaluates — so turning members into publishers in V2 is a settings flip
 * with no web change. A role comparison here would hard-code V1 into the home screen.
 *
 * **A failed read renders NOTHING for its part** (UI-SPEC E01/error, T-05.2-22): `loadStories` and
 * `loadHighlights` each swallow a failure into `null` and never navigate, so a failed stories read
 * drops only the tenant circle and a failed highlights read drops only the highlights. A member
 * with nothing gets an empty `circles` list and the slot is `null` (no band, no node). The row must
 * never be the reason `/inicio` shows an error card — which is also why it is NOT allowed to reject
 * into `homeSlotsFor`'s generic error slot the way the feed deliberately is. A member's read
 * (`loadHighlights({})`) already excludes empty highlights (T-05.2-20); only a caller holding
 * `stories.story.manage` asks for `scope: 'all'` (which the API refuses to anyone else), and gets
 * the admin circles of UI-D-63 — empty highlights as dashed links and the trailing "Gerenciar"
 * (D-108, D-109, 05.2-09).
 *
 * Every relative-time label is formatted HERE from the page's single `now` (UI-D-14): the viewer
 * never calls a clock in render, so there is no hydration mismatch and no per-second re-render.
 */
const storiesHome: HomeSlotRenderer = async ({ bootstrap }) => {
  // D-108 / D-109 / UI-D-63: a CURATOR reads the curator row (`scope: 'all'`, empty highlights
  // included) and gets the dashed admin circles; everyone else keeps the member read, so an empty
  // highlight never reaches a member's HTML (T-05.2-20).
  const curates = bootstrap.permissions.includes(STORY_PERMISSIONS.manage);
  const [page, highlights, tf, tfeed, locale] = await Promise.all([
    loadStories({ limit: STORY_MAX_PAGE_SIZE }),
    loadHighlights(curates ? { scope: 'all' } : {}),
    getTranslations('stories'),
    // D-82: the sheet's own copy is the FEED's, read from the feed namespace rather than copied
    // into the stories one.
    getTranslations('feed'),
    getLocale(),
  ]);
  const now = Date.now();
  const tenant = {
    displayName: bootstrap.tenant.displayName,
    logoUrl: bootstrap.tenant.branding.logoUrl,
  };
  // D-106: one bounded page, played oldest first.
  const sequence = tenantSequence(page);
  // D-105: the first render's ring and resume point, from the caller's own flags (oldest first).
  const tenantSeen = tenantSeenState(
    sequence.map((story) => ({ id: story.id, seen: story.viewerSeen })),
  );
  const rowHighlights = highlights?.items ?? [];
  const groups = inicioGroups({
    tenant,
    sequence: sequence.map((story) => storyViewerItem(story, now)),
    // Only a highlight with a member-visible story is a viewer group: an empty one is the curator's
    // dashed LINK to the manage screen and never opens the viewer (UI-D-63b).
    highlightGroups: openableHighlights(rowHighlights).map(highlightGroupView),
  });

  const circles = inicioRow(
    {
      canPublish: bootstrap.permissions.includes('stories.story.publish'),
      tenant,
      sequenceLength: sequence.length,
      // #2b: the newest live story's author photo (the owner's face), read from the same page — no
      // extra request; null keeps the logo or the monogram, which is also the photo's fallback.
      tenantFace: tenantCircleFace(sequence),
      tenantSeen,
      highlights: rowHighlights,
      // D-109: the ONE curation door for Início — the trailing "Gerenciar" circle. It is there
      // even when nothing else is (D-108), so the admin can always create the first highlight.
      ...(curates
        ? {
            curator: {
              manageHref: '/stories/destaques',
              manageActionLabel: tf('highlights.circle.actionHome'),
            },
          }
        : {}),
    },
    tf,
  );
  // UI-D-26, all or nothing: no circle, no slot. `HomeSlots` skips a `null` node outright, so a
  // member with nothing to watch gets neither the band nor a gap where it would have been.
  if (circles.length === 0) return null;

  return (
    // The REINE timeline (2026-10-02): the row sits in its own full-bleed white band.
    <StoriesBand>
      <StoriesSurface
        circles={circles}
        // D-107 / UI-D-65: the viewer plays the row — one group per openable circle, in the same
        // order `inicioRow` numbers them. The tenant group carries its sequence, built from the same
        // page in the same request (no second round trip); each highlight group carries NO items
        // (`null`): they are read lazily when the member reaches that circle, never in this render.
        // Nothing to open means no `viewer` prop at all.
        viewer={
          groups.length === 0
            ? undefined
            : {
                groups,
                labels: storyViewerLabels(tf),
                onLike: likeStoryAction,
                onUnlike: unlikeStoryAction,
                comments: storyCommentsProps(locale, tfeed, tf, bootstrap),
                // UI-D-66 / D-110 route 1: the viewer's "Destacar" pill, on every Início group —
                // gated on the composed PERMISSION, never a role (the API re-checks it on every read
                // and write the sheet makes, T-05.2-26).
                canCurate: curates,
                // UI-D-61: the tenant circle's two names, so the surface can re-derive it on close.
                seenRing: tenantSeenLabels(tenant, tf),
              }
        }
        regionLabel={tf('region')}
      />
    </StoriesBand>
  );
};

export const WEB_MODULE_REGISTRY: Partial<Record<ModuleKey, WebModule>> = {
  feed: { home: [feedHome] },
  stories: { home: [storiesHome] },
  // The manifest still declares its Início slot (order 7); no renderer here, so `homeSlotsFor`
  // skips it: the next event is the tab's dot since 2026-10-03, no longer a card on Início.
  // 2026-10-06: the events pages form an area (the REINE prototype's Eventos, Fotos, Check-in, Meus).
  events: { tabDot: eventsTabDot, area: eventsArea },
  // 2026-10-03: the bar folds into the corner over the communities, as in the REINE prototype.
  communities: { collapsesNav: true },
};

/**
 * 07-01 (CONTEXT: "row renderers keyed by `kind`", UI-D-251): the notification row renderers live in
 * `lib/notification-renderers.tsx` (a leaf module the view test can import without this file's
 * server-action graph) and are re-exported HERE, the composition point every surface reads.
 */
export { notificationRenderers } from '@/lib/notification-renderers';

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
 * error card (UI consideration E04/error) while the other slots still render.
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
        // A card, so it keeps the page gutter on a phone (the timeline's posts run edge to edge).
        <div className="px-4 md:px-0">
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
        </div>
      ),
    };
  });
}

/**
 * The red dots of the shell's tabs (2026-10-03), by tab key, from the loaders the modules registered
 * here (`WebModule.tabDot`); `collectTabDots` (`lib/tab-dots.ts`) asks them all at once and keeps a
 * failure to its own tab.
 */
export function tabDotsFor(
  bootstrap: Bootstrap,
  tabs: ReadonlyArray<NavItem>,
): Promise<Record<string, TabDot>> {
  return collectTabDots((key) => WEB_MODULE_REGISTRY[key as ModuleKey]?.tabDot, bootstrap, tabs);
}

/**
 * The tabs over whose pages the phone's BottomNav folds into the corner (2026-10-03): those of the
 * modules that asked for it here (`WebModule.collapsesNav`). A tab exists only for an ENABLED module.
 */
export function collapsingTabsFor(tabs: ReadonlyArray<NavItem>): NavItem[] {
  return tabs.filter((tab) => WEB_MODULE_REGISTRY[tab.key as ModuleKey]?.collapsesNav);
}

/**
 * 2026-10-06: the areas of the shell, one per enabled module that declares one (`WebModule.area`),
 * worded with the root translator. `withAreas` puts them on the nav.
 */
export function areasFor(tabs: ReadonlyArray<NavItem>, t: (key: string) => string): NavArea[] {
  return tabs.flatMap((tab) => {
    const area = WEB_MODULE_REGISTRY[tab.key as ModuleKey]?.area;
    return area ? [{ key: tab.key, ...area(t) }] : [];
  });
}
