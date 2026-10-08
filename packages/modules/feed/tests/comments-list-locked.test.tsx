// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentItemLabels, CommentView } from '../ui/CommentItem';
import { CommentsList, type CommentsListLabels, type CommentsListProps } from '../ui/CommentsList';

/**
 * 08.2-09 (UI-D-376): a comment action the API refused with `community_locked` (the viewer lost
 * access to the post's community mid-session) is handled like any failure by the list — revert,
 * inline error, draft kept — and is ALSO reported to the host once through `onLocked`, which closes
 * the sheet, toasts and refreshes. A plain failure never reports it.
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

function list(overrides: Partial<CommentsListProps> = {}) {
  return render(
    <ToastProvider>
      <CommentsList
        targetId="p1"
        initialItems={[comment({ canDelete: false, removal: undefined })]}
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

describe('CommentsList — community_locked is reported to the host (UI-D-376)', () => {
  it('1. a first page refused with community_locked shows the inline error and calls onLocked once', async () => {
    const onLocked = vi.fn();
    list({
      initialItems: undefined,
      onLoadComments: vi.fn().mockResolvedValue({ ok: false, code: 'community_locked' }),
      onLocked,
    });
    await waitFor(() => expect(screen.getByText('error-label')).toBeInTheDocument());
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it('2. a plain failure never calls onLocked', async () => {
    const onLocked = vi.fn();
    list({
      initialItems: undefined,
      onLoadComments: vi.fn().mockResolvedValue({ ok: false }),
      onLocked,
    });
    await waitFor(() => expect(screen.getByText('error-label')).toBeInTheDocument());
    expect(onLocked).not.toHaveBeenCalled();
  });

  it('3. a refused comment like reverts the row and calls onLocked', async () => {
    const onLocked = vi.fn();
    const onLikeComment = vi.fn().mockResolvedValue({ ok: false, code: 'community_locked' });
    list({ onLikeComment, onLocked });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'like-label' }));
    });
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1));
    expect(onLikeComment).toHaveBeenCalledWith('c1');
    // Reverted: the control is the "like" one again, not "unlike".
    expect(screen.getByRole('button', { name: 'like-label' })).toBeInTheDocument();
  });

  it('4. a refused new comment keeps the draft, shows the inline error and calls onLocked', async () => {
    const onLocked = vi.fn();
    const onCreateComment = vi.fn().mockResolvedValue({ ok: false, code: 'community_locked' });
    list({ onCreateComment, onLocked });
    const field = screen.getByPlaceholderText('placeholder-label');
    fireEvent.change(field, { target: { value: 'my draft' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'submit-label' }));
    });
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1));
    expect(screen.getByText('submit-error-label')).toBeInTheDocument();
    expect((screen.getByPlaceholderText('placeholder-label') as HTMLTextAreaElement).value).toBe(
      'my draft',
    );
  });
});
