// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commentSchema } from '../contracts/index';
import { CommentItem, type CommentItemLabels, type CommentView } from '../ui/CommentItem';
import { CommentsList, type CommentsListLabels, type CommentsListProps } from '../ui/CommentsList';

/**
 * 08-01 (UI-D-276, MODER-01): the moderator's removal control is the SHIPPED trash control on more
 * rows, chosen by the SERVER-derived `removal` — never by comparing ids in the client (T-04-44).
 *
 * Sentinel ASCII strings throughout; the pt-BR copy is the catalog's (`moderation.comment.*`).
 */

// `motion/react` replaced by plain elements — the `comments-list-flat` rationale (happy-dom's
// `Animation.cancel()` rejects an unhandled promise when a dialog unmounts mid-transition).
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

const ITEM_LABELS: CommentItemLabels = {
  removedAuthor: 'removed-author-label',
  like: 'like-label',
  unlike: 'unlike-label',
  likes: { one: '{count}-like', other: '{count}-likes' },
  reply: 'reply-label',
  delete: 'delete-label',
  remove: 'remove-comment-of-{author}',
};

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
  deleteBodyWithReplies: 'delete-body-with-replies',
  deleteConfirm: 'delete-confirm',
  deleteCancel: 'delete-cancel',
  moderation: {
    title: 'moderation-title',
    body: 'moderation-body-{author}',
    bodyWithReplies: 'moderation-body-with-replies-{author}',
    confirm: 'moderation-confirm',
    cancel: 'moderation-cancel',
    removedToast: 'moderation-removed-toast',
    failedToast: 'moderation-failed-toast',
    goneToast: 'moderation-gone-toast',
  },
  item: ITEM_LABELS,
};

const comment = (overrides: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  body: 'comment-body',
  author: { displayName: 'author-name', profileHref: '/membros/m1', avatarUrl: null },
  authorRemoved: false,
  createdAtIso: '2026-10-02T00:00:00.000Z',
  createdAtRelative: 'relative-time',
  createdAtAbsolute: 'absolute-time',
  likeCount: 0,
  viewerLiked: false,
  replyCount: 0,
  isReply: false,
  canDelete: true,
  removal: 'own',
  ...overrides,
});

function row(view: CommentView) {
  return render(
    <CommentItem comment={view} locale="pt-BR" labels={ITEM_LABELS} onDelete={vi.fn()} />,
  );
}

describe('CommentItem — the control follows the server-derived removal', () => {
  it('1. removal: moderation names the control for the author (the moderation label)', () => {
    row(comment({ removal: 'moderation' }));
    const control = screen.getByRole('button', { name: 'remove-comment-of-author-name' });
    expect(control).toHaveAttribute('data-comment-removal', 'moderation');
  });

  it('2. removal: own keeps the shipped own label', () => {
    row(comment({ removal: 'own' }));
    expect(screen.getByRole('button', { name: 'delete-label' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /remove-comment-of/ })).toBeNull();
  });

  it('3. removal: null draws no control at all — not a disabled one', () => {
    const { container } = row(comment({ removal: null, canDelete: false }));
    expect(container.querySelectorAll('[data-comment-delete]')).toHaveLength(0);
  });

  it('4. release order: an ABSENT removal reads as canDelete ? own : null', () => {
    const { container, unmount } = row(comment({ removal: undefined, canDelete: true }));
    expect(screen.getByRole('button', { name: 'delete-label' })).toBeTruthy();
    unmount();
    const second = row(comment({ removal: undefined, canDelete: false }));
    expect(second.container.querySelectorAll('[data-comment-delete]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-comment-delete]')).toHaveLength(0);
  });
});

