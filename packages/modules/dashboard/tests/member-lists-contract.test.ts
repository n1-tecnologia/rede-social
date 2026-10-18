import { describe, expect, it } from 'vitest';
import {
  OWNER_BAND_SCOPES,
  OWNER_MEMBER_LISTS,
  ownerActiveDayRowSchema,
  ownerBandListAnswerSchema,
  ownerBandListQuerySchema,
  ownerBandMemberRowSchema,
  ownerCommentRowSchema,
  ownerLikeRowSchema,
  ownerMemberDetailAnswerSchema,
  ownerMemberListAnswerSchema,
  ownerMemberListParamSchema,
  ownerStrongActionRowSchema,
} from '../contracts/member-lists';

/**
 * The named lists behind Membros (08.7-04, D-462, D-461, D-460, INSIGHT-09): what a band list and a
 * member detail may and may not carry. No database.
 */

const MEMBER = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const PRODUCT = '55555555-5555-4555-8555-555555555555';
const ORDER = '66666666-6666-4666-8666-666666666666';
const AVATAR = '77777777-7777-4777-8777-777777777777';

const SNAPSHOT = {
  day: '2026-10-17',
  builtAt: '2026-10-18T03:30:00.000Z',
  windows: {
    day: '2026-10-17',
    from30: '2026-09-18',
    prev30From: '2026-08-19',
    from7: '2026-10-11',
    prev7From: '2026-10-04',
    from30At: '2026-09-18T03:00:00Z',
    prev30At: '2026-08-19T03:00:00Z',
    untilAt: '2026-10-18T03:00:00Z',
  },
};

const ROW = {
  membershipId: MEMBER,
  displayName: 'Ana Souza',
  avatarAssetId: AVATAR,
  joinedAt: '2026-05-02T13:00:00Z',
  lastActiveAt: '2026-10-17T15:00:00.123456Z',
  topCommunity: { id: COMMUNITY, name: 'Corrida' },
  dailyMinutes: { measured: false, reason: 'needs_usage_sessions' },
};

const DETAIL = {
  state: 'ready',
  snapshot: SNAPSHOT,
  member: {
    membershipId: MEMBER,
    displayName: 'Ana Souza',
    avatarAssetId: null,
    joinedAt: '2026-05-02T13:00:00Z',
    lastActiveAt: '2026-10-17T15:00:00Z',
    band: 'engaged',
  },
  topCommunity: { id: COMMUNITY, name: 'Corrida' },
  bandHistory: [
    { month: '2026-08', band: null },
    { month: '2026-09', band: 'new' },
    { month: '2026-10', band: 'engaged' },
  ],
  last30: {
    activeDays: 5,
    likes: 7,
    comments: 2,
    checkIns: 1,
    orders: 1,
    strongActions: 4,
    dailyMinutes: { measured: false, reason: 'needs_usage_sessions' },
    postsSeen: { measured: false, reason: 'needs_post_views' },
  },
  weeklyActiveDays: [0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 1, 1],
  communities: [
    { communityId: COMMUNITY, name: 'Corrida', actions: 6 },
    { communityId: null, name: null, actions: 3 },
  ],
  postTypes: [
    { type: 'video', interactions: 5 },
    { type: 'text', interactions: 4 },
  ],
  events: [
    { eventId: EVENT, title: 'Encontro', startsAt: '2026-10-10T22:00:00Z', attended: true },
    { eventId: EVENT, title: 'Treino', startsAt: '2026-10-25T22:00:00Z', attended: null },
  ],
  purchases: [
    {
      orderId: ORDER,
      productId: PRODUCT,
      productName: 'Plano anual',
      kind: 'primary',
      paidAt: '2026-05-02T13:05:00Z',
      cents: 19900,
      expiresAt: { measured: false, reason: 'needs_access_expiry' },
    },
  ],
  support: { conversations: 2, lastDaysAgo: 4, medianResponseMinutes: 35 },
  suggestion: { kind: 'engaged', days: 0 },
};

