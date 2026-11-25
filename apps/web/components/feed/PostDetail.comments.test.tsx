// @vitest-environment happy-dom

import type { Bootstrap } from '@rede-social/contracts';
import type { FeedPost } from '@rede-social/module-feed/contracts';
import type { PostCardView } from '@rede-social/module-feed/ui';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReelsOverlayBinding } from '../reels/ReelsOverlay';
import type { PostDetailProps } from './PostDetail';

/**
 * 11.1-15 (D-888, UI-D-888 second bullet, UI-D-889, UI-D-895): the post detail page's comments follow
 * the viewer's per-post facts, built by the same host builders the page uses
 * (`feedCommentsProps` + `commentActionProps`, which read `postActionsView`), through the REAL
 * `CommentsList` and the REAL pt-BR catalog.
 *
 * A viewer who cannot comment reads "Nenhum comentário ainda." where the shipped line invites an
 * action they cannot take, and meets no composer; a viewer who can comment keeps the shipped line.
 * The catalog is real, so a copy drift fails here.
 *
 * Stubbed: the server actions behind the comment handlers (never called here), the menu and the Reels
 * overlay.
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
vi.mock('@/lib/tenant-host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-host')>()),
  primaryHostOrigin: vi.fn(async () => null),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages();
  return {
    getLocale: vi.fn(async () => 'pt-BR'),
    getTranslations: vi.fn(async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
    ),
  };
});
vi.mock('@rede-social/module-feed/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/module-feed/ui')>()),
  PostMenu: () => null,
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
  const { createTranslator } = await importOriginal<typeof import('next-intl')>();
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages();
  return {
    ...(await importOriginal<typeof import('next-intl')>()),
    useTranslations: (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
  };
});

const { PostDetail } = await import('./PostDetail');
const { commentActionProps, feedCommentsProps, postCardLabels } = await import('@/lib/registry');
const { getTranslations } = await import('next-intl/server');
const { postCardView } = await import('@/lib/feed-view');

afterEach(cleanup);

const SHIPPED_EMPTY = 'Nenhum comentário ainda. Seja o primeiro!';
const READ_ONLY_EMPTY = 'Nenhum comentário ainda.';

const BOOTSTRAP = {
  permissions: [],
  modules: [],
  tenant: { displayName: 'Rede Demo', timezone: 'America/Sao_Paulo', branding: { logoUrl: null } },
  membership: { profile: { displayName: 'Viewer', avatarUrl: null } },
} as unknown as Bootstrap;

const COMMUNITY = '33333333-3333-4333-8333-333333333333';

function feedPost(actions?: { like: boolean; comment: boolean; share: boolean }): FeedPost {
  return {
    id: '0e000000-0000-4000-8000-0000000000a1',
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
    communityId: COMMUNITY,
    community: {
      id: COMMUNITY,
      name: 'Turma',
      slug: 'turma',
      ...(actions === undefined ? {} : { actions }),
    },
    canManage: false,
    mediaKind: 'none',
    media: [],
    linkPreview: null,
  } as unknown as FeedPost;
}

/** The page as the server builds it: the card view and the comment props from the SAME post. */
async function page(post: FeedPost): Promise<{ props: PostDetailProps; card: PostCardView }> {
  const tf = await getTranslations('feed');
  const locale = 'pt-BR';
  const card = postCardView(post, Date.now(), tf, null, 'America/Sao_Paulo', null, null);
  const props: PostDetailProps = {
    post: card,
    captionTruncateAt: 200,
    locale,
    labels: postCardLabels(tf),
    onLike: vi.fn(),
    onUnlike: vi.fn(),
    genericErrorLabel: tf('errors.generic'),
    share: { title: 'tenant', copied: 'copied' },
    menu: {
      labels: {} as PostDetailProps['menu']['labels'],
      deletedLabel: 'deleted',
      removedLabel: 'removed',
      onDelete: vi.fn(),
    },
    comments: {
      ...feedCommentsProps(locale, tf, BOOTSTRAP),
      ...commentActionProps(post),
      initialItems: [],
      initialCursor: null,
      initialError: false,
    } as PostDetailProps['comments'],
    reels: { labels: { region: 'region' }, backLabel: 'back' } as ReelsOverlayBinding,
  };
  return { props, card };
}

