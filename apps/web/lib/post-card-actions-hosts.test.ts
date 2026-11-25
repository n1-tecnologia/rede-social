import type { FeedPost } from '@rede-social/module-feed/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMoreCommunityPostsAction } from '@/app/(app)/comunidades/actions';
import { loadMoreExplorarAction, loadMoreFeedAction } from '@/app/(app)/inicio/feed-actions';
import { getFeed } from '@/lib/feed';

/**
 * 11.1-14 (UI-D-889, D-888): one fact governs every list. Início, Explorar and the community page's
 * post lists all page through a server action that maps each post with `postCardView`, so a post
 * whose `community.actions` withholds a control reaches the card with the same `actions` on every
 * one of them, and a post without the fact reaches it with none (the shipped card).
 *
 * Stubbed: the feed client, the share origin, the bootstrap, the translator and the Instagram
 * lookup. Real: `postCardView`, the actions and the view they return.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/feed', () => ({
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  getComments: vi.fn(),
  getFeed: vi.fn(),
  getReplies: vi.fn(),
  likeComment: vi.fn(),
  likePost: vi.fn(),
  softDeletePost: vi.fn(),
  unlikeComment: vi.fn(),
  unlikePost: vi.fn(),
  updatePost: vi.fn(),
}));
vi.mock('@/lib/communities', () => ({}));
vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  getBootstrap: vi.fn(async () => ({ tenant: { timezone: 'America/Sao_Paulo' } })),
}));
vi.mock('@/lib/admin-icon-cookie', () => ({ readAdminIconChoice: vi.fn(async () => null) }));
vi.mock('@/lib/author-instagram', () => ({
  withAuthorInstagrams: vi.fn(async (page: unknown) => ({ page, instagrams: new Map() })),
}));
vi.mock('@/lib/tenant-host', () => ({ primaryHostOrigin: vi.fn(async () => 'https://x.example') }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key) }));

const COMMUNITY_ID = '33333333-3333-4333-8333-333333333333';

function post(id: string, actions?: { like: boolean; comment: boolean; share: boolean }): FeedPost {
  return {
    id,
    createdAt: '2026-10-12T22:00:00.000Z',
    editedAt: null,
    caption: 'Legenda',
    author: {
      membershipId: '0e000000-0000-4000-8000-0000000000b1',
      displayName: 'Ana Souza',
      avatarAssetId: null,
    },
    likeCount: 0,
    commentCount: 2,
    viewerLiked: false,
    communityId: COMMUNITY_ID,
    community: {
      id: COMMUNITY_ID,
      name: 'Turma',
      slug: 'turma',
      ...(actions === undefined ? {} : { actions }),
    },
    canManage: false,
    mediaKind: 'none',
    media: [],
    linkPreview: null,
  } satisfies FeedPost;
}

const withheld = post('0e000000-0000-4000-8000-0000000000a1', {
  like: true,
  comment: false,
  share: true,
});
const plain = post('0e000000-0000-4000-8000-0000000000a2');

beforeEach(() => {
  vi.mocked(getFeed).mockResolvedValue({ items: [withheld, plain], nextCursor: null } as never);
});

type Page = { ok: boolean; items?: Array<{ id: string; actions?: unknown }> };

describe.each([
  ['Início (loadMoreFeedAction)', () => loadMoreFeedAction('cursor-1')],
  ['Explorar (loadMoreExplorarAction)', () => loadMoreExplorarAction('cursor-1')],
  [
    'the community page (loadMoreCommunityPostsAction)',
    () => loadMoreCommunityPostsAction(COMMUNITY_ID, 'cursor-1'),
  ],
])('%s', (_name, load) => {
  it('hands the card the same per-post fact: withheld for one post, none for the other', async () => {
    const page = (await load()) as Page;
    expect(page.ok).toBe(true);
    const [first, second] = page.items ?? [];
    expect(first?.actions).toEqual({ like: true, comment: false, share: true });
    expect(second && 'actions' in second).toBe(false);
  });
});