function list(overrides: Partial<CommentsListProps> = {}) {
  return render(
    <ToastProvider>
      <CommentsList
        targetId="p1"
        initialItems={[]}
        initialCursor={null}
        viewer={{ displayName: 'viewer-name', profileHref: null, avatarUrl: null }}
        locale="pt-BR"
        labels={LABELS}
        onLoadComments={vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null })}
        onLoadReplies={vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null })}
        onCreateComment={vi.fn().mockResolvedValue({ ok: false })}
        onDeleteComment={vi.fn().mockResolvedValue({ ok: true })}
        onLikeComment={vi.fn().mockResolvedValue({ ok: true, liked: true, likeCount: 1 })}
        onUnlikeComment={vi.fn().mockResolvedValue({ ok: true, liked: false, likeCount: 0 })}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe('CommentsList — a moderator removes a root with its replies (D-334)', () => {
  it('5. the moderation dialog, then the row AND its loaded replies leave, the count drops by 1 + N, and the toast fires', async () => {
    const root = comment({ id: 'root', removal: 'moderation', replyCount: 2 });
    const replies = [
      comment({ id: 'r1', isReply: true, removal: 'moderation', body: 'reply-one' }),
      comment({ id: 'r2', isReply: true, removal: 'moderation', body: 'reply-two' }),
    ];
    const onDeleteComment = vi.fn().mockResolvedValue({ ok: true });
    const onCountChange = vi.fn();
    const { container } = list({
      initialItems: [root],
      onLoadReplies: vi.fn().mockResolvedValue({ ok: true, items: replies, nextCursor: null }),
      onDeleteComment,
      onCountChange,
    });

    // Load the thread so the replies are on screen.
    await act(async () => {
      fireEvent.click(screen.getByText('show-2-replies'));
    });
    expect(screen.getByText('reply-one')).toBeTruthy();
    expect(screen.getByText('reply-two')).toBeTruthy();

    // The root's own control (the first one) opens the MODERATION dialog, naming the author.
    const controls = container.querySelectorAll<HTMLButtonElement>(
      '[data-comment-id="root"] > div > div [data-comment-delete]',
    );
    expect(controls).toHaveLength(1);
    await act(async () => {
      fireEvent.click(controls[0] as HTMLButtonElement);
    });
    expect(screen.getByText('moderation-title')).toBeTruthy();
    expect(screen.getByText('moderation-body-with-replies-author-name')).toBeTruthy();
    expect(screen.queryByText('delete-title')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'moderation-confirm' }));
    });

    expect(onDeleteComment).toHaveBeenCalledWith('root');
    expect(container.querySelector('[data-comment-id="root"]')).toBeNull();
    expect(screen.queryByText('reply-one')).toBeNull();
    expect(screen.queryByText('reply-two')).toBeNull();
    expect(onCountChange).toHaveBeenCalledWith(-3);
    expect(screen.getByText('moderation-removed-toast')).toBeTruthy();
  });

  it('6. a refused removal leaves the row where it is and raises the FAILURE toast only', async () => {
    const root = comment({ id: 'root', removal: 'moderation' });
    const { container } = list({
      initialItems: [root],
      onDeleteComment: vi.fn().mockResolvedValue({ ok: false }),
    });
    await act(async () => {
      fireEvent.click(container.querySelector('[data-comment-delete]') as HTMLButtonElement);
    });
    expect(screen.getByText('moderation-body-author-name')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'moderation-confirm' }));
    });
    expect(container.querySelector('[data-comment-id="root"]')).not.toBeNull();
    expect(screen.queryByText('moderation-removed-toast')).toBeNull();
    expect(screen.getByText('moderation-failed-toast')).toBeTruthy();
  });

  it('7. the viewer’s own comment keeps the own dialog and no moderation toast', async () => {
    const { container } = list({ initialItems: [comment({ id: 'mine', removal: 'own' })] });
    await act(async () => {
      fireEvent.click(container.querySelector('[data-comment-delete]') as HTMLButtonElement);
    });
    expect(screen.getByText('delete-title')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'delete-confirm' }));
    });
    expect(container.querySelector('[data-comment-id="mine"]')).toBeNull();
    expect(screen.queryByText('moderation-removed-toast')).toBeNull();
  });
});

/** Opens the dialog on the row `id` (its OWN control, never a reply's) and returns the list. */
async function openDialogOn(container: HTMLElement, id: string) {
  const control = container.querySelector<HTMLButtonElement>(
    `[data-comment-id="${id}"] > div > div [data-comment-delete]`,
  );
  if (!control) throw new Error(`no control on ${id}`);
  await act(async () => {
    fireEvent.click(control);
  });
}

describe('08-03 — the four dialog copies (D-334, UI-D-276)', () => {
  it.each([
    ['own, no replies', { removal: 'own' as const, replyCount: 0 }, 'delete-title', 'delete-body'],
    [
      'own, with replies',
      { removal: 'own' as const, replyCount: 3 },
      'delete-title',
      'delete-body-with-replies',
    ],
    [
      'moderation, no replies',
      { removal: 'moderation' as const, replyCount: 0 },
      'moderation-title',
      'moderation-body-author-name',
    ],
    [
      'moderation, with replies',
      { removal: 'moderation' as const, replyCount: 1 },
      'moderation-title',
      'moderation-body-with-replies-author-name',
    ],
  ])('%s', async (_name, overrides, title, body) => {
    const { container } = list({ initialItems: [comment({ id: 'c1', ...overrides })] });
    await openDialogOn(container, 'c1');
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
  });

  it('a REPLY never shows the with-replies wording, own or moderation', async () => {
    const root = comment({ id: 'root', removal: null, canDelete: false, replyCount: 2 });
    const replies = [
      // A defensive replyCount on a reply: the wording must still be the without-replies one.
      comment({ id: 'r1', isReply: true, removal: 'moderation', replyCount: 4 }),
      comment({ id: 'r2', isReply: true, removal: 'own', replyCount: 4 }),
    ];
    const { container } = list({
      initialItems: [root],
      onLoadReplies: vi.fn().mockResolvedValue({ ok: true, items: replies, nextCursor: null }),
    });
    await act(async () => {
      fireEvent.click(screen.getByText('show-2-replies'));
    });
    await openDialogOn(container, 'r1');
    expect(screen.getByText('moderation-body-author-name')).toBeTruthy();
    expect(screen.queryByText(/with-replies/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'moderation-cancel' }));
    });
    await openDialogOn(container, 'r2');
    expect(screen.getByText('delete-body')).toBeTruthy();
    expect(screen.queryByText(/with-replies/)).toBeNull();
  });
});

