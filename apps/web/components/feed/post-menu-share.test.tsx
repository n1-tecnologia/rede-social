// @vitest-environment happy-dom
import type { FeedPost } from '@rede-social/module-feed/contracts';
import { FeedList, type FeedListProps, type PostMenuLabels } from '@rede-social/module-feed/ui';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { getTranslations } from 'next-intl/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11.1-19 (WR-01, D-888, D-889, UI-D-888, BPERM-21): a viewer whose per-post share fact is false is
 * offered NO "Copiar link" in the "..." sheet of a list card. The card is built by the REAL
 * `postCardView` (the one builder every page uses), and drawn by the REAL `FeedList` with the REAL
 * `PostMenu`, so the contract "a null `shareUrl` is the single switch for every share entry, the
 * "..." control's own rule included" is pinned end to end, not restated.
 *
 * D-889: share is only HIDDEN on the screen; the server builds no link and gates nothing. Every
 * negative assertion here has a positive sibling that flips the one term back.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/components/media/VideoPlayer', () => ({ VideoPlayer: () => null }));
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

const { postCardView } = await import('@/lib/feed-view');

afterEach(cleanup);

type Translator = Awaited<ReturnType<typeof getTranslations>>;

const tf = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(),
  namespace: 'feed',
} as never) as unknown as Translator;

const ORIGIN = 'https://turma.example.com';
const POST_ID = '0e000000-0000-4000-8000-0000000000a1';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-10-13T12:00:00.000Z');

type Facts = { like: boolean; comment: boolean; share: boolean };

const MENU_LABELS: PostMenuLabels = {
  edit: 'edit-label',
  copyLink: 'copy-link-label',
  delete: 'delete-label',
  deleteTitle: 'delete-title',
  deleteBody: 'delete-body-org',
  deleteBodyMember: 'delete-body-member',
  deleteConfirm: 'delete-confirm',
  deleteCancel: 'delete-cancel',
  remove: 'remove-label',
  removeTitle: 'remove-title',
  removeBody: 'remove-body',
  removeConfirm: 'remove-confirm',
  removeCancel: 'remove-cancel',
  report: 'report-post',
};

type Shape = {
  /** The viewer's fact; `undefined` is "a community with no `actions`", `'none'` is no community. */
  facts?: Facts | 'none';
  canManage?: boolean;
  canReport?: boolean;
};

function feedPost({ facts, canManage = false, canReport = false }: Shape): FeedPost {
  const community =
    facts === 'none'
      ? null
      : {
          id: COMMUNITY,
          name: 'Turma',
          slug: 'turma',
          ...(facts === undefined ? {} : { actions: facts }),
        };
  return {
    id: POST_ID,
    createdAt: '2026-10-12T22:00:00.000Z',
    editedAt: null,
    caption: 'Legenda',
    author: {
      membershipId: '0e000000-0000-4000-8000-0000000000b1',
      displayName: 'Ana Souza',
      avatarAssetId: null,
    },
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    communityId: community === null ? null : COMMUNITY,
    community,
    canManage,
    ...(canReport ? { canReport: true } : {}),
    mediaKind: 'none',
    media: [],
    linkPreview: null,
  } as unknown as FeedPost;
}

/** The card exactly as every page builds it. */
function card(shape: Shape) {
  return postCardView(feedPost(shape), NOW, tf, ORIGIN, 'America/Sao_Paulo');
}

function listProps(post: ReturnType<typeof card>, onShare = vi.fn()): FeedListProps {
  const ok = async () => ({ ok: true as const, liked: true, likeCount: 1 });
  return {
    initialItems: [post],
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
    onShare,
    menu: {
      labels: MENU_LABELS,
      onDelete: vi.fn(async () => {}),
      onReport: vi.fn(),
    },
  };
}

function renderList(shape: Shape, onShare = vi.fn()) {
  render(
    <ToastProvider>
      <FeedList {...listProps(card(shape), onShare)} />
    </ToastProvider>,
  );
  return onShare;
}

const moreButton = () => screen.queryByRole('button', { name: 'more-options-label' });
const copyRow = () => screen.queryByRole('button', { name: 'copy-link-label' });

describe('the "..." sheet of a list card follows the viewer share fact (11.1-19, WR-01)', () => {
  it('share false on a manageable post: the sheet holds the author rows and no Copiar link', () => {
    renderList({ facts: { like: true, comment: true, share: false }, canManage: true });
    fireEvent.click(moreButton() as HTMLElement);
    // The author's own rows are there (the sheet really opened) ...
    expect(screen.getByRole('link', { name: 'edit-label' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'delete-label' })).toBeTruthy();
    // ... and the forbidden entry is not.
    expect(copyRow()).toBeNull();
  });

  it('share true (like and comment false): the same post keeps Copiar link and it shares the url', () => {
    const onShare = renderList({
      facts: { like: false, comment: false, share: true },
      canManage: true,
    });
    fireEvent.click(moreButton() as HTMLElement);
    expect(screen.getByRole('link', { name: 'edit-label' })).toBeTruthy();
    fireEvent.click(copyRow() as HTMLElement);
    expect(onShare).toHaveBeenCalledWith({ postId: POST_ID, url: `${ORIGIN}/post/${POST_ID}` });
  });
});
