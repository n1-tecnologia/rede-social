// @vitest-environment happy-dom

import type { PostCardLabels, PostCardView } from '@rede-social/module-feed/ui';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReelsOverlayBinding } from '../reels/ReelsOverlay';
import type { PostDetailProps } from './PostDetail';

/**
 * 11.1-14 (UI-D-889, D-889): the post detail page draws the REAL card, so the per-post fact that
 * rides on the card view governs the page too, including when the page is the notification deep
 * link (`?comentario=`, which only changes what `CommentsList` pins and never what the card draws).
 * `share` false hides the send glyph and, through the builder, the post's share url (11.1-19, D-888):
 * the "..." control then stays only for the rows the post still has (the author's own, a report).
 *
 * Stubbed: the comment list, the menu and the Reels overlay (they record nothing here).
 */

vi.mock('@rede-social/module-feed/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/module-feed/ui')>()),
  CommentsList: () => <div data-testid="comments-list" />,
  PostMenu: () => null,
}));
vi.mock('@/components/reels/ReelsOverlay', () => ({ ReelsOverlay: () => null }));
vi.mock('@/components/reels/ReelsHost', () => ({ REELS_ALL_LANE: 'all' }));
vi.mock('@/app/(app)/reels/reels-actions', () => ({
  loadReelsPageAction: vi.fn(),
  loadReelStartAction: vi.fn(),
}));
vi.mock('@/components/media/FeedVideo', () => ({ suspendFeedVideos: () => () => {} }));
vi.mock('./useSharePost', () => ({ useSharePost: () => vi.fn() }));
vi.mock('./useDeletePost', () => ({ useDeletePost: () => vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const { PostDetail } = await import('./PostDetail');

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

function view(overrides: Partial<PostCardView> = {}): PostCardView {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    caption: 'caption',
    author: { displayName: 'author', profileHref: '/membros/m1', avatarUrl: null },
    createdAtIso: '2026-10-08T10:00:00.000Z',
    createdAtRelative: 'relative-time',
    createdAtAbsolute: 'absolute-time',
    community: null,
    shareUrl: 'https://x.test/post/1',
    edited: false,
    canManage: false,
    editHref: null,
    likeCount: 4,
    commentCount: 2,
    viewerLiked: false,
    ariaLabel: 'post-aria',
    media: { mediaKind: 'none', images: [], attachments: [] },
    ...overrides,
  };
}

function show(post: PostCardView) {
  const props: PostDetailProps = {
    post,
    captionTruncateAt: 200,
    locale: 'pt-BR',
    labels: LABELS,
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
  render(
    <ToastProvider>
      <PostDetail {...props} />
    </ToastProvider>,
  );
  return within(screen.getByRole('article', { name: 'post-aria' }));
}

describe('PostDetail draws the per-post fact (11.1-14)', () => {
  it('share false: no send glyph, the heart and the comment glyph stay, the control stays for the author rows', () => {
    // The builder yields no share url for this viewer (11.1-19); the post is manageable, so the
    // "..." control stays for the author's own rows, not for a copy row.
    const card = show(
      view({
        actions: { like: true, comment: true, share: false },
        shareUrl: null,
        canManage: true,
        editHref: '/post/1/editar',
      }),
    );
    expect(card.queryByRole('button', { name: 'share-label' })).toBeNull();
    expect(card.getByRole('button', { name: 'like-label' })).toBeTruthy();
    expect(card.getByRole('button', { name: 'comment-label' })).toBeTruthy();
    expect(card.getByRole('button', { name: 'more-options-label' })).toBeTruthy();
  });

  it('the comments below the card are untouched by the fact (the deep link keeps its target)', () => {
    show(view({ actions: { like: true, comment: false, share: false } }));
    expect(screen.getByTestId('comments-list')).toBeTruthy();
  });

  it('a post without the fact draws the shipped three controls', () => {
    const card = show(view());
    for (const name of ['like-label', 'comment-label', 'share-label']) {
      expect(card.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('all three false: no row, the count of comments still opens nothing here because the comments ARE the page', () => {
    const card = show(view({ actions: { like: false, comment: false, share: false } }));
    for (const name of ['like-label', 'comment-label', 'share-label']) {
      expect(card.queryByRole('button', { name })).toBeNull();
    }
    // The detail passes no `onOpenComments`: the count stays plain text, never a dead button.
    expect(card.queryByRole('button', { name: '2-comments' })).toBeNull();
    expect(card.getByText('2-comments')).toBeTruthy();
  });
});
