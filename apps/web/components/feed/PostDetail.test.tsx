// @vitest-environment happy-dom

import type { PostCardProps, PostCardView } from '@rede-social/module-feed/ui';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markFocusAfterFollow } from '@/components/social/post-focus';
import type { ReelView } from '@/lib/reels';
import type { ReelsOverlayBinding, ReelsOverlayProps } from '../reels/ReelsOverlay';
import type { PostDetailProps } from './PostDetail';

/**
 * 2026-10-09 — on the post page one tap on the video opens Reels over the page. There is no feed
 * page to continue from, so the start is `loadReelStartAction` in "Todos" (no page read first), and
 * what the member did in Reels re-seeds the card (a revision per report) until the server reads the
 * post again.
 *
 * `PostCard`, `CommentsList`, `PostMenu` and `ReelsOverlay` are stand-ins that record their props.
 */

const { cards, overlays, loadPage, loadStart, toast, refresh, comments } = vi.hoisted(() => ({
  cards: [] as PostCardProps[],
  overlays: [] as ReelsOverlayProps[],
  loadPage: vi.fn(),
  loadStart: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() },
  refresh: vi.fn(),
  comments: [] as Array<{ onLocked?: (code?: string) => void }>,
}));

vi.mock('@rede-social/module-feed/ui', () => ({
  PostCard: (props: PostCardProps) => {
    cards.push(props);
    return <div data-post-id={props.post.id} tabIndex={-1} />;
  },
  CommentsList: (props: { onLocked?: (code?: string) => void }) => {
    comments.push(props);
    return null;
  },
  PostMenu: () => null,
}));

vi.mock('@/components/reels/ReelsOverlay', () => ({
  ReelsOverlay: (props: ReelsOverlayProps) => {
    overlays.push(props);
    return <div role="dialog" aria-label="overlay" />;
  },
}));

vi.mock('@/components/reels/ReelsHost', () => ({ REELS_ALL_LANE: 'all' }));

vi.mock('@/app/(app)/reels/reels-actions', () => ({
  loadReelsPageAction: loadPage,
  loadReelStartAction: loadStart,
}));

vi.mock('@/components/media/FeedVideo', () => ({ suspendFeedVideos: () => () => {} }));

