import { STORY_PERMISSIONS } from '@tria/module-stories/contracts';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import { StoryViewerHost } from '@/components/stories/StoryViewerHost';
import { requireBootstrap } from '@/lib/bootstrap';
import { storyCommentsProps } from '@/lib/registry';
import { loadStory } from '@/lib/stories';
import { storyGroupView, storyViewerItem, storyViewerLabels } from '@/lib/story-view';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/stories/[storyId]` (STORY-02) — the story viewer as a REAL route, and surface 2 of the five the
 * design prototype does not have.
 *
 * **The modal-plus-deep-link behaviour, and the convention chosen.** The requirement is two things
 * at once: opening a circle on `/inicio` must feel like a layer over the feed that the back gesture
 * dismisses, and this same URL — shared, refreshed, or opened cold from a notification — must
 * resolve to a full page. The mechanism is NOT Next's intercepting-route convention. It is the
 * native History API, which Next 16 supports directly: `components/stories/StoriesSurface.tsx`
 * calls `window.history.pushState` when a circle is tapped, which updates the URL and syncs the
 * router WITHOUT rendering another route, so `/inicio` stays mounted underneath and `popstate` is
 * the single dismissal path for both the back button and the swipe-down gesture. THIS file is what
 * a cold load of the same URL renders.
 *
 * That choice over `@modal` parallel slots plus `(.)stories/[storyId]`: interception would buy the
 * identical two behaviours at the cost of a parallel slot and a `default.tsx` in the app-group
 * layout — a second render path through the shell for every route in the group — and it would
 * still need the strip's ordered sequence to be re-fetched, because an intercepted route renders
 * on the server with no access to what the strip already had.
 *
 * **A deep link is a SINGLE-STORY sequence, deliberately.** It opens what the link names and closes
 * when it ends, rather than silently enrolling the member in whatever else happens to be live. The
 * strip is the only place a multi-story sequence comes from, and it hands its own ordered array in.
 *
 * **Every miss is ONE screen** (UI-D-16, T-05-35). An unknown id, another tenant's story and a
 * soft-deleted one all arrive as `loadStory`'s single `not-found`, because the API answers one
 * indistinguishable bare 404 for all three. An EXPIRED story still resolves: the strip is what
 * filters, this read never does (05-08's pins depend on it).
 *
 * **There is no public render path.** The route lives inside the `(app)` group, so `proxy.ts`
 * bounces a session-less visitor to `/entrar` before this file runs, and it reads the session and
 * the host headers at request time — which is what keeps it OUT of the static route list
 * (`scripts/check-static-routes.sh`). `redirect()` and `notFound()` both throw in Next 16, so both
 * sit outside any try/catch.
 */
export default async function StoryPage({ params }: { params: Promise<{ storyId: string }> }) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const { storyId } = await params;
  const [tf, tfeed, locale, bootstrap, result] = await Promise.all([
    getTranslations('stories'),
    // D-82: the sheet's copy is the FEED's, verbatim — Phase 5 adds only the refusal sentences.
    getTranslations('feed'),
    getLocale(),
    requireBootstrap(),
    loadStory(storyId),
  ]);

  // A transport failure is NOT dressed up as "this story is gone": on a full-screen surface with
  // no chrome of its own there is nowhere to put a retry, so the member goes back to the screen
  // the story lives on and the strip decides what is still there.
  if (result.status !== 'ok') {
    if (result.status === 'error') redirect('/inicio');
    notFound();
  }

  const now = Date.now();

  return (
    <StoryViewerHost
      // ONE group holding the one story the link names, headed by the tenant (V1's single
      // publisher; see the note in `StoryViewerHost`): it closes when that story ends.
      groups={[
        storyGroupView(
          {
            displayName: bootstrap.tenant.displayName,
            logoUrl: bootstrap.tenant.branding.logoUrl,
          },
          storyViewerItem(result.story, now),
        ),
      ]}
      labels={storyViewerLabels(tf)}
      onLike={likeStoryAction}
      onUnlike={unlikeStoryAction}
      // The deep link is a single-story sequence, and it gets the SAME comment surface the strip's
      // viewer does: a shared link to a story must be a place a member can join the conversation,
      // not a read-only version of it.
      comments={storyCommentsProps(locale, tfeed, tf, bootstrap)}
      // UI-D-66: a curator can put ANY story into a highlight, the deep link's included. A
      // permission, never a role; the API's own `requirePermission` is the boundary.
      canCurate={bootstrap.permissions.includes(STORY_PERMISSIONS.manage)}
      closeHref="/inicio"
    />
  );
}
