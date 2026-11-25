// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentView } from '../ui/CommentItem';
import { CommentPanel } from '../ui/CommentPanel';
import { CommentSheet } from '../ui/CommentSheet';
import { CommentsList, type CommentsListLabels, type CommentsListProps } from '../ui/CommentsList';
import { FeedList, type FeedListProps } from '../ui/FeedList';
import type { PostCardView } from '../ui/PostCard';

/**
 * 11.1-15 (D-888, UI-D-888 second bullet, UI-D-893, UI-D-895): the comment surfaces draw only the
 * controls the viewer's facts allow.
 *
 * The facts arrive as optional booleans (`canComment`, `canLikeComment`) and an optional
 * read-only empty line; ABSENT means today's behaviour, so every host that predates them renders as
 * before. A control the facts do not allow is NOT rendered (not grey, not inert), the list stays
 * fully readable, and a comment the viewer wrote keeps its own delete control, because edit and
 * delete are riders on the comment and not the community flag.
 *
 * Sentinel ASCII strings throughout: a pt-BR literal in the package is `check-ui-literals.sh`'s job.
 * Every refusal here sits beside a positive control that flips the one term back.
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
  emptyReadOnlyLabel: 'empty-read-only-label',
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
  replyCount: 0,
  isReply: false,
  canDelete: false,
  ...overrides,
});

/** Two comments: someone else's, and one the viewer wrote (it carries the delete rider). */
const TWO = [
  comment({ id: 'c1', body: 'first-body' }),
  comment({ id: 'c2', body: 'own-body', canDelete: true }),
];

function props(overrides: Partial<CommentsListProps> = {}): CommentsListProps {
  return {
    targetId: 't1',
    initialItems: TWO,
    initialCursor: null,
    viewer: { displayName: 'viewer-name', profileHref: null, avatarUrl: null },
    locale: 'pt-BR',
    labels: LABELS,
    onLoadComments: vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null }),
    onLoadReplies: vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null }),
    onCreateComment: vi.fn().mockResolvedValue({ ok: false }),
    onDeleteComment: vi.fn().mockResolvedValue({ ok: true }),
    onLikeComment: vi.fn().mockResolvedValue({ ok: true, liked: true, likeCount: 3 }),
    onUnlikeComment: vi.fn().mockResolvedValue({ ok: true, liked: false, likeCount: 1 }),
    ...overrides,
  };
}

function sheet(overrides: Partial<CommentsListProps> = {}) {
  const { variant: _variant, ...list } = props(overrides);
  return render(<CommentSheet {...list} open onClose={() => {}} title="sheet-title" />);
}

const composer = () => document.querySelector('[data-comment-input]');
const replies = () => document.querySelectorAll('[data-comment-reply]');
const hearts = () => document.querySelectorAll('[data-comment-like]');
const deletes = () => document.querySelectorAll('[data-comment-delete]');
const rows = () => document.querySelectorAll('[data-comment-id]');

describe('11.1-15 Task 1 (tracer): a comment sheet without the composer', () => {
  it('1. comment false: both comments are readable, with no composer and no Responder', () => {
    sheet({ canComment: false });
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('first-body')).toBeTruthy();
    expect(screen.getByText('own-body')).toBeTruthy();
    expect(composer()).toBeNull();
    expect(screen.queryByPlaceholderText('placeholder-label')).toBeNull();
    expect(replies()).toHaveLength(0);
    expect(screen.queryByText('reply-label')).toBeNull();
  });

  it('1b. POSITIVE CONTROL: comment true, and the fact absent, render the shipped sheet', () => {
    sheet({ canComment: true });
    expect(rows()).toHaveLength(2);
    expect(composer()).not.toBeNull();
    expect(replies()).toHaveLength(2);
    cleanup();
    sheet();
    expect(composer()).not.toBeNull();
    expect(replies()).toHaveLength(2);
    expect(hearts()).toHaveLength(2);
  });

  it('1c. the desktop panel follows the same fact, through the same list', () => {
    render(
      <CommentPanel
        {...props({ canComment: false })}
        title="panel-title"
        closeLabel="close-label"
        onClose={() => {}}
      />,
    );
    expect(rows()).toHaveLength(2);
    expect(composer()).toBeNull();
    expect(replies()).toHaveLength(0);
    cleanup();
    render(
      <CommentPanel
        {...props({ canComment: true })}
        title="panel-title"
        closeLabel="close-label"
        onClose={() => {}}
      />,
    );
    expect(composer()).not.toBeNull();
    expect(replies()).toHaveLength(2);
  });
});

