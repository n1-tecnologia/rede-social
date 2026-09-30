// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CommentView, HIGHLIGHT_HOLD_MS } from '../ui/CommentItem';
import { CommentsList, type CommentsListLabels, type CommentsListProps } from '../ui/CommentsList';

/**
 * 07-04 (UI-D-254, sketch 007 item 8) — the comment highlight a notification tap lands on.
 *
 * The post page pins the ROOT thread holding the target first; the list must (1) draw that root
 * first and never again below it, however far it pages, (2) expand the replies when the target is a
 * reply, (3) tint the target for 2,400 ms then drop the tint, (4) keep the tint under reduced motion
 * until the first gesture, and (5) never repeat a pinned reply when "Ver mais respostas" pages on.
 */

vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'drag',
    'dragConstraints',
    'dragElastic',
    'onDragEnd',
    'whileTap',
    'whileHover',
    'whileFocus',
    'layout',
    'layoutId',
  ]);
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        }),
    },
  );
  return {
    motion: proxy,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useReducedMotion: () => true,
  };
});

afterEach(cleanup);

const LABELS: CommentsListLabels = {
  region: 'region-label',
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
    like: 'like-label',
    unlike: 'unlike-label',
    likes: { one: '{count}-like', other: '{count}-likes' },
    reply: 'reply-label',
    delete: 'delete-label',
  },
};

const comment = (overrides: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  body: 'comment-body',
  author: { displayName: 'author-name', profileHref: '/membros/m1', avatarUrl: null },
  authorRemoved: false,
  createdAtIso: '2026-09-24T00:00:00.000Z',
  createdAtRelative: 'relative-time',
  createdAtAbsolute: 'absolute-time',
  likeCount: 2,
  viewerLiked: false,
  // Deliberately non-zero: in every other variant this row draws a replies toggle, so the flat
  // variant suppressing it is a real suppression rather than an absence of data.
  replyCount: 3,
  isReply: false,
  canDelete: true,
  ...overrides,
});

function list(overrides: Partial<CommentsListProps> = {}) {
  return render(
    <CommentsList
      targetId="t1"
      initialItems={[comment()]}
      initialCursor={null}
      viewer={{ displayName: 'viewer-name', profileHref: null, avatarUrl: null }}
      locale="pt-BR"
      labels={LABELS}
      onLoadComments={vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null })}
      onLoadReplies={vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null })}
      onCreateComment={vi.fn().mockResolvedValue({ ok: false })}
      onDeleteComment={vi.fn().mockResolvedValue({ ok: true })}
      onLikeComment={vi.fn().mockResolvedValue({ ok: true, liked: true, likeCount: 3 })}
      onUnlikeComment={vi.fn().mockResolvedValue({ ok: true, liked: false, likeCount: 1 })}
      {...overrides}
    />,
  );
}

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  setReducedMotion(false);
  Element.prototype.scrollIntoView = vi.fn();
});

const root = comment({ id: 'root', body: 'root-body', replyCount: 2 });
const reply1 = comment({ id: 'r1', body: 'reply-1', isReply: true, replyCount: 0 });
const target = comment({ id: 'target', body: 'target-body', isReply: true, replyCount: 0 });

const ids = (container: HTMLElement, selector = '[data-comment-kind="root"]') =>
  Array.from(container.querySelectorAll(selector)).map((node) =>
    node.getAttribute('data-comment-id'),
  );

