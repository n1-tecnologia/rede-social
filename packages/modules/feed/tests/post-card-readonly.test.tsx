// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PostCard,
  type PostCardLabels,
  type PostCardProps,
  type PostCardView,
} from '../ui/PostCard';

/**
 * UI-D-374 (08.2-09): the read-only card a locked community shows as its sample post.
 *
 * `readOnly` REMOVES the interaction row instead of rendering it inert: no like, comment or share
 * control, no "…" menu, no double-tap like, and the meta segments (counts, time, edited) become
 * plain text — the comment count is never a button, because the comment list is refused server-side.
 * The caption, the gallery and the attachments keep rendering: the server already decided this post
 * may be read. Sentinel ASCII strings throughout, so a copy change cannot turn this file red.
 */

MotionGlobalConfig.skipAnimations = true;

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

function post(overrides: Partial<PostCardView> = {}): PostCardView {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    caption: 'sample-caption',
    author: {
      displayName: 'author-name',
      profileHref: '/membros/m1',
      avatarUrl: null,
    },
    createdAtIso: '2026-10-08T10:00:00.000Z',
    createdAtRelative: 'relative-time',
    createdAtAbsolute: 'absolute-time',
    community: null,
    shareUrl: null,
    edited: false,
    canManage: false,
    editHref: null,
    likeCount: 12,
    commentCount: 3,
    viewerLiked: false,
    ariaLabel: 'post-aria',
    media: {
      mediaKind: 'gallery',
      images: [
        {
          assetId: '00000001-0000-4000-8000-000000000001',
          variantWidths: [320, 640],
          alt: 'image-alt',
          label: '1 of 1',
          width: 1200,
          height: 800,
        },
      ],
      attachments: [
        {
          assetId: '000000a1-0000-4000-8000-000000000001',
          filename: 'material.pdf',
          typeLabel: 'PDF',
          sizeLabel: '1,2 MB',
          downloadLabel: 'download-1',
        },
      ],
    },
    ...overrides,
  };
}

function renderCard(overrides: Partial<PostCardProps> = {}) {
  const props: PostCardProps = {
    post: post(),
    captionTruncateAt: 200,
    locale: 'pt-BR',
    labels: LABELS,
    onLike: vi.fn(async () => ({ ok: true as const, liked: true, likeCount: 13 })),
    onUnlike: vi.fn(async () => ({ ok: true as const, liked: false, likeCount: 12 })),
    onOpenComments: vi.fn(),
    onShare: vi.fn(),
    onMore: vi.fn(),
    ...overrides,
  };
  render(
    <ToastProvider>
      <PostCard {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('PostCard readOnly (UI-D-374)', () => {
  it('1. renders no like, comment, share or menu control at all', () => {
    renderCard({ readOnly: true, post: post({ shareUrl: 'https://x.test/post/1' }) });
    const article = screen.getByRole('article', { name: 'post-aria' });
    expect(within(article).queryByRole('button', { name: 'like-label' })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'unlike-label' })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'comment-label' })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'share-label' })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'more-options-label' })).toBeNull();
  });

  it('2. the counts, the time and the edited marker render as plain text; the comment count is no button', () => {
    const props = renderCard({ readOnly: true, post: post({ edited: true }) });
    const meta = document.querySelector('[data-post-meta]');
    expect(meta).not.toBeNull();
    expect(meta?.hasAttribute('data-read-only')).toBe(true);
    expect(meta?.className).not.toContain('justify-end');
    for (const text of ['12-likes', '3-comments', 'relative-time', 'edited-label']) {
      const node = within(meta as HTMLElement).getByText(text);
      expect(node.tagName).toBe('SPAN');
    }
    expect(within(meta as HTMLElement).queryByRole('button')).toBeNull();
    fireEvent.click(within(meta as HTMLElement).getByText('3-comments'));
    expect(props.onOpenComments).not.toHaveBeenCalled();
  });

  it('3. with zero likes and comments only the relative time renders in the meta row', () => {
    renderCard({ readOnly: true, post: post({ likeCount: 0, commentCount: 0 }) });
    const meta = document.querySelector('[data-post-meta]') as HTMLElement;
    expect(meta.textContent).toBe('relative-time');
  });

  it('4. the caption, the gallery and the attachments still render', () => {
    renderCard({ readOnly: true });
    expect(screen.getByText('sample-caption')).toBeInTheDocument();
    expect(screen.getByTestId('post-attachments')).toBeInTheDocument();
    expect(screen.getByText('material.pdf')).toBeInTheDocument();
    expect(screen.getAllByTestId('post-gallery-slide').length).toBe(1);
  });

  it('5. a double tap on the gallery does not like the post', () => {
    const props = renderCard({ readOnly: true });
    const slide = screen.getAllByTestId('post-gallery-slide')[0] as HTMLElement;
    fireEvent.pointerUp(slide);
    fireEvent.pointerUp(slide);
    expect(props.onLike).not.toHaveBeenCalled();
  });

  it('6. without readOnly the shipped card keeps its three controls and the comment-count button', () => {
    const props = renderCard({ post: post({ shareUrl: 'https://x.test/post/1' }) });
    expect(screen.getByRole('button', { name: 'like-label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'comment-label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'share-label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'more-options-label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3-comments' })).toBeInTheDocument();
    // The control for case 5: the same double tap DOES like the shipped card.
    const slide = screen.getAllByTestId('post-gallery-slide')[0] as HTMLElement;
    fireEvent.pointerUp(slide);
    fireEvent.pointerUp(slide);
    expect(props.onLike).toHaveBeenCalledTimes(1);
  });
});