const without = <T extends Record<string, unknown>>(value: T, ...keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

describe('constants', () => {
  it('names the three scopes and the four member lists the API serves', () => {
    expect(OWNER_BAND_SCOPES).toEqual(['base', 'community', 'event']);
    expect(OWNER_MEMBER_LISTS).toEqual(['active-days', 'likes', 'comments', 'strong-actions']);
  });
});

describe('the band list (INSIGHT-09)', () => {
  it('parses a ready page, the last page and a preparing answer', () => {
    const ready = ownerBandListAnswerSchema.parse({
      state: 'ready',
      snapshot: SNAPSHOT,
      total: 3,
      rows: [ROW, { ...ROW, lastActiveAt: null, topCommunity: null, avatarAssetId: null }],
      nextCursor: 'abc',
    });
    expect(ready.state).toBe('ready');
    expect(
      ownerBandListAnswerSchema.parse({
        state: 'ready',
        snapshot: SNAPSHOT,
        total: 0,
        rows: [],
        nextCursor: null,
      }),
    ).toMatchObject({ total: 0, rows: [], nextCursor: null });
    expect(ownerBandListAnswerSchema.parse({ state: 'preparing' })).toEqual({ state: 'preparing' });
  });

  it('EP-24: keeps a name exactly as stored (accents, emoji, 60 characters)', () => {
    const name = Array.from(`Zoë Ân🎉 ${'é'.repeat(60)}`)
      .slice(0, 60)
      .join('');
    expect([...name].length).toBe(60);
    expect(ownerBandMemberRowSchema.parse({ ...ROW, displayName: name }).displayName).toBe(name);
  });

  it('dailyMinutes is never a number, and a row is strict (no extra key)', () => {
    expect(
      ownerBandMemberRowSchema.safeParse({
        ...ROW,
        dailyMinutes: { measured: true, value: 12 },
      }).success,
    ).toBe(false);
    expect(
      ownerBandMemberRowSchema.safeParse({
        ...ROW,
        dailyMinutes: { measured: false, reason: 'needs_post_views' },
      }).success,
    ).toBe(false);
    expect(ownerBandMemberRowSchema.safeParse({ ...ROW, email: 'a@b.c' }).success).toBe(false);
  });

  it('a ready page without total or nextCursor fails, and preparing carries no number', () => {
    expect(
      ownerBandListAnswerSchema.safeParse({ state: 'ready', snapshot: SNAPSHOT, rows: [] }).success,
    ).toBe(false);
    expect(ownerBandListAnswerSchema.safeParse({ state: 'preparing', total: 0 }).success).toBe(
      false,
    );
  });

  it('the query: scope defaults to base, an unknown scope or a non-uuid scopeId fails', () => {
    expect(ownerBandListQuerySchema.parse({})).toEqual({ scope: 'base' });
    expect(ownerBandListQuerySchema.parse({ scope: 'event', scopeId: EVENT, limit: '3' })).toEqual({
      scope: 'event',
      scopeId: EVENT,
      limit: '3',
    });
    expect(ownerBandListQuerySchema.safeParse({ scope: 'everyone' }).success).toBe(false);
    expect(ownerBandListQuerySchema.safeParse({ scope: 'community', scopeId: 'x' }).success).toBe(
      false,
    );
  });
});

describe('the member detail (INSIGHT-09, D-460, D-465)', () => {
  it('parses a full ready detail', () => {
    expect(ownerMemberDetailAnswerSchema.parse(DETAIL)).toEqual(DETAIL);
  });

  it('parses a detail with every module-gated part absent (communities, events, store, chat off)', () => {
    const bare = without(DETAIL, 'topCommunity', 'communities', 'events', 'purchases', 'support');
    expect(ownerMemberDetailAnswerSchema.parse(bare)).toEqual(bare);
  });

  it('expiresAt is never a date, and a purchase is primary or secondary', () => {
    const purchase = DETAIL.purchases[0];
    expect(
      ownerMemberDetailAnswerSchema.safeParse({
        ...DETAIL,
        purchases: [{ ...purchase, expiresAt: '2027-05-02T13:05:00Z' }],
      }).success,
    ).toBe(false);
    expect(
      ownerMemberDetailAnswerSchema.safeParse({
        ...DETAIL,
        purchases: [{ ...purchase, expiresAt: { measured: true, value: '2027-05-02' } }],
      }).success,
    ).toBe(false);
    expect(
      ownerMemberDetailAnswerSchema.safeParse({
        ...DETAIL,
        purchases: [{ ...purchase, kind: 'renewal' }],
      }).success,
    ).toBe(false);
    expect(
      ownerMemberDetailAnswerSchema.safeParse({
        ...DETAIL,
        purchases: [{ ...purchase, offerId: 'o1' }],
      }).success,
    ).toBe(false);
  });

  it('postsSeen and dailyMinutes are not measured; the band history has the three anchors', () => {
    expect(
      ownerMemberDetailAnswerSchema.safeParse({
        ...DETAIL,
        last30: { ...DETAIL.last30, postsSeen: { measured: true, value: 4 } },
      }).success,
    ).toBe(false);
    expect(
      ownerMemberDetailAnswerSchema.safeParse({
        ...DETAIL,
        bandHistory: DETAIL.bandHistory.slice(1),
      }).success,
    ).toBe(false);
    expect(
      ownerMemberDetailAnswerSchema.safeParse({
        ...DETAIL,
        weeklyActiveDays: DETAIL.weeklyActiveDays.slice(1),
      }).success,
    ).toBe(false);
  });

  it('support carries counts and minutes only: a message text key fails', () => {
    expect(
      ownerMemberDetailAnswerSchema.safeParse({
        ...DETAIL,
        support: { ...DETAIL.support, lastMessage: 'Oi, preciso de ajuda' },
      }).success,
    ).toBe(false);
  });

  it('an event still to come is attended null; a preparing detail carries nothing', () => {
    const parsed = ownerMemberDetailAnswerSchema.parse(DETAIL);
    if (parsed.state !== 'ready') throw new Error('expected ready');
    expect(parsed.events?.map((event) => event.attended)).toEqual([true, null]);
    expect(ownerMemberDetailAnswerSchema.parse({ state: 'preparing' })).toEqual({
      state: 'preparing',
    });
  });
});

const POST_ID = '88888888-8888-4888-8888-888888888888';
const STORY_ID = '99999999-9999-4999-8999-999999999999';
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const POST = {
  id: POST_ID,
  kind: 'video',
  excerpt: 'Treino de sábado às 7h…',
  createdAt: '2026-10-01T12:00:00Z',
  coverAssetId: AVATAR,
};
const LIKE = {
  id: ROW_ID,
  at: '2026-10-16T15:00:00.123456Z',
  target: { kind: 'post', postId: POST_ID, storyId: null },
  post: POST,
};
const COMMENT = { id: ROW_ID, at: '2026-10-16T15:00:00Z', post: POST, storyId: null };

describe('the member lists (D-461, PD-9, T-08.7-14)', () => {
  it('parses one row of each list', () => {
    expect(ownerActiveDayRowSchema.parse({ day: '2026-10-16', actions: 3 })).toEqual({
      day: '2026-10-16',
      actions: 3,
    });
    expect(ownerLikeRowSchema.parse(LIKE)).toEqual(LIKE);
    const onStory = {
      ...LIKE,
      target: { kind: 'story', postId: null, storyId: STORY_ID },
      post: null,
    };
    expect(ownerLikeRowSchema.parse(onStory)).toEqual(onStory);
    const onComment = { ...LIKE, target: { kind: 'comment', postId: POST_ID, storyId: null } };
    expect(ownerLikeRowSchema.parse(onComment)).toEqual(onComment);
    expect(ownerCommentRowSchema.parse(COMMENT)).toEqual(COMMENT);
    for (const row of [
      { kind: 'comment', ...COMMENT },
      {
        kind: 'check_in',
        id: ROW_ID,
        at: '2026-10-10T22:00:00Z',
        eventId: EVENT,
        eventTitle: 'Encontro',
      },
      {
        kind: 'order',
        id: ORDER,
        at: '2026-10-03T15:00:00Z',
        productId: PRODUCT,
        productName: 'Plano anual',
        cents: 19900,
      },
    ]) {
      expect(ownerStrongActionRowSchema.parse(row)).toEqual(row);
    }
  });

  it('PD-9: a comments row carrying the comment text fails the strict row schema', () => {
    expect(ownerCommentRowSchema.safeParse({ ...COMMENT, body: 'Que treino!' }).success).toBe(
      false,
    );
    expect(ownerCommentRowSchema.safeParse({ ...COMMENT, text: 'Que treino!' }).success).toBe(
      false,
    );
    expect(
      ownerStrongActionRowSchema.safeParse({ kind: 'comment', ...COMMENT, body: 'Que treino!' })
        .success,
    ).toBe(false);
    // A post on a row carries its excerpt, never a comment body, and no extra key either.
    expect(ownerLikeRowSchema.safeParse({ ...LIKE, post: { ...POST, body: 'x' } }).success).toBe(
      false,
    );
  });

  it('a strong action is a comment, a check-in or a paid order, each with its own keys', () => {
    expect(
      ownerStrongActionRowSchema.safeParse({ kind: 'like', id: ROW_ID, at: LIKE.at }).success,
    ).toBe(false);
    expect(
      ownerStrongActionRowSchema.safeParse({
        kind: 'order',
        id: ORDER,
        at: LIKE.at,
        productId: PRODUCT,
        productName: 'Plano anual',
      }).success,
    ).toBe(false);
    expect(
      ownerStrongActionRowSchema.safeParse({
        kind: 'check_in',
        id: ROW_ID,
        at: LIKE.at,
        eventId: EVENT,
        eventTitle: 'Encontro',
        checkinCode: 'K4ST',
      }).success,
    ).toBe(false);
  });

  it('a list answer carries the rows of its own list only, and preparing carries nothing', () => {
    const ready = {
      state: 'ready',
      snapshot: SNAPSHOT,
      list: 'likes',
      rows: [LIKE],
      nextCursor: null,
    };
    expect(ownerMemberListAnswerSchema.parse(ready)).toEqual(ready);
    expect(ownerMemberListAnswerSchema.safeParse({ ...ready, list: 'active-days' }).success).toBe(
      false,
    );
    expect(
      ownerMemberListAnswerSchema.parse({ ...ready, list: 'comments', rows: [COMMENT] }),
    ).toMatchObject({ list: 'comments' });
    expect(ownerMemberListAnswerSchema.parse({ state: 'preparing' })).toEqual({
      state: 'preparing',
    });
  });

  it('"Publicações vistas" has no list: the param refuses it', () => {
    expect(
      ownerMemberListParamSchema.safeParse({ membershipId: MEMBER, list: 'posts-seen' }).success,
    ).toBe(false);
    expect(
      ownerMemberListParamSchema.parse({ membershipId: MEMBER, list: 'strong-actions' }),
    ).toEqual({ membershipId: MEMBER, list: 'strong-actions' });
  });
});
