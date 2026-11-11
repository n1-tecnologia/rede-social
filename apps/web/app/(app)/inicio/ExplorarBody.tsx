import type { Bootstrap } from '@rede-social/contracts';
import type { StoryAuthorsPage } from '@rede-social/module-stories/contracts';
import { StoriesStrip } from '@rede-social/module-stories/ui';
import { buttonClasses, EmptyState } from '@rede-social/ui';
import { UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import { withAuthorInstagrams } from '@/lib/author-instagram';
import { ownsActiveCommunity } from '@/lib/communities';
import { loadFeed } from '@/lib/feed';
import { buildFeedSurface, storyCommentsProps } from '@/lib/registry';
import { loadStoryAuthors } from '@/lib/stories';
import {
  authorRowLabels,
  explorarStoriesRowKind,
  memberStoriesRow,
  moderatorStoriesRow,
  storyPublishDoorFor,
  storyViewerLabels,
} from '@/lib/story-view';
import { primaryHostOrigin } from '@/lib/tenant-host';
import { ExplorarStoriesRow } from './ExplorarStoriesRow';

/** The action of the two member empty states: the directory (D-466), an OUTLINE button on purpose. */
const FIND_LINK = buttonClasses({ variant: 'outline', size: 'md' });

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * The three Explorar empty states, ONE component (UI-D-494, EXPL-04), chosen HERE on the server:
 *
 *  - (a) a member who follows nobody and has no post: `UserPlus`, "Siga pessoas para ver o que elas
 *    publicam", the body with the tenant name and the "Encontrar pessoas" action;
 *  - (b) a member who follows people who have not posted (and has no post): `Users`, "Ainda não há
 *    publicações", the same action;
 *  - (c) a moderator and no member post: `Users`, "Nenhuma publicação de membros", NO action (a
 *    moderator is outside the follow graph, D-467).
 *
 * The choice reads the page's `followsAnyone` (the API decides it on an empty first page and sends it
 * only to a non-moderator) and the viewer's composed permissions, never a role: the client infers
 * nothing. The action is an outline button because the composer FAB is already this screen's single
 * brand fill (UI-D-494). `null` when the viewer is neither (the list then keeps its built-in card).
 */
function exploreEmpty(
  t: Translator,
  tenantName: string,
  permissions: readonly string[],
  followsAnyone: boolean | undefined,
): ReactNode {
  if (permissions.includes('social.participate')) {
    const none = followsAnyone === false;
    const key = none ? 'social.explore.emptyNone' : 'social.explore.emptyQuiet';
    return (
      <EmptyState
        variant="card"
        icon={none ? UserPlus : Users}
        title={t(`${key}.title`)}
        body={t(`${key}.body`, { tenant: tenantName })}
        action={
          <Link href="/membros" className={FIND_LINK}>
            {t(`${key}.cta`)}
          </Link>
        }
      />
    );
  }
  if (permissions.includes('moderation.manage')) {
    return (
      <EmptyState
        variant="card"
        icon={Users}
        title={t('social.explore.emptyStaff.title')}
        body={t('social.explore.emptyStaff.body')}
      />
    );
  }
  return null;
}

/**
 * The story row's own section (10-12, UI-D-697..UI-D-700). It composes on the server from ONE read of
 * the authors route that `ExplorarBody` started before it awaited the feed, so the row never delays
 * the posts and the posts never delay the row: the chips and the feed render at once and the row
 * swaps its three skeleton circles for the real ones.
 *
 * **The row is never the reason Explorar errors** (UI-D-700): a failed read (`page` is `null`) leaves
 * a member the own circle alone as the publish door (the "+" badge, an anchor, no viewer) and a
 * moderator nothing; the failure was logged by `loadStoryAuthors`. A moderator with nothing to show
 * gets no node and no reserved height.
 */