async function show(post: FeedPost) {
  const { props } = await page(post);
  return render(
    <ToastProvider>
      <PostDetail {...props} />
    </ToastProvider>,
  );
}

const composer = () => document.querySelector('[data-comment-input]');
const emptyLine = () => document.querySelector('[data-comments-empty]')?.textContent;

describe('commentActionProps: the booleans come from postActionsView and nothing else', () => {
  it.each([
    [{ like: true, comment: true, share: true }, true, true],
    [{ like: false, comment: true, share: true }, true, false],
    [{ like: true, comment: false, share: true }, false, true],
    [{ like: false, comment: false, share: true }, false, false],
    [{ like: true, comment: true, share: false }, true, true],
    [{ like: false, comment: false, share: false }, false, false],
  ])('%j reads canComment %s and canLikeComment %s', (actions, canComment, canLikeComment) => {
    expect(commentActionProps(feedPost(actions))).toEqual({ canComment, canLikeComment });
  });

  it('a post with no fact, and a post with no community, read as all true (today)', () => {
    expect(commentActionProps(feedPost())).toEqual({ canComment: true, canLikeComment: true });
    expect(
      commentActionProps({ ...feedPost(), communityId: null, community: null } as FeedPost),
    ).toEqual({ canComment: true, canLikeComment: true });
  });
});

describe('the catalog: the read-only line is its own key and invites nothing', () => {
  it('feedCommentsProps carries both lines, verbatim from the pt-BR catalog', async () => {
    const tf = await getTranslations('feed');
    const { labels } = feedCommentsProps('pt-BR', tf, BOOTSTRAP);
    expect(labels.emptyLabel.normalize('NFC')).toBe(SHIPPED_EMPTY.normalize('NFC'));
    expect(labels.emptyReadOnlyLabel.normalize('NFC')).toBe(READ_ONLY_EMPTY.normalize('NFC'));
    expect(labels.emptyReadOnlyLabel).not.toContain('primeiro');
  });
});

describe('the detail page: a post with no comments (UI-D-888, UI-D-895)', () => {
  it('comment false: the read-only line, no composer and never the invitation', async () => {
    await show(feedPost({ like: true, comment: false, share: true }));
    expect(emptyLine()?.normalize('NFC')).toBe(READ_ONLY_EMPTY.normalize('NFC'));
    expect(screen.queryByText(SHIPPED_EMPTY)).toBeNull();
    expect(composer()).toBeNull();
  });

  it('POSITIVE CONTROL: comment true keeps the shipped line and the composer', async () => {
    await show(feedPost({ like: false, comment: true, share: true }));
    expect(emptyLine()?.normalize('NFC')).toBe(SHIPPED_EMPTY.normalize('NFC'));
    expect(composer()).not.toBeNull();
  });

  it('POSITIVE CONTROL: a post with no fact is the shipped page', async () => {
    await show(feedPost());
    expect(emptyLine()?.normalize('NFC')).toBe(SHIPPED_EMPTY.normalize('NFC'));
    expect(composer()).not.toBeNull();
  });
});

describe('the card of a post nobody commented on offers no entry to an empty sheet (plan 14)', () => {
  it('comment false with no comments: no comment glyph and no count button', async () => {
    const { card } = await page(feedPost({ like: true, comment: false, share: true }));
    expect(card.commentCount).toBe(0);
    await show(feedPost({ like: true, comment: false, share: true }));
    expect(screen.queryByRole('button', { name: /coment/i })).toBeNull();
  });

  it('all three false with no comments: no row and no count button', async () => {
    await show(feedPost({ like: false, comment: false, share: false }));
    expect(screen.queryByRole('button', { name: /curtir|coment|compartilhar|enviar/i })).toBeNull();
  });

  it('POSITIVE CONTROL: with the fact absent the same card draws the comment glyph', async () => {
    await show(feedPost());
    expect(screen.queryByRole('button', { name: /coment/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /curtir/i })).not.toBeNull();
  });
});