describe('08-03 — outcomes: count arithmetic, the 404 race, the failure, focus', () => {
  it('the count drops by 1 + the SERVER reply count, not just the replies that are loaded', async () => {
    const onCountChange = vi.fn();
    const root = comment({ id: 'root', removal: 'moderation', replyCount: 30 });
    const { container } = list({
      initialItems: [root],
      // Only the first page of the thread is loaded on screen.
      onLoadReplies: vi.fn().mockResolvedValue({
        ok: true,
        items: [comment({ id: 'r1', isReply: true, removal: 'moderation', body: 'reply-one' })],
        nextCursor: 'more',
      }),
      onCountChange,
    });
    await act(async () => {
      fireEvent.click(screen.getByText('show-30-replies'));
    });
    await openDialogOn(container, 'root');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'moderation-confirm' }));
    });
    expect(onCountChange).toHaveBeenCalledWith(-31);
    expect(container.querySelector('[data-comment-id="r1"]')).toBeNull();
    expect(container.querySelector('[data-replies-of="root"]')).toBeNull();
  });

  it('a 404 race REMOVES the row, toasts "gone" and moves the count; no success toast', async () => {
    const onCountChange = vi.fn();
    const { container } = list({
      initialItems: [comment({ id: 'root', removal: 'moderation', replyCount: 2 })],
      onDeleteComment: vi.fn().mockResolvedValue({ ok: false, code: 'gone' }),
      onCountChange,
    });
    await openDialogOn(container, 'root');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'moderation-confirm' }));
    });
    expect(container.querySelector('[data-comment-id="root"]')).toBeNull();
    expect(screen.getByText('moderation-gone-toast')).toBeTruthy();
    expect(screen.queryByText('moderation-removed-toast')).toBeNull();
    expect(onCountChange).toHaveBeenCalledWith(-3);
  });

  it('a rejected action is a failure: the row stays, the count does not move, the failure toast fires', async () => {
    const onCountChange = vi.fn();
    const { container } = list({
      initialItems: [comment({ id: 'mine', removal: 'own' })],
      onDeleteComment: vi.fn().mockRejectedValue(new Error('network')),
      onCountChange,
    });
    await openDialogOn(container, 'mine');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'delete-confirm' }));
    });
    expect(container.querySelector('[data-comment-id="mine"]')).not.toBeNull();
    expect(onCountChange).not.toHaveBeenCalled();
    expect(screen.getByText('moderation-failed-toast')).toBeTruthy();
  });

  it('focus moves to the NEXT row, and to the composer once none is left; the empty copy shows', async () => {
    const { container } = list({
      initialItems: [
        comment({ id: 'a', removal: 'moderation', body: 'body-a' }),
        comment({ id: 'b', removal: 'moderation', body: 'body-b' }),
      ],
    });
    await openDialogOn(container, 'a');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'moderation-confirm' }));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(document.activeElement).toBe(container.querySelector('[data-comment-id="b"]'));

    await openDialogOn(container, 'b');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'moderation-confirm' }));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(screen.getByText('empty-label')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText('placeholder-label'));
  });
});

describe('commentSchema — release-order compatibility (production is live)', () => {
  const wire = {
    id: '6f1e3c2a-0b4d-4c8e-9a7f-1d2e3f4a5b6c',
    createdAt: '2026-10-02T12:00:00.123456Z',
    body: 'texto',
    author: { membershipId: null, displayName: null, avatarAssetId: null },
    authorRemoved: true,
    likeCount: 0,
    viewerLiked: false,
    replyCount: 0,
    isReply: false,
    canDelete: false,
  };

  it('8. a payload WITHOUT removal still parses (a pre-Phase-8 API)', () => {
    expect(commentSchema.parse(wire).removal).toBeUndefined();
  });

  it('9. a payload with removal parses, and an unknown value is refused', () => {
    expect(commentSchema.parse({ ...wire, removal: 'moderation' }).removal).toBe('moderation');
    expect(commentSchema.parse({ ...wire, removal: null }).removal).toBeNull();
    expect(commentSchema.safeParse({ ...wire, removal: 'admin' }).success).toBe(false);
  });
});