describe('11.1-15 Task 1: the hearts on the comments follow like, each flag on its own', () => {
  it('2. like false: no heart on any comment, the composer and Responder stay', () => {
    sheet({ canLikeComment: false });
    expect(rows()).toHaveLength(2);
    expect(hearts()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'like-label' })).toBeNull();
    expect(composer()).not.toBeNull();
    expect(replies()).toHaveLength(2);
  });

  it('2b. like true and comment false: the hearts render and the composer does not', () => {
    sheet({ canLikeComment: true, canComment: false });
    expect(hearts()).toHaveLength(2);
    expect(composer()).toBeNull();
    expect(replies()).toHaveLength(0);
  });

  it('2c. both false: a fully readable list, with the like COUNT still text', () => {
    sheet({ canLikeComment: false, canComment: false });
    expect(rows()).toHaveLength(2);
    expect(hearts()).toHaveLength(0);
    expect(composer()).toBeNull();
    expect(replies()).toHaveLength(0);
    // A count is content, not a control (A-UI-11): the row still says how many liked it.
    expect(screen.getAllByText('2-likes')).toHaveLength(2);
  });

  it('2d. a comment the viewer wrote keeps its own delete control in every combination', () => {
    for (const [canComment, canLikeComment] of [
      [true, true],
      [false, true],
      [true, false],
      [false, false],
    ] as const) {
      sheet({ canComment, canLikeComment });
      expect(deletes()).toHaveLength(1);
      expect(deletes()[0]?.closest('[data-comment-id]')?.getAttribute('data-comment-id')).toBe(
        'c2',
      );
      cleanup();
    }
  });

  it('2e. an expanded thread draws no heart on its replies when like is false', async () => {
    const reply = comment({ id: 'r1', body: 'reply-body', isReply: true });
    const onLoadReplies = vi.fn().mockResolvedValue({ ok: true, items: [reply], nextCursor: null });
    const root = comment({ id: 'c1', replyCount: 1 });
    const { rerender } = render(
      <CommentsList
        {...props({
          initialItems: [root],
          onLoadReplies,
          canLikeComment: false,
          variant: 'inline',
        })}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('show-1-reply'));
    });
    expect(screen.getByText('reply-body')).toBeTruthy();
    expect(hearts()).toHaveLength(0);

    // POSITIVE CONTROL: the same thread with like true draws both hearts.
    rerender(
      <CommentsList
        {...props({
          initialItems: [root],
          onLoadReplies,
          canLikeComment: true,
          variant: 'inline',
        })}
      />,
    );
    expect(hearts()).toHaveLength(2);
  });

  it('2f. the facts can change while the list is open: the composer and a pending reply go', async () => {
    const view = render(<CommentsList {...props({ variant: 'inline' })} />);
    await act(async () => {
      fireEvent.click(replies()[0] as Element);
    });
    expect(screen.getByText('replying-to-author-name')).toBeTruthy();
    view.rerender(<CommentsList {...props({ variant: 'inline', canComment: false })} />);
    expect(composer()).toBeNull();
    expect(screen.queryByText('replying-to-author-name')).toBeNull();
    expect(rows()).toHaveLength(2);
  });
});

