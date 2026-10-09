// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentView } from '../ui/CommentItem';
import type { CommentsListLabels } from '../ui/CommentsList';
import { FeedList, type FeedListProps, type PostCardOverride } from '../ui/FeedList';
import { PostCard, type PostCardLabels, type PostCardView } from '../ui/PostCard';
import { usePostVideoGestures } from '../ui/PostMedia';

/**
 * 2026-10-09 — one tap on a feed video opens Reels at it, and what the member does there comes back
 * to the card.
 *
 *  - The card binds the host's `onOpenVideo` to ITS post id and hands the injected player a plain
 *    `onOpen` (the module names no destination); a read-only sample hands none.
 *  - `FeedList` passes the open to every card and applies `itemOverrides` over the items: the like
 *    pair and the comment count, ABSOLUTE. A new revision re-seeds the card's like even to the pair
 *    it started from (its own optimistic state may have moved away from it).
 *
 * The player is a stand-in that calls the gestures it is handed; strings are sentinel ASCII.
 */

/**
 * `motion/react`, replaced by plain elements (happy-dom's `Animation.cancel()` rejects a promise
 * motion never catches), one cached component per tag, as the sibling sheet suites do: the comment
 * sheet's panel must not remount on every host render.
 */
vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'layout',
    'drag',
    'dragConstraints',
    'dragElastic',
    'onDragEnd',
  ]);
  const cache = new Map<string, unknown>();
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        const cached = cache.get(tag);
        if (cached) return cached;
        const component = forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        });
        cache.set(tag, component);
        return component;
      },
    },
  );
  return {
    motion: proxy,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useReducedMotion: () => true,
  };
});

afterEach(cleanup);

const LABELS: PostCardLabels = {
  more: 'more-label',
  like: 'like-label',
  unlike: 'unlike-label',
  comment: 'comment-label',
  share: 'share-label',
  moreOptions: 'more-options-label',
  likes: { one: '{count}-like', other: '{count}-likes' },
  comments: { one: '{count}-comment', other: '{count}-comments' },
  edited: 'edited-label',
  media: { carousel: 'carousel-label', attachmentError: 'attachment-error' },
};

/** The injected player: a button that calls the card's open. */
function Player() {
  const { onOpen } = usePostVideoGestures();
  return (
    <button type="button" onClick={() => onOpen?.()} disabled={!onOpen}>
      player-open
    </button>
  );
}

function post(n: number, overrides: Partial<PostCardView> = {}): PostCardView {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    caption: `caption-${n}`,
    author: { displayName: `author-${n}`, profileHref: `/membros/m${n}`, avatarUrl: null },
    createdAtIso: '2026-10-09T10:00:00.000Z',
    createdAtRelative: 'relative-time',
    createdAtAbsolute: 'absolute-time',
    community: null,
    shareUrl: null,
    edited: false,
    canManage: false,
    editHref: null,
    likeCount: 4,
    commentCount: 2,
    viewerLiked: false,
    ariaLabel: `post-${n}`,
    media: { mediaKind: 'video', images: [], attachments: [], video: <Player /> },
    ...overrides,
  };
}

const ok = async () => ({ ok: true as const, liked: true, likeCount: 5 });

function show(node: ReactElement) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

describe('PostCard — one tap on the video opens it, bound to the post', () => {
  it('the player’s open calls onOpenVideo with THIS post’s id', () => {
    const onOpenVideo = vi.fn();
    show(
      <PostCard
        post={post(1)}
        captionTruncateAt={200}
        locale="pt-BR"
        labels={LABELS}
        onLike={ok}
        onUnlike={ok}
        onOpenVideo={onOpenVideo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'player-open' }));
    expect(onOpenVideo).toHaveBeenCalledTimes(1);
    expect(onOpenVideo).toHaveBeenCalledWith(post(1).id);
  });

  it('without onOpenVideo, and on a read-only sample, the player gets no open', () => {
    const { unmount } = show(
      <PostCard
        post={post(1)}
        captionTruncateAt={200}
        locale="pt-BR"
        labels={LABELS}
        onLike={ok}
        onUnlike={ok}
      />,
    );
    expect(screen.getByRole('button', { name: 'player-open' })).toBeDisabled();
    unmount();

    show(
      <PostCard
        post={post(1)}
        readOnly
        captionTruncateAt={200}
        locale="pt-BR"
        labels={LABELS}
        onLike={ok}
        onUnlike={ok}
        onOpenVideo={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'player-open' })).toBeDisabled();
  });

  it('the card carries its post id, so a host can find it again', () => {
    show(
      <PostCard
        post={post(3)}
        captionTruncateAt={200}
        locale="pt-BR"
        labels={LABELS}
        onLike={ok}
        onUnlike={ok}
      />,
    );
    expect(screen.getByRole('article', { name: 'post-3' })).toHaveAttribute(
      'data-post-id',
      post(3).id,
    );
  });
});

