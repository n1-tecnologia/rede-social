import { describe, expect, it } from 'vitest';
import {
  ENGAGEMENT_BANDS,
  membersPayloadSchema,
  ownerMembersAnswerSchema,
} from '../contracts/members';
import { ENGAGEMENT_BAND_ORDER } from '../ui/metrics';

/**
 * The Membros contract (08.7-02, D-465, UI-D-486, UI-D-487, INSIGHT-08): what the members answer
 * and the stored members payload may and may not carry. No database.
 */

const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const COVER = '55555555-5555-4555-8555-555555555555';

const BANDS = {
  counts: { new: 3, superfan: 2, engaged: 10, occasional: 7, at_risk: 4, inactive: 1 },
  newActivated: 2,
};
const MOVEMENT = {
  up: 3,
  down: 2,
  flows: [
    { from: 'occasional', to: 'engaged', members: 3 },
    { from: 'engaged', to: 'occasional', members: 2 },
  ],
};
const COHORTS = [
  { month: '2026-08', values: [100, 50, 25] },
  { month: '2026-09', values: [100, 40] },
];
const WEEKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

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

const NOT_MEASURED = { measured: false, reason: 'needs_member_exit' } as const;

const READY = {
  state: 'ready',
  snapshot: SNAPSHOT,
  growth: { joined: 3, weeklyJoined: WEEKS, left: NOT_MEASURED, balance: NOT_MEASURED },
  engagement: BANDS,
  movement: MOVEMENT,
  cohorts: COHORTS,
  atRiskWithPush: 1,
};

const COMMUNITY_ENTRY = {
  id: COMMUNITY,
  bands: BANDS,
  atRiskWithPush: 0,
  members: 27,
  activeWeek: 5,
  posts: 4,
  interactions: 31,
  name: 'Mentoria',
  description: 'Encontros semanais.',
  coverAssetId: COVER,
  exclusive: true,
};

const EVENT_ENTRY = {
  id: EVENT,
  bands: BANDS,
  atRiskWithPush: 0,
  title: 'Encontro',
  startsAt: '2026-10-20T22:00:00.000Z',
  endsAt: '2026-10-21T00:00:00.000Z',
  format: 'in_person',
  coverAssetId: null,
};

const PAYLOAD = {
  growth: { joined: 3, weeklyJoined: WEEKS },
  engagement: BANDS,
  previousEngagement: BANDS,
  movement: MOVEMENT,
  cohorts: COHORTS,
  atRiskWithPush: 1,
  actions30: 120,
  activeMembers30: 19,
  weeklyInteracting: { current: WEEKS, previous: WEEKS },
  communityEngagement: [
    {
      id: COMMUNITY,
      bands: BANDS,
      atRiskWithPush: 0,
      members: 27,
      activeWeek: 5,
      posts: 4,
      interactions: 31,
    },
  ],
  eventEngagement: [{ id: EVENT, bands: BANDS, atRiskWithPush: 0 }],
};

describe('ownerMembersAnswerSchema (D-465, D-460, INSIGHT-08)', () => {
  it('parses a ready answer with communityEngagement absent (communities off)', () => {
    expect(ownerMembersAnswerSchema.safeParse(READY).success).toBe(true);
  });

  it('parses a ready answer with the community and event scopes present', () => {
    const parsed = ownerMembersAnswerSchema.safeParse({
      ...READY,
      communityEngagement: [COMMUNITY_ENTRY],
      eventEngagement: [EVENT_ENTRY],
    });
    expect(parsed.success).toBe(true);
  });

  it('parses the preparing answer, with no number key at all', () => {
    expect(ownerMembersAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
    expect(ownerMembersAnswerSchema.safeParse({ state: 'preparing', growth: {} }).success).toBe(
      false,
    );
  });

  it('D-465: rejects growth.left or growth.balance carrying a number', () => {
    expect(
      ownerMembersAnswerSchema.safeParse({ ...READY, growth: { ...READY.growth, left: 4 } })
        .success,
    ).toBe(false);
    expect(
      ownerMembersAnswerSchema.safeParse({
        ...READY,
        growth: { ...READY.growth, balance: { measured: true, value: -1 } },
      }).success,
    ).toBe(false);
  });

  it('D-455: rejects any example: true, at the top or inside a block', () => {
    expect(ownerMembersAnswerSchema.safeParse({ ...READY, example: true }).success).toBe(false);
    expect(
      ownerMembersAnswerSchema.safeParse({ ...READY, growth: { ...READY.growth, example: true } })
        .success,
    ).toBe(false);
    expect(
      ownerMembersAnswerSchema.safeParse({ ...READY, engagement: { ...BANDS, example: true } })
        .success,
    ).toBe(false);
  });

  it('rejects a cohort value outside 0..100 and a band id that does not exist', () => {
    expect(
      ownerMembersAnswerSchema.safeParse({
        ...READY,
        cohorts: [{ month: '2026-09', values: [100, 140] }],
      }).success,
    ).toBe(false);
    expect(
      ownerMembersAnswerSchema.safeParse({
        ...READY,
        movement: { ...MOVEMENT, flows: [{ from: 'active', to: 'engaged', members: 1 }] },
      }).success,
    ).toBe(false);
  });
});

describe('membersPayloadSchema (PR-1)', () => {
  it('parses the stored members payload: ids and numbers only', () => {
    expect(membersPayloadSchema.safeParse(PAYLOAD).success).toBe(true);
  });

  it('rejects a stored community entry carrying a label (labels are joined live)', () => {
    const parsed = membersPayloadSchema.safeParse({
      ...PAYLOAD,
      communityEngagement: [COMMUNITY_ENTRY],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a payload whose weekly series is not 12 blocks long', () => {
    expect(
      membersPayloadSchema.safeParse({ ...PAYLOAD, growth: { joined: 3, weeklyJoined: [1, 2] } })
        .success,
    ).toBe(false);
  });
});

describe('ENGAGEMENT_BANDS', () => {
  it('is the evaluation order of the ui entry (ENGAGEMENT_BAND_ORDER)', () => {
    expect([...ENGAGEMENT_BANDS]).toEqual([...ENGAGEMENT_BAND_ORDER]);
  });
});
