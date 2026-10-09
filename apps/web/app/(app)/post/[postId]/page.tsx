import { FEED_CAPTION_TRUNCATE_AT } from '@rede-social/module-feed/contracts';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  deletePostAction,
  likePostAction,
  unlikePostAction,
} from '@/app/(app)/inicio/feed-actions';
import { PostDetail } from '@/components/feed/PostDetail';
import { NoticeToast } from '@/components/feedback/NoticeToast';
import { readAdminIconChoice } from '@/lib/admin-icon-cookie';
import { loadAuthorInstagrams } from '@/lib/author-instagram';
import { requireBootstrap } from '@/lib/bootstrap';
import { type CommentThreadResult, getCommentThread, loadPost, loadPostComments } from '@/lib/feed';
import { commentView, postAuthorAdminLabel, postCardView } from '@/lib/feed-view';
import {
  feedCommentsProps,
  postCardLabels,
  postMenuLabels,
  reelsOverlayProps,
} from '@/lib/registry';
import { getHostTenant, primaryHostOrigin } from '@/lib/tenant-host';

/**
 * `/post/[postId]` (D-56, FEED-07, UI-SPEC §Post page contract) — the share target, the destination
 * Phase 7's notifications will point at, and therefore a URL that is effectively permanent the
 * moment the pilot tenant's members start sending it.
 *
 * Its shape is the member profile route's, three files and all (`/membros/[membershipId]`, 03-05),
 * because that route already solves every problem this one has: the async `params`, the host-mode
 * redirect, the `Promise.all` of translations plus loads, and — the part that matters — the split
 * between "this post is not reachable" and "we could not reach the server".
 *
 * **The body is the FULL `PostCard` with `CommentsList` inline beneath it** — the identical
 * components the feed renders, at identical geometry, never a "detail variant" that would drift on
 * every later change to the card (D-56, D-59). Both are reached through `components/feed/PostDetail`
 * for one reason only: a failed like raises the generic toast, `useToast` is a hook, and a server
 * component cannot hold one. Every view, label and server action below is composed HERE, on the
 * server, and passed through that shell untouched.
 *
 * **Every miss is ONE screen** (UI-D-16). An unknown id, a post belonging to ANOTHER tenant and a
 * soft-deleted post all arrive here as `loadPost`'s single `not-found`, because the API answers one
 * indistinguishable bare 404 for all three (D-23/T-04-01) and a 400 for an id that is not a uuid.
 * `notFound()` then renders `not-found.tsx`, which says nothing about which it was. A transport or
 * 5xx failure is a DIFFERENT screen below: "we could not reach the server" must never be dressed up
 * as "this post is not in your community", nor the other way round.
 *
 * **There is no public render path.** The route lives inside the `(app)` group, so `proxy.ts`
 * bounces a session-less visitor to `/entrar` before this file runs (T-04-50), and the page reads
 * the session and the host headers at request time — which is what keeps it OUT of the static route
 * list (`scripts/check-static-routes.sh`).
 *
 * `redirect()` and `notFound()` both throw (Next 16), so both sit OUTSIDE any try/catch.
 *
 * **`?comentario={commentId}` (07-04, UI-D-254, D-232)** is where a "curtiu / respondeu ao seu
 * comentário" notification lands. Only a single lowercase uuid is read; any other value is ignored
 * in silence. The page asks the feed for the ROOT thread holding that comment and, when the thread
 * belongs to THIS post, pins it first in the list with the target scrolled to and tinted. An
 * unknown, deleted, foreign or other-post comment renders the post normally plus the info toast
 * "Este comentário não está mais disponível." (T-07-22: a thread of another post is never pinned).
 * A failed read is neither: the post renders plainly, with no toast claiming the comment is gone.
 *
 * **2026-10-09:** with Reels on (`reelsOverlayProps`), one tap on the post's video opens Reels over
 * this page, starting at that video (`PostDetail`); the return arrow closes it back onto the post.
 */
const COMMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const [{ postId }, query] = await Promise.all([params, searchParams]);
  const comentario =
    typeof query.comentario === 'string' && COMMENT_ID.test(query.comentario)
      ? query.comentario
      : null;
  const [tf, te, locale, bootstrap, shareOrigin, result, adminIcon] = await Promise.all([
    getTranslations('feed'),
    getTranslations('app.error'),
    getLocale(),
    requireBootstrap(),
    // FEED-07: `https://{primaryHost}` from the tenant's VERIFIED row. The card gets the finished
    // link as a prop; nothing in the browser ever builds one (T-04-51).
    primaryHostOrigin(),
    loadPost(postId),
    readAdminIconChoice(),
  ]);

  if (result.status === 'not-found') notFound();

  const header = (
    <PageHeader
      title={tf('post.pageTitle')}
      backHref="/inicio"
      backLabel={tf('post.back')}
      className="md:static md:px-0"
    />
  );

  if (result.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
        {header}
        {/* A card, so it keeps the page gutter on a phone (the post itself runs edge to edge). */}
        <div className="px-4 md:px-0">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            title={te('title')}
            body={te('body')}
            action={
              <a
                href={`/post/${encodeURIComponent(postId)}`}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
              >
                {te('retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }

  // The post is readable, so its comments are asked for SECOND rather than in the `Promise.all`
  // above: a miss must not pay for a comment page nobody will see, and the cross-tenant probe must
  // not cost the API a second query either.
  const [commentPage, threadResult, reels, instagrams] = await Promise.all([
    loadPostComments(result.post.id),
    comentario
      ? getCommentThread(comentario)
      : Promise.resolve<CommentThreadResult>({ status: 'error' }),
    // 2026-10-09: one tap on the post's video opens Reels over the page, when the tenant has Reels.
    reelsOverlayProps(bootstrap),
    // 2026-10-09: the author's Instagram, under the name on the card.
    loadAuthorInstagrams([result.post]),
  ]);
  const now = Date.now();
  const nowLabel = tf('comments.now');
  const toView = (comment: Parameters<typeof commentView>[0]) =>
    commentView(comment, now, nowLabel, bootstrap.tenant.timezone);

  // Pinned only when the thread is THIS post's (T-07-22); a miss or another post's comment toasts.
  const thread =
    threadResult.status === 'ok' && threadResult.thread.postId === result.post.id
      ? threadResult.thread
      : null;
  const targetMissing =
    comentario !== null &&
    (threadResult.status === 'not-found' ||
      (threadResult.status === 'ok' && threadResult.thread.postId !== result.post.id));

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
      {header}
      <PostDetail
        post={postCardView(
          result.post,
          now,
          tf,
          shareOrigin,
          bootstrap.tenant.timezone,
          postAuthorAdminLabel(bootstrap, tf),
          adminIcon,
          instagrams,
        )}
        captionTruncateAt={FEED_CAPTION_TRUNCATE_AT}
        locale={locale}
        labels={postCardLabels(tf)}
        onLike={likePostAction}
        onUnlike={unlikePostAction}
        genericErrorLabel={tf('errors.generic')}
        share={{ title: bootstrap.tenant.displayName, copied: tf('share.copied') }}
        menu={{
          labels: postMenuLabels(tf),
          deletedLabel: tf('toasts.deleted'),
          onDelete: deletePostAction,
        }}
        reels={reels}
        comments={{
          ...feedCommentsProps(locale, tf, bootstrap, await getTranslations('moderation')),
          initialItems: commentPage === null ? undefined : commentPage.items.map(toView),
          initialCursor: commentPage?.nextCursor ?? null,
          initialError: commentPage === null,
          ...(thread
            ? {
                pinnedThread: {
                  root: toView(thread.root),
                  replies: thread.replies.map(toView),
                  repliesCursor: thread.repliesCursor,
                },
                highlightCommentId: thread.targetId,
              }
            : {}),
        }}
      />
      {targetMissing ? (
        <NoticeToast message={tf('comments.targetMissing')} param="comentario" />
      ) : null}
    </div>
  );
}
