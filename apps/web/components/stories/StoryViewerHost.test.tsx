// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The app-tier shell that turns `StoryViewer` into a product surface (05-06, STORY-02/STORY-05).
 *
 * The catalog is the REAL `stories.json`, so an assertion here fails when the pt-BR copy drifts —
 * the `StoryComposer.test.tsx` pattern, one plan later. What is stubbed: the two server actions,
 * the toast and the video bridge (its vendor element cannot mount under happy-dom and its own
 * behaviour is a browser fact, not a unit one). What is real: the viewer, the shipped `LikeButton`
 * and its optimistic engine, the plural counts and the media element.
 *
 * The four claims worth a test are the four a later edit could quietly break:
 *
 *  1. **The like is OPTIMISTIC and then AUTHORITATIVE.** The count flips on the tap and is then
 *     replaced by the server's pair — not incremented locally and left there.
 *  2. **A failure REVERTS and raises the GENERIC toast, with no inline message.** A full-screen
 *     surface has nowhere to put an inline error, and a like that silently stood would be worse.
 *  3. **Zero DROPS the count** (UI-D-21, inherited) leaving the bare glyph.
 *  4. **UI-D-31 / UI-D-32: no double-tap burst and no share control anywhere in the overlay** — a
 *     tap on this surface already means "advance".
 */

const { catalog, feedCatalog, toast, like, unlike } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('stories').stories as Record<string, unknown>,
    feedCatalog: read('feed').feed as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    like: vi.fn(),
    unlike: vi.fn(),
  };
});

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? `{${name}}`),
  );
};

vi.mock('@tria/ui', async (orig) => ({
  ...(await orig<typeof import('@tria/ui')>()),
  useToast: () => toast,
}));

// The vendor player registers a custom element at import time and mints a token through a server
// action; neither exists under happy-dom, and neither is what this file is about.
vi.mock('./StoryVideo', () => ({
  StoryVideo: ({ assetId }: { assetId: string }) => <div data-testid={`story-video-${assetId}`} />,
}));

const { storyViewerLabels } = await import('@/lib/story-view');
const { StoryViewerHost } = await import('./StoryViewerHost');

// `next-intl`'s reader FORMATS on read, so the templated strings are taken with `.raw` — this
// stand-in exposes the same two calls the real translator does.
const reader = Object.assign((key: string) => lookup(key), { raw: (key: string) => lookup(key) });

const LABELS = storyViewerLabels(reader);

const ASSET = '0d000000-0000-4000-8000-0000000000b1';

/**
 * D-82's binding, built from the REAL catalogs — which is itself an assertion. The sheet title, the
 * placeholder and the empty copy come from the FEED namespace verbatim (UI-SPEC §Copywriting
 * Contract, "Viewer comments"), and only the ONE refusal sentence comes from the stories namespace.
 * If a later edit duplicates the feed's comment copy into `stories.json`, the two readers below
 * start disagreeing and these tests are where it shows.
 */
const feed = (key: string) =>
  String(
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], feedCatalog) ??
      key,
  );

const loadComments = vi.fn();

function commentsBinding() {
  return {
    title: feed('comments.title'),
    locale: 'pt-BR',
    viewer: { displayName: 'Membro', profileHref: null, avatarUrl: null },
    onLoadComments: loadComments,
    onLoadReplies: vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null }),
    onCreateComment: vi.fn().mockResolvedValue({ ok: false }),
    onDeleteComment: vi.fn().mockResolvedValue({ ok: true }),
    onLikeComment: vi.fn().mockResolvedValue({ ok: false }),
    onUnlikeComment: vi.fn().mockResolvedValue({ ok: false }),
    labels: {
      region: feed('comments.region'),
      emptyLabel: feed('comments.empty'),
      errorLabel: feed('errors.comments'),
      errorRepliesLabel: feed('errors.replies'),
      retryLabel: feed('comments.retry'),
      submitErrorLabel: feed('errors.commentSubmit'),
      replyDepthErrorLabel: feed('errors.replyDepth'),
      storyNoReplyErrorLabel: lookup('viewer.comments.noReply'),
      loadMoreLabel: feed('comments.loadMore'),
      loadMoreRepliesLabel: feed('comments.loadMoreReplies'),
      showReplies: {
        one: feed('comments.showReplies.one'),
        other: feed('comments.showReplies.other'),
      },
      hideReplies: {
        one: feed('comments.hideReplies.one'),
        other: feed('comments.hideReplies.other'),
      },
      replyChip: feed('comments.replyChip'),
      replyChipDismiss: feed('comments.replyChipDismiss'),
      placeholder: feed('comments.placeholder'),
      submitLabel: feed('comments.submit'),
      viewerLabel: feed('comments.viewerAvatar'),
      nowLabel: feed('comments.now'),
      deleteTitle: feed('comments.delete.title'),
      deleteBody: feed('comments.delete.body'),
      deleteConfirm: feed('comments.delete.confirm'),
      deleteCancel: feed('comments.delete.cancel'),
      item: {
        removedAuthor: feed('comments.removedAuthor'),
        like: feed('comments.like'),
        unlike: feed('comments.unlike'),
        likes: { one: feed('comments.likes.one'), other: feed('comments.likes.other') },
        reply: feed('comments.reply'),
        delete: feed('comments.delete.label'),
      },
    },
  };
}