async function StoriesRowSection({
  bootstrap,
  kind,
  pending,
}: {
  bootstrap: Bootstrap;
  kind: 'member' | 'moderator';
  pending: Promise<StoryAuthorsPage | null>;
}) {
  const [page, tf, tfeed, tmod, t, locale, shareOrigin, ownsCommunity] = await Promise.all([
    pending,
    getTranslations('stories'),
    // D-82: the sheet's own copy is the FEED's, read from the feed namespace.
    getTranslations('feed'),
    getTranslations('moderation'),
    getTranslations(),
    getLocale(),
    primaryHostOrigin(),
    kind === 'member' ? ownsActiveCommunity(bootstrap.modules) : Promise.resolve(false),
  ]);
  const labels = authorRowLabels(tf);
  const member = kind === 'member';
  // The moderator's row is paged (it carries the next cursor); the member's is one page.
  const moderator = member ? null : moderatorStoriesRow(page, labels);
  const row =
    moderator ??
    memberStoriesRow(
      {
        ownAvatarUrl: bootstrap.membership.profile.avatarUrl,
        page,
        canPublish: storyPublishDoorFor('explorar', bootstrap.permissions),
      },
      labels,
    );
  if (row.circles.length === 0) return null;
  return (
    <ExplorarStoriesRow
      circles={row.circles}
      groups={row.groups}
      regionLabel={member ? t('social.stories.region') : t('social.stories.regionStaff')}
      scrollLabels={{ previous: tf('scroll.previous'), next: tf('scroll.next') }}
      viewer={{
        labels: storyViewerLabels(tf),
        onLike: likeStoryAction,
        onUnlike: unlikeStoryAction,
        comments: storyCommentsProps(locale, tfeed, tf, bootstrap, tmod),
        authorRing: { seen: labels.author, unseen: labels.authorUnseen },
        // UI-D-701: who gets "Mais opções" on a member group. The moderator's is a PERMISSION
        // (`moderation.manage`), never a role; "Destacar" is the author's, and only with an active
        // community of their own. The API is the control on every write (UI-D-710).
        memberMenu: {
          canModerate: bootstrap.permissions.includes('moderation.manage'),
          canHighlight: ownsCommunity,
        },
        ...(shareOrigin === null
          ? {}
          : { share: { origin: shareOrigin, title: bootstrap.tenant.displayName } }),
      }}
      paging={
        moderator
          ? {
              nextCursor: moderator.nextCursor,
              labels,
              retry: { label: tf('row.retry'), actionLabel: tf('row.retryAction') },
            }
          : undefined
      }
    />
  );
}

/**
 * The Explorar body (D-479, UI-D-493): `/inicio?aba=explorar` is the chip row, the story row (10-12,
 * UI-D-697, only for a member or a moderator with `social` and `stories` on) and the feed, and
 * nothing else - no welcome block, no `HomeSlots` widgets, no profile nudge. The
 * feed is the SAME surface Início renders (`buildFeedSurface`, so the cards, the comment sheet, the
 * share and menu props and the Reels overlay are one implementation) fed by `scope: 'explorar'`
 * through `loadFeed`, the one fetch function the load-more and refresh actions also call.
 *
 * An unreadable first page is `null` and the surface renders the feed's own error card with
 * "Tentar novamente"; a refusal the bootstrap knows becomes a navigation inside `loadFeed`.
 */
export async function ExplorarBody({ bootstrap }: { bootstrap: Bootstrap }) {
  // The row's read starts NOW, beside the feed's, and is awaited by its own `Suspense` below.
  const rowKind = explorarStoriesRowKind(bootstrap.permissions, bootstrap.modules);
  const pendingRow = rowKind === null ? null : loadStoryAuthors();
  const [loaded, t] = await Promise.all([
    loadFeed({ scope: 'explorar' }).then(withAuthorInstagrams),
    getTranslations(),
  ]);
  const empty = exploreEmpty(
    t,
    bootstrap.tenant.displayName,
    bootstrap.permissions,
    loaded.page?.followsAnyone,
  );
  const feed = await buildFeedSurface(bootstrap, {
    scope: 'explorar',
    loaded: Promise.resolve(loaded),
    ...(empty === null ? {} : { empty }),
  });
  if (rowKind === null || pendingRow === null) return feed;
  return (
    <>
      <Suspense fallback={<StoriesStrip circles={[]} regionLabel="" loading />}>
        <StoriesRowSection bootstrap={bootstrap} kind={rowKind} pending={pendingRow} />
      </Suspense>
      {feed}
    </>
  );
}
