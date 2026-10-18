import { describe, expect, it } from 'vitest';
import { memberActivityAnswerSchema, memberActivityPayloadSchema } from '../contracts/activity';

/**
 * The member's "Sua atividade" contract (08.7-03, D-455, D-458, D-463, INSIGHT-01..05): what the
 * stored `activity` of a member row and the member's own answer may and may not carry. No database.
 */

const COMMUNITY = '33333333-3333-4333-8333-333333333333';

const PAYLOAD = {
  likes: { count: 3, previous: 1 },
  comments: { count: 2, previous: 0 },
  storiesSeen: 2,
  byCommunity: [
    { communityId: COMMUNITY, interactions: 3 },
    { communityId: null, interactions: 2 },
  ],
  attendance: { attended: 2, events: 2 },
  weekStreak: 4,
};

const READY = {
  state: 'ready',
  snapshot: { day: '2026-10-17', builtAt: '2026-10-18T03:30:00Z' },
  likes: { count: 3, previous: 1 },
  comments: { count: 2, previous: 0 },
  saves: { measured: false, reason: 'needs_saves' },
  shares: { measured: false, reason: 'needs_shares' },
  usage: { measured: false, reason: 'needs_usage_sessions' },
  seen: {
    stories: 2,
    posts: { measured: false, reason: 'needs_post_views' },
    videos: { measured: false, reason: 'needs_video_playback' },
  },
  byCommunity: [
    { communityId: COMMUNITY, name: 'Geral', interactions: 3 },
    { communityId: null, name: null, interactions: 2 },
  ],
  attendance: { attended: 2, events: 2 },
  weekStreak: 4,
};

/** READY without the module-gated keys (communities and events off). */
const { byCommunity: _byCommunity, attendance: _attendance, ...READY_BARE } = READY;

describe('memberActivityPayloadSchema (the stored activity of a member row)', () => {
  it('parses the shape the builder writes', () => {
    expect(memberActivityPayloadSchema.safeParse(PAYLOAD).success).toBe(true);
  });

  it('rejects a payload missing a key (an older builder) so the read answers preparing', () => {
    const { weekStreak: _streak, ...older } = PAYLOAD;
    expect(memberActivityPayloadSchema.safeParse(older).success).toBe(false);
  });

  it('rejects a community row carrying a name (the snapshot keeps ids and numbers only, PR-1)', () => {
    const named = {
      ...PAYLOAD,
      byCommunity: [{ communityId: COMMUNITY, name: 'Geral', interactions: 3 }],
    };
    expect(memberActivityPayloadSchema.safeParse(named).success).toBe(false);
  });
});

describe('memberActivityAnswerSchema (GET /v1/dashboard/activity)', () => {
  it('parses preparing (no member row, or a null or invalid activity: INSIGHT-16)', () => {
    expect(memberActivityAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
  });

  it('parses a ready answer with byCommunity and attendance', () => {
    expect(memberActivityAnswerSchema.safeParse(READY).success).toBe(true);
  });

  it('parses a ready answer with byCommunity and attendance absent (communities and events off)', () => {
    expect(memberActivityAnswerSchema.safeParse(READY_BARE).success).toBe(true);
  });

  it('parses the empty member: zeros are real numbers, never "Em breve" (EP-02)', () => {
    const empty = {
      ...READY,
      likes: { count: 0, previous: 0 },
      comments: { count: 0, previous: 0 },
      seen: { ...READY.seen, stories: 0 },
      byCommunity: [],
      attendance: { attended: 0, events: 0 },
      weekStreak: 0,
    };
    expect(memberActivityAnswerSchema.safeParse(empty).success).toBe(true);
  });

  it('rejects saves carrying a number (D-455: an unmeasured metric has no value field)', () => {
    for (const saves of [
      9,
      { measured: true, value: 9 },
      { measured: false, reason: 'needs_saves', value: 9 },
    ]) {
      expect(memberActivityAnswerSchema.safeParse({ ...READY, saves }).success).toBe(false);
    }
  });

  it('rejects an unmeasured metric with another metric’s reason', () => {
    const wrong = { ...READY, shares: { measured: false, reason: 'needs_saves' } };
    expect(memberActivityAnswerSchema.safeParse(wrong).success).toBe(false);
  });

  it('rejects any example: true, at the top or inside a value (D-455)', () => {
    expect(memberActivityAnswerSchema.safeParse({ ...READY, example: true }).success).toBe(false);
    expect(
      memberActivityAnswerSchema.safeParse({
        ...READY,
        likes: { count: 3, previous: 1, example: true },
      }).success,
    ).toBe(false);
    expect(
      memberActivityAnswerSchema.safeParse({
        ...READY,
        seen: { ...READY.seen, stories: { example: true, value: 23 } },
      }).success,
    ).toBe(false);
  });

  it('rejects a number for usage, posts seen or videos (needs_usage_sessions, needs_post_views, needs_video_playback)', () => {
    expect(memberActivityAnswerSchema.safeParse({ ...READY, usage: 32 }).success).toBe(false);
    expect(
      memberActivityAnswerSchema.safeParse({ ...READY, seen: { ...READY.seen, posts: 60 } })
        .success,
    ).toBe(false);
    expect(
      memberActivityAnswerSchema.safeParse({ ...READY, seen: { ...READY.seen, videos: 41 } })
        .success,
    ).toBe(false);
  });

  it('rejects a community row with an id but no name, or a name without an id (EP-07)', () => {
    for (const row of [
      { communityId: COMMUNITY, name: null, interactions: 1 },
      { communityId: null, name: 'Início', interactions: 1 },
    ]) {
      expect(memberActivityAnswerSchema.safeParse({ ...READY, byCommunity: [row] }).success).toBe(
        false,
      );
    }
  });

  it('rejects more attended events than events (attendance is the pair attended of events)', () => {
    expect(
      memberActivityAnswerSchema.safeParse({ ...READY, attendance: { attended: 3, events: 2 } })
        .success,
    ).toBe(false);
  });

  it('rejects a comparison with other members (PR-3): no rank, percentile or average key', () => {
    for (const extra of [{ rank: 3 }, { percentile: 90 }, { communityAverage: 12 }]) {
      expect(memberActivityAnswerSchema.safeParse({ ...READY, ...extra }).success).toBe(false);
    }
  });
});