function listProps(overrides: Partial<FeedListProps> = {}): FeedListProps {
  return {
    initialItems: [post(1), post(2)],
    initialCursor: null,
    canPost: false,
    captionTruncateAt: 200,
    locale: 'pt-BR',
    labels: {
      region: 'region-label',
      more: 'more-label',
      carousel: 'carousel-label',
      attachmentError: 'attachment-error',
      like: 'like-label',
      unlike: 'unlike-label',
      comment: 'comment-label',
      share: 'share-label',
      moreOptions: 'more-options-label',
      likes: LABELS.likes,
      comments: LABELS.comments,
      edited: 'edited-label',
      emptyTitle: 'empty-title',
      emptyBody: 'empty-body',
      emptyBodyAuthor: 'empty-body-author',
      emptyCta: 'empty-cta',
      errorTitle: 'error-title',
      errorBody: 'error-body',
      errorRetry: 'error-retry',
      loadMoreError: 'load-more-error',
      loadMoreRetry: 'load-more-retry',
      createCta: 'create-cta',
      createFab: 'create-fab',
      genericError: 'generic-error',
    },
    onLoadMore: vi.fn(async () => ({ ok: false as const })),
    onRefresh: vi.fn(async () => ({ ok: false as const })),
    onLike: ok,
    onUnlike: ok,
    ...overrides,
  };
}

function card(n: number): HTMLElement {
  return screen.getByRole('article', { name: `post-${n}` });
}

function heart(n: number): HTMLElement {
  const node = card(n).querySelector<HTMLElement>('[data-like-state]');
  if (!node) throw new Error(`card ${n} has no heart`);
  return node;
}

function override(revision: number, values: Partial<PostCardOverride> = {}): PostCardOverride {
  return { viewerLiked: false, likeCount: 4, commentCount: 2, revision, ...values };
}

describe('FeedList — the open and the overrides (2026-10-09)', () => {
  it('every card’s player opens with its own post id', () => {
    const onOpenVideo = vi.fn();
    show(<FeedList {...listProps({ onOpenVideo })} />);
    const players = screen.getAllByRole('button', { name: 'player-open' });
    fireEvent.click(players[1] as HTMLElement);
    expect(onOpenVideo).toHaveBeenCalledWith(post(2).id);
  });

  it('an override replaces the like pair and the comment count of its post only', () => {
    show(
      <FeedList
        {...listProps({
          itemOverrides: {
            [post(2).id]: override(1, { viewerLiked: true, likeCount: 9, commentCount: 7 }),
          },
        })}
      />,
    );
    expect(heart(2)).toHaveAttribute('data-like-state', 'liked');
    expect(card(2)).toHaveTextContent('9-likes');
    expect(card(2)).toHaveTextContent('7-comments');
    expect(heart(1)).toHaveAttribute('data-like-state', 'unliked');
    expect(card(1)).toHaveTextContent('4-likes');
  });

  it('a new revision re-seeds a card whose own like moved, even to the pair it started from', async () => {
    const props = listProps();
    const { rerender } = show(<FeedList {...props} />);

    // The member likes on the card: its optimistic engine moves away from the server's pair.
    await act(async () => {
      fireEvent.click(heart(1));
    });
    expect(heart(1)).toHaveAttribute('data-like-state', 'liked');

    // Reels reports the post UNLIKED, at 4: exactly the pair the card was seeded with.
    rerender(
      <ToastProvider>
        <FeedList {...props} itemOverrides={{ [post(1).id]: override(1) }} />
      </ToastProvider>,
    );
    expect(heart(1)).toHaveAttribute('data-like-state', 'unliked');
    expect(card(1)).toHaveTextContent('4-likes');
  });

  it('a report drops the comment delta the list counted before it, and later ones count from it', async () => {
    const props = listProps({
      comments: {
        title: 'sheet-title',
        locale: 'pt-BR',
        viewer: { displayName: 'viewer-name', profileHref: null, avatarUrl: null },
        labels: COMMENT_LABELS,
        onLoadComments: vi
          .fn()
          .mockResolvedValue({ ok: true, items: [comment('c1'), comment('c2')], nextCursor: null }),
        onLoadReplies: vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null }),
        onCreateComment: vi.fn().mockResolvedValue({ ok: false }),
        onDeleteComment: vi.fn().mockResolvedValue({ ok: true }),
        onLikeComment: vi.fn().mockResolvedValue({ ok: true, liked: true, likeCount: 1 }),
        onUnlikeComment: vi.fn().mockResolvedValue({ ok: true, liked: false, likeCount: 0 }),
      },
    });
    const { rerender } = show(<FeedList {...props} />);

    // The feed's own sheet: one comment deleted, so the card counts 2 − 1.
    await deleteFromSheet('c1');
    await waitFor(() => expect(meta(1)).toHaveTextContent('1-comment'));

    // Reels reports 5 (its read already counts that delete): 5, never 5 − 1.
    rerender(
      <ToastProvider>
        <FeedList {...props} itemOverrides={{ [post(1).id]: override(1, { commentCount: 5 }) }} />
      </ToastProvider>,
    );
    expect(meta(1)).toHaveTextContent('5-comments');

    // A delete after the report counts from it.
    await deleteFromSheet('c2');
    await waitFor(() => expect(meta(1)).toHaveTextContent('4-comments'));
  });
});

