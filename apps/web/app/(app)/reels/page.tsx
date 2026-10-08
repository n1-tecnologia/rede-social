import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { likePostAction, unlikePostAction } from '@/app/(app)/inicio/feed-actions';
import { ReelsHost } from '@/components/reels/ReelsHost';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadReelsPage, loadVideoCommunities } from '@/lib/reels';
import { feedCommentsProps } from '@/lib/registry';

/**
 * `/reels` (REELS-02, D-121, D-123, UI-D-92) — the tenant's ready videos, full screen, reached from
 * the "Reels" tab the module's manifest declares (label from the catalog's `reels.nav`).
 *
 * **Gated by the module list, not by a role.** The bootstrap already applied `effectiveKeys`
 * (05.3-01), so `reels` is absent from `bootstrap.modules` both when the tenant turned Reels off
 * and when it turned the FEED off (Reels requires the feed). Either way this is the not-found
 * screen. `notFound()` throws in Next 16, so it sits outside any try/catch; the feed routes behind
 * the data reads answer 404 on their own when the feed is off (T-05.3-18).
 *
 * **First paint is server-rendered** (UI-D-92): the first "Todos" keyset page and the lanes are read
 * in parallel, so the tab opens on a video rather than on a spinner. `loadReelsPage` answers `null`
 * on a failed read (the host renders the stage error with a retry), and `loadVideoCommunities`
 * degrades to `[]` (the lane row hides, D-120).
 *
 * **No playback credential here** (D-44, T-05-34, T-05.3-19). A page carries asset ids and
 * dimensions only; the host mints the ±1 window through its batched server action, into a map that
 * lives in the client for the visit. Nothing token-related is imported by this file.
 *
 * **Every string is resolved here** (PWA-03): the host receives one label object. The templates the
 * client fills with a value it only knows at that instant (the live region's position, the rail's
 * author name and the two count plurals) are read with `.raw`, so their placeholders survive.
 * Like, comment and share are the FEED's own strings, actions and comment block — a like in Reels is
 * the same like Início shows (D-128), and the sheet is the feed's one sheet (D-59).
 */
export default async function ReelsPage() {
  const [bootstrap, t, tf, locale] = await Promise.all([
    requireBootstrap(),
    getTranslations('reels'),
    getTranslations('feed'),
    getLocale(),
  ]);

  if (!bootstrap.modules.some((module) => module.key === 'reels')) notFound();

  const [initial, lanes] = await Promise.all([loadReelsPage({}), loadVideoCommunities()]);
  const tenantName = bootstrap.tenant.displayName;

  return (
    <ReelsHost
      initial={initial}
      lanes={lanes}
      // The composer's own permission, never a role: granting it elsewhere changes the empty state
      // with no web edit (UI-D-94).
      canPost={bootstrap.permissions.includes('feed.post.create')}
      locale={locale}
      tenantName={tenantName}
      onLike={likePostAction}
      onUnlike={unlikePostAction}
      comments={{
        title: tf('comments.title'),
        ...feedCommentsProps(locale, tf, bootstrap, await getTranslations('moderation')),
      }}
      labels={{
        region: t('region'),
        lanesLabel: t('lanes.label'),
        lanesAll: t('lanes.all'),
        soundUnmute: t('sound.unmute'),
        soundMute: t('sound.mute'),
        play: t('play'),
        pause: t('pause'),
        previous: t('previous'),
        next: t('next'),
        position: t.raw('position'),
        railAuthor: t.raw('rail.author'),
        captionMore: tf('caption.more'),
        captionLess: t('caption.less'),
        like: tf('actions.like'),
        unlike: tf('actions.unlike'),
        comment: tf('actions.comment'),
        share: tf('actions.share'),
        likes: { one: tf.raw('meta.likes.one'), other: tf.raw('meta.likes.other') },
        emptyTitle: t('empty.title'),
        emptyBody: t('empty.body', { tenant: tenantName }),
        emptyCta: tf('empty.cta'),
        errorLoad: t('errors.load'),
        errorRetry: t('errors.retry'),
        errorPlayback: t('errors.playback'),
        errorLoadMore: t('errors.loadMore'),
        generic: tf('errors.generic'),
        copied: tf('share.copied'),
        communityLocked: tf('errors.communityLocked'),
      }}
    />
  );
}