vi.mock('./useSharePost', () => ({ useSharePost: () => vi.fn() }));
vi.mock('./useDeletePost', () => ({ useDeletePost: () => vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { PostDetail } = await import('./PostDetail');

const POST_ID = '00000000-0000-4000-8000-000000000001';

function post(): PostCardView {
  return {
    id: POST_ID,
    viewerLiked: false,
    likeCount: 4,
    commentCount: 2,
    canManage: false,
    shareUrl: null,
    editHref: null,
  } as PostCardView;
}

function detail(view: PostCardView): PostDetailProps {
  return {
    post: view,
    captionTruncateAt: 200,
    locale: 'pt-BR',
    labels: {} as PostDetailProps['labels'],
    onLike: vi.fn(),
    onUnlike: vi.fn(),
    genericErrorLabel: 'error',
    share: { title: 'tenant', copied: 'copied' },
    menu: {
      labels: {} as PostDetailProps['menu']['labels'],
      deletedLabel: 'deleted',
      removedLabel: 'removed',
      onDelete: vi.fn(),
    },
    comments: {} as PostDetailProps['comments'],
    reels: { labels: { region: 'region' }, backLabel: 'back' } as ReelsOverlayBinding,
  };
}

const card = () => {
  const last = cards.at(-1);
  if (!last) throw new Error('the card never rendered');
  return last;
};

async function flush(times = 4) {
  for (let tick = 0; tick < times; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  comments.length = 0;
  cards.length = 0;
  overlays.length = 0;
  vi.clearAllMocks();
  window.history.replaceState(null, '', `/post/${POST_ID}`);
  loadStart.mockResolvedValue({ ok: true, items: [{ id: POST_ID } as ReelView], nextCursor: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PostDetail — the post page opens Reels at its video (2026-10-09)', () => {
  it('without Reels the card gets no open', () => {
    render(<PostDetail {...detail(post())} reels={null} />);
    expect(card().onOpenVideo).toBeUndefined();
  });

  it('opens with the fallback start in Todos, never a page read', async () => {
    render(<PostDetail {...detail(post())} />);
    await act(async () => {
      card().onOpenVideo?.(POST_ID);
    });
    await flush();

    expect(loadPage).not.toHaveBeenCalled();
    expect(loadStart).toHaveBeenCalledWith(POST_ID, null);
    expect(overlays.at(-1)?.lane).toBe('all');
    expect(overlays.at(-1)?.start).toMatchObject({ status: 'ready', index: 0 });
  });

  it('a report re-seeds the card with a fresh revision; a new read of the post drops it', async () => {
    const props = detail(post());
    const { rerender } = render(<PostDetail {...props} />);
    await act(async () => {
      card().onOpenVideo?.(POST_ID);
    });
    await flush();

    await act(async () => {
      overlays.at(-1)?.onInteraction?.(POST_ID, {
        viewerLiked: true,
        likeCount: 5,
        commentCount: 3,
      });
    });
    expect(card().post).toMatchObject({
      viewerLiked: true,
      likeCount: 5,
      commentCount: 3,
      likeRevision: 1,
    });

    rerender(<PostDetail {...props} post={{ ...post(), likeCount: 6 }} />);
    expect(card().post.likeCount).toBe(6);
    expect(card().post.likeRevision).toBeUndefined();
  });
});

describe('PostDetail - focus after the "Siga para ver" follow (09-11, UI-D-499)', () => {
  it('moves focus into the post region when the locked screen marked this post', () => {
    markFocusAfterFollow(POST_ID);
    const { container } = render(<PostDetail {...detail(post())} />);
    expect(document.activeElement).toBe(container.querySelector(`[data-post-id="${POST_ID}"]`));
  });

  it('leaves focus alone when nothing was marked, or another post was', () => {
    markFocusAfterFollow('another-post');
    const { container } = render(<PostDetail {...detail(post())} />);
    expect(document.activeElement).not.toBe(container.querySelector(`[data-post-id="${POST_ID}"]`));
  });
});

/**
 * 09-11 (UI-D-500, UI-D-376): on the post page a like or a comment refused with `follow_required`
 * toasts the follow sentence (info) and refreshes the route, so the page lands on the locked screen;
 * `community_locked` keeps its own sentence; any other code is the generic error toast.
 */
describe('PostDetail - the mid-session refusals', () => {
  it('a like refused with follow_required toasts the follow sentence and refreshes once', () => {
    render(<PostDetail {...detail(post())} />);
    card().onLikeError?.('follow_required');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'info',
      message: 'feed.errors.followRequired',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the inline comment list refused with follow_required does the same', () => {
    render(<PostDetail {...detail(post())} />);
    comments.at(-1)?.onLocked?.('follow_required');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'info',
      message: 'feed.errors.followRequired',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('community_locked keeps its own sentence and refresh, from both entries', () => {
    render(<PostDetail {...detail(post())} />);
    card().onLikeError?.('community_locked');
    comments.at(-1)?.onLocked?.('community_locked');
    expect(toast.show).toHaveBeenNthCalledWith(1, {
      tone: 'info',
      message: 'feed.errors.communityLocked',
    });
    expect(toast.show).toHaveBeenNthCalledWith(2, {
      tone: 'info',
      message: 'feed.errors.communityLocked',
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('any other code is the generic error toast and no refresh', () => {
    render(<PostDetail {...detail(post())} />);
    card().onLikeError?.('generic');
    expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: 'error' });
    expect(refresh).not.toHaveBeenCalled();
  });
});
