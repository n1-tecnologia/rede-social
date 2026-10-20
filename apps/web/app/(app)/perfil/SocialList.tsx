'use client';

import type { SocialListItem } from '@rede-social/module-social/contracts';
import { Button, buttonClasses, Card, EmptyState } from '@rede-social/ui';
import { CircleAlert, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState, useTransition } from 'react';
import { MembersSkeleton } from '@/components/profile/MembersSkeleton';
import { MemberFollowRow } from '@/components/social/MemberFollowRow';
import { loadMoreFollowersAction, loadMoreFollowingAction } from './social-list-actions';

export interface SocialListProps {
  /** `followers`: the caller's own state toward each person; `following`: every row starts followed. */
  kind: 'followers' | 'following';
  /** The first page the SERVER rendered (the session's own rows, newest first). */
  initialItems: SocialListItem[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all. */
  initialError?: boolean;
}

/**
 * The body of "Seguidores" and "Seguindo" (09-10, D-468, UI-D-502): the caller's PRIVATE lists, one
 * component for both, with the directory's own paging (`MembersList`): 25 rows, keyset, a "Carregar
 * mais" outline button while a cursor remains, no infinite scroll, `MembersSkeleton` (8 rows) while a
 * retry reloads the page.
 *
 * **The rows** are `MemberFollowRow` (the person's link, then a sibling Seguir button), each showing
 * the caller's OWN state toward that person (`viewerFollows`). In "Seguindo" a tap unfollows and the
 * row STAYS, the button flipping to "Seguir": an undo in one tap. The row leaves on the next load,
 * because the API reads the live rows. Nothing here removes a row; a person who becomes blocked while
 * the list is open keeps their row until that next load (the plan's flagged assumption).
 *
 * **Counts are public and lists are private (D-468).** This component takes no member id and its
 * actions take only a cursor; the pages read the session's own rows. It lists no posts: a profile is
 * not a feed (D-471).
 *
 * Errors reuse the `members` catalog's generic card (shipped keys), as the directory does.
 */
export function SocialList({ kind, initialItems, initialCursor, initialError }: SocialListProps) {
  const t = useTranslations('social');
  const tm = useTranslations('members');
  const router = useRouter();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [failed, setFailed] = useState(Boolean(initialError));
  const [loadingMore, startLoadMore] = useTransition();
  const [reloading, startReload] = useTransition();

  // The server answered anew (a refresh): re-seed from its page instead of merging into the old one.
  const [renderedItems, setRenderedItems] = useState(initialItems);
  if (renderedItems !== initialItems) {
    setRenderedItems(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFailed(Boolean(initialError));
  }

  const loadMore = () => {
    if (!cursor) return;
    const from = cursor;
    startLoadMore(async () => {
      try {
        const page = await (kind === 'followers'
          ? loadMoreFollowersAction
          : loadMoreFollowingAction)(from);
        if (!page.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        // APPEND: the rows already on screen keep their order, their DOM position and their state.
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      } catch (error) {
        console.error('social.list_more_failed', { error: String(error) });
        setFailed(true);
      }
    });
  };

  const retry = () => {
    setFailed(false);
    if (cursor && items.length > 0) {
      loadMore();
      return;
    }
    startReload(() => {
      router.refresh();
    });
  };

  const errorState = (
    <EmptyState
      variant="card"
      icon={CircleAlert}
      title={tm('errors.title')}
      body={tm('errors.generic')}
      action={
        <Button variant="outline" onClick={retry}>
          {tm('errors.retry')}
        </Button>
      }
    />
  );

  let body: ReactNode;
  if (reloading) {
    body = <MembersSkeleton />;
  } else if (failed && items.length === 0) {
    body = errorState;
  } else if (items.length === 0) {
    body =
      kind === 'followers' ? (
        <EmptyState
          variant="card"
          icon={Users}
          title={t('followers.emptyTitle')}
          body={t('followers.emptyBody')}
        />
      ) : (
        <EmptyState
          variant="card"
          icon={UserPlus}
          title={t('following.emptyTitle')}
          body={t('following.emptyBody')}
          action={
            <a href="/membros" className={buttonClasses({ variant: 'outline' })}>
              {t('following.cta')}
            </a>
          }
        />
      );
  } else {
    body = (
      <>
        <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
          <ul className="flex flex-col">
            {items.map((person, index) => (
              <li
                key={person.membershipId}
                className={index === items.length - 1 ? undefined : 'border-b border-divider'}
              >
                <MemberFollowRow
                  membershipId={person.membershipId}
                  displayName={person.displayName}
                  avatarAssetId={person.avatarAssetId}
                  bio={person.bio}
                  following={person.viewerFollows}
                />
              </li>
            ))}
          </ul>
        </Card>

        {failed ? <div className="mt-4">{errorState}</div> : null}

        {!failed && cursor !== null ? (
          <div className="mt-4 px-4 md:px-0">
            <Button variant="outline" fullWidth loading={loadingMore} onClick={loadMore}>
              {loadingMore ? tm('loadingMore') : tm('loadMore')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return <div className="flex flex-col">{body}</div>;
}
