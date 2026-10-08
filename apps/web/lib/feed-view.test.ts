import type { FeedComment, FeedPost } from '@rede-social/module-feed/contracts';
import { createTranslator } from 'next-intl';
import type { getTranslations } from 'next-intl/server';
import { describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { AdminIconChoice } from '@/lib/admin-icon';
import {
  absoluteTimeFormatter,
  commentView,
  postAuthorAdminLabel,
  postCardBase,
  postCardView,
} from '@/lib/feed-view';

/**
 * 06-09 — every tenant timestamp on the tenant's clock (UI-D-203, D-66).
 *
 * The claim worth a test: the feed card's and the comment row's ABSOLUTE time are formatted in the
 * zone the caller passes (`bootstrap.tenant.timezone`), not in a pinned one. The same instant,
 * `2026-10-12T22:00:00Z`, reads 19:00 on a São Paulo tenant (UTC-3) and 18:00 on a Manaus tenant
 * (UTC-4). Brazil has had no daylight saving time since 2019, so the pair is stable all year.
 *
 * What is stubbed: `lib/env` (validated at import time, reached through `VideoPlayer`'s server
 * action) and `VideoPlayer` itself (a client component the card only embeds for a video post). What
 * is real: the mapping, `Intl`, and the pt-BR catalog through next-intl's own translator — the
 * pattern `reels.test.ts` uses.
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

type Translator = Awaited<ReturnType<typeof getTranslations>>;

const tf = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(),
  namespace: 'feed',
} as never) as unknown as Translator;

const SP = 'America/Sao_Paulo';
const MANAUS = 'America/Manaus';
const CREATED_AT = '2026-10-12T22:00:00.000Z';
const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const MEMBERSHIP = '0e000000-0000-4000-8000-0000000000b1';

function post(): FeedPost {
  return {
    id: '0e000000-0000-4000-8000-0000000000a1',
    createdAt: CREATED_AT,
    editedAt: null,
    caption: 'Legenda',
    author: { membershipId: MEMBERSHIP, displayName: 'Ana Souza', avatarAssetId: null },
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    communityId: null,
    community: null,
    canManage: false,
    mediaKind: 'none',
    media: [],
    linkPreview: null,
  } satisfies FeedPost;
}

function comment(): FeedComment {
  return {
    id: '0e000000-0000-4000-8000-0000000000c1',
    body: 'Comentário',
    createdAt: CREATED_AT,
    author: { membershipId: MEMBERSHIP, displayName: 'Ana Souza', avatarAssetId: null },
    authorRemoved: false,
    likeCount: 0,
    viewerLiked: false,
    replyCount: 0,
    isReply: false,
    canDelete: false,
  } satisfies FeedComment;
}

describe('postCardView — the absolute time in the tenant zone (06-09)', () => {
  it('formats 2026-10-12T22:00Z as 12/10/2026, 19:00 on a São Paulo tenant', () => {
    expect(postCardView(post(), NOW, tf, null, SP).createdAtAbsolute).toBe('12/10/2026, 19:00');
  });

  it('formats the same instant one hour earlier (18:00) on a Manaus tenant', () => {
    expect(postCardView(post(), NOW, tf, null, MANAUS).createdAtAbsolute).toBe('12/10/2026, 18:00');
  });

  it('the ISO value and the relative label do not depend on the zone', () => {
    const sp = postCardView(post(), NOW, tf, null, SP);
    const manaus = postCardView(post(), NOW, tf, null, MANAUS);
    expect(sp.createdAtIso).toBe(CREATED_AT);
    expect(manaus.createdAtIso).toBe(CREATED_AT);
    expect(manaus.createdAtRelative).toBe(sp.createdAtRelative);
  });

  it('postCardBase is the card without an absolute time (the Reel mapping)', () => {
    const base = postCardBase(post(), NOW, tf, null);
    expect('createdAtAbsolute' in base).toBe(false);
    const { createdAtAbsolute: _absolute, ...card } = postCardView(post(), NOW, tf, null, SP);
    expect(base).toEqual(card);
  });

  it('an administrator author wears the crown label the host passes (2026-10-06)', () => {
    expect(postCardView(post(), NOW, tf, null, SP, 'Administrador').author.adminLabel).toBe(
      'Administrador',
    );
    expect(postCardView(post(), NOW, tf, null, SP).author.adminLabel).toBeUndefined();
  });

  it('the viewer’s own icon pick marks only the viewer’s own posts (2026-10-06)', () => {
    const mine: AdminIconChoice = { membershipId: MEMBERSHIP, icon: 'star' };
    const someoneElse: AdminIconChoice = {
      membershipId: '99999999-9999-4999-8999-999999999999',
      icon: 'gem',
    };
    const view = (choice: AdminIconChoice | null, label: string | null = 'Administrador') =>
      postCardView(post(), NOW, tf, null, SP, label, choice).author;
    expect(view(mine).adminIcon).toBe('star');
    // Another member's pick (another account on this device) leaves this author on the crown.
    expect('adminIcon' in view(someoneElse)).toBe(false);
    expect('adminIcon' in view(null)).toBe(false);
    // No mark at all, no icon either.
    expect('adminIcon' in view(mine, null)).toBe(false);
  });
});

describe('postAuthorAdminLabel — who wears the crown (2026-10-06)', () => {
  const crown = (settings: Record<string, unknown>) =>
    postAuthorAdminLabel({ modules: [{ key: 'feed', settings }] }, tf);
  it('under admins_only (stated or the default) every author is an administrator', () => {
    expect(crown({ postingPolicy: 'admins_only' })).toBe(tf('post.adminBadge'));
    expect(crown({})).toBe(tf('post.adminBadge'));
  });
  it('under members the role is not on the wire, so no crown is guessed', () => {
    expect(crown({ postingPolicy: 'members' })).toBeNull();
  });
});

describe('commentView — the absolute title in the tenant zone (06-09)', () => {
  it('formats 12/10/2026, 19:00 on a São Paulo tenant', () => {
    expect(commentView(comment(), NOW, 'agora', SP).createdAtAbsolute).toBe('12/10/2026, 19:00');
  });

  it('formats 12/10/2026, 18:00 on a Manaus tenant', () => {
    expect(commentView(comment(), NOW, 'agora', MANAUS).createdAtAbsolute).toBe(
      '12/10/2026, 18:00',
    );
  });
});

describe('absoluteTimeFormatter — one formatter per zone', () => {
  it('memoises per zone and keeps zones apart', () => {
    expect(absoluteTimeFormatter(SP)).toBe(absoluteTimeFormatter(SP));
    expect(absoluteTimeFormatter(MANAUS)).not.toBe(absoluteTimeFormatter(SP));
    expect(absoluteTimeFormatter(MANAUS).resolvedOptions().timeZone).toBe(MANAUS);
  });
});

describe('postCardBase — the inline player labels (08-08, UI-D-282)', () => {
  const EMBED = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0';
  const withPreview = (embedUrl?: string, title: string | null = 'Encontro') =>
    ({
      ...post(),
      linkPreview: {
        status: 'resolved',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title,
        description: null,
        siteName: null,
        hostname: 'youtube.com',
        provider: 'youtube',
        imageAssetId: null,
        ...(embedUrl ? { embedUrl } : {}),
      },
    }) satisfies FeedPost;

  it('passes embedUrl and the pt-BR play, untitled and frame labels', () => {
    const card = postCardBase(withPreview(EMBED), NOW, tf, null);
    const link = card.media.linkPreview;
    expect(link?.preview.embedUrl).toBe(EMBED);
    expect(link?.playLabel).toBe('Assistir Encontro aqui');
    expect(link?.playUntitledLabel).toBe('Assistir vídeo aqui');
    expect(link?.frameTitle).toBe('YouTube: Encontro');
  });

  it('without embedUrl the card gets no player labels (the shipped external card)', () => {
    const link = postCardBase(withPreview(), NOW, tf, null).media.linkPreview;
    expect(link?.preview.embedUrl).toBeUndefined();
    expect(link?.playLabel).toBeUndefined();
    expect(link?.frameTitle).toBeUndefined();
  });
});

describe('postCardView — the locked sample (08.2-09, UI-D-374)', () => {
  const origin = 'https://rede-demo.test';

  it('a post marked access: sample is read-only and carries no share url', () => {
    const view = postCardView({ ...post(), access: 'sample' }, NOW, tf, origin, SP);
    expect(view.readOnly).toBe(true);
    expect(view.shareUrl).toBeNull();
  });

  it('an ordinary post keeps its share url and is not read-only', () => {
    const view = postCardView(post(), NOW, tf, origin, SP);
    expect(view.shareUrl).toBe(`${origin}/post/${post().id}`);
    expect('readOnly' in view).toBe(false);
  });
});
