import { describe, expect, it } from 'vitest';
import { ApiError } from '../server/http/api-error';
import {
  type AdvancePatch,
  advance,
  assertEventDetail,
  canTransition,
  claimLease,
  hasEvent,
  isOpen,
  LEASE_MINUTES,
  leaseClaimable,
  MOVE_STATES,
  type MoveEvent,
  type MoveRow,
  type MoveState,
  type MoveStore,
  recordEvent,
  releaseLease,
  TRANSITIONS,
} from '../server/projects/move/state';
import { MoveError } from '../server/projects/move/types';
import { assertNotMoving } from '../server/projects/moving';

/**
 * 09.2-23 (D-535, DBT-48): the state machine with NO database. An in-memory store with a controllable clock
 * stands in for the platform lane; the SQL of the real store (compare-and-set, lease, partial unique index) is
 * proved on a real Postgres by `move-guard.test.ts` and pgTAP 215.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';

function row(patch: Partial<MoveRow> = {}): MoveRow {
  const at = new Date('2026-10-23T12:00:00Z');
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: TENANT,
    fromProjectId: '33333333-3333-4333-8333-333333333333',
    toProjectId: '44444444-4444-4444-8444-444444444444',
    state: 'planned',
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
    ...patch,
  };
}

/** A store over one in-memory row; `clock` is the "database now" the lease rule reads. */
function memoryStore(initial: MoveRow = row()) {
  let current = initial;
  const events: MoveEvent[] = [];
  const clock = { now: new Date('2026-10-23T12:00:00Z') };
  let casCalls = 0;
  const store: MoveStore = {
    async load(id) {
      return id === current.id ? current : null;
    },
    async open() {
      return isOpen(current.state) ? current : null;
    },
    async cas(id, from, to, patch: AdvancePatch) {
      casCalls += 1;
      if (id !== current.id || current.state !== from) return null;
      current = {
        ...current,
        state: to,
        counts: { ...current.counts, ...(patch.counts ?? {}) },
        ...(patch.fingerprint !== undefined ? { fingerprint: patch.fingerprint } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        ...(patch.cutoverAt ? { cutoverAt: clock.now } : {}),
        ...(patch.finishedAt ? { finishedAt: clock.now } : {}),
      };
      return current;
    },
    async setError(_id, code) {
      current = { ...current, errorCode: code };
    },
    async claim(_id, owner) {
      if (!leaseClaimable(current, owner, clock.now)) return false;
      current = {
        ...current,
        leaseOwner: owner,
        leaseUntil: new Date(clock.now.getTime() + LEASE_MINUTES * 60_000),
      };
      return true;
    },
    async release(_id, owner) {
      if (current.leaseOwner === owner)
        current = { ...current, leaseOwner: null, leaseUntil: null };
    },
    async addEvent(moveId, kind, detail) {
      events.push({ id: String(events.length), moveId, at: clock.now, kind, detail });
    },
    async events() {
      return events;
    },
  };
  return { store, clock, events, row: () => current, casCalls: () => casCalls };
}

describe('the transitions (D-535)', () => {
  it('advance only along planned, suspended, copied, verified, cutover, done', () => {
    const chain: MoveState[] = ['planned', 'suspended', 'copied', 'verified', 'cutover', 'done'];
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(canTransition(chain[i] as MoveState, chain[i + 1] as MoveState)).toBe(true);
    }
    // No skipping, no going back (but the recopy), nothing out of a terminal state.
    expect(canTransition('planned', 'copied')).toBe(false);
    expect(canTransition('suspended', 'verified')).toBe(false);
    expect(canTransition('verified', 'done')).toBe(false);
    expect(canTransition('done', 'planned')).toBe(false);
    expect(canTransition('cutover', 'copied')).toBe(false);
    expect(TRANSITIONS.rolled_back).toEqual([]);
  });

  it('a rollback ends every open state, and a finished move until the source is deleted', () => {
    for (const state of MOVE_STATES.filter((s) => s !== 'rolled_back')) {
      expect(canTransition(state, 'rolled_back')).toBe(true);
    }
    expect(isOpen('done')).toBe(false);
    expect(isOpen('rolled_back')).toBe(false);
    expect(isOpen('cutover')).toBe(true);
  });

  it('only the recopy walks backwards, and only from copied', () => {
    expect(canTransition('copied', 'suspended')).toBe(true);
    expect(canTransition('verified', 'suspended')).toBe(false);
    expect(canTransition('cutover', 'suspended')).toBe(false);
  });

  it('refuses an illegal pair before the database is asked', async () => {
    const m = memoryStore();
    await expect(advance(m.row().id, 'planned', 'done', {}, m.store)).rejects.toMatchObject({
      code: 'unknown',
    });
    expect(m.casCalls()).toBe(0);
  });
});

