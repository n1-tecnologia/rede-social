import {
  BOOTSTRAP_REASON_CODES,
  BOOTSTRAP_STEP_KEYS,
  DATABASE_STATES,
  type DatabaseState,
  databaseOverviewSchema,
} from '@rede-social/contracts/projects';
import { describe, expect, it } from 'vitest';
import { isTenantMoving } from '../server/projects/moving';
import { reasonCodeOf, summarizeDatabase } from '../server/projects/overview';
import { BOOTSTRAP_REASONS, BOOTSTRAP_STEPS } from '../server/projects/reasons';

/**
 * 09.2-14 (D-542, D-543, D-545, UI-D-539): the derivation of a tenant's database state from the facts the
 * registry holds. The pure function lives in the contracts (the web imports it too); this file proves the
 * kernel gathers its inputs correctly and that the contract's catalogs are the kernel's catalogs.
 */

const done = [{ status: 'done' }];

describe('the contract mirrors the kernel catalogs', () => {
  it('the eight steps and the ten reason codes are the bootstrap engine’s, in order', () => {
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

  it('the image requirement is unknown until the fan-out plan loads it, so nothing is behind', () => {
    // No `required` given: the kernel asks the image, which answers null today.
    const { required: _omit, ...withoutRequired } = base;
    expect(summarizeDatabase({ ...withoutRequired, appliedCount: 1 })).toEqual({
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

describe('moves are a stub with a contract (planning decision 2)', () => {
  it('no tenant is moving until plan 23 reads the move table', async () => {
    expect(await isTenantMoving('0a000000-0000-4000-8000-000000000001')).toBe(false);
  });

  it('the overview schema has a moving flag', () => {
    expect(Object.keys(databaseOverviewSchema.shape)).toContain('moving');
  });
});
