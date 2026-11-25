// @vitest-environment happy-dom
import type { FeedPost } from '@rede-social/module-feed/contracts';
import { FeedList, type FeedListProps, type PostMenuLabels } from '@rede-social/module-feed/ui';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { getTranslations } from 'next-intl/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { ReelsOverlayBinding } from '../reels/ReelsOverlay';
import type { PostDetailProps } from './PostDetail';

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
// The post detail page's collaborators that this file does not exercise. PostMenu is NOT stubbed:
// the real sheet's row rule is part of what is proven.
vi.mock('@rede-social/module-feed/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/module-feed/ui')>()),
  CommentsList: () => <div data-testid="comments-list" />,
}));
vi.mock('@/components/reels/ReelsOverlay', () => ({ ReelsOverlay: () => null }));
vi.mock('@/components/reels/ReelsHost', () => ({ REELS_ALL_LANE: 'all' }));
vi.mock('@/app/(app)/reels/reels-actions', () => ({
  loadReelsPageAction: vi.fn(),
  loadReelStartAction: vi.fn(),
}));
vi.mock('@/components/media/FeedVideo', () => ({ suspendFeedVideos: () => () => {} }));
vi.mock('./useSharePost', () => ({ useSharePost: () => vi.fn() }));
vi.mock('./useDeletePost', () => ({ useDeletePost: () => vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next-intl', async (importOriginal) => {
  const original = await importOriginal<typeof import('next-intl')>();
  const { loadMessages: load } = await import('@/i18n/messages');
  const messages = load();
  return {
    ...original,
    useTranslations: (namespace?: string) =>
      original.createTranslator({ locale: 'pt-BR', messages, namespace } as never),
  };
});
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
const { PostDetail } = await import('./PostDetail');

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

/** The real post detail page around the same card, with the real PostMenu behind its "..." control. */
function renderDetail(shape: Shape) {
  const view = card(shape);
  const props: PostDetailProps = {
    post: view,
    captionTruncateAt: 200,
    locale: 'pt-BR',
    labels: listProps(view).labels as unknown as PostDetailProps['labels'],
    onLike: vi.fn(),
    onUnlike: vi.fn(),
    genericErrorLabel: 'error',
    share: { title: 'tenant', copied: 'copied' },
    menu: {
      labels: MENU_LABELS,
      deletedLabel: 'deleted',
      removedLabel: 'removed',
      onDelete: vi.fn(),
      // The report row needs the host's actions (the page passes them when social is on).
      safety: { socialOn: true, reportAction: vi.fn(), blockAction: vi.fn() },
    },
    // CommentsList is stubbed; the report wiring only spreads the label block it is handed.
    comments: { labels: { item: {} } } as unknown as PostDetailProps['comments'],
    reels: { labels: { region: 'region' }, backLabel: 'back' } as ReelsOverlayBinding,
  };
  render(
    <ToastProvider>
      <PostDetail {...props} />
    </ToastProvider>,
  );
}

describe('the "..." sheet of the post detail follows the viewer share fact (11.1-19, WR-01)', () => {
  it('share false on a manageable post: the control stays, the sheet holds the author rows and no Copiar link', () => {
    renderDetail({ facts: { like: true, comment: true, share: false }, canManage: true });
    fireEvent.click(moreButton() as HTMLElement);
    expect(screen.getByRole('link', { name: 'edit-label' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'delete-label' })).toBeTruthy();
    expect(copyRow()).toBeNull();
  });

  it('share true (like and comment false): the same post keeps Copiar link', () => {
    renderDetail({ facts: { like: false, comment: false, share: true }, canManage: true });
    fireEvent.click(moreButton() as HTMLElement);
    expect(screen.getByRole('link', { name: 'edit-label' })).toBeTruthy();
    expect(copyRow()).toBeTruthy();
  });
});

type Host = 'FeedList' | 'PostDetail';

const HOSTS: Record<Host, (shape: Shape) => unknown> = {
  FeedList: (shape) => renderList(shape),
  PostDetail: (shape) => renderDetail(shape),
};

/** The page's report row speaks the real catalog; the list's harness uses its sentinel label. */
const REPORT_LABEL: Record<Host, string> = {
  FeedList: 'report-post',
  PostDetail: (
    createTranslator({
      locale: 'pt-BR',
      messages: loadMessages(),
      namespace: 'safety',
    } as never) as unknown as Translator
  )('menu.reportPost'),
};

/**
 * The "..." visibility matrix, against BOTH hosts. Each negative row has a positive sibling that
 * flips the one term back (share true, no fact, no community), so a screen that renders nothing at
 * all cannot pass.
 */
describe.each(['FeedList', 'PostDetail'] as const)(
  '%s: the "..." control and the copy row (11.1-19)',
  (host) => {
    const draw = HOSTS[host];

    it('(a) share false, reportable only: the control stays for Denunciar and the sheet has no copy row', () => {
      draw({ facts: { like: true, comment: true, share: false }, canReport: true });
      fireEvent.click(moreButton() as HTMLElement);
      expect(screen.getByRole('button', { name: REPORT_LABEL[host] })).toBeTruthy();
      expect(copyRow()).toBeNull();
    });

    it('(b) share false, not manageable, not reportable: no "..." control at all', () => {
      draw({ facts: { like: true, comment: true, share: false } });
      expect(moreButton()).toBeNull();
    });

    it.each([
      ['a community with no actions', undefined],
      ['a post with no community', 'none' as const],
    ])(
      '(c) %s, not manageable, not reportable: the control and the copy row are its one row',
      (_name, facts) => {
        draw({ facts });
        fireEvent.click(moreButton() as HTMLElement);
        expect(copyRow()).toBeTruthy();
      },
    );

    it('(d) share true with like and comment false: the control and the copy row are present', () => {
      draw({ facts: { like: false, comment: false, share: true } });
      fireEvent.click(moreButton() as HTMLElement);
      expect(copyRow()).toBeTruthy();
    });
  },
);
