// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentView } from '../ui/CommentItem';
import { CommentPanel } from '../ui/CommentPanel';
import type { CommentsListLabels } from '../ui/CommentsList';

/**
 * 2026-10-23 — the comments beside the desktop Reels player: the sheet's list in a panel that is not
 * modal. Its title takes the focus on open and gives it back on close; Escape closes the panel
 * alone, even inside a modal whose own Escape handler is native (the Reels overlay).
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

/** An opener, the panel, and (like the Reels overlay) a NATIVE Escape handler around them. */
function Host({ onClose, onOuterEscape }: { onClose: () => void; onOuterEscape: () => void }) {
  const [open, setOpen] = useState(false);
  const outer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = outer.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOuterEscape();
    };
    node?.addEventListener('keydown', onKeyDown);
    return () => node?.removeEventListener('keydown', onKeyDown);
  }, [onOuterEscape]);
  return (
    <div ref={outer}>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      {open ? (
        <CommentPanel
          title="panel-title"
          count="16"
          closeLabel="close-label"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          onCountChange={() => {}}
          targetId="post-1"
          viewer={{ displayName: 'viewer-name', profileHref: null, avatarUrl: null }}
          locale="pt-BR"
          labels={LABELS}
          onLoadComments={vi.fn().mockResolvedValue({
            ok: true,
            items: [comment('c1'), comment('c2')],
            nextCursor: null,
          })}
          onLoadReplies={vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null })}
          onCreateComment={vi.fn().mockResolvedValue({ ok: false })}
          onDeleteComment={vi.fn().mockResolvedValue({ ok: true })}
          onLikeComment={vi.fn().mockResolvedValue({ ok: true, liked: true, likeCount: 1 })}
          onUnlikeComment={vi.fn().mockResolvedValue({ ok: true, liked: false, likeCount: 0 })}
        />
      ) : null}
    </div>
  );
}

async function openPanel() {
  const onClose = vi.fn();
  const onOuterEscape = vi.fn();
  render(<Host onClose={onClose} onOuterEscape={onOuterEscape} />);
  const opener = screen.getByRole('button', { name: 'opener' });
  opener.focus();
  fireEvent.click(opener);
  await act(async () => {});
  return { opener, onClose, onOuterEscape };
}

describe('CommentPanel', () => {
  it('a complementary landmark named by its title, with the count, the close control and the list', async () => {
    await openPanel();
    const panel = screen.getByRole('complementary', { name: 'panel-title' });
    expect(panel).toHaveAttribute('data-comment-panel');
    expect(screen.getByRole('heading', { name: 'panel-title 16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close-label' })).toBeInTheDocument();
    expect(panel.querySelectorAll('article[data-comment-id]')).toHaveLength(2);
    expect(screen.getByPlaceholderText('placeholder-label')).toBeInTheDocument();
    // Not modal: no dialog role.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the title takes the focus on open; the close control closes and the focus returns to the opener', async () => {
    const { opener, onClose } = await openPanel();
    expect(screen.getByRole('heading', { name: 'panel-title 16' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'close-label' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Escape inside the panel closes the panel only: the native handler around it never hears it', async () => {
    const { onClose, onOuterEscape } = await openPanel();
    fireEvent.keyDown(screen.getByRole('heading', { name: 'panel-title 16' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOuterEscape).not.toHaveBeenCalled();
  });
});
