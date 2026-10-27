import {
  BOOTSTRAP_REASON_CODES,
  BOOTSTRAP_STEP_KEYS,
  DATABASE_STATES,
  type DatabaseState,
  databaseOverviewSchema,
} from '@rede-social/contracts/projects';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoveRow } from '../server/projects/move/state';
import { isTenantMoving } from '../server/projects/moving';
import { reasonCodeOf, summarizeDatabase } from '../server/projects/overview';
import { BOOTSTRAP_REASONS, BOOTSTRAP_STEPS } from '../server/projects/reasons';

// The unit lane has no database: only the move-table lookup is replaced, every other export stays real.
const h = vi.hoisted(() => ({
  openMoveOf: vi.fn<(tenantId: string) => Promise<MoveRow | null>>(),
}));

vi.mock('../server/projects/move/state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/projects/move/state')>()),
  openMoveOf: h.openMoveOf,
}));

/**
 * 09.2-14 (D-542, D-543, D-545, UI-D-539): the derivation of a tenant's database state from the facts the
 * registry holds. The pure function lives in the contracts (the web imports it too); this file proves the
 * kernel gathers its inputs correctly and that the contract's catalogs are the kernel's catalogs.
 */

const done = [{ status: 'done' }];

describe('the contract mirrors the kernel catalogs', () => {
  it('the eight steps and the thirteen reason codes are the bootstrap engine’s, in order', () => {
    expect([...BOOTSTRAP_STEP_KEYS]).toEqual([...BOOTSTRAP_STEPS]);
    expect([...BOOTSTRAP_REASON_CODES]).toEqual([...BOOTSTRAP_REASONS]);
  });

  it('a stored reason outside the catalog is shown as unknown, never as its text', () => {
    expect(reasonCodeOf(null)).toBeNull();
    expect(reasonCodeOf(undefined)).toBeNull();
    for (const code of BOOTSTRAP_REASONS) expect(reasonCodeOf(code)).toBe(code);
    expect(reasonCodeOf('connect ECONNREFUSED 10.0.0.1:5432')).toBe('unknown');
    expect(reasonCodeOf('')).toBe('unknown');
  });
});

describe('summarizeDatabase: every UI state from fixture facts', () => {
  const base = {
    projectState: 'ready',
    steps: done,
    healthStatus: 'healthy' as string | null,
    appliedCount: 147 as number | null,
    moving: false,
    required: 147 as number | null,
  };

  const cases: Array<[DatabaseState, Partial<typeof base>]> = [
    ['ready', {}],
    ['preparing', { projectState: 'preparing', steps: [{ status: 'running' }] }],
    ['preparation_failed', { projectState: 'preparing', steps: [{ status: 'failed' }] }],
    ['behind', { appliedCount: 144 }],
    ['paused', { healthStatus: 'paused' }],
    ['unreachable', { healthStatus: 'unreachable' }],
    ['moving', { moving: true }],
    ['unchecked', { healthStatus: null }],
  ];

  it.each(cases)('%s', (expected, overrides) => {
    expect(summarizeDatabase({ ...base, ...overrides }).state).toBe(expected);
  });

  it('covers every state of the vocabulary', () => {
    expect(new Set(cases.map(([state]) => state))).toEqual(new Set(DATABASE_STATES));
  });

  it('reports the applied of required counts, with null for what is not known', () => {
    expect(summarizeDatabase({ ...base, appliedCount: 144 }).schema).toEqual({
      applied: 144,
      required: 147,
    });
    expect(summarizeDatabase({ ...base, appliedCount: null, required: null }).schema).toEqual({
      applied: null,
      required: null,
    });
  });

  it('an unknown image requirement (null) means nothing is behind', () => {
    // 09.2-15: outside production the kernel derives the requirement from the repository, so "unknown" is
    // stated with `required: null` (a process without a manifest has no other way to say it).
    const { required: _omit, ...withoutRequired } = base;
    expect(summarizeDatabase({ ...withoutRequired, required: null, appliedCount: 1 })).toEqual({
      state: 'ready',
      schema: { applied: 1, required: null },
    });
  });

  it('moving beats everything, a failed step beats preparing, unreachable beats paused beats behind', () => {
    expect(
      summarizeDatabase({
        ...base,
        moving: true,
        projectState: 'preparing',
        steps: [{ status: 'failed' }],
        healthStatus: 'unreachable',
        appliedCount: 1,
      }).state,
    ).toBe('moving');
    expect(
      summarizeDatabase({
        ...base,
        projectState: 'preparing',
        steps: [{ status: 'failed' }],
        healthStatus: 'unreachable',
      }).state,
    ).toBe('preparation_failed');
    expect(summarizeDatabase({ ...base, healthStatus: 'unreachable', appliedCount: 1 }).state).toBe(
      'unreachable',
    );
    expect(summarizeDatabase({ ...base, healthStatus: 'paused', appliedCount: 1 }).state).toBe(
      'paused',
    );
    expect(summarizeDatabase({ ...base, healthStatus: 'unknown', appliedCount: 1 }).state).toBe(
      'behind',
    );
  });
});

const TENANT = '0a000000-0000-4000-8000-000000000001';

function openMove(): MoveRow {
  const at = new Date('2026-10-23T12:00:00Z');
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: TENANT,
    fromProjectId: '33333333-3333-4333-8333-333333333333',
    toProjectId: '44444444-4444-4444-8444-444444444444',
    state: 'copied',
    statusBefore: 'active',
    actor: 'cli',
    counts: {},
    fingerprint: null,
    errorCode: null,
    leaseOwner: null,
    leaseUntil: null,
    startedAt: at,
    updatedAt: at,
    cutoverAt: null,
    finishedAt: null,
    sourceDeletedAt: null,
  };
}

describe('the moving flag follows the move table (09.2-23, D-535)', () => {
  beforeEach(() => {
    h.openMoveOf.mockReset();
    h.openMoveOf.mockResolvedValue(null);
  });

  it('no open move: the tenant is not moving', async () => {
    h.openMoveOf.mockResolvedValue(null);
    expect(await isTenantMoving(TENANT)).toBe(false);
    expect(h.openMoveOf).toHaveBeenCalledWith(TENANT);
  });

  it('an open move row: the tenant is moving', async () => {
    h.openMoveOf.mockResolvedValue(openMove());
    expect(await isTenantMoving(TENANT)).toBe(true);
    expect(h.openMoveOf).toHaveBeenCalledWith(TENANT);
  });

  it('the overview schema has a moving flag', () => {
    expect(Object.keys(databaseOverviewSchema.shape)).toContain('moving');
  });
});