describe('the compare-and-set (D-535, P95)', () => {
  it('moves the state once and merges the counts', async () => {
    const m = memoryStore();
    const next = await advance(m.row().id, 'planned', 'suspended', { counts: { a: 1 } }, m.store);
    expect(next.state).toBe('suspended');
    const later = await advance(m.row().id, 'suspended', 'copied', { counts: { b: 2 } }, m.store);
    expect(later.counts).toEqual({ a: 1, b: 2 });
  });

  it('answers move_conflict when another runner already advanced, and changes nothing', async () => {
    const m = memoryStore();
    await advance(m.row().id, 'planned', 'suspended', {}, m.store);
    const stale = advance(m.row().id, 'planned', 'suspended', { counts: { x: 1 } }, m.store);
    await expect(stale).rejects.toBeInstanceOf(MoveError);
    await expect(stale).rejects.toMatchObject({ code: 'move_conflict' });
    expect(m.row().state).toBe('suspended');
    expect(m.row().counts).toEqual({});
  });

  it('of two simultaneous advances from one state exactly one wins', async () => {
    const m = memoryStore();
    const results = await Promise.allSettled([
      advance(m.row().id, 'planned', 'suspended', {}, m.store),
      advance(m.row().id, 'planned', 'suspended', {}, m.store),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

describe('the lease (D-535, P95)', () => {
  it('is claimable when nobody holds it, when expired, and by its own holder', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    const later = new Date(now.getTime() + 60_000);
    expect(leaseClaimable({ leaseOwner: null, leaseUntil: null }, 'a', now)).toBe(true);
    expect(leaseClaimable({ leaseOwner: 'b', leaseUntil: later }, 'a', now)).toBe(false);
    expect(leaseClaimable({ leaseOwner: 'b', leaseUntil: later }, 'b', now)).toBe(true);
    expect(
      leaseClaimable({ leaseOwner: 'b', leaseUntil: new Date(now.getTime() - 1) }, 'a', now),
    ).toBe(true);
  });

  it('a second runner gets lease_held until the first lease expires or is released', async () => {
    const m = memoryStore();
    const id = m.row().id;
    await claimLease(id, 'runner-1', m.store);
    await expect(claimLease(id, 'runner-2', m.store)).rejects.toMatchObject({ code: 'lease_held' });
    // The holder renews it.
    await claimLease(id, 'runner-1', m.store);
    // Past 15 minutes the second one takes over.
    m.clock.now = new Date(m.clock.now.getTime() + (LEASE_MINUTES + 1) * 60_000);
    await claimLease(id, 'runner-2', m.store);
    expect(m.row().leaseOwner).toBe('runner-2');
    // A release by someone who does not hold it changes nothing; by the holder it frees the lease.
    await releaseLease(id, 'runner-1', m.store);
    expect(m.row().leaseOwner).toBe('runner-2');
    await releaseLease(id, 'runner-2', m.store);
    await claimLease(id, 'runner-3', m.store);
    expect(m.row().leaseOwner).toBe('runner-3');
  });
});

describe('the audit trail (T-09.2-103, T-09.2-105)', () => {
  it('accepts ids, counts, names, codes and lists of them', () => {
    expect(() =>
      assertEventDetail('copied', {
        tables: 12,
        rows: 340,
        names: ['feed_posts', 'communities'],
        nested: { feed_posts: 3 },
        ok: true,
        none: null,
        code: 'verify_failed',
        id: '22222222-2222-4222-8222-222222222222',
      }),
    ).not.toThrow();
  });

  it('refuses an e-mail, a bcrypt hash, a token, a connection string and a key', () => {
    for (const bad of [
      'someone@example.com',
      '$2a$10$abcdefghijklmnopqrstuv',
      '$2b$10$abcdefghijklmnopqrstuv',
      'eyJhbGciOiJFUzI1NiJ9.payload.sig',
      'postgres://postgres:secret@host:5432/db',
      'sb_secret_abcdef',
      'x'.repeat(201),
    ]) {
      expect(() => assertEventDetail('failed', { value: bad })).toThrow(MoveError);
      expect(() => assertEventDetail('failed', { list: [bad] })).toThrow(MoveError);
    }
  });

  it('refuses a detail that is not a plain object, and a kind that is not a code', () => {
    expect(() => assertEventDetail('failed', [] as never)).toThrow(MoveError);
    expect(() => assertEventDetail('failed', null as never)).toThrow(MoveError);
    expect(() => assertEventDetail('failed', new Date() as never)).toThrow(MoveError);
    expect(() => assertEventDetail('failed', { n: Number.NaN })).toThrow(MoveError);
    expect(() => assertEventDetail('failed', { a: { b: { c: { d: 1 } } } })).toThrow(MoveError);
    expect(() => assertEventDetail('Bad Kind', {})).toThrow(MoveError);
    expect(() => assertEventDetail('ab', {})).toThrow(MoveError);
  });

  it('recordEvent writes in order and never stores a refused detail', async () => {
    const m = memoryStore();
    const id = m.row().id;
    await recordEvent(id, 'started', { toRef: 'tenant-b' }, m.store);
    await expect(recordEvent(id, 'failed', { who: 'a@b.com' }, m.store)).rejects.toBeInstanceOf(
      MoveError,
    );
    await recordEvent(id, 'suspended', {}, m.store);
    expect(m.events.map((e) => e.kind)).toEqual(['started', 'suspended']);
    expect(await hasEvent(id, 'suspended', m.store)).toBe(true);
    expect(await hasEvent(id, 'done', m.store)).toBe(false);
  });
});

describe('assertNotMoving (T-09.2-101)', () => {
  it('lets a tenant with no open move through', async () => {
    const m = memoryStore(row({ state: 'done' }));
    await expect(assertNotMoving(TENANT, { store: m.store })).resolves.toBeUndefined();
    const rolled = memoryStore(row({ state: 'rolled_back' }));
    await expect(assertNotMoving(TENANT, { store: rolled.store })).resolves.toBeUndefined();
  });

  it('refuses with 409 TENANT_MOVING while a move is open, whatever its state', async () => {
    for (const state of ['planned', 'suspended', 'copied', 'verified', 'cutover'] as const) {
      const m = memoryStore(row({ state }));
      const attempt = assertNotMoving(TENANT, { store: m.store });
      await expect(attempt).rejects.toBeInstanceOf(ApiError);
      await expect(attempt).rejects.toMatchObject({ code: 'TENANT_MOVING', status: 409 });
    }
  });

  it('lets only the matching move id through', async () => {
    const m = memoryStore(row({ state: 'suspended' }));
    const id = m.row().id;
    await expect(assertNotMoving(TENANT, { moveId: id, store: m.store })).resolves.toBeUndefined();
    await expect(
      assertNotMoving(TENANT, { moveId: '99999999-9999-4999-8999-999999999999', store: m.store }),
    ).rejects.toMatchObject({ code: 'TENANT_MOVING' });
    await expect(
      assertNotMoving(TENANT, { moveId: undefined, store: m.store }),
    ).rejects.toMatchObject({
      code: 'TENANT_MOVING',
    });
  });
});
