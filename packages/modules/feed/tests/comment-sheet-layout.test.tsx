// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentView } from '../ui/CommentItem';
import { CommentSheet, type CommentSheetProps } from '../ui/CommentSheet';
import type { CommentsListLabels } from '../ui/CommentsList';

/**
 * The comment sheet's GEOMETRY (#3) and its FOCUS on open (#4), on the shipped `BottomSheet`.
 *
 * #3: the composer was `sticky bottom-0` inside the primitive's padded scroll body. Sticky offsets
 * resolve against the scrollport contracted by its padding, so the composer sat 16px above the
 * edge, covered the last row's meta line and let rows show through a strip beneath it. The fix is
 * the UI-SPEC's own geometry: the LIST is the scrollport and the composer is a footer below it.
 * happy-dom does no layout, so what is asserted is the structure that makes the overlap impossible
 * (the e2e measures the boxes on a real phone viewport).
 *
 * #4: opening moved focus to the composer's field, the only focusable while the list loads, and on
 * a phone that is the keyboard rising over a sheet still sliding in. The sheet opens on its title.
 *
 * Sentinel ASCII strings throughout, as in the sibling list suites.
 */

/**
 * `motion/react`, replaced by plain elements (happy-dom's `Animation.cancel()` rejects a promise
 * motion never catches). ONE component per tag, cached: a component type minted per access would
 * remount the sheet's panel on every render and leave the focus trap on a detached node.
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

const comment = (id: string): CommentView => ({
  id,
  body: `body-${id}`,
  author: { displayName: `author-${id}`, profileHref: `/membros/${id}`, avatarUrl: null },
  authorRemoved: false,
  createdAtIso: '2026-09-24T00:00:00.000Z',
  createdAtRelative: 'relative-time',
  createdAtAbsolute: 'absolute-time',
  likeCount: 0,
  viewerLiked: false,
  replyCount: 0,
  isReply: false,
  canDelete: true,
});

/** Opens the sheet the way the feed does: nothing seeded, page 1 fetched on mount. */
async function openSheet(variant: CommentSheetProps['variant'] = 'sheet') {
  render(
    <CommentSheet
      open
      onClose={() => {}}
      title="sheet-title"
      variant={variant}
      targetId="post-1"
      viewer={{ displayName: 'viewer-name', profileHref: null, avatarUrl: null }}
      locale="pt-BR"
      labels={LABELS}
      onLoadComments={vi
        .fn()
        .mockResolvedValue({ ok: true, items: [comment('c1'), comment('c2')], nextCursor: null })}
      onLoadReplies={vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null })}
      onCreateComment={vi.fn().mockResolvedValue({ ok: false })}
      onDeleteComment={vi.fn().mockResolvedValue({ ok: true })}
      onLikeComment={vi.fn().mockResolvedValue({ ok: true, liked: true, likeCount: 1 })}
      onUnlikeComment={vi.fn().mockResolvedValue({ ok: true, liked: false, likeCount: 0 })}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: 'sheet-title' });
  // Before page 1 lands the composer's field is the ONLY focusable in the panel.
  expect(dialog.querySelector('[data-testid="comments-skeleton"]')).not.toBeNull();
  await act(async () => {});
  expect(dialog.querySelectorAll('article[data-comment-id]')).toHaveLength(2);
  return dialog;
}

function parts(dialog: HTMLElement) {
  const scroller = dialog.querySelector<HTMLElement>('[data-comments-scroll]');
  const composer = dialog.querySelector<HTMLElement>('[data-comment-input]');
  const list = dialog.querySelector<HTMLElement>('[data-comments-list]');
  if (!scroller || !composer || !list) throw new Error('the sheet lost one of its three parts');
  return { scroller, composer, body: list.parentElement as HTMLElement };
}

describe.each(['sheet', 'flat'] as const)(
  'CommentSheet (%s): the composer is the footer',
  (variant) => {
    it('the composer sits OUTSIDE the list scrollport, never sticky, and the rows are inside it', async () => {
      const dialog = await openSheet(variant);
      const { scroller, composer } = parts(dialog);

      expect(scroller.contains(composer)).toBe(false);
      expect(composer.className).not.toContain('sticky');
      expect(composer.classList.contains('shrink-0')).toBe(true);
      for (const name of ['min-h-0', 'flex-auto', 'overflow-y-auto', 'overscroll-contain']) {
        expect(scroller.classList.contains(name)).toBe(true);
      }
      expect(scroller.querySelectorAll('article[data-comment-id]')).toHaveLength(2);
    });

    it('the primitive body neither scrolls nor pads, and the safe area is counted once', async () => {
      const dialog = await openSheet(variant);
      const { body, composer } = parts(dialog);

      for (const name of ['overflow-y-auto', 'px-4', 'py-4']) {
        expect(body.classList.contains(name)).toBe(false);
      }
      // No negative margins cancelling a padding that is no longer there.
      expect(dialog.querySelector('[data-comments-list]')?.className).not.toMatch(/-m[xy]-4/);
      // The panel's `pb-safe` is under the footer; a second one on the composer doubled the gap.
      expect(composer.classList.contains('pb-safe')).toBe(false);
      expect(dialog.classList.contains('pb-safe')).toBe(true);
    });

    it('opens on the TITLE: the field is not focused, so the phone keyboard stays down', async () => {
      const dialog = await openSheet(variant);
      const heading = screen.getByRole('heading', { name: 'sheet-title' });

      expect(heading).toHaveFocus();
      expect(screen.getByPlaceholderText('placeholder-label')).not.toHaveFocus();
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  },
);