describe('CommentsList pinned thread and highlight (07-04, UI-D-254)', () => {
  it('draws the pinned root FIRST and filters it out of the seeded page below it', () => {
    const { container } = list({
      initialItems: [comment({ id: 'a' }), root, comment({ id: 'b' })],
      pinnedThread: { root, replies: [reply1, target], repliesCursor: null },
      highlightCommentId: 'target',
    });
    expect(ids(container)).toEqual(['root', 'a', 'b']);
  });

  it('never repeats the pinned root when a later page carries it', async () => {
    const onLoadComments = vi.fn().mockResolvedValue({
      ok: true,
      items: [comment({ id: 'c' }), root, comment({ id: 'd' })],
      nextCursor: null,
    });
    const { container } = list({
      initialItems: [comment({ id: 'a' })],
      initialCursor: 'cursor-1',
      pinnedThread: { root, replies: [reply1, target], repliesCursor: null },
      highlightCommentId: 'target',
      onLoadComments,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'load-more-label' }));
    });
    expect(ids(container)).toEqual(['root', 'a', 'c', 'd']);
  });

  it('expands the replies when the target is a reply, and tints only the target', () => {
    const { container } = list({
      initialItems: [],
      pinnedThread: { root, replies: [reply1, target], repliesCursor: null },
      highlightCommentId: 'target',
    });
    expect(ids(container, '[data-comment-kind="reply"]')).toEqual(['r1', 'target']);
    const highlighted = container.querySelectorAll('[data-comment-highlighted="true"]');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toHaveAttribute('data-comment-id', 'target');
    expect(highlighted[0]).toHaveClass('rounded-xl', 'bg-brand/10');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('keeps a root target collapsed, with its replies pre-loaded (no request on expand)', () => {
    const onLoadReplies = vi.fn();
    const { container } = list({
      initialItems: [],
      pinnedThread: { root, replies: [reply1, target], repliesCursor: null },
      highlightCommentId: 'root',
      onLoadReplies,
    });
    expect(ids(container, '[data-comment-kind="reply"]')).toEqual([]);
    expect(container.querySelector('[data-comment-id="root"]')).toHaveAttribute(
      'data-comment-highlighted',
      'true',
    );
    fireEvent.click(container.querySelector('[data-replies-toggle]') as Element);
    expect(ids(container, '[data-comment-kind="reply"]')).toEqual(['r1', 'target']);
    expect(onLoadReplies).not.toHaveBeenCalled();
  });

  it('drops the tint after 2,400 ms', () => {
    vi.useFakeTimers();
    try {
      const { container } = list({
        initialItems: [],
        pinnedThread: { root, replies: [reply1, target], repliesCursor: null },
        highlightCommentId: 'target',
      });
      const row = container.querySelector('[data-comment-id="target"]');
      expect(row).toHaveClass('bg-brand/10');
      act(() => {
        vi.advanceTimersByTime(HIGHLIGHT_HOLD_MS - 1);
      });
      expect(row).toHaveClass('bg-brand/10');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(row).not.toHaveClass('bg-brand/10');
      expect(row).not.toHaveAttribute('data-comment-highlighted');
      // The geometry stays: the tint fades, the row does not jump.
      expect(row).toHaveClass('rounded-xl', 'mx-2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('under reduced motion the tint stays past 2,400 ms until the first gesture', () => {
    setReducedMotion(true);
    vi.useFakeTimers();
    try {
      const { container } = list({
        initialItems: [],
        pinnedThread: { root, replies: [reply1, target], repliesCursor: null },
        highlightCommentId: 'target',
      });
      const row = container.querySelector('[data-comment-id="target"]');
      act(() => {
        vi.advanceTimersByTime(HIGHLIGHT_HOLD_MS * 3);
      });
      expect(row).toHaveClass('bg-brand/10');
      act(() => {
        window.dispatchEvent(new Event('pointerdown'));
      });
      expect(row).not.toHaveClass('bg-brand/10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not repeat the pinned target when "Ver mais respostas" pages on', async () => {
    const onLoadReplies = vi.fn().mockResolvedValue({
      ok: true,
      items: [comment({ id: 'r2', isReply: true, replyCount: 0 }), target],
      nextCursor: null,
    });
    const { container } = list({
      initialItems: [],
      pinnedThread: { root, replies: [reply1, target], repliesCursor: 'replies-cursor' },
      highlightCommentId: 'target',
      onLoadReplies,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'load-more-replies-label' }));
    });
    expect(onLoadReplies).toHaveBeenCalledWith('root', 'replies-cursor');
    expect(ids(container, '[data-comment-kind="reply"]')).toEqual(['r1', 'target', 'r2']);
  });

  it('with no pinned thread, nothing is highlighted and nothing scrolls', () => {
    const { container } = list();
    expect(container.querySelectorAll('[data-comment-highlighted]')).toHaveLength(0);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
