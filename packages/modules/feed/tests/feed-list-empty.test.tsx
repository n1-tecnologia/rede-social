// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedList, type FeedListProps } from '../ui/FeedList';

/**
 * 09-08 (UI-D-494, UI-D-496): the feed list's optional `empty` slot.
 *
 * A surface that passes `empty` owns its empty state (Explorar's three, decided on the server), so
 * the list renders that node INSTEAD of its built-in empty card, and - because the node's action is
 * not a composer - the floating composer control is not suppressed by an on-screen empty CTA. The
 * error state still wins over the slot (a failed first read is never "nothing to show"), and a list
 * without the slot is byte for byte what 04 shipped. Sentinel ASCII strings throughout.
 */

vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout']);
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

function show(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const ok = async () => ({ ok: true as const, liked: true, likeCount: 1 });

function listProps(overrides: Partial<FeedListProps> = {}): FeedListProps {
  return {
    initialItems: [],
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
    onLike: ok,
    onUnlike: ok,
    ...overrides,
  };
}

const EMPTY = <p>host-empty-node</p>;

describe('FeedList - the empty slot (09-08, UI-D-494)', () => {
  it('renders the host node instead of the built-in empty state', () => {
    show(<FeedList {...listProps({ empty: EMPTY })} />);
    expect(screen.getByText('host-empty-node')).toBeInTheDocument();
    expect(screen.queryByText('empty-title')).not.toBeInTheDocument();
    expect(screen.queryByText('empty-body')).not.toBeInTheDocument();
  });

  it('keeps the built-in empty state when no node is given', () => {
    show(<FeedList {...listProps()} />);
    expect(screen.getByText('empty-title')).toBeInTheDocument();
    expect(screen.queryByText('host-empty-node')).not.toBeInTheDocument();
  });

  it('a failed first read still shows the error card, never the slot', () => {
    show(<FeedList {...listProps({ empty: EMPTY, initialError: true })} />);
    expect(screen.getByText('error-title')).toBeInTheDocument();
    expect(screen.queryByText('host-empty-node')).not.toBeInTheDocument();
  });

  it('a list with posts renders them and not the slot', () => {
    const initialItems = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        caption: 'caption-1',
        author: { displayName: 'author-1', profileHref: '/membros/m1', avatarUrl: null },
        createdAtIso: '2026-10-08T10:00:00.000Z',
        createdAtRelative: 'relative-time',
        createdAtAbsolute: 'absolute-time',
        community: null,
        shareUrl: null,
        edited: false,
        canManage: false,
        editHref: null,
        likeCount: 0,
        commentCount: 0,
        viewerLiked: false,
        ariaLabel: 'post-1',
        media: { mediaKind: 'none' as const, images: [], attachments: [] },
      },
    ];
    show(<FeedList {...listProps({ empty: EMPTY, initialItems })} />);
    expect(screen.getByRole('article', { name: 'post-1' })).toBeInTheDocument();
    expect(screen.queryByText('host-empty-node')).not.toBeInTheDocument();
  });
});

describe('FeedList - the composer control beside the slot (09-08, UI-D-496)', () => {
  const composer = { canPost: true, createHref: '/criar' };

  it('the floating composer control stays when the host owns the empty state', () => {
    const { container } = show(<FeedList {...listProps({ ...composer, empty: EMPTY })} />);
    expect(container.querySelector('[data-compose-fab]')).not.toBeNull();
  });

  it('with the built-in empty state the card owns the CTA, so the floating control stands down', () => {
    const { container } = show(<FeedList {...listProps(composer)} />);
    expect(container.querySelector('[data-compose-fab]')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'create-cta' }).length).toBeGreaterThan(0);
  });
});