describe('11.1-15 Task 2: the empty line (UI-D-888, UI-D-895)', () => {
  const empty = (overrides: Partial<CommentsListProps> = {}) =>
    render(<CommentsList {...props({ initialItems: [], variant: 'inline', ...overrides })} />);

  it('a. a viewer who can comment keeps the shipped line, and never the read-only one', () => {
    const { container } = empty({ canComment: true });
    expect(container.querySelector('[data-comments-empty]')?.textContent).toBe('empty-label');
    expect(screen.queryByText('empty-read-only-label')).toBeNull();
  });

  it('a2. the fact absent keeps the shipped line (today)', () => {
    const { container } = empty();
    expect(container.querySelector('[data-comments-empty]')?.textContent).toBe('empty-label');
  });

  it('a3. a viewer who cannot comment reads the read-only line and never the invitation', () => {
    const { container } = empty({ canComment: false });
    expect(container.querySelector('[data-comments-empty]')?.textContent).toBe(
      'empty-read-only-label',
    );
    expect(screen.queryByText('empty-label')).toBeNull();
    expect(composer()).toBeNull();
  });

  it('a4. a host without the read-only text keeps the shipped line (absent means today)', () => {
    const { emptyReadOnlyLabel: _omitted, ...withoutIt } = LABELS;
    const { container } = empty({ canComment: false, labels: withoutIt });
    expect(container.querySelector('[data-comments-empty]')?.textContent).toBe('empty-label');
  });

  it('a5. the failed-load branch is never the empty line, whatever the facts', () => {
    const { container } = render(
      <CommentsList
        {...props({
          initialItems: undefined,
          initialError: true,
          variant: 'inline',
          canComment: false,
        })}
      />,
    );
    expect(container.querySelector('[data-comments-error]')).not.toBeNull();
    expect(container.querySelector('[data-comments-empty]')).toBeNull();
  });
});

describe('11.1-15 Task 3: a refusal reverts neutrally and asks for the facts again (UI-D-893)', () => {
  it('a refused comment keeps the draft, shows the shipped inline error and raises onRefused', async () => {
    const onRefused = vi.fn();
    const onLocked = vi.fn();
    const onCreateComment = vi.fn().mockResolvedValue({ ok: false, code: 'refused' });
    render(
      <CommentsList {...props({ variant: 'inline', onCreateComment, onRefused, onLocked })} />,
    );
    const field = screen.getByPlaceholderText('placeholder-label') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: 'my-draft' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'submit-label' }));
    });
    expect(onCreateComment).toHaveBeenCalledTimes(1);
    expect((screen.getByPlaceholderText('placeholder-label') as HTMLTextAreaElement).value).toBe(
      'my-draft',
    );
    expect(screen.getByText('submit-error-label')).toBeTruthy();
    // The optimistic row is gone: only the two shipped rows remain.
    expect(rows()).toHaveLength(2);
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onLocked).not.toHaveBeenCalled();
  });

  it('after the re-read removes the field the list stays readable and the error text goes', async () => {
    const onCreateComment = vi.fn().mockResolvedValue({ ok: false, code: 'refused' });
    const view = render(<CommentsList {...props({ variant: 'inline', onCreateComment })} />);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('placeholder-label'), {
        target: { value: 'my-draft' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'submit-label' }));
    });
    expect(screen.getByText('submit-error-label')).toBeTruthy();
    view.rerender(
      <CommentsList {...props({ variant: 'inline', onCreateComment, canComment: false })} />,
    );
    expect(composer()).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('a refused comment heart reverts to the pair it had and raises onRefused', async () => {
    const onRefused = vi.fn();
    const onLikeComment = vi.fn().mockResolvedValue({ ok: false, code: 'refused' });
    render(<CommentsList {...props({ variant: 'inline', onLikeComment, onRefused })} />);
    const heart = hearts()[0] as HTMLElement;
    expect(heart.getAttribute('data-comment-like')).toBe('unliked');
    await act(async () => {
      fireEvent.click(heart);
    });
    expect(onLikeComment).toHaveBeenCalledTimes(1);
    expect((hearts()[0] as HTMLElement).getAttribute('data-comment-like')).toBe('unliked');
    expect(screen.getAllByText('2-likes').length).toBeGreaterThan(0);
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE CONTROL: a successful write raises neither onRefused nor onLocked', async () => {
    const onRefused = vi.fn();
    const onLocked = vi.fn();
    render(<CommentsList {...props({ variant: 'inline', onRefused, onLocked })} />);
    await act(async () => {
      fireEvent.click(hearts()[0] as HTMLElement);
    });
    expect((hearts()[0] as HTMLElement).getAttribute('data-comment-like')).toBe('liked');
    expect(onRefused).not.toHaveBeenCalled();
    expect(onLocked).not.toHaveBeenCalled();
  });

  it('the two shipped access refusals keep their own reaction and do not raise onRefused', async () => {
    const onRefused = vi.fn();
    const onLocked = vi.fn();
    const onLikeComment = vi.fn().mockResolvedValue({ ok: false, code: 'community_locked' });
    render(<CommentsList {...props({ variant: 'inline', onLikeComment, onRefused, onLocked })} />);
    await act(async () => {
      fireEvent.click(hearts()[0] as HTMLElement);
    });
    expect(onLocked).toHaveBeenCalledWith('community_locked');
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('a generic failure (a rejected request) is not a refusal and does not raise onRefused', async () => {
    const onRefused = vi.fn();
    const onLikeComment = vi.fn().mockResolvedValue({ ok: false, code: 'generic' });
    render(<CommentsList {...props({ variant: 'inline', onLikeComment, onRefused })} />);
    await act(async () => {
      fireEvent.click(hearts()[0] as HTMLElement);
    });
    expect(onRefused).not.toHaveBeenCalled();
  });
});