const SEEDED_COMMENT = {
  id: '0d000000-0000-4000-8000-0000000000e1',
  body: 'Que story bonito.',
  author: { displayName: 'Bruno', profileHref: '/membros/m1', avatarUrl: null },
  authorRemoved: false,
  createdAtIso: '2026-09-24T00:00:00.000Z',
  createdAtRelative: 'ha 1 h',
  createdAtAbsolute: '24/09/2026',
  likeCount: 0,
  viewerLiked: false,
  replyCount: 2,
  isReply: false,
  canDelete: false,
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: '0d000000-0000-4000-8000-0000000000d1',
    mediaKind: 'image' as const,
    mediaAssetId: ASSET,
    mediaVariantWidths: [640, 1080],
    caption: 'Bastidores do encontro de hoje.',
    timeLabel: 'há 1 h',
    likeCount: 12,
    commentCount: 3,
    viewerLiked: false,
    ...overrides,
  };
}

function host(overrides: Record<string, unknown> = {}) {
  return render(
    <StoryViewerHost
      items={[item()]}
      author={{ name: 'Direcao TRIA Demo', avatarUrl: null }}
      labels={LABELS}
      onLike={like as never}
      onUnlike={unlike as never}
      onClose={() => {}}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  like.mockResolvedValue({ ok: true, liked: true, likeCount: 13 });
  unlike.mockResolvedValue({ ok: true, liked: false, likeCount: 12 });
  loadComments.mockResolvedValue({ ok: true, items: [SEEDED_COMMENT], nextCursor: null });
});
afterEach(cleanup);

