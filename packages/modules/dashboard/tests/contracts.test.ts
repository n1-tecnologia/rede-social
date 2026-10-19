import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_QUEUES,
  flooredCountSchema,
  measured,
  NOT_MEASURED_REASONS,
  ownerOverviewAnswerSchema,
  PRIVACY_FLOOR,
  snapshotBuildPayloadSchema,
} from '../contracts/index';
import { PRIVACY_FLOOR as UI_PRIVACY_FLOOR } from '../ui/metrics';

/**
 * The snapshot pipe's contracts (08.7-01, D-455, D-462, D-464): what an owner answer may and may not
 * carry, the privacy-floor shape and the build job's payload. No database.
 */

const TENANT = '22222222-2222-4222-8222-222222222222';

const READY = {
  state: 'ready',
  snapshot: {
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
  },
  members: { count: 103, newMembers: 7, previous: 100 },
  // 08.7-02: the engaged share's inputs and the interacting trend, from the snapshot's members key.
  engagement: {
    counts: { new: 7, superfan: 10, engaged: 30, occasional: 26, at_risk: 20, inactive: 10 },
    newActivated: 5,
  },
  previousEngagement: {
    counts: { new: 6, superfan: 9, engaged: 28, occasional: 27, at_risk: 20, inactive: 10 },
    newActivated: 4,
  },
  actions30: 412,
  activeMembers30: 71,
  weeklyInteracting: {
    current: [40, 41, 39, 44, 45, 43, 47, 46, 48, 50, 49, 52],
    previous: [35, 36, 34, 37, 38, 36, 39, 40, 38, 41, 42, 40],
  },
  // 08.7-12: the bell's alerts (none here) and the live account; the module keys are optional.
  alerts: [],
  account: { plan: 'pilot', admins: 1, staff: 1 },
} as const;

describe('ownerOverviewAnswerSchema (D-455, EP-15, EP-19)', () => {
  it('parses the preparing answer and a ready answer', () => {
    expect(ownerOverviewAnswerSchema.parse({ state: 'preparing' })).toEqual({ state: 'preparing' });
    expect(ownerOverviewAnswerSchema.parse(READY)).toEqual(READY);
  });

  it('rejects a ready answer missing members', () => {
    const { members: _members, ...rest } = READY;
    expect(ownerOverviewAnswerSchema.safeParse(rest).success).toBe(false);
  });

  it('08.7-02: rejects a ready answer missing the engaged share inputs or a 12-week series', () => {
    const { engagement: _engagement, ...noBands } = READY;
    expect(ownerOverviewAnswerSchema.safeParse(noBands).success).toBe(false);
    const shortWeeks = { ...READY, weeklyInteracting: { current: [1, 2], previous: [1, 2] } };
    expect(ownerOverviewAnswerSchema.safeParse(shortWeeks).success).toBe(false);
  });

  it('rejects a negative or a fractional count', () => {
    for (const count of [-1, 1.5]) {
      const bad = { ...READY, members: { ...READY.members, count } };
      expect(ownerOverviewAnswerSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('rejects any object carrying example: true (no ExampleValue in an API schema)', () => {
    expect(ownerOverviewAnswerSchema.safeParse({ ...READY, example: true }).success).toBe(false);
    expect(
      ownerOverviewAnswerSchema.safeParse({
        ...READY,
        members: { ...READY.members, example: true },
      }).success,
    ).toBe(false);
    expect(ownerOverviewAnswerSchema.safeParse({ state: 'preparing', example: true }).success).toBe(
      false,
    );
  });

  it('a preparing answer carries no number key at all', () => {
    expect(
      ownerOverviewAnswerSchema.safeParse({ state: 'preparing', members: READY.members }).success,
    ).toBe(false);
  });
});

describe('measured() and the not-measured reasons (D-455)', () => {
  const schema = measured(flooredCountSchema);

  it('parses a measured value and a not-measured reason, never an example', () => {
    expect(schema.parse({ measured: true, value: { belowFloor: true } })).toEqual({
      measured: true,
      value: { belowFloor: true },
    });
    expect(schema.parse({ measured: false, reason: 'needs_offers' })).toEqual({
      measured: false,
      reason: 'needs_offers',
    });
    expect(
      schema.safeParse({ example: true, value: { belowFloor: true }, reason: 'needs_saves' })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ measured: false, reason: 'needs_saves', value: 3 }).success).toBe(
      false,
    );
  });

  it('adds needs_member_exit and needs_offers to the shipped reasons', () => {
    expect(NOT_MEASURED_REASONS).toContain('needs_member_exit');
    expect(NOT_MEASURED_REASONS).toContain('needs_offers');
    expect(NOT_MEASURED_REASONS).toContain('needs_story_taps');
  });
});

describe('flooredCountSchema (D-462)', () => {
  it('parses a floored and an exact count', () => {
    expect(flooredCountSchema.parse({ belowFloor: true })).toEqual({ belowFloor: true });
    expect(flooredCountSchema.parse({ belowFloor: false, value: 7 })).toEqual({
      belowFloor: false,
      value: 7,
    });
  });

  it('rejects a floored count that still carries its value', () => {
    expect(flooredCountSchema.safeParse({ belowFloor: true, value: 3 }).success).toBe(false);
  });

  it('shares one floor between the contracts and the ui helpers', () => {
    expect(PRIVACY_FLOOR).toBe(5);
    expect(UI_PRIVACY_FLOOR).toBe(PRIVACY_FLOOR);
  });
});

describe('snapshotBuildPayloadSchema (T-08.7-04)', () => {
  it('accepts one tenant and one ISO day', () => {
    expect(snapshotBuildPayloadSchema.parse({ tenantId: TENANT, day: '2026-10-17' })).toEqual({
      tenantId: TENANT,
      day: '2026-10-17',
    });
  });

  it('rejects a non-uuid tenant, a day that is not YYYY-MM-DD and extra keys', () => {
    for (const bad of [
      { tenantId: 'rede-demo', day: '2026-10-17' },
      { tenantId: TENANT, day: '17/10/2026' },
      { tenantId: TENANT, day: '2026-10-17T00:00:00Z' },
      { tenantId: TENANT, day: '2026-10-17', name: 'Ana' },
      { tenantId: TENANT },
    ]) {
      expect(snapshotBuildPayloadSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('names its queue', () => {
    expect(DASHBOARD_QUEUES.snapshotBuild).toBe('dashboard.snapshot-build');
  });
});