/**
 * The shared sheet of a column (D-59): ONE sheet for every card, so the host cannot fix the facts
 * once. The list reads them from the post the sheet is open on (`post.actions`, plan 14's data), the
 * same fact the card read, so one fact governs every surface (UI-D-889).
 */
describe('11.1-15 UI-D-889: the sheet opened from a list reads the facts of ITS post', () => {
  const post = (id: string, aria: string, extra: Partial<PostCardView> = {}): PostCardView => ({
    id,
    caption: `caption-${id}`,
    author: { displayName: 'author-name', profileHref: '/membros/m1', avatarUrl: null },
    createdAtIso: '2026-10-08T10:00:00.000Z',
    createdAtRelative: 'relative-time',
    createdAtAbsolute: 'absolute-time',
    community: null,
    shareUrl: null,
    edited: false,
    canManage: false,
    editHref: null,
    likeCount: 0,
    commentCount: 3,
    viewerLiked: false,
    ariaLabel: aria,
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
    ...extra,
  });

  const sheetProps = props() as unknown as NonNullable<FeedListProps['comments']>;

  const feed = (items: PostCardView[]) => {
    const base: FeedListProps = {
      initialItems: items,
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
      comments: {
        ...sheetProps,
        title: 'sheet-title',
        initialItems: undefined,
        labels: LABELS,
        onLoadComments: vi.fn().mockResolvedValue({ ok: true, items: TWO, nextCursor: null }),
      } as NonNullable<FeedListProps['comments']>,
    };
    return render(
      <ToastProvider>
        <FeedList {...base} />
      </ToastProvider>,
    );
  };

  it('a post whose comment fact is false opens a sheet with no composer and no Responder', async () => {
    feed([
      post('p1', 'restricted-aria', { actions: { like: false, comment: false, share: false } }),
    ]);
    // All three false: the comment count is the one button that opens the read-only list.
    const article = screen.getByRole('article', { name: 'restricted-aria' });
    await act(async () => {
      fireEvent.click(within(article).getByRole('button', { name: '3-comments' }));
    });
    expect(rows()).toHaveLength(2);
    expect(composer()).toBeNull();
    expect(replies()).toHaveLength(0);
    expect(hearts()).toHaveLength(0);
  });

  it('only like false: the sheet keeps the composer and Responder and drops the hearts', async () => {
    feed([post('p1', 'plain-aria', { actions: { like: false, comment: true, share: true } })]);
    const article = screen.getByRole('article', { name: 'plain-aria' });
    await act(async () => {
      fireEvent.click(within(article).getByRole('button', { name: 'comment-label' }));
    });
    expect(composer()).not.toBeNull();
    expect(replies()).toHaveLength(2);
    expect(hearts()).toHaveLength(0);
  });

  it('POSITIVE CONTROL: a post with no fact opens the shipped sheet', async () => {
    feed([post('p1', 'plain-aria')]);
    const article = screen.getByRole('article', { name: 'plain-aria' });
    await act(async () => {
      fireEvent.click(within(article).getByRole('button', { name: 'comment-label' }));
    });
    expect(composer()).not.toBeNull();
    expect(replies()).toHaveLength(2);
    expect(hearts()).toHaveLength(2);
  });
});
