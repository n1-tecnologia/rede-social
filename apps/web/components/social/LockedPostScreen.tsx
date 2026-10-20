'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import type { PostLockedAuthor } from '@rede-social/module-feed/contracts';
import { LockedPost } from '@rede-social/module-social/ui';
import { Avatar, Card, PageHeader, Skeleton } from '@rede-social/ui';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MediaImage } from '@/components/media/MediaImage';
import { FollowControl } from './FollowControl';
import { markFocusAfterFollow } from './post-focus';

export interface LockedPostScreenProps {
  /** The ONLY thing the API sent about the post (D-469): who wrote it. */
  author: PostLockedAuthor;
  /** The id in the shared link; the screen never reads or shows anything else of the post. */
  postId: string;
  /** The header's title ("Publicação") and its back control, composed by the page. */
  title: string;
  backHref: string;
  backLabel: string;
  /** The catalog strings with the author's name already interpolated. */
  heading: string;
  body: string;
  profileLabel: string;
}

/**
 * The `/post/[postId]` screen a stranger meets at a shared link to a followers-only member post
 * (09-11, D-469, D-470, UI-D-499, UI-D-511): the header, then ONE card naming the author with the
 * brand `Seguir` button as its single action. It is handed the author and nothing else, so no caption,
 * media, count or comment can render here even by mistake (T-09-27, PR-2).
 *
 * **Following turns the same URL into the real post.** `FollowControl` flips and reconciles; on the
 * server's confirmed follow this marks the focus (`markFocusAfterFollow`) and calls `router.refresh()`
 * in a transition. The server then answers the same link with the post (this component unmounts) and
 * `PostDetail` moves focus into the post region. While the refresh is in flight the card is replaced
 * by a card-shaped skeleton of the same box (an 80px circle, a 14px bar at 45%, a 12px bar at 70%, a
 * 44px `rounded-xl` block, `aria-busy`), so the swap moves nothing unexpectedly. A refresh that now
 * answers 404 (the post was removed meanwhile) renders the standard "Publicação não encontrada".
 *
 * A failed follow keeps the card and the button (`FollowControl` toasts its fixed sentence). If the
 * refresh itself fails the card returns showing `Seguindo`, because the follow really happened.
 *
 * A `support_tenant` never reaches this screen: the API answers them the bare 404 (09-05), so there
 * is no branch for them here.
 */
export function LockedPostScreen({
  author,
  postId,
  title,
  backHref,
  backLabel,
  heading,
  body,
  profileLabel,
}: LockedPostScreenProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [followed, setFollowed] = useState(false);

  const onFollowed = () => {
    setFollowed(true);
    markFocusAfterFollow(postId);
    startRefresh(() => router.refresh());
  };

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <PageHeader
        title={title}
        backHref={backHref}
        backLabel={backLabel}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <div className="px-4 pt-6 md:px-0">
        {refreshing ? (
          <LockedPostSkeleton />
        ) : (
          <LockedPost
            heading={heading}
            body={body}
            avatar={
              <Link
                href={`/membros/${author.membershipId}`}
                aria-label={profileLabel}
                className="relative block h-20 w-20 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                {author.avatarAssetId ? (
                  <MediaImage
                    assetId={author.avatarAssetId}
                    widths={PURPOSE_WIDTHS.avatar}
                    baseWidth={256}
                    alt=""
                    sizes="80px"
                    ratio="aspect-square"
                    className="h-20 w-20 rounded-full"
                    fallback={<Avatar size="xl" alt="" />}
                  />
                ) : (
                  <Avatar size="xl" alt="" />
                )}
                <span
                  aria-hidden
                  data-lock-disc
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg-secondary"
                >
                  <Lock size={12} className="text-text-secondary" />
                </span>
              </Link>
            }
            action={
              <div className="w-full max-w-[260px]">
                <FollowControl
                  membershipId={author.membershipId}
                  name={author.displayName}
                  size="md"
                  fullWidth
                  initialFollowing={followed}
                  onFollowed={onFollowed}
                />
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

/** The card's own shape while the route refreshes (UI-D-511): same padding, gap and anchor sizes. */
function LockedPostSkeleton() {
  return (
    <Card aria-busy className="flex flex-col items-center gap-4 p-6">
      <Skeleton variant="circle" className="h-20 w-20" />
      <Skeleton variant="text" className="h-3.5 w-[45%]" />
      <Skeleton variant="text" className="h-3 w-[70%]" />
      <Skeleton variant="rect" className="h-11 w-full max-w-[260px]" />
    </Card>
  );
}
