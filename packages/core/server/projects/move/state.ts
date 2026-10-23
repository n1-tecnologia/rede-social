import { and, asc, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { tenantMoveEvents, tenantMoves } from '../../../db/central';
import { withPlatformTx } from '../../../db/platform-tx';
import { MoveError } from './types';

/**
 * The state machine of a move (09.2-23, D-535, DBT-48): a row of `platform.tenant_moves` whose `state` only
 * advances, one compare-and-set per transition, with an append-only event after each one and a 15-minute row
 * lease that keeps two runners off one move. All of it is row operations: no session lock, no advisory lock
 * across statements, so a transaction pooler cannot lose anything.
 *
 *   planned -> suspended -> copied -> verified -> cutover -> done
 *   (any open state, and `done` until the source is deleted) -> rolled_back
 *   copied -> suspended               only the recopy (`--recopy`) walks backwards
 *
 * Every function takes an optional `store`, so the transitions, the conflict, the lease and the event
 * validation are provable with no database (`move-state.test.ts`); the default store is the platform lane.
 */

export const MOVE_STATES = [
  'planned',
  'suspended',
  'copied',
  'verified',
  'cutover',
  'done',
  'rolled_back',
] as const;
export type MoveState = (typeof MOVE_STATES)[number];

/** Not `done` and not `rolled_back`: the tenant is held by this move. */
export const isOpen = (state: string): boolean => state !== 'done' && state !== 'rolled_back';

/** The legal transitions. Everything else is a bug and is refused before the database is asked. */
export const TRANSITIONS: Readonly<Record<MoveState, readonly MoveState[]>> = {
  planned: ['suspended', 'rolled_back'],
  suspended: ['copied', 'rolled_back'],
  copied: ['verified', 'suspended', 'rolled_back'],
  verified: ['cutover', 'rolled_back'],
  cutover: ['done', 'rolled_back'],
  done: ['rolled_back'],
  rolled_back: [],
};

/** States in which the registry pointer has not flipped yet: a rollback only restores the status. */
export const PRE_FLIP_STATES: readonly MoveState[] = ['planned', 'suspended', 'copied', 'verified'];

export const canTransition = (from: MoveState, to: MoveState): boolean =>
  TRANSITIONS[from].includes(to);

/** How long a runner owns a move (`lease_owner` / `lease_until`, 15 minutes). Each transition renews it. */
export const LEASE_MINUTES = 15;

export type MoveRow = {
  id: string;
  tenantId: string;
  fromProjectId: string;
  toProjectId: string;
  state: MoveState;
  statusBefore: 'active' | 'suspended';
  actor: string;
  counts: Record<string, unknown>;
  fingerprint: string | null;
  errorCode: string | null;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  startedAt: Date;
  updatedAt: Date;
  cutoverAt: Date | null;
  finishedAt: Date | null;
  sourceDeletedAt: Date | null;
};

export type MoveEvent = {
  id: string;
  moveId: string;
  at: Date;
  kind: string;
  detail: Record<string, unknown>;
};

/** What a transition may write besides the state. `counts` is MERGED into the stored object. */
export type AdvancePatch = {
  counts?: Record<string, unknown>;
  fingerprint?: string | null;
  /** `null` clears it. */
  errorCode?: string | null;
  /** Stamp the database clock. */
  cutoverAt?: true;
  finishedAt?: true;
};

export interface MoveStore {
  load(id: string): Promise<MoveRow | null>;
  /** The open move of a tenant, `null` when none. */
  open(tenantId: string): Promise<MoveRow | null>;
  /** `update ... where id = $1 and state = $from`; `null` when zero rows matched. */
  cas(id: string, from: MoveState, to: MoveState, patch: AdvancePatch): Promise<MoveRow | null>;
  /** Stores (or clears, with `null`) the failure code of a move, whatever its state. */
  setError(id: string, code: string | null): Promise<void>;
  /** Stamps `source_deleted_at` (state `done`, not yet stamped); `false` when zero rows matched. */
  markSourceDeleted(id: string): Promise<boolean>;
  /** True when this owner now holds the lease. */
  claim(id: string, owner: string): Promise<boolean>;
  release(id: string, owner: string): Promise<void>;
  addEvent(moveId: string, kind: string, detail: Record<string, unknown>): Promise<void>;
  events(moveId: string): Promise<MoveEvent[]>;
}

// ---------------------------------------------------------------------------------------------------------
// The lease rule, pure: the SQL of the default store says the same thing in one statement.
// ---------------------------------------------------------------------------------------------------------

/** A lease is claimable when nobody holds it, it has expired, or the claimant already holds it. */
export function leaseClaimable(
  row: Pick<MoveRow, 'leaseOwner' | 'leaseUntil'>,
  owner: string,
  now: Date,
): boolean {
  return row.leaseUntil === null || row.leaseUntil < now || row.leaseOwner === owner;
}

// ---------------------------------------------------------------------------------------------------------
// Event detail validation (T-09.2-105)
// ---------------------------------------------------------------------------------------------------------

const KIND_SHAPE = /^[a-z_]{3,40}$/;
const MAX_STRING = 200;
const MAX_DEPTH = 3;
/** A string that looks like an address, a hash, a token or a connection string is never an event value. */
const SECRET_SHAPES = [/@/, /:\/\//, /\$2[aby]\$/, /eyJ/, /sb_secret_/];

function checkValue(value: unknown, depth: number): void {
  if (value === null) return;
  const kind = typeof value;
  if (kind === 'number' || kind === 'boolean') {
    if (kind === 'number' && !Number.isFinite(value as number)) throw new MoveError('unknown');
    return;
  }
  if (kind === 'string') {
    const text = value as string;
    if (text.length > MAX_STRING || SECRET_SHAPES.some((shape) => shape.test(text))) {
      throw new MoveError('unknown');
    }
    return;
  }
  if (depth >= MAX_DEPTH) throw new MoveError('unknown');
  if (Array.isArray(value)) {
    for (const item of value) checkValue(item, depth + 1);
    return;
  }
  if (kind === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      checkValue(key, depth + 1);
      checkValue(child, depth + 1);
    }
    return;
  }
  throw new MoveError('unknown');
}

/**
 * An event detail is a plain object of strings, numbers, booleans, nulls and arrays or objects of them: ids,
 * counts, table names and codes. A row, an e-mail, a hash, a token or a connection string is refused here, so
 * the trail cannot become a leak even by mistake.
 */
export function assertEventDetail(
  kind: string,
  detail: unknown,
): asserts detail is Record<string, unknown> {
  if (!KIND_SHAPE.test(kind)) throw new MoveError('unknown');
  if (
    detail === null ||
    typeof detail !== 'object' ||
    Array.isArray(detail) ||
    Object.getPrototypeOf(detail) !== Object.prototype
  ) {
    throw new MoveError('unknown');
  }
  checkValue(detail, 0);
}

// ---------------------------------------------------------------------------------------------------------
// The default store: the platform lane
// ---------------------------------------------------------------------------------------------------------

type Row = typeof tenantMoves.$inferSelect;

export const toMoveRow = (row: Row): MoveRow => ({
  id: row.id,
  tenantId: row.tenantId,
  fromProjectId: row.fromProjectId,
  toProjectId: row.toProjectId,
  state: row.state as MoveState,
  statusBefore: row.statusBefore as 'active' | 'suspended',
  actor: row.actor,
  counts: row.counts,
  fingerprint: row.fingerprint,
  errorCode: row.errorCode,
  leaseOwner: row.leaseOwner,
  leaseUntil: row.leaseUntil,
  startedAt: row.startedAt,
  updatedAt: row.updatedAt,
  cutoverAt: row.cutoverAt,
  finishedAt: row.finishedAt,
  sourceDeletedAt: row.sourceDeletedAt,
});

const CLOSED: string[] = ['done', 'rolled_back'];

export const platformStore: MoveStore = {
  async load(id) {
    const rows = await withPlatformTx((tx) =>
      tx.select().from(tenantMoves).where(eq(tenantMoves.id, id)).limit(1),
    );
    return rows[0] ? toMoveRow(rows[0]) : null;
  },

  async open(tenantId) {
    const rows = await withPlatformTx((tx) =>
      tx
        .select()
        .from(tenantMoves)
        .where(and(eq(tenantMoves.tenantId, tenantId), notInArray(tenantMoves.state, CLOSED)))
        .limit(1),
    );
    return rows[0] ? toMoveRow(rows[0]) : null;
  },

  async cas(id, from, to, patch) {
    const rows = await withPlatformTx((tx) =>
      tx
        .update(tenantMoves)
        .set({
          state: to,
          updatedAt: sql`now()`,
          ...(patch.counts !== undefined
            ? { counts: sql`${tenantMoves.counts} || ${JSON.stringify(patch.counts)}::jsonb` }
            : {}),
          ...(patch.fingerprint !== undefined ? { fingerprint: patch.fingerprint } : {}),
          ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
          ...(patch.cutoverAt ? { cutoverAt: sql`now()` } : {}),
          ...(patch.finishedAt ? { finishedAt: sql`now()` } : {}),
        })
        .where(and(eq(tenantMoves.id, id), eq(tenantMoves.state, from)))
        .returning(),
    );
    return rows[0] ? toMoveRow(rows[0]) : null;
  },

  async setError(id, code) {
    await withPlatformTx((tx) =>
      tx
        .update(tenantMoves)
        .set({ errorCode: code, updatedAt: sql`now()` })
        .where(eq(tenantMoves.id, id)),
    );
  },

  async markSourceDeleted(id) {
    const rows = await withPlatformTx((tx) =>
      tx
        .update(tenantMoves)
        .set({ sourceDeletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(tenantMoves.id, id),
            eq(tenantMoves.state, 'done'),
            isNull(tenantMoves.sourceDeletedAt),
          ),
        )
        .returning({ id: tenantMoves.id }),
    );
    return rows.length === 1;
  },

  async claim(id, owner) {
    const rows = await withPlatformTx((tx) =>
      tx
        .update(tenantMoves)
        .set({
          leaseOwner: owner,
          leaseUntil: sql`now() + make_interval(mins => ${LEASE_MINUTES})`,
        })
        .where(
          and(
            eq(tenantMoves.id, id),
            sql`(${tenantMoves.leaseUntil} is null or ${tenantMoves.leaseUntil} < now() or ${tenantMoves.leaseOwner} = ${owner}::uuid)`,
          ),
        )
        .returning({ id: tenantMoves.id }),
    );
    return rows.length === 1;
  },

  async release(id, owner) {
    await withPlatformTx((tx) =>
      tx
        .update(tenantMoves)
        .set({ leaseOwner: null, leaseUntil: null })
        .where(and(eq(tenantMoves.id, id), eq(tenantMoves.leaseOwner, owner))),
    );
  },

  async addEvent(moveId, kind, detail) {
    await withPlatformTx((tx) => tx.insert(tenantMoveEvents).values({ moveId, kind, detail }));
  },

  async events(moveId) {
    const rows = await withPlatformTx((tx) =>
      tx
        .select()
        .from(tenantMoveEvents)
        .where(eq(tenantMoveEvents.moveId, moveId))
        .orderBy(asc(tenantMoveEvents.at), asc(tenantMoveEvents.id)),
    );
    return rows.map((row) => ({
      id: row.id,
      moveId: row.moveId,
      at: row.at,
      kind: row.kind,
      detail: row.detail,
    }));
  },
};

// ---------------------------------------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------------------------------------

export const loadMove = (id: string, store: MoveStore = platformStore): Promise<MoveRow | null> =>
  store.load(id);

export const openMoveOf = (
  tenantId: string,
  store: MoveStore = platformStore,
): Promise<MoveRow | null> => store.open(tenantId);

/** The most recent move of a tenant, open or closed (`--status`, `already_done`). */
export async function latestMoveOf(tenantId: string): Promise<MoveRow | null> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select()
      .from(tenantMoves)
      .where(eq(tenantMoves.tenantId, tenantId))
      .orderBy(desc(tenantMoves.startedAt), desc(tenantMoves.id))
      .limit(1),
  );
  return rows[0] ? toMoveRow(rows[0]) : null;
}

