import { describe, expect, it } from 'vitest';
import {
  ownerSupportAnswerSchema,
  SUPPORT_WEEKS,
  supportPayloadSchema,
} from '../contracts/support';

/**
 * The owner's Atendimento contract (08.7-11, D-455, D-460, D-465, INSIGHT-13, EP-42, EP-43): what
 * the stored `payload.support` and the area answer may and may not carry. Counts, minutes and staff
 * user ids in the payload; the answer adds the staff's live names and `bySubject`, which is never
 * data (D-465). No member identity, no message text anywhere. No database.
 */

const STAFF_A = '11111111-1111-4111-8111-111111111111';
const STAFF_B = '22222222-2222-4222-8222-222222222222';

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

const MODERATION = { removedComments: 2, blocks: 1, unblocks: 0, comments30: 40 };

const PAYLOAD = {
  awaiting: { count: 1, oldestHours: 26 },
  weeklyMedianMinutes: [null, 45, null, 30, 20, null, 60, 30],
  weeklyConversations: [0, 2, 0, 1, 3, 0, 1, 2],
  answeredByStaff: [
    { userId: STAFF_A, conversations: 3 },
    { userId: STAFF_B, conversations: 1 },
  ],
  moderation: MODERATION,
};

const READY = {
  state: 'ready',
  snapshot: SNAPSHOT,
  awaiting: PAYLOAD.awaiting,
  weeklyMedianMinutes: PAYLOAD.weeklyMedianMinutes,
  weeklyConversations: PAYLOAD.weeklyConversations,
  answeredByStaff: [
    { userId: STAFF_A, name: 'Ana da Equipe', conversations: 3 },
    { userId: STAFF_B, name: 'Bruno', conversations: 1 },
  ],
  bySubject: { measured: false, reason: 'needs_support_subject' },
  moderation: MODERATION,
};

describe('08.7 support contract', () => {
  it('reads eight weeks of seven days', () => {
    expect(SUPPORT_WEEKS).toBe(8);
  });

  describe('supportPayloadSchema (the stored payload.support)', () => {
    it('accepts counts, minutes and staff user ids, with null medians for unanswered weeks', () => {
      expect(supportPayloadSchema.safeParse(PAYLOAD).success).toBe(true);
    });

    it('accepts the empty tenant: no queue, eight null medians, eight zero weeks, no team (EP-42)', () => {
      const empty = {
        awaiting: { count: 0, oldestHours: null },
        weeklyMedianMinutes: Array(8).fill(null),
        weeklyConversations: Array(8).fill(0),
        answeredByStaff: [],
        moderation: { removedComments: 0, blocks: 0, unblocks: 0, comments30: 0 },
      };
      expect(supportPayloadSchema.safeParse(empty).success).toBe(true);
    });

    it('refuses a staff name in the payload (PR-1: names are joined live)', () => {
      const named = {
        ...PAYLOAD,
        answeredByStaff: [{ userId: STAFF_A, name: 'Ana', conversations: 3 }],
      };
      expect(supportPayloadSchema.safeParse(named).success).toBe(false);
    });

    it('refuses a week count other than eight', () => {
      expect(
        supportPayloadSchema.safeParse({ ...PAYLOAD, weeklyMedianMinutes: Array(7).fill(null) })
          .success,
      ).toBe(false);
      expect(
        supportPayloadSchema.safeParse({ ...PAYLOAD, weeklyConversations: Array(9).fill(0) })
          .success,
      ).toBe(false);
    });

    it('refuses a fractional or negative median', () => {
      const bad = [...PAYLOAD.weeklyMedianMinutes];
      bad[7] = 30.5;
      expect(supportPayloadSchema.safeParse({ ...PAYLOAD, weeklyMedianMinutes: bad }).success).toBe(
        false,
      );
      bad[7] = -1;
      expect(supportPayloadSchema.safeParse({ ...PAYLOAD, weeklyMedianMinutes: bad }).success).toBe(
        false,
      );
    });

    it('ties the oldest wait to the queue: a number only with someone waiting', () => {
      expect(
        supportPayloadSchema.safeParse({ ...PAYLOAD, awaiting: { count: 0, oldestHours: 3 } })
          .success,
      ).toBe(false);
      expect(
        supportPayloadSchema.safeParse({ ...PAYLOAD, awaiting: { count: 2, oldestHours: null } })
          .success,
      ).toBe(false);
    });

    it('refuses a subject breakdown in the stored payload (D-465)', () => {
      expect(
        supportPayloadSchema.safeParse({ ...PAYLOAD, bySubject: [{ subject: 'access', n: 1 }] })
          .success,
      ).toBe(false);
    });
  });

  describe('ownerSupportAnswerSchema (GET /v1/dashboard/owner/support)', () => {
    it('accepts a ready answer with null weekly medians and the staff names', () => {
      expect(ownerSupportAnswerSchema.safeParse(READY).success).toBe(true);
    });

    it('accepts preparing', () => {
      expect(ownerSupportAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
    });

    it('rejects bySubject as data (D-465: only { measured: false, reason })', () => {
      const asData = {
        ...READY,
        bySubject: { measured: true, value: [{ subject: 'access', conversations: 26 }] },
      };
      expect(ownerSupportAnswerSchema.safeParse(asData).success).toBe(false);
      const withExample = {
        ...READY,
        bySubject: {
          measured: false,
          reason: 'needs_support_subject',
          example: [{ subject: 'access', conversations: 26 }],
        },
      };
      expect(ownerSupportAnswerSchema.safeParse(withExample).success).toBe(false);
    });

    it('rejects bySubject with any reason but needs_support_subject', () => {
      expect(
        ownerSupportAnswerSchema.safeParse({
          ...READY,
          bySubject: { measured: false, reason: 'needs_offers' },
        }).success,
      ).toBe(false);
    });

    it('refuses a member identity or a message text on a staff row (EP-43)', () => {
      const withMember = {
        ...READY,
        answeredByStaff: [{ ...READY.answeredByStaff[0], memberId: STAFF_B }],
      };
      expect(ownerSupportAnswerSchema.safeParse(withMember).success).toBe(false);
      const withBody = { ...READY, lastMessage: 'Oi, preciso de ajuda.' };
      expect(ownerSupportAnswerSchema.safeParse(withBody).success).toBe(false);
    });

    it('keeps a staff name exactly as stored (no trim, no case change)', () => {
      const raw = {
        ...READY,
        answeredByStaff: [{ userId: STAFF_A, name: '  Zé ', conversations: 1 }],
      };
      const parsed = ownerSupportAnswerSchema.parse(raw);
      if (parsed.state !== 'ready') throw new Error('expected ready');
      expect(parsed.answeredByStaff[0]?.name).toBe('  Zé ');
    });

    it('requires the removal-rate denominator in moderation', () => {
      const { comments30: _omit, ...withoutComments } = MODERATION;
      expect(
        ownerSupportAnswerSchema.safeParse({ ...READY, moderation: withoutComments }).success,
      ).toBe(false);
    });
  });
});
