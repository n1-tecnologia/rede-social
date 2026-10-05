// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentView } from '../ui/CommentItem';
import { CommentSheet } from '../ui/CommentSheet';
import type { CommentsListLabels } from '../ui/CommentsList';

/**
 * The comment sheet's FOCUS after a delete, on the shipped `BottomSheet` and `ConfirmDialog`, under
 * a host shaped like `FeedList`: an inline `onClose` arrow and a count the host re-renders on every
 * delta.
 *
 * The trap arms once per opening, so no host re-render puts a lost focus back any more. A confirmed
 * delete removes the row, its trash control included, before the `ConfirmDialog` closes, and the
 * dialog's focus return aimed at that detached control: focus fell to `<body>`, outside the
 * `aria-modal` sheet, where Escape stopped closing it and Tab walked the feed behind the backdrop.
 * The dialog now hands the focus to the sheet around it.
 *
 * Sentinel ASCII strings throughout, as in the sibling sheet suites.
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

/** `FeedList`'s shape: an inline `onClose`, and a card count moved by every delta. */
function Host({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(2);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <span data-testid="count">{count}</span>
      <CommentSheet
        open={open}
        onClose={() => {
          onCloseSpy();
          setOpen(false);
        }}
        onCountChange={(delta) => setCount((value) => value + delta)}
        title="sheet-title"
        variant="sheet"
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
      />
    </div>
  );
}

/** Opens the sheet from the host's control, as a tap does, and waits for page 1. */
async function openSheet(onCloseSpy: () => void) {
  render(<Host onCloseSpy={onCloseSpy} />);
  const opener = screen.getByRole('button', { name: 'opener' });
  opener.focus();
  fireEvent.click(opener);
  await act(async () => {});
  const sheet = screen.getByRole('dialog', { name: 'sheet-title' });
  expect(sheet.querySelectorAll('article[data-comment-id]')).toHaveLength(2);
  return { opener, sheet };
}

/** A row's trash control, focused the way Chromium focuses a clicked button, then pressed. */
function pressDelete(sheet: HTMLElement, id: string): HTMLElement {
  const trash = sheet.querySelector<HTMLElement>(
    `article[data-comment-id="${id}"] [data-comment-delete]`,
  );
  if (!trash) throw new Error(`row ${id} offers no delete`);
  trash.focus();
  fireEvent.click(trash);
  expect(screen.getByRole('dialog', { name: 'delete-title' })).toBeInTheDocument();
  return trash;
}

describe('CommentSheet: deleting a comment keeps the focus in the sheet', () => {
  it('a confirmed delete leaves the focus on the sheet, and Escape still closes it back to the opener', async () => {
    const onCloseSpy = vi.fn();
    const { opener, sheet } = await openSheet(onCloseSpy);
    const trash = pressDelete(sheet, 'c1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'delete-confirm' }));
    });
    // Server-confirmed: the row is gone, and the host re-rendered with the new count (and with
    // it a new `onClose` identity, which no longer re-arms anything).
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(screen.queryByRole('dialog', { name: 'delete-title' })).not.toBeInTheDocument();
    expect(trash).not.toBeInTheDocument();
    expect(sheet.querySelectorAll('article[data-comment-id]')).toHaveLength(1);

    // Not <body>: the sheet itself, so its own trap still owns Escape and Tab.
    expect(sheet).toHaveFocus();

    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'sheet-title' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('a cancelled delete returns the focus to the row’s own trash control', async () => {
    const { sheet } = await openSheet(vi.fn());
    const trash = pressDelete(sheet, 'c2');

    fireEvent.click(screen.getByRole('button', { name: 'delete-cancel' }));
    expect(screen.queryByRole('dialog', { name: 'delete-title' })).not.toBeInTheDocument();
    expect(trash).toHaveFocus();
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });
});