export const eventsOf = (moveId: string, store: MoveStore = platformStore): Promise<MoveEvent[]> =>
  store.events(moveId);

/**
 * One transition: `from -> to` as a compare-and-set. An illegal pair is a bug (`unknown`); zero rows means
 * another runner advanced the move first, and the caller stops with `move_conflict` having changed nothing.
 */
export async function advance(
  moveId: string,
  from: MoveState,
  to: MoveState,
  patch: AdvancePatch = {},
  store: MoveStore = platformStore,
): Promise<MoveRow> {
  if (!canTransition(from, to)) throw new MoveError('unknown');
  const row = await store.cas(moveId, from, to, patch);
  if (!row) throw new MoveError('move_conflict');
  return row;
}

/** Claims (or renews) the 15-minute lease. A move another live runner holds is `lease_held`. */
export async function claimLease(
  moveId: string,
  owner: string,
  store: MoveStore = platformStore,
): Promise<void> {
  if (!(await store.claim(moveId, owner))) throw new MoveError('lease_held');
}

export const setMoveError = (
  moveId: string,
  code: string | null,
  store: MoveStore = platformStore,
): Promise<void> => store.setError(moveId, code);

/** Stamps `source_deleted_at`: the point after which the move cannot be rolled back. */
export async function markSourceDeleted(
  moveId: string,
  store: MoveStore = platformStore,
): Promise<void> {
  if (!(await store.markSourceDeleted(moveId))) throw new MoveError('move_conflict');
}

export const releaseLease = (
  moveId: string,
  owner: string,
  store: MoveStore = platformStore,
): Promise<void> => store.release(moveId, owner);

/** Appends one audit event. The detail is validated first (`assertEventDetail`). */
export async function recordEvent(
  moveId: string,
  kind: string,
  detail: Record<string, unknown> = {},
  store: MoveStore = platformStore,
): Promise<void> {
  assertEventDetail(kind, detail);
  await store.addEvent(moveId, kind, detail);
}

/** Whether the move already holds an event of `kind` (the resume skips a side effect it already logged). */
export async function hasEvent(
  moveId: string,
  kind: string,
  store: MoveStore = platformStore,
): Promise<boolean> {
  return (await store.events(moveId)).some((event) => event.kind === kind);
}
