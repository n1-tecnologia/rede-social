// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedList, type FeedListProps } from '../ui/FeedList';
import { PostActions } from '../ui/PostActions';
import {
  PostCard,
  type PostCardActions,
  type PostCardLabels,
  type PostCardProps,
  type PostCardView,
} from '../ui/PostCard';

/**
 * 11.1-14 (UI-D-888, UI-D-889, UI-D-893, A-UI-11, BPERM-21): a control the viewer's facts do not
 * allow is NOT rendered (not in the DOM, not inert, not hidden by CSS) and the rest close up from
 * the left in the shipped order. The module reads finished booleans and ships no word of its own;
 * the host decides the fact. Sentinel ASCII strings throughout.
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
    author: { displayName: 'author-name', profileHref: '/membros/m1', avatarUrl: null },
    createdAtIso: '2026-10-08T10:00:00.000Z',
    createdAtRelative: 'relative-time',
    createdAtAbsolute: 'absolute-time',
    community: null,
    shareUrl: 'https://x.test/post/1',
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
      attachments: [],
    },
    ...overrides,
  };
}

function cardProps(overrides: Partial<PostCardProps> = {}): PostCardProps {
  return {
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
}

function renderCard(overrides: Partial<PostCardProps> = {}) {
  const props = cardProps(overrides);
  const view = render(
    <ToastProvider>
      <PostCard {...props} />
    </ToastProvider>,
  );
  const rerenderCard = (next: Partial<PostCardProps>) =>
    view.rerender(
      <ToastProvider>
        <PostCard {...{ ...props, ...next }} />
      </ToastProvider>,
    );
  return { props, rerenderCard };
}

const GLYPH_NAMES = ['like-label', 'comment-label', 'share-label'] as const;
type Control = 'like' | 'comment' | 'share';
const CONTROLS: Control[] = ['like', 'comment', 'share'];
const NAME_OF: Record<Control, string> = {
  like: 'like-label',
  comment: 'comment-label',
  share: 'share-label',
};

function rowButtons(): HTMLElement[] {
  const article = screen.getByRole('article', { name: 'post-aria' });
  return GLYPH_NAMES.flatMap((name) => within(article).queryAllByRole('button', { name }));
}

/** The controls of the action row, in DOM order (the row is the `-ml-2.5` container). */
function rowOrder(): string[] {
  const row = document.querySelector('.-ml-2\\.5');
  if (!row) return [];
  return Array.from(row.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? '');
}

