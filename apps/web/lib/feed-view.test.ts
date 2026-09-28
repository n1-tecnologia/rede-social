import type { FeedComment, FeedPost } from '@rede-social/module-feed/contracts';
import { createTranslator } from 'next-intl';
import type { getTranslations } from 'next-intl/server';
import { describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { absoluteTimeFormatter, commentView, postCardBase, postCardView } from '@/lib/feed-view';

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