const COMMENT_LABELS: CommentsListLabels = {
  region: 'comments-region',
  emptyLabel: 'empty-label',
  errorLabel: 'error-label',
  errorRepliesLabel: 'error-replies-label',
  retryLabel: 'retry-label',
  submitErrorLabel: 'submit-error-label',
  replyDepthErrorLabel: 'reply-depth-error-label',
  storyNoReplyErrorLabel: 'story-no-reply-error-label',
  loadMoreLabel: 'load-more-label',
  loadMoreRepliesLabel: 'load-more-replies-label',
  showReplies: { one: 'show-{count}-reply', other: 'show-{count}-replies' },
  hideReplies: { one: 'hide-{count}-reply', other: 'hide-{count}-replies' },
  replyChip: 'replying-to-{name}',
  replyChipDismiss: 'reply-chip-dismiss',
  placeholder: 'placeholder-label',
  submitLabel: 'submit-label',
  viewerLabel: 'viewer-label',
  nowLabel: 'now-label',
  deleteTitle: 'delete-title',
  deleteBody: 'delete-body',
  deleteConfirm: 'delete-confirm',
  deleteCancel: 'delete-cancel',
  item: {
    removedAuthor: 'removed-author-label',
    like: 'comment-like-label',
    unlike: 'comment-unlike-label',
    likes: { one: '{count}-comment-like', other: '{count}-comment-likes' },
    reply: 'reply-label',
    delete: 'delete-label',
  },
};

function comment(id: string): CommentView {
  return {
    id,
    body: `body-${id}`,
    author: { displayName: `author-${id}`, profileHref: `/membros/${id}`, avatarUrl: null },
    authorRemoved: false,
    createdAtIso: '2026-10-09T00:00:00.000Z',
    createdAtRelative: 'relative-time',
    createdAtAbsolute: 'absolute-time',
    likeCount: 0,
    viewerLiked: false,
    replyCount: 0,
    isReply: false,
    canDelete: true,
  };
}

/** Card `n`'s meta row (its counts), where the comment count is read. */
function meta(n: number): HTMLElement {
  const node = card(n).querySelector<HTMLElement>('[data-post-meta]');
  if (!node) throw new Error(`card ${n} has no meta row`);
  return node;
}

/** Opens the list's sheet on card 1, deletes comment `id` through its confirmation, and closes it. */
async function deleteFromSheet(id: string) {
  fireEvent.click(within(card(1)).getByRole('button', { name: 'comment-label' }));
  await act(async () => {});
  const sheet = screen.getByRole('dialog', { name: 'sheet-title' });
  const trash = sheet.querySelector<HTMLElement>(
    `article[data-comment-id="${id}"] [data-comment-delete]`,
  );
  if (!trash) throw new Error(`comment ${id} offers no delete`);
  fireEvent.click(trash);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'delete-confirm' }));
  });
  await act(async () => {
    fireEvent.keyDown(sheet, { key: 'Escape' });
  });
}