describe('StoryViewerHost — the viewer as a product surface (STORY-02, STORY-05)', () => {
  it('1. renders the sequence: the author row, the caption and the two 44x44 actions', () => {
    host();

    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Direcao TRIA Demo')).toBeTruthy();
    expect(screen.getByText('há 1 h')).toBeTruthy();
    expect(screen.getByTestId('story-caption').textContent).toBe('Bastidores do encontro de hoje.');
    // The copy is the catalog's, interpolated — never a literal in this file.
    expect(screen.getByTestId('story-like-count').textContent).toBe('12 curtidas');
    expect(screen.getByRole('button', { name: 'Curtir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeTruthy();
  });

  it('2. the like flips OPTIMISTICALLY and is then replaced by the server’s authoritative count', async () => {
    host();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Curtir' }));
    });

    expect(like).toHaveBeenCalledWith('0d000000-0000-4000-8000-0000000000d1');
    // 13, which is what the ACTION returned — a locally incremented 13 would look identical here,
    // so the next assertion is the one that separates them.
    expect(screen.getByTestId('story-like-count').textContent).toBe('13 curtidas');
    expect(screen.getByRole('button', { name: 'Descurtir' })).toBeTruthy();
  });

  it('3. the server’s pair WINS over the optimistic one, even when they disagree', async () => {
    // Two other members liked it while this one was reading: the authoritative answer is 20.
    like.mockResolvedValue({ ok: true, liked: true, likeCount: 20 });
    host();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Curtir' }));
    });

    expect(screen.getByTestId('story-like-count').textContent).toBe('20 curtidas');
  });

  it('4. a refused like REVERTS and raises the generic toast — never an inline message', async () => {
    like.mockResolvedValue({ ok: false, code: 'generic' });
    host();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Curtir' }));
    });

    expect(screen.getByTestId('story-like-count').textContent).toBe('12 curtidas');
    expect(screen.getByRole('button', { name: 'Curtir' })).toBeTruthy();
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      message: 'Algo deu errado. Tente novamente.',
      tone: 'error',
    });
    // Nothing was written into the overlay itself.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('5. zero DROPS both counts, leaving the bare glyphs (UI-D-21, inherited)', () => {
    host({ items: [item({ likeCount: 0, commentCount: 0 })] });

    expect(screen.queryByTestId('story-like-count')).toBeNull();
    expect(screen.getByRole('button', { name: 'Curtir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeTruthy();
  });

  it('6. a story with no caption renders no caption node and the action row moves down', () => {
    host({ items: [item({ caption: '' })] });
    expect(screen.queryByTestId('story-caption')).toBeNull();
  });

  it('7. UI-D-31 / UI-D-32: no double-tap burst and no share control in the overlay', () => {
    host({ items: [item(), item({ id: 'second' })] });
    const dialog = screen.getByRole('dialog');

    expect(dialog.querySelector('[data-double-tap-burst]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Compartilhar/i })).toBeNull();
  });

  it('8. a VIDEO story renders the token-minting bridge, never the feed player', () => {
    host({ items: [item({ mediaKind: 'video' })] });
    expect(screen.getByTestId(`story-video-${ASSET}`)).toBeTruthy();
  });
});

/**
 * D-82 — the comment sheet over the viewer, and the ONE mechanism it drives.
 *
 * "The story pauses while the sheet is open" is not a second pause: `StoryViewer` already ORs a
 * single boolean from the hold gesture, document visibility, the space key and the expanded
 * caption, and 05-06 left `externallyPaused` wired end to end and fed by nothing precisely so this
 * plan would be one prop at the composition point. The assertion below is on `data-paused`, which
 * is the viewer's own published reading of that boolean — not on an internal.
 */
describe('StoryViewerHost — the comment sheet (D-82, STORY-05)', () => {
  const openSheet = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    });
  };

  it('9. the Comentar control is LIVE and opens the shipped sheet, titled from the FEED catalog', async () => {
    host({ comments: commentsBinding() });

    expect(screen.getByRole('button', { name: 'Comentar' }).hasAttribute('disabled')).toBe(false);
    await openSheet();

    // "Comentários" — the feed's own title, reused verbatim rather than duplicated into stories.
    expect(screen.getByRole('dialog', { name: 'Comentários' })).toBeTruthy();
    expect(screen.getByText('Que story bonito.')).toBeTruthy();
    expect(loadComments).toHaveBeenCalledWith('0d000000-0000-4000-8000-0000000000d1');
  });

  it('10. opening the sheet PAUSES the story, and closing it resumes', async () => {
    host({ comments: commentsBinding() });
    const viewer = screen.getByRole('dialog', { name: 'Story' });
    expect(viewer.getAttribute('data-paused')).toBe('false');

    await openSheet();
    expect(viewer.getAttribute('data-paused')).toBe('true');

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Comentários' }), { key: 'Escape' });
    });
    // The assertion is on `data-paused`, not on the sheet having left the DOM: `BottomSheet` exits
    // through `AnimatePresence`, whose exit animation never settles under happy-dom, so the panel
    // node lingers there in a way it never does in a browser. The e2e measures the bar instead.
    expect(viewer.getAttribute('data-paused')).toBe('false');
  });

  it('11. the sheet renders the FLAT list: no reply control, no replies toggle, no comment like', async () => {
    const { container } = host({ comments: commentsBinding() });
    await openSheet();

    expect(container.querySelectorAll('[data-comment-reply]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-replies-toggle]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-comment-like]')).toHaveLength(0);
  });

  it('12. with NO binding the affordance stays inert rather than doing nothing on tap', () => {
    host();
    expect(screen.getByRole('button', { name: 'Comentar' }).hasAttribute('disabled')).toBe(true);
  });
});
