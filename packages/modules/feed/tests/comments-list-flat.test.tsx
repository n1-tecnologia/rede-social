// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentView } from '../ui/CommentItem';
import { CommentsList, type CommentsListLabels, type CommentsListProps } from '../ui/CommentsList';

/**
 * D-82 / STORY-05 — the FLAT variant of THE comment list.
 *
 * A story's comment surface is the shipped sheet rendering the shipped list with one value changed
 * on the prop it already had. The decision that produced it is worth restating, because the cheap
 * alternative is always available: a second list for stories would drift from this one on the first
 * change to the removed-author row, to the optimistic insert, or to the failure copy — on two
 * surfaces a member reads as the same feature. So the assertions below come in PAIRS: what the flat
 * variant suppresses, and the same rows in the inline variant still rendering it. Without the
 * second half, a list that had simply stopped drawing reply controls everywhere would pass.
 *
 * What the flat variant removes is exactly three affordances — the reply control, the replies
 * toggle, and the per-comment like — and it removes them because the DATABASE makes all three
 * impossible (`feed_comments_parent_fk`, `feed_likes_comment_fk`). The UI's silence is the least
 * important of the three layers and is asserted here only so a member is never invited into a
 * refusal.
 *
 * What it does NOT change: the ordering it is given, the empty copy, the error copy, the composer,
 * the removed-author row. Those are the shipped ones, verbatim (UI-SPEC E06).
 *
 * Sentinel ASCII strings throughout — a pt-BR literal appearing in the component is
 * `scripts/check-ui-literals.sh`'s job, not this file's.
 */

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

describe('CommentsList flat variant — the three affordances the database makes impossible', () => {
  it('1. renders NO reply control, on a row that would carry one in every other variant', () => {
    const { container } = list({ variant: 'flat' });
    expect(container.querySelectorAll('[data-comment-reply]')).toHaveLength(0);
  });

  it('2. renders NO replies toggle, on a row whose replyCount is 3', () => {
    const { container } = list({ variant: 'flat' });
    expect(container.querySelectorAll('[data-replies-toggle]')).toHaveLength(0);
    expect(screen.queryByText('show-3-replies')).toBeNull();
  });

  it('3. renders NO per-comment like control — not a disabled one, none at all', () => {
    const { container } = list({ variant: 'flat' });
    expect(container.querySelectorAll('[data-comment-like]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'like-label' })).toBeNull();
  });

  it('4. POSITIVE CONTROL: the SAME rows in the inline variant still render all three', () => {
    const { container } = list({ variant: 'inline' });
    expect(container.querySelectorAll('[data-comment-reply]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-replies-toggle]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-comment-like]')).toHaveLength(1);
  });
});

describe('CommentsList flat variant — what it deliberately does NOT change (UI-SPEC E06)', () => {
  it('5. the empty copy, the composer and the region label are the SHIPPED ones', () => {
    const { container } = list({ variant: 'flat', initialItems: [] });
    expect(container.querySelector('[data-comments-empty]')?.textContent).toBe('empty-label');
    expect(container.querySelector('[data-comment-input]')).not.toBeNull();
    expect(screen.getByLabelText('region-label')).toBeTruthy();
  });

  it('6. a failed load renders the inline error plus a retry, never the empty copy', () => {
    const { container } = list({ variant: 'flat', initialItems: undefined, initialError: true });
    expect(container.querySelector('[data-comments-error]')).not.toBeNull();
    expect(container.querySelector('[data-comments-empty]')).toBeNull();
    expect(screen.getByText('retry-label')).toBeTruthy();
  });

  it('7. the removed-author row is inherited verbatim — keyed on the COMMENT, not the post', () => {
    const { container } = list({
      variant: 'flat',
      initialItems: [
        comment({
          authorRemoved: true,
          author: { displayName: null, profileHref: null, avatarUrl: null },
        }),
      ],
    });
    const row = container.querySelector('[data-comment-author-removed="true"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('removed-author-label');
    expect(row?.textContent).toContain('comment-body');
    expect(row?.querySelector('a')).toBeNull();
  });
});

describe('CommentsList flat variant — D-83: the conversation runs FORWARD in time', () => {
  it('8. a new comment is APPENDED at the bottom of the flat list', async () => {
    const created = comment({ id: 'c2', body: 'novo-comentario' });
    const onCreateComment = vi.fn().mockResolvedValue({ ok: true, comment: created });
    const { container } = list({ variant: 'flat', onCreateComment });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('placeholder-label'), {
        target: { value: 'novo-comentario' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'submit-label' }));
    });

    const ids = [...container.querySelectorAll('[data-comment-id]')].map((node) =>
      node.getAttribute('data-comment-id'),
    );
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('9. POSITIVE CONTROL: the inline variant still PREPENDS, because roots rank newest first', async () => {
    const created = comment({ id: 'c2', body: 'novo-comentario' });
    const onCreateComment = vi.fn().mockResolvedValue({ ok: true, comment: created });
    const { container } = list({ variant: 'inline', onCreateComment });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('placeholder-label'), {
        target: { value: 'novo-comentario' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'submit-label' }));
    });

    const ids = [...container.querySelectorAll('[data-comment-id]')].map((node) =>
      node.getAttribute('data-comment-id'),
    );
    expect(ids).toEqual(['c2', 'c1']);
  });
});

describe('CommentsList — the refused reply has its OWN sentence', () => {
  it('10. a story no-reply refusal renders its own label, not the Phase 4 reply-depth one', async () => {
    const onCreateComment = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'story_comment_no_reply' });
    const { container } = list({ variant: 'flat', onCreateComment });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('placeholder-label'), {
        target: { value: 'tentativa' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'submit-label' }));
    });

    expect(container.querySelector('[data-comment-submit-error]')?.textContent).toBe(
      'story-no-reply-error-label',
    );
  });

  it('11. POSITIVE CONTROL: the Phase 4 reply-depth refusal still renders its own', async () => {
    const onCreateComment = vi.fn().mockResolvedValue({ ok: false, code: 'reply_depth_exceeded' });
    const { container } = list({ variant: 'inline', onCreateComment });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('placeholder-label'), {
        target: { value: 'tentativa' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'submit-label' }));
    });

    expect(container.querySelector('[data-comment-submit-error]')?.textContent).toBe(
      'reply-depth-error-label',
    );
  });
});