describe('11.1-14 Task 1 - the tracer: a card without the comment glyph', () => {
  it('1. actions {like, share} renders the heart and the send glyph, no comment glyph, 44x44, closed up', () => {
    renderCard({ actions: { like: true, comment: false, share: true } });
    expect(screen.getByRole('button', { name: 'like-label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'share-label' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'comment-label' })).toBeNull();
    expect(rowOrder()).toEqual(['like-label', 'share-label']);
    for (const button of rowButtons()) {
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('min-w-[44px]');
    }
    const row = document.querySelector('.-ml-2\\.5') as HTMLElement;
    expect(row.className).toContain('-ml-2.5');
    // The count is content and stays as text, with the comment count still the button to read.
    expect(screen.getByRole('button', { name: '3-comments' })).toBeInTheDocument();
  });

  it('1b. with `actions` absent the row is the shipped three, in the shipped order', () => {
    renderCard();
    expect(rowOrder()).toEqual(['like-label', 'comment-label', 'share-label']);
  });

  it('2. a FeedList item carrying `actions` draws the same row; an item without it draws the shipped one', () => {
    const base: FeedListProps = {
      initialItems: [
        post({
          id: 'p-restricted',
          ariaLabel: 'post-aria',
          actions: { like: true, comment: false, share: true },
        }),
        post({ id: 'p-plain', ariaLabel: 'plain-aria' }),
      ],
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
        likes: { one: '{count}-like', other: '{count}-likes' },
        comments: { one: '{count}-comment', other: '{count}-comments' },
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
      onLike: async () => ({ ok: true as const, liked: true, likeCount: 1 }),
      onUnlike: async () => ({ ok: true as const, liked: false, likeCount: 0 }),
    };
    render(
      <ToastProvider>
        <FeedList {...base} />
      </ToastProvider>,
    );
    const restricted = screen.getByRole('article', { name: 'post-aria' });
    const plain = screen.getByRole('article', { name: 'plain-aria' });
    expect(within(restricted).queryByRole('button', { name: 'comment-label' })).toBeNull();
    expect(within(restricted).getByRole('button', { name: 'like-label' })).toBeInTheDocument();
    expect(within(restricted).getByRole('button', { name: 'share-label' })).toBeInTheDocument();
    expect(within(plain).getByRole('button', { name: 'comment-label' })).toBeInTheDocument();
    expect(within(plain).getByRole('button', { name: 'like-label' })).toBeInTheDocument();
    expect(within(plain).getByRole('button', { name: 'share-label' })).toBeInTheDocument();
  });
});

describe('11.1-14 Task 2 - every subset of the three controls (UI-D-888, BPERM-21 a, b)', () => {
  const subsets: PostCardActions[] = [];
  for (const like of [true, false])
    for (const comment of [true, false])
      for (const share of [true, false]) subsets.push({ like, comment, share });

  it.each(subsets)(
    'a. like=$like comment=$comment share=$share renders exactly its controls, in order',
    (actions) => {
      renderCard({ actions });
      const expected = CONTROLS.filter((c) => actions[c]).map((c) => NAME_OF[c]);
      if (expected.length > 0) {
        expect(rowOrder()).toEqual(expected);
        // No orphan label, empty container or extra aria-label inside the row.
        const row = document.querySelector('.-ml-2\\.5') as HTMLElement;
        for (const child of Array.from(row.children)) {
          expect(child.tagName === 'BUTTON' || child.querySelector('button') !== null).toBe(true);
        }
      } else {
        // All three false: no row at all, no control by those names, no empty container.
        expect(document.querySelector('.-ml-2\\.5')).toBeNull();
        for (const name of GLYPH_NAMES) expect(screen.queryByLabelText(name)).toBeNull();
      }
      // Absent means absent: neither the DOM nor an attribute keeps a missing control.
      for (const control of CONTROLS) {
        if (!actions[control])
          expect(screen.queryByRole('button', { name: NAME_OF[control] })).toBeNull();
      }
    },
  );

  it('a. PostActions alone: `show` absent is all three; a false control is not rendered', () => {
    const base = {
      liked: false,
      countLabel: null,
      pulseKey: 0,
      onToggleLike: vi.fn(),
      labels: {
        like: 'like-label',
        unlike: 'unlike-label',
        comment: 'comment-label',
        share: 'share-label',
      },
    };
    const { rerender, container } = render(<PostActions {...base} />);
    expect(container.querySelectorAll('button').length).toBe(3);
    rerender(<PostActions {...base} show={{ like: false, comment: true, share: false }} />);
    expect(container.querySelectorAll('button').length).toBe(1);
    expect(container.querySelector('[data-like-count]')).toBeNull();
  });

  it('b. all three false: the row is absent, the meta is left-aligned plain text and the comment count opens the list', () => {
    const { props } = renderCard({ actions: { like: false, comment: false, share: false } });
    expect(document.querySelector('.-ml-2\\.5')).toBeNull();
    const meta = document.querySelector('[data-post-meta]') as HTMLElement;
    expect(meta.className).not.toContain('justify-end');
    expect(within(meta).getByText('12-likes').tagName).toBe('SPAN');
    expect(within(meta).getByText('relative-time').tagName).toBe('SPAN');
    // A count is content, not a control; the comment count is the one button of the row.
    const commentCount = within(meta).getByRole('button', { name: '3-comments' });
    fireEvent.click(commentCount);
    expect(props.onOpenComments).toHaveBeenCalledTimes(1);
    expect(within(meta).getAllByRole('button').length).toBe(1);
    // The "..." menu of a normal card stays; this is not a sample.
    expect(screen.getByRole('button', { name: 'more-options-label' })).toBeInTheDocument();
  });

  it('b. all three false and no comments: no glyph, no count button, nothing opens the sheet', () => {
    renderCard({
      actions: { like: false, comment: false, share: false },
      post: post({ commentCount: 0 }),
    });
    const meta = document.querySelector('[data-post-meta]') as HTMLElement;
    expect(within(meta).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'comment-label' })).toBeNull();
    expect(meta.textContent).toContain('12-likes');
    expect(meta.textContent).not.toContain('comment');
  });

  it('b. a buyer with no flag and a post with no comments and no likes: only the time, left-aligned', () => {
    renderCard({
      actions: { like: false, comment: false, share: false },
      post: post({ likeCount: 0, commentCount: 0 }),
    });
    const meta = document.querySelector('[data-post-meta]') as HTMLElement;
    expect(meta.textContent).toBe('relative-time');
    expect(within(meta).queryByRole('button')).toBeNull();
  });

  it('b. the sample card keeps its own rule (the comment count is never a button) even with facts', () => {
    renderCard({ readOnly: true, actions: { like: true, comment: true, share: true } });
    const meta = document.querySelector('[data-post-meta]') as HTMLElement;
    expect(within(meta).queryByRole('button')).toBeNull();
    expect(document.querySelector('.-ml-2\\.5')).toBeNull();
  });

  it('b. a partial subset keeps the meta right-aligned and the count button', () => {
    renderCard({ actions: { like: false, comment: true, share: false } });
    const meta = document.querySelector('[data-post-meta]') as HTMLElement;
    expect(meta.className).toContain('justify-end');
    expect(within(meta).getByRole('button', { name: '3-comments' })).toBeInTheDocument();
  });

  it('c. double-tap with like=false does nothing: no request and no heart burst', () => {
    const { props } = renderCard({ actions: { like: false, comment: true, share: true } });
    const slide = screen.getAllByTestId('post-gallery-slide')[0] as HTMLElement;
    fireEvent.pointerUp(slide);
    fireEvent.pointerUp(slide);
    expect(props.onLike).not.toHaveBeenCalled();
    // The heart of the row is gone with its control and no burst heart was mounted either.
    expect(document.querySelectorAll('.lucide-heart').length).toBe(0);
  });

  it('c. double-tap with like=true behaves as shipped', () => {
    const { props } = renderCard({ actions: { like: true, comment: false, share: false } });
    const slide = screen.getAllByTestId('post-gallery-slide')[0] as HTMLElement;
    fireEvent.pointerUp(slide);
    fireEvent.pointerUp(slide);
    expect(props.onLike).toHaveBeenCalledTimes(1);
    // The control case of the burst: the same double-tap mounts a heart over the media.
    expect(document.querySelectorAll('.lucide-heart').length).toBeGreaterThan(0);
  });

  it('e. a post whose fact is missing reads as all true; `post.actions` is read when the prop is absent', () => {
    renderCard({ post: post({ community: { label: 'x', href: '/c', ariaLabel: 'y' } }) });
    expect(rowOrder()).toEqual(['like-label', 'comment-label', 'share-label']);
    cleanup();
    renderCard({ post: post({ actions: { like: false, comment: true, share: true } }) });
    expect(rowOrder()).toEqual(['comment-label', 'share-label']);
    cleanup();
    // The prop wins over the view's own fact.
    renderCard({
      post: post({ actions: { like: false, comment: false, share: false } }),
      actions: { like: true, comment: true, share: true },
    });
    expect(rowOrder()).toEqual(['like-label', 'comment-label', 'share-label']);
  });

  it('e. nothing says why a control is missing: no tooltip, no title, no extra text', () => {
    renderCard({ actions: { like: false, comment: false, share: false } });
    const article = screen.getByRole('article', { name: 'post-aria' });
    // The header's own time carries the shipped title; the row under the caption carries nothing.
    const rowArea = (document.querySelector('[data-post-meta]') as HTMLElement)
      .parentElement as HTMLElement;
    expect(rowArea.querySelector('[title]')).toBeNull();
    expect(article.querySelector('[aria-disabled], [disabled]')).toBeNull();
    expect(rowArea.querySelector('[role="status"], [aria-live]')).toBeNull();
  });
});

describe('11.1-14 Task 2 - the focus rule when the focused control vanishes (UI-D-893)', () => {
  it('d. the focused comment glyph vanishes: focus moves to the nearest remaining control of the row', () => {
    const { rerenderCard } = renderCard({ actions: { like: true, comment: true, share: true } });
    act(() => screen.getByRole('button', { name: 'comment-label' }).focus());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'comment-label' }));
    rerenderCard({ actions: { like: true, comment: false, share: true } });
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(['like-label', 'share-label']).toContain(active.getAttribute('aria-label'));
    // Nothing was announced for it: no live region other than the shipped like count.
    expect(
      screen
        .getByRole('article', { name: 'post-aria' })
        .querySelectorAll('[role="status"], [role="alert"]').length,
    ).toBe(0);
  });

  it('d. the focused send glyph vanishes: focus moves to the comment glyph, its nearest neighbour', () => {
    const { rerenderCard } = renderCard({ actions: { like: true, comment: true, share: true } });
    act(() => screen.getByRole('button', { name: 'share-label' }).focus());
    rerenderCard({ actions: { like: true, comment: true, share: false } });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'comment-label' }));
  });

  it('d. the focused heart vanishes: focus moves to the comment glyph', () => {
    const { rerenderCard } = renderCard({ actions: { like: true, comment: true, share: true } });
    act(() => screen.getByRole('button', { name: 'like-label' }).focus());
    rerenderCard({ actions: { like: false, comment: true, share: true } });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'comment-label' }));
  });

  it('d. the last control of the row vanishes: focus lands on the card itself (tabindex -1), never on the body', () => {
    const { rerenderCard } = renderCard({ actions: { like: false, comment: false, share: true } });
    act(() => screen.getByRole('button', { name: 'share-label' }).focus());
    rerenderCard({ actions: { like: false, comment: false, share: false } });
    const article = screen.getByRole('article', { name: 'post-aria' });
    expect(article.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(article);
  });

  it('d. a vanishing control that did not hold focus moves no focus', () => {
    const { rerenderCard } = renderCard({ actions: { like: true, comment: true, share: true } });
    act(() => screen.getByRole('button', { name: 'like-label' }).focus());
    rerenderCard({ actions: { like: true, comment: false, share: true } });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'like-label' }));
  });

  it('d. focus that left the card for another element is not pulled back', () => {
    const { rerenderCard } = renderCard({ actions: { like: true, comment: true, share: true } });
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    act(() => screen.getByRole('button', { name: 'comment-label' }).focus());
    act(() => outside.focus());
    rerenderCard({ actions: { like: true, comment: false, share: true } });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
