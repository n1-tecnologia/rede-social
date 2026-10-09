// @vitest-environment happy-dom

import type { PostCardProps, PostCardView } from '@rede-social/module-feed/ui';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const { cards, overlays, loadPage, loadStart } = vi.hoisted(() => ({
  cards: [] as PostCardProps[],
  overlays: [] as ReelsOverlayProps[],
  loadPage: vi.fn(),
  loadStart: vi.fn(),
}));

vi.mock('@rede-social/module-feed/ui', () => ({
  PostCard: (props: PostCardProps) => {
    cards.push(props);
    return <div data-post-id={props.post.id} />;
  },
  CommentsList: () => null,
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: vi.fn(), dismiss: vi.fn() }),
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
